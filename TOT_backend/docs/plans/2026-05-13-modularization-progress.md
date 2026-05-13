# 模块化重构进度追踪

> 更新：2026-05-13 | 分支：modular-base
> 计划：[2026-05-12-modularization-plan.md](./2026-05-12-modularization-plan.md) | AI 入口：[index.md](./index.md)

---

## 1. 整体进度

| 阶段 | 状态 | 说明 |
|------|------|------|
| Phase 0 — 框架搭建 | ✅ 完成 | common/ + 模块骨架 + 规范文档 |
| Phase 1 — 并行开发 | ✅ 完成 | 三人代码已合入 modular-base |
| Phase 2 — 整合回归 | 🔄 进行中 | A 看板回归完成，待 B/C 回归 + app.js 切换 |

---

## 2. 模块完成度

### A — Dashboard 看板 ⚠️ (CR未通过，详见 docs/backend/07-DASHBOARD-MODULE.md)

| 文件 | 状态 | 来源 | 问题 |
|------|------|------|------|
| `crud/dashboardCrud.js` | ⚠️ | 新写，9个新表聚合函数 | 覆盖不全，缺~60个查询 |
| `services/queryEngine.js` | ❌ | <- dashboardQueryCore.js | ~40处旧表SQL未提取 |
| `services/insightService.js` | ❌ | <- dashboardInsightService.js | ~16处旧表SQL + db.run未定义bug |
| `services/executiveMetricsService.js` | ❌ | <- executiveMetricsQueryService | ~5处旧表SQL + 假async |
| `services/analyzers/*` (7 files) | ✅ | <- dashboardSubAgents/* | 正确 |
| `routes/dashboardRoutes.js` | ✅ | <- routes/dashboard.js | 正确，缺参数校验 |
| `routes/insightRoutes.js` | ✅ | <- routes/dashboardInsights.js | 正确 |

核心问题：三个 service 文件的 SQL 未提取到 crud 层，违反"Service 零 SQL"规则。旧表名与新表名并存。

### B — Task Publish 任务发布 ⚠️

| 文件 | 状态 | 来源 |
|------|------|------|
| `crud/taskCrud.js` | ✅ | 样板 + 补充 |
| `services/taskService.js` | ✅ | <- routes/tasks.js 业务逻辑 |
| `services/reminderService.js` | ✅ | <- autoNudgeRules.js + autoNudge.js |
| `services/audienceService.js` | ❌ 待写 | <- taskSmartPublishService.js |
| `services/queueService.js` | ❌ 待写 | <- assignmentBatch + assignmentProgress |
| `services/campaignService.js` | ❌ 待写 | 新业务 |
| `routes/taskRoutes.js` | ✅ | <- routes/tasks.js 路由层 |
| `routes/queueRoutes.js` | ❌ 待写 | <- routes/assignments.js |
| `routes/reminderRoutes.js` | ❌ 待写 | <- routes/nudge.js + notifications.js |
| `routes/campaignRoutes.js` | ❌ 待写 | 新页面 |

待迁移旧文件（仍为完整代码）：tasks.js(726行), assignments.js(679行), notifications.js(284行), nudge.js(285行), autoNudge.js(230行), autoNudgeRules.js(48行)

> ⚠️ `autoNudgeRules.js` 仍被 A 的 `queryEngine.js` 和 `executiveMetricsService.js` 引用。B 迁移后需更新 A 的 import 路径为 `../task-publish/services/reminderService`。

### C — Admin 管理员端 ✅

| 文件 | 状态 | 来源 |
|------|------|------|
| `crud/accountCrud.js` | ✅ | 新写 |
| `crud/storeCrud.js` | ✅ | 新写 |
| `crud/learnerCrud.js` | ✅ | 新写 |
| `crud/dictCrud.js` | ✅ | 新写 |
| `services/authService.js` | ✅ | <- routes/auth.js |
| `services/accountService.js` | ✅ | 新写 |
| `services/storeService.js` | ✅ | <- routes/stores.js |
| `services/learnerService.js` | ✅ | <- routes/employees.js |
| `services/dictService.js` | ✅ | 新写 |
| `routes/authRoutes.js` | ✅ | <- routes/auth.js 路由层 |
| `routes/accountRoutes.js` | ✅ | 新写 |
| `routes/storeRoutes.js` | ✅ | 新写 |
| `routes/learnerRoutes.js` | ✅ | 新写 |
| `routes/dictRoutes.js` | ✅ | 新写 |
| `mypal/crud/mypalCrud.js` | ✅ | 新写 |
| `mypal/services/mypalService.js` | ✅ | <- 4 mypal 文件合并 |
| `mypal/routes/mypalRoutes.js` | ✅ | <- mypal.js + mypalMock.js |
| `common/crud/auditCrud.js` | ✅ | 新写 |

待改桩旧文件：auth.js(120行), stores.js(101行), employees.js(142行), mypal.js(36行), mypalMock.js(175行)

---

## 3. Phase 2 待办

### A ✅ 完成
- [x] 8 查询函数 DB 回归 (24/24)
- [x] 旧路由桩链验证
- [x] connection.js 路径修复

### B
- [ ] 补全 3 service + 3 route
- [ ] 旧文件改桩
- [ ] 任务发布全链路回归

### C
- [ ] 5 个旧文件改桩
- [ ] `app.js` require 路径切换 (17处)
- [ ] 认证 + 权限回归

### 三人联合
- [ ] `modular-base` 启动验证
- [ ] 跑现有测试脚本

---

## 4. app.js 待切换引用（C 负责，共 17 处）

```
./middleware/requestId     → ./modules/common/middleware/requestId
./middleware/errorHandler  → ./modules/common/middleware/errorHandler
./ws/manager              → ./modules/common/ws/manager
./ws/ttsRealtime          → ./modules/common/ws/ttsRealtime
./routes/auth             → ./modules/admin/routes/authRoutes
./routes/stores           → ./modules/admin/routes/storeRoutes
./routes/employees        → ./modules/admin/routes/learnerRoutes
./routes/mypal            → ./modules/mypal/routes/mypalRoutes
./routes/mypalMock        → ./modules/mypal/routes/mypalRoutes（mock 逻辑已内聚）
./routes/tasks            → ./modules/task-publish/routes/taskRoutes
./routes/assignments      → ./modules/task-publish/routes/queueRoutes
./routes/notifications    → ./modules/task-publish/routes/reminderRoutes
./routes/nudge            → ./modules/task-publish/routes/reminderRoutes
./jobs/autoNudgeScheduler → ./modules/task-publish/services/reminderService（调度逻辑合并）
./utils/tracer            → ./modules/common/utils/tracer
./utils/logger            → ./modules/common/utils/logger
./routes/dashboard        → ./modules/dashboard/routes/dashboardRoutes
./routes/dashboardInsights → ./modules/dashboard/routes/insightRoutes
```

排除（不动）：chat, asr, dashboardAgent, dashboardAgentScheduler

---

## 5. 下一步

| 谁 | 行动 | 优先级 |
|-----|------|--------|
| B | 补全 3 service + 3 route | P0 |
| B | autoNudge.js / autoNudgeRules.js 迁移到 reminderService | P0 |
| B | 旧文件 (tasks/assignments/nudge/notifications/autoNudge/autoNudgeRules) 改桩 | P1 |
| B | 通知 A 更新 queryEngine/executiveMetrics 的 autoNudgeRules 引用路径 | P1 |
| C | 旧文件 (auth/stores/employees/mypal/mypalMock) 改桩 | P0 |
| C | app.js 17 处路径切换 + 认证权限回归 | P0 |
| A | 接收 B 通知后更新 2 处跨模块引用 | P1 |
| 三人 | modular-base 启动验证 + 跑测试 + MR 到 dev | P1 |
