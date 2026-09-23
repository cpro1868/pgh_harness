#!/usr/bin/env bash
# ==============================================================================
# Agent Harness 本地开发环境启动脚本 (Linux / macOS Shell)
# ==============================================================================

set -e

PORT=${1:-3210}

LOCK_FILE="$HOME/.pg_harness/.lock"


echo "========================================="
echo "  Agent Harness - Local Dev Start (POSIX)"
echo "========================================="

# 1. 检查 Node.js 版本 (要求 >= 22)
if ! command -v node >/dev/null 2>&1; then
    echo "错误: 未找到 Node.js，请安装 Node 22+。"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'.' -f1 | sed 's/v//')
if [ "$NODE_VERSION" -lt 22 ]; then
    echo "错误: 当前 Node 版本为 $(node -v)，强制要求 Node.js >= 22。请先升级。"
    exit 1
fi
echo "[✓] Node.js 版本满足: $(node -v)"

# 2. 检查 pnpm
if ! command -v pnpm >/dev/null 2>&1; then
    echo "错误: 未找到 pnpm，请执行: npm install -g pnpm"
    exit 1
fi
echo "[✓] pnpm 已安装: $(pnpm -v)"

# 3. 检查单实例锁
if [ -f "$LOCK_FILE" ]; then
    PID=$(grep -o '"pid":[0-9]*' "$LOCK_FILE" | cut -d':' -f2 || true)
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
        echo "[!] 检测到已有 Harness 实例正在运行 (PID: $PID)。"
        echo "请在浏览器中打开: http://localhost:$PORT"
        echo "如需关闭请执行: ./scripts/stop-dev.sh"
        exit 0
    else
        echo "[i] 清理失效旧锁..."
        rm -f "$LOCK_FILE"
    fi
fi

# 4. 依赖检查 (以脚本位置推导项目根，无视调用时的工作目录)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"
ENTRY_FILE="$PROJECT_ROOT/apps/server/src/index.ts"
if [ ! -f "$ENTRY_FILE" ]; then
    echo "错误: 找不到服务入口: $ENTRY_FILE"
    exit 1
fi

if [ ! -d "node_modules" ]; then
    echo "[i] 正在安装依赖..."
    pnpm install
fi

# 5. 启动开发模式
echo "[+] 正在启动开发服务 (Port: $PORT)..."
if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "http://localhost:$PORT" >/dev/null 2>&1 &
elif command -v open >/dev/null 2>&1; then
    open "http://localhost:$PORT" >/dev/null 2>&1 &
fi

exec node --experimental-strip-types "$ENTRY_FILE" --port "$PORT"

