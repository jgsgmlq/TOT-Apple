# Executive Chat 规格

**版本:** 2.3.0 | **重构日期:** 2026-04-18 | **状态:** Agent UX Redesign Implemented

**HTTP 契约正本：** 请求/响应字段级定义以 [04-API-SPEC.md](./04-API-SPEC.md) **§6 Executive Chat Agent API** 为准。

---

## 统一回答格式 (2026-04-18 重构)

自 V2.3.0 起，Executive Chat 从“固定卡片式”全面转向 **“Markdown 原生 Agent”** 交互模型。

- **Agent 模式（MVP）：**默认 `intent_routing`（意图路由 → 同步数据工具 → 格式化回答）；可通过环境变量 `CHAT_AGENT_MODE=function_calling` 切换至 Function Calling 模式（详见 04 §6 文首说明与实现代码）。
- **持久化：** 会话与消息见 [01-DATA-MODEL.md](./01-DATA-MODEL.md) §10（`chat_sessions` / `chat_messages`）；用户对 assistant 消息的点赞/点踩见 **`chat_message_feedback`**（与 04 §6.6、数据库文档一致）。
- **下钻能力：** `drill_down` 已支持“区域级 + 门店级”双路径；区域查询走 `getRegionDetailData`（区域汇总 + 门店排行），门店查询走 `getStoreDetailData`。
- **下钻缺参：**`intent_routing` 下若分类为 `drill_down` 但 `region` / `storeId` / `storeName` 均为空，直接返回结构化追问（不调用门店下钻工具），避免无效参数错误。
- **下钻歧义处理：** 门店名称查询支持「唯一命中直查 / 多命中回传候选门店 / 0 命中明确提示」，并以结构化 `replyContent` 返回追问建议（例如指定 `storeId`）。
- **其他 AI 能力（非 Chat 路由）：** 见 04 文首（如 `POST /api/v1/tasks/ai-generate-description` 等）。
- **可选语音朗读（TTS）：** 前端 `Executive Chat` 页眉「语音」开关（`localStorage`）开启时，在 **`POST .../messages` 且 `stream: true`（SSE）** 的同时，另建 **`WebSocket /ws/tts?token=<JWT>`** 连接至后端代理，由服务端用 **`ASR_API_KEY` / `DASHSCOPE_API_KEY`** 转发百炼 **Qwen-TTS Realtime**；朗读文本与气泡内 **`formatReplyContentText(replyContent)`** 对齐（随流式 `partialReply` 增量追加，结束后再用终稿补全）。关闭开关时行为与原先仅 SSE 一致。

### 1. 结构化 Markdown 规范
*   **主体内容**: 模型直接流式输出 Markdown 文本，支持粗体、列表及表格。
*   **数据展示**: 详细数据优先使用 **Markdown 表格** 展示。若列数 > 3，建议转为 Markdown 列表。
*   **特殊区块** (使用围栏代码块包裹，前端特殊解析):
    *   **` ```echarts `**: 包含一个 ECharts 配置 JSON，前端渲染为图表。
    *   **` ```suggestions `**: 包含一个 JSON 字符串数组，用于展示底部建议追问气泡。

### 2. 多轮对话与实体继承
*   **Context 持有**: 基于 Session 状态管理，模型自动继承上一轮提到的任务、区域或门店信息。
*   **主动澄清**: 面对模糊指令（如“那上海呢？”），模型会先询问具体意图，而非盲目猜测。

### 3. 实时交互体验
*   **状态透明**: 后端在调用工具期间推送 `tool_start/end` SSE 事件。前端实时显示“正在查询...”指示器。
*   **思考过程气泡（SSE）：** FC 下流式拆分在 **`server/utils/fcStreamDeltaSplit.js`**（`createFcStreamDeltaSplitter`）。拆分优先级：① `` ```json `` 围栏 → ② 裸 `replyContent` JSON → ③ 正文直接以 Markdown 标记（`#`/`|`/非 json 围栏/`- *`/有序列表）起始 → ④ 首个空行（段落分隔）。分界前为 **`phase: reasoning`**（进前端「思考过程」折叠气泡），分界及之后为 **`phase: content`**（进主气泡 `MarkdownRenderer`）。前端 **`execStreamStateToPayload`** 仅取 `reasoningBuf` 作 `thinking`、`contentBuf` 作 `content`（解析后卡片用 `formatReplyContentText`）。冒烟：`npm --prefix TOT_backend/server run test:fc-stream-splitter` 覆盖 A–E 五个场景。
*   **停止生成**: 用户可在生成过程中点击“停止”，前端通过 `AbortSignal` 联动后端立即中止 LLM 响应。
*   **历史兼容**: 采用双轨渲染。若历史消息 content 能解析为旧版 JSON，则展示卡片；否则展示 Markdown。

---

## 意图与工具映射

详见 [10-EXECUTIVE-CHAT-INTENTS-TOOLS.md](./10-EXECUTIVE-CHAT-INTENTS-TOOLS.md)。

### 核心意图清单：
1.  **progress_query**: 完成率/进度统计。
2.  **project_status**: 任务列表与状态。
3.  **warning_query**: 风险/预警门店扫描。
4.  **drill_down**: 区域/门店细颗粒度下钻。
5.  **analytics_query**: 高阶分析（分布、趋势、相关性）。

---

## 权限与数据安全

*   **Region Scope**: 根据 `users` 表的 `executive_regions` 自动限权。
*   **数据隔离**: 所有的工具调用强制通过 `buildRegionFilter` 注入 SQL 过滤条件，严防跨区越权。
