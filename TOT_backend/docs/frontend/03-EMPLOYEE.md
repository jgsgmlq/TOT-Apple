# 员工移动端页实现指南（employee.html）

**版本:** 1.0.0 | **角色:** employee | **终端:** 手机（iPhone 为主）
**基于:** `docs/specs/04-API-SPEC.md` + `docs/specs/03-PLATFORM-COMPLETION.md`

---

## 页面概览

| 项目 | 说明 |
|------|------|
| 文件 | `front-end/employee.html` |
| 当前状态 | ✅ Phase 2b 完成，已接入真实 API（2026-03-24）|
| 布局 | 底部 Tab 导航（2 个 Tab）+ 全屏内容区 |
| 依赖 | auth.js、api.js、ws.js |

---

## 页面入口逻辑

```javascript
document.addEventListener('DOMContentLoaded', () => {
  Auth.requireRole('employee');
  WS.connect();
  const user = Auth.getUser();
  initPage(user);
});

async function initPage(user) {
  await Promise.all([
    loadMyAssignments(),
    refreshNotificationBell()
  ]);
  setupWsHandlers();
}
```

---

## Tab 导航结构

| Tab | 图标 | 内容 |
|-----|------|------|
| 我的任务 | 📋 | 本人 Assignment 列表 |
| 通知 | 🔔 | 通知列表（铃铛角标）|

> 员工不可查看他人进度、不可催办，无监管视图 Tab。

---

## 模�� 1：我的任务列表

**数据来源：**
```javascript
const { data } = await API.getAssignments({ status: 'all' });
```

员工只能看到本人的 assignments（后端已过滤）。

### 任务卡片展示

```
┌─────────────────────────────────┐
│ 🔴 Q1新品知识认证       3天后截止 │
│ MyPAL · SmartSell               │
│ ──────────░░░░░ 50%             │
│ [继续学习]                       │
└─────────────────────────────────┘
```

**截止日期紧急提示（前端逻辑）：**

```javascript
function getDueStatus(ddlAt) {
  const hours = (new Date(ddlAt) - new Date()) / 36e5;
  if (hours < 24) return { label: '⚠️ 今天截止', color: 'red' };
  if (hours < 72) return { label: `${Math.ceil(hours/24)}天后截止`, color: 'yellow' };
  return { label: `${Math.ceil(hours/24)}天后截止`, color: 'normal' };
}
```

**字段映射：**

| 显示 | 字段 |
|------|------|
| 任务标题 | `taskTitle` |
| 截止时间 | `taskDdlAt` |
| 平台标签 | `taskPlatforms` → 中文名 |
| 进度百分比 | `progress` |
| 催办角标 | `nudgeCount > 0` |

**状态按钮：**

| status | 按钮文案 | 动作 |
|--------|---------|------|
| `pending` | 开始学习 | API.startAssignment(id) |
| `in_progress` | 继续学习 | 打开任务详情页 |
| `completed` | ✅ 已完成 | 只读 |

### Gap 清单

- [ ] 调用 `API.getAssignments()` 替换旧数据源
- [ ] 字段映射对齐新 Spec
- [ ] `pending` → `in_progress` 调用 `API.startAssignment(id)`
- [ ] 截止时间紧急颜色提示
- [ ] 催办角标（`nudgeCount > 0`）

---

## 模块 2：任务详情页（平台完成标记）

点击"继续学习"进入任务详情视图（同一页面内切换，非跳转）：

### 页面结构

```
← 返回    Q1新品知识认证    截止 3/30

进度：████████░░ 80%

平台学习清单：
┌────────────────────────────────────┐
│ ✅ SmartSell              已完成   │
├────────────────────────────────────┤
│ ☐ MyPAL                           │
│   [同步 MyPAL 数据] [手动标记完成] │
├────────────────────────────────────┤
│ ☐ AI Demo                         │
│   [标记完成]                       │
├────────────────────────────────────┤
│ ☐ 直播                            │
│   [标记完成]                       │
└────────────────────────────────────┘
```

**仅显示该任务 `taskPlatforms` 中包含的平台。**

### 平台中文名映射

```javascript
const PLATFORM_LABELS = {
  mypal: 'MyPAL',
  smartsell: 'SmartSell',
  ai_demo: 'AI Demo',
  live_broadcast: '直播'
};
```

### 标记平台完成

```javascript
async function markPlatformComplete(assignmentId, platform) {
  const btn = document.getElementById(`btn-${platform}`);
  btn.disabled = true;
  btn.textContent = '处理中...';
  try {
    const result = await API.completePlatform(assignmentId, platform);
    // result 包含 progress, assignmentStatus 等
    updateProgressBar(result.progress);
    markPlatformDone(platform);
    if (result.assignmentStatus === 'completed') {
      showCelebration();  // 🎉 全部完成动画
    }
  } catch (err) {
    btn.disabled = false;
    btn.textContent = '标记完成';
    if (err.errorCode === 'ASSIGN_002') {
      showError('请先点击"开始学习"');
    } else if (err.errorCode === 'ASSIGN_003') {
      showError('该平台不在本次任务范围内');
    } else {
      showError(err.message || '操作失败，请重试');
    }
  }
}
```

### MyPAL 特殊处理（见 03-PLATFORM-COMPLETION.md）

```
MVP 阶段：MyPAL 按钮文案为"同步 MyPAL 数据"，
实际调用与其他平台相同的接口（manual fallback）。
按钮旁显示小字提示：「系统将自动同步 MyPAL 学习记录」
```

### Gap 清单

- [ ] 任务详情视图实现（平台列表 + 完成状态）
- [ ] 仅显示 `taskPlatforms` 中的平台（动态渲染）
- [ ] 每个平台"标记完成"调用 `API.completePlatform()`
- [ ] 进度条实时更新
- [ ] `assignment_completed` 时显示完成庆祝动画
- [ ] MyPAL 按钮特殊文案

---

## 模块 3：通知铃铛 + 通知列表

**数据来源：**
```javascript
const { unreadCount, data } = await API.getNotifications();
```

### 铃铛显示规则

```javascript
// 同 store.html，见 04-SHARED.md
function getVisibleNotifications(notifications) {
  return notifications.filter(n => {
    if (n.eventType === 'task_assigned') return !n.isRead;
    if (n.eventType.startsWith('nudge_')) return n.assignmentStatus !== 'completed';
    return true;
  });
}
```

### 通知列表项展示

```
┌──────────────────────────────────┐
│ 📬 你有新的培训任务：Q1新品知识认证│
│    2026-03-24 10:00      [去查看] │
├──────────────────────────────────┤
│ 🟡 张店长提醒你完成培训任务：...  │
│    Q1新品知识认证                 │
│    2026-03-24 14:00              │
└──────────────────────────────────┘
```

**事件类型展示：**

| eventType | 图标 | 颜色 |
|-----------|------|------|
| `task_assigned` | 📬 | 蓝色 |
| `nudge_yellow` | 🟡 | 黄色 |
| `nudge_red` | 🔴 | 红色 |

### 点击通知动作

```javascript
async function onNotificationClick(notification) {
  // 1. 标记已读
  await API.markNotificationRead(notification.eventId, 'notification_click');
  // 2. 跳转到对应任务（任务列表中高亮 or 直接打开详情）
  openTaskDetail(notification.taskId, notification.assignmentId);
}
```

### Gap 清单

- [ ] 调用 `API.getNotifications()` 替换旧数据源
- [ ] 铃铛角标显示可见未读数
- [ ] 通知列表渲染（eventType 颜色 + 图标）
- [ ] 点击调用 `API.markNotificationRead()`
- [ ] 已完成任务的催办通知自动隐藏
- [ ] WS `task_dispatched` + `nudge_sent` 触发铃铛刷新

---

## WS 事件订阅汇总

```javascript
WS.on('task_dispatched', () => {
  showToast('📬 你有新的培训任务');
  loadMyAssignments();
  refreshNotificationBell();
});
WS.on('nudge_sent', () => {
  refreshNotificationBell();
  showToast('你收到一条催办提醒');
});
WS.on('platform_completed', ({ assignmentId, progress }) => {
  // 若当前正在查看该 assignment 的详情，实时更新进度
  if (currentAssignmentId === assignmentId) {
    updateProgressBar(progress);
  }
});
WS.on('_disconnected', () => showBanner('连接中断，正在重连...'));
WS.on('_connected', () => hideBanner());
```

---

## 员工视图的权限约束

| 操作 | 可否 | 说明 |
|------|------|------|
| 查看他人 Assignment | ❌ | 后端过滤，前端无需处理 |
| 发起催办 | ❌ | 不显示催办入口 |
| 查看总体完成率 | ❌ | 不展示汇总数据 |
| 标记自己的平台完成 | ✅ | 核心功能 |
| 查看自己的通知 | ✅ | 核心功能 |
