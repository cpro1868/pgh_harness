#!/usr/bin/env bash
# ==============================================================================
# Agent Harness 后台启动脚本 (Linux / macOS Shell)
# 用法: ./scripts/start-bg.sh [port]
# ==============================================================================

set -e

PORT=${1:-3210}
LOCK_FILE="$HOME/.pg_harness/.lock"

echo "========================================="
echo "  Agent Harness - Background Start (POSIX)"
echo "========================================="

if ! command -v node >/dev/null 2>&1; then
    echo "错误: 未找到 Node.js，请安装 Node 22+。"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'.' -f1 | sed 's/v//')
if [ "$NODE_VERSION" -lt 22 ]; then
    echo "错误: 当前 Node 版本为 $(node -v)，强制要求 Node.js >= 22。"
    exit 1
fi
echo "[OK] Node.js 版本满足: $(node -v)"

if [ -f "$LOCK_FILE" ]; then
    PID=$(grep -o '"pid":[0-9]*' "$LOCK_FILE" | cut -d':' -f2 || true)
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
        echo "[!] 检测到已有 Harness 实例正在运行 (PID: $PID)。"
        echo "请在浏览器中打开: http://localhost:$PORT"
        exit 0
    else
        echo "[i] 清理失效旧锁..."
        rm -f "$LOCK_FILE"
    fi
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"
ENTRY_FILE="$PROJECT_ROOT/apps/server/src/index.ts"
if [ ! -f "$ENTRY_FILE" ]; then
    echo "错误: 找不到服务入口: $ENTRY_FILE"
    exit 1
fi

LOG_DIR="$HOME/.pg_harness/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/pgh-server.log"

echo "[+] Starting Harness in background on http://127.0.0.1:$PORT ..."
echo "[i] Log file: $LOG_FILE"

nohup node --experimental-strip-types "$ENTRY_FILE" --port "$PORT" >> "$LOG_FILE" 2>&1 &
echo $! > /tmp/pgh-launcher.pid

READY=0
for _ in $(seq 1 30); do
    sleep 0.5
    if curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
        READY=1
        break
    fi
done

if [ "$READY" = "1" ]; then
    echo "[OK] Harness is ready at http://127.0.0.1:$PORT/run-chat.html"
else
    echo "[!] 服务 15s 内未就绪，请查看日志: $LOG_FILE"
    exit 1
fi
