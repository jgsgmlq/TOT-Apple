#!/usr/bin/env bash
# scripts/deploy.sh
# 在 Mac Studio 上执行，拉最新代码并重启后端服务。
# 用法：bash scripts/deploy.sh [branch]
#       默认 branch = dev_joint
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_DIR="$PROJECT_ROOT/TOT_backend/server"
BRANCH="${1:-dev_joint}"

echo "=============================="
echo " TOT Deploy → $BRANCH"
echo "=============================="

# ── 1. 拉取最新代码 ───────────────────────────────────────────────
echo ""
echo "[ 1/3 ] git pull origin $BRANCH..."
cd "$PROJECT_ROOT"
git pull origin "$BRANCH"

# ── 2. 安装/更新依赖（仅当 package-lock.json 有变更时才慢）────────
echo ""
echo "[ 2/3 ] npm install..."
cd "$SERVER_DIR"
npm install

# ── 3. 零停机重载 PM2 ─────────────────────────────────────────────
echo ""
echo "[ 3/3 ] pm2 reload..."
pm2 reload ecosystem.config.js --env development

echo ""
pm2 status tot-api
echo "✅ Deploy 完成 ($(date '+%Y-%m-%d %H:%M:%S'))"
