# 快速启动指南

**文档版本:** 1.1.0
**最后更新:** 2026-03-24
**适用对象:** 开发者、测试、部署人员

---

## 1. 环境准备

### 1.1 系统要求

| 项目 | 要求 | 验证命令 |
|------|------|--------|
| **Node.js** | v18+ | `node --version` |
| **npm** | v9+ | `npm --version` |
| **OS** | macOS / Linux / Windows | - |

### 1.2 依赖检查

```bash
# 检查 Node.js 版本
node -v  # 应该输出 v18.xx.x 以上

# 检查 npm 版本
npm -v   # 应该输出 9.xx.x 以上
```

---

## 2. 启动后端服务

### 2.1 第一次启动（包含依赖安装）

```bash
# 进入服务器目录
cd TOT_backend/server

# 安装依赖
npm install

# 启动服务
npm run dev
```

**预期输出:**

```
[auth] WARNING: JWT_SECRET not set, using default dev secret. DO NOT use in production.
MVP LAN server running at http://0.0.0.0:3000
  Local:   http://localhost:3000
  LAN:     http://192.168.x.x:3000 (use from other devices)
  WS:      ws://localhost:3000/ws  or  ws://192.168.x.x:3000/ws (push updates)
```

### 2.2 验证服务已启动

```bash
# 在新终端窗口中执行
curl http://localhost:3000/api/health

# 预期响应
{"ok":true,"service":"mvp-lan-api"}
```

### 2.3 后续启动（已安装依赖）

```bash
cd TOT_backend/server
npm run dev
```

---

## 3. 访问前端应用

### 3.1 打开浏览器

| 角色 | URL | 用户名 | 密码 |
|------|-----|--------|------|
| **总部** | http://localhost:3000/front-end/central.html | central | Train2026! |
| **店长** | http://localhost:3000/front-end/store.html | store_S001 | Train2026! |
| **员工** | http://localhost:3000/front-end/employee.html | emp_E002 | Train2026! |

> **注意:** 员工用户名格式为 `emp_E00X`（如 `emp_E002`～`emp_E006`）。`emp_E001` 是店长账号，不用于员工端登录。

### 3.2 登录

1. 在各界面输入对应的用户名和密码
2. 点击"登录"按钮
3. 登录成功后进入对应的仪表板

---

## 4. 完整的交互流程示例

### 4.1 场景：总部创建并下发培训任务

**第一步：总部端创建任务**
1. 访问 http://localhost:3000/front-end/central.html
2. 用户名: `central`, 密码: `Train2026!`
3. 在"创建任务"区域填入：
   - 任务名称：Q1新品培训
   - 描述：新品上市全员培训项目
   - 目标角色：两者（店长和员工）
   - 门店范围：全部
   - 截止日期：2026-03-20
4. 点击"发布任务"

**第二步：总部端下发任务**
1. 在"任务列表"中找到刚创建的任务
2. 点击"下发任务"按钮
3. 系统自动向 250 名学员分配任务

**第三步：店长端查看任务**
1. 访问 http://localhost:3000/front-end/store.html
2. 用户名: `store_S001`, 密码: `Train2026!`
3. 进入"我的任务"页面
4. 应该看到刚分配的 Q1新品培训 任务（分配给本店6名员工）

**第四步：员工端更新进度**
1. 访问 http://localhost:3000/front-end/employee.html
2. 用户名: `emp_E002`, 密码: `Train2026!`
3. 进入"我的任务"页面
4. 找到 Q1新品培训 任务
5. 拖动进度条到 50%
6. 在反馈框输入："模块1和2已完成"
7. 点击"提交进度"

**第五步：总部端验证汇总**
1. 回到总部 central.html
2. 进入"任务监控"或"任务汇总"
3. 应该看到进度已更新（250人中1人完成了部分平台）

---

## 5. 常用测试账户

### 5.1 总部端
```
用户名: central
密码: Train2026!
角色: 总部运营
权限: 创建下发任务、查看全公司汇总
```

### 5.2 店长端（4 个示例）
```
用户名: store_S001
密码: Train2026!

用户名: store_S002
密码: Train2026!

用户名: store_S003
密码: Train2026!

用户名: store_S004
密码: Train2026!
```

### 5.3 员工端（5 个示例）
> 注意：`emp_E001` 是店长账号，员工从 `emp_E002` 开始
```
用户名: emp_E002
密码: Train2026!

用户名: emp_E003
密码: Train2026!

用户名: emp_E004
密码: Train2026!

用户名: emp_E005
密码: Train2026!

用户名: emp_E006
密码: Train2026!
```

---

## 6. 命令行快速测试

### 6.1 使用 curl 测试 API

**登录并获取 Token:**
```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"central","password":"Train2026!"}' | \
  grep -o '"token":"[^"]*' | cut -d'"' -f4)

echo "Token: $TOKEN"
```

**创建任务:**
```bash
curl -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "title":"Q1新品培训",
    "description":"新品上市全员培训",
    "targetRole":"both",
    "storeScope":"all",
    "ddlAt":"2026-03-30T18:00:00Z",
    "platforms":["mypal","smartsell","ai_demo","live_broadcast"]
  }' | jq '.'
```

**下发任务:**
```bash
# 将 <task-id> 替换为上面返回的 id
TASK_ID="<task-id>"

curl -X POST http://localhost:3000/api/tasks/$TASK_ID/dispatch \
  -H "Authorization: Bearer $TOKEN" | jq '.'
```

**查询任务汇总:**
```bash
curl -X GET http://localhost:3000/api/tasks/$TASK_ID/summary \
  -H "Authorization: Bearer $TOKEN" | jq '.'
```

---

## 7. 调试技巧

### 7.1 查看服务器日志
```bash
# 服务器日志位于终端输出
# 常见日志信息：
# - "Error retrieving task summary: ..." → 查询汇总失败
# - "Database query error" → 数据库问题
```

### 7.2 清空数据库
```bash
# 重置数据库（删除 database.db）
cd TOT_backend/server
rm -f database.db database.db-shm database.db-wal

# 重启服务，系统会自动重建数据库和初始数据
npm run dev
```

### 7.3 检查 WebSocket 连接
```bash
# 在浏览器控制台中执行
// 创建 WebSocket 连接
const ws = new WebSocket('ws://localhost:3000/ws');

ws.onopen = () => {
  console.log('✓ WebSocket 连接成功');
};

ws.onmessage = (event) => {
  console.log('📨 收到消息:', JSON.parse(event.data));
};

ws.onerror = (error) => {
  console.error('❌ WebSocket 错误:', error);
};
```

---

## 8. 故障排查

### 8.1 端口被占用
**错误信息:**
```
Error: listen EADDRINUSE: address already in use 0.0.0.0:3000
```

**解决方案:**
```bash
# 查找占用 3000 的进程
lsof -i :3000

# 杀死进程（macOS）
kill -9 <PID>

# 或改用其他端口
PORT=3001 npm run dev
```

### 8.2 连接数据库失败
**错误信息:**
```
Error: Cannot open database file
```

**解决方案:**
```bash
# 检查数据库文件权限
ls -la server/database.db*

# 确保有读写权限
chmod 644 server/database.db

# 如果问题持续，删除并重建
rm -f server/database.db*
npm run dev
```

### 8.3 JWT Token 过期
**错误信息:**
```
{"error":"Unauthorized"}
```

**解决方案:**
1. 重新登录获取新 token
2. 使用新 token 重新发送请求
3. Token 有效期为 7 天

### 8.4 CORS 错误
**错误信息:**
```
Access to XMLHttpRequest blocked by CORS policy
```

**解决方案:**
- 服务器已启用 CORS，此错误不应出现
- 检查浏览器是否使用了正确的 http:// 协议（非 https）

---

## 9. 性能基准测试

### 9.1 单个操作性能
```bash
# 创建任务（应在 10ms 内）
time curl -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"title":"Test","targetRole":"both","storeScope":"all","ddlAt":"2026-04-01T00:00:00Z","platforms":["mypal"]}'

# 下发任务 250 人（应在 50ms 内）
time curl -X POST http://localhost:3000/api/tasks/$TASK_ID/dispatch \
  -H "Authorization: Bearer $TOKEN"

# 查询汇总（应在 20ms 内）
time curl -X GET http://localhost:3000/api/tasks/$TASK_ID/summary \
  -H "Authorization: Bearer $TOKEN"
```

### 9.2 并发测试
```bash
# 使用 Apache Bench 测试并发性能
ab -n 100 -c 10 http://localhost:3000/api/health

# 结果解读：
# 100 requests in X.xxx seconds
# 时间越短越好
```

---

## 10. 下一步

✅ 后端启动完成
✅ 前端集成完成（Phase 2a–2d）
✅ 三个角色（总部/店长/员工）端到端测试通过

**推荐阅读:**
- [ARCHITECTURE.md](../backend/ARCHITECTURE.md) - 理解系统架构
- [04-API-SPEC.md](../specs/04-API-SPEC.md) - 详细的 API 接口

---

**常见问题:**

**Q: 怎么重置所有数据？**
A: `rm -f server/database.db*` 然后重启服务

**Q: 如何修改端口？**
A: `PORT=3001 npm run dev`

**Q: 能在局域网其他设备上访问吗？**
A: 可以，使用输出中的 LAN 地址，如 `http://192.168.x.x:3000`

**Q: JWT_SECRET 警告可以忽略吗？**
A: 开发环境可忽略，生产环境需要设置 `JWT_SECRET=<your-secret>`

---

**维护:** Backend Team
**最后更新:** 2026-03-24

