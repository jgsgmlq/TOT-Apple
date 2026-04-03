# WebSocket 实现规格

**版本:** 1.0.0 | **基于:** `docs/specs/04-API-SPEC.md §7` + `docs/specs/05-NOTIFICATION-NUDGE.md`

---

## 当前状态 ⚠️

| 项目 | 当前 | 目标 |
|------|------|------|
| 连接路径 | `ws://host:8080/ws` | ✅ 不变 |
| Token 认证 | ⚠️ 支持 `?token=<JWT>` 解析并写入 `ws.user`，但当前不强制 token（无 token 连接不会收到业务事件） | 可按需要升级为强制 token |
| 广播内容 | ✅ 结构化 type + payload + timestamp | 与 Spec 一致 |
| 角色裁剪 | ✅ 已按 user.role / storeId / employeeId 过滤（`StateSync._shouldReceive`） | 继续保持 |
| 初始推送 | ✅ 仅返回 `init` 握手包 | 与 Spec 一致 |

---

## 连接规格

### 客户端连接

```
ws://localhost:8080/ws?token=<JWT_TOKEN>
```

### 服务端连接处理（index.js）

```javascript
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'mvp-dev-secret-change-in-prod';

wss.on('connection', (ws, req) => {
  // 1. 解析 token
  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token');
  try {
    ws.user = jwt.verify(token, JWT_SECRET);
  } catch {
    ws.user = null;
    ws.close(4001, 'Unauthorized');
    return;
  }

  // 2. 发送初始握手
  ws.send(JSON.stringify({
    type: 'init',
    timestamp: new Date().toISOString()
  }));

  // 3. 心跳（可选，MVP 阶段可省略）
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});
```

---

## 事件类型规格

### 服务端 → 客户端

| type | 触发时机 | payload |
|------|---------|---------|
| `init` | 连接建立时 | `{ timestamp }` |
| `task_dispatched` | 任务下发完成 | `{ taskId, assignmentCount, timestamp }` |
| `assignment_started` | 用户开始任务 | `{ assignmentId, taskId, userId, storeId, timestamp }` |
| `platform_completed` | 平台完成标记 | `{ assignmentId, platform, progress, status, timestamp }` |
| `assignment_completed` | Assignment 全部完成 | `{ assignmentId, taskId, userId, storeId, timestamp }` |
| `nudge_sent` | 催办发出 | `{ taskId, targetType, targetId, severity, timestamp }` |

### 完整消息格式

```json
{
  "type": "assignment_completed",
  "assignmentId": "asgn_abc123",
  "taskId": "task_xyz456",
  "userId": "E001",
  "storeId": "S001",
  "timestamp": "2026-03-24T12:00:00Z"
}
```

---

## 角色裁剪规则

服务端广播时，按接收方用户角色过滤：

```javascript
function shouldReceive(wsUser, eventType, payload) {
  if (!wsUser) return false;
  // central 和 admin 接收所有事件
  if (wsUser.role === 'central' || wsUser.role === 'admin') return true;
  // store_manager 只接收本店事件
  if (wsUser.role === 'store_manager') {
    if (eventType === 'task_dispatched') return true; // 任务下发通知全部人
    return !payload.storeId || payload.storeId === wsUser.storeId;
  }
  // employee 只接收本人事件
  if (wsUser.role === 'employee') {
    return !payload.userId || payload.userId === wsUser.employeeId;
  }
  return false;
}

function broadcast(wss, eventType, payload) {
  const message = JSON.stringify({ type: eventType, ...payload, timestamp: new Date().toISOString() });
  wss.clients.forEach(client => {
    if (client.readyState !== 1) return;
    if (shouldReceive(client.user, eventType, payload)) {
      client.send(message);
    }
  });
}
```

---

## 各路由广播调用点

| 操作 | 广播 type | 调用位置 |
|------|----------|---------|
| POST /api/tasks/:id/dispatch | `task_dispatched` | dispatchService.dispatchTask() |
| POST /api/assignments/:id/start | `assignment_started` | routes/tasks.js |
| POST /api/assignments/:id/platforms/:p/complete | `platform_completed` 或 `assignment_completed` | routes/tasks.js |
| POST /api/tasks/:id/nudge | `nudge_sent` | nudgeService.sendNudge() |

**wss 实例��入方式（推荐单例）：**

```javascript
// index.js
const StateSync = require('./services/stateSync');
// ...
const wss = new WebSocketServer({ server, path: '/ws' });
StateSync.setWss(wss); // 注入全局 wss
```

---

## 前端断线重连策略

见 `docs/frontend/04-SHARED.md`。服务端无需特殊处理，客户端重连后通过 REST 补拉数据即可。

---

## Gap 清单

- [x] `index.js`：连接时解析 JWT token，写入 `ws.user`
- [x] `index.js`：连接时发送 `init` 包（替换旧的全量 events 推送）
- [x] `stateSync.js`：已提供 `broadcast(type, payload)` + `shouldReceive` 过滤
- 业务路由广播点持续补齐（核心任务链路已接入，新增路由需同步接入）
- [ ] （可选）心跳检测：`setInterval` 中 `ws.ping()`，清理断连客户端
