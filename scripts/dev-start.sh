#!/usr/bin/env bash
# 启动 BetterWork Electron 开发模式。
# 流程：关闭本项目旧实例 → 后台启动 npm run dev → 写入日志和 PID。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="${BETTERWORK_DEV_LOG:-/tmp/betterwork-dev.log}"
PID_FILE="${BETTERWORK_DEV_PID:-/tmp/betterwork-dev.pid}"

if [[ ! -f "$PROJECT_ROOT/package.json" ]]; then
  echo "❌ 未找到 BetterWork 项目根目录：$PROJECT_ROOT" >&2
  exit 1
fi

echo "🛑 关闭 BetterWork 旧开发实例"
bash "$SCRIPT_DIR/dev-stop.sh"

echo "🚀 启动 BetterWork 开发模式"
echo "   工作目录：$PROJECT_ROOT"
echo "   日志文件：$LOG_FILE"

: > "$LOG_FILE"
(
  cd "$PROJECT_ROOT"
  exec nohup npm run dev </dev/null
) >> "$LOG_FILE" 2>&1 &
DEV_PID=$!
printf '%s\n' "$DEV_PID" > "$PID_FILE"

# electron-vite 启动可能需要几秒；只验证父进程没有立即退出。
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if ! kill -0 "$DEV_PID" 2>/dev/null; then
    rm -f "$PID_FILE"
    echo "❌ BetterWork 开发模式启动失败，最近日志：" >&2
    tail -n 80 "$LOG_FILE" >&2 || true
    exit 1
  fi
  sleep 1
done

echo "✅ BetterWork 开发模式已启动（pid ${DEV_PID}）"
echo "   查看日志：tail -f $LOG_FILE"
