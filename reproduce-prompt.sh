#!/usr/bin/env bash
# Seeds a deterministic repertoire fixture through the real API, then records the merge flow in the browser.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PROJECT_DIR="$(basename "$(dirname "$ROOT")")"
if [[ "$PROJECT_DIR" == *-B ]]; then
  VARIANT="B"
  STATE_DIR="${STATE_DIR:-$HOME/.cache/code10-14-b}"
else
  VARIANT="A"
  STATE_DIR="${STATE_DIR:-$HOME/.cache/code10-14-a}"
fi
export STATE_DIR
export API_BASE_URL="${API_BASE_URL:-$(cat "$STATE_DIR/api-url")}"
export VARIANT

echo "[repro] variant=$VARIANT api=$API_BASE_URL"

node --input-type=module - <<'NODE'
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const api = process.env.API_BASE_URL;
const stateDir = process.env.STATE_DIR;
const variant = process.env.VARIANT;
const password = `Code10-14-${variant}-Repro-2026!`;
const email = `code10-14-${variant.toLowerCase()}-${Date.now()}@code4.local`;

async function call(method, route, body, token) {
  const response = await fetch(`${api}${route}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!response.ok) {
    const error = new Error(`${method} ${route} -> ${response.status} ${text.slice(0, 300)}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

const auth = await call("POST", "/api/v1/auth/register", {
  email,
  password,
  displayName: `曲目资料库 ${variant}`,
});
const token = auth.accessToken;
console.log(`[repro] 演示账号：${email}`);

const targetPayload = variant === "B"
  ? {
      title: "月光奏鸣曲",
      composer: "贝多芬",
      key: "C#min",
      difficulty: 4,
      tags: ["换把", "音准"],
      aliases: ["月光"],
      notes: "保留条目：注意第三乐章连贯性。",
      allowDuplicate: false,
    }
  : {
      title: "月光奏鸣曲",
      composer: "贝多芬",
      movement: "第一乐章",
      keySignature: "C_SHARP_MINOR",
      difficulty: 4,
      instrument: "钢琴",
      tags: ["换把", "音准"],
      notes: "保留条目：注意第三乐章连贯性。",
    };

const sourcePayload = variant === "B"
  ? {
      title: "月光奏鸣曲",
      composer: "贝多芬",
      key: "C",
      difficulty: 2,
      tags: ["节奏", "力度"],
      aliases: ["月光旧条目"],
      notes: "来源条目：慢速分段练习记录。",
      allowDuplicate: true,
    }
  : {
      title: "月光奏鸣曲",
      composer: "贝多芬",
      movement: "旧条目",
      keySignature: "C_MAJOR",
      difficulty: 2,
      instrument: "钢琴",
      tags: ["节奏", "力度"],
      notes: "来源条目：慢速分段练习记录。",
    };

const target = (await call("POST", "/api/v1/pieces", targetPayload, token)).piece;
const source = (await call("POST", "/api/v1/pieces", sourcePayload, token)).piece;
console.log(`[repro] 保留条目=${target.id}`);
console.log(`[repro] 重复来源=${source.id}`);

const session = (await call("POST", "/api/v1/sessions", {
  title: "月光奏鸣曲来源练习",
  instrument: "钢琴",
  focus: "慢速确认转指与节拍",
  startedAt: new Date(Date.now() - 75 * 60 * 1000).toISOString(),
  actualDurationMs: 28 * 60 * 1000,
}, token)).session;

const pgPort = fs.readFileSync(path.join(stateDir, "pg-port"), "utf8").trim();
execFileSync("psql", [
  "-h", "127.0.0.1",
  "-p", pgPort,
  "-U", "postgres",
  "-d", "practice",
  "-c", `UPDATE practice_sessions SET status = 'COMPLETED' WHERE id = '${session.id}';`,
], { encoding: "utf8" });

if (variant === "B") {
  await call("PUT", `/api/v1/sessions/${session.id}/piece`, { pieceId: source.id }, token);
} else {
  await call("POST", `/api/v1/pieces/${source.id}/sessions`, { sessionId: session.id }, token);
}
console.log("[repro] 已把 1 条历史练习归入重复来源条目");

fs.writeFileSync(path.join(stateDir, "repro-user.json"), JSON.stringify({
  email,
  password,
  variant,
  targetId: target.id,
  sourceId: source.id,
  targetTitle: targetPayload.title,
  sourceTitle: sourcePayload.title,
  targetTag: "换把",
  sourceTag: "节奏",
}, null, 2));

const pieces = await call("GET", "/api/v1/pieces?status=ACTIVE&limit=20", undefined, token);
const linked = pieces.data.find((piece) => piece.id === source.id);
const practiceCount = linked?._count?.practiceSessions ?? linked?._count?.sessions ?? linked?.practiceCount ?? 0;
if (practiceCount !== 1) throw new Error(`来源曲目历史练习统计异常：${practiceCount}`);

console.log("[repro] 准备完成：浏览器将展示资料库并执行原子合并与冲突处理");
NODE
