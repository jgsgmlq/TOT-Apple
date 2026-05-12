#!/usr/bin/env bash
# scripts/deploy.sh
# 在 Mac Studio 上执行，拉最新代码、构建前端、重启后端和 nginx。
# 用法：bash scripts/deploy.sh [branch]
#       默认 branch = dev_joint
set -euo pipefail

# Homebrew 路径（非交互式 SSH 不会自动加载）
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_DIR="$PROJECT_ROOT/TOT_backend/server"
FRONTEND_DIR="$PROJECT_ROOT/TOT_frontend"
BRANCH="${1:-dev_joint}"

echo "=============================="
echo " TOT Deploy → $BRANCH"
echo "=============================="

# ── 1. 拉取最新代码 ───────────────────────────────────────────────
echo ""
echo "[ 1/5 ] git pull origin $BRANCH..."
cd "$PROJECT_ROOT"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "❌ 工作区有未提交变更，请先提交或暂存后再部署。"
  exit 1
fi
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$CURRENT_BRANCH" != "$BRANCH" ]]; then
  echo "切换分支: $CURRENT_BRANCH -> $BRANCH"
  git checkout "$BRANCH"
fi
git pull origin "$BRANCH"

# ── 2. 安装/更新后端依赖 ──────────────────────────────────────────
echo ""
echo "[ 2/5 ] npm install (backend)..."
cd "$SERVER_DIR"
npm install

# ── 3. 安装/更新前端依赖并构建 ────────────────────────────────────
echo ""
echo "[ 3/6 ] pnpm install + build (frontend)..."
cd "$FRONTEND_DIR"
pnpm install
pnpm run build

# ── 4. 同步前端文件到 nginx web root ───────────────────────────────
echo ""
echo "[ 4/6 ] sync dist → /opt/homebrew/var/www/tot..."
sudo rsync -a --delete "$FRONTEND_DIR/dist/" /opt/homebrew/var/www/tot/

# ── 5. 零停机重载 PM2 ─────────────────────────────────────────────
echo ""
echo "[ 5/6 ] pm2 reload..."
pm2 reload ecosystem.config.js --env development

# ── 6. 重载 nginx ─────────────────────────────────────────────────
echo ""
echo "[ 6/6 ] nginx reload..."
sudo nginx -s reload 2>/dev/null || sudo nginx 2>/dev/null || echo "⚠️  nginx reload 失败，请手动执行 sudo nginx -s reload"

echo ""
pm2 status tot-api
echo "✅ Deploy 完成 ($(date '+%Y-%m-%d %H:%M:%S'))"
