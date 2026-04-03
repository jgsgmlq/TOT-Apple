# 前端公共模块实现指南

**版本:** 1.0.0 | **基于:** `docs/specs/04-API-SPEC.md` + `docs/specs/08-PERMISSION-MODEL.md`
**图例:** ✅ 已实现并符合 Spec | ⚠️ 部分实现 / 需修改 | ❌ 未实现

---

## 文件结构

```
front-end/js/
  auth.js       ← 认证、token 管理（✅ 基本完成，小修）
  api.js        ← HTTP 请求封装（⚠️ 旧事件总线模型，需重写）
  ws.js         ← WebSocket 客户端（❌ 不存在，需新建）
  crossTab.js   ← 多标签同步（⚠️ 旧模型，视需要保留或重写）
```

---

## 1. auth.js ✅（小修）

**文件：** `front-end/js/auth.js`

**当前状态：** 基本完整。已实现：
- `getToken()` / `saveAuth()` / `clearAuth()`
- `isTokenValid()`（含 30s 缓冲）
- `requireRole()`（无效 token 或角色不符时跳转 login.html）
- `authHeaders()`（返回 Bearer token + Content-Type）
- `logout()`

**已暴露为 `window.Auth`，其他 JS 文件可直接调用。**

### 小差异

- `requireRole` 当前允许 `admin` 角色通过任意 role 检查，符合需求
- 缺少角色常量定义（可选）

### Gap 清单

- [ ] `requireRole` 可增加 `store_manager` 对 `central` 资源的拦截（现在只跳 login，不区分 403）
- [ ] 可暴露 `Auth.role` 快捷 getter

---

## 2. api.js ⚠️（需重写）

**文件：** `front-end/js/api.js`

**当前状态：** 使用旧事件总线模型（`/api/state`、`/api/events`），不适用于新 REST API。

### 目标：重写为统一 HTTP 请求封装

```javascript
(function () {
  const BASE = typeof location !== 'undefined' ? location.origin : '';

  // 统一 fetch 封装：自动注入 token，统一错误处理
  async function request(method, path, body) {
    const headers = window.Auth ? window.Auth.authHeaders() : { 'Content-Type': 'application/json' };
    const opts = { method, headers };
    if (body !== undefined) opts.body = JSON.stringify(body);

    const res = await fetch(BASE + path, opts);

    if (res.status === 401) {
      window.Auth && window.Auth.logout();
      throw { status: 401, errorCode: 'AUTH_002', message: 'Token 过期，请重新登录' };
    }

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw { status: res.status, errorCode: data.errorCode, message: data.error || '请求失败' };
    }

    return data;
  }

  // ── 认证 ──
  const login = (username, password) => request('POST', '/api/login', { username, password });
  const getMe = () => request('GET', '/api/me');

  // ── 任务 ──
  const getTasks = (params = {}) => request('GET', '/api/tasks?' + new URLSearchParams(params));
  const getTask = (id) => request('GET', `/api/tasks/${id}`);
  const createTask = (body) => request('POST', '/api/tasks', body);
  const dispatchTask = (id) => request('POST', `/api/tasks/${id}/dispatch`, {});
  const getTaskSummary = (id) => request('GET', `/api/tasks/${id}/summary`);
  const nudge = (taskId, body) => request('POST', `/api/tasks/${taskId}/nudge`, body);

  // ── Assignment ──
  const getAssignments = (params = {}) => request('GET', '/api/assignments?' + new URLSearchParams(params));
  const getAssignment = (id) => request('GET', `/api/assignments/${id}`);
  const startAssignment = (id) => request('POST', `/api/assignments/${id}/start`, {});
  const completePlatform = (assignmentId, platform) =>
    request('POST', `/api/assignments/${assignmentId}/platforms/${platform}/complete`, {});

  // ── 通知 ──
  const getNotifications = (params = {}) => request('GET', '/api/notifications?' + new URLSearchParams(params));
  const markNotificationRead = (eventId, source) =>
    request('POST', `/api/notifications/${eventId}/read`, { source });

  // ── 店长监管 ──
  const getStoreProgress = (taskId) => request('GET', `/api/store/tasks/${taskId}/progress`);

  // ── 基础数据 ──
  const getStores = () => request('GET', '/api/stores');
  const getStoreEmployees = (storeId) => request('GET', `/api/stores/${storeId}/employees`);
  const getEmployee = (employeeId) => request('GET', `/api/employees/${employeeId}`);

  window.API = {
    login, getMe,
    getTasks, getTask, createTask, dispatchTask, getTaskSummary, nudge,
    getAssignments, getAssignment, startAssignment, completePlatform,
    getNotifications, markNotificationRead,
    getStoreProgress,
    getStores, getStoreEmployees, getEmployee
  };
})();
```

### Gap 清单

- [ ] 完整替换 `api.js` 为上方实现
- [ ] 确保 auth.js 在 api.js 之前加载（HTML 中 script 顺序：auth.js → api.js → ws.js → 页面 JS）

---

## 3. ws.js ❌（新建）

**文件：** `front-end/js/ws.js`（待创建）

**职责：** 维护 WebSocket 连接，自动重连，将收到的事件分发给订阅者。

### 目标实现

```javascript
(function () {
  const RECONNECT_DELAY = 3000;  // 断线后 3 秒重连
  let ws = null;
  let reconnectTimer = null;
  const handlers = {};  // { eventType: [callback, ...] }

  function getWsUrl() {
    const token = window.Auth ? window.Auth.getToken() : '';
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws?token=${token}`;
  }

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    ws = new WebSocket(getWsUrl());

    ws.onopen = () => {
      clearTimeout(reconnectTimer);
      console.log('[WS] connected');
      dispatch('_connected', {});
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        dispatch(msg.type, msg);
      } catch (err) {
        console.warn('[WS] parse error', err);
      }
    };

    ws.onclose = (e) => {
      // 4001 = 服务端主动拒绝（token 无效），不重连，直接跳转登录
      if (e.code === 4001) {
        console.warn('[WS] auth rejected, redirecting to login');
        window.location.href = 'login.html';
        return;
      }
      console.warn('[WS] disconnected, retrying in 3s...');
      dispatch('_disconnected', {});
      reconnectTimer = setTimeout(connect, RECONNECT_DELAY);
    };

    ws.onerror = () => { ws.close(); };
  }

  function dispatch(type, payload) {
    (handlers[type] || []).forEach(fn => { try { fn(payload); } catch (e) { console.error(e); } });
    (handlers['*'] || []).forEach(fn => { try { fn(payload); } catch (e) { console.error(e); } });
  }

  // 订阅事件（type 可为 '*' 订阅所有）
  function on(type, callback) {
    if (!handlers[type]) handlers[type] = [];
    handlers[type].push(callback);
  }

  // 取消订阅
  function off(type, callback) {
    if (!handlers[type]) return;
    handlers[type] = handlers[type].filter(fn => fn !== callback);
  }

  // 断线重连后补拉数据（见 05-NOTIFICATION-NUDGE.md）
  on('_connected', async () => {
    if (!window.API) return;
    try {
      // 仅在重连时（非首次连接）补拉
      if (WS._reconnectCount > 0) {
        await window.API.getNotifications({ unread: true });
        await window.API.getAssignments();
      }
      WS._reconnectCount++;
    } catch (e) {
      console.warn('[WS] re-fetch failed', e);
    }
  });

  const WS = { connect, on, off, _reconnectCount: 0 };
  window.WS = WS;
})();
```

### 各页面使用示例

```javascript
// 页面初始化时
WS.connect();

// 订阅事件
WS.on('task_dispatched', (msg) => {
  console.log('新任务下发', msg.taskId, '共', msg.assignmentCount, '人');
  refreshTaskList();
});

WS.on('nudge_sent', (msg) => {
  showNotification('你收到一条催办通知');
  refreshNotificationBell();
});
```

### Gap 清单

- [ ] 创建 `front-end/js/ws.js`，内容如上
- [ ] 每个 HTML 页面加载顺序：`auth.js → api.js → ws.js → 页面脚本`

---

## 4. crossTab.js ⚠️（可选保留）

**文件：** `front-end/js/crossTab.js`

**当前功能：** 基于 BroadcastChannel 在多标签页之间同步状态。

**MVP 阶段：** 不强制实现，WebSocket 连接已能保证实时性。如多标签场景需要，可保留现有实现不变。

---

## 公共 HTML 头部模板

所有页面 `<head>` 中统一引入顺序：

```html
<!-- 认证（必须第一个）-->
<script src="js/auth.js"></script>
<!-- API 封装 -->
<script src="js/api.js"></script>
<!-- WebSocket 客户端 -->
<script src="js/ws.js"></script>
```

页面脚本在 `<body>` 末尾或 DOMContentLoaded 中执行：

```javascript
document.addEventListener('DOMContentLoaded', () => {
  Auth.requireRole('employee'); // 或 'store_manager' / 'central'
  WS.connect();
  // 页面初始化逻辑...
});
```

---

## 通知铃铛公共组件

三个页面均有通知铃铛，抽取为公共逻辑（可内联于 api.js 或单独 notification.js）：

```javascript
// 刷新铃铛未读数
async function refreshNotificationBell() {
  const { unreadCount, data } = await API.getNotifications();
  const visible = data.filter(n => {
    if (n.eventType === 'task_assigned') return !n.isRead;
    if (n.eventType.startsWith('nudge_')) return n.assignmentStatus !== 'completed';
    return true;
  });
  const count = visible.filter(n => !n.isRead).length;
  const badge = document.getElementById('notification-badge');
  if (badge) {
    badge.textContent = count > 0 ? count : '';
    badge.style.display = count > 0 ? 'block' : 'none';
  }
}
```

> 见 `05-NOTIFICATION-NUDGE.md` `getVisibleNotifications` 规则。
