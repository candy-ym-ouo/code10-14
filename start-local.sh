#!/usr/bin/env bash
# Recording-only launcher for the isolated PostgreSQL, Redis, MinIO, API and Web stack.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PROJECT_DIR="$(basename "$(dirname "$ROOT")")"
PROJECT_KEY="$(printf '%s' "$PROJECT_DIR" | tr '[:upper:]' '[:lower:]')"
if [[ "$PROJECT_KEY" == *-b ]]; then
  STATE_KEY="${PROJECT_KEY}"
else
  STATE_KEY="${PROJECT_KEY}-a"
fi
STATE_DIR="${STATE_DIR:-$HOME/.cache/${STATE_KEY}}"
LOG_DIR="$STATE_DIR/logs"
mkdir -p "$STATE_DIR" "$LOG_DIR" "$STATE_DIR/uploads"
rm -f "$STATE_DIR/api-url" "$STATE_DIR/web-url"

pick_port() {
  node --input-type=module -e '
import net from "node:net";
const server = net.createServer();
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  console.log(typeof address === "object" && address ? address.port : "");
  server.close();
});
'
}

PG_PORT="${PG_PORT:-$(pick_port)}"
REDIS_PORT="${REDIS_PORT:-$(pick_port)}"
MINIO_PORT="${MINIO_PORT:-$(pick_port)}"
MINIO_CONSOLE_PORT="${MINIO_CONSOLE_PORT:-$(pick_port)}"
API_PORT="${API_PORT:-$(pick_port)}"
WEB_PORT="${WEB_PORT:-$(pick_port)}"
DB_NAME="${DB_NAME:-practice}"
S3_BUCKET="${S3_BUCKET:-practice-audio}"
S3_ACCESS_KEY="${S3_ACCESS_KEY:-minioadmin}"
S3_SECRET_KEY="${S3_SECRET_KEY:-minioadmin}"

API_URL="http://127.0.0.1:${API_PORT}"
WEB_URL="http://127.0.0.1:${WEB_PORT}"
export LC_ALL=C LANG=C TZ=Asia/Shanghai
export NODE_ENV=development
export API_PORT
export DATABASE_URL="postgresql://postgres@127.0.0.1:${PG_PORT}/${DB_NAME}?schema=public"
export REDIS_URL="redis://127.0.0.1:${REDIS_PORT}"
export JWT_ACCESS_SECRET="code10-local-access-secret-0123456789abcdef"
export REFRESH_TOKEN_PEPPER="code10-local-refresh-pepper-0123456789abcdef"
export SESSION_SECRET="$REFRESH_TOKEN_PEPPER"
export S3_ENDPOINT="http://127.0.0.1:${MINIO_PORT}"
export S3_PUBLIC_ENDPOINT="$S3_ENDPOINT"
export S3_REGION="us-east-1"
export S3_BUCKET S3_ACCESS_KEY S3_SECRET_KEY
export S3_FORCE_PATH_STYLE=true
export PUBLIC_API_ORIGIN="$API_URL"
export PUBLIC_APP_URL="$WEB_URL"
export WEB_ORIGIN="$WEB_URL,http://localhost:${WEB_PORT}"
export API_PROXY_TARGET="$API_URL"
export APP_HOST="127.0.0.1"
export APP_PORT="$API_PORT"
export UPLOAD_DIR="$STATE_DIR/uploads"
export UPLOAD_URL_TTL_SECONDS=900
export PLAYBACK_URL_TTL_SECONDS=300
export MAX_MEDIA_SIZE_MB=200
export MAX_MEDIA_PER_SESSION=20
export MAX_SESSION_TOTAL_MB=1024
export LOG_LEVEL=warn

PIDS=()
kill_tree() {
  local pid="$1" child
  [ -n "$pid" ] || return 0
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do kill_tree "$child"; done
  kill -TERM "$pid" >/dev/null 2>&1 || true
}
cleanup() {
  trap - EXIT INT TERM
  for pid in "${PIDS[@]:-}"; do kill_tree "$pid"; done
  sleep 0.4
  for pid in "${PIDS[@]:-}"; do kill -9 "$pid" >/dev/null 2>&1 || true; done
  if [ -f "$STATE_DIR/pg/PG_VERSION" ]; then
    pg_ctl -D "$STATE_DIR/pg" -m fast stop >/dev/null 2>&1 || true
  fi
  rm -f "$STATE_DIR/api-url" "$STATE_DIR/web-url"
}
trap cleanup EXIT INT TERM

if [ "${SKIP_INSTALL:-0}" != "1" ]; then
  npm install --no-audit --no-fund
fi
npm run build -w @practice/contracts --silent

if [ ! -f "$STATE_DIR/pg/PG_VERSION" ]; then
  initdb -D "$STATE_DIR/pg" -U postgres --auth=trust --locale=C --encoding=UTF8 >"$LOG_DIR/initdb.log" 2>&1
fi
if pg_ctl -D "$STATE_DIR/pg" status >/dev/null 2>&1; then
  pg_ctl -D "$STATE_DIR/pg" -m fast stop >/dev/null 2>&1
fi
pg_ctl -D "$STATE_DIR/pg" -o "-p ${PG_PORT} -k ${STATE_DIR} -c listen_addresses=127.0.0.1" -l "$LOG_DIR/postgres.log" start >/dev/null
for _ in $(seq 1 80); do
  pg_isready -h 127.0.0.1 -p "$PG_PORT" -q && break
  sleep 0.25
done
createdb -h 127.0.0.1 -p "$PG_PORT" -U postgres "$DB_NAME" 2>/dev/null || true

redis-server --port "$REDIS_PORT" --bind 127.0.0.1 --save '' --appendonly no --dir "$STATE_DIR" >"$LOG_DIR/redis.log" 2>&1 &
PIDS+=($!)
for _ in $(seq 1 80); do
  redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1 && break
  sleep 0.25
done

MINIO_ROOT_USER="$S3_ACCESS_KEY" MINIO_ROOT_PASSWORD="$S3_SECRET_KEY" \
  minio server "$STATE_DIR/minio" --address "127.0.0.1:${MINIO_PORT}" --console-address "127.0.0.1:${MINIO_CONSOLE_PORT}" \
  >"$LOG_DIR/minio.log" 2>&1 &
PIDS+=($!)
for _ in $(seq 1 120); do
  curl -fsS "http://127.0.0.1:${MINIO_PORT}/minio/health/live" >/dev/null 2>&1 && break
  sleep 0.25
done
curl -fsS "http://127.0.0.1:${MINIO_PORT}/minio/health/live" >/dev/null 2>&1

node --input-type=module -e '
import { S3Client, CreateBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY },
});
try {
  await client.send(new HeadBucketCommand({ Bucket: process.env.S3_BUCKET }));
} catch {
  await client.send(new CreateBucketCommand({ Bucket: process.env.S3_BUCKET }));
}
' >/dev/null

node_modules/.bin/prisma generate --schema apps/api/prisma/schema.prisma >"$LOG_DIR/prisma-generate.log" 2>&1
node_modules/.bin/prisma migrate deploy --schema apps/api/prisma/schema.prisma >"$LOG_DIR/migrate.log" 2>&1

node_modules/.bin/tsx apps/api/src/server.ts >"$LOG_DIR/api.log" 2>&1 &
PIDS+=($!)
(cd apps/web && ../../node_modules/.bin/vite --config vite.record.config.mjs --host 127.0.0.1 --port "$WEB_PORT" --strictPort) >"$LOG_DIR/web.log" 2>&1 &
PIDS+=($!)

api_ready=0
for _ in $(seq 1 240); do
  if curl -fsS "$API_URL/health/ready" >/dev/null 2>&1; then
    api_ready=1
    break
  fi
  sleep 0.25
done
if [ "$api_ready" != "1" ]; then
  tail -n 80 "$LOG_DIR/api.log" >&2 || true
  exit 1
fi

web_ready=0
for _ in $(seq 1 240); do
  if curl -fsS -o /dev/null "$WEB_URL/" 2>/dev/null; then
    web_ready=1
    break
  fi
  sleep 0.25
done
if [ "$web_ready" != "1" ]; then
  tail -n 80 "$LOG_DIR/web.log" >&2 || true
  exit 1
fi

printf '%s\n' "$API_URL" >"$STATE_DIR/api-url"
printf '%s\n' "$WEB_URL" >"$STATE_DIR/web-url"
printf '%s\n' "$PG_PORT" >"$STATE_DIR/pg-port"
echo "[start-local] api=$API_URL web=$WEB_URL state=$STATE_DIR"
wait
