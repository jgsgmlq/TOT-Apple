# 模块化 Service 层文档

> 版本：1.0.0 | 日期：2026-05-13 | 分支：modular-base
> 本文档覆盖新模块结构（`modules/*/services/`）下的服务。旧 `server/services/` 中的 Chat/Agent 服务见 [`02-SERVICES.md`](./02-SERVICES.md)。

---

## 1. Service 层总览

| 模块 | 服务 | 行数 | 状态 | 说明 |
|------|------|------|------|------|
| **dashboard** | queryEngine.js | 1220 | ⚠️ | ~40处旧表SQL未提取 |
| | insightService.js | 763 | ⚠️ | ~16处旧表SQL + db.run bug |
| | executiveMetricsService.js | 241 | ⚠️ | ~5处旧表SQL + 假async |
| | analyzers/* (7 files) | 739 | ✅ | 零SQL，调queryEngine |
| **task-publish** | taskService.js | 255 | ✅ | 零SQL，调taskCrud |
| | reminderService.js | 42 | ✅ | 零SQL（纯计算） |
| | audienceService.js | — | ❌ | 待写 |
| | queueService.js | — | ❌ | 待写 |
| | campaignService.js | — | ❌ | 待写 |
| **admin** | authService.js | 101 | ✅ | 零SQL，调accountCrud |
| | accountService.js | — | ✅ | 新建 |
| | storeService.js | 11 | ✅ | 薄透传，调storeCrud |
| | learnerService.js | 10 | ✅ | 薄透传，调learnerCrud |
| | dictService.js | — | ✅ | 新建 |
| **mypal** | mypalService.js | 172 | ✅ | 合并4文件，调mypalCrud + learnerCrud |

---

## 2. Dashboard 模块

### 2.1 queryEngine.js

**路径：** `modules/dashboard/services/queryEngine.js`
**来源：** `services/dashboardQueryCore.js` (1208行)
**依赖：** 直接调 `getDb()`（❌ 应改为调 `dashboardCrud`）

**导出函数：**

| 函数 | 用途 | SQL数 |
|------|------|-------|
| `getOverviewBoardData(week)` | 概览指标：任务数、完成率、逾期率 | 7 |
| `getFunnelBoardData(taskId)` | 漏斗数据：各阶段人数和转化率 | 3 |
| `getAlertFunnelData(taskId)` | 预警漏斗数据 | 1 |
| `getAlertDrillDownData(taskId, storeId)` | 预警下钻 | 2 |
| `getHeatmapBoardData(dimension)` | 热力图数据（按区域/经销商/门店） | 1 |
| `getTrendBoardData(weeks)` | 趋势数据（多周对比） | 2 |
| `getUnifiedAlertsBoardData(taskId)` | 统一预警面板 | 间接调用 |
| `getWarningsBoardData(thresholds)` | 预警列表 | 2 |
| `getNudgeConversionBoardData(week)` | 催办转化率 | 2 |

**内部 helper：** `queryBaseAgg`、`queryPushUserCount`、`queryNudgeSeverityCounts`

**已知问题：**
- 全部 ~40 处 SQL 使用旧表名（`task_assignments`、`tasks`、`stores`），与 `dashboardCrud.js` 的新表名并存
- 文件 1220 行，超 800 行上限
- 跨模块引用旧路径 `../../../services/autoNudgeRules`（应改为 `../../task-publish/services/reminderService`）

### 2.2 insightService.js

**路径：** `modules/dashboard/services/insightService.js`
**来源：** `services/dashboardInsightService.js` (759行)
**依赖：** 直接调 `getDb()`（❌ 应改为调 `dashboardCrud`）

**导出函数：**

| 函数 | 用途 | SQL数 |
|------|------|-------|
| `buildNorthStarFacts(taskId)` | 北极星指标事实构建 | 2 |
| `buildFunnelFacts(taskId)` | 漏斗分析事实 | 4 |
| `buildWeeklyCompletionFacts(taskId)` | 周完成率事实 | 3 |
| `buildDailyCompletionFacts(taskId)` | 日完成率事实 | 3 |
| `buildHeatmapRankFacts(taskId)` | 热力图排名事实 | 3 |
| `buildWarningStatsFacts(taskId)` | 预警统计事实 | 1 |
| `buildChannelNorthStarFacts(taskId)` | 渠道北极星事实 | 1 |
| `persistInsightRecord(data)` | 洞察结果持久化 (INSERT) | 1 |
| `recordVote(insightId, userId, vote)` | 投票记录 (UPDATE/SELECT) | 4 |

**已知问题：**
- CRITICAL：`db` 对象只定义了 `get`/`all`，但多处调用了 `db.run()` → TypeError 崩溃
- 全部 ~16 处 SQL 使用旧表名
- 763 行，接近 800 行上限

### 2.3 executiveMetricsService.js

**路径：** `modules/dashboard/services/executiveMetricsService.js`
**来源：** `services/executiveMetricsQueryService.js` (235行)
**依赖：** 直接调 `getDb()`（❌ 应改为调 `dashboardCrud`）

**导出函数：**

| 函数 | 用途 |
|------|------|
| `getExecutiveMetrics(params)` | 高管视角多维度指标 |

**已知问题：**
- ~5 处 SQL 使用旧表名
- 函数声明 `async` 但内部全是同步 `db.all()`（better-sqlite3 是同步的）
- 硬编码 task alias `{ keys: ['phone', 'iphone', '17'], id: 'TASK_A' }`
- 跨模块引用旧路径

### 2.4 analyzers/* — 区域分析器

**路径：** `modules/dashboard/services/analyzers/`
**来源：** `services/dashboardSubAgents/*` (762行，原样移动)
**依赖：** 调 `queryEngine` 的导出函数，零 SQL

| 文件 | 行数 | 用途 |
|------|------|------|
| `funnelAnalyzer.js` | 65 | 漏斗区域分析：转化瓶颈、阶段流失 |
| `trendAnalyzer.js` | 92 | 趋势区域分析：多周期对比、预测 |
| `warningAnalyzer.js` | 131 | 预警区域分析：逾期风险、严重度分级 |
| `rtmAnalyzer.js` | 106 | RTM 区域分析：渠道/经销商维度下钻 |
| `runRegionAnalyzers.js` | 105 | 并发编排：4 分析器并发执行，默认并发数 6 |
| `shared.js` | 144 | 共享工具：JSON 解析与降级处理 |
| `promptTemplates.js` | 96 | LLM prompt 模板 |

---

## 3. Task Publish 模块

### 3.1 taskService.js

**路径：** `modules/task-publish/services/taskService.js`
**来源：** `routes/tasks.js` 业务逻辑提取
**依赖：** `taskCrud`、`common/ws/manager`、`common/middleware/errorHandler`、`common/utils/ddlAt`

**导出函数：**

| 函数 | 用途 |
|------|------|
| `formatTask(row)` | DB 行 (snake_case) → API 对象 (camelCase) |
| `validateTaskInput(body)` | 必填字段校验（title, startDate, dueDate, requiredFlag） |
| `listTasks(user)` | 任务列表（central/admin 全量，学员视角由 queueService 拼接） |
| `getTaskDetail(id, user)` | 任务详情 + 权限校验 |
| `createTask(body, username)` | 创建任务（状态 draft） |
| `updateTask(id, body)` | 更新任务（draft 全改，dispatched 仅限 dueDate/enabledFlag） |
| `dispatchTask(id)` | 发布任务（检查受众规则 → dispatch → WebSocket 广播） |
| `revokeTask(id)` | 撤销已发布任务 |
| `deleteTask(id)` | 删除任务（级联删除） |

**状态机：**
```
draft → dispatched → (可撤销但不能重新 draft)
              ↓
          删除（级联：task + queue + audience_rules）
```

### 3.2 reminderService.js

**路径：** `modules/task-publish/services/reminderService.js`
**来源：** `services/autoNudgeRules.js` (48行)
**依赖：** 无（纯计算函数，零 DB）

**导出函数：**

| 函数 | 用途 |
|------|------|
| `parseAutoNudgeRules(raw)` | 解析催办规则 JSON 配置 |
| `getDeadlineCrisisHours(rules)` | 提取 deadline crisis 阈值（p0/p1/p2） |
| `classifyDeadlineCrisisBand(rules, hoursLeft, passedPercent)` | 计算当前 crisis 等级（p0/p1/p2/null） |

**跨模块被引用：** A 的 `queryEngine.js` 和 `executiveMetricsService.js` 调此服务（当前引用旧路径 `../../../services/autoNudgeRules`，需改为 `../../task-publish/services/reminderService`）

### 3.3 audienceService.js ❌ 待写

**规划路径：** `modules/task-publish/services/audienceService.js`
**来源：** `services/taskSmartPublishService.js` (218行)
**职责：** 受众规则管理 — 根据圈选条件（区域、经销商、门店、角色）解析目标学员列表。调 C 的 `storeCrud` + `learnerCrud`。

### 3.4 queueService.js ❌ 待写

**规划路径：** `modules/task-publish/services/queueService.js`
**来源：** `services/assignmentBatch.js` (64行) + `services/assignmentProgress.js` (57行) + `routes/assignments.js` (679行)
**职责：** 待办队列管理 — 批量创建分配、进度计算、状态重算。

### 3.5 campaignService.js ❌ 待写

**规划路径：** `modules/task-publish/services/campaignService.js`
**来源：** 新业务逻辑
**职责：** 活动/战役管理。

---

## 4. Admin 模块

### 4.1 authService.js

**路径：** `modules/admin/services/authService.js`
**来源：** `routes/auth.js` 业务逻辑提取
**依赖：** `accountCrud`、`common/middleware/auth` (JWT_SECRET)、`common/errorCodes`

**导出函数：**

| 函数 | 用途 |
|------|------|
| `login(username, password)` | 验证凭据 → 签发 JWT (7天) → 返回 token + userInfo |
| `getProfile(accountId)` | 获取当前用户信息 |
| `changePassword(accountId, oldPw, newPw)` | 修改密码（bcrypt 哈希） |

### 4.2 accountService.js

**路径：** `modules/admin/services/accountService.js`
**依赖：** `accountCrud`

账户 CRUD 编排（创建、列表、分页、更新、删除）。

### 4.3 storeService.js

**路径：** `modules/admin/services/storeService.js`
**依赖：** `storeCrud`

**导出函数：** `getStoreList`、`getStoreById`、`getStoreByAppleId`、`getStorePage`、`getHqList`
薄透传层，主要做 not-found → 抛异常的错误转换。

### 4.4 learnerService.js

**路径：** `modules/admin/services/learnerService.js`
**依赖：** `learnerCrud`

**导出函数：** `getLearnerList`、`getLearnerById`、`getLearnerByEmail`、`getLearnerPage`
薄透传层，主要做 not-found → 抛异常的错误转换。

### 4.5 dictService.js

**路径：** `modules/admin/services/dictService.js`
**依赖：** `dictCrud`

字典管理（数据字典/配置项的 CRUD 编排）。

---

## 5. MyPal 模块

### 5.1 mypalService.js

**路径：** `modules/mypal/services/mypalService.js`
**来源：** 合并 `mypalSign.js` + `mypalClient.js` + `mypalLink.js` + `mypalSyncService.js` (457行 → 172行)
**依赖：** `mypalCrud`、`admin/crud/learnerCrud`

**导出函数：**

| 函数 | 用途 |
|------|------|
| `isMypalEnabled()` | 检查环境变量配置完整性 |
| `callMyPalApi(endpoint, params)` | HMAC-SHA256 签名 → HTTP 调用 → 超时处理 |
| `syncLearningProgress(queryDate)` | 分页拉取 MyPal 学习数据 → 写 mypalCrud |
| `getSyncStatus(queryDate)` | 查询同步数据列表 |
| `getSyncAuditLogs(syncDataId)` | 查询同步审计日志 |
| `normalizeEmail(email)` | 邮箱规范化 |
| `resolveLearnerByEmail(email)` | 按邮箱查找学员（调 admin 的 learnerCrud） |

**跨模块依赖：** 调 C 的 `learnerCrud.getLearnerByEmail()` 做学员匹配。

---

## 6. Common 模块

### 6.1 crud/auditCrud.js

**路径：** `modules/common/crud/auditCrud.js`
**职责：** 5 张 `*_audit_log` 表的统一写入（跨模块共享的审计日志访问层）。

---

## 7. 与旧 Service 层的关系

旧 `server/services/` 中的文件按迁移状态分为三类：

| 类别 | 文件 | 状态 |
|------|------|------|
| **已迁移** | dashboardQueryCore, dashboardInsightService, dashboardSubAgents/*, executiveMetricsQueryService, taskSmartPublishService, assignmentBatch, assignmentProgress, autoNudge, autoNudgeRules, mypalClient, mypalLink, mypalSign, mypalSyncService | → 新模块 services/ |
| **待迁移** | dispatchService, taskService(旧), taskSummaryService, nudgeService, notificationService, stateSync | 旧 services/ 中仍需迁移 |
| **排除** | chatService, chatAgentRunner, chatSessionStateService, chatMemoryService, chatIntentService, chatAnswerService, chatAnalyticsService, chatToolsService, dashboardAgentService | 本次模块化不涉及 |

旧 Service 层完整清单见 [`02-SERVICES.md`](./02-SERVICES.md)。

---

## 8. 相关文档

| 文档 | 路径 | 说明 |
|------|------|------|
| 模块架构规范 | `08-MODULE-ARCHITECTURE.md` | 三层契约、模块拓扑、基础设施 |
| 编码规范 | `../CODING-STANDARDS.md` | 函数命名、签名、响应格式 |
| 旧 Service 文档 | `02-SERVICES.md` | 旧 `server/services/` 全部文件 |
| 看板模块审计 | `07-DASHBOARD-MODULE.md` | Dashboard 模块代码质量详情 |
| 模块化方案 | `../plans/2026-05-12-modularization-plan.md` | 整体方案、模块划分 |
