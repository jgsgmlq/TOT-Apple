# ToT API 接口定义文档

### v1.5.7（2026-05-09）

- **看板诊断 → 多 Agent 协作架构**：`GET /dashboard/agent/diagnose` 由「主 Agent + 4 个区域子 Agent」协作生成。后端 `server/services/dashboardSubAgents/` 在主 Agent 触发前对每个 dispatched 任务并行运行 4 个子 Agent —— **`funnelAnalyzer`**（转化漏斗）、**`warningAnalyzer`**（预警风险漏斗）、**`trendAnalyzer`**（完成趋势）、**`rtmAnalyzer`**（RTM/门店进度排行），全局并发上限 6（`runRegionAnalyzers`）。每个子 Agent 都基于 **`dashboardQueryCore`** 的同源数据切片调用 `simpleChat (deepseek-chat)`，强制返回 `{ severity, summary, keyFindings, focusHint }`，LLM 异常时 analyzer 内置模板化降级（带 `degraded=true`）。主 Agent 通过 **`query_active_tasks`** 看到的每个任务对象 **不再**包含 `boardView`，而是仅含 **`taskId` / `title` / `ddl_at` / `avgProgressPercent` / `regionInsights`**（4 段子 Agent 文案）。子 Agent 单次输出**不缓存**，主 Agent 自身 `dashboard_insights(global_agent)` 缓存策略保持不变。
- **`/dashboard/warnings` 与 `/dashboard/nudge-conversion` 路由薄壳化**：原内嵌的 SQL/聚合逻辑迁移至 **`dashboardQueryCore.js`** 的 **`getWarningsBoardData`** / **`getNudgeConversionBoardData`**，HTTP 路由与 `warningAnalyzer` 共用同一函数，根除"口径漂移"。同时修正了原 `/warnings` 的 `triggerDesc` 模板字符串误转义 bug（前端 description 现在显示真实小时数与人数）。

### v1.5.6（2026-05-08）

- **看板 Agent 输入与看板 KPI 同源**：生成 `GET /dashboard/agent/diagnose` 时，每个活跃任务的 **`query_active_tasks`** 载荷仅含 **`taskId` / `title` / `ddl_at` / `boardView`**。其中 **`boardView.overview`** 与 **`GET /dashboard/overview?taskId=`** 的 **`data`** 同函数拼装，并附加 **`avgProgressPercent`**；**`heatmap_rtm`** / **`heatmap_store`** 与 **`GET /dashboard/heatmap`**（`rtmLevel=rtm` / `store`，过长时截取低完成率桶）；**`trend_daily`** 与 **`GET /dashboard/trend?type=daily`** 同源（过长时保留最近若干日）。**不再**下发旧的 `metrics` / `funnel` / `warningRates` 平行摘要。终端 `console.log` 对深层对象常显示为 `[Object]`，不代表发给大模型的 tool 结果被截断。**注：v1.5.7 起 `boardView` 被 `regionInsights` 取代。**

### v1.5.5（2026-04-30）

- **任务合集按平台颗粒度统计**：看板 **`GET /dashboard/overview`、`/heatmap`、`/store-rank`、`/warnings`、`/trend`、`/nudge-conversion`** 支持可选查询参数 **`platform`**（与 `PUT /assignments/:id/status` 的 `complete_platform` 使用同一套平台别名解析，实现见 **`server/utils/platforms.js`**）。传入后：完成/未完成人数、完成率、趋势与催办转化等以对应 **`task_assignments.*_completed`** 列为「完成」判定；**进行中 / 待开始** 与 **`employeeReadCount`** 与 **`read_receipts.source = task_detail_open:{平台标签}`** 精确匹配（如 `task_detail_open:MyPAL`）。**未传 `platform`** 时：**`employeeReadCount`** 仍为 **`source = 'task_detail_open'`**（精确，**不含**带 `:平台` 后缀的回执——与旧版「整单已读」写入一致）。**`taskReachRate`**：未传 `platform` 时为登录 / `received_at` 条件；传 `platform` 时为「存在该 **`source`** 的平台详情已读回执」的 **EXISTS** 子查询。非法 `platform` → **400 `DASH_006`**。成功响应 **`data.platform`** 回显规范化标签（`MyPAL` / `SmartSales` / `AiDemo` / `LiveBroadcast`）或 **`null`**（未传参时与旧版一致）。
- **已读回执按平台分源**：**`POST /assignments/:id/viewed`** 支持可选 **`?platform=`**；写入 **`read_receipts.source`** 为 **`task_detail_open`**（未传平台）或 **`task_detail_open:{平台标签}`**。同一用户、同一 `task_assigned` 事件可对不同平台各有一条回执；**`UNIQUE(event_id, user_id, source)`**。传 `platform` 时须任务 **`tasks.has_*`** 已开启该平台，否则 **400 `ASSIGN_015`**；非法值 **400 `ASSIGN_012`**。响应体增加 **`source`**、**`platform`**；看板 WS **`dashboard_updated`** 的 **`data`** 可含 **`platform`**。
- **未读与列表已读判定**：**`GET /events/unread-count`**、**`GET /events`** 对 `read_receipts` 使用 **`(event_id,user_id)` 聚合子查询**（同人多 `source` 时取最早 **`read_at`**），只要任一来源已读即不计未读。

### v1.5.4（2026-04-27）

- **智能洞察模块解耦**：为配合前端布局拆分，新增了独立的 `conversion_funnel` (转化漏斗) 洞察类型。原先与北极星指标共享的漏斗分析现在拥有独立的持久化缓存和专用的 AI Prompt 诊断；并将原 `funnel_alerts` (预警中心) 的 AI 分析口径完全缩窄至专注逾期率与催办有效性转化率。

### v1.5.3（2026-04-21）

- **新增催办转化率看板接口**：新增 `GET /api/v1/dashboard/nudge-conversion` 以支持对各下钻维度（门店/大区）的红/橙/黄各级别历史累计催办下发人数与真实转化完课人数的统计报表。
- **看板智能 Agent 进阶重构**：看板智能 Agent 诊断接口 (`GET /dashboard/agent/diagnose`) 的底层逻辑已从单次调用升级为完整的 **ReAct 架构** 结合 **Tool Calling** (函数调用)。Agent 现在能在后台执行循环对话，自主决定何时调用预设工具：`read_agent_guidelines`（读取本 Agent 的历史经验规则）、`query_active_tasks`（获取当前实时任务看板数据），并且在得出分析结果时通过 `upsert_agent_guidelines`（追加新规则到系统全局的 `agent_guidelines` 表内）实现**单行覆写式维基记忆与自我进化**，做到越用越聪明且不膨胀。
- **预警级别扩充 (Orange)**：在原有的 `red` (p0) 和 `yellow` (p1/p2) 基础上，新增了 `orange` 级别。当前的自动预警映射关系变更为：距离截止时间不足 24h 的 P0 危机预警为 `red`；距离不足 48h 的 P1 危机预警为 `orange`；进度掉队 (progressLag) 及时间进度过半 (P2) 统归为 `yellow`。`notification_events` 及 `nudge_records` 表的约束均已同步更新，接口均已支持传入和返回 `orange`。
- **任务撤销**：新增 `POST /tasks/{id}/revoke` 接口。允许将已下发（`dispatched`）的任务进行撤销并直接删除。调用后，服务端会自动级联物理删除关联的 `task_assignments`、`notification_events`、`nudge_records`、被引用的 `read_receipts` 以及看板洞察记录 `dashboard_insights`，最后彻底删除 `tasks` 表中的主记录，并下发 `task_deleted` WebSocket 事件通知受影响店员，确保任务卡片从店员 UI 上直接移除。
- **过期任务查询**：在 `GET /tasks` 和 `GET /assignments` 接口中，支持了 `status=overdue` 的查询参数过滤，用于筛选已过期（`ddl_at` < 当前时间）且未完成的员工任务。
- **任务类型与子任务配置**：在任务管理 (`Task`) 对象中新增 `subTasksConfig`（JSON）字段，支持为同一任务下不同学习平台（如 MyPAL、SmartSell 等）配置独立描述。创建与修改任务接口（`POST /tasks`、`PATCH /tasks/{id}`）同步支持该字段。

### v1.5.2（2026-04-17）

- **实时语音合成 TTS（百炼 Qwen-TTS Realtime）**：`server/app.js` 挂载 **`setupTtsRealtimeWebSocket`**，浏览器通过 **`WebSocket`** **`/ws/tts?token=<JWT>`** 连接（角色 **`executive`** / **`central`** / **`admin`**）；服务端用同一套 **`ASR_API_KEY` / `DASHSCOPE_API_KEY`** 转发至 **`wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen3-tts-flash-realtime`**（见 **`server/ws/ttsRealtime.js`**）。客户端事件：`session.update` 由代理在连接成功后自动下发；客户端发送 **`input_text_buffer.append`**（`type: append`）与 **`session.finish`**（`type: finish`）；服务端透传上游 JSON（含 **`response.audio.delta`**）。详见 §6.7。Executive Chat 前端可开关「语音」与 SSE 并行。

### v1.5.1（2026-04-17）

- **语音转写（百炼 ASR）**：`server/app.js` 挂载 **`/api/v1/asr`**；新增 **`POST /asr/transcribe`**，`central` / `admin` 鉴权；服务端使用 **`ASR_API_KEY`**（或 **`DASHSCOPE_API_KEY`**）调用百炼 OpenAI 兼容 **`/chat/completions`**，模型默认 **`qwen3-asr-flash`**。详见 §6.6。

### v1.5.0（2026-04-16）

- **预警监控多维度下钻**：`GET /dashboard/warnings` 新增 **`level`** 查询参数，支持：`store`（默认）、`rtm`、`format`、`dealer`（或 `dealer_name`）。响应体 `data.list` 增加 **`targetId` / `targetName` / `targetType`** 统一字段（同时保留 `storeId`/`storeName` 兼容字段）。
- **种子数据增强**：`seed.js` 扩展了 3 个专项预警测试任务（`TASK_WARN_START`, `TASK_WARN_P1`, `TASK_WARN_P0`）并配置了相应的员工进度画像；脚本末尾新增自动触发预警扫描逻辑，确保生成真实的 `notification_events` 以供看板概览率值对账。

### v1.4.23（2026-04-15）

- **WebSocket `task_assigned`**：向在线店员推送成功时 **不再** 更新 `task_assignments.received_at`（避免与「详情已读」混淆）；改为更新 **`users.last_login_at`**，使看板 **`taskReachRate`** 中「下发后登录」条件覆盖 **WS 实时送达**（`u.last_login_at >= ta.created_at`）。`received_at` 仍由 **`POST /assignments/:id/viewed`**、**开始任务** 等路径按原语义写入。实现见 `server/ws/manager.js`。

### v1.4.22（2026-04-14）

- **已读主路径**：移除 **`POST /api/v1/events/{eventId}/read`**（原 `notification_click`）。员工侧 **`POST /api/v1/assignments/{assignmentId}/viewed`** 为写入 **`read_receipts`** 的主入口（**`source`** 为 **`task_detail_open`** 或 **`task_detail_open:{平台}`**，见 **v1.5.5**）；若此前无 `task_assigned` 通知行（如 batch-create），服务端在事务内**补建**与 dispatch 同 **`dedupe_key`** 的 `notification_events` 后再写回执。新建回执时向看板推送 **`operationType: assignment_viewed`**。

### v1.4.21（2026-04-14）

- **时间口径统一（本地墙钟）**：`utils/ddlAt.js` 中 **`parseDateToSqliteLocal`** / **`formatNowSqliteLocal`** 为任务时间与「当前时刻」写入的唯一规范化入口；**废弃**原「仅 UTC」语义（`parseDdlAtToSqliteUtc` 仍为同名别名）。SQLite 默认值与 SQL 比较改为 **`datetime('now', 'localtime')`**（`schema.sql`、`db/index.js` 迁移脚本、看板逾期条件等）。路由与服务中 **`new Date().toISOString()`** 写入库/JSON 处已替换为 **`formatNowSqliteLocal()`**。详见 `ddlAt.js` 头注释与 `01-DATA-MODEL.md` 设计约定。

### v1.4.20（2026-04-14）

- **`POST /tasks/ai-smart-publish`**：响应中的 **`startAt` / `ddlAt`** 改为与 **`startTime` / `endTime`** 一致的 **本地墙钟** `YYYY-MM-DD HH:MM:SS`（可直接填入 **`POST /tasks`**）；不再使用 `parseDdlAtToSqliteUtc` 的结果字符串作为响应值，避免出现与东八区等相比 **少 8 小时**的 UTC 展示误解。落库时仍由创建任务接口统一做 UTC 规范化。见 §2.10。

### v1.4.19（2026-04-14）

- **`POST /tasks/ai-smart-publish`**：响应 **`data`** 仅保留 **`taskName` / `passingScore` / `startTime` / `endTime` / `taskDetails` / `startAt` / `ddlAt`**，不再重复返回与 `taskName`/`taskDetails`/`passingScore` 同义的 `title`/`description`/`passScore`；创建任务时在客户端映射为 `POST /tasks` 字段即可。见 §2.10。

### v1.4.18（2026-04-14）

- **任务智能发布解析**：新增 **`POST /tasks/ai-smart-publish`**（`central` / `admin`）。请求体传入自然语言 **`input`**（或 **`userInput`** / **`instruction`**），服务端注入当前系统时间，调用 **DeepSeek** 按 Apple Retail 培训运营 Prompt 输出 **`task_name` / `passing_score` / `start_time` / `end_time` / `task_details`**（含文案润色），并附加 **`startAt` / `ddlAt`**（与 **`startTime` / `endTime`** 同为本地墙钟，可直接用于 **`POST /tasks`** 请求体）。**不重复**返回 `title`/`description`/`passScore`（与 `taskName`/`taskDetails`/`passingScore` 同义，前端创建任务时自行映射）。详见 §2.10。

### v1.4.17（2026-04-14）

- **看板智能洞察模型路由**：`POST /dashboard/insights` 请求体可选 **`reasoning`**（`boolean`，默认 `false`）。为 **`true`** 时使用 **`deepseek-reasoner`**（深度思考，流式中 **`delta`** 可带 **`phase`: `reasoning` | `content`**）；否则使用 **`deepseek-chat`**。成功 **`done.data`** 返回 **`model`**、**`reasoning`** 便于客户端展示本次选用模型。

### v1.4.16（2026-04-14）

- **看板智能洞察固定 SSE**：`POST /dashboard/insights` **始终**返回 **`text/event-stream`（SSE）**（不再提供单次 JSON 200 正文）：事件 **`delta`** 推送正文增量；**`done`** 的 `data` 为 **`{ code, message, data, requestId }`**，其中内层 **`data`** 与原先 JSON 成功体中的 **`data`** 字段结构一致；**`error`** 表示生成或落库失败。本接口**仅调用 DeepSeek 流式 API**（需 **`DEEPSEEK_API_KEY`**），不做 Floodgate/Gemini 回退。

### v1.4.15（2026-04-14）

- **看板临期预警与自动预警对齐**：`GET /dashboard/overview` 的 **`warningCount`**、`GET /dashboard/warnings` 的临期分级与 **`evaluateAndTriggerAutoNudges`** 共用 **`services/autoNudgeRules.js`**（`tasks.auto_nudge_rules.deadlineCrisis` 的 **p0/p1** 小时；未配置 **deadlineCrisis** 不计临期；**hoursLeft ≤ 0** 不计入临期档）。概览按 **门店 + 任务** 聚合计数。
- **自动预警重构**：`services/autoNudge.js` 临期分支改为调用上述共用函数，避免与看板口径漂移。
- **Seed**：`seed.js` 对示例任务 **`UPDATE` 默认 `auto_nudge_rules`**（含 `deadlineCrisis`），便于本地联调；需重新执行 seed 后生效。
- **规格**：`06-DASHBOARD-KPI.md` 同步更新预警计数与 `/warnings` 说明。

### v1.4.14（2026-04-13）

- **看板智能洞察类型重构**：`POST /dashboard/insights` 由旧 `module` 升级为 `insightType` 分发，支持：`north_star`（北极星）、`completion_weekly`（完成人数周趋势）、`completion_daily`（完成人数日内时段）、`channel_north_star`（分渠道北极星下钻）、`funnel_alerts`（链路数据 + 预警率合并）。服务端仍兼容旧 `module` 入参并自动映射。
- **洞察存储口径对齐**：`dashboard_insights.module_type` 枚举同步改为上述 5 类洞察类型；旧数据通过迁移函数自动映射到新枚举（见 `server/db/index.js#migrateDashboardInsightModuleTypes`）。
- **产品与接口命名对齐**：§5.7.1 增补「北极星 / 完成人数趋势 / 区域进度与门店排行 / 漏斗链路数据 / 预警率统计」五个前端模块与 `insightType`、`module_type`、Prompt 数据口径的对照表；`03-DATABASE.md` §12 同步简表。

### v1.4.13（2026-04-13）

- **看板智能洞察投票**：赞/踩仅累加 **`dashboard_insights.up_count` / `down_count`**，不记录投票人。

### v1.4.12（2026-04-13）

- **看板智能洞察**：新增 **`POST /dashboard/insights`**（后续已升级为 `insightType` 分发；详见 v1.4.14 与 §5.7），基于看板同源聚合数据调用 LLM 生成短文案，落库表 **`dashboard_insights`**；**`POST /dashboard/insights/{insightId}/vote`** 提交点赞/点踩（`vote`: `up` | `down`）。详见 §5.7。

### v1.4.11（2026-04-01）

- **看板门店下钻（可选）**：`GET /dashboard/overview`、`/heatmap`、`/store-rank`、`/warnings`、`/trend` 支持可选查询参数 **`rtm`、`format`、`dealerName`、`storeId`**（可组合，AND，对应 `stores` 表：`rtm` → `format` → `dealer_name` → `id`）。不传参时与旧行为一致。概览中 **推送人数 / 已读人数** 在下钻且带 **`taskId`** 时与 assignment 口径一致（经 `notification_events`/`read_receipts` 与 `stores` 关联过滤）。**热力图** `rtmLevel` 新增 **`dealer` / `dealer_name` / `dealername`**（按经销商名聚合）、**`store`**（按门店聚合，`rtmValue` 为店名）。

### v1.4.10（2026-04-10）

- **AI 解析任务**：新增 `/tasks/ai-parse` 接口，支持一键根据自然语言解析任务信息并格式化返回所有任务所需的创建字段。
- **店员任务筛选**：店员端 `/tasks` 列表新增 `status=completed` 支持，满足已完成任务的历史记录查询。
- **已读**：员工打开任务详情调用 **`POST /assignments/:id/viewed`** 写 `received_at` 与 `read_receipts`（见 §4.3）；**`/events/:eventId/read` 已移除**。
- **看板触达率优化**：记录了用户最新登录时间（`last_login_at`）和任务接收时间（`received_at`），并且在WebSocket连接触达时也会计算在内，只把任务下发后成功触达的人算进 `taskReachRate`。
- **时间格式**：后端涉及的 `startAt`、`ddlAt` 等出入参及大模型生成的格式规范统一变更为无 T 无 Z 的 `YYYY-MM-DD HH:MM:SS`。
- **预警催办简化**：保留了原有的定时预警服务（`/tasks/:id/auto-nudge` 以及后台的 `autoNudgeScheduler`），但文案不再调用 AI 进行润色，直接返回设定的规则触发原文。

### v1.4.9（2026-04-09）

- **§2 Task API（`routes/tasks.js`）**：
  - **GET `/tasks/{id}`**：经 `requireTaskAccess`，**仅 `central` / `admin` / `employee`**；**`executive` 无 assignment 关联时 403**（`AUTH_003`）。与「所有已认证角色」表述不一致处已改正。
  - **Task 对象**：补充 **`mypalTaskWeek`、`mypalProductName`**（与 `formatTask` / DB 一致）。
  - **POST 创建**：`hasMypal=true` 时 **`mypalTaskWeek` 必填**，否则 **400 `TASK_007`**（与代码一致）。
  - **PATCH 已下发任务**：除 **`ddlAt`** 外，允许更新 **`autoNudgeRules`**（与 `UPDATE … ddl_at, auto_nudge_rules` 一致）；改其他字段仍为 **400 `TASK_004`**；**仅改规则时仍须带 `ddlAt`**（见 §2.3）。
- **§2 文档勘误**：修正 Task 类型块中 **「平台」** 乱码。
- **§6 / §7**：标明 **`/chat/*`、`/ai/deepseek/*`、`/permissions/check`** 当前 **未挂载于 `app.js`**（P1 / 预留）；权限以各路由中间件为准。

### v1.4.8（2026-04-09）

- **与代码对齐（`server/app.js`）**：HTTP 路由以仓库挂载为准——`/api/v1/{auth,tasks,stores,employees,assignments,events,nudges,dashboard,mypal}`；**`/api/v1/mypal/mock/*`** 仅当环境变量 **`MYPAL_MOCK=1`** 时注册（否则无此路由）。
- **通用请求头**：实现仅校验 **`Authorization: Bearer`**（JWT）；`User-Role` / `User-Id` / `Employee-Id` / `Store-Id` **非服务端强制**，角色与身份以 Token 解析为准（见下文「实现说明」）。
- **`POST /nudges`、`GET /nudges`**：`requireRole(['central'])` — **仅 `central`**，**`admin` 无权限**（403 `AUTH_003`）。
- **`POST /nudges/ai-generate`**：`central` + `admin`（与 `routes/nudge.js` 一致）；实现为 Agent 技能 `generate_nudge_message`（`agent/skills/generateNudge.js`，默认 `utils/ai.generateText`，上游以环境变量为准）；**非**固定「仅 Gemini 2.5 Pro」文案。
- **看板 KPI 字段**：响应中若仍出现「催办转化率」等**历史字段名**，产品口径见 PRD「**提醒转化率**」；本节不强制改 JSON 字段名以免破坏前端。

### v1.4.7（2026-04-07）

- **§2.9 自动催办扫描**：补充**服务端定时调度**说明（`server/jobs/autoNudgeScheduler.js`，默认 1 小时）；环境变量 `AUTO_NUDGE_SCHEDULER`、`AUTO_NUDGE_INTERVAL_MS`；与手动 `POST /tasks/{id}/auto-nudge` 的关系。

### v1.4.5（2026-04-03）

- **任务创建**：新增 `startAt`（开始时间）与 `passScore`（达标分数）字段。
- **数据看板**：
  - `/dashboard/overview` 概览接口扩充了：人均完成时间、按时完成率、预警率（起步/P0/P1）、触达率、读取率、催办转化率。
  - `/dashboard/heatmap` 区域热力图新增 `avgCompletionTimeHours`。
  - 新增 `/dashboard/trend` 接口，支持按日/按小时查看完成人数的时间趋势。

### v1.4.4（2026-04-03）

- **用户认证：** `/auth/login` 与 `/auth/me` 响应的 `userInfo` 补充 `employeeName` 和 `storeName` 字段。
- **任务列表/详情：** 店员请求时，`Task` 结构新增 `assignment` 对象返回分配记录详细信息。
- **状态流转：** `PUT /assignments/{assignmentId}/status` 新增 `complete_task` 类型，支持一键完成整个任务。
- **预警及通知：** 细化了临期预警规则（区分 `deadlineCrisisP0` 和 `deadlineCrisisP1`），`/events` 列表及 WebSocket `nudge_sent` 推送均增加了 `ruleType` 及 `content` 字段。
- **自动催办规则**：创建任务配置 `autoNudgeRules` 的 `deadlineCrisis` 改为接收对象结构 `{ "p0": number, "p1": number }`。

### v1.4.3（2026-04-02）

- **MyPal mock：** 澄清 `queryDate` 在 mock 模式下不参与计算；未传 `taskWeek` 时默认使用 `FY26Q2W1`。

### v1.4.2（2026-04-02）

- **DeepSeek：** §6.5.1 补充 DeepSeek 官方 Node.js（`openai` SDK）完整调用示例。

### v1.4.1（2026-04-02）

- **DeepSeek：** 新增 §6.5 DeepSeek 对话补全（OpenAI 兼容上游）说明，含环境变量 `DEEPSEEK_API_KEY` 与禁止硬编码要求。

### v1.4.0（2026-03-31）

- **全局变更：** 彻底移除了 `store_manager` 角色和所有“店长”相关业务描述。
- **任务管理 (`Task`)**：移除了任务 Payload 和响应中的 `targetRole` 字段。
- **任务分配 (`Assignment`)**：移除了列表及创建时的 `userRole` 字段。
- **接口移除**：彻底移除了 3.7 店长进展/困难上报 接口 (`/assignments/reports`)。
- **通知机制**：剔除了由店长发起的催办及推向店长的状态更新，删除了 `initiatorRole` 字段。
- **数据看板 (`Dashboard`)**：总览概览聚合中移除 `managerReadCount`，统一为店员维度的口径。

## 文档信息

| 项目 | 内容 |
|------|------|
| 文档版本 | 1.5.3 |
| 更新时间 | 2026-04-21 |
| 适用版本 | API v1（与 `TOT_backend/server` 当前路由一致） |
| 基础路径 | `/api/v1` |
| 认证方式 | Bearer Token（请求头：`Authorization: Bearer {token}`） |
| 响应格式 | 统一 JSON，含 `requestId` |
| 优先级标注规则 | **P0**：本期必须实现；**P1**：可选/后续实现；**P2**：后续版本 |

## 通用规范

### 响应体格式

```json
{
  "code": 200, // 200=成功；4xx=客户端错误；5xx=服务端错误
  "message": "success", // 结果描述
  "data": {}, // 业务数据（成功时返回）
  "requestId": "req-20260323120000-123456" // 链路追踪ID，用于问题排查
}
```

失败响应在 `code` / `message` 之外，可携带 **`errorCode`**（如 `AUTH_003`），与 `message` 并列，便于前端分支；无稳定业务码时可省略该字段。

### 通用错误码

| 错误码 | 含义 | 场景说明 |
|--------|------|----------|
| 400 | 参数错误 | 请求参数缺失/格式错误/值不合法 |
| 401 | 未认证 | Token过期/无效/未携带 |
| 403 | 无权限 | 超出角色权限范围（如查询其他门店数据） |
| 404 | 资源不存在 | 任务/分配记录/通知等资源ID不存在 |
| 409 | 资源冲突 | 重复创建/状态变更冲突（如已完成任务重复标记） |
| 500 | 服务器内部错误 | 服务端逻辑异常 |
| 503 | 依赖服务不可用 | MyPAL对接失败/AI Agent服务未就绪 |

### 通用请求头

| 字段名 | 必选 | 类型 | 说明 |
|--------|------|------|------|
| Authorization | 是 | string | Bearer Token（JWT）；**服务端仅据此解析身份**（`middleware/auth.js`） |
| User-Role | 否 | string | **非服务端校验**：若存在，仅作客户端/网关约定；角色以 JWT `payload.role` 为准 |
| User-Id | 否 | string | **非服务端校验**：用户 ID 以 JWT `payload.id` 为准 |
| Employee-Id | 否 | string | **非服务端校验**：店员业务 ID 以 JWT `payload.employeeId` 为准 |
| Store-Id | 否 | string | **非服务端校验**：门店 ID 以 JWT `payload.storeId` 为准 |

> **实现说明：** 当前 Express 路由**仅**使用 `Authorization: Bearer`；未在中间件中读取 `User-Role` / `User-Id` 等。文档中若仍写「从请求头 User-Id 获取」，实现上对应为 **`req.user.id`（JWT）**。

## 1. 认证授权 API

### 1.1 登录（获取 Token）**P0**

- **接口名称**：用户登录
- **接口路径**：`/auth/login`
- **请求方法**：POST
- **请求头**：无（公开接口，无需 Authorization）
- **请求体**：
  ```json
  {
    "username": "string",  // 用户名，必填
    "password": "string"   // 明文密码，服务端 bcrypt（10 rounds）校验，必填
  }
  ```
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "token": "string",            // JWT Bearer Token，HS256，有效期 7 天
      "userInfo": {
        "userId": "string",         // users.id（INTEGER 序列化为 string）
        "employeeId": "string|null",// employees.id；central/executive/admin 为 null
        "employeeName": "string|null", // employees.name
        "username": "string",       // users.username
        "role": "string",           // central | employee | executive | admin
        "storeId": "string|null",   // stores.id；central/executive/admin 为 null
        "storeName": "string|null"  // stores.name
      }
    },
    "requestId": "string"
  }
  ```
- **响应体（失败）**：
  ```json
  {
    "code": 401,
    "message": "用户名或密码错误",
    "data": null,
    "requestId": "string"
  }
  ```
- **权限要求**：无（公开接口）
- **异常场景**：
  - 400：username 或 password 为空（`AUTH_004`）
  - 401：用户名不存在或密码错误（`AUTH_005`）

> **说明：** 无 refreshToken 机制。Token 有效期 7 天，过期后需重新登录。
> Token 使用方式：所有受保护接口在请求头携带 `Authorization: Bearer {token}`，
> 服务端从 JWT 解析 role/storeId/employeeId，无需额外自定义请求头。

**测试账号：**

| username | password | role |
|----------|----------|------|
| central | Train2026! | central |
| emp_E002 | Train2026! | employee |
| executive | Train2026! | executive |
| admin | Admin2026! | admin |

### 1.1b 获取当前用户（鉴权联调）**P0**

- **接口名称**：当前登录用户信息
- **接口路径**：`/auth/me`
- **请求方法**：GET
- **请求头**：`Authorization: Bearer {token}`（必填）
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "userId": "string",
      "username": "string",
      "role": "string",
      "storeId": "string|null",
      "storeName": "string|null",
      "employeeId": "string|null",
      "employeeName": "string|null",
      "createdAt": "string"
    },
    "requestId": "string"
  }
  ```
- **权限要求**：已登录用户
- **异常场景**：
  - 401：未携带 Token / Token 无效或过期（`AUTH_001` / `AUTH_002`）
  - 401：用户记录不存在（`AUTH_006`，极少见）

### 1.2 刷新 Token **P1（未实现）**

> 当前版本未实现，不纳入 MVP P0 范围。JWT 有效期 7 天，过期后重新登录即可。

### 1.3 退出登录 **P1（未实现）**

> 当前版本未实现。JWT 为无状态 Token，前端清除本地存储的 token 即视为退出。

---

## 2. 任务管理 API（Task）

> **Task 对象结构（所有任务接口的 `data` 字段通用）：**
>
> ```typescript
> {
>   id: string,                // nanoid，任务唯一标识
>   title: string,
>   description: string | null,
>   hasMypal: boolean,         // 是否包含 MyPAL 平台（DB: has_mypal 0/1）
>   hasSmartSell: boolean,     // 是否包含 SmartSell 平台
>   hasAiDemo: boolean,        // 是否包含 AI Demo 平台
>   hasLiveBroadcast: boolean, // 是否包含 Live Broadcast 平台
>   status: "draft" | "dispatched",
>   rtmFilter: object[] | null,   // RTM 筛选规则数组；null = 不启用筛选
>   storeScope: "all" | string[], // "all" 或门店 ID 数组（如 ["S001","S002"]）
>   autoNudgeRules: object | null, // 自动预警规则（实现层字段名含 nudge）
>   startAt: string,           // 开始时间，ISO 8601，必填
>   passScore: number,         // 达标分数，整数，必填
>   mypalTaskWeek: string | null,  // MyPal 任务周 / queryDate；hasMypal 时必填（创建/草稿 PATCH）
>   mypalProductName: string | null, // 与 MyPal productName 精确匹配，可选
>   subTasksConfig: Record<string, string> | null, // 子任务独立配置 (针对合集任务)
>   ddlAt: string,             // 截止时间，必填；请求体为任意可解析时间串；**存储与响应**为 **本地墙钟** `YYYY-MM-DD HH:MM:SS`（与 `datetime('now', 'localtime')` / `parseDateToSqliteLocal` 一致）
>   createdBy: string,         // 创建者 username（如 "central"）
>   createdAt: string,         // ISO 8601
>   updatedAt: string,         // ISO 8601
>   // 仅当 employee 角色调用 GET /tasks 或 GET /tasks/:id 时返回
>   assignment?: {
>     id: string,
>     status: "pending" | "in_progress" | "completed",
>     progress: number,
>     receivedAt: string | null,
>     startedAt: string | null,
>     completedAt: string | null
>   }
> }
> 
> // autoNudgeRules 结构说明
> {
>   progressLag: {
>     lifestyle: number, // 仅针对 Monobrand Lifestyle：处于门店最后 N 位（如 3）
>     mono: number       // 仅针对 Monobrand Mono：处于门店最后 N 位（如 1）
>   },
>   deadlineCrisis: {      // 危机预警
>     p0: number,          // P0级预警：距离 Deadline 不足 N 小时（默认 24）且未完成
>     p1: number,          // P1级预警：距离 Deadline 不足 N 小时（默认 48）且未完成
>     p2: number           // P2级预警：任务期限已度过 N%（如 50）且未完成
>   }
> }
> ```

### 2.1 创建任务 **P0**

- **接口名称**：创建培训任务（草稿态）
- **接口路径**：`/tasks`
- **请求方法**：POST
- **权限要求**：仅 `central`
- **请求体**：
  ```json
  {
    "title": "string",           // 任务标题，必填
    "description": "string",     // 任务描述，可选
    "hasMypal": true,            // 是否包含 MyPAL，可选（默认 false）
    "hasSmartSell": false,       // 是否包含 SmartSell，可选（默认 false）
    "hasAiDemo": false,          // 是否包含 AI Demo，可选（默认 false）
    "hasLiveBroadcast": false,   // 是否包含 Live Broadcast，可选（默认 false）
    // 四平台至少一个为 true，否则 400（TASK_001）
    "startAt": "2026-04-24 09:38:14", // 开始时间，必填（格式为 YYYY-MM-DD HH:MM:SS）
    "passScore": 100,                 // 达标分数，整数，必填
    "ddlAt": "2026-04-30 23:59:59",   // 截止时间，必填（格式为 YYYY-MM-DD HH:MM:SS）
    "rtmFilter": null,                // RTM 筛选规则数组（见 07-RTM-FILTER.md），可选
    "storeScope": "all",         // "all" 或门店 ID 数组，可选（默认 "all"）
    "autoNudgeRules": {          // 自动预警规则，可选
      "progressLag": { "lifestyle": 3, "mono": 1 },
      "deadlineCrisis": { "p0": 24, "p1": 48, "p2": 50 }
    },
    "subTasksConfig": {          // 任务合集各平台的独立配置，可选
      "MyPAL": "独立描述1...",
      "SmartSell": "独立描述2..."
    },
    "mypalTaskWeek": "FY26Q2W1",  // hasMypal=true 时必填，否则 400（TASK_007）
    "mypalProductName": "string" // 可选；与 MyPal 产品名匹配
  }
  ```
- **响应体（成功，HTTP 201）**：返回完整 Task 对象
  ```json
  {
    "code": 201,
    "message": "success",
    "data": {
      "id": "z4ABQwQyAWdD9lBOdXeGS",
      "title": "Q1新品培训",
      "description": null,
      "hasMypal": true,
      "hasSmartSell": false,
      "hasAiDemo": false,
      "hasLiveBroadcast": false,
      "status": "draft",
      "rtmFilter": null,
      "storeScope": "all",
      "ddlAt": "2026-04-30 00:00:00",
      "createdBy": "central",
      "createdAt": "2026-03-27T09:44:53.000Z",
      "updatedAt": "2026-03-27T09:44:53.000Z"
    },
    "requestId": "req-20260327094453-123456"
  }
  ```
- **异常场景**：
  - 400：`title` / `ddlAt` / `startAt` 为空，或 **`passScore` 未传**（`TASK_005`）
  - 400：四平台全为 false（`TASK_001`）
  - 400：**`hasMypal=true` 但未填 `mypalTaskWeek`**（`TASK_007`）
  - 401：未认证（`AUTH_001` / `AUTH_002`）
  - 403：非 `central`（`AUTH_003`）

### 2.2 获取任务详情 **P0**

- **接口名称**：获取任务详情
- **接口路径**：`/tasks/{id}`
- **请求方法**：GET
- **权限要求**：**`central` / `admin` / `employee`**（中间件 `requireTaskAccess`）。**`executive`** 无 assignment 关联时 **403**（`AUTH_003`）。店员仅可访问本人有 `task_assignments` 的任务。
- **路径参数**：`id`（任务 nanoid，必填）
- **响应体（成功）**：返回完整 Task 对象
  ```json
  {
    "code": 200,
    "message": "success",
    "data": { /* Task 对象，结构见本节开头 */ },
    "requestId": "string"
  }
  ```
- **异常场景**：
  - 401：未认证
  - 403：无权限（如 `executive`，或店员访问非本人任务）（`AUTH_003`）
  - 404：任务不存在（`TASK_002`）

### 2.3 编辑任务 **P0**

- **接口名称**：更新任务字段
- **接口路径**：`/tasks/{id}`
- **请求方法**：**PATCH**（支持部分字段更新，非 PUT 全量替换）
- **权限要求**：仅 `central`
- **路径参数**：`id`（必填）
- **请求体（所有字段均可选，仅传需要修改的字段）**：
  ```json
  {
    "title": "string",
    "description": "string",
    "hasMypal": true,
    "hasSmartSell": true,
    "hasAiDemo": false,
    "hasLiveBroadcast": false,
    "rtmFilter": null,
    "storeScope": "all",
    "startAt": "2026-04-24 09:38:14",
    "passScore": 100,
    "mypalTaskWeek": "FY26Q2W1",
    "mypalProductName": "string",
    "subTasksConfig": { "MyPAL": "独立描述1...", "SmartSell": "独立描述2..." },
    "autoNudgeRules": { "progressLag": { "lifestyle": 3, "mono": 1 }, "deadlineCrisis": { "p0": 24, "p1": 48, "p2": 50 } },
    "ddlAt": "2026-05-01T00:00:00Z"
  }
  ```
- **业务规则**：
  - `draft` 状态：可修改任务字段（含平台、筛选、`startAt`、`passScore`、MyPal 字段等）；**`hasMypal=true` 时 `mypalTaskWeek` 不可为空**（`TASK_007`）。
  - `dispatched` 状态：**仅允许修改 `ddlAt` 与 `autoNudgeRules`**（与 `routes/tasks.js` 中 `UPDATE … ddl_at, auto_nudge_rules` 一致）；尝试改标题/平台/RTM 等返回 **400（`TASK_004`）**
  - **实现细节**：`dispatched` 分支在校验前要求请求体 **`ddlAt` 非空**；若仅调整 `autoNudgeRules`，仍须传入 **`ddlAt`**（可与当前值相同），否则 **400（`TASK_005`）**。
- **响应体（成功）**：返回更新后的完整 Task 对象
  ```json
  {
    "code": 200,
    "message": "success",
    "data": { /* 更新后的 Task 对象 */ },
    "requestId": "string"
  }
  ```
- **异常场景**：
  - 400：`dispatched` 后尝试变更 **除 `ddlAt` / `autoNudgeRules` 外**的任一字段（含与现值不同的标题、平台、RTM 等）（`TASK_004`）
  - 400：`dispatched` 后 **`ddlAt` 解析结果为空**（`TASK_005`）
  - 400：draft 状态下四平台全为 false（`TASK_001`）
  - 401：未认证
  - 403：非 central 角色（`AUTH_003`）
  - 404：任务不存在（`TASK_002`）

> **WS 推送：** 仅当任务已下发（`status=dispatched`）时触发。为所有有 `task_assignments` 记录的用户批量写入 `notification_events(task_updated)`，并向各用户推送 `{ event: "task_updated", data: { taskId, ddlAt } }`（见 §15.3 扩展）。`draft` 任务编辑不触发推送。

### 2.4 下发任务 **P0（Dev2 已实现）**

- **接口名称**：下发培训任务
- **接口路径**：`/tasks/{id}/dispatch`
- **请求方法**：POST
- **权限要求**：`central` / `admin`
- **路径参数**：`id`（必填）
- **请求体**：无（下发人从 JWT 解析）
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "任务下发成功",
    "data": {
      "task": { /* 更新后的 Task 对象（status=dispatched） */ },
      "matchedStoreCount": 50,
      "targetUserCount": 300,
      "assignmentCreated": 300,
      "notificationCreated": 300
    },
    "requestId": "string"
  }
  ```
- **异常场景**：
  - 404：任务不存在（`TASK_002`）
  - 400：筛选命中门店为空（`RTM_001`）
  - 400：筛选后无目标员工（`TASK_006`）
  - 409：任务已下发（`TASK_003`）

> **WS 推送：** 下发成功后，向所有目标用户（`targetUsers`）推送 `{ event: "task_assigned", data: { taskId, taskTitle, ddlAt } }`（见 §15.1）。

### 2.4.1 撤销任务 **P0**

- **接口名称**：撤销已下发任务（Revoke Task）
- **接口路径**：`/tasks/{id}/revoke`
- **请求方法**：POST
- **权限要求**：`central` / `admin`
- **路径参数**：`id`（必填）
- **请求体**：无
- **业务规则**：
  - 任务必须是已下发（`status === 'dispatched'`）状态。
  - 服务端会在**数据库事务中级联物理删除**关联该任务的所有子记录，包括 `read_receipts`（已读回执）、`notification_events`（通知事件）、`nudge_records`（催办记录）、`task_assignments`（员工任务分配记录）和 `dashboard_insights`（AI 洞察），最后**彻底删除任务主记录**。
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "任务撤销并删除成功",
    "data": { "id": "string", "deleted": true },
    "requestId": "string"
  }
  ```
- **异常场景**：
  - 404：任务不存在（`TASK_002`）
  - 400：任务未下发，当前不在 `dispatched` 状态（`TASK_008`）

> **WS 推送：**
> 1. 向受影响的店员下发 `{ event: "task_deleted", data: { taskId, message: "任务已被总部撤销并删除" } }`，前端监听此事件可直接从 UI 移除该任务卡片。
> 2. 向管理端看板推送 `{ event: "dashboard_updated", data: { taskId, operationType: "task_deleted" } }` 刷新数据。

### 2.5 获取任务列表 **P0**

- **接口名称**：获取任务列表
- **接口路径**：`/tasks`
- **请求方法**：GET
- **权限要求**：所有已认证角色
- **查询参数**：
  | 参数名 | 类型 | 必选 | 说明 |
  |--------|------|------|------|
  | status | string | 否 | 店员端过滤任务状态使用，可选值：`completed`, `pending`, `in_progress`, `overdue` |
- **角色过滤规则**：
  - `central` / `admin`：返回全部任务，按 `created_at DESC` 排序
  - `employee`：仅返回本人有 `task_assignments` 记录的任务
  - `executive`：返回空数组（看板数据走 Dashboard API，见第 5 节）
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": [
      { /* Task 对象 1 */ },
      { /* Task 对象 2 */ }
    ],
    "requestId": "string"
  }
  ```
- **异常场景**：
  - 401：未认证

### 2.6 任务下发预览 **P1（未实现）**

> 当前版本未实现，不纳入 MVP P0 范围。

### 2.7 获取下发历史 **P1（未实现）**

> 当前版本未实现，不纳入 MVP P0 范围。

### 2.8 AI 辅助生成任务下发说明

- **接口路径**：`/tasks/ai-generate-description`
- **请求方式**：`POST`
- **权限要求**：`central`, `admin`
- **接口说明**：通过 Gemini 2.5 Pro 或 DeepSeek 大模型，根据简短指令、截止时间和学习平台生成一段长篇、有煽动性的任务说明文案。
- **请求参数 (Body)**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `instruction` | string | 是 | 核心指令，如："下周一前完成iPhone新款卖点学习" |
| `ddlAt` | string | 否 | 截止时间，任意可解析时间串（与任务 `ddlAt` 写入规则一致） |
| `platforms` | string[] | 否 | 涉及的平台，如 `["MyPAL", "SmartSell"]` |

- **返回参数**：

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "description": "亲爱的小伙伴们，本次新款 iPhone 培训非常关键... (AI 生成的话术)"
  },
  "requestId": "req-123..."
}
```

### 2.9 AI 一键根据自然语言解析任务信息

- **接口路径**：`/tasks/ai-parse`
- **请求方式**：`POST`
- **权限要求**：`central`, `admin`
- **接口说明**：通过大模型（如 DeepSeek），根据一段自然语言指令自动解析并生成任务表单所需的各个字段，包含自动扩写后的任务说明。供前端一键填表使用。如果自然语言无法解析出某个字段，则对应字段返回 `null`。
- **请求参数 (Body)**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `instruction` | string | 是 | 核心指令，如："下周一前完成iPhone新款卖点学习，大家都要学MyPal" |

- **返回参数**：

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "title": "iPhone 新款卖点学习",
    "description": "亲爱的小伙伴们，本次新款 iPhone 培训非常关键... (AI 生成的话术)",
    "hasMypal": true,
    "hasSmartSell": false,
    "hasAiDemo": false,
    "hasLiveBroadcast": false,
    "startAt": "2026-04-24 09:38:14",
    "ddlAt": "2026-04-30 23:59:59",
    "passScore": 100
  },
  "requestId": "req-123..."
}
```

### 2.10 任务智能发布解析（自然语言一键填表）

- **接口路径**：`/tasks/ai-smart-publish`
- **请求方式**：`POST`
- **权限要求**：`central`, `admin`
- **接口说明**：面向 Apple Retail 门店培训场景，使用固定 **Prompt**（含当前系统时间占位，用于解析「明天」「7 天后」等相对时间）。模型输出 **JSON** 五字段：`task_name`、`passing_score`、`start_time`、`end_time`、`task_details`（**`task_details`** 已含结构化润色与 Emoji）。**`startAt` / `ddlAt`** 与模型时间字段同为 **本地墙钟**（`YYYY-MM-DD HH:MM:SS`），语义与直接调用 **`POST /tasks`** 时传入的 `startAt`/`ddlAt` 一致；**勿**与此前误用的「仅响应里展示 UTC 字符串」混淆。**`taskName` / `taskDetails` / `passingScore` 与创建任务接口的 `title` / `description` / `passScore` 一一对应**，响应中不重复返回后者。依赖 **`DEEPSEEK_API_KEY`**。
- **请求参数 (Body)**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `input` | string | 条件 | 用户自然语言；三选一，与 `userInput`、`instruction` 等价，**至少填一个** |
| `userInput` | string | 条件 | 同 `input` |
| `instruction` | string | 条件 | 同 `input` |

- **返回参数 `data` 说明**：

| 字段 | 说明 |
|------|------|
| `taskName` / `passingScore` / `startTime` / `endTime` / `taskDetails` | 与模型约定字段对应；`startTime`/`endTime` 为 Prompt 约定格式（日期与时分之间为空格，**时分秒可为连字符**） |
| `startAt` / `ddlAt` | 由 `startTime`/`endTime` 解析得到的 **`YYYY-MM-DD HH:MM:SS`（本地墙钟）**，与 `POST /tasks` 请求体时间语义一致；**非**单独换算成 UTC 后的展示串 |
| **对接 `POST /tasks` 时** | `title` ← `taskName`，`description` ← `taskDetails`，`passScore` ← `passingScore`，`startAt`/`ddlAt` ← 本接口返回的同名字段 |

- **返回示例**：

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "taskName": "MacBook Pro M4 新品培训",
    "passingScore": 85,
    "startTime": "2026-04-13 10-00-00",
    "endTime": "2026-04-20 10-00-00",
    "taskDetails": "Team，全新MacBook Pro M4培训已上线！…",
    "startAt": "2026-04-13 10:00:00",
    "ddlAt": "2026-04-20 10:00:00"
  },
  "requestId": "req-123..."
}
```

- **异常**：`400`（`TASK_SMART_001` 未提供输入）；`502`（`TASK_SMART_003` 时间无法解析）；`503`（`TASK_SMART_002` 模型返回非 JSON 或调用失败）

### 2.11 触发自动催办扫描

自动预警的**业务逻辑**（读 `auto_nudge_rules`、命中规则、调用 `generate_nudge_message`、写 `notification_events` / `nudge_records`、WebSocket `nudge_sent`）在服务端 `evaluateAndTriggerAutoNudges` 中统一实现。触发方式有两种：

#### 2.11.1 服务端定时调度（已实现）

- **行为**：HTTP 服务进程启动后挂载 `server/jobs/autoNudgeScheduler.js`；按固定间隔查询所有 **`status = dispatched`** 且 **`auto_nudge_rules` 非空** 的任务，对每个任务 **ID** 调用与下述手动接口**相同**的扫描逻辑（即 `evaluateAndTriggerAutoNudges`）。
- **默认间隔**：**1 小时**（`3600000` ms）。
- **环境变量**（仓库根目录 `.env`，由 `server/app.js` 加载）：
  | 变量 | 说明 |
  |------|------|
  | `AUTO_NUDGE_SCHEDULER` | 设为 `0` 时**不启动**定时调度（仅保留手动接口） |
  | `AUTO_NUDGE_INTERVAL_MS` | 自定义扫描间隔，单位为**毫秒**；未设置则默认 1 小时 |

#### 2.11.2 手动触发单任务扫描（本接口）

- **接口路径**：`/tasks/{id}/auto-nudge`
- **请求方式**：`POST`
- **权限要求**：`central`, `admin`
- **接口说明**：对**指定任务 ID** 立即执行一轮与定时任务**相同**的扫描（无需等待下一个调度周期）。读取该任务配置的 `auto_nudge_rules`（掉队预警、起步异常预警、临期危机预警），扫描所有进行中的员工进度。对命中且未去重的目标，**同步阶段仅入队**；在 `setImmediate` 异步路径中逐人调用 `generate_nudge_message`、写入 `notification_events`（含 `content`）、`nudge_records` 并推送 WebSocket（见 §15.2）。**HTTP 响应立即返回**，不等待 AI 完成。
- **请求参数**：无 Body
- **返回参数**：

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "success": true,
    "nudgedCount": 5,
    "queued": 5,
    "evaluatedRules": ["progressLag", "deadlineCrisis"],
    "async": true
  },
  "requestId": "req-123..."
}
```

> **`nudgedCount` / `queued`**：数值相同，均为**本轮将异步处理的目标人数**（与改造前「人次」含义一致，便于旧客户端只读 `nudgedCount`）；**HTTP 仍不等待**逐人 AI 落库。无目标或全部去重时二者均为 `0`。

## 3. 任务分配 API（Assignment）

### Assignment 状态机端点（P0，已实现）

MVP 中 **Assignment 生命周期写操作** 统一通过下表接口完成（不含 Dev1 基础 CRUD 的 `PATCH/DELETE`，见 §3.8–§3.10）。

| 完整路径（基础前缀 `/api/v1`） | 方法 | 说明 |
|-------------------------------|------|------|
| `/assignments/{assignmentId}/status` | PUT | **状态机**：`start_task`（pending→in_progress）或 `complete_platform`（平台完成 + 进度 + 可能 auto-complete） |

**与 `02-STATE-MACHINES.md` 对齐的流转摘要：**

```
pending ──(start_task)──▶ in_progress ──(complete_platform × N)──▶ completed
```

- `complete_platform` 仅在 `in_progress` 下允许；`pending` 直接 `complete_platform` 返回 **409**（`ASSIGN_013`）。
- `progress` 为 **0–100 整数**：`round(已勾选完成平台数 / 任务已配置平台数 × 100)`；全部完成时写 `completed_at` 并将 `status` 置为 `completed`。

### 3.1 获取分配记录列表**P0**

- **接口名称**：获取任务分配列表
- **接口路径**：`/assignments`
- **请求方法**：GET
- **请求头**：需携带通用请求头
- **查询参数**：
  | 参数名 | 类型 | 必选 | 说明 |
  |--------|------|------|------|
  | taskId | string | 否 | 任务ID，筛选指定任务的分配记录 |
  | employeeId | string | 否 | 员工ID；`central`/`admin` 可筛任意；`employee` 仅允许本人（与 JWT 不一致则 403） |
  | storeId | string | 否 | 门店ID；`central`/`admin` 可筛 |
  | status | string | 否 | 分配状态：pending/in_progress/completed/overdue |
  | pageNum | int | 否 | 页码，**默认 1**；未传或非法返回 400（`ASSIGN_018`） |
  | pageSize | int | 否 | 页大小，**默认 20**，**最大 200**；非法返回 400（`ASSIGN_019`）；`status` 非法返回 `ASSIGN_020` |
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "list": [
        {
          "assignmentId": "string",
          "taskId": "string",
          // userId = task_assignments.user_id = employees.id（业务编号，如 E001）
          "userId": "string",
          "storeId": "string", // task_assignments.store_id（下发时快照，冗余自 employees.store_id）
          "status": "pending/in_progress/completed",
          // progress：服务端计算 = 已完成平台数 / 该任务配置平台总数 × 100（0-100 整数）
          "progress": 80,
          "mypalCompleted": false,    // task_assignments.mypal_completed
          "smartsellCompleted": true, // task_assignments.smartsell_completed
          "aiDemoCompleted": true,    // task_assignments.ai_demo_completed
          "liveBroadcastCompleted": false, // task_assignments.live_broadcast_completed
          "nudgeCount": 0,   // task_assignments.nudge_count
          "receivedAt": "string", // task_assignments.received_at，null 表示未打开过任务详情
          // taskAssignedEventId：该 assignment 对应的 task_assigned 通知事件 ID（无则 null；员工首次 POST /assignments/:id/viewed 后通常会补建并可在后续 GET 中看到）
          "taskAssignedEventId": "string|null",
          "updatedAt": "string",
          "id": "string"
        }
      ],
      "pagination": {
        "pageNum": 1,
        "pageSize": 20,
        "total": 50,
        "totalPages": 3
      }
    },
    "requestId": "string"
  }
  ```
- **实现说明（Day6 已对齐）**：`data` **必须为** `{ list, pagination }`（不再返回顶层数组）。列表项中 **`id` 与 `assignmentId` 相同**，供旧客户端兼容；**`taskAssignedEventId`** 为对应 `task_assigned` 通知的 `eventId`，若无事件则为 **`null`**。`executive` 等无 assignment 视图的角色返回空 `list` 与 `total=0`。
- **接口说明**：按角色权限返回分配记录（总部看所有，店员看本人）
- **权限要求**：
  - central / admin：所有分配记录（可组合查询参数筛选）
  - employee：仅本人的分配记录
- **异常场景**：
  - 400：`pageNum` / `pageSize` 非法（`ASSIGN_018` / `ASSIGN_019`）；`status` 非法（`ASSIGN_020`）
  - 403：越权筛选（如店员查他人 `employeeId`、查其他门店 `storeId`）

### 3.2 获取分配记录详情**P0**

- **接口名称**：获取分配记录详情
- **接口路径**：`/assignments/{assignmentId}`
- **请求方法**：GET
- **请求头**：需携带通用请求头
- **路径参数**：assignmentId（必填）
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "assignmentId": "string",           // task_assignments.id（nanoid）
      "taskId": "string",                 // task_assignments.task_id
      "userId": "string",                 // task_assignments.user_id = employees.id（如 E001）
      "storeId": "string",                // task_assignments.store_id（下发时快照）
      "status": "string",                 // pending/in_progress/completed
      "progress": 100,                    // task_assignments.progress（整数 0-100）
      "mypalCompleted": true,             // task_assignments.mypal_completed
      "smartsellCompleted": true,         // task_assignments.smartsell_completed
      "aiDemoCompleted": true,            // task_assignments.ai_demo_completed
      "liveBroadcastCompleted": true,     // task_assignments.live_broadcast_completed
      "nudgeCount": 2,                    // task_assignments.nudge_count
      "receivedAt": "string",             // task_assignments.received_at，null 表示未打开过任务详情
      "startedAt": "string",              // task_assignments.started_at，null 表示未点击"开始任务"
      "completedAt": "string",            // task_assignments.completed_at，null 表示未完成
      // taskAssignedEventId：该 assignment 对应的 task_assigned 通知事件 ID（可为 null，见 §3.1 说明）
      "taskAssignedEventId": "string",
      "createdAt": "string",
      "updatedAt": "string",
      "id": "string"
    },
    "requestId": "string"
  }
  ```
- **实现说明**：`id` 与 `assignmentId` 取值相同（兼容）；`taskAssignedEventId` 可为 `null`。
- **接口说明**：返回单条分配记录详情，含平台完成状态、催办次数等
- **权限要求**：
  - 本人分配记录（employee）
  - 所有分配记录（central / admin）
- **异常场景**：
  - 404：assignmentId不存在
  - 403：无权限访问

### 3.3 更新分配状态（开始任务/完成平台）**P0**

- **接口名称**：更新分配记录状态（Assignment 状态机）
- **接口路径**：`/assignments/{assignmentId}/status`
- **完整 URL 示例**：`PUT /api/v1/assignments/{assignmentId}/status`
- **请求方法**：PUT
- **请求头**：需携带通用请求头
- **路径参数**：assignmentId（必填）
- **请求体**：
  ```json
  {
    "operationType": "start_task/complete_platform/complete_task", // 必填
    "platform": "MyPAL/SmartSell/AI Demo/Live Broadcast" // 仅 complete_platform 时必填
  }
  ```
- **`operationType` 取值说明**：
  - `start_task`：将 `pending` 状态流转为 `in_progress`，记录 `started_at`。
  - `complete_platform`：标记单一平台完成并重算 `progress`，若全平台完成则触发自动 `completed`。
  - `complete_task`：一键标记该任务下所有平台为完成状态，将 `progress` 置为 100，并完成任务。
- **`platform` 取值**：服务端对字符串做 `trim().toLowerCase()` 后按下表匹配；未命中任一别名则 **400**（`ASSIGN_012`）。

  | 归一化后的键（等价输入示例） | 对应任务字段 `tasks.has_*` | 写入列 `task_assignments.*_completed` |
  |-----------------------------|----------------------------|--------------------------------------|
  | `mypal`（如 `MyPAL`） | `has_mypal` | `mypal_completed` |
  | `smartsell`（如 `SmartSell`） | `has_smartsell` | `smartsell_completed` |
  | `ai demo` 或 `aidemo`（如 `AI Demo`） | `has_ai_demo` | `ai_demo_completed` |
  | `live broadcast` 或 `livebroadcast`（如 `Live Broadcast`） | `has_live_broadcast` | `live_broadcast_completed` |

  仅当该任务在创建时已勾选对应平台时，才允许标记完成；否则 **400**（`ASSIGN_015`）。
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "状态更新成功",
    "data": {
      "assignmentId": "string",
      "status": "in_progress/completed",  // 更新后的 task_assignments.status
      "progress": 75,                     // 更新后的 task_assignments.progress（0-100 整数）
      "startedAt": "string|null",         // start_task 后有值
      "completedAt": "string|null",       // 自动完成后有值
      "updatedAt": "string",
      // resolvedNudgeCount：进入 completed 时，与该 assignment 关联的 nudge 通知条数
      "resolvedNudgeCount": 2,
      "platformStatus": {
        "mypalCompleted": true,           // task_assignments.mypal_completed
        "smartsellCompleted": false,      // task_assignments.smartsell_completed
        "aiDemoCompleted": true,          // task_assignments.ai_demo_completed
        "liveBroadcastCompleted": false   // task_assignments.live_broadcast_completed
      }
    },
    "requestId": "string"
  }
  ```
- **接口说明**：
  - `start_task`：仅允许 `pending -> in_progress`
  - `complete_platform`：仅允许在 `in_progress` 下执行；按任务已配置平台集合重算进度
  - 进度计算：`progress = round(已完成平台数 / 已配置平台数 * 100)`
  - 当已配置平台全部完成时，自动 `status=completed` 并写 `completed_at`
- **权限要求**：
  - `employee`：仅可操作本人 assignment
  - `central` / `admin`：可操作任意 assignment（运维兜底）
- **异常场景**：
  - 400：`operationType` 非法（`ASSIGN_011`）
  - 400：`complete_platform` 未传或平台值非法（`ASSIGN_012`）
  - 400：平台不在任务配置内（`ASSIGN_015`）
  - 409：当前状态不可开始或不可完成平台（`ASSIGN_013`）
  - 409：assignment 已完成（`ASSIGN_014`）
  - 409：平台已重复标记完成（`ASSIGN_016`）
  - 403：非本人操作（`AUTH_003`）

> **WS 推送：** 仅 `complete_platform` 触发 auto-complete（`status → completed`）时推送，`start_task` 不推送。推送事件 `{ event: "assignment_completed", data: { assignmentId, taskId, userId, storeId, completedAt } }` 给**完成者本人**（见 §15.3）。

### 3.4 批量生成分配记录（内部/总部调用）**P0**

- **接口名称**：批量生成分配记录
- **接口路径**：`/assignments/batch-create`
- **完整 URL 示例**：`POST /api/v1/assignments/batch-create`
- **请求方法**：POST
- **请求头**：需携带通用请求头（Role=central / admin）
- **请求体**：
  ```json
  {
    "taskId": "string", // 任务ID，必填（tasks.id）
    "targetUsers": [ // 目标用户列表，必填
      {
        "userId": "string",               // employees.id（业务编号，如 E001）→ task_assignments.user_id
        "storeId": "string"               // → task_assignments.store_id（下发时快照）
      }
    ]
    // 操作人从请求头 User-Id 获取，无需 body 传递
  }
  ```
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "批量生成成功",
    "data": {
      "successCount": 298,
      "skippedCount": 0,
      "failedCount": 2,
      "failedUsers": [
        {
          "userId": "string",
          "reason": "用户不存在"
        }
      ]
    },
    "requestId": "string"
  }
  ```
- **实现说明（Day6）**：**仅写入 `task_assignments`**，不创建 `notification_events`（与 `POST /tasks/{id}/dispatch` 区分）。`INSERT OR IGNORE` 遇 **`UNIQUE(task_id, user_id)`** 冲突时计入 **`skippedCount`**，**不**写入 **`failedUsers`**。**`failedUsers`** 仅承载**校验失败**（用户不存在、门店不匹配）。`taskId` 不存在时整单 **404**（`TASK_002`）。`targetUsers` 为空或非数组时 **400**（`ASSIGN_021`）。员工首次 **`POST /assignments/:id/viewed`** 时，服务端可**补建** `task_assigned` 通知行并写 **`read_receipts`**（见 §4.3）。
- **接口说明**：供总部/运维批量补录分配；正式下发带通知仍走 **§2.4 dispatch**。
- **权限要求**：`central` / `admin`
- **异常场景**：
  - 400：`taskId` / `targetUsers` 缺失或 `targetUsers` 为空（`ASSIGN_021`）
  - 403：非 `central` / `admin`
  - 404：`taskId` 对应任务不存在（`TASK_002`）

### 3.5 任务接收确认**P1**

- **接口名称**：任务接收确认
- **接口路径**：`/assignments/{assignmentId}/confirm`
- **请求方法**：POST
- **请求头**：需携带通用请求头
- **路径参数**：assignmentId（必填）
- **请求体**：
  ```json
  {
    "confirmed": true // 是否确认接收：true=确认，false=暂不（MVP 不做拒绝终态，仅记录接收时间）
    // comment 字段本期不支持：MVP §6.6 不提供店员反馈入口
  }
  ```
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "assignmentId": "string",
      "status": "pending", // 接收确认不改变 assignment 状态（仍为 pending，需点击"开始任务"才变 in_progress）
      "receivedAt": "string" // 写入 task_assignments.received_at（ISO8601）
    },
    "requestId": "string"
  }
  ```
- **接口说明**：员工确认接收任务，写入 `task_assignments.received_at`。注意：接收确认**不改变** `status`（仍为 `pending`），需后续点击"开始任务"才触发 `pending → in_progress`。MVP 不支持拒绝终态（PRD §6.6 不提供反馈入口）。
- **权限要求**：仅本人操作
- **异常场景**：
  - 409：该 Assignment 已有 received_at 记录（重复确认）
  - 409：Assignment 已进入 completed
  - 403：非所属用户操作

### 3.6 获取任务完成时间线**P1**

- **接口名称**：获取任务完成时间线
- **接口路径**：`/assignments/{assignmentId}/timeline`
- **请求方法**：GET
- **请求头**：需携带通用请求头
- **路径参数**：assignmentId（必填）
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "assignmentId": "string",
      "timeline": [
        {
          "event": "assigned",
          "timestamp": "string",
          "operator": "string",
          "description": "任务分配"
        },
        {
          "event": "confirmed",
          "timestamp": "string",
          "operator": "string",
          "description": "员工确认接收"
        },
        {
          "event": "platform_completed",
          "platform": "mypal",
          "timestamp": "string",
          "description": "MyPAL平台完成"
        },
        {
          "event": "nudge",
          "timestamp": "string",
          "operator": "string",
          "description": "收到催办通知"
        },
        {
          "event": "completed",
          "timestamp": "string",
          "operator": "string",
          "description": "任务全部完成"
        }
      ],
      "estimatedCompletionTime": "string",
      "actualCompletionTime": "string",
      "duration": 86400 // 总耗时（秒）
    },
    "requestId": "string"
  }
  ```
- **接口说明**：获取任务从分配到完成的完整时间线，支持趋势分析
- **权限要求**：本人/总部
- **异常场景**：
  - 404：assignmentId不存在
  - 403：无权限访问

### 3.8 创建分配记录（基础 CRUD，Dev1）**P0**

- **接口名称**：创建单条分配记录
- **接口路径**：`/assignments`
- **请求方法**：POST
- **请求头**：需携带通用请求头（Role=central/admin）
- **请求体**：
  ```json
  {
    "taskId": "string",
    "userId": "string",
    "storeId": "string"
  }
  ```
- **响应体（成功）**：
  ```json
  {
    "code": 201,
    "message": "success",
    "data": {
      "id": "string",
      "taskId": "string",
      "userId": "string",
        "storeId": "string",
      "status": "pending",
      "progress": 0,
      "nudgeCount": 0,
      "receivedAt": null,
      "startedAt": null,
      "completedAt": null,
      "createdAt": "string",
      "updatedAt": "string"
    },
    "requestId": "string"
  }
  ```
- **接口说明**：Day2 Dev1 基础写接口，不包含状态机、通知事件、催办联动。
- **权限要求**：仅 central/admin
- **异常场景**：
  - 400：参数缺失 / taskId 或 userId 不存在 / userId 与 storeId 不匹配
  - 409：同一 `(taskId, userId)` 已存在分配记录

### 3.9 更新分配记录（基础 CRUD，Dev1）**P0**

- **接口名称**：更新分配记录基础字段
- **接口路径**：`/assignments/{assignmentId}`
- **请求方法**：PATCH
- **请求头**：需携带通用请求头（Role=central/admin）
- **路径参数**：assignmentId（必填）
- **请求体**：
  ```json
  {
    "nudgeCount": 3
  }
  ```
- **响应体（成功）**：返回更新后的 Assignment 对象（字段同 3.8）
- **接口说明**：当前仅开放 `nudgeCount` 更新；状态机相关更新仍走 §3.3。
- **权限要求**：仅 central/admin
- **异常场景**：
  - 400：nudgeCount 非非负整数，或未传可更新字段
  - 404：assignment 不存在

### 3.10 删除分配记录（基础 CRUD，Dev1）**P0**

- **接口名称**：删除分配记录
- **接口路径**：`/assignments/{assignmentId}`
- **请求方法**：DELETE
- **请求头**：需携带通用请求头（Role=central/admin）
- **路径参数**：assignmentId（必填）
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "deleted": true
    },
    "requestId": "string"
  }
  ```
- **接口说明**：仅允许删除 `pending` 状态分配记录，避免破坏执行链路。
- **权限要求**：仅 central/admin
- **异常场景**：
  - 404：assignment 不存在
  - 409：非 pending 状态不可删除

## 3A. 门店与员工基础管理 API（Dev1）**P0**

### 3A.1 门店管理（Stores）

- `GET /stores`：查询门店列表（central/admin）
- `GET /stores/{id}`：查询门店详情（已登录可访问）
- `POST /stores`：创建门店（central/admin）
- `PATCH /stores/{id}`：更新门店（central/admin）
- `DELETE /stores/{id}`：删除门店（central/admin，仅无关联员工时可删）

### 3A.2 员工管理（Employees）

- `GET /employees`：查询员工列表（central/admin）
- `GET /employees/{id}`：查询员工详情（已登录可访问）
- `POST /employees`：创建员工（central/admin）
- `PATCH /employees/{id}`：更新员工（central/admin）
- `DELETE /employees/{id}`：删除员工（central/admin，存在用户/assignment 关联时拒绝）

## 4. 系统事件 API（System Event）

### 4.1 创建系统通知事件（内部调用）**P0**

> ⚠️ **重要设计约束：本接口不对前端开放直接创建 `nudge_yellow/nudge_red` 事件**。催办通知必须通过 §4.5 `POST /nudges` 创建，以确保 `nudge_records` 审计记录完整写入。本接口仅用于以下两类场景：
> - **任务下发**：由 §2.4 Dispatch Task 内部调用，为每个 assignment 批量写入 `task_assigned` 通知
> - **任务信息变更**：由 §2.3 Edit Task 内部调用，写入 `task_updated` 通知

- **接口名称**：创建系统通知事件（task_assigned / task_updated）
- **接口路径**：`/events`
- **请求方法**：POST
- **请求头**：需携带通用请求头
- **请求体**：
  ```json
  {
    // event_type 仅允许：task_assigned / task_updated
    // ❌ nudge_yellow / nudge_orange / nudge_red 禁止通过本接口创建，必须走 POST /nudges（§4.5）
    "eventType": "task_assigned/task_updated", // 必填
    "taskId": "string",       // 必填，notification_events.task_id
    "assignmentId": "string", // task_assigned 必填；task_updated 可空（notification_events.assignment_id）
    // targetUserId = notification_events.target_user_id → employees.id（如 E001）
    "targetUserId": "string", // 必填
    // store_id 不需要前端传入：服务端写入时自动从 employees.store_id 读取并冗余存储
    // dedupeKey 规则（对应 PARTIAL UNIQUE INDEX）：
    //   task_assigned → "task:{task_id}:user:{user_id}"（UNIQUE INDEX 防重）
    //   task_updated  → 可空，不强制去重
    "dedupeKey": "string"     // task_assigned 必填；task_updated 可空
    // severity / operatorId / operatorRole 本接口均为 null（系统自动触发）
    // 表内有 content 列（催办展示文案），但仅由 §4.5 / 自动预警异步写入；本接口不支持传入 title/content
  }
  ```
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "事件创建成功",
    "data": {
      "eventId": "string",    // notification_events.id（nanoid）
      "eventType": "string",  // task_assigned / task_updated
      "createdAt": "string"   // notification_events.created_at（ISO8601）
    },
    "requestId": "string"
  }
  ```
- **接口说明**：系统内部写入 `notification_events` 表。`dedupeKey` + DB 层 PARTIAL UNIQUE INDEX 保证 `task_assigned` 事件幂等（重复调用不报错，返回已有 eventId）。**催办事件（nudge_yellow / nudge_orange / nudge_red）禁止通过本接口创建，必须通过 §4.5 发起催办，以保证 `nudge_records` 审计链完整。预警数据无独立存储表，从 `task_assignments` 实时聚合计算**（见 §5.5）。
- **权限要求**：
  - central：仅可触发本人有权限的任务事件
  - employee：无创建权限
- **异常场景**：
  - 400：必填参数缺失 / eventType非法（含nudge_yellow/nudge_orange/nudge_red）/ task_assigned类assignmentId为空
  - 403：越权创建
  - 409：dedupeKey已存在（幂等，返回已有eventId，不重复写入）

### 4.2 获取系统事件列表**P0**

- **接口名称**：获取系统事件列表
- **接口路径**：`/events`
- **请求方法**：GET
- **请求头**：需携带通用请求头
- **查询参数**：
  | 参数名 | 类型 | 必选 | 说明 |
  |--------|------|------|------|
  | eventType | string | 否 | 事件类型：task_assigned/nudge_yellow/nudge_orange/nudge_red/task_updated |
  | taskId | string | 否 | 关联任务ID（notification_events.task_id） |
  | targetUserId | string | 否 | 目标用户ID（employees.id），不传则默认当前 Employee-Id |
  | assignmentId | string | 否 | 关联分配记录ID（notification_events.assignment_id） |
  | storeId | string | 否 | 门店ID过滤（notification_events.store_id，直接命中索引） |
  | severity | string | 否 | 催办级别：yellow/orange/red |
  | isActive | boolean | 否 | 活跃状态过滤（计算值：关联 assignment 未 completed 则为 true），默认 true |
  | readStatus | boolean | 否 | 是否已读（JOIN read_receipts 计算） |
  | pageNum | int | 是 | 页码，默认1 |
  | pageSize | int | 是 | 页大小，默认20 |

  > **注意：** `storeId` 是 `notification_events` 的冗余存储字段（从 `employees.store_id` 复制，有独立索引），可直接用于门店过滤，无需 JOIN。

- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "list": [
        {
          "eventId": "string",     // notification_events.id（nanoid）
          "eventType": "string",   // task_assigned/nudge_yellow/nudge_orange/nudge_red/task_updated
          "taskId": "string",      // notification_events.task_id
          "assignmentId": "string", // notification_events.assignment_id，可为 null
          "targetUserId": "string", // notification_events.target_user_id（= employees.id）
          "storeId": "string",     // notification_events.store_id（冗余，= employees.store_id）
          "severity": "string",    // notification_events.severity（yellow/orange/red），非催办事件时为 null
          "content": "string",     // notification_events.content；催办类为展示文案，异步写入完成后非 null；其它事件多为 null
          "ruleType": "string",    // string|null，预警规则类型（如 deadlineCrisisP0, deadlineCrisisP2），非预警时为 null
          // isActive 计算规则（不存储于 DB）：
          //   event_type IN ('task_assigned', 'nudge_yellow', 'nudge_orange', 'nudge_red')
          //     → ta.status != 'completed'（任务未完成时为 true，完成后为 false）
          //   event_type = 'task_updated'
          //     → 始终为 true（不绑定 assignment 完成状态）
          "isActive": true,
          // resolvedAt 计算规则（不存储于 DB）：
          //   event_type IN ('task_assigned', 'nudge_*') → ta.completed_at（未完成时为 null）
          //   event_type = 'task_updated'               → 始终为 null
          "resolvedAt": "string",
          // readStatus/readAt：按 (event_id,user_id) 聚合 read_receipts（多 source 取最早 read_at）；任一来源已读即已读
          "readStatus": false,     // 当前用户是否已读
          "readAt": "string",      // 最早 read_at，未读时为 null
          "initiatorId": "string", // notification_events.initiator_id（users.id，串化），系统触发时为 null
          "createdAt": "string"    // notification_events.created_at（ISO8601）
        }
      ],
      "pagination": {
        "pageNum": 1,
        "pageSize": 20,
        "total": 100,
        "totalPages": 5
      },
      "unreadCount": 10 // 当前用户满足筛选条件的未读事件总数
    },
    "requestId": "string"
  }
  ```
- **接口说明**：获取通知类和催办类系统事件列表。`isActive`/`resolvedAt` 为计算值（不存于 DB，由服务端 JOIN `task_assignments.status` 和 `completed_at` 推导）。`readStatus`/`readAt` 对 **`read_receipts` 按 `(event_id,user_id)` 聚合**（同一事件多平台回执时取最早 **`read_at`**），只要有一条回执即视为已读。**预警数据（§5.5）不在本接口，从 `task_assignments` 实时聚合。**
- **权限要求**：
  - central：所有事件
  - employee：仅本人事件（`target_user_id = 当前 Employee-Id`）
- **异常场景**：
  - 400：pageNum/pageSize非法

### 4.3 记录任务详情已读（打开任务详情）**P0**

- **接口名称**：记录任务详情打开（task_detail_open / 按平台分源）
- **接口路径**：`/assignments/{assignmentId}/viewed`
- **请求方法**：POST
- **请求头**：需携带通用请求头
- **路径参数**：assignmentId（必填，task_assignments.id）
- **查询参数**：
  | 参数名 | 类型 | 必选 | 说明 |
  |--------|------|------|------|
  | platform | string | 否 | 任务合集平台：与 **`PUT /assignments/:id/status`** 的 **`complete_platform`** 使用同一套别名（**`server/utils/platforms.js`**），如 `mypal`、`SmartSales`。不传则回执 **`source = task_detail_open`**（与旧版「整单已读」一致）；传入则 **`source = task_detail_open:{平台标签}`**（如 `task_detail_open:MyPAL`）。非法值 **400 `ASSIGN_012`**；任务未开启对应 **`tasks.has_*`** 时 **400 `ASSIGN_015`**。 |
- **请求体**：无
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "assignmentId": "string",
      "receivedAt": "string",   // task_assignments.received_at（首次打开时写入，已有则返回原值）
      "receiptId": "string",    // read_receipts.id（本次写入或已有；无 Employee-Id 时可能为 null）
      "alreadyViewed": false,   // true=已经打开过（received_at 已有值），false=首次打开
      "source": "task_detail_open",           // 或 "task_detail_open:MyPAL" 等，与 DB 写入一致
      "platform": "MyPAL"                     // 规范化标签；未传 platform 时为 null
    },
    "requestId": "string"
  }
  ```
- **接口说明**：用户打开任务详情页时前端自动调用。服务端在**同一事务**内：
  1. 若 `task_assignments.received_at` 为 NULL，写入当前时间并更新 `updated_at`。
  2. **保证**存在与该 assignment 对应的 **`task_assigned`** 通知行：若尚无，则插入 `notification_events`（`dedupe_key` 与 **`POST /tasks/{id}/dispatch`** 一致：`task:{taskId}:user:{userId}`，与 batch-create 等路径补数后对齐）。
  3. 写入 `read_receipts`：**`source`** 为 **`task_detail_open`**（未传 `platform`）或 **`task_detail_open:{sourceLabel}`**（见上表）。`user_id` 来自请求头 `Employee-Id`。**`UNIQUE(event_id, user_id, source)`** 保证同一用户、同一事件、同一来源幂等；不同平台可各有一条回执。

  **看板「已读人数」**：未传 **`platform`** 时 **`employeeReadCount` / `managerReadCount`** 仅统计 **`read_receipts.source = 'task_detail_open'`**（精确，与未带 `platform` 的 **`POST .../viewed`** 写入一致；**不含** `task_detail_open:MyPAL` 等）。传 **`platform`** 时与 **`task_detail_open:{标签}`** 精确匹配。新建回执时服务端向看板 WebSocket 推送 **`dashboard_updated`**（**`operationType: assignment_viewed`**，**`data`** 可含 **`platform`**）。

  > **已移除**：`POST /api/v1/events/{eventId}/read`（原 `notification_click`）。历史库中仍可能存在 `source='notification_click'` 的回执记录。
- **权限要求**：仅 assignment 所属用户（`user_id` = 当前 Employee-Id）
- **异常场景**：
  - 404：assignmentId 不存在
  - 403：非所属用户
  - 400 **`ASSIGN_012`**：`platform` 非法
  - 400 **`ASSIGN_015`**：任务未配置该合集平台

### 4.4 获取未读事件数量**P0**

- **接口名称**：获取未读通知数量
- **接口路径**：`/events/unread-count`
- **请求方法**：GET
- **请求头**：需携带通用请求头
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "unreadCount": 12  // 铃铛角标数（仅统计「活跃且未读」的通知）
    },
    "requestId": "string"
  }
  ```
- **接口说明**：轻量级接口，专门用于铃铛角标展示当前用户的未读系统事件总数。**计算口径如下**（实现上对 **`read_receipts` 使用 `(event_id,user_id)` 子查询聚合**：同一用户、同一事件多条 `source` 时，只要存在任一回执即**不算未读**）：

  ```sql
  SELECT COUNT(*) FROM notification_events ne
  LEFT JOIN (
    SELECT event_id, user_id, MIN(read_at) AS read_at
    FROM read_receipts
    WHERE user_id = :currentUserId
    GROUP BY event_id, user_id
  ) rr ON rr.event_id = ne.id
  LEFT JOIN task_assignments ta ON ta.id = ne.assignment_id
  WHERE ne.target_user_id = :currentUserId
    AND rr.read_at IS NULL   -- 未读（无任何 source 的回执）
    AND (
      -- task_assigned / nudge_* 事件：关联 assignment 未完成才计入铃铛
      (ne.event_type IN ('task_assigned', 'nudge_yellow', 'nudge_orange', 'nudge_red')
        AND ta.status != 'completed')
      OR
      -- task_updated 事件：不绑定 assignment 状态，只要未读就计入
      ne.event_type = 'task_updated'
    )
  ```

  > **说明**：已完成任务对应的 `task_assigned` 和 `nudge_*` 通知即使未读也**不计入**角标（PRD：催办提示在任务完成后自动消失）。`task_updated` 通知与任务状态无关，未读就始终计入。

- **权限要求**：所有已登录用户（仅返回本人未读数）

### 4.5 发起催办（人工触发）**P0**

- **接口名称**：发起催办
- **接口路径**：`/nudges`
- **请求方法**：POST
- **请求头**：需携带通用请求头（Role=central）
- **请求体**：
  ```json
  {
    "taskId": "string",           // 必填，nudge_records.task_id
    "targetType": "employee/store/region", // 必填，nudge_records.target_type（DB CHECK 约束）
    "targetId": "string",         // 必填，nudge_records.target_id：
                                  //   targetType=employee → employees.id（如 E001）
                                  //   targetType=store    → stores.id（如 S001）
                                  //   targetType=region   → 区域名称（如"华东"，仅 central 可用）
    "severity": "yellow/orange/red"      // 必填，nudge_records.severity（DB CHECK 约束）
    // initiator_id 来自 JWT `req.user.id`（写入 nudge_records.initiator_id）
    // notification 内容由服务端根据 event_type+task 信息模板生成，不需前端传入
    // auto 模式属于 P2 AI Agent 能力，本接口仅支持人工触发
  }
  ```
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "催办已受理，文案生成异步写入中",
    "data": {
      "nudgeRecordId": "string",  // nudge_records.id（nanoid）
      "nudgedCount": 5,          // 与 queued 相同：本次催办涉及的未完成 assignment 条数（事务内已建 event 行）
      "queued": 5,                // 同上，可选冗余字段
      "skippedCount": 1,
      "failedCount": 0,
      "failedReasons": [],
      "notificationEventIds": ["string"],
      "async": true
    },
    "requestId": "string"
  }
  ```
- **接口说明**：发起人工催办。服务端**事务内**同步完成审计与通知行占位：
  1. 写 `nudge_records` 一条（`task_id / target_type / target_id / severity / initiator_id`）
  2. 按目标范围找到所有状态未为 `completed` 的 `task_assignments`，为每个 `user_id` 创建一条 `notification_events`（`event_type=nudge_yellow/nudge_red`，`severity` 同请求，`assignment_id` 必填，`initiator_id` = JWT `req.user.id`）
  3. 累加对应 `task_assignments.nudge_count += 1`
  4. 将本次生成的所有 event ID 列表写入 `nudge_records.notification_event_ids`（JSON 数组，`NOT NULL`，PRD §5.5 完整审计）

  事务提交后，在 **`setImmediate` 异步路径**中按人调用 `generate_nudge_message`，**`UPDATE notification_events SET content`**，并向对应用户推送 WebSocket（§15.2）。已完成的 assignment 自动跳过（计入 `skippedCount`）。
- **权限要求**：
  - **仅 `central`**（`requireRole(['central'])`）；可针对任意 Assignment；`targetType` 允许 `employee` / `store` / `region`
  - **`admin` / 其他角色：403**（`AUTH_003`）
- **异常场景**：
  - 400：taskId/targetType/targetId/severity 任一缺失 / targetType非法 / severity非法
  - 404：taskId不存在 / targetId对应员工/门店不存在
  - 409：目标范围内所有 assignment 均已完成（无可催对象）

> **WS 推送：** 写入成功后，向所有被触达用户（未完成的 assignment 对应 `user_id`）推送 `{ event: "nudge_sent", data: { nudgeRecordId, taskId, severity, eventType, } }`（见 §15.2）。

### 4.6 获取催办记录列表**P1**

- **接口名称**：获取催办记录列表
- **接口路径**：`/nudges`
- **请求方法**：GET
- **请求头**：需携带通用请求头
- **查询参数**：
  | 参数名 | 类型 | 必选 | 说明 |
  |--------|------|------|------|
  | taskId | string | 是 | 任务ID（nudge_records.task_id），必传 |
  | targetType | string | 否 | 催办范围过滤：employee/store/region |
  | targetId | string | 否 | 催办对象ID过滤（与 targetType 联用） |
  | severity | string | 否 | 催办级别：yellow/orange/red |
  | pageNum | int | 否 | 页码，默认1 |
  | pageSize | int | 否 | 页大小，默认20 |
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "list": [
        {
          "nudgeRecordId": "string",  // nudge_records.id（nanoid）
          "taskId": "string",         // nudge_records.task_id
          "targetType": "string",     // employee / store / region
          "targetId": "string",       // employees.id / stores.id / 区域名称
          "severity": "string",       // yellow / orange / red
          "initiatorId": "string",    // nudge_records.initiator_id（users.id 串化）
          // nudgedCount：本次催办生成的 notification_events 数量（JSON 数组长度）
          "nudgedCount": 3,
          "notificationEventIds": ["string"], // nudge_records.notification_event_ids（JSON 数组）
          "createdAt": "string"       // nudge_records.created_at（ISO8601）
        }
      ],
      "pagination": {
        "pageNum": 1,
        "pageSize": 20,
        "total": 10,
        "totalPages": 1
      }
    },
    "requestId": "string"
  }
  ```
- **接口说明**：查询指定任务的催办审计记录。`nudge_records` 是每次催办动作的事实日志（一次催办一条），`notificationEventIds` 是本次催办生成的所有通知 event ID 列表，供溯源。服务端可通过 JOIN `users` 表补充发起人姓名（扩展字段）。
- **权限要求**：
  - **仅 `central`**（与 `routes/nudge.js` 中 `requireRole(['central'])` 一致）
  - **`admin` / `employee` 等其他角色：403**（`AUTH_003`）

### 4.7 AI 辅助生成催办文案

- **接口路径**：`/nudges/ai-generate`
- **请求方式**：`POST`
- **权限要求**：`central`, `admin`
- **接口说明**：调用 Agent 技能 **`generate_nudge_message`**（`server/agent/skills/generateNudge.js`），内部使用 `utils/ai` 的 `generateText` 组装 Prompt；**上游模型与密钥以环境变量为准**，**非**固定为某一厂商文案。入参为任务与店员上下文、严重度 `yellow`/`red`。
- **请求参数 (Body)**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `taskId` | string | 是 | 任务ID |
| `userId` | string | 是 | 被催办店员ID |
| `severity` | string | 是 | `yellow` (轻松) 或 `red` (严厉) |

- **返回参数**：

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "content": "小伙伴，你的新品培训不足5小时就截止了！目前门店完成率80%，大家都在等你冲线哦！"
  },
  "requestId": "req-123..."
}
```

## 5. 数据看板 API（Dashboard）

### 5.0 可选 `platform`（任务合集平台颗粒度）**P0**

与 **`PUT /assignments/:id/status`** 的 **`complete_platform`**、**`POST /assignments/:id/viewed`** 的 **`platform`** 使用同一解析逻辑（**`server/utils/platforms.js`**）。**合法别名示例**（大小写/空格/下划线在规范化后匹配）：`mypal` / `my pal`；`smartsell` / `smart sales`；`ai_demo` / `ai coach`；`live_broadcast` / `直播培训` 等。

- **适用接口**：**`GET /dashboard/overview`**、**`/heatmap`**、**`/store-rank`**、**`/warnings`**、**`/trend`**、**`/nudge-conversion`**（均为可选查询参数 **`platform`**）。
- **非法值**：**400**，**`code: DASH_006`**，`message` 含「platform 非法」。
- **成功响应**：上述接口成功体 **`data`** 内均含 **`platform`**：**`null`**（未传参，与旧版整单口径一致）或规范化标签 **`MyPAL` / `SmartSales` / `AiDemo` / `LiveBroadcast`**。
- **完成判定**：传 **`platform`** 时，「已完成」以对应 **`task_assignments.*_completed = 1`** 为准（不再仅用 **`status = 'completed'`**）；**`/dashboard/trend`** 的完成时间戳为 **`COALESCE(completed_at, updated_at)`**。
- **进行中 / 待开始 / 触达已读（`taskReachRate`）**：传 **`platform`** 时，进行中/待开始依赖 **`read_receipts.source = task_detail_open:{平台标签}`** 的 **EXISTS**（与 assignment 关联）；**`taskReachRate`** 同条件。**未传 `platform`** 时：进行中/待开始仍为 **`status`** 口径；**`taskReachRate`** 为 **`last_login_at` / `received_at`**（**不**读 `read_receipts`）。**`employeeReadCount`** 见上文：未传参为 **`source = 'task_detail_open'`** 精确匹配。

### 5.1 获取总部看板概览数据**P0**

- **接口名称**：获取看板概览数据
- **接口路径**：`/dashboard/overview`
- **请求方法**：GET
- **请求头**：需携带通用请求头（Role=central/executive）
- **查询参数**：
  | 参数名 | 类型 | 必选 | 说明 |
  |--------|------|------|------|
  | taskId | string | 否 | 任务ID，为空则汇总所有任务 |
  | dimension | string | 否 | 聚合维度：store/dealer/format/employee（默认store）；**实现以代码为准** |
  | rtm | string | 否 | 门店下钻：与 `stores.rtm` 比对（忽略大小写、首尾空格） |
  | format | string | 否 | 门店下钻：与 `stores.format` 比对 |
  | dealerName | string | 否 | 门店下钻：与 `stores.dealer_name` 比对 |
  | storeId | string | 否 | 门店下钻：等于 `stores.id` |
  | platform | string | 否 | 任务合集平台过滤，语义见 **§5.0**；非法 **400 `DASH_006`** |
  > 下钻参数可组合，逻辑为 **AND**。均不传时全量（与旧版一致）。若需 **推送/已读** 与下钻范围一致，请同时传 **`taskId`**。
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      // ★ 以下数据均从 task_assignments / notification_events / read_receipts 实时聚合
      "totalAssignments": 300, // COUNT(*) FROM task_assignments WHERE task_id=?
      "platform": null,        // 或 "MyPAL" 等；与请求 platform 一致，见 §5.0
      "pushUserCount": 300,
      "employeeReadCount": 180,
      "totalReadCount": 180, 

      // 核心北极星指标
      "completionRate": 72.0,       // 未传 platform：status='completed'；传 platform：见 §5.0（*_completed）
      "completedCount": 216,
      "onTimeCompletionRate": 70,   // 按时完成率：completed_at <= ddl_at
      "avgCompletionTimeHours": 12.5, // 人均完成耗时 (从任务下发 created_at 到 completed_at)

      // 链路数据
      "taskReachRate": 100,         // 触达率 (百分比，默认100表示推送到全量)
      "taskReadRate": 60.0,         // 任务读取率：totalReadCount / totalAssignments
      "nudgeConversionRate": 50,    // 催办转化率：被催办后转化为在学或完成的比例
      
      // 预警数据（与 §5.5 下钻 warningRate 同规则：按 assignment 命中规则计数 ÷ totalAssignments×100）
      "crisisP2Rate": 5.5,          // 任务时间进度≥P2 阈值且未完成的 assignment 数 / 总人数
      "crisisP1Rate": 4.0,          // 任务处于 P1 临期带时，未完成 assignment 数 / 总人数
      "crisisP0Rate": 2.1,          // 任务处于 P0 临期带时，未完成 assignment 数 / 总人数

      "inProgressCount": 60,
      "pendingCount": 24,
      "overdueCount": 10,
      "updatedAt": "string",
      "warningCount": {
        "p2": 8, // 与 auto_nudge_rules.deadlineCrisis 一致：p2 档（时间进度 >= p2 阈值且未完成）
        "p1": 5, // 与 auto_nudge_rules.deadlineCrisis 一致：p1 档（默认距 ddl 不足 48h 且未完成）
        "p0": 3  // 同上 p0 档（默认不足 24h 且未完成）；未配置 deadlineCrisis 的任务不计入
      }
    },
    "requestId": "string"
  }
  ```
- **接口说明**：返回总部/Executive看板核心概览数据，按维度聚合，并包含PRD 6.12口径的推送人数/已读人数/真实发放率指标。**可选 `platform`** 时完成率、进行中/待开始、已读与 **`read_receipts`** 口径见 **§5.0**。
- **权限要求**：central/executive（executive按权限返回对应区域数据）
- **异常场景**：
  - 403：非总部/Executive角色
  - 400 **`DASH_006`**：`platform` 非法

### 5.2 获取RTM热力图数据**P0**

- **接口名称**：获取RTM热力图数据
- **接口路径**：`/dashboard/heatmap`
- **请求方法**：GET
- **请求头**：需携带通用请求头（Role=central/executive）
- **查询参数**：
  | 参数名 | 类型 | 必选 | 说明 |
  |--------|------|------|------|
  | taskId | string | 是 | 任务ID |
  | rtmLevel | string | 否 | 聚合维度，默认 `rtm`。支持：`rtm`、`region`、`format`、`subRtm`（同 `rtm`）、**`dealer`** / **`dealer_name`** / **`dealername`**（按 `stores.dealer_name`）、**`store`**（按门店，`rtmValue` 为店名） |
  | rtm | string | 否 | 可选门店下钻，同 §5.1 |
  | format | string | 否 | 同上 |
  | dealerName | string | 否 | 同上 |
  | storeId | string | 否 | 同上 |
  | platform | string | 否 | 任务合集平台，语义见 **§5.0** |
  > 下钻参数可组合（AND）；不传则全任务维度内全部门店（与旧版一致）。
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "taskId": "string",
      "rtmLevel": "string",
      "platform": null,
      "heatmapData": [
        {
          "rtmValue": "string",
          "completionRate": 65.0,
          "avgCompletionTimeHours": 12.5,
          "color": "#FF9900", // 热力图颜色（按完成率）
          "assignmentCount": 50,
          "completedCount": 32
        }
      ],
      "updatedAt": "string"
    },
    "requestId": "string"
  }
  ```
- **接口说明**：返回区域完成率热力图数据，支持不同层级聚合。**`platform`** 见 **§5.0**。
- **权限要求**：central/executive

### 5.3 获取Top/Bottom 5门店数据**P0**

- **接口名称**：获取门店完成率排行
- **接口路径**：`/dashboard/store-rank`
- **请求方法**：GET
- **请求头**：需携带通用请求头（Role=central/executive）
- **查询参数**：
  | 参数名 | 类型 | 必选 | 说明 |
  |--------|------|------|------|
  | taskId | string | 是 | 任务ID |
  | type | string | 是 | 排行类型：top/bottom |
  | limit | int | 否 | 数量，默认5 |
  | rtm | string | 否 | 可选门店下钻，同 §5.1（含原「仅 format」能力，见 `format`） |
  | format | string | 否 | 门店下钻 |
  | dealerName | string | 否 | 门店下钻 |
  | storeId | string | 否 | 门店下钻 |
  | platform | string | 否 | 任务合集平台，语义见 **§5.0** |
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "taskId": "string",
      "type": "top",
      "platform": null,
      "rankList": [
        {
          "storeId": "string",
          "storeName": "string",
          "completionRate": 98.0,
          "assignmentCount": 6,
          "completedCount": 5
        }
      ],
      "updatedAt": "string"
    },
    "requestId": "string"
  }
  ```
- **接口说明**：返回完成率Top/Bottom N门店数据。**`platform`** 见 **§5.0**。
- **权限要求**：
  - central/executive：所有门店

### 5.4 导出任务进度报表**P1**

- **接口名称**：导出任务进度报表
- **接口路径**：`/dashboard/reports/export`
- **请求方法**：POST
- **请求头**：需携带通用请求头（Role=central/executive）
- **请求体**：
  ```json
  {
    "taskId": "string", // 可选，指定任务，为空则导出所有任务
    "dimension": "store/format/employee", // 导出维度，必填
    "rtm": "string", // 可选，指定RTM（仅executive需填）
    "timeRange": {
      "startDate": "string", // 可选，开始时间
      "endDate": "string" // 可选，结束时间
    },
    "format": "xlsx/pdf", // 导出格式，必填
    "include": [
      "completion_rate",
      "timeline_analysis",
      "nudge_effect",
      "rtm_baseline"
    ] // 包含的分析模块，必填
  }
  ```
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "报表导出成功",
    "data": {
      "reportId": "string",
      "downloadUrl": "string", // 报表下载链接
      "expiresAt": "string", // 链接过期时间（24小时）
      "fileSize": "5MB",
      "estimatedAnalysis": {
        "completionRate": "72.5%",
        "avgCompletionTime": "48小时",
        "topStore": "上海南京西路店",
        "bottomFormat": "APR"
      }
    },
    "requestId": "string"
  }
  ```
- **接口说明**：导出多维度任务进度报表，支持完成率、时间线分析、催办效果、地区对标等数据
- **权限要求**：central/executive（executive仅能导出授权区域数据）
- **异常场景**：
  - 400：dimension/format/include参数缺失
  - 403：非总部/executive角色调用
  - 503：报表生成服务不可用

### 5.4.5 获取完成人数时间趋势（新增）**P0**

- **接口名称**：完成人数时间趋势
- **接口路径**：`/dashboard/trend`
- **请求方法**：GET
- **请求头**：需携带通用请求头（Role=central/executive/admin）
- **查询参数**：
  | 参数名 | 类型 | 必选 | 说明 |
  |--------|------|------|------|
  | taskId | string | 是 | 任务ID |
  | type | string | 否 | `daily`（按天，默认）或 `hourly`（按小时） |
  | date | string | 否 | 查询具体日期的 `hourly` 数据时传入（格式 `YYYY-MM-DD`），默认当天 |
  | rtm | string | 否 | 可选门店下钻，同 §5.1（仅统计该范围内 assignment 的完成时间） |
  | format | string | 否 | 同上 |
  | dealerName | string | 否 | 同上 |
  | storeId | string | 否 | 同上 |
  | platform | string | 否 | 任务合集平台，语义见 **§5.0** |
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "taskId": "string",
      "type": "daily",
      "platform": null,
      "date": "2026-04-03", // 仅 type=hourly 时有效
      "trendData": [
        {
          "timeKey": "2026-04-01",  // daily返回日期，hourly返回小时(如 "09", "10")
          "newCompleted": 15,       // 该时间段内新增完成人数
          "cumulativeCompleted": 15 // 该时间段结束时的累计完成人数（hourly为当日累计）
        }
      ]
    },
    "requestId": "string"
  }
  ```
- **接口说明**：用于绘制完成趋势折线图与柱状图。**`platform`** 时「新增完成」按该平台 **`_completed`** 与 **`COALESCE(completed_at, updated_at)`** 口径，见 **§5.0**。
- **权限要求**：central/executive

### 5.5 获取预警列表**P0**

- **接口名称**：获取预警列表数据
- **接口路径**：`/dashboard/warnings`
- **请求方法**：GET
- **请求头**：需携带通用请求头（Role=central）
- **查询参数**：
  | 参数名 | 类型 | 必选 | 说明 |
  |--------|------|------|------|
  | taskId | string | 否 | 任务ID，为空则汇总所有已下发任务 |
  | warningLevel | string | 否 | 预警级别：`p2` / `p1` / `p0`。`p2` (原 startDelay)：任务时间进度占比 ≥ `p2` 阈值，且存在未完成的 assignment；`p1/p0` 临期；不传则三者混合 |
  | level | string | 否 | 聚合维度：`store`（默认，门店）、`rtm`（渠道）、`format`（业态）、`dealer`（经销商） |
  | pageNum | int | 是 | 页码，默认1 |
  | pageSize | int | 是 | 页大小，默认20 |
  | rtm | string | 否 | 可选门店下钻过滤，同 §5.1 |
  | format | string | 否 | 同上 |
  | dealerName | string | 否 | 同上 |
  | storeId | string | 否 | 同上 |
  | platform | string | 否 | 任务合集平台，语义见 **§5.0** |
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "platform": null,
      "list": [
        {
          // 预警数据从 task_assignments 实时聚合计算（无独立 alerts 存储表）
          // P1/P0：与 tasks.auto_nudge_rules.deadlineCrisis 及 autoNudge 扫描一致（默认 48h/24h 可配置）
          "taskId": "string",
          "targetId": "string",    // 聚合维度 ID（如门店 ID 或 RTM 名称）
          "targetName": "string",  // 聚合维度名称
          "targetType": "string",  // 聚合维度类型 (store/rtm/format/dealer)
          "storeId": "string",      // 兼容字段：同 targetId
          "storeName": "string",    // 兼容字段：同 targetName
          "warningLevel": "p1",     // p2 / p1 / p0
          "warningRate": 20.0,      // 与 §5.1 同公式在单实体范围：P2(yellow)=时间进度过半但未完成人数/总人数×100；临期 P0(red)/P1(orange)=未完成人数/总人数×100（且任务已落在对应临期带）
          "completionRate": 45.0,   // 实体完成率（task_assignments），与 warningRate 不同
          "completedCount": 2,      // 已完成人数
          "totalCount": 5,          // 总应完成人数
          "overdueCount": 3,        // 逾期：未「完成」且 ddl_at < now；传 platform 时「完成」见 §5.0
          "riskCount": 3,           // 与 warningRate 分子一致（历史催办人数或未完成兜底）
          "triggerDesc": "距 Deadline 不足N小时，仍未完成（P1）", // N 为任务配置的 p1 小时（默认 48）
          "aiSuggestion": "建议总部发起红牌催办，需重点跟进", // MVP 阶段为模板文案，非 AI 实时生成
          "updatedAt": "string"     // 实现字段名；列表项最后更新时间
        }
      ],
      "pagination": {
        "pageNum": 1,
        "pageSize": 20,
        "total": 8,
        "totalPages": 1
      }
    },
    "requestId": "string"
  }
  ```
- **接口说明**：**预警无独立存储表**。按门店+任务聚合，分级与 `auto_nudge_rules.deadlineCrisis` / `evaluateAndTriggerAutoNudges` 一致（P0阈值默认 24h，P1阈值默认 48h，P2时间占比默认 50%，已过期不计入任何临期/预警档）；未配置 `deadlineCrisis` 的任务不出现在预警列表。**`warningRate`** 与 §5.1 概览中对应 KPI **同一计算方式**，仅分子分母缩至该门店；传 **`platform`** 时「未完成/已完成」与 **§5.0** 一致。MVP 阶段 `aiSuggestion` 为静态模板文案。
- **权限要求**：仅总部角色（central）
- **异常场景**：
  - 400：warningLevel非法（非 p2/p1/p0）
  - 400 **`DASH_006`**：`platform` 非法
  - 403：非总部角色

### 5.6 门店任务明细（下钻）**P0**

- **接口名称**：按门店查看某任务下员工进度明细
- **接口路径**：`/dashboard/store-detail`
- **完整 URL 示例**：`GET /api/v1/dashboard/store-detail`
- **请求方法**：GET
- **请求头**：需携带通用请求头
- **查询参数**：
  | 参数名 | 类型 | 必选 | 说明 |
  |--------|------|------|------|
  | taskId | string | 是 | 任务 ID |
  | storeId | string | 是 | 必填 |
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "taskId": "string",
      "store": {
        "id": "string",
        "name": "string",
        "region": "string",
        "rtm": "string",
        "format": "string"
      },
      "summary": {
        "totalCount": 6,
        "completedCount": 4,
        "completionRate": 67,
        "inProgressCount": 1,
        "pendingCount": 1
      },
      "employees": [
        {
          "employeeId": "string",
          "employeeName": "string",
          "status": "pending/in_progress/completed",
          "progress": 80,
          "lagLevel": "fast|medium|behind",
          "platformStatus": {
            "mypalCompleted": true,
            "smartsellCompleted": false,
            "aiDemoCompleted": false,
            "liveBroadcastCompleted": false
          },
          "nudgeCount": 0,
          "receivedAt": "string|null",
          "startedAt": "string|null",
          "completedAt": "string|null",
          "updatedAt": "string"
        }
      ],
      "updatedAt": "string"
    },
    "requestId": "string"
  }
  ```
- **接口说明**：`lagLevel` 由 `progress` 推导：`>=80` → `fast`，`>=50` → `medium`，否则 `behind`。员工列表按 `progress DESC` 排序。
- **权限要求**：`central` / `admin`
- **异常场景**：
  - 400：缺少 `taskId`（`DASH_001`）；未传 `storeId`（`DASH_004`）

### 5.7 看板智能洞察（生成 + 点赞/点踩）**P0**

- **接口名称**：生成看板模块 AI 洞察文案；对指定洞察投票
- **接口路径**：`POST /dashboard/insights`、`POST /dashboard/insights/{insightId}/vote`
- **完整 URL 示例**：`POST /api/v1/dashboard/insights`、`POST /api/v1/dashboard/insights/{insightId}/vote`
- **请求方法**：POST
- **请求头**：`Authorization: Bearer {token}`

#### 5.7.1 生成洞察 `POST /dashboard/insights`

**与前端看板五个模块名称对齐（产品名 → `insightType` → 业务含义）**

总部看板侧五个模块与后端 **`insightType`**、LLM Prompt 数据口径对应关系如下（调用时请传 **`insightType`**；`module` 仅为旧版兼容字段）。

| 前端模块名称 | `insightType` | 说明 |
|--------------|---------------|------|
| **北极星** | `north_star` | 聚焦 **按时完成率** 与 **人均完成耗时（小时）**，并辅以总人数、待开始/进行中/已完成/逾期等分布，用于判断任务整体健康度与节奏（对应 Prompt：北极星模块）。 |
| **完成人数趋势** | `completion_weekly` 或 `completion_daily` | 同一前端模块下的两种时间粒度：**周趋势** 取最近有完成记录的自然日序列（最多 7 段）形成「第 N 天 + 新增/累计完成」；**日内趋势** 取指定 `date` 当天按 2 小时桶的完成分布（对应 Prompt：完成人数模块-周 / 完成人数模块-日）。传 `completion_daily` 时建议带 **`date`**（`YYYY-MM-DD`），默认当天。 |
| **区域进度与门店排行** | `channel_north_star` | 按门店所属 **`stores.rtm` 渠道**（Multibrand、Monobrand、Enterprise、Education、Carrier）聚合 **按时完成率** 与 **人均完成时长（分钟）**，并给出大盘均值/中位数与各渠道对比，用于「区域/渠道侧」执行差异与归因（与 §5.2 热力、§5.3 门店排行同源任务数据域；对应 Prompt：分渠道北极星下钻）。 |
| **漏斗链路数据** | `conversion_funnel` | 聚焦漏斗各层级转化率（推送->阅读->在学->完课），分析流失节点。 |
| **预警率统计** | `funnel_alerts` | 聚焦逾期、各级预警率及催办有效性转化率。 |

> **存储说明**：落库字段仍为 `dashboard_insights.module_type`，取值与上表 **`insightType`** 一致（见 `docs/backend/03-DATABASE.md` §12）。

- **请求体（JSON）**：
  | 字段 | 类型 | 必选 | 说明 |
  |------|------|------|------|
  | insightType | string | 是 | 见上表「前端模块名称 ↔ insightType」；枚举：`north_star`、`completion_weekly`、`completion_daily`、`channel_north_star`、`funnel_alerts`、`conversion_funnel` |
  | taskId | string | 条件 | `completion_weekly`、`completion_daily`、`channel_north_star` **必填**；`north_star`、`funnel_alerts` 可选（不传则按全任务范围） |
  | rtm / format / dealerName / storeId | string | 否 | 与 §5.1 下钻一致，可组合 AND |
  | date | string | 否 | `completion_daily` 建议传 `YYYY-MM-DD`，默认当天 |
  | trendType | string | 否 | 兼容旧入参：仅旧 `module=trend` 生效（`daily`/`hourly`） |
  | rtmLevel | string | 否 | 兼容旧入参：仅旧 `module=heatmap_rank` 生效 |
  | module | string | 否 | **兼容旧客户端**：`trend` / `heatmap_rank` / `funnel` / `warning_stats`（服务端会自动映射到 `insightType`） |
  | reasoning | boolean | 否 | **`true`** 时使用 **`deepseek-reasoner`**（深度思考）；省略或 **`false`** 时使用 **`deepseek-chat`** |

- **响应（固定 SSE，成功不再返回单次 `application/json` 200 正文）**：
  - **Content-Type**：`text/event-stream; charset=utf-8`
  - **SSE 事件**（每行 `event:` + `data:` + 空行）：
    - **`delta`**：`data` 为 JSON，`{ "text": "<增量片段>", "phase": "content" }`；使用 **`deepseek-reasoner`** 时 **`phase`** 可能为 **`reasoning`**（思维链片段）或 **`content`**（最终答复片段）；**`deepseek-chat`** 时一般为 **`content`**
    - **`done`**：生成结束且已写入 `dashboard_insights`。`data` 为与原先 JSON 成功响应**同形**的外层对象：
      ```json
      {
        "code": 200,
        "message": "success",
        "data": {
          "insightId": "string",
          "insightType": "north_star",
          "module": "north_star",
          "taskId": "string|null",
          "filters": { "rtm": null, "format": null, "dealerName": null, "storeId": null },
          "content": "string",
          "createdAt": "string",
          "voteSummary": { "up": 0, "down": 0 },
          "model": "deepseek-chat",
          "reasoning": false
        },
        "requestId": "string"
      }
      ```
    - **`error`**：`data` 为 `{ "message": "...", "code": "INSIGHT_xxx" }`（若校验失败仍走常规 **400 JSON**，不建立 SSE）
  - **客户端**：请使用 **`fetch` + `POST` + 读取 `response.body`（ReadableStream）** 解析 SSE；浏览器原生 **`EventSource` 仅支持 GET**，不宜直接用于本接口。

- **接口说明**：服务端将当前模块相关的**聚合事实**（写入 `context_json`）送入 **DeepSeek 流式** LLM（需 **`DEEPSEEK_API_KEY`**）：默认 **`deepseek-chat`**；若 **`reasoning: true`** 则 **`deepseek-reasoner`**。落库正文为模型 **`content`**（不含思维链文本）。本接口不做 Floodgate/Gemini 回退。
- **权限要求**：`central` / `executive` / `admin`
- **异常场景**：400（`insightType` 非法、缺 `taskId` 等，`INSIGHT_001` / `INSIGHT_002`）；404/503 见实现

#### 5.7.2 点赞/点踩 `POST /dashboard/insights/{insightId}/vote`

- **路径参数**：`insightId` — `POST /insights` 返回的 `insightId`
- **请求体**：
  ```json
  { "vote": "up" }
  ```
  `vote` 取值：`up`（赞）或 `down`（踩）。每次请求对对应计数 **+1**，**不记录投票人**（可被重复点击累加，若产品需防刷需另加频控）。

- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "insightId": "string",
      "up": 2,
      "down": 1
    },
    "requestId": "string"
  }
  ```

- **接口说明**：在 **`dashboard_insights`** 行上更新 **`up_count` / `down_count`**。
- **权限要求**：`central` / `executive` / `admin`
- **异常场景**：400（`vote` 非法 `INSIGHT_003`）；404（洞察不存在 `INSIGHT_404`）


### 5.8 看板智能 Agent 诊断 **P0**

- **接口名称**：获取看板 Agent 智能诊断
- **接口路径**：`/dashboard/agent/diagnose`
- **请求方法**：GET
- **权限要求**：`central`, `executive`, `admin`
- **查询参数**：
  | 参数名 | 类型 | 必选 | 说明 |
  |--------|------|------|------|
  | refresh | boolean/string | 否 | 传 `true` 或 `1` 强制刷新，否则返回库里最新的一条诊断结果（如无则生成） |
- **业务规则**：
  - 后端设有定时任务（每小时执行一次）自动在后台请求 AI 获取结果并存入数据库，并通过 WebSocket 广播 `dashboard_agent_updated` 给前端，提醒前端可以重新拉取。
  - 本诊断接口底层已升级为 **ReAct** (Reasoning and Acting) 框架，Agent 执行时会自动进行多轮思考（Chain of Thought）。
  - Agent 具备 **Tool Calling** (函数调用) 能力，能够自主调用工具获取当前任务列表。
  - **多 Agent 协作**（v1.5.7+）：在主 Agent 执行前，**`server/services/dashboardSubAgents/runRegionAnalyzers`** 会对每个 dispatched 任务并行运行 4 个区域子 Agent（`funnelAnalyzer` / `warningAnalyzer` / `trendAnalyzer` / `rtmAnalyzer`，全局并发上限 6）。每个子 Agent 基于 **`dashboardQueryCore`** 的同源切片调用 `simpleChat (deepseek-chat)`，强制返回 `{ severity, summary, keyFindings, focusHint }`，LLM 异常时分析器内置模板降级（`degraded=true`）。子 Agent 单次输出**不缓存**。
  - 主 Agent 通过 **`query_active_tasks`** 看到的每个任务对象 **不再**包含原始看板大数据（不再有 `boardView`），而是仅含 **`taskId` / `title` / `ddl_at` / `avgProgressPercent` / `regionInsights`**（4 段子 Agent 文案：`funnel` / `warning` / `trend` / `rtm`）。主 Agent 综合 4 个 region 的 `severity` 与 `focusHint` 给出最终 `topTasks` 与 `focusModule`，引用数字必须来自 `keyFindings`。
  - Agent 具备 **长期记忆与自我进化** 能力：每次分析前它会自主调用 `read_agent_guidelines` 读取属于自己领域的经验；在分析遇到新情况时，会主动调用 `upsert_agent_guidelines` 将新旧知识融合成不超过 1000 字的精华维基文档，覆盖写入数据库表 `agent_guidelines`。**子 Agent 与主 Agent 共享 `agent_type='dashboard'` 命名空间，但子 Agent 当前仅读不写。**
  - Agent 根据读取到的数据和经验，评判各任务的紧急程度：`red`（最多1个）、`orange`、`green`。
  - 为每个任务提供一行建议（`insight`），并指定需要下钻聚焦的模块（`focusModule`），可取值：`north_star` (北极星_漏斗模块), `warning_details` (预警详情模块), `rtm_timezone` (分RTM完成率下钻和分时区完成人数模块), `crisis_p0`, `funnel_read_rate`, `nudge_conversion`, `metrics_overdue`。
  - 提供 `focusReason` 字段，作为对 `focusModule` 推荐的智能业务解释，包含具体的业务数据支撑。
  - 对总体其余任务情况提供一句业务总结 `overallSummary`。
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "redCount": 1,
      "orangeCount": 3,
      "greenCount": 1,
      "topTasks": [
        {
          "taskId": "TASK_A",
          "title": "iPhone 17 新品培训",
          "severity": "red",
          "insight": "任务即将到期且进度严重滞后，需重点催办",
          "focusModule": "warning_details",
          "focusReason": "催办转化率仅为15%，远低于均值，面临极高P0逾期风险，需立刻进入预警详情模块止损",
          "progress": 25.4
        }
      ],
      "overallSummary": "其余任务推进正常，无需特别干预。",
      "allTasks": [
        // 包含所有活跃任务的详细诊断列表
      ],
      "generatedAt": "2026-04-21 16:30:00"
    },
    "requestId": "string"
  }
  ```


### 5.9 获取催办转化率看板**P0**

- **接口名称**：获取各预警级别的累计催办事实与转化率
- **接口路径**：`/dashboard/nudge-conversion`
- **请求方法**：GET
- **权限要求**：`central`, `executive`, `admin`
- **查询参数**：
  | 参数名 | 类型 | 必选 | 说明 |
  |--------|------|------|------|
  | taskId | string | 否 | 任务ID，为空则汇总所有已下发的系统任务事实 |
  | level | string | 否 | 聚合维度：`store`（默认）、`rtm`、`format`、`dealer` |
  | pageNum | int | 否 | 页码，默认1 |
  | pageSize | int | 否 | 页大小，默认20 |
  | rtm / format / dealerName / storeId | string | 否 | 下钻过滤条件 |
  | platform | string | 否 | 任务合集平台，语义见 **§5.0**；非法 **400 `DASH_006`** |
- **业务规则**：
  - 本看板展示的是**历史累计发生过的事件事实**，不受任务进度实时变化导致“已消除”预警状态的影响。
  - **触发人数（nudged）**：历史上记录在 `notification_events` 表中的催办接收人数。
  - **转化人数（converted）**：收到该级别预警后，在预警 **`created_at`** 之后满足「完成」的人数。**未传 `platform`** 时：「完成」= **`task_assignments.status = 'completed'`** 且 **`completed_at > ne.created_at`**。**传 `platform`** 时：「完成」= 对应 **`_*_completed = 1`**（与 **§5.0** 一致，不再要求 `completed_at` 晚于预警时间）。同一人在完成前收到过多次同一级别预警时，**`COUNT(DISTINCT user_id)`** 只计 1 次转化。
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "platform": null,
      "list": [
        {
          "targetId": "string",
          "targetName": "string",
          "targetType": "store",
          "red": { "nudged": 50, "converted": 10, "rate": 20.0 },
          "orange": { "nudged": 100, "converted": 30, "rate": 30.0 },
          "yellow": { "nudged": 200, "converted": 100, "rate": 50.0 },
          "total": { "nudged": 250, "converted": 120, "rate": 48.0 }
        }
      ],
      "pagination": { "pageNum": 1, "pageSize": 20, "total": 1, "totalPages": 1 }
    },
    "requestId": "string"
  }
  ```

- **异常场景**：400 **`DASH_006`**：`platform` 非法

## 6. Executive Chat Agent API（核心AI Native接口）

> **与实现对齐**：`/api/v1/chat/*` 已挂载于 `server/app.js`。当前支持 `intent_routing` 与 `function_calling` 两种模式（通过 `CHAT_AGENT_MODE` 切换）。会话态采用 `memory_then_redis` 设计：先内存缓存（TTL=30m，容量=20，LRU），再预留 Redis 扩展。`/api/v1/ai/*` 与 `/api/v1/permissions/check` 仍为 P1（未挂载）。

> **产品行为、意图清单、`stores.region` 权限、数据溯源、LLM 可插拔说明：** 见 [09-EXECUTIVE-CHAT.md](./09-EXECUTIVE-CHAT.md)（与 PRD 4.0.5 §5.7 / §5.7.1 对齐）。

### 6.1 创建聊天会话**P1**

- **接口名称**：创建Executive Chat会话
- **接口路径**：`/chat/executive/sessions`
- **完整 URL 示例**：`POST /api/v1/chat/executive/sessions`
- **请求方法**：POST
- **请求头**：需携带通用请求头（Role=executive）
- **请求体**：
  ```json
  {
    "executiveId": "string", // 高管ID，与User-Id一致
    "roleScope": "national/regional/rtm", // 权限范围：全国 / 按大区(stores.region) / 按门店RTM
    "regions": ["华东", "华北"], // 当 roleScope=regional 时必填，元素与 stores.region 同源
    "rtm": "string" // 当 roleScope=rtm 时必填；门店 stores.rtm 精确匹配
  }
  ```
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "会话创建成功",
    "data": {
      "sessionId": "string", // 会话ID
      "createdAt": "string",
      "contextId": "string", // 上下文ID（多轮对话）
      "exampleQuestions": [ // 示例问题（首屏展示）
        "Q1新品培训完成率？",
        "APR业态最差的5家门店是哪些？",
        "现在有什么问题需要关注？"
      ]
    },
    "requestId": "string"
  }
  ```
- **接口说明**：创建高管聊天会话，生成上下文ID用于多轮对话。`regional` 与 PRD 区域总监「本辖区」对齐，过滤条件为 **`stores.region IN regions`**（见 [09-EXECUTIVE-CHAT.md](./09-EXECUTIVE-CHAT.md)）。`roleScope=national` 时忽略 `regions`、`rtm`。
- **权限要求**：仅executive角色
- **异常场景**：
  - 400：`roleScope=regional` 但 `regions` 为空或未传
  - 400：`roleScope=rtm` 但 `rtm` 为空

### 6.1a 总部看板机器人会话（与 Executive 等价）**P1**

- **说明**：与 **§6.1～6.2.1** 及消息相关接口 **同一套** `chatService`、同一 `chat_sessions` / `chat_messages` 表；仅路径前缀与角色不同，供 **总部端看板** 内嵌机器人对话使用。
- **路径前缀**：`/chat/dashboard/sessions`（完整 URL：`/api/v1/chat/dashboard/sessions/...`）
- **权限**：`central` 或 `admin`（与看板总部能力对齐）
- **接口清单**（与 executive 一一对应，将路径中的 `executive` 换为 `dashboard` 即可）：
  - `POST /chat/dashboard/sessions` — 创建会话
  - `POST /chat/dashboard/sessions/{sessionId}/messages` — 发消息（支持 `stream: true` SSE，约定同 §6.2）
  - `GET /chat/dashboard/sessions/{sessionId}/history` — 分页历史
  - `DELETE /chat/dashboard/sessions/{sessionId}` — 删除会话
  - `POST .../messages/{messageId}/feedback` — 反馈
  - `POST .../messages/{messageId}/regenerate` — 重新生成
- **会话隔离**：会话仍按 **当前登录用户 `user_id`** 归属；总部账号与 executive 账号各自会话互不可见。

### 6.2 发送聊天消息（Agent处理）**P1**

- **接口名称**：发送消息给Executive Agent
- **接口路径**：`/chat/executive/sessions/{sessionId}/messages`
- **请求方法**：POST
- **请求头**：需携带通用请求头（Role=executive）
- **路径参数**：sessionId（必填）
- **请求体**：
  ```json
  {
    "messageId": "string", // 消息唯一ID（前端生成）
    "content": "string",   // 自然语言问题，或在消歧场景下作为点击文本展示
    "executiveId": "string", // 发送人ID
    "contextId": "string", // 上下文ID，必填（创建会话返回）
    "stream": false,
    "clarificationResponse": {  // [可选] v3.0 Phase 1.2 消歧恢复响应
      "toolCallId": "string",  // 关联的上一次工具调用 ID
      "result": {              // 用户选择的结构化数据（如具体的 storeId）
        "storeId": "string"
      }
    }
  }
  ```
  **`stream: true`**：响应为 **`text/event-stream`（SSE）**，事件流定义如下：
  - `delta`：推送增量。data 为 `{ "text": "...", "phase": "...", "toolName"?: "...", "status"?: "...", "reasoningLevel"?: "summary" }`。
  
  **SSE Phase 枚举表：**

  | Phase | 说明 | `text` 字段内容 | 附加字段 |
  |---|---|---|---|
  | `reasoning` | 思维链 / 推理过程 | Token 片段 | `reasoningLevel` |
  | `content` | 最终答复正文 | Token 片段 | - |
  | `tool_start` | 工具开始执行 | 工具名称 | `toolName` |
  | `tool_end` | 工具执行结束 | - | `status` |
  | `clarify` | HITL 挂起（需消歧/补参） | `InterruptPayload` JSON | - |
  | `error` | 链路异常 | 错误描述文本 | - |

  - `done`：成功结束。data 为 `{ "code": 200, "message": "success", "data": { "messageId": "string", "markdownContent": "string", "replyContent": null|object, "responseTime": number, "contextId": "string", "timestamp": "string" }, "requestId": "..." }`。
  - `error`：失败。data 为 `{ "code": 500, "message": "...", "requestId": "..." }`。
  - **实现说明**：当前流式消息与 `resume` 路由均以 `stream=true` 或 `stream="langgraph"` 进入 LangGraph 引擎；`clarificationResponse.toolCallId` 需要与上一次工具调用 ID 对齐。

  - **响应体（成功，`stream` 未传或为 false）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "messageId": "string",
      "markdownContent": "string",
      "replyContent": null,
      "responseTime": 3500,
      "contextId": "string",
      "timestamp": "string"
    },
    "requestId": "string"
  }
  ```
- **接口说明**：核心AI Agent接口，处理自然语言查询，返回结构化回答，支持多轮上下文。当前实现中，FC / LangGraph 的最终对外正文以 `markdownContent` 为主；`replyContent` 在流式与非流式成功响应里均保持 `null`，用于兼容旧前端字段但不承载新结构化卡片数据。
- **权限要求**：仅executive角色
- **异常场景**：
  - 400：content为空/contextId不存在
  - 409：`CHAT_009`，重复的 messageId（幂等拦截）
  - 503：AI Agent服务未就绪（响应超时）

### 6.2.1 恢复聊天会话（Resume HITL）**P1**

- **接口路径**：`/chat/executive/sessions/{sessionId}/resume`
- **请求方法**：POST
- **请求头**：`Authorization: Bearer {token}`
- **请求体**：
  ```json
  {
    "resumePayload": { 
      "resume_type": "slot_fill" | "intent_shift" | "cancel",
      "selected_option_id": "string", // 选中项 ID
      "value": "any",                // 选中的原始值或输入文本
      "user_text": "string",         // 用于 intent_shift 的用户输入
      "toolCallId": "string"         // 关联的工具 ID
    },
    "stream": true
  }
  ```

#### 附：HITL 类型定义

**InterruptPayload (由后端在 `phase: clarify` 发送)**
```json
{
  "type": "select" | "input" | "confirm",
  "reason": "low_confidence_entity" | "missing_required_param" | "custom",
  "prompt": "请选择您要查询的门店",
  "options": [
    { "id": "string", "label": "string", "value": "any", "meta": { "intent_shift": boolean } }
  ],
  "resume_token": "call_abc123", // 必须在 resume 时传回作为 toolCallId 或 token
  "context": { "missingFields": ["string"] }
}
```

**ResumePayload (前端回传)**
```json
{
  "resume_type": "slot_fill",      // slot_fill: 补参数; intent_shift: 切意图; cancel: 取消
  "value": "上海陆家嘴店",
  "selected_option_id": "opt_1",
  "toolCallId": "call_abc123"
}
```

### 6.2.2 删除Executive Chat会话**P1**

- **接口名称**：删除Executive Chat会话
- **接口路径**：`/chat/executive/sessions/{sessionId}`
- **完整 URL 示例**：`DELETE /api/v1/chat/executive/sessions/{sessionId}`
- **请求方法**：DELETE
- **请求头**：需携带通用请求头（Role=executive）
- **路径参数**：`sessionId`（必填）
- **请求体**：无
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "会话已删除",
    "data": {
      "sessionId": "string"
    },
    "requestId": "string"
  }
  ```
- **接口说明**：硬删除该会话及其下全部 `chat_messages` 行；仅允许删除**当前登录用户**拥有的会话。
- **权限要求**：仅 executive；且 `sessionId` 必须属于 `req.user.id`
- **异常场景**：
  - 404：`CHAT_003`，会话不存在
  - 403：`CHAT_004`，非本会话所属用户

### 6.3 获取会话历史**P1**

- **接口名称**：获取聊天会话历史
- **接口路径**：`/chat/executive/sessions/{sessionId}/history`
- **请求方法**：GET
- **请求头**：需携带通用请求头（Role=executive）
- **路径参数**：sessionId（必填）
- **查询参数**：
  | 参数名 | 类型 | 必选 | 说明 |
  |--------|------|------|------|
  | pageNum | int | 是 | 页码，默认1 |
  | pageSize | int | 是 | 页大小，默认20 |
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "sessionId": "string",
      "historyList": [
        {
          "messageId": "string",
          "role": "assistant",
          "content": "string",        // assistant 的展示内容；当前实现为 markdownContent 或原始 content
          "markdownContent": "string", // assistant 的 Markdown 正文
          "replyContent": null|object,   // 当前实现保持 null；仅保留兼容字段
          "intentType": "string|null",
          "userFeedback": "like | dislike | null",
          "timestamp": "string"
        }
      ],
      "pagination": {
        "pageNum": 1,
        "pageSize": 20,
        "total": 3,
        "totalPages": 1
      }
    },
    "requestId": "string"
  }
  ```
- **接口说明**：返回高管聊天会话的历史消息，含Agent回答
- **权限要求**：仅会话所属executive

### 6.4 AI Agent 意图识别（内部接口）**P1**

- **接口名称**：识别Executive消息意图
- **接口路径**：`/chat/executive/intent-recognition`
- **请求方法**：POST
- **请求头**：需携带通用请求头（Role=central/executive）
- **请求体**：
  ```json
  {
    "content": "string", // 自然语言消息
    "contextId": "string" // 上下文ID
  }
  ```
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "intentType": "progress_query/project_status/warning_query/drill_down/analytics_query", // PRD §5.7 / §5.7.1；analytics_query 时需配合 analysisType
      "entities": { // 实体提取
        "taskName": "Q1新品培训",
        "rtm": "Monobrand",
        "dimension": "store",
        "topN": 5,
        "analysisType": "quantile_duration|completion_time_distribution|metric_correlation|progress_variance_by_channel|completion_rate_forecast|trimmed_mean_duration"
      },
      "confidence": 0.98, // 意图识别置信度
      "sqlQuery": "SELECT * FROM task_assignments WHERE taskId='xxx' AND store_id IN (SELECT id FROM stores WHERE rtm='Monobrand') LIMIT 5" // 生成的查询语句（可选）
    },
    "requestId": "string"
  }
  ```
- **接口说明**：AI Agent内部接口，识别用户意图并提取实体，生成数据查询逻辑
- **权限要求**：仅central/executive角色

### 6.5 DeepSeek 对话补全（OpenAI 兼容上游）**P1**

本小节描述 **服务端** 调用 [DeepSeek](https://api.deepseek.com) 的方式，以及与可选 **REST 代理接口** 的约定。密钥仅允许通过环境变量配置，**禁止在源码、配置仓库或日志中硬编码 API Key**。

#### 6.5.1 上游服务（官方 OpenAI 兼容 HTTP）

| 项 | 值 |
|----|-----|
| Base URL | `https://api.deepseek.com` |
| 默认模型 | `deepseek-chat` |
| 协议 | 与 OpenAI Chat Completions 兼容（可使用官方 `openai` Python SDK 或 Node `@openai/openai` 等，将 `base_url` 指向上述地址） |

**环境变量（必填，服务端）：**

| 变量名 | 说明 |
|--------|------|
| `DEEPSEEK_API_KEY` | DeepSeek 平台发放的 API Key；在本地开发中写入项目根目录 `.env`（已 `.gitignore`），生产环境由密钥管理注入 |

**Python 调用示例（与官方文档一致，Key 来自环境变量）：**

```python
# pip install openai
import os
from openai import OpenAI

client = OpenAI(
    api_key=os.environ.get("DEEPSEEK_API_KEY"),
    base_url="https://api.deepseek.com",
)

response = client.chat.completions.create(
    model="deepseek-chat",
    messages=[
        {"role": "system", "content": "You are a helpful assistant"},
        {"role": "user", "content": "Hello"},
    ],
    stream=False,
)

print(response.choices[0].message.content)
```

**Node.js 官方示例（OpenAI SDK，与 DeepSeek 文档一致；先执行 `npm install openai`）：**

```javascript
// npm install openai
import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: "https://api.deepseek.com",
  apiKey: process.env.DEEPSEEK_API_KEY,
});

async function main() {
  const completion = await openai.chat.completions.create({
    messages: [{ role: "system", content: "You are a helpful assistant." }],
    model: "deepseek-chat",
  });

  console.log(completion.choices[0].message.content);
}

main();
```

使用 **ESM**（`import`）时，需在 `package.json` 中设置 `"type": "module"`，或改用 `.mjs` 文件；若项目为 CommonJS，可用 `const OpenAI = require("openai")` 等价改写。与 Python 相同：**`apiKey` 仅来自 `process.env.DEEPSEEK_API_KEY`，禁止硬编码。**

- **流式：** 将 `stream=True`（Python）或 SDK 对应流式参数开启后，按 SSE/ chunk 消费即可。
- **错误与降级：** 上游不可用或鉴权失败时，业务层应返回 `503` 或统一错误体，并记录 `requestId`，不在响应中回显 Key。

#### 6.5.2 可选 REST 代理：`POST /ai/deepseek/chat`

若后端对前端或其他服务暴露统一网关，建议路径与请求体如下（与通用响应格式一致，见文档「响应体格式」）。

- **接口名称**：DeepSeek 对话补全（代理）
- **接口路径**：`/ai/deepseek/chat`
- **完整 URL 示例**：`POST /api/v1/ai/deepseek/chat`
- **请求方法**：POST
- **请求头**：需携带通用请求头（具体角色范围由产品定，建议至少 `central` / `executive` / `admin`）
- **请求体**：
  ```json
  {
    "model": "deepseek-chat",
    "messages": [
      { "role": "system", "content": "string" },
      { "role": "user", "content": "string" }
    ],
    "stream": false
  }
  ```
- **响应体（成功，非流式）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "id": "string",
      "model": "deepseek-chat",
      "content": "string",
      "finishReason": "stop"
    },
    "requestId": "string"
  }
  ```
- **接口说明**：服务端使用 `DEEPSEEK_API_KEY` 调用上游 `chat.completions`，将助手文本置于 `data.content`；**浏览器与客户端永不接触 DeepSeek Key**。
- **异常场景**：
  - 503：`DEEPSEEK_API_KEY` 未配置或上游不可用（`AI_001`）
  - 400：messages 为空或格式非法

### 6.6 语音转写（百炼 ASR）`POST /asr/transcribe`

服务端代理调用阿里云 DashScope **OpenAI 兼容模式** `chat/completions`，模型默认 **`qwen3-asr-flash`**，与官方 Node 示例（`input_audio` + `asr_options`）等价。**浏览器不接触 ASR Key**。

- **接口路径**：`/asr/transcribe`
- **完整 URL 示例**：`POST /api/v1/asr/transcribe`
- **请求方法**：POST
- **请求头**：`Authorization: Bearer <JWT>`（角色 **`central`** 或 **`admin`**）
- **请求体（二选一提供音频）**：
  ```json
  {
    "audioUrl": "https://example.com/audio.mp3",
    "language": "zh",
    "enableItn": false
  }
  ```
  或使用 Base64（服务端组装为 `data:<mime>;base64,<payload>`）：
  ```json
  {
    "audioBase64": "<base64 或已带 data: 前缀的字符串>",
    "audioMimeType": "audio/wav",
    "language": "zh",
    "enableItn": false
  }
  ```
  | 字段 | 类型 | 必选 | 说明 |
  |------|------|------|------|
  | audioUrl | string | 与 audioBase64 二选一 | 可公网访问的音频 URL（与百炼示例一致） |
  | audioBase64 | string | 与 audioUrl 二选一 | Base64 音频；可含 `data:audio/...;base64,` 前缀 |
  | audioMimeType | string | 否 | 与 audioBase64 联用，默认 `audio/wav` |
  | language | string | 否 | 传入上游 `asr_options.language` |
  | enableItn | boolean | 否 | 传入上游 `asr_options.enable_itn` |
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "text": "识别出的全文",
      "model": "qwen3-asr-flash"
    },
    "requestId": "string"
  }
  ```
  当环境变量 **`DEBUG_AI_LOG=true`** 时，`data` 中可能额外包含 **`raw`**（上游完整 JSON，仅排障用）。
- **环境变量**：**`ASR_API_KEY`**（推荐）或 **`DASHSCOPE_API_KEY`**；可选 **`ASR_BASE_URL`**（北京默认 `https://dashscope.aliyuncs.com/compatible-mode/v1`，新加坡见官方文档）、**`ASR_MODEL`**。
- **异常场景**：
  - **503** `ASR_001`：`ASR_API_KEY` / `DASHSCOPE_API_KEY` 均未配置
  - **400** `ASR_004`：未提供音频、或同时提供 `audioUrl` 与 `audioBase64`
  - **502** `ASR_002`：上游返回体非 JSON
  - 其他：上游 HTTP 状态或 `error` 字段映射为 **`ASR_003`** 及可读 `message`

### 6.7 实时语音合成 TTS 代理（WebSocket）`/ws/tts`

与 §6.6 相同密钥来源，协议为百炼 **Qwen-TTS Realtime**（非 HTTP JSON）。**浏览器不持有 DashScope Key**，仅携带登录 **JWT**。

- **完整 URL 示例**：`WebSocket` **`ws://<host>:<port>/ws/tts?token=<JWT>`**（开发环境经 Vite 代理：`ws://localhost:8001/ws/tts?...` → 后端 `:3000`）
- **鉴权**：Query **`token`** 为 JWT；角色需为 **`executive`**、**`central`** 或 **`admin`**；否则关闭码 **4003**。
- **未配置 Key**：关闭码 **4503**（与 HTTP `TTS` 类错误一致，客户端可提示「语音未配置」）。
- **客户端 → 代理（JSON 文本帧）**：
  - `{ "type": "start", "voice"?: "Cherry", "mode"?: "server_commit", "language_type"?: "Chinese" }` — 可选；默认由服务端在连接成功后已下发一次 `session.update`。
  - `{ "type": "append", "text": "..." }` — 映射为 **`input_text_buffer.append`**。
  - `{ "type": "finish" }` — 映射为 **`session.finish`**。
- **代理 → 客户端**：透传上游事件 JSON（如 **`response.audio.delta`**，`delta` 为 PCM base64；采样率默认 **24000**、**pcm**）。连接就绪后代理会先发 **`{ "type": "ready", "source": "tot-tts-proxy" }`** 便于前端衔接。
- **环境变量**：**`TTS_REALTIME_BASE_URL`**（可选）、**`TTS_MODEL`**（默认 `qwen3-tts-flash-realtime`）、**`TTS_VOICE`**（默认 `Cherry`）。

## 7. 权限校验 API

> **与实现对齐**：当前 **`server/app.js` 无** `/api/v1/permissions` 路由；权限由 **`authenticate` + `requireRole` / `requireTaskAccess`** 在各业务路由内完成。本节为 **预留/产品约定**。

### 7.1 校验用户资源访问权限**P1（未实现）**

- **接口名称**：校验资源访问权限
- **接口路径**：`/permissions/check`
- **请求方法**：POST
- **请求头**：需携带通用请求头
- **请求体**：
  ```json
  {
    "userId": "string", // 校验用户ID，与User-Id一致
    "resourceType": "task/assignment/dashboard/chat", // 资源类型
    "resourceId": "string", // 资源ID
    "action": "read/write/delete/nudge" // 操作类型
  }
  ```
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "hasPermission": true,
      "reason": "用户为总部角色，拥有任务所有操作权限"
    },
    "requestId": "string"
  }
  ```
- **接口说明**：通用权限校验接口，所有业务接口前置调用
- **权限要求**：所有角色

## 8. 数据统计 API

### 8.1 获取任务完成率统计**P1**

- **接口名称**：获取任务完成率统计
- **接口路径**：`/statistics/completion-rate`
- **请求方法**：GET
- **请求头**：需携带通用请求头
- **查询参数**：
  | 参数名 | 类型 | 必选 | 说明 |
  |--------|------|------|------|
  | taskId | string | 否 | 任务ID，为空则所有任务 |
  | groupBy | string | 是 | 分组维度：hour/day/week/month |
  | startTime | string | 否 | 开始时间 |
  | endTime | string | 否 | 结束时间 |
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "statisticsData": [
        {
          "time": "2026-03-20",
          "completionRate": 60.0,
          "completedCount": 180,
          "totalCount": 300
        }
      ],
      "trendType": "up" // 趋势：up/down/flat
    },
    "requestId": "string"
  }
  ```
- **接口说明**：按时间维度统计任务完成率趋势
- **权限要求**：
  - central：所有维度
  - executive：权限范围数据

### 8.2 AI Agent 生成统计报告**P2**

- **接口名称**：AI Agent生成培训统计报告
- **接口路径**：`/statistics/agent-report`
- **请求方法**：POST
- **请求头**：需携带通用请求头（Role=central/executive）
- **请求体**：
  ```json
  {
    "taskIds": ["string"], // 任务ID列表，为空则所有任务
    "timeRange": {
      "startTime": "string",
      "endTime": "string"
    },
    "dimension": ["store", "format", "employee"], // 统计维度
    "reportType": "daily/weekly/monthly", // 报告类型
    "agentId": "string"
  }
  ```
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "报告生成成功",
    "data": {
      "reportId": "string",
      "reportContent": { // AI生成的自然语言报告
        "title": "2026年3月培训任务周度报告",
        "overview": "本周共完成2个培训任务，整体完成率75%，较上周提升5%",
        "keyFindings": [
          "APR业态完成率提升10%，主要因总部催办及时",
          "MyPAL平台自动判定完成率达90%，手动标记仅10%"
        ],
        "suggestions": [
          "建议对Premium门店发起催办",
          "建议扩大MyPAL平台对接范围，减少手动标记成本"
        ],
        "dataAttachments": [ // 附件数据
          {
            "dimension": "store",
            "completionRate": 75.0,
            "topStores": [],
            "bottomStores": []
          }
        ]
      },
      "generatedAt": "string"
    },
    "requestId": "string"
  }
  ```
- **接口说明**：AI Agent按维度生成自然语言统计报告（PRD P2 AI Agent规划）
- **权限要求**：central/executive

## 9. AI Agent 核心能力扩展 API

### 9.1 AI Agent 任务扫描（巡检）**P2**

- **接口名称**：AI Agent扫描任务状态
- **接口路径**：`/agent/task-scan`
- **请求方法**：POST
- **请求头**：需携带通用请求头（Role=central）
- **请求体**：
  ```json
  {
    "scanType": "all/overdue/low_progress", // 扫描类型
    "taskStatus": "dispatched", // 仅扫描已下发任务
    "agentId": "string"
  }
  ```
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "扫描完成",
    "data": {
      "scannedTaskCount": 5,
      "abnormalTaskCount": 2,
      "abnormalDetails": [
        {
          "taskId": "string",
          "abnormalType": "low_progress",
          "description": "完成率<60%，涉及100人",
          "suggestion": "发起黄牌催办"
        }
      ],
      "scanReport": "string"
    },
    "requestId": "string"
  }
  ```
- **接口说明**：AI Agent自动巡检任务状态，识别异常并给出建议
- **权限要求**：central

### 9.2 AI Agent 上下文管理**P2**

- **接口名称**：更新/获取对话上下文
- **接口路径**：`/agent/context/{contextId}`
- **请求方法**：GET/PUT
- **请求头**：需携带通用请求头（Role=executive/central）
- **路径参数**：contextId（必填）
- **PUT请求体**：
  ```json
  {
    "contextData": { // 上下文数据，含历史问题/回答/实体
      "historyIntents": ["progress_query"],
      "extractedEntities": {
        "rtm": "Monobrand",
        "taskName": "Q1新品培训"
      },
      "drillDownLevel": "store" // 下钻层级：national/rtm/store/employee
    }
  }
  ```
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "contextId": "string",
      "contextData": {
        "historyIntents": [],
        "extractedEntities": {},
        "drillDownLevel": "string"
      },
      "updatedAt": "string"
    },
    "requestId": "string"
  }
  ```
- **接口说明**：管理Executive Chat的多轮对话上下文，支撑下钻查询
- **权限要求**：executive/central


### 9.3 AI Agent 工具调用（Function Calling，企业级核心）**P2**

- **接口名称**：Agent 标准化工具调用
- **接口路径**：`/agent/tool-call`
- **请求方法**：POST
- **请求头**：需携带通用请求头（Role=central/executive）
- **请求体**：
  ```json
  {
    "agentId": "string", // 执行工具调用的Agent ID
    "sessionId": "string", // 会话ID（可选，聊天场景）
    "contextId": "string", // 上下文ID
    "toolName": "query_dashboard/trigger_nudge/generate_report/call_external_api", // 工具名称
    "toolParams": { // 工具入参（动态结构化参数）
      "taskId": "string",
      "rtm": "string",
      "employeeId": "string"
    },
    "operatorId": "string", // 操作人ID
    "syncMode": true // 同步/异步调用：true=同步返回结果，false=异步返回任务ID
  }
  ```
- **响应体（同步成功）**：
  ```json
  {
    "code": 200,
    "message": "工具调用成功",
    "data": {
      "toolCallId": "string", // 工具调用唯一ID
      "toolName": "string",
      "result": {}, // 工具执行结果（动态结构化数据）
      "status": "success", // 执行状态：success/failed/running
      "executedAt": "string",
      "asyncTaskId": null // 异步模式返回任务ID
    },
    "requestId": "string"
  }
  ```
- **响应体（异步成功）**：
  ```json
  {
    "code": 200,
    "message": "工具调用已提交",
    "data": {
      "toolCallId": "string",
      "asyncTaskId": "string",
      "status": "running",
      "estimatedTime": 3000 // 预计执行时间(ms)
    },
    "requestId": "string"
  }
  ```
- **接口说明**：AI Native 核心接口，Agent 调用内置/自定义工具（数据查询、催办、报告生成、外部系统对接），支持同步/异步双模式，严格遵循函数调用规范
- **权限要求**：central/executive
- **异常场景**：
  - 400：工具名称不存在/参数格式错误
  - 403：无权限调用该工具
  - 503：工具依赖服务不可用

### 9.4 AI Agent 异步任务查询**P2**

- **接口名称**：查询Agent异步工具执行结果
- **接口路径**：`/agent/async-task/{asyncTaskId}`
- **请求方法**：GET
- **请求头**：需携带通用请求头
- **路径参数**：asyncTaskId（必填）
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "asyncTaskId": "string",
      "toolCallId": "string",
      "status": "success/running/failed",
      "progress": 100, // 执行进度(%)
      "result": {}, // 执行结果（完成时返回）
      "failedReason": null, // 失败原因
      "createdAt": "string",
      "completedAt": "string"
    },
    "requestId": "string"
  }
  ```
- **接口说明**：查询异步工具调用的执行状态与结果，适配长耗时Agent任务（报告生成、批量催办）
- **权限要求**：任务创建人/系统管理员

### 9.5 AI Agent 工作流编排（多Agent协作）**P2**

- **接口名称**：创建/执行Agent工作流
- **接口路径**：`/agent/workflow`
- **请求方法**：POST
- **请求头**：Role=central
- **请求体**：
  ```json
  {
    "workflowName": "string", // 工作流名称：自动巡检-催办-报告
    "workflowType": "auto/manual", // 自动触发/手动执行
    "triggerRule": { // 自动触发规则（可选）
      "cron": "0 0 * * *", // 定时规则
      "event": "task_dispatch" // 事件触发：任务下发
    },
    "nodes": [ // 工作流节点（多Agent串行/并行执行）
      {
        "nodeId": "node_1",
        "agentId": "scan_agent",
        "toolName": "task_scan",
        "params": {}
      },
      {
        "nodeId": "node_2",
        "agentId": "nudge_agent",
        "dependNode": "node_1", // 依赖上一节点
        "toolName": "agent_auto_nudge"
      }
    ],
    "operatorId": "string"
  }
  ```
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "工作流创建成功",
    "data": {
      "workflowId": "string",
      "status": "active/stopped",
      "triggerType": "string",
      "createdAt": "string"
    },
    "requestId": "string"
  }
  ```
- **接口说明**：企业级多Agent协作核心，支持串行/并行工作流、定时/事件触发，实现全流程自动化
- **权限要求**：仅central

### 9.6 AI Agent 状态监控与日志**P2**

- **接口名称**：查询Agent运行状态与操作日志
- **接口路径**：`/agent/monitor`
- **请求方法**：GET
- **请求头**：Role=central
- **查询参数**：
  | 参数名 | 类型 | 必选 | 说明 |
  |--------|------|------|------|
  | agentId | string | 否 | Agent ID |
  | status | string | 否 | 运行状态：running/idle/error |
  | startTime | string | 否 | 日志开始时间 |
  | endTime | string | 否 | 日志结束时间 |
  | pageNum | int | 是 | 页码 |
  | pageSize | int | 是 | 页大小 |
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "agentStatus": {
        "totalAgents": 5,
        "runningAgents": 4,
        "errorAgents": 1
      },
      "logList": [
        {
          "logId": "string",
          "agentId": "string",
          "operation": "tool_call/scan/nudge",
          "status": "success",
          "content": "执行自动催办工具，触发50条通知",
          "executedAt": "string",
          "duration": 1200 // 执行耗时(ms)
        }
      ],
      "pagination": {}
    },
    "requestId": "string"
  }
  ```
- **接口说明**：实时监控所有Agent运行状态，记录全量操作日志，用于运维排查与审计
- **权限要求**：仅central

### 9.7 AI Agent 配置管理**P2**

- **接口名称**：Agent 模型/规则/权限配置
- **接口路径**：`/agent/config/{agentId}`
- **请求方法**：GET/PUT
- **请求头**：Role=central
- **PUT请求体**：
  ```json
  {
    "modelConfig": { // 大模型配置
      "modelName": "deepseek-v3/gpt-4o",
      "temperature": 0.1, // 温度系数（企业级低随机性）
      "maxTokens": 2048
    },
    "ruleConfig": { // 业务规则配置
      "nudgeMaxCount": 3,
      "progressWarnThreshold": 60,
      "ddlWarnHours": 24
    },
    "permissionConfig": { // Agent权限范围
      "allowTools": ["query_dashboard", "trigger_nudge"],
      "denyRtm": [],
      "allowRoles": ["employee"]
    },
    "enabled": true // 启用/禁用Agent
  }
  ```
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "配置更新成功",
    "data": {
      "agentId": "string",
      "configVersion": "v1.2",
      "updatedAt": "string",
      "enabled": true
    },
    "requestId": "string"
  }
  ```
- **接口说明**：统一管理Agent的大模型参数、业务规则、权限范围，支持热更新无需重启服务
- **权限要求**：仅central

### 9.8 AI Agent 知识库检索（RAG 核心）**P2**

- **接口名称**：Agent 企业知识库查询
- **接口路径**：`/agent/knowledge/retrieve`
- **请求方法**：POST
- **请求头**：通用认证
- **请求体**：
  ```json
  {
    "query": "string", // 用户问题/检索关键词
    "knowledgeType": "training_material/company_policy/process_spec", // 知识库类型
    "topK": 5, // 返回最相关条数
    "contextId": "string" // 上下文ID
  }
  ```
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "检索成功",
    "data": {
      "retrieveId": "string",
      "query": "string",
      "knowledgeList": [
        {
          "docId": "string",
          "title": "string",
          "content": "string", // 匹配片段
          "score": 0.95, // 相似度分数
          "source": "training_material",
          "updatedAt": "string"
        }
      ],
      "hasRelevantKnowledge": true
    },
    "requestId": "string"
  }
  ```
- **接口说明**：AI Native RAG核心接口，Agent检索企业内部知识库，确保回答精准、合规、无幻觉
- **权限要求**：所有已认证用户

### 9.9 AI Agent 外部系统集成适配器**P2**

- **接口名称**：Agent 统一外部系统调用
- **接口路径**：`/agent/external/adapter`
- **请求方法**：POST
- **请求头**：Role=central
- **请求体**：
  ```json
  {
    "systemType": "mypal/smartsell/erp/wecom", // 外部系统类型
    "apiMethod": "get_user_progress/send_message", // 接口方法
    "params": {}, // 系统专属参数
    "requestId": "string"
  }
  ```
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "外部系统调用成功",
    "data": {
      "adapterId": "string",
      "systemType": "string",
      "result": {}, // 外部系统返回数据
      "latency": 800 // 调用耗时(ms)
    },
    "requestId": "string"
  }
  ```
- **接口说明**：Agent统一对接第三方系统（学习平台、ERP、企业微信），屏蔽异构系统差异
- **权限要求**：仅central角色

---

## 10. 组织与权限管理 API（Admin）**P2**

### 10.1 部门/门店管理**P2**

- **接口路径**：`/org/departments`
- **请求方法**：GET/POST/PUT/DELETE
- **核心功能**：增删改查门店、区域、部门层级结构
- **权限要求**：仅central

### 10.2 用户管理**P2**

- **接口路径**：`/org/users`
- **核心功能**：用户创建、信息修改、状态管理、批量导入
- **权限要求**：仅central

### 10.3 角色权限管理**P2**

- **接口路径**：`/org/roles`
- **核心功能**：角色定义、权限分配、RBAC权限校验
- **权限要求**：仅central

---

## 11. 文件管理 API（AI 报告/附件）

### 11.1 文件上传/下载**P2**

- **接口路径**：`/files/upload` / `/files/{fileId}/download`
- **核心功能**：知识库文档、AI报告、培训材料上传下载

### 11.2 AI 报告导出**P1**

- **接口路径**：`/files/export/report`
- **核心功能**：导出Agent生成的PDF/Excel统计报告

---

## 12. 监控与运维 API（企业级必备）

### 12.1 服务健康检查**P1**

- **接口路径**：`/monitor/health`
- **核心功能**：Agent服务、数据库、第三方依赖健康检测

### 12.2 系统指标监控**P1**

- **接口路径**：`/monitor/metrics`
- **核心功能**：QPS、响应时间、Agent调用量、错误率监控

### 12.3 系统日志查询**P1**

- **接口路径**：`/monitor/logs`
- **核心功能**：全系统操作日志、审计日志、异常日志查询

---

## 13. 事件总线 API（Agent 事件驱动）

### 13.1 事件发布**P2**

- **接口路径**：`/event/publish`
- **核心功能**：发布任务下发、催办、Agent执行等事件

### 13.2 事件订阅**P2**

- **接口路径**：`/event/subscribe`
- **核心功能**：订阅事件，触发Agent自动执行（事件驱动架构）

## 14. 记忆系统 API（Memory System）

### 14.1 获取用户短期记忆**P2**

- **接口名称**：获取用户短期记忆
- **接口路径**：`/memory/short-term`
- **请求方法**：GET
- **请求头**：需携带通用请求头
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "employee_id": "123",
      "role": "employee",
      "task_progress": {
        "task_001": {
          "mypal_completed": true,
          "smartsell_completed": false,
          "ai_demo_completed": true,
          "live_broadcast_completed": false
        }
      },
      "recent_interactions": [
        {
          "type": "nudge",
          "content": "请尽快完成SmartSell平台的学习",
          "timestamp": "2026-03-25T10:00:00Z"
        }
      ],
      "preferences": {
        "prefer_video": true
      }
    },
    "requestId": "string"
  }
  ```
- **接口说明**：获取用户短期记忆内容，包括任务进度、最近交互记录和学习偏好
- **权限要求**：所有角色（仅本人记忆）

### 14.2 更新任务进度**P2**

- **接口名称**：更新任务进度
- **接口路径**：`/memory/short-term/progress`
- **请求方法**：POST
- **请求头**：需携带通用请求头
- **请求体**：
  ```json
  {
    "task_id": "task_001",
    "progress": {
      "mypal_completed": true,
      "smartsell_completed": true,
      "ai_demo_completed": true,
      "live_broadcast_completed": false
    }
  }
  ```
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "task_id": "task_001",
      "progress": {
        "mypal_completed": true,
        "smartsell_completed": true,
        "ai_demo_completed": true,
        "live_broadcast_completed": false
      }
    },
    "requestId": "string"
  }
  ```
- **接口说明**：更新用户任务进度
- **权限要求**：所有角色（仅本人任务）

### 14.3 添加交互记录**P2**

- **接口名称**：添加交互记录
- **接口路径**：`/memory/short-term/interaction`
- **请求方法**：POST
- **请求头**：需携带通用请求头
- **请求体**：
  ```json
  {
    "interaction_type": "nudge",
    "content": "请尽快完成SmartSell平台的学习"
  }
  ```
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "interaction_type": "nudge",
      "content": "请尽快完成SmartSell平台的学习",
      "timestamp": "2026-03-25T10:00:00Z"
    },
    "requestId": "string"
  }
  ```
- **接口说明**：添加用户交互记录
- **权限要求**：所有角色（仅本人交互）

### 14.4 搜索知识库**P2**

- **接口名称**：搜索知识库
- **接口路径**：`/memory/long-term/knowledge`
- **请求方法**：GET
- **请求头**：需携带通用请求头
- **查询参数**：
  | 参数名 | 类型 | 是否必填 | 说明 |
  |--------|------|----------|------|
  | query | string | 是 | 搜索关键词 |
  | tags | list | 否 | 标签过滤 |
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "knowledge_list": [
        {
          "knowledge_id": "knowledge_001",
          "content": "SmartSell平台使用指南",
          "tags": ["SmartSell", "培训"],
          "created_at": "2026-03-20T10:00:00Z"
        }
      ]
    },
    "requestId": "string"
  }
  ```
- **接口说明**：搜索知识库内容
- **权限要求**：所有角色

### 14.5 添加知识库内容**P2**

- **接口名称**：添加知识库内容
- **接口路径**：`/memory/long-term/knowledge`
- **请求方法**：POST
- **请求头**：需携带通用请求头（Role=central）
- **请求体**：
  ```json
  {
    "knowledge_id": "knowledge_001",
    "content": "SmartSell平台使用指南",
    "tags": ["SmartSell", "培训"]
  }
  ```
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "knowledge_id": "knowledge_001",
      "content": "SmartSell平台使用指南",
      "tags": ["SmartSell", "培训"],
      "created_at": "2026-03-25T10:00:00Z"
    },
    "requestId": "string"
  }
  ```
- **接口说明**：添加知识库内容
- **权限要求**：仅总部角色

### 14.6 获取历史任务数据**P2**

- **接口名称**：获取历史任务数据
- **接口路径**：`/memory/long-term/history`
- **请求方法**：GET
- **请求头**：需携带通用请求头
- **查询参数**：
  | 参数名 | 类型 | 是否必填 | 说明 |
  |--------|------|----------|------|
  | task_id | string | 是 | 任务ID |
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "task_id": "task_001",
      "title": "Q1新品培训",
      "description": "Q1新品知识认证",
      "platforms": ["MyPAL", "SmartSell", "AI Demo", "Live Broadcast"],
      "ddl_at": "2026-04-30T23:59:59Z",
      "status": "dispatched",
      "created_at": "2026-03-20T10:00:00Z"
    },
    "requestId": "string"
  }
  ```
- **接口说明**：获取历史任务数据
- **权限要求**：所有角色（总部可看所有，店员看本人）

### 14.7 检测进度变化**P2**

- **接口名称**：检测进度变化
- **接口路径**：`/memory/progress/detect`
- **请求方法**：POST
- **请求头**：需携带通用请求头
- **请求体**：
  ```json
  {
    "original_progress": {
      "mypal_completed": true,
      "smartsell_completed": false
    },
    "new_progress": {
      "mypal_completed": true,
      "smartsell_completed": true
    }
  }
  ```
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "progress_changed": true,
      "changed_platforms": ["smartsell"]
    },
    "requestId": "string"
  }
  ```
- **接口说明**：检测任务进度变化
- **权限要求**：所有角色

### 14.8 生成个性化建议**P2**

- **接口名称**：生成个性化建议
- **接口路径**：`/memory/reasoning/suggestions`
- **请求方法**：POST
- **请求头**：需携带通用请求头
- **请求体**：
  ```json
  {
    "progress": {
      "mypal_completed": true,
      "smartsell_completed": false
    },
    "user_preferences": {
      "prefer_video": true
    }
  }
  ```
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "suggestions": [
        "请完成SmartSell平台的学习，建议参考SmartSell专项培训视频",
        "注意任务截止时间为2026-04-30"
      ]
    },
    "requestId": "string"
  }
  ```
- **接口说明**：根据用户进度和偏好生成个性化建议
- **权限要求**：所有角色（仅本人建议）

---

## 15. WebSocket 实时推送

### 连接方式

```
ws://[host]/ws?token=<JWT Bearer Token>
```

- 连接建立后，系统通过 Token 中的 `role` 自动判定并分流：
  - **店员端 (`employee`)**：放入店员连接池，支持精准的 `employeeId` 定向推送。
  - **管理端 (`central`, `executive`, `admin`)**：放入看板连接池，统一接收全局的数据刷新信号 (`dashboard_updated`)。
- 连接成功后服务端立即推送 `connected` 确认帧：
  ```json
  // 店员端
  { "event": "connected", "role": "employee", "employeeId": "E001" }
  
  // 管理端
  { "event": "connected", "role": "central" }
  ```
- Token 无效时，服务端关闭连接（code 4001），前端需重新登录后重连。

---

### 15.1 任务下发通知 `task_assigned` **P0**

**触发时机：** `POST /api/v1/tasks/{id}/dispatch` 成功后，向所有目标用户推送。

**接收方：** 所有被分配到该任务的员工。

**Payload：**
```json
{
  "event": "task_assigned",
  "data": {
    "taskId": "string",
    "taskTitle": "string",
    "ddlAt": "string"
  }
}
```

**前端建议处理：**
1. 铃铛角标 +1（或直接调 `GET /events/unread-count` 刷新）。
2. 任务列表页刷新或插入新任务卡片。

---

### 15.2 催办通知 `nudge_sent` **P0**

**触发时机：** 人工 `POST /api/v1/nudges` 在事务落库后，**异步**为每人生成文案并 `UPDATE notification_events.content` 时推送；自动预警在 `evaluateAndTriggerAutoNudges` 异步落库时同样推送。**不在** HTTP 响应返回前发送。

**接收方：** 单条推送对应的一名目标员工（每人独立 `content`）。

**Payload：**
```json
{
  "event": "nudge_sent",
  "data": {
    "nudgeRecordId": "string",
    "eventId": "string",
    "taskId": "string",
    "severity": "yellow | red",
    "eventType": "nudge_yellow | nudge_red",
    "content": "string",
    "ruleType": "string"
  }
}
```

> **`ruleType`**：自动预警时有值（如 `progressLag`、`deadlineCrisisP0`）；**人工催办**可不传或为空，客户端以 `eventId` / `GET /events` 为准。

**前端建议处理：**
1. 铃铛角标 +1（或调 `GET /events/unread-count`）。
2. 若 `severity=red`，展示高优先级弹窗提醒。

---

### 15.3 任务完成通知 `assignment_completed` **P0**

**触发时机：** `PUT /api/v1/assignments/{id}/status`（`complete_platform`）触发 auto-complete 时，向完成者推送。

**接收方：**
- 完成任务的员工（自身）
- 同门店的其他员工

**Payload：**
```json
{
  "event": "assignment_completed",
  "data": {
    "assignmentId": "string",
    "taskId": "string",
    "userId": "string",
    "storeId": "string",
    "completedAt": "string"
  }
}
```

**前端建议处理：**
- 员工端：展示完成庆祝动效（可选）。

---

### 15.4 看板数据更新通知 `dashboard_updated` **P0**

**触发时机：** 当任何影响看板统计的行为发生时（例如：新任务下发、员工点开通知/任务已读、员工更新任务进度或状态、触发新的预警时）。

**接收方：**
- 当前在线的总部 (`central`)、行政 (`executive`)、管理员 (`admin`) 角色。

**Payload：**
```json
{
  "event": "dashboard_updated",
  "data": {
    "taskId": "string",
    "assignmentId": "string | null",
    "status": "string | null",
    "progress": "number | null",
    "operationType": "task_dispatched | notification_read | start_task | complete_platform | complete_task | auto_nudge_sent"
  }
}
```

**前端建议处理：**
- 管理端：监听到该事件后，可以防抖（debounce）几秒钟后静默重新调用 `GET /api/v1/dashboard/overview` 或 `heatmap`、`trend` 等数据接口，从而实现看板数据的**自动刷新**。

---

### 15.5 看板 Agent 分析更新通知 `dashboard_agent_updated` **P0**

**触发时机：** 当定时任务或人为手动强制刷新完成后，AI 生成的最新的看版分析存入数据库时触发。

**接收方：**
- 当前在线的总部 (`central`)、行政 (`executive`)、管理员 (`admin`) 角色。

**Payload：**
```json
{
  "event": "dashboard_agent_updated",
  "data": {
    "generatedAt": "2026-04-22 12:00:00"
  }
}
```

**前端建议处理：**
- 管理端：监听到该事件后，说明看板智能 Agent 有新的诊断报告，可以直接拉取 `GET /api/v1/dashboard/agent/diagnose`（不要传 refresh）以更新顶部提示卡片。

---

### 15.4 断线重连策略

用户网络断开重连后，**不依赖 WebSocket 补发历史帧**（服务端不缓存未送达消息），前端应主动补拉：

```javascript
async function onReconnect() {
  // 补拉未读通知角标
  const { data: countData } = await GET('/api/v1/events/unread-count');
  updateBellBadge(countData.unreadCount);

  // 补拉通知列表
  const { data: eventsData } = await GET('/api/v1/events?pageNum=1&pageSize=50');
  updateNotificationList(eventsData.list);

  // 补拉 assignment 状态
  const { data: assignData } = await GET('/api/v1/assignments');
  updateTaskList(assignData);
}
```

---

## 16. MyPal 本地 Mock 数据查询（开发环境） **P1**

### 16.1 MyPal 学习进度查询（mock） `GET /api/v1/mypal/mock/learning` **P1**

**用途：** 联调阶段在无法接通真实 MyPal 时，返回与 MyPal 字段形态一致的学习进度数据。

**接入前提：** 仅当 `MYPAL_MOCK=1` 时该接口可用，否则返回 `404`。

**请求参数（Query）：**
- `queryDate`（可选）：`YYYY-MM-DD`
- `taskWeek`（可选）：`FY26Q2W1` / `FY26Q2W2`（优先于 `queryDate`）
  - **当前 mock 行为：** 如果未传 `taskWeek`，mock 接口不会根据 `queryDate` 计算 `taskWeek`，而是默认使用 `FY26Q2W1` 以保证联调可用。
- `storeId`（可选）：仅 central/admin/executive 可用
- `employeeId`（可选）：仅 central/admin/executive 可用

**权限口径：**
- `employee`：只能查询本人（由 JWT 中 `employeeId` 决定），忽略 `employeeId/storeId` 参数。
- `central/admin/executive`：可按 `employeeId` 或 `storeId` 过滤；不传则按 `taskWeek` 返回全量 mock 数据。

**返回体：** `data` 为数组，元素字段为 camelCase：`seedId`, `productName`, `firstUseTime`, `taskWeek`, `progress`, `passedWeek`, `passedTime`, `required`, `weekStartTime`。

---

## 附录：Agent 体系总览

| Agent 类型 | 核心职责 | 对应API模块 |
|----------|----------|------------|
| 巡检Agent | 自动扫描任务异常、低进度、临期 | 9.1 / 9.6 |
| 催办Agent | 自动/手动触发智能催办 | 4.5 / 9.3 |
| 对话Agent | 高管自然语言查询、数据下钻；可选 DeepSeek 上游（§6.5） | 6.x / 6.5 / 9.8 |
| 报告Agent | 自动生成统计分析报告 | 8.2 / 9.3 |
| 集成Agent | 对接外部系统、数据同步 | 9.9 |
| 编排Agent | 多Agent工作流调度、自动化 | 9.5 |

### 6.6 提交 AI 回复反馈

- **接口名称**：提交 AI 回复反馈
- **接口路径**：`/chat/executive/sessions/{sessionId}/messages/{messageId}/feedback`
- **请求方法**：POST
- **请求头**：需携带通用请求头（Role=executive）
- **路径参数**：sessionId（必选）, messageId（必选）
- **请求体**：
  ```json
  {
    "feedback": "like | dislike | none"
  }
  ```
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "sessionId": "string",
      "messageId": "string",
      "userFeedback": "like | dislike | null"
    },
    "requestId": "string"
  }
  ```
- **错误码补充**：
  - 400：`CHAT_006`，feedback 参数非法，或消息角色不是 assistant
  - 404：`CHAT_007`，消息不存在或不属于该会话

### 6.7 重新生成 AI 回复

- **接口名称**：重新生成 AI 回复
- **接口路径**：`/chat/executive/sessions/{sessionId}/messages/{messageId}/regenerate`
- **请求方法**：POST
- **请求头**：需携带通用请求头（Role=executive）
- **路径参数**：sessionId（必选）, messageId（必选，必须是该会话最后一条 assistant 消息）
- **请求体**：无
- **响应体（成功）**：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "messageId": "string",
      "replyContent": {
        "overview": "string",
        "keyNumbers": [],
        "attentionPoints": [],
        "followUpSuggestions": []
      },
      "responseTime": 1234,
      "contextId": "string",
      "timestamp": "string"
    },
    "requestId": "string"
  }
  ```
- **错误码补充**：
  - 400：`CHAT_008`，仅支持最后一条 assistant 消息重新生成

