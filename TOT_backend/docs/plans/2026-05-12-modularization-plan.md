# TOT Backend 模块化与规范化方案 v2

> 日期：2026-05-12 | 更新：2026-05-13 | 分支：dev | 参与人：A B C（3名开发）

---

## 1. 背景与目标

### 1.1 约束条件

- **数据库正在重构**：新 schema 见 `docs/er-diagram-graphviz.svg`，由另一组负责建表
- **本组三人只负责代码规范化**：将现有前后端代码改为三层架构，crud 层适配新表名
- **Executive Chat 代码本次不动**

### 1.2 核心问题

- `db.prepare()` / `db.run()` 分散在 20 个文件中
- Route 里直接写 SQL：`routes/tasks.js` 39处、`routes/assignments.js` 36处
- Service 层缺失：业务逻辑和数据访问混在一起
- `services/` 22 个文件平铺，`routes/` 14 个文件平铺，无模块边界

### 1.3 目标

1. **所有数据库操作封装为 crud 纯函数**，routes 和 services 中零 SQL
2. **三层架构**：Route（校验/格式化）→ Service（业务逻辑）→ Crud（数据访问）
3. **Crud 层适配新表名**（见 §2 映射表）
4. **按功能模块三人分工**，每人独立负责前后端

### 1.4 排除范围

```
agent/                             # LangGraph 全图
chat_tools/                        # 工具定义
prompts/                           # Prompt 文件
routes/chat.js                     # Chat 路由
services/chatService.js            # Chat 核心 (1105行)
services/chatAgentRunner.js        # Agent 执行器 (768行)
services/chatSessionStateService.js
services/chatMemoryService.js
services/chatIntentService.js
services/chatAnswerService.js
services/chatAnalyticsService.js
services/chatToolsService.js
services/dashboardAgentService.js  # Agent 后续做
routes/dashboardAgent.js
jobs/dashboardAgentScheduler.js
```

排除量约 8,850 行，待模块化约 12,000 行。

---

## 2. 新旧表映射

```
旧表（当前代码）                    →  新表（ER 图目标）
═══════════════════════════════════════════════════════════════
tasks                             →  task_publish
task_assignments                  →  learner_task_queue
stores                            →  reseller_headquarter + reseller_store（拆为两级）
employees                         →  learner_account
users                             →  account
notification_events               ┐
nudge_records                     ├→ learner_task_reminder + task_reminder_log（合并重构）
read_receipts                     ┘
dashboard_insights                →  无对应（改为实时计算）
mypal_learning_mock               →  mypal_learning_progress_sync
—                                 →  task_audience_rule（新增：受众圈选规则）
—                                 →  campaign_activity（新增：活动/战役）
—                                 →  dictionary（新增：字典配置）
—                                 →  5 张 sync_audit_log 表（新增：同步审计）
```

**关键变化：** 旧 notification_events / nudge_records / read_receipts 三张表被融入 `learner_task_reminder` + `task_reminder_log` 体系。催办/通知不再是独立模块，而是任务生命周期的一部分。

---

## 3. 核心规范（强制）

### 3.1 三层架构

```
Route    → 参数校验 + 调 service + 格式化响应。零 SQL。
Service  → 业务逻辑：校验/编排/转换。零 SQL，调 crud。
Crud     → 纯函数，唯一的数据访问层。所有 SQL 集中在这里。
```

**硬性规则：**
- Route 和 Service 中禁止出现 `db.prepare()`、`db.run()`、`db.exec()` 或 SQL 字符串
- 模块间只能调对方模块的 **Crud**，禁止直接调对方的 Service
- 所有动态值使用 `?` 占位符，禁止 `${}` 拼接 SQL

### 3.2 Crud 粒度

**一个模块一个 crud 文件**，不按表拆分。理由：
- 每模块涉及 4-6 张表，单表 SQL 量有限
- 合并更内聚，避免 import 路径爆炸
- 超过 500 行再考虑按域拆分

### 3.3 Crud 函数签名

导出**纯函数**（不用 class），统一命名：

```javascript
// 标准操作
function createX(data)                        // → 新建对象
function getXById(id)                         // → object | null
function getXList({ where, orderBy, limit, offset })  // → []
function getXPage({ page, pageSize, where, orderBy }) // → { rows, total, page, pageSize }
function updateX(id, data)                    // → updatedObject | null
function deleteX(id)                          // → boolean
function countX(where)                        // → number

// 聚合查询（仅 dashboard 用）
function query(sql, params)                   // → array
```

### 3.4 统一 API 响应格式

```json
// 成功
{ "code": 200, "message": "success", "data": {...}, "requestId": "..." }

// 列表
{ "code": 200, "data": { "list": [...], "pagination": { "page":1, "pageSize":20, "total":150 } } }

// 错误
{ "code": 400, "message": "具体错误", "errorCode": "TASK_001", "data": null }
```

---

## 4. 模块划分

```
                         ┌──────────────────────┐
                         │     A: Phase 0 框架    │
                         │  common/ + 目录骨架    │
                         └──────────┬───────────┘
                                    │ getDb(), middleware, utils, app.js
                 ┌──────────────────┼──────────────────┐
                 ▼                  ▼                  ▼
         ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
         │  B: 任务发布  │   │  A: 看板     │   │ C: 管理员端  │
         │  (6表写)      │   │  (无写表)    │   │ (10表写)    │
         └──────┬───────┘   └──────┬──────┘   └──────┬──────┘
                │                  │                  │
                │   只读 crud      │   只读 crud      │
                ├─────────────────►├──────────────────┤
                │  task_publish    │  reseller_store  │
                │  learner_queue   │  learner_account │
                │  task_reminder   │  account         │
                │  campaign        │                  │
                │                  │                  │
                ◄──────────────────┼──────────────────┤
                                   │  只读 crud       │
                                   │  (B 读 C 的 store│
                                   │   learner,       │
                                   │   account)       │
```

### 4.1 A — Dashboard 看板模块

**拥有表（写）：** 无。看板是纯分析/展示层。

**读取来源：**
- B 的 crud：`task_publish`、`learner_task_queue`、`learner_task_reminder`、`task_reminder_log`、`campaign_activity`
- C 的 crud：`reseller_headquarter`、`reseller_store`、`learner_account`、`account`

```
modules/dashboard/
├── crud/
│   └── dashboardCrud.js           # 跨表聚合查询（只读，不拥有表）
│      导出：
│      getOverviewMetrics(week)          # 概览
│      getTrendData(weeks)               # 趋势
│      getWarningData(thresholds)        # 预警
│      getHeatmapData(dimension)         # 热力图
│      getFunnelData(taskId)             # 漏斗
│      getReminderStats(week)            # 催办统计
│      getExecutiveMetrics(params)       # 高管指标
├── services/
│   ├── queryEngine.js              # ← dashboardQueryCore.js (1208行) 去SQL
│   ├── insightService.js           # ← dashboardInsightService.js (759行) 去SQL
│   ├── executiveMetricsService.js  # ← executiveMetricsQueryService.js (235行) 去SQL
│   └── analyzers/                  # ← dashboardSubAgents/* (7文件, 762行) 原样移动
│       ├── funnelAnalyzer.js
│       ├── trendAnalyzer.js
│       ├── warningAnalyzer.js
│       ├── rtmAnalyzer.js
│       ├── runRegionAnalyzers.js
│       ├── shared.js
│       └── promptTemplates.js
├── routes/
│   ├── dashboardRoutes.js          # /api/v1/dashboard/overview|warnings|trend|heatmap
│   └── insightRoutes.js            # /api/v1/dashboard/insights/*
```

**前端：** `views/central/newBoard/`、`api/dashboard/`

**来源文件（7个，~3,100行）：**

| 来源 | 行数 | 目标 | 说明 |
|------|------|------|------|
| `services/dashboardQueryCore.js` | 1208 | `queryEngine.js` | 22处SQL → dashboardCrud |
| `services/dashboardInsightService.js` | 759 | `insightService.js` | 28处SQL → dashboardCrud |
| `services/dashboardSubAgents/*` | 762 | `analyzers/*` | 7文件原样移动 |
| `services/executiveMetricsQueryService.js` | 235 | `executiveMetricsService.js` | 4处SQL → dashboardCrud |
| `routes/dashboard.js` | 90 | `dashboardRoutes.js` | 去SQL |
| `routes/dashboardInsights.js` | 45 | `insightRoutes.js` | 去SQL |

**不再需要（notification/nudge 融入 B 的 reminder 体系）：**
- `routes/notifications.js`（284行，7处SQL）
- `routes/nudge.js`（285行，13处SQL）
- `services/autoNudge.js`（230行，8处SQL）
- `services/autoNudgeRules.js`（48行）

---

### 4.2 B — 任务发布模块

**拥有表（写）：** `task_publish`、`task_audience_rule`、`learner_task_queue`、`learner_task_reminder`、`task_reminder_log`、`campaign_activity`

```
modules/task-publish/
├── crud/
│   └── taskCrud.js                 # 全部 6 张表的 SQL 集中
│      导出（写操作）：
│      createTask / updateTask / deleteTask
│      createAudienceRule / deleteAudienceRule
│      createCampaign / updateCampaign
│      导出（读操作 — 供 A、C 调用）：
│      getTaskList / getTaskById
│      getQueueList / getQueueById
│      getReminderList
│      getReminderLogList / getReminderLogStats
│      getCampaignList / getCampaignById
│      getAudienceRules(taskId)
├── services/
│   ├── taskService.js              # 任务 CRUD、publish 状态机
│   ├── audienceService.js          # 受众规则管理（← taskSmartPublishService）
│   ├── queueService.js             # 待办队列（← assignmentBatch + assignmentProgress）
│   ├── reminderService.js          # 催办逻辑（← autoNudge + nudge 业务逻辑）
│   └── campaignService.js          # 活动管理
├── routes/
│   ├── taskRoutes.js               # /api/v1/tasks/*
│   ├── queueRoutes.js              # /api/v1/queues/*
│   ├── reminderRoutes.js           # /api/v1/reminders/*
│   └── campaignRoutes.js           # /api/v1/campaigns/*
```

**前端：** `views/central/taskManage/`、`api/task/`、`api/campaign/`

**来源文件（12个，~3,200行）：**

| 来源 | 行数 | 目标 | 说明 |
|------|------|------|------|
| `routes/tasks.js` | 726 | taskCrud + taskService + taskRoutes | 39处SQL集中 |
| `routes/assignments.js` | 679 | queueService + queueRoutes | 36处SQL集中 |
| `services/taskSmartPublishService.js` | 218 | audienceService | 业务逻辑提取 |
| `services/assignmentBatch.js` | 64 | queueService | 合并 |
| `services/assignmentProgress.js` | 57 | queueService | 合并 |
| `routes/nudge.js` | 285 | reminderService + reminderRoutes | 13处SQL集中 |
| `services/autoNudge.js` | 230 | reminderService | 8处SQL集中 |
| `services/autoNudgeRules.js` | 48 | reminderService | 规则配置 |
| `routes/notifications.js` | 284 | reminderService | 7处SQL集中 |
| `routes/stores.js` | 101 | — | **不再需要**（门店归 C） |
| `routes/employees.js` | 142 | — | **不再需要**（学员归 C） |

---

### 4.3 C — 系统管理 + 新增页面

**拥有表（写）：** `account`、`reseller_headquarter`、`reseller_store`、`learner_account`、`dictionary`、`mypal_learning_progress_sync` + 5 张 audit_log 表

```
modules/admin/
├── crud/
│   ├── accountCrud.js              # account 表（供 A、B 只读）
│   ├── storeCrud.js                # reseller_headquarter + reseller_store（供 A、B 只读）
│   ├── learnerCrud.js              # learner_account 表（供 A、B 只读）
│   └── dictCrud.js                 # dictionary 表
├── services/
│   ├── authService.js              # 登录验证、JWT（← routes/auth.js）
│   ├── accountService.js           # 账户管理（← routes/auth.js 账户部分）
│   ├── storeService.js             # 经销商/门店管理
│   ├── learnerService.js           # 学员管理
│   └── dictService.js              # 字典管理
├── routes/
│   ├── authRoutes.js               # /api/v1/auth/login|logout|change-password
│   ├── accountRoutes.js            # /api/v1/accounts/*（新增）
│   ├── storeRoutes.js              # /api/v1/stores/*（新增）
│   ├── learnerRoutes.js            # /api/v1/learners/*（新增）
│   └── dictRoutes.js               # /api/v1/dicts/*（新增）

modules/mypal/
├── crud/
│   └── mypalCrud.js                # mypal_learning_progress_sync + audit_log
├── services/
│   └── mypalService.js             # 合并 mypalClient + mypalLink + mypalSign + mypalSyncService
└── routes/
    └── mypalRoutes.js              # 合并 mypal + mypalMock 路由

modules/common/
├── crud/
│   └── auditCrud.js                # 5 张 audit_log 表的统一访问
```

**前端（新增页面）：**
```
views/system/account/                # 账户管理（新增）
views/system/store/                  # 经销商/门店管理（新增）
views/system/learner/                # 学员管理（新增）
views/system/dict/                   # 字典管理（新增）
views/system/mypal/                  # MyPAL 同步监控（新增）
views/system/menu/                   # 菜单管理（已有骨架）
views/system/role/                   # 角色管理（已有骨架）
views/setting/account/               # 个人设置
views/setting/system/                # 系统设置
views/login/                         # 登录页
api/system/account.ts                # 新增
api/system/store.ts                  # 新增
api/system/learner.ts                # 新增
api/system/dict.ts                   # 新增
router/guards.ts                     # 路由守卫
store/modules/user.ts                # 用户状态
```

**来源文件（10个，~1,200行）：**

| 来源 | 行数 | 目标 | 说明 |
|------|------|------|------|
| `routes/auth.js` | 120 | authService + authRoutes | 去SQL |
| `routes/stores.js` | 101 | storeCrud + storeService | 从 B 域移入 |
| `routes/employees.js` | 142 | learnerCrud + learnerService | 从 B 域移入 |
| `routes/mypalMock.js` | 175 | mypalRoutes | 合并 |
| `routes/mypal.js` | 36 | mypalRoutes | 合并 |
| `services/mypalSyncService.js` | 249 | mypalService | 合并 |
| `services/mypalClient.js` | 150 | mypalService | 合并 |
| `services/mypalLink.js` | 33 | mypalService | 合并 |
| `services/mypalSign.js` | 25 | mypalService | 合并 |
| `routes/asr.js` + `services/asrService.js` | 161 | — | 暂平移 |

---

## 5. 跨模块 API 契约

### B → A（只读）

```js
// A 的 dashboardCrud 内部调用 B 的这些函数：
taskCrud.getTaskList({ week, statuses, limit, offset })
taskCrud.getTaskById(id)
taskCrud.getQueueList({ taskId, week, status, storeId })
taskCrud.getReminderList({ week, level, storeId })
taskCrud.getReminderLogStats({ week, groupBy })       // 催办统计聚合
taskCrud.getCampaignList({ fiscalYear, quarterNo })
taskCrud.getAudienceRules(taskId)
```

### C → A（只读）

```js
// A 的 dashboardCrud 内部调用 C 的这些函数：
storeCrud.getStoreList({ region, format, dealer })
storeCrud.getHqList()
learnerCrud.getLearnerList({ storeId })
accountCrud.getAccountList({ role })
accountCrud.getAccountById(id)
```

### C → B（只读）

```js
// B 的 audienceService 内部调用 C 的这些函数做受众圈选：
storeCrud.getStoreList({ region, format, dealer, limit })
learnerCrud.getLearnerList({ storeId, role, limit })
accountCrud.getAccountById(id)                       // 权限校验
```

**硬性规则：** 只能调对方模块 crud 导出的纯函数，禁止直接操作对方模块的表。

---

## 6. 表权限总览

| 表 | 写 | 读 | 说明 |
|-----|----|-----|------|
| `task_publish` | B | B, A | |
| `task_audience_rule` | B | B, A | |
| `learner_task_queue` | B | B, A | |
| `learner_task_reminder` | B | B, A | |
| `task_reminder_log` | B | B, A | |
| `campaign_activity` | B | B, A | |
| `account` | C | C, A, B | |
| `reseller_headquarter` | C | C, A, B | |
| `reseller_store` | C | C, A, B | |
| `learner_account` | C | C, A, B | |
| `dictionary` | C | C | |
| `mypal_learning_progress_sync` | C | C | |
| `mypal_*_audit_log` | C | C | |
| `learner_task_queue_sync_audit_log` | C | C | |
| `learner_task_reminder_sync_audit_log` | C | C | |
| `task_reminder_audit_log` | C | C | |
| `chat_*` | — | — | 排除 |

---

## 7. 执行计划

### Phase 0：A — 框架搭建（Day 1-3）

A 在写任何看板代码之前先搭好全项目骨架，B 和 C 直接在此基础上开发。

| 任务 | 说明 |
|------|------|
| 创建 `modules/common/` | db/connection.js + middleware/* + utils/* + ws/* + responseHelper.js |
| 创建三个模块骨架 | `modules/{dashboard,task-publish,admin,mypal}/` 含 crud/service/route 子目录 |
| 写样板 crud | `modules/task-publish/crud/taskCrud.js`，用 `learner_task_queue` 表写 3-5 个标准函数 |
| `db/index.js` 兼容层 | 保留旧路径，re-export `modules/common/db/connection.js` |
| `app.js` 改造 | 路由改为从 `modules/` 路径加载 |
| 规范文档 | Crud 命名/签名一页纸 + crud 样板文件 |

**产出物：** 完整的目录结构 + 样板代码 + 规范 → B 和 C 可以立刻开始写自己模块的 crud。

### Phase 1：并行开发（Day 4-14）

| 谁 | 任务 | 关键产出 |
|-----|------|----------|
| A | dashboardCrud 聚合查询 → queryEngine → insightService → analyzers → routes | 看板全部前后端 |
| B | taskCrud 6表全SQL → taskService → audienceService → queueService → reminderService → routes | 任务发布全部前后端 |
| C | accountCrud + storeCrud + learnerCrud + dictCrud + mypalCrud → service 层 → routes → 新增页面 Vue + API | 管理员端全部前后端 |

**关键检查点（Day 7）：** B 必须完成 taskCrud 的只读函数（`getTaskList`、`getQueueList`、`getReminderList`、`getCampaignList`），A 依赖这些推进 queryEngine。

### Phase 2：整合与回归（Day 15-18）

| 谁 | 任务 |
|-----|------|
| A | 看板全链路回归（概览/趋势/预警/热力图 正确性） |
| B | 任务发布全链路回归（创建→受众圈选→下发→催办） |
| C | 认证 + 权限回归 + app.js 最终路径切换 |
| 三人 | 联合回归，跑现有测试脚本 |

---

## 8. 三人 GitHub 协作规范

### 8.1 分支策略

```
origin/dev
  └── origin/modular-base           # A 创建 — Phase 0 框架（三人共享基座）
        ├── modular-dashboard        # A — 看板模块
        ├── modular-task             # B — 任务发布模块
        └── modular-admin            # C — 管理员端模块
              │
              ▼
         modular-base  ← 三人各自 PR 合回
              │
              ▼
            dev  ← 最终 PR（MR）
```

**规则**：
- 三人**只在自己的模块分支**上开发，不直接 push 到 `modular-base` 或 `dev`
- 模块间引用只能调对方的 **crud 纯函数**，禁止改对方的文件
- `modular-base` 是三人共享基座，改 `common/` 需要三人协商

### 8.2 初始设置（一次性）

```bash
# A: 创建 modular-base 并推送
git checkout dev
git checkout -b modular-base
# ... Phase 0 开发 ...
git push -u origin modular-base

# B: 从 modular-base 切出模块分支
git fetch origin
git checkout -b modular-task origin/modular-base
git push -u origin modular-task

# C: 从 modular-base 切出模块分支
git fetch origin
git checkout -b modular-admin origin/modular-base
git push -u origin modular-admin
```

### 8.3 日常开发流程

每人每天在自己的模块分支上工作：

```bash
# 1. 确保本地 modular-base 是最新的
git fetch origin
git checkout modular-base
git pull origin modular-base

# 2. 切回自己的模块分支，rebase 最新 base
git checkout modular-task          # (B 的例子)
git rebase modular-base

# 3. 正常开发 + 提交
# ... 写代码 ...
git add <files>
git commit -m "feat(task): 完成 xxx"

# 4. 推送到远程（rebase 后需要 force）
git push --force-with-lease origin modular-task
```

### 8.4 合并到 modular-base

模块功能完成一个阶段后，通过 GitHub PR 合入：

```bash
# 1. 确保已 rebase 到最新 modular-base（见 §8.3 步骤1-2）

# 2. 推送到远程
git push --force-with-lease origin modular-task

# 3. 在 GitHub 上创建 PR：modular-task → modular-base
#    - 标题格式：feat(task): <简述>
#    - 描述中 @ 另外两人做 code review
#    - 确认 CI 通过

# 4. 至少一人 Approve 后，点击 "Squash and Merge" 合入
```

**PR 合并策略**：使用 **Squash and Merge**，保持 `modular-base` 提交历史干净。

### 8.5 Code Review 规则

| 规则 | 说明 |
|------|------|
| 谁 review | 另两人至少一人 Approve |
| 检查什么 | 跨模块引用是否正确（只调 crud）、旧文件是否改桩、SQL 是否集中 |
| review 时限 | 24h 内完成，阻塞他人时需要主动通知 |
| 审批后 | 由 PR 作者自己点击 Merge |

### 8.6 冲突处理

**常见冲突场景**：
- 两人同时改了 `common/` 下的文件（如 errorCodes.js）
- 三人各自新增模块目录，`modules/` 下的文件不会冲突

**处理步骤**：
```bash
# 1. rebase modular-base 时出现冲突
git rebase modular-base
# CONFLICT ... 

# 2. 解决冲突后继续
git add <resolved-files>
git rebase --continue

# 3. 如果冲突复杂，通知相关人一起解决
```

**降低冲突的措施**：
- 每日开始工作前先 rebase `modular-base`
- 改 `common/` 文件前在群里说一声
- 小步提交，频繁同步

### 8.7 提交规范

```
<type>(<module>): <简短描述>

<详细说明（可选）>
```

| type | 用途 |
|------|------|
| `feat` | 新功能/新文件 |
| `fix` | 修复 bug |
| `chore` | 维护性工作（改桩、路径修正） |
| `docs` | 文档 |
| `refactor` | 重构（不改功能） |

示例：
```
feat(dashboard): queryEngine.js ← dashboardQueryCore.js
fix(common): connection.js DB_PATH 修正
chore(dashboard): routes/dashboard.js 改为 re-export 桩
```

### 8.8 Phase 收尾流程

每个 Phase 结束时按以下顺序操作：

```bash
# 1. 各人将自己的模块分支提 PR → modular-base
#    A: modular-dashboard → modular-base PR
#    B: modular-task → modular-base PR
#    C: modular-admin → modular-base PR

# 2. 全部合入后，三人各自拉取最新
git checkout modular-base
git pull origin modular-base

# 3. 三人联合回归验证

# 4. modular-base → dev 最终 PR
#    在 GitHub 上创建 PR：modular-base → dev
#    标题：feat: Phase X 模块化重构
```

### 8.9 常用命令速查

```bash
# 查看各分支状态
git log modular-base --oneline -5
git log modular-task --oneline -5

# 查看自己的分支领先 base 多少
git rev-list --count modular-base..modular-task

# 查看 base 上别人合入了什么
git log modular-base --oneline --since="1 day ago"

# 撤销本地提交（还没 push）
git reset --soft HEAD~1

# 暂存当前工作
git stash
git rebase modular-base
git stash pop
```

---

## 9. 风险

| 风险 | 缓解措施 |
|------|----------|
| 新 DB schema 尚未建成，crud 层无法测试 | 要求 DB 组先提供各表的 CREATE TABLE DDL；crud 函数用 DDL 做单元测试 |
| `dashboardQueryCore.js` 1208行 SQL 迁移可能引入查询 bug | A 先写测试锁定当前输出，SQL 原样移到 crud 后再适配新表名 |
| `routes/tasks.js` 39处 SQL 与业务逻辑深度交织 | B 优先处理 tasks.js，验证模式可行后再推其他文件 |
| B 的 crud 只读函数未完成时 A 无法推进 | Day 7 硬检查点：B 的 4 个核心只读函数必须可用 |
| 多人改 import 路径导致合并冲突 | Phase 2 由 C 统一做最终路径切换 |
| Executive Chat 依赖 `db/index.js` | `db/index.js` 保持向后兼容 re-export |
| 旧 notification/nudge 前端页面依赖独立 API | A 前端改为调 B 的 `/api/v1/reminders/` 端点；过渡期可保留旧端点做代理 |

---

## 10. 附录：完整文件清单

### 待模块化文件（按归属）

**→ A: Dashboard（7个来源文件）**
```
services/dashboardQueryCore.js (1208行)
services/dashboardInsightService.js (759行)
services/dashboardSubAgents/* (7文件, 762行)
services/executiveMetricsQueryService.js (235行)
routes/dashboard.js (90行)
routes/dashboardInsights.js (45行)
```

**→ B: Task Publish（12个来源文件）**
```
routes/tasks.js (726行)
routes/assignments.js (679行)
routes/nudge.js (285行)
routes/notifications.js (284行)
services/taskSmartPublishService.js (218行)
services/autoNudge.js (230行)
services/autoNudgeRules.js (48行)
services/assignmentBatch.js (64行)
services/assignmentProgress.js (57行)
routes/stores.js (101行)           —— 不再需，逻辑归 C
routes/employees.js (142行)        —— 不再需，逻辑归 C
```

**→ C: Admin + MyPal（10个来源文件）**
```
routes/auth.js (120行)
routes/stores.js (101行)           —— 从 B 移入
routes/employees.js (142行)        —— 从 B 移入
routes/mypalMock.js (175行)
routes/mypal.js (36行)
services/mypalSyncService.js (249行)
services/mypalClient.js (150行)
services/mypalLink.js (33行)
services/mypalSign.js (25行)
routes/asr.js + services/asrService.js (161行)
```

### 保持不变

```
agent/                              chat_tools/
prompts/                            routes/chat.js
services/chatService.js             services/chatAgentRunner.js
services/chatSessionStateService.js services/chatMemoryService.js
services/chatIntentService.js       services/chatAnswerService.js
services/chatAnalyticsService.js    services/chatToolsService.js
services/dashboardAgentService.js   routes/dashboardAgent.js
jobs/dashboardAgentScheduler.js     jobs/autoNudgeScheduler.js
db/schema.sql                       db/seed.js
middleware/*（4文件，平移至 modules/common/middleware/）
utils/*（12文件，平移至 modules/common/utils/）
ws/*（2文件，平移至 modules/common/ws/）
```


---

## 11. 附录：相关文档索引

> 用途：帮助 AI 和新成员快速定位文档，区分模块化重构前后的新旧文档。

### 11.1 模块化重构文档（新 — 当前有效）

> **AI 入口**：`docs/plans/index.md` — 单文件导航，按任务类型指引阅读路径。

| 文档 | 路径 | 用途 |
|------|------|------|
| **文档导航** | `docs/plans/index.md` | AI 入口，7 类任务的阅读路径 + 快速链接 |
| **重构总方案**（本文件） | `docs/plans/2026-05-12-modularization-plan.md` | 整体架构、模块划分、执行计划 |
| **进度追踪** | `docs/plans/2026-05-13-modularization-progress.md` | 三人完成度、Phase 2 待办、app.js 切换清单 |
| **编码规范** | `docs/CODING-STANDARDS.md` | 三层架构、命名、响应格式、错误码 |
| **Agent 重构** | `docs/plans/2026-05-11-agent-refactor-plan.md` | Agent 框架重构计划（并行工作） |
| **CLAUDE.md** | `CLAUDE.md` | 项目级 AI 助手指令（含模块化进度指针） |

### 11.2 产品/系统规格（旧 — 参考）

| 文档 | 路径 | 用途 |
|------|------|------|
| 数据模型 | `docs/specs/01-DATA-MODEL.md` | 旧表结构（模块化重构中正在替换） |
| API 规范 | `docs/specs/04-API-SPEC.md` | 接口定义 |
| 通知/催办 | `docs/specs/05-NOTIFICATION-NUDGE.md` | 催办逻辑说明 |
| 看板 KPI | `docs/specs/06-DASHBOARD-KPI.md` | 指标口径定义 |
| 权限模型 | `docs/specs/08-PERMISSION-MODEL.md` | 角色权限矩阵 |
| Executive Chat | `docs/specs/09-EXECUTIVE-CHAT.md` | EChat 需求说明 |
| ER 图 | `docs/er-diagram-graphviz.svg` | 新数据库 schema 设计 |

### 11.3 架构/技术文档（维护中 — 代码路径随重构变化）

> 说明：这些文档仍在维护，但其中引用的代码路径可能已随模块化重构改变。状态栏标注了需要注意的差异，阅读时以实际代码路径为准。

| 文档 | 路径 | 状态 |
|------|------|------|
| 后端路由 | `docs/backend/01-ROUTES.md` | 引用的路由文件已部分迁移到 modules/ |
| 后端服务 | `docs/backend/02-SERVICES.md` | 引用的服务文件已部分迁移到 modules/ |
| 数据库 | `docs/backend/03-DATABASE.md` | 旧表名，新 schema 见 `er-diagram-graphviz.svg` |
| 看板模块审计 | `docs/backend/07-DASHBOARD-MODULE.md` | 技术审计报告，记录当前 `modules/dashboard/` 代码质量 |
| 新人上手 | `docs/team-onboarding.md` | 环境搭建 + 分支规范，持续更新 |
| 技术债 | `docs/internal/TECH-DEBT.md` | 已知问题清单 |
| 文档总索引 | `docs/README.md` | 所有文档的目录 |

### 11.4 归档（旧 — 不再维护）

| 文档 | 路径 |
|------|------|
| 归档索引 | `docs/archive/index.md` |
| 历史计划 (2026-03 ~ 2026-04) | `docs/archive/plans/` |
| Superpowers 时期 | `docs/archive/superpowers/` |

### 11.5 AI 使用指南

当 AI 需要查找信息时的优先级：

1. **先读当前有效的新文档**（§11.1）— 反映最新架构
2. **再查产品规格**（§11.2）— 理解业务需求
3. **再参考架构/技术文档**（§11.3）— 仍在维护，但代码路径可能随重构变化
4. **不要使用归档文档**（§11.4）— 除非明确需要历史上下文

区分文档时效的方法：
- `docs/plans/2026-05-*`：模块化重构时期新建文档，当前权威
- `docs/archive/`：归档文档，**不再适用**
- `docs/backend/`、`docs/internal/`：参考文档，仍在维护但代码路径可能已变化，以实际代码为准
- 看文件头部的日期和分支标注
