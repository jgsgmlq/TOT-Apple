# 总部看板页实现指南（central.html）

**版本:** 1.0.0 | **角色:** central | **终端:** PC（1920×1080）
**基于:** `docs/specs/04-API-SPEC.md` + `docs/specs/06-DASHBOARD-KPI.md`

---

## 页面概览

| 项目 | 说明 |
|------|------|
| 文件 | `front-end/central.html` |
| 当前状态 | ✅ Phase 2d 完成，已接入真实 API（2026-03-24）|
| 布局 | 左侧 Sidebar 导航（220px）+ 顶栏（56px）+ 右侧主内容区 |
| 依赖 | auth.js、api.js、ws.js、Chart.js、TailwindCSS、Font Awesome |

---

## 页面入口逻辑

```javascript
document.addEventListener('DOMContentLoaded', () => {
  Auth.requireRole('central');  // 非 central 跳转 login
  WS.connect();
  initPage();
});

async function initPage() {
  await loadTaskList();
  setupWsHandlers();
}
```

---

## 功能模块一览

| 模块 | 状态 | 主要 API |
|------|------|---------|
| 任务列表 | ⚠️ | GET /api/tasks |
| 任务创建表单 | ⚠️ | POST /api/tasks |
| 一键下发 | ⚠️ | POST /api/tasks/:id/dispatch |
| 看板（实时）| ⚠️ | GET /api/tasks/:id/summary |
| 催办 | ❌ | POST /api/tasks/:id/nudge |
| 通知铃铛 | ❌ | GET /api/notifications |

---

## 模块 1：任��列表

### 目标行为

- 页面加载时调用 `GET /api/tasks` 获取所有任务（central 可见全部）
- 任务卡片展示：title、status（draft/dispatched）、ddlAt、platforms 标签
- 点击任务卡片 → 切换到看板面板并加载该任务 summary
- WS 事件 `task_dispatched` 触发刷新列表

### 关键字段映射

| API 字段 | 显示 | 备注 |
|---------|------|------|
| `status: 'draft'` | 草稿（蓝色标签）| 可下发 |
| `status: 'dispatched'` | 已下发（绿色标签）| 不可重复下发 |
| `ddlAt` | 截止时间 | 格式化为 YYYY-MM-DD HH:mm |
| `platforms` | 标签列表 | mypal/smartsell/ai_demo/live_broadcast |

### Gap 清单

- [ ] 调用 `API.getTasks()` 替换旧事件总线数据源
- [ ] 字段映射对齐新 Spec（`title` 而非 `name`，`ddlAt` 而非 `deadline`）
- [ ] `status` 展示对齐新状态（`draft` 而非 `pending`）
- [ ] WS `task_dispatched` 事件触发列表刷新

---

## 模块 2：任务创建表单

### 表单字段

| 字段 | 类型 | 校验 | API 字段 |
|------|------|------|---------|
| 任务标题 | text input | 必填 | `title` |
| 任务说明 | textarea | 可选 | `description` |
| 学习平台 | 多选复选框（4 项）| 至少选 1 | `platforms` |
| 目标角色 | radio（3 选）| 必选 | `targetRole` |
| RTM 筛选 | 树形多选 | 可选 | `rtmFilter` |
| 截止时间 | datetime-local | 必填 | `ddlAt` |

### RTM 筛选组件

RTM 三级树（见 07-RTM-FILTER.md），勾选叶子节点：

```
Monobrand
  └─ Monobrand
       ├─ MONO
       └─ Lifestyle
Multibrand
  └─ Multibrand
       ├─ Mass Merchant
       ├─ OTC
       ├─ Township
       └─ Duty Free
Education
  └─ Education
       └─ Education
```

**选中后实时预览：**
```javascript
// 每次 rtmFilter 变化，调用预览 API
async function previewDispatch(rtmFilter, targetRole) {
  // 临时创建预览：可通过 POST /api/tasks 创建 draft 后立即查 dispatch 数量
  // MVP 简化：直接在前端统计 stores 中符合 rtmFilter 的数量
}
```

> MVP 简化方案：先 `GET /api/stores` 获取门店列表，前端按 rtmFilter 筛选门店数，乘以 targetRole 对应的人均数估算。

### 提交逻辑

```javascript
async function submitCreateTask(formData) {
  try {
    showLoading();
    const task = await API.createTask({
      title: formData.title,
      description: formData.description,
      platforms: formData.platforms,        // string[]
      targetRole: formData.targetRole,
      rtmFilter: formData.rtmFilter,        // [{rtm, subRtm, format}]
      storeScope: 'all',
      ddlAt: new Date(formData.ddlAt).toISOString()
    });
    showSuccess(`任务"${task.title}"创建成功`);
    await loadTaskList();
    closeModal();
  } catch (err) {
    showError(err.message || '创建失败');
  } finally {
    hideLoading();
  }
}
```

### Gap 清单

- [ ] 表单字段替换旧字段名（`title`/`ddlAt`/`platforms`/`rtmFilter`）
- [ ] `platforms` 改为多选复选框（mypal/smartsell/ai_demo/live_broadcast）
- [ ] RTM 筛选树形组件实现
- [ ] 提交后调用 `API.createTask()`
- [ ] 错误处理展示 errorCode 友好提示

---

## 模块 3：一键下发

### 目标行为

- 仅对 `status: 'draft'` 的任务显示"下发"按钮
- 点击 → 确认弹窗（"即将下发给 X 家门店，Y 名成员，确认吗？"）
- 确认 → 调用 `POST /api/tasks/:id/dispatch`
- 成功 → 刷新任务状态，弹出成功提示（"已下发给 Z 人"）
- WS 接到 `task_dispatched` 事件 → 全局刷新

### Gap 清单

- [ ] 下发按钮按 status 显示/隐藏
- [ ] 确认弹窗加下发预览数字
- [ ] 调用 `API.dispatchTask(id)` 并处理错误（TASK_003 = 已下发提示）
- [ ] 成功后刷新 UI 状态

---

## 模块 4：任务看板（实时）

### 数据来源

```javascript
// 初始加载
const summary = await API.getTaskSummary(taskId);
renderDashboard(summary);

// WS 事件触发刷新（任何 assignment 变化）
WS.on('platform_completed', () => reloadSummary());
WS.on('assignment_completed', () => reloadSummary());
```

### 渲染子组件

#### KPI 卡片（4 个）
```
推送人数 | 店员已读 | 店长已读 | 任务发放率
```
字段：`summary.kpi`

#### 整体进度环形图
- 使用 Chart.js（已引入）
- `completed / total` 比例环
- 颜色：绿/黄/红（alertLevel）

#### 区域进度表格（byRegion）

| 区域 | 应完成 | 已完成 | 完成率 | 预警 |
|------|------|------|------|------|
| 华东 | 60 | 20 | 33% | 🟡 |

#### 门店排行（Top/Bottom 5）
- 两列卡片：Top 5（绿色）/ Bottom 5（红色）
- 字段：`summary.topStores` / `summary.bottomStores`

#### 预警列表（alertList）
- 仅展示（MVP 无操作）
- P1 红色 / P2 黄色
- 含 `aiSuggestion` 文案

#### 更新时间显示
```javascript
document.getElementById('last-updated').textContent = `数据截至 ${new Date(summary.updatedAt).toLocaleTimeString('zh-CN')}`;
```

### Gap 清单

- [ ] 调用 `API.getTaskSummary(id)` 替换旧数据源
- [ ] KPI 卡片绑定 `summary.kpi` 字段
- [ ] Chart.js 环形图对接 `summary.overall`
- [ ] byRegion 表格渲染（alertLevel 颜色）
- [ ] Top/Bottom 5 渲染（需后端实现 topStores/bottomStores）
- [ ] alertList 渲染（P1 红 / P2 黄）
- [ ] WS 事件触发看板自动刷新
- [ ] `updatedAt` 更新时间显示

---

## 模块 5：催办

### 目标行为

- 在预警列表或门店详情中，点击"催办"按钮
- 弹出：选择催办类型（员工/门店/区域）+ 催办级别（黄色/红色）
- 调用 `POST /api/tasks/:id/nudge`
- 成功 → 提示"已向 X 人发送催办"

### 请求体

```json
{
  "targetType": "store",
  "targetId": "S001",
  "severity": "yellow"
}
```

### Gap 清单

- [ ] 催办弹窗组件（targetType 选择 + severity 选择）
- [ ] 调用 `API.nudge(taskId, body)`
- [ ] 错误处理（NUDGE_001 = 任务已完成，NUDGE_002 = 无权限）

---

## 模块 6：通知铃铛

> central 角色在 Spec 中**不接收通知**（GET /api/notifications 返回 403），铃铛隐藏。
> 如需展示系统消息（如下发成功），可在本地 toast 提示实现，无需通知 API。

---

## WS 事件订阅汇总

```javascript
WS.on('task_dispatched',    ({ taskId, assignmentCount }) => { refreshTaskList(); showToast(`任务已下发给 ${assignmentCount} 人`); });
WS.on('assignment_started', () => reloadSummary());
WS.on('platform_completed', () => reloadSummary());
WS.on('assignment_completed', () => reloadSummary());
WS.on('nudge_sent', () => showToast('催办已发送'));
WS.on('_disconnected', () => showBanner('连接中断，正在重连...'));
WS.on('_connected', () => hideBanner());
```
