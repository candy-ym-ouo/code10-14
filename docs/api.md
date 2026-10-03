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
| GET/POST | `/pieces` | 曲目列表（筛选/搜索/分页）/ 创建 |
| GET/PATCH | `/pieces/:id` | 曲目详情 / 乐观锁编辑 |
| PUT | `/pieces/:id/tags` | 全量设置问题标签 |
| POST | `/pieces/:id/archive` / `/restore` | 归档 / 恢复 |
| POST | `/pieces/:id/merge` | 合并重复条目（原子迁移引用，冲突保留待处理） |
| GET | `/pieces/:id/sessions` | 该曲目的历史练习（分页） |
| POST/DELETE | `/pieces/:id/sessions/:sessionId` | 把练习归入曲目 / 移出 |
| GET | `/pieces/tags` | 当前用户的问题标签字典 |
| GET | `/pieces/merges` | 所有仍有待处理冲突的合并 |
| GET | `/pieces/merges/:mergeId` | 合并详情（含每个字段冲突的双方值） |
| POST | `/pieces/merges/:mergeId/resolve` | 提交冲突字段的保留值 |

创建曲目：

```json
{
  "title": "小提琴协奏曲",
  "composer": "贝多芬",
  "movement": "第二乐章 17-24 小节",
  "keySignature": "D_MAJOR",
  "difficulty": 4,
  "instrument": "小提琴",
  "tags": ["换把", "节奏"],
  "notes": "注意弱起小节的呼吸"
}
```

`keySignature` 使用 24 个大小调枚举或 `UNKNOWN`；`difficulty` 为 1–5 整数，允许为空表示未评级。曲目详情额外返回 `issueCounts`（从关联练习的问题标记聚合）、`hotspots`（严重度 ≥ 4 的困难片段）和 `totalPracticeMs`。

### 合并重复条目

`POST /pieces/:id/merge` 请求体为 `{ "sourcePieceId": "..." }`，服务端在单个数据库事务内：

1. 自动补齐保留曲目为空而来源有值的字段（作曲家、调性、难度、备注）；
2. 取双方问题标签并集（大小写/空白不敏感去重）；
3. 将来源条目的**全部历史练习**外键原子迁移到保留曲目；
4. 来源条目标记为 `MERGED`（不删除，保留审计链路）。

双方都有值且不一致的字段不会被静默选择，而是写入 `piece_merge_conflicts` 作为待处理项，响应示例：

```json
{
  "merge": {
    "id": "…",
    "status": "PENDING",
    "conflicts": [
      { "field": "difficulty", "targetValue": "3", "sourceValue": "4", "status": "PENDING" }
    ]
  }
}
```

通过 `POST /pieces/merges/:mergeId/resolve` 逐项提交保留值（可取目标值、来源值或自定义值）；最后一个冲突解决后合并状态变为 `RESOLVED`。

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
