#!/usr/bin/env bash
# ==============================================================================
# Agent Harness 后台关闭脚本 (Linux / macOS Shell)
# 用法: ./scripts/stop-bg.sh [port]
# ==============================================================================

PORT=${1:-0}
LOCK_FILE="$HOME/.pg_harness/.lock"

echo "========================================="
echo "  Agent Harness - Background Stop (POSIX) "
echo "========================================="

KILLED=false
TARGET_PORT=$PORT

if [ -f "$LOCK_FILE" ]; then
    PID=$(grep -o '"pid":[0-9]*' "$LOCK_FILE" | cut -d':' -f2 || true)
    LOCK_PORT=$(grep -o '"port":[0-9]*' "$LOCK_FILE" | cut -d':' -f2 || true)
    if [ "$TARGET_PORT" = "0" ] && [ -n "$LOCK_PORT" ]; then
        TARGET_PORT=$LOCK_PORT
    fi
    if [ -n "$PID" ]; then
        if kill -0 "$PID" 2>/dev/null; then
            echo "[i] 正在终结后台 Harness 实例 (PID: $PID)..."
            kill -15 -"$PID" 2>/dev/null || kill -15 "$PID" 2>/dev/null || true
            sleep 1
            kill -9 -"$PID" 2>/dev/null || kill -9 "$PID" 2>/dev/null || true
            KILLED=true
        else
            echo "[i] 锁文件 PID $PID 已不在运行，仅清理锁文件。"
        fi
    fi
    rm -f "$LOCK_FILE"
    echo "[OK] 单实例锁文件已释放。"
fi

if [ "$TARGET_PORT" = "0" ]; then
    TARGET_PORT=3210
fi

if command -v lsof >/dev/null 2>&1; then
    PORT_PID=$(lsof -ti:"$TARGET_PORT" || true)
    if [ -n "$PORT_PID" ]; then
        echo "[i] 正在释放端口 $TARGET_PORT 占用的进程 ($PORT_PID)..."
        kill -9 $PORT_PID 2>/dev/null || true
        KILLED=true
    fi
fi

if [ "$KILLED" = true ]; then
    echo "[OK] 后台 Harness 已停止，端口与锁已清理！"
else
    echo "[i] 未发现正在运行的后台 Harness 实例。"
fi
