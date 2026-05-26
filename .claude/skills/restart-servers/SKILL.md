---
name: restart-servers
description: 重启 TOT 前后端服务，清除 Vite 缓存
disable-model-invocation: true
---

# Restart Servers

## 步骤

```bash
# 1. 杀旧进程
lsof -ti :3000 | xargs kill -9 2>/dev/null
lsof -ti :8001 | xargs kill -9 2>/dev/null
sleep 1

# 2. 清 Vite 缓存
rm -rf /Users/pipi/tot-apple-review/TOT_frontend/node_modules/.vite 2>/dev/null

# 3. 启后端
node /Users/pipi/tot-apple-review/TOT_backend/server/app.js > /tmp/tot-server.log 2>&1 &
sleep 3
grep "running at" /tmp/tot-server.log && echo "✅ 后端已启动 (3000)"

# 4. 启前端
cd /Users/pipi/tot-apple-review/TOT_frontend && pnpm dev --port 8001 > /tmp/tot-frontend.log 2>&1 &
sleep 4
grep "Local:" /tmp/tot-frontend.log && echo "✅ 前端已启动 (8001)"
```

## 验证

```bash
curl -s --connect-timeout 2 http://127.0.0.1:3000/ > /dev/null && echo "✅ 后端可访问"
curl -s --connect-timeout 2 http://127.0.0.1:8001/ > /dev/null && echo "✅ 前端可访问"
```
