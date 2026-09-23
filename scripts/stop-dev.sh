#!/usr/bin/env bash
# ==============================================================================
# Agent Harness 本地开发环境安全关闭脚本 (Linux / macOS Shell)
# ==============================================================================

LOCK_FILE="$HOME/.pg_harness/.lock"


echo "========================================="
echo "  Agent Harness - Local Dev Stop (POSIX) "
echo "========================================="

KILLED=false

if [ -f "$LOCK_FILE" ]; then
    PID=$(grep -o '"pid":[0-9]*' "$LOCK_FILE" | cut -d':' -f2 || true)
    if [ -n "$PID" ]; then
        echo "[i] 正在终结 Harness 实例及其进程组 (PID: $PID)..."
        # 使用负进程组 kill 发送 SIGTERM，随后下发 SIGKILL (符合 POSIX 规范)
        kill -15 -"$PID" 2>/dev/null || kill -15 "$PID" 2>/dev/null || true
        sleep 1
        kill -9 -"$PID" 2>/dev/null || kill -9 "$PID" 2>/dev/null || true
        KILLED=true
    fi
    rm -f "$LOCK_FILE"
    echo "[✓] 单实例锁文件已释放。"
fi

# Port 3210 cleanup (falls back to lock port when available)
CHECK_PORT=3210
if [ -f "$LOCK_FILE" ]; then
    LOCK_PORT=$(grep -o '"port":[0-9]*' "$LOCK_FILE" | cut -d':' -f2 || true)
    if [ -n "$LOCK_PORT" ]; then
        CHECK_PORT=$LOCK_PORT
    fi
fi
if command -v lsof >/dev/null 2>&1; then
    PORT_PID=$(lsof -ti:$CHECK_PORT || true)
    if [ -n "$PORT_PID" ]; then
        echo "[i] Releasing port $CHECK_PORT process ($PORT_PID)..."
        kill -9 $PORT_PID 2>/dev/null || true
        KILLED=true
    fi
fi

if [ "$KILLED" = true ]; then
    echo "[✓] Agent Harness 服务已完全停止，端口与锁已清理！"
else
    echo "[i] 未发现正在运行的 Harness 实例。"
fi
