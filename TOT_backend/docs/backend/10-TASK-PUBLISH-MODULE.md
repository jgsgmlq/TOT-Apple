# B — Task Publish 模块 技术审计

> 日期：2026-05-13 | 分支：modular-base | 审查范围：`modules/task-publish/`

---

## 1. 目录结构总览

```
modules/task-publish/
├── crud/
│   └── taskCrud.js                    # 406行，31函数，6表全覆盖 ✅
├── services/
│   ├── taskService.js                 # 255行，8函数，零SQL ✅
│   ├── reminderService.js             # 42行，3函数，纯计算 ✅
│   ├── audienceService.js             # ❌ 待写
│   ├── queueService.js                # ❌ 待写
│   └── campaignService.js             # ❌ 待写
├── routes/
│   ├── taskRoutes.js                  # 93行，7端点，零SQL ✅
│   ├── queueRoutes.js                 # ❌ 待写
│   ├── reminderRoutes.js              # ❌ 待写
│   └── campaignRoutes.js              # ❌ 待写
```

### 行数统计

| 文件 | 行数 | 状态 |
|------|------|------|
| taskCrud.js | 406 | ✅ 规范，6表31函数 |
| taskService.js | 255 | ✅ 规范 |
| reminderService.js | 42 | ✅ 规范 |
| audienceService.js | — | ❌ 待写 |
| queueService.js | — | ❌ 待写 |
| campaignService.js | — | ❌ 待写 |
| taskRoutes.js | 93 | ✅ 规范 |
| queueRoutes.js | — | ❌ 待写 |
| reminderRoutes.js | — | ❌ 待写 |
| campaignRoutes.js | — | ❌ 待写 |
| **合计** | **~796** | |

---

## 2. 三层架构合规检查

### 2.1 Route 层

| 文件 | SQL | 调Service | 参数校验 | 角色控制 | 统一响应 |
|------|-----|-----------|----------|----------|----------|
| taskRoutes.js | 0 | taskService | body透传 | requireRole | success() |

**结论**：Route 层符合规范。7 个端点覆盖完整 CRUD + dispatch/revoke。角色校验正确（central/admin 可写，所有认证用户可读）。

### 2.2 Service 层

| 文件 | SQL | 调用链 | 状态 |
|------|-----|--------|------|
| taskService.js | 0 | taskCrud + ws/manager + ddlAt | ✅ 规范 |
| reminderService.js | 0 | 纯计算 | ✅ 规范 |

**taskService.js 职责覆盖：**
- 输入校验（validateTaskInput）
- 格式转换（formatTask: snake_case → camelCase）
- 状态机（draft ↔ dispatched，更新权限控制）
- 级联删除（deleteTaskCascade 事务）
- WebSocket 广播（任务变更通知到前端）

### 2.3 Crud 层

**taskCrud.js 31 个函数，全部使用新表名：**

| 表 | 函数数 | 操作类型 |
|----|--------|---------|
| task_publish | 6 | getById, getList, getPage, create, update, delete, count |
| task_audience_rule | 4 | get, create, delete, deleteByTask |
| learner_task_queue | 9 | getById, getList, getPage, count, create, update, delete, batchCreate, deleteByTask |
| learner_task_reminder | 3 | getList, create, deleteByTask |
| task_reminder_log | 4 | getList, getStats, create, deleteByTask |
| campaign_activity | 5 | getById, getList, create, update, delete |
| 级联 | 1 | deleteTaskCascade (事务包装 5 步删除) |

---

## 3. 问题清单

### 3.1 HIGH

**H1 — 3 个 service + 3 个 route 缺失**

| 缺失文件 | 对应旧代码 | 行数 |
|---------|-----------|------|
| audienceService.js | taskSmartPublishService.js | 218 |
| queueService.js | assignmentBatch.js + assignmentProgress.js + routes/assignments.js | 800 |
| campaignService.js | 新业务 | — |
| queueRoutes.js | routes/assignments.js 路由层 | — |
| reminderRoutes.js | routes/nudge.js + routes/notifications.js 路由层 | — |
| campaignRoutes.js | 新页面 | — |

**H2 — 旧文件未改桩**

6 个旧文件仍为完整代码：
```
routes/tasks.js (726行)
routes/assignments.js (679行)
routes/nudge.js (285行)
routes/notifications.js (284行)
services/autoNudge.js (230行)
services/autoNudgeRules.js (48行)
```

其中 `autoNudgeRules.js` 仍被 A 的 `queryEngine.js` 和 `executiveMetricsService.js` 通过旧路径引用。

**H3 — reminderService 不完整**

当前仅包含 `autoNudgeRules.js` 的纯计算函数。`autoNudge.js` 的催办执行逻辑（230行，8处SQL）尚未迁移。

### 3.2 MEDIUM

**M1 — dispatchTask 受众解析未实现**

`taskService.dispatchTask()` 中受众解析为 TODO，当前 dispatch 只改状态 + 广播，不创建 `learner_task_queue` 记录。

**M2 — taskRoutes 缺少 body 参数校验** — Route 层未校验必填字段，完全依赖 service 层。

**M3 — broadcastToUsers 依赖 email_id 索引** — WS manager 可能不支持 email 索引。

### 3.3 LOW

**L1 — taskCrud.js 使用 `var`** — 全局替换为 `const`

**L2 — getReminderLogStats 的 groupBy 未做白名单校验**

**L3 — taskCrud.js 406 行** — 当前未超限，补充 audience/queue 查询后可能超 500 行

---

## 4. 跨模块依赖

### 4.1 B 对 C（admin）的依赖

B 的 `audienceService` 需要调 C 的 crud 做受众圈选：
```
storeCrud.getStoreList({ region, format, dealer })
learnerCrud.getLearnerList({ storeId, role })
```

### 4.2 A（dashboard）对 B 的依赖

A 通过 `dashboardCrud.js` 直接 JOIN B 的表。A 通过旧路径引用 `reminderService`：
```
queryEngine.js:22              → ../../../services/autoNudgeRules  ❌
executiveMetricsService.js:6   → ../../../services/autoNudgeRules  ❌
// 应改为 → ../../task-publish/services/reminderService
```

---

## 5. 修复路径

### 第一步：补全 service + route（~8小时）

```
B1. audienceService.js   — 从 taskSmartPublishService.js 提取，调 C 的 crud
B2. queueService.js      — 从 assignmentBatch + assignmentProgress + assignments.js 提取
B3. campaignService.js   — 新业务逻辑
B4. queueRoutes.js       — /api/v1/queues/* 端点
B5. reminderRoutes.js    — /api/v1/reminders/* 端点（合并 nudge + notifications）
B6. campaignRoutes.js    — /api/v1/campaigns/* 端点
```

### 第二步：旧文件改桩（~1小时）

```
B7.  routes/tasks.js → re-export taskRoutes
B8.  routes/assignments.js → re-export queueRoutes
B9.  routes/nudge.js → re-export reminderRoutes
B10. routes/notifications.js → re-export reminderRoutes
B11. services/autoNudge.js → 迁移到 reminderService，改桩
B12. services/autoNudgeRules.js → 已迁移，改桩
```

### 第三步：衔接 A 的跨模块引用（~30分钟）

```
B13. A更新 queryEngine.js:22 → ../../task-publish/services/reminderService
B14. A更新 executiveMetricsService.js:6 → 同上
```

### 第四步：dispatchTask 受众解析接通（~2小时）

```
B15. audienceService 实现 resolveAudience(rules) → 调 C crud → 返回学员列表
B16. taskService.dispatchTask() 接入 audienceService → batchCreateQueue
```

---

## 6. 与旧代码的对照

| 旧文件 | 行数 | 新文件 | 状态 |
|--------|------|--------|------|
| routes/tasks.js | 726 | taskCrud + taskService + taskRoutes | ✅ |
| services/autoNudgeRules.js | 48 | reminderService.js | ✅（纯计算） |
| services/autoNudge.js | 230 | reminderService.js | ❌ 待迁移 |
| services/taskSmartPublishService.js | 218 | audienceService.js | ❌ 待迁移 |
| services/assignmentBatch.js | 64 | queueService.js | ❌ 待迁移 |
| services/assignmentProgress.js | 57 | queueService.js | ❌ 待迁移 |
| routes/assignments.js | 679 | queueService + queueRoutes | ❌ 待迁移 |
| routes/nudge.js | 285 | reminderService + reminderRoutes | ❌ 待迁移 |
| routes/notifications.js | 284 | reminderService + reminderRoutes | ❌ 待迁移 |
