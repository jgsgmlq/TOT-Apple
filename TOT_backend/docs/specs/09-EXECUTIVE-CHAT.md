# Executive Chat 规格

**版本:** 2.2.0 | **PRD 4.0.5**（§5.7、§5.7.1、§8.5、§14.6）| **优先级:** P1（任务管理闭环跑通后实现）

**HTTP 契约正本：**请求/响应字段级定义以 [04-API-SPEC.md](./04-API-SPEC.md) **§6 Executive Chat Agent API**（含 §6.6 / §6.7 反馈与重新生成）为准；本文描述产品行为、意图、权限口径、数据溯源与 LLM 架构，避免与 04 重复维护两套 JSON。

---

## 实现状态（与工程对齐）

与 [04-API-SPEC.md](./04-API-SPEC.md) §6 声明一致：**当前仓库已在** `server/app.js` **挂载** `app.use('/api/v1/chat', …)`，Executive Chat HTTP 路径为 **`/api/v1/chat/...`**。

- **Agent 模式（MVP）：**默认 `intent_routing`（意图路由 → 同步数据工具 → 格式化回答）；可通过环境变量 `CHAT_AGENT_MODE=function_calling` 切换至 Function Calling 模式（详见 04 §6 文首说明与实现代码）。
- **持久化：** 会话与消息见 [01-DATA-MODEL.md](./01-DATA-MODEL.md) §10（`chat_sessions` / `chat_messages`）；用户对 assistant 消息的点赞/点踩见 **`chat_message_feedback`**（与 04 §6.6、数据库文档一致）。
- **其他 AI 能力（非 Chat 路由）：** 见 04 文首（如 `POST /api/v1/tasks/ai-generate-description` 等）。

若本文某句与 **04 §6 或当前 `app.js` 挂载** 冲突，**以 04 与代码为准**，并应回头修订本节。

---

## 功能概述

Executive Chat 是面向高管（VP、区域总监）的独立 H5 Chat 页面，允许用户通过自然语言查询培训进度数据，**5 秒内**（P95）获得结构化回答，支持多轮追问下钻；并支持 PRD **§5.7.1** 定义的**高阶统计、相关性与预测类**问题（分 EC-P0 / EC-P1 子能力批次）。

---

## Agent 实现框架（当前实现）

> 本节描述 **server 真实代码结构**，用于后端研发、联调与排障；HTTP 字段正本仍以 [04-API-SPEC.md](./04-API-SPEC.md) §6 为准。

### 分层架构

| 层 | 模块（代码） | 职责 |
|----|--------------|------|
| API 路由层 | `server/routes/chat.js` | 鉴权（`authenticate + requireRole(['executive'])`）、会话归属校验、参数校验、统一响应 |
| 会话编排层 | `server/services/chatService.js` | 创建/删除会话、读取最近历史、恢复 `role_scope/regions/rtm`、落库 user/assistant 消息、反馈与 regenerate |
| Agent 运行层 | `server/services/chatAgentRunner.js` | 模式路由（`intent_routing` / `function_calling`）、意图识别与工具调度、最终结构化回答输出 |
| Agent 子能力层 | `chatIntentService` / `chatToolsService` / `chatAnswerService` | 意图分类、受权限约束的数据查询工具、回答格式化 |
| LLM 适配层 | `server/utils/ai.js` | DeepSeek 文本生成（`generateTextDeepSeek`）与工具调用（`chatWithTools`），日志落盘（`DEBUG_AI_LOG=true`） |
| 数据层 | SQLite：`chat_sessions` / `chat_messages` / `chat_message_feedback` + `tasks/assignments/stores/...` | 会话持久化、反馈记录、同源业务数据读取 |

### 端到端执行链路（MVP 默认）

1. `POST /api/v1/chat/executive/sessions/{sessionId}/messages` 进入路由层  
2. `chatService.sendMessage` 读取最近 6 条历史 + 会话权限范围（national/regional/rtm）  
3. `chatAgentRunner.run` 进入 `intent_routing` 分支：  
   - `chatIntentService.classify`：LLM 输出 `intentType + entities`  
   - `chatToolsService.executeByName`：按意图执行只读工具并应用权限裁剪  
   - `chatAnswerService.format`：将工具结果二次整理为 `overview/keyNumbers/attentionPoints/followUpSuggestions`  
4. `chatService` 持久化 user + assistant 消息，返回结构化响应

### 数据与安全边界

- **权限收敛点：**以 `chat_sessions.role_scope + regions/rtm` 为准，查询时必须经 `chatToolsService.buildRegionFilter(...)` 裁剪。
- **数据来源约束：**回答数字来自 `tasks/assignments/stores` 同源聚合；禁止在回答层虚构指标。
- **会话隔离：**路由层与服务层双重校验 session 归属（`CHAT_004`）。
- **消息反馈约束：**仅 assistant 消息允许 `like/dislike/none`；regenerate 仅允许会话最后一条 assistant 消息（`CHAT_008`）。

---

## Agent 技术路线（Roadmap）

### 路线总览

| 阶段 | 模式 | 目标 | 当前状态 |
|------|------|------|---------|
| EC-R0 | Intent Routing | 用最小闭环跑通高管问答（两次 LLM + 本地工具） | **已上线（默认）** |
| EC-R1 | Function Calling | 让模型自主多轮选工具、组合查询、减少硬编码意图映射 | **已预埋（`CHAT_AGENT_MODE=function_calling`）** |
| EC-R2 | Analytics Agent | 面向 §5.7.1 的统计/相关性/预测子能力，支持异步重计算 | 规划中（EC-P0 / EC-P1 分批） |
| EC-R3 | 可观测与评估闭环 | 基于反馈/重生成/日志形成持续优化机制 | 规划中 |

### R0（当前）设计取舍

- **优点：**链路稳定、可控性强、便于快速定位问题。
- **限制：**意图到工具是固定映射，复杂组合查询能力有限；扩展新统计子能力时需要继续加映射和规则。

### R1（Function Calling）升级要点

- **开关：**`CHAT_AGENT_MODE=function_calling`（默认仍为 `intent_routing`）。
- **核心机制：**`chatWithTools` + `TOOL_SCHEMAS` + 最多 `MAX_ITERATIONS=3` 工具循环。
- **工程要求：**
  - 工具 schema 与 `executeByName` 严格同名同参；
  - 工具失败返回可解释结果，不中断整轮对话；
  - 超过迭代上限时强制 `tool_choice='none'` 输出最终回答。

### R2（统计/预测）技术方向

- **意图层：**保持 `intentType=analytics_query`，通过 `entities.analysisType` 区分子类型，避免枚举爆炸。
- **数据层：**优先复用 `/dashboard/*` 同源口径；缺失项走服务端只读聚合。
- **结果层：**统计类回答强制携带 `statisticsProvenance`；预测类强制携带 `forecastDisclaimer`。
- **异步层：**EC-P1 重计算支持 202 + `jobId`（或 WS）模式，前端展示“计算中”状态。

### 可观测性与运维建议

- **日志：**启用 `DEBUG_AI_LOG=true` 时写 `server/logs/ai_debug.log`，记录请求体、模型输出、延迟。
- **关键指标：**P95 响应时长、工具调用成功率、`CHAT_001` 占比、regenerate 率、dislike 率。
- **故障降级：**LLM/工具失败时返回标准错误（`CHAT_001` / 503）或“部分数据回答 + 追问建议”，禁止返回伪造结论。

---

## 与 API 规格的分工

| 内容 | 文档 |
|------|------|
| 路径、请求/响应 JSON、`code` / `message` / `data` / `requestId` | [04-API-SPEC.md](./04-API-SPEC.md) §6.1–6.4、§6.6–6.7 |
| DeepSeek / 上游 LLM 代理与环境变量（§6.5） | [04-API-SPEC.md](./04-API-SPEC.md) §6.5 |
| 意图列表、权限裁剪、`stores.region`、溯源、LLM 可插拔、验收口径；反馈/重新生成的**产品语义** | **本文** |

**完整 URL 前缀：** 与全站一致，均为 **`/api/v1`**（例如 `POST /api/v1/chat/executive/sessions`）。

---

## 角色与权限

| 角色 | 数据权限 | 说明 |
|------|---------|------|
| VP（全国） | 全国维度 | 可查全公司任意区域、门店、个人（在实现允许的前提下） |
| 区域总监 | 本**大区**辖区 | 仅可查 `stores.region` 属于其授权大区列表内的门店及关联 Assignment |

**身份识别：** 通过 JWT 识别 `role === executive`；**辖区范围**由下列 MVP 策略之一绑定（见下节），服务端在所有聚合查询中 **`JOIN stores`**，并对区域型 Executive 施加 **`stores.region IN (...)`** 谓词（必要时叠加 `taskId`、时间窗等）。

**与 [01-DATA-MODEL.md](./01-DATA-MODEL.md) 的关系：** 大区名称与 **`stores.region`** 同源（如「华东」）；不在 `stores` 表外的平行维度上虚构「辖区」。

---

## MVP：Executive 辖区与 `stores.region` 的绑定策略

`users` 表当前无强制辖区字段；实现任选其一（须在工程与 seed 中一致）：

| 策略 | 做法 | 说明 |
|------|------|------|
| **A** | `users.executive_regions`（JSON 数组，元素为 `stores.region`） | 推荐长期方案；可与 DATA-MODEL 变更记录同步 |
| **B** | `POST /api/v1/chat/executive/sessions` 请求体携带 `regions[]`，服务端与会话绑定 | 仅本会话有效；见 04 §6.1 |
| **C** | Seed 约定（如 `executive_huadong` → `['华东']`） | 演示/MVP 临时 |

**全国型 Executive：** `roleScope: national`（04 §6.1），不加 `region` 过滤。

**大区型 Executive：** `roleScope: regional` 且 **`regions` 非空**；若为空则 **400**（见 04 §6.1）。

**按 RTM 分管：** 保留 `roleScope: rtm` + `rtm` 字段，与 PRD「大区」并存时，以产品一句说明为准：**PRD 默认「区域总监 = 大区」优先使用 `regional` + `regions[]`**；`rtm` 用于「按渠道分管」的补充场景。

---

## 入口

- **当前工程：** 独立 Executive 端页面在 **`TOT_frontend`**（如 `src/views/executive/`），与总部/店员端路由分离；具体路由与构建方式以根目录 README 与前端代码为准。
- **产品形态：** 仍为独立 H5/Web 端体验；历史文档中的 `executive.html` 指「独立 Executive 页」而非与 central/employee 混用同一套页面路由。
- 扫码或点击链接打开，Token 鉴权后创建/恢复会话并加载权限内数据。

---

## 支持的查询意图

### 基础四类（PRD §5.7）

| 意图类型 | `intentType`（见 04 §6.4） | 示例问题 | 说明 |
|---------|---------------------------|---------|------|
| 培训进度查询 | `progress_query` | 「Q1 新品培训完成率？」 | 全局或指定任务的完成率、人数 |
| 项目状态查询 | `project_status` | 「Trade-in 准备到哪一步了？」 | 特定培训项目当前阶段 |
| 预警查询 | `warning_query` | 「现在有什么问题需要关注？」 | 需关注门店/区域、P1/P2 口径（数据见溯源表） |
| 区域/门店下钻 | `drill_down` | 「华东区怎么样？」「最差的 5 家门店是哪些？」 | 按区域或门店细化 |

### 高阶统计与分析（PRD §5.7.1）

> **子能力优先级：** **EC-P0** = Chat 分析能力首发批次必含；**EC-P1** = 后续批次。Executive Chat **整体仍为产品 P1**。

| 场景 | `intentType`（建议） | `analysisType`（建议，见 04 §6.4 `entities`） | 示例问题 | EC |
|------|---------------------|-----------------------------------------------|---------|-----|
| 分位数 / 极值 | `analytics_query` | `quantile_duration` | 「华东区员工完成任务时间的 P90 是多少？」 | EC-P0 |
| 分布曲线 | `analytics_query` | `completion_time_distribution` | 「大家一般是任务下发后第几小时完成的？」 | EC-P0 |
| 相关性 | `analytics_query` | `metric_correlation` | 「起步异常率高的门店和完成率负相关吗？」 | EC-P0 |
| 渠道离散度 | `analytics_query` | `progress_variance_by_channel` | 「各渠道培训进度哪个方差最大？」 | EC-P1 |
| 趋势预测 | `analytics_query` | `completion_rate_forecast` | 「按现在速度，今晚 12 点整体达成率大概多少？」 | EC-P1 |
| 截尾均值 | `analytics_query` | `trimmed_mean_duration` | 「去掉最快最慢各 5%，平均耗时多少？」 | EC-P1 |

实现上可将 `intentType` 统一为 `analytics_query`，必须用 **`entities.analysisType`** 区分子类型，避免 04 §6.4 单一枚举爆炸。

---

## 统一回答格式

每次回答必须包含以下四段语义（与04 §6.2 `replyContent` 对齐：`overview` / `keyNumbers` / `attentionPoints` / `followUpSuggestions`）：

1. **状态概览** — `overview`：一句话概括  
2. **关键数字** — `keyNumbers[]`：完成率、人数、统计量等  
3. **需关注事项** — `attentionPoints[]`：预警与风险（无则空数组）  
4. **追问引导** — `followUpSuggestions[]`

### PRD §5.7.1 扩展字段（建议在 `replyContent` 内可选扩展）

与04 §6.2 兼容：在 **`data.replyContent`** 上增加可选键（04 已预留结构化对象，实现时向后兼容）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `statisticsProvenance` | object | 统计/推断类 **必填** | `timeWindow`、`taskFilter`、`sampleSize`、`includesIncomplete`、`regionFilter`、`rtmFilter` 等 |
| `visualizations` | array | 否 | 如 `{ "type": "histogram", "title": "...", "data": { ... } }` 或图表 URL |
| `forecastDisclaimer` | string | 预测类 **必填** | 模型假设、不确定性、非承诺口径 |
| `correlationNote` | string | 相关类 **推荐** | 「相关非因果」、Pearson 方向与强度 |
| `ecCapabilityTier` | string | 否 | `EC-P0` / `EC-P1`，与 PRD 子能力对齐 |

**示例（节选）：** 分位数回答须在 `keyNumbers` 或 `overview` 中给出 **P90 数值**，并在 `statisticsProvenance` 中写明样本范围。

---

## 多轮追问规则

- 支持**至少 3 轮**连续追问；上下文由 **`contextId`**（04 §6.1）与可选服务端会话存储承载  
- 下钻路径：全国 → 区域 → 门店 → 个人  
- 刷新页面或新会话：`contextId` / `sessionId` 策略由实现决定；产品要求**同一会话内**连贯

---

## 性能与异步

| 指标 | 目标 |
|------|------|
| 回答响应时间 | ≤ 5 秒（P95），常规进度/下钻类 |
| 数字一致性 | 与同源 Dashboard / 落库聚合一致 |
| 追问轮次 | ≥ 3 轮 |

**PRD §14.6：** **EC-P1** 重计算（如大规模方差、长序列外推、高清绘图）允许 **异步**：可返回 **202** + `jobId` + 轮询接口，或 WebSocket 推送结果（具体路径由实现 spec 补充）；**同步路径**仍须在 UI 标明「计算中」与口径。 **EC-P0** 默认应在5s 内完成或明确降级为简化回答。

---

## 首屏引导设计

创建会话成功后，04 §6.1 返回 `exampleQuestions`；首屏亦可固定展示：

```
你好，请问有什么可以帮你？

示例问题：
① Q1 新品培训现在什么情况？
② 哪个区域完成率最低？
③ 现在有什么预警需要关注？
```

---

## HTTP API（摘要）

**正本：** [04-API-SPEC.md](./04-API-SPEC.md) §6.1–6.4、§6.2.1、§6.6–6.7。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/chat/executive/sessions` | 创建会话，返回 `sessionId`、`contextId`、`exampleQuestions` |
| POST | `/api/v1/chat/executive/sessions/{sessionId}/messages` | 发送消息，返回结构化 `replyContent` |
| DELETE | `/api/v1/chat/executive/sessions/{sessionId}` | 删除会话及其全部消息（仅所属 executive） |
| GET | `/api/v1/chat/executive/sessions/{sessionId}/history` | 分页历史 |
| POST | `/api/v1/chat/executive/sessions/{sessionId}/messages/{messageId}/feedback` | 点赞 / 点踩 / 取消（`like` / `dislike` / `none`），见 §6.6 |
| POST | `/api/v1/chat/executive/sessions/{sessionId}/messages/{messageId}/regenerate` | 基于上下文重新生成 assistant 回复，见 §6.7 |

**已废弃（非正本）：** ~~`POST /api/executive/chat`~~ — 不得作为新实现依据。

---

## 用户对 AI 回复的反馈与重新生成（产品口径）

**HTTP 字段与错误码**以 [04-API-SPEC.md](./04-API-SPEC.md) §6.6、§6.7 为准。以下为**行为约定**（便于产品、前端与数据同学对齐）：

| 能力 | 产品规则 |
|------|----------|
| **喜欢 / 不喜欢** | 仅针对 **`role === assistant`** 的消息；同一用户同一消息**仅保留一个**最终态（`like` / `dislike`）；可在二者间切换；再次点击同一态度可视为 **取消**（`none`，服务端可落库为删除该条反馈）。 |
| **重新生成** | **仅允许**针对当前会话中 **最后一条 assistant 消息**；生成**新的** assistant 消息落库，**保留**原回复（多版本并存），便于审计与对比。 |
| **权限** | 仅会话所属 `executive` 可操作；越权与资源不存在见 04 中 `CHAT_*` / `AUTH_*` 约定。 |

反馈数据用于质量评估与后续优化时，应遵守 PRD / 公司隐私与留存策略（不在本文展开字段级埋点）。

---

## 数据溯源（意图 → 现有 REST）

Agent 或后端工具层应优先调用已存在接口，保证与看板数字一致；路径均为 **`/api/v1`** 前缀。

| 意图 / 场景 | 主要数据源（04 文档节） | 备注 |
|-------------|----------------------|------|
| 进度/北极星/链路/预警计数 | `GET /dashboard/overview`（§5.1） | `warningCount` 等；executive 按权限裁剪 |
| RTM/渠道差异 | `GET /dashboard/heatmap`（§5.2） | `taskId` 必填等以 04 为准 |
| Top/Bottom 门店 | `GET /dashboard/store-rank`（§5.3） | |
| 按天/按小时完成趋势、外推输入 | `GET /dashboard/trend`（§5.4.5） | `type=hourly` 服务 PRD 预测类 |
| 预警列表明细 | `GET /dashboard/warnings`（§5.5） | **当前 04 写仅 `central`**；Executive 的「预警查询」在实现上应对齐 PRD：或扩展 executive 只读权限，或用 `overview` + `store-rank` 聚合等效信息（**产品缺口在04 与实现对齐时收口**） |
| 门店下钻、员工明细 | `GET /dashboard/store-detail`（§5.6） | **当前 04 写 `central` / `admin`**；若 PRD 要求 Executive 下钻到员工，需 **扩展权限或提供 Executive 只读同源聚合** |
| 任务列表 / Assignment 列表 | `GET /tasks`、`GET /assignments`（§3、§4） | `executive` 行为以 04 为准（部分列表可能为空，依赖聚合 API） |

**§5.7.1 专项：** 分位数、方差、Pearson、截尾均值、分布直方图等，若现有 REST 不直接暴露，允许 **服务端只读聚合**（与 Dashboard SQL 口径一致）或独立 **分析服务**；不得在 Chat 层捏造与 DB 不一致的数字。

---

## 数据权限裁剪（服务端）

所有涉及 Assignment/门店的查询必须能关联到 **`stores`**，并应用：

- **全国：**无 `region` 谓词（仍可按 `taskId`、时间窗过滤）  
- **大区：** `stores.region IN (:authorized_regions)`  
- **RTM（若使用 roleScope=rtm）：** `stores.rtm = :rtm`（与 DATA-MODEL 一致）

伪代码：

```javascript
function buildExecutiveDataScope(session) {
  if (session.roleScope === 'national') {
    return { regionFilter: null, rtmFilter: null };
  }
  if (session.roleScope === 'regional') {
    return { regionFilter: session.regions /* 非空 */ };
  }
  if (session.roleScope === 'rtm') {
    return { rtmFilter: session.rtm };
  }
  throw new Error('AUTH_003');
}
```

跨权访问返回 **`AUTH_003`**（与全站错误码风格一致，见 04）。

---

## LLM 与推理架构（厂商无关）

1. **意图识别 / 实体抽取：** 将自然语言转为 `intentType`、`entities`（任务名、区域、`taskId`、`topN`、`analysisType` 等）。  
2. **工具调用 / 数据拉取：** 调用上节 REST 或内部只读查询，填充事实表。  
3. **回答生成：** 将事实压缩为 PRD 四段结构 + 可选 `statisticsProvenance` / `visualizations`。

**适配层：** 通过环境变量配置 **`LLM_BASE_URL`**、**`LLM_API_KEY`**、**`LLM_MODEL`**（或等价命名）；协议可为 **OpenAI Chat Completions 兼容**或其他团队选型的 HTTP API。**规格不绑定**单一云厂商；DeepSeek、Claude、Azure OpenAI 等仅作部署选项。

**上下文：** 最近若干轮对话与 `contextId` 一并传入适配层；条数上限由实现定义（如 ≤6 轮）。

**降级：** 推理超时或上游故障时返回 **`CHAT_001`** 或04 约定的 **503**，前端提示重试；不得返回伪造指标。

---

## 验收标准

| 标准 | 口径 |
|------|------|
| 响应时间 | 常规提问 ≤ 5 秒（P95）；EC-P1 异步场景除外但需有明确 UX |
| 数字一致性 | 与 `GET /dashboard/*` 等同源数据一致 |
| 多轮追问 | ≥ 3 轮，上下文连贯 |
| 权限隔离 | 全国 vs 大区 vs RTM 裁剪正确；越权 **AUTH_003** |
| 首屏引导 | 示例问题可用（04 §6.1 或首屏固定文案） |
| 反馈与重新生成 | 符合 §6.6 / §6.7 与上节产品口径；仅末条 assistant 可 regenerate；反馈仅 assistant 消息 |
| EC-P0（PRD §10.2） | 分位数、分布、相关性能力可测、口径可追溯 |
| EC-P1 | 渠道方差、外推预测、截尾均值按批次交付 |

---

## 文档修订记录

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.1 | — | 初版单接口草案 |
| 2.0.0 | 2026-04-10 | 对齐 PRD 4.0.5 §5.7/§5.7.1；HTTP 以 04 §6 为正本；`stores.region` 权限；溯源表；LLM 可插拔；废弃 `/api/executive/chat` 正本地位 |
| 2.1.0 | 2026-04-13 | 实现状态与工程对齐：`/api/v1/chat` 已挂载；补充 Agent 模式与 `CHAT_AGENT_MODE`；入口对齐 Vue 前端路径；HTTP摘要增加 §6.6 / §6.7；新增「反馈与重新生成」产品口径与验收行 |
| 2.2.0 | 2026-04-14 | 新增「Agent 实现框架」与「技术路线」：分层架构、端到端执行链路、模式演进（Intent Routing → Function Calling → Analytics）、可观测与降级策略 |
