# API 契约

基础路径：`/api/v1`。除注册、登录和刷新外，请求使用 `Authorization: Bearer <accessToken>`。

错误统一返回：

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "请求字段不合法",
    "details": [],
    "traceId": "req-..."
  }
}
```

## 认证

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/auth/register` | 注册并返回 Access Token，同时设置 Refresh Cookie |
| POST | `/auth/login` | 登录并轮换 Refresh Cookie |
| POST | `/auth/refresh` | 使用 Cookie 轮换刷新令牌 |
| POST | `/auth/logout` | 撤销当前 Refresh Session 并清除 Cookie |

Refresh Cookie 路径为 `/api/v1/auth`，生产环境在 HTTPS 下自动使用 `Secure`。

## 用户与设置

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/users/me` | 当前用户 |
| PATCH | `/users/me` | 更新展示名、默认乐器、时区和语言 |
| POST | `/users/me/password` | 修改密码并撤销其他会话 |

## 练习

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/sessions` | 光标分页、搜索、筛选和排序 |
| POST | `/sessions` | 创建练习 |
| GET | `/sessions/:id` | 详情，包含音频、标记、目标和复盘 |
| PATCH | `/sessions/:id` | 乐观锁更新；请求必须带 `version` |
| POST | `/sessions/:id/start-review` | 存在已就绪音频时进入 `IN_REVIEW` |
| GET | `/sessions/:id/completion-check` | 返回结构化缺失项 |
| POST | `/sessions/:id/complete` | 原子完成复盘 |
| POST | `/sessions/:id/archive` | 归档已完成练习 |
| POST | `/sessions/:id/restore` | 恢复归档练习 |
| PUT | `/sessions/:id/piece` | 关联/更换/解除（传 `null`）曲目 |
| DELETE | `/sessions/:id` | 必须提交完整 `confirmationTitle` |

创建练习：

```json
{
  "title": "协奏曲第二乐章 17-24 小节",
  "instrument": "小提琴",
  "startedAt": "2026-09-29T12:00:00.000Z",
  "focus": "换把后的音准",
  "location": "琴房 A",
  "notes": "节拍器 84 BPM",
  "actualDurationMs": 1800000
}
```

## 音频上传

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/sessions/:sessionId/media/uploads` | 创建上传会话并返回预签名 PUT URL |
| POST | `/media/:mediaId/complete-upload` | 校验对象大小/SHA-256 并投递探测任务 |
| GET | `/media/:mediaId` | 状态、元数据与波形峰值 |
| GET | `/media/:mediaId/playback-url` | 获取短期私有播放地址 |
| POST | `/media/:mediaId/retry-probe` | 重试音频探测 |
| DELETE | `/media/:mediaId` | 删除对象和关联标记 |

创建上传会话：

```json
{
  "originalName": "practice.wav",
  "mimeType": "audio/wav",
  "sizeBytes": 2646000,
  "sha256": "64-hex-characters"
}
```

预签名请求的 `Content-Type` 和 `x-amz-meta-sha256` 已纳入签名，必须使用返回的 `requiredHeaders` 原样上传。

## 标记

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/sessions/:sessionId/annotations` | 标记列表 |
| POST | `/sessions/:sessionId/annotations` | 新增标记 |
| PATCH | `/annotations/:id` | 编辑标记 |
| DELETE | `/annotations/:id` | 删除标记 |

区间使用毫秒整数，最小时长 100 ms，且不能超过音频时长。问题类型为 `RHYTHM`、`FINGERING` 或 `EMOTION`。

## 复盘与目标

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/sessions/:sessionId/review` | 获取复盘 |
| PUT | `/sessions/:sessionId/review` | 保存复盘草稿 |
| POST | `/sessions/:sessionId/review/complete` | 完成复盘事务 |
| GET/POST | `/goals` | 目标列表/创建 |
| GET/PATCH | `/goals/:id` | 目标详情/更新 |
| POST | `/goals/:id/activate` | 重新激活取消或逾期目标 |
| POST | `/goals/:id/cancel` | 带原因取消 |
| POST | `/goals/:id/complete` | 用户确认完成 |
| GET/POST | `/goals/:id/progress` | 进度列表/新增 |

完成复盘请求会原子写入复盘、目标、进度并更新练习状态。任一步失败时全部回滚，返回 `REVIEW_INCOMPLETE` 且 `details` 为缺失项数组。

## 曲目资料库

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/repertoire/pieces` | 光标分页，支持名称/作曲家/别名/标签搜索、调性、难度、标签和状态筛选 |
| POST | `/repertoire/pieces` | 创建曲目；疑似重复时返回 `PIECE_DUPLICATE`，带 `allowDuplicate: true` 可强制保存 |
| GET | `/repertoire/pieces/tags` | 全部标签及使用次数 |
| GET | `/repertoire/pieces/:id` | 曲目详情，含最近 20 条历史练习 |
| PATCH | `/repertoire/pieces/:id` | 乐观锁更新；请求必须带 `version` |
| POST | `/repertoire/pieces/:id/archive` / `/restore` | 归档与恢复 |
| GET | `/repertoire/pieces/:id/duplicates` | 按归一化名称与别名匹配的疑似重复条目 |
| POST | `/repertoire/pieces/:id/merge` | 以当前曲目为保留条目合并 `sourcePieceId` |
| GET | `/repertoire/merges` | 合并记录，`status` 可为 `CONFLICTS_PENDING`、`RESOLVED` 或 `ALL` |
| GET | `/repertoire/merges/:id` | 单次合并及全部冲突项 |
| POST | `/repertoire/merges/:id/conflicts/:conflictId/resolve` | 处理一条冲突 |

创建曲目：

```json
{
  "title": "月光奏鸣曲 第一乐章",
  "composer": "贝多芬",
  "key": "C#min",
  "difficulty": 4,
  "tags": ["音准", "踏板", "力度层次"],
  "aliases": ["Moonlight Sonata", "第十四钢琴奏鸣曲"],
  "notes": "三连音均匀，高潮段左右手对齐"
}
```

### 原子迁移与冲突保留

`POST /repertoire/pieces/:id/merge` 在单个数据库事务中完成：

1. 把来源曲目下的全部练习引用迁移到保留曲目；
2. 联合两侧的别名、问题标签与备注（来源旧名自动收入别名，避免合并后搜不到）；
3. 重新计算两侧曲目的练习次数、累计时长和最近练习时间；
4. 来源条目标记为 `MERGED` 并指向保留条目，保留可追溯的合并记录。

调性（`KEY`）、难度（`DIFFICULTY`）、作曲家（`COMPOSER`）在两侧都有值且不一致时**不自动覆盖**，而是生成状态为 `PENDING` 的冲突项，合并作业停留在 `CONFLICTS_PENDING`。处理冲突：

```json
{ "resolution": "USE_CUSTOM", "customValue": "Dmin" }
```

`resolution` 取值：`KEEP_TARGET`（保留当前值）、`USE_SOURCE`（采用来源值）、`USE_CUSTOM`（必须同时提交 `customValue`，难度限定 1–5 整数）、`DISMISSED`（关闭该项但不改值）。全部冲突处理完毕后作业自动置为 `RESOLVED`。

## 统计与导出

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/statistics/overview` | 总览指标 |
| GET | `/statistics/trends` | 按用户时区分日趋势 |
| GET | `/statistics/issues` | 问题类型、严重度和困难片段 |
| GET | `/statistics/goals` | 目标完成率和逾期 |
| GET | `/statistics/instruments` | 各乐器聚合 |
| GET | `/statistics/dashboard` | 首页聚合 |
| POST | `/exports` | 创建 JSON/CSV 用户数据导出 |
| GET | `/exports/:id` | 查询导出状态和短时下载地址 |

统计接口必须传 `from`、`to` 和 IANA `timezone`。

## 健康检查

| 路径 | 说明 |
|---|---|
| `/health/live` | 仅检查进程存活 |
| `/health/ready` | 检查 PostgreSQL、Redis 和对象存储 |
| `/metrics` | Prometheus 文本指标 |
