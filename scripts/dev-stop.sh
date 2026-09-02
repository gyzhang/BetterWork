#!/usr/bin/env bash
# 精确停止 BetterWork 开发实例，只使用 dev-start 写入的 PID，并验证工作目录。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PID_FILE="${BETTERWORK_DEV_PID:-/tmp/betterwork-dev.pid}"

if [[ ! -f "$PID_FILE" ]]; then
  echo "ℹ️  未发现 BetterWork 开发实例"
  exit 0
fi

ROOT_PID="$(tr -d '[:space:]' < "$PID_FILE")"
if [[ ! "$ROOT_PID" =~ ^[0-9]+$ ]] || ! kill -0 "$ROOT_PID" 2>/dev/null; then
  rm -f "$PID_FILE"
  echo "ℹ️  未发现 BetterWork 开发实例"
  exit 0
fi

CWD="$(lsof -a -p "$ROOT_PID" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
if [[ "$CWD" != "$PROJECT_ROOT" ]]; then
  echo "❌ PID 文件不是 BetterWork 进程，已跳过：$ROOT_PID" >&2
  exit 1
fi

echo "🎯 将关闭 BetterWork 开发进程：$ROOT_PID"
CHILDREN="$(pgrep -P "$ROOT_PID" 2>/dev/null || true)"
for child in $CHILDREN; do kill "$child" 2>/dev/null || true; done
kill "$ROOT_PID" 2>/dev/null || true

for _ in 1 2 3 4 5; do
  alive=false
  kill -0 "$ROOT_PID" 2>/dev/null && alive=true
  for child in $CHILDREN; do kill -0 "$child" 2>/dev/null && alive=true; done
  if [[ "$alive" == false ]]; then
    rm -f "$PID_FILE"
    echo "✅ BetterWork 开发实例已关闭"
    exit 0
  fi
  sleep 1
done

for child in $CHILDREN; do kill -9 "$child" 2>/dev/null || true; done
kill -9 "$ROOT_PID" 2>/dev/null || true
rm -f "$PID_FILE"
echo "✅ BetterWork 开发实例已强制关闭"
