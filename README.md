# TOT 培训任务管理系统 - 前后端联调进度文档

本文档记录 `TOT_joint`（TOT-Apple 培训任务管理系统 MVP P0）当前的前后端集成状态。系统分为 **总部端 (Central)** 与 **店员端 (Employee)**，后端为 Node.js（Express + SQLite），前端为 Vue 3 + Vite。

> **更新日期：2026 年 4 月 3 日**

---

## 1. 基础设施与通信约定

| 项目 | 说明 |
|------|------|
| **HTTP 基址** | 前端通过环境变量配置 `apiUrl`；业务接口统一前缀 **`/api/v1`**（由 Alova `beforeRequest` 拼接 `urlPrefix` + `apiUrl`）。 |
| **鉴权** | `Authorization: Bearer <JWT>`；登录见 `POST /api/v1/auth/login`，会话校验见 `GET /api/v1/auth/me`。总部账号 JWT 通常无 `employeeId`；店员账号含 `employeeId`。 |
| **数据库** | `better-sqlite3` 同步读写；本地库需与 `TOT_backend/server/db/schema.sql` 一致（含 `tasks.auto_nudge_rules`、`tasks.start_at`、`tasks.pass_score` 等）。若旧库缺列，可删除 `TOT_backend/server/database.db`（及 `-wal`/`-shm`）后执行 `node db/seed.js` 重建（详见 `TOT_backend/README.md`）。 |
| **实时通道** | `WebSocket` 路径 **`/ws?token=<JWT>`**（与 HTTP 同机不同路径）。见下文「WebSocket 行为」。 |
| **前端请求层** | Alova：`cacheFor: null` 关闭全局缓存；GET 任务列表、任务详情、看板统计等关键接口另设 `localCache: 0`。 |

---

## 2. 后端已挂载的路由模块（与前端联调相关）

在 `TOT_backend/server/app.js` 中注册，前缀均为 `/api/v1`：

| 模块 | 路径前缀 | 前端主要使用场景 |
|------|-----------|------------------|
| 认证 | `/auth` | 登录、拉取当前用户 |
| 任务 | `/tasks` | 总部任务 CRUD、下发、AI 说明、自动预警扫描 |
| 门店 / 员工 | `/stores`、`/employees` | 种子与后台数据（视具体页面） |
| 下发记录 | `/assignments` | 店员开始/完成、总部侧列表（视路由） |
| 通知事件 | `/events` | 店员端事件列表、已读 |
| 催办 | `/nudges` | 总部手动催办等（若页面已接） |
| **看板聚合** | **`/dashboard`** | **总部实时看板 KPI、热力、趋势** |

---

## 3. 总部端 (Central) — 已联调能力

### 3.1 任务管理（发布 / 编辑）

| 能力 | 后端 | 前端（典型路径） |
|------|------|------------------|
| 创建草稿 / 带参创建 | `POST /tasks` | `taskManage` / 发布页，需 `title`、`startAt`、`passScore`、`ddlAt`、平台勾选、可选 `autoNudgeRules` |
| 任务列表 | `GET /tasks` | 总部列表、实时看板左侧任务卡 |
| 任务详情 | `GET /tasks/:id` | 发布页编辑回显、看板「已布置的任务」展开详情 |
| 更新任务 | `PATCH /tasks/:id` | **草稿**：可改全量业务字段；**已下发**：仅允许改 **`ddlAt`** 与 **`autoNudgeRules`**（其余字段后端拒绝，错误码见后端） |
| 下发 | `POST /tasks/:id/dispatch` | 发布页下发 |
| 删除 | `DELETE /tasks/:id` | 看板任务卡删除 |
| AI 生成说明 | `POST /tasks/ai-generate-description` | 发布页 DeepSeek skill，展示为纯文本 |
| 自动预警扫描 | `POST /tasks/:id/auto-nudge` | 实时看板「运行预警扫描」，触发 `services/autoNudge.js` |

**说明**：自动预警规则引擎在服务端已实现；**无人值守定时扫描未做**，需总部手动点「运行预警扫描」或在外部用 Cron 调同一接口（见本文档第 6 节）。

### 3.2 实时看板（`/central/board`）— 与 `/dashboard` 联调详情

总部选中 **已下发** 任务时，前端并行请求以下接口，**全部使用真实聚合数据**（无随机数占位）：

| 接口 | 用途 | 前端映射 |
|------|------|----------|
| `GET /dashboard/overview?taskId=` | 北极星、漏斗、执行异常三类指标 | `onTimeCompletionRate`、`avgCompletionTimeHours`、`taskReachRate`、`taskReadRate`、`nudgeConversionRate`、`startDelayRate`、`crisisP1Rate`、`crisisP0Rate` |
| `GET /dashboard/heatmap?taskId=&rtmLevel=rtm` | 分桶进度（默认按门店 `rtm`） | 卡片「分 RTM L3 进度拆解」；**维度名称以数据库 `stores.rtm` 为准** |
| `GET /dashboard/trend?taskId=&type=daily` | 按完成日聚合的完成人数趋势 | 折线/柱图「日」维度 |
| `GET /dashboard/trend?taskId=&type=hourly&date=YYYY-MM-DD` | 指定日按小时聚合 | 「时」维度与日期下拉 |

**草稿任务**：不调上述接口，界面展示全 0 /「暂无数据」占位，避免无意义请求。

**后端指标含义提示（非前端造假，但需知悉）**：

- **`taskReachRate`**：当前实现下，有 assignment 时常为 **100%**（代码注释含义为「创建即触达」），与真实「推送到达率」若需严格一致，需后续迭代埋点或表结构。
- **读取率 / 催办转化率**：依赖 `read_receipts`、`notification_events`、`nudge_count` 等；种子数据或业务流程未写入时，界面可能长期为 **0**。
- **执行异常三张卡**：与 `notification_events` 中自动预警产生的事件及 `dedupe_key` 规则相关；若从未跑过自动预警扫描，占比可能为 **0**。

### 3.3 总部 WebSocket

- **连接条件**：JWT `role` 为 `central` / `admin` / `executive` 且无 `employeeId` 时，服务端允许连接（见 `TOT_backend/server/ws/manager.js`），用于接收 **`task_updated`**。
- **事件 `task_updated`**（已下发任务被 PATCH 修改 `ddlAt` 或 `auto_nudge_rules` 后）：负载包含 **`taskId`、`ddlAt`、`autoNudgeRules`**。总部看板用于刷新当前列表中的截止日与规则展示，并可重新拉取看板统计（与接口层一致）。

---

## 4. 店员端 (Employee) — 已联调能力

| 能力 | 后端 | 说明 |
|------|------|------|
| 本人任务列表 | `GET /tasks` | Banner、瀑布流；未完成 assignment；倒计时基于 `ddlAt` |
| 通知事件 | `GET /events` | `nudge_yellow` / `nudge_red` / `task_assigned` 等；`isActive` 过滤与未读角标 |
| 标记已读 | `POST /events/:eventId/read` | 关闭预警卡片等 |
| 未读数 | `GET /events/unread-count` | 角标（若页面已接） |
| 整单完成 | `PUT /assignments/:id/status`，`{ operationType: 'complete_task' }` | 更新 `task_assignments` 完成态与进度 |
| **WebSocket** | 同 `/ws?token=`，**需 JWT 含 `employeeId`** | `nudge_sent`：催办内容瀑布流；`task_assigned`：新任务提示等（见店员页实现） |

店员端 **不**使用总部 `broadcastToHq`；店员接收的是按 `employeeId` 下发的业务事件。

---

## 5. 数据落库与关键表（联调对照）

| 能力 | 主要数据表 |
|------|------------|
| 总部任务与预警规则 JSON | `tasks`（`auto_nudge_rules` 等） |
| 每人每任务进度与完成态 | `task_assignments` |
| 任务/催办通知 | `notification_events` |
| 催办审计 | `nudge_records` |
| 已读回执（读取率等） | `read_receipts`（与 `notification_events` 关联） |

---

## 6. 待完善 / 可选增强

| 项目 | 说明 |
|------|------|
| **定时自动预警** | 服务端无内置 Cron；需总部手动「运行预警扫描」或外部调度调用 `POST /tasks/:id/auto-nudge` / 内部 `evaluateAndTriggerAutoNudges`。 |
| **按平台分步完成** | 若产品以 `complete_platform` 为主路径，需与各学习平台回调及 assignments 接口进一步联调。 |
| **看板扩展** | 后端另有 `GET /dashboard/store-rank`、`/warnings`、`/store-detail` 等，前端可按需在总部加模块对接。 |
| **统计口径产品化** | `taskReachRate` 恒定 100%、漏斗与 PRD 文案若需严格一致，需与产品确认后改聚合逻辑或埋点。 |

---

## 7. 快速启动与测试账号

### 后端

```bash
cd TOT_backend/server
npm install
node db/seed.js   # 首次或重置库后
npm run dev       # 默认端口 3000
```

### 前端

```bash
cd TOT_frontend
pnpm install（npm install不行就用pnpm）
pnpm run dev      # 默认端口8001
（npm run dev也行）
```

### 不同端入口

- **总部入口**：`http://<前端端口>/hq`。
- **店员登录**：`http://<前端端口>/employee`。

更完整的 API 与模块说明见 **`TOT_backend/README.md`** 与 **`TOT_backend/docs/specs/`**。
