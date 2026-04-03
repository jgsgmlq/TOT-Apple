# 店长移动端页实现指南（store.html）

**版本:** 1.0.0 | **角色:** store_manager | **终端:** 手机（iPhone 为主）
**基于:** `docs/specs/04-API-SPEC.md` + `docs/specs/05-NOTIFICATION-NUDGE.md`

---

## 页面概览

| 项目 | 说明 |
|------|------|
| 文件 | `front-end/store.html` |
| 当前状态 | ✅ Phase 2c 完成，已接入真实 API（2026-03-24）|
| 布局 | 底部 Tab 导航（4 个 Tab）+ 全屏内容区 |
| 依赖 | auth.js、api.js、ws.js |

---

## 页面入口逻辑

```javascript
document.addEventListener('DOMContentLoaded', () => {
  Auth.requireRole('store_manager');
  WS.connect();
  const user = Auth.getUser();
  initPage(user);
});

async function initPage(user) {
  await Promise.all([
    loadMyAssignments(user),
    refreshNotificationBell()
  ]);
  setupWsHandlers();
}
```

---

## Tab 导航结构

| Tab | 图标 | 内容 |
|-----|------|------|
| 我的任务 | 📋 | 店长本人的 Assignment 列表 |
| 员工进度 | 👥 | 本店全体员工任务完成情况 |
| 催办 | 📣 | 发起催办 |
| 通知 | 🔔 | 通知列表（铃铛角标）|

---

## 模块 1：我的任务（店长本人 Assignment）

**数据来源：**
```javascript
// 获取店长本人的 assignments（不传 storeId，默认返回本人）
const { data } = await API.getAssignments({ status: 'all' });
```

### 任务卡片展示

```
┌─────────────────────────────────┐
│ Q1新品知识认证          截止 3/30 │
│ 平台：MyPAL  SmartSell           │
│ ████████░░ 50%        [继续学习] │
└─────────────────────────────────┘
```

**字段映射：**

| 显示 | 字段 | 备注 |
|------|------|------|
| 任务标题 | `taskTitle` | |
| 截止时间 | `taskDdlAt` | 格式化 MM/DD |
| 平台标签 | `taskPlatforms` | 显示中文名 |
| 进度条 | `progress` | 0-100 整数 |
| 平台完成状态 | `mypalCompleted` 等 | 已完成打勾 |
| 催办角标 | `nudgeCount > 0` | 红色角标 |

**状态区分：**

| status | 按钮文案 | 按钮动作 |
|--------|---------|---------|
| `pending` | 开始学习 | POST .../start |
| `in_progress` | 继续学习 | 进入平台完成标记页 |
| `completed` | ✅ 已完成 | 不可点击 |

### 平台完成标记页

点击"继续学习"进入任务详情页：
- 列出该任务所有平台（来自 `taskPlatforms`）
- 每个平台显示完成状态（✅ / 未完成）
- 点击"标记完成"→ 调用 `POST .../platforms/:platform/complete`
- MyPAL 优先显示"同步 MyPAL 数据"按钮（MVP 实际调用 manual complete）

```javascript
async function completePlatform(assignmentId, platform) {
  try {
    const result = await API.completePlatform(assignmentId, platform);
    updatePlatformUI(platform, result);
    if (result.assignmentStatus === 'completed') {
      showSuccess('🎉 任务全部完成！');
    }
  } catch (err) {
    if (err.errorCode === 'ASSIGN_002') showError('请先开始任务');
    else showError(err.message);
  }
}
```

### Gap 清单

- [ ] 调用 `API.getAssignments()` 替换旧数据源
- [ ] 字段映射对齐新 Spec
- [ ] `pending` → `in_progress` 转换调用 `API.startAssignment(id)`
- [ ] 平台完成标记调用 `API.completePlatform(assignmentId, platform)`
- [ ] 催办角标（nudgeCount > 0 显示红点）
- [ ] 已完成任务移至列表底部或折叠

---

## 模块 2：员工进度（本店监管视图）

**数据来源：**
```javascript
// 店长选择任务后加载
const progress = await API.getStoreProgress(taskId);
```

### 展示结构

```
本店进度 — Q1新品知识认证
完成率 43% | 平均进度 58% | 7人

┌──────────────────────────────┐
│ 张三（员工）                  │
│ ██████░░░░ 50%     🟡 进行中 │
│ MyPAL❌ SmartSell✅          │
│                    [催办]    │
└──────────────────────────────┘
```

**落队等级显示（见 06-DASHBOARD-KPI.md）：**

| progress | 标签 | 颜色 |
|---------|------|------|
| ≥ 80 | 快完成 | 绿色 |
| 50-79 | 进行中 | 黄色 |
| < 50 | 严重落队 | 红色 |

### 任务选择

- 顶部 select 下拉：`GET /api/tasks` 返回 `dispatched` 状态的任务
- 切换任务 → 重新加载进度数据

### Gap 清单

- [ ] 调用 `API.getStoreProgress(taskId)` 获取数据
- [ ] 渲染每个成员的进度条 + 平台状态
- [ ] 落队等级颜色显示
- [ ] 任务选择下拉切换

---

## 模块 3：催办

**权限规则（见 05-NOTIFICATION-NUDGE.md）：**
- store_manager 可催：本店单个员工（targetType=employee）或本店整体（targetType=store）
- 不可催区域（region）

### 催办表单

```
选择目标：
  ○ 本店全体（store）
  ○ 指定员工（employee）
     └─ 下拉选择员工姓名

催办级别：
  ○ 🟡 黄色提醒（普通催办）
  ○ 🔴 红色紧急（紧急催办）

[发送催办]
```

### 提交逻辑

```javascript
async function sendNudge(taskId, targetType, targetId, severity) {
  try {
    const result = await API.nudge(taskId, { targetType, targetId, severity });
    showSuccess(`已向 ${result.notifiedCount} 人发送${severity === 'red' ? '紧急' : ''}催办`);
  } catch (err) {
    if (err.errorCode === 'NUDGE_001') showError('该员工已完成任务，无需催办');
    else if (err.errorCode === 'NUDGE_002') showError('无权催办此对象');
    else showError(err.message);
  }
}
```

### Gap 清单

- [ ] 催办 Tab 页面实现
- [ ] targetType 切换（store/employee）
- [ ] employee 选择下拉（`API.getStoreEmployees(storeId)`）
- [ ] severity 选择（yellow/red）
- [ ] 调用 `API.nudge(taskId, body)`

---

## 模块 4：通知铃铛 + 通知列表

**数据来源：**
```javascript
const { unreadCount, data } = await API.getNotifications();
```

### 铃铛显示规则（见 05-NOTIFICATION-NUDGE.md）

```javascript
function getVisibleNotifications(notifications) {
  return notifications.filter(n => {
    if (n.eventType === 'task_assigned') return !n.isRead;
    if (n.eventType.startsWith('nudge_')) return n.assignmentStatus !== 'completed';
    return true;
  });
}
```

### 通知列表项

```
┌──────────────────────────────┐
│ 🔴 【紧急】总部要求你立刻完成  │
│    Q1新品知识认证              │
│    2026-03-24 12:00          │
└──────────────────────────────┘
```

- 点击通知 → 跳转对应任务详情 + 调用 `API.markNotificationRead(eventId, 'notification_click')`
- 已完成任务的催办通知自动隐藏

### Gap 清单

- [ ] 调用 `API.getNotifications()` 替换旧数据源
- [ ] 铃铛角标显示未读数（getVisibleNotifications 过滤）
- [ ] 通知列表渲染（severity 颜色区分）
- [ ] 点击调用 `API.markNotificationRead()`
- [ ] WS `nudge_sent` 事件触发铃铛刷新

---

## WS 事件订阅汇总

```javascript
WS.on('task_dispatched', () => {
  showToast('你有新的培训任务，请查看');
  loadMyAssignments(Auth.getUser());
});
WS.on('nudge_sent', (msg) => {
  if (msg.targetType === 'store' || msg.targetId === Auth.getUser().storeId) {
    refreshNotificationBell();
    showToast('你收到一条催办通知');
  }
});
WS.on('platform_completed', ({ storeId }) => {
  if (storeId === Auth.getUser().storeId) reloadStoreProgress();
});
WS.on('assignment_completed', ({ storeId }) => {
  if (storeId === Auth.getUser().storeId) reloadStoreProgress();
});
WS.on('_disconnected', () => showBanner('连接中断，正在重连...'));
WS.on('_connected', () => hideBanner());
```
