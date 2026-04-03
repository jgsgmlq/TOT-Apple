#!/usr/bin/env bash
# scripts/mac-studio-setup.sh
# 在 Mac Studio 上执行一次，完成服务器初始化。
# 用法：bash scripts/mac-studio-setup.sh
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_DIR="$PROJECT_ROOT/TOT_backend/server"

echo "=============================="
echo " TOT Mac Studio Setup"
echo " Project: $PROJECT_ROOT"
echo "=============================="

# ── 1. 开启 SSH 远程登录 ──────────────────────────────────────────
echo ""
echo "[ 1/7 ] 开启 SSH Remote Login..."
sudo systemsetup -setremotelogin on
echo "✅ SSH Remote Login 已开启"
echo "   macOS 用户名: $(whoami)"
echo "   SSH 连接格式: ssh $(whoami)@<Tailscale-IP>"

# ── 2. 检查 Node.js ──────────────────────────────────────────────
echo ""
echo "[ 2/7 ] 检查 Node.js 版本..."
if ! command -v node &>/dev/null; then
  echo "❌ Node.js 未安装，请先安装：https://nodejs.org"
  exit 1
fi
echo "✅ Node.js $(node --version) / npm $(npm --version)"

# ── 3. 安装 PM2 ───────────────────────────────────────────────────
echo ""
echo "[ 3/7 ] 安装 PM2..."
npm install -g pm2
echo "✅ PM2 $(pm2 --version) 安装成功"

# ── 4. 安装后端依赖 ───────────────────────────────────────────────
echo ""
echo "[ 4/7 ] 安装后端依赖..."
cd "$SERVER_DIR"
npm install
echo "✅ 依赖安装完成"

# ── 5. 创建日志目录 ───────────────────────────────────────────────
echo ""
echo "[ 5/7 ] 创建日志目录..."
mkdir -p "$SERVER_DIR/logs"
echo "✅ $SERVER_DIR/logs 已创建"

# ── 6. 启动 PM2 并保存进程列表 ────────────────────────────────────
echo ""
echo "[ 6/7 ] 启动 tot-api..."
cd "$SERVER_DIR"
pm2 start ecosystem.config.js --env development
pm2 save
echo "✅ tot-api 启动并已保存"

# ── 7. 配置开机自启 ────────────────────────────────────────────────
echo ""
echo "[ 7/7 ] 配置开机自启..."
echo "⚠️  请复制并执行下面这条命令（需要 sudo）："
echo "---------------------------------------------------"
pm2 startup | grep "sudo"
echo "---------------------------------------------------"
echo "执行完后再运行：pm2 save"

echo ""
echo "=============================="
echo " 初始化完成！"
echo "=============================="
pm2 status
echo ""
echo "📌 下一步：安装 Tailscale"
echo "   1. 下载：https://tailscale.com/download/mac"
echo "   2. 登录后记录你的 100.x.x.x IP"
echo "   3. 把这个 IP 发给所有团队成员"
