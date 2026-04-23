# Executive Chat (高管 AI 助手) 架构与规格

**版本:** 4.0.0 | **更新日期:** 2026-04-22 | **状态:** Current

**HTTP 契约正本：** 请求/响应字段级定义以 [04-API-SPEC.md](./04-API-SPEC.md) **§6 Executive Chat Agent API** 为准。  
**意图与工具实现正本：** 以 [10-EXECUTIVE-CHAT-INTENTS-TOOLS.md](./10-EXECUTIVE-CHAT-INTENTS-TOOLS.md) 为准。  
**请求处理与代码路径正本：** 以 [11-EXECUTIVE-CHAT-REQUEST-FLOW.md](./11-EXECUTIVE-CHAT-REQUEST-FLOW.md) 为准（用户消息 → Agent → 工具 → 落库的逐步说明）。  
**演进提案参阅：** v4.0 核心设计思想详见 [2026-04-22-executive-chat-evolution-proposal.md](../plans/2026-04-22-executive-chat-evolution-proposal.md)。  
**本文定位：** 说明 Executive Chat 的产品能力边界、技术路线、分层架构和扩展框架。

---

## 1. 定位与能力边界

Executive Chat (E-Chat) 面向 VP、区域总监和总部看板运营角色，目标是把培训治理从“手工看报表”升级为“自然语言驱动的数据分析”。

### 1.1 核心能力 (v4.0)

1. **多维培训数据查询 (SQL Tools)**
   - `matrix_query`: 高阶矩阵式查询，支持大区/业态维度对比、多度量复合与排行。
   - `progress_query`: 完成率、进度、按任务或区域汇总。
   - `project_status`: 任务状态扫描、任务清单与完成情况。
   - `warning_query`: 风险门店识别、预警与关注清单。
   - `drill_down`: 支持“全国 -> 区域 -> 门店”层层下钻。

2. **深度推理与动态算力沙盒 (Advanced Data Analysis)**
   - 基于云端 MicroVM 沙盒环境 (`@e2b/code-interpreter`)，允许 AI 现场编写 Python/Pandas 代码。
   - 支持高阶长尾分析（方差、正态分布、回归拟合、复杂相关性等）。
   - 后端通过 `fetchRawDataset` 单向推送脱敏 CSV 保证数据安全。

3. **Agentic UX 交互层**
   - **透明思维链 (CoT)**：在流式输出期间通过 `phase: 'reasoning'` 下发安全脱敏后的内部思考摘要，缓解等待焦虑。
   - **行内挂起与恢复 (Stateful Resume)**：遇到歧义（如命中多门店）时，无需打断会话，在同一次大循环内通过持久化状态机优雅恢复。

4. **多轮对话与全局记忆 (Core Memory)**
   - **短期上下文**：自动继承单次 Session 内提及的区域、门店、任务、指标。
   - **长期全局记忆**：后台自动提取用户的业务定义（如“我不看安徽数据”）和展示偏好（如“喜欢柱状图”），跨会话持久化并动态注入 System Prompt。

5. **AI 原生输出与生成式 UI (Generative UI)**
   - 流式 Markdown 回答（表格、列表、结论）。
   - （规划中）抛弃脆弱的 Markdown 图表，转向下发结构化组件指令，由前端注册的组件（如 `<StoreRiskRadar />`）渲染。

### 1.2 明确不支持（Out of Scope）

- 不执行“发邮件、代催办、修改业务数据”等直接写操作（由语义监工 Supervisor 硬拦截）。
- 超范围请求直接拒绝并给可执行替代建议（查询、分析、定位）。

---

## 2. 总体技术路线

Executive Chat 的技术路线分为两层：**运行模式路线** 与 **产品体验路线**。

### 2.1 运行模式路线

- **主路径：`function_calling`（默认）**
  - 模型自主选择工具并拼装最终 Markdown 回答。
  - 支持 `tool_start/tool_end` 状态可视化。
- **降级路径：`intent_routing`（兜底）**
  - 通过意图分类 + 工具映射 + 结构化回答保底可用性。
  - 作为故障回退开关，避免 FC 不稳定时服务不可用。

### 2.2 体验演进路线

- **V1**：结构化卡片回答（可用，但自然度不足）。
- **V2**：FC + Markdown 流式回答（当前基线）。
- **V2.5**：工具执行状态透明化、`echarts/suggestions` 特殊块、停止生成、历史兼容。
- **V3（规划）**：更强对话状态机、图表交互深化、命令化快捷输入。

---

## 3. 分层架构框架

E-Chat 采用统一链路：**路由入口 -> 会话层 -> Agent 编排层 -> Tool 执行层 -> 流式协议层 -> 前端渲染层**。

### 3.1 组件分层（Component View）

```
Client (Executive / Dashboard)
  -> routes/chat.js
    -> chatService.js
      -> chatAgentRunner.js
        -> chatToolsService.js
          -> server/chat_tools/*.js
            -> SQLite (with regionScope filter)
      -> chatSessionStateService.js (tool result cache)
  -> SSE (delta/tool_start/tool_end/done)
  -> WS /ws/tts (optional)
```

### 3.2 请求入口层（Route Layer）

- Executive 入口：`/chat/executive/sessions/*`
- Dashboard 入口：`/chat/dashboard/sessions/*`
- 两端复用同一聊天内核，按登录用户与角色做会话隔离。

### 3.3 会话与权限层（Session + Scope Layer）

- `chatService.js` 负责会话生命周期与消息持久化。
- 从 JWT 派生用户身份，并构造 `regionScope`（区域/RTM/全国）。
- 后续所有工具查询必须携带并应用该 scope，阻断越权数据访问。

### 3.4 Agent 编排层（Agent Runner Layer）

- `chatAgentRunner.js` 是核心调度器。
- 承担四类职责：
  1. 执行模式选择（FC 或 routing）。
  2. 安全短路（越界语义提前拦截）。
  3. 工具调用循环（含状态推送）。
  4. 最终回答生成与流式输出。

### 3.5 Tool 层（Data Tooling Layer）

- **统一矩阵查询工具 (`queryExecutiveMetrics`)**：**[V3.0 核心路径]** 整合了维度对比、排行与多指标查询，确保与看板口径高度一致。
- **原子数据工具集**：位于 `server/chat_tools/*.js`。包括 `getTaskListData`、`runAnalytics` 等单一职责工具。
- 每个工具具备参数 schema、权限约束、错误可解释性。
- 意图与工具映射、`analysisType` 子能力、新增流程由 `10-EXECUTIVE-CHAT-INTENTS-TOOLS.md` 维护。

### 3.6 状态缓存层（Session State Cache）

- `chatSessionStateService.js` 缓存会话级工具结果。
- 用于“分析后立刻画图/追问”场景，减少重复聚合查询与响应抖动。

---

## 4. 关键时序（Runtime Sequence）

### 4.1 标准查询链路

```
User question
 -> runFunctionCalling()
   -> model decides tool call
   -> SSE tool_start
   -> execute tool
   -> SSE tool_end
   -> model consumes tool result
   -> stream markdown delta
 -> SSE done
 -> persist assistant message
```

### 4.2 追问与绘图链路

```
User clicks [绘图] suggestion
 -> backend restore last toolResult from session cache
 -> model directly generates echarts block
 -> frontend renders chart after done
```

### 4.3 中断链路

```
User clicks stop
 -> frontend abort signal
 -> backend stops model stream/tool loop ASAP
 -> keep partial content, stop further token consumption
```

---

## 5. 协议与渲染框架

### 5.1 SSE 事件框架

- `delta`: 增量正文（或状态增量）。
- `tool_start`: 工具开始，`text` 为工具名。
- `tool_end`: 工具结束，`text` 为工具名。
- `done`: 成功结束（最终消息元信息）。
- `error`: 失败结束（标准错误体）。

> 字段级契约以 `04-API-SPEC.md` 为准，本文只描述交互框架与语义。

### 5.2 Markdown 特殊块约定

- `echarts`：承载图表 JSON。
- `suggestions`：承载推荐追问列表（解析为可点击项）。
- 围栏外正文应保持自然语言可读，不输出裸结构化对象。

---

## 6. 安全与治理框架

### 6.1 权限边界

- 区域/RTM/全国视角必须在 Tool 查询层强制生效。
- 越权请求统一错误语义，禁止“空结果伪装成功”。

### 6.2 输出契约边界

- 对外保持 `markdownContent` 主体与 legacy 兼容字段并存的迁移策略。
- 历史消息读取需兼容旧结构，避免旧会话渲染回归。

### 6.3 可观测性与故障降级

- 通过 `tool_start/tool_end` 观察慢查询节点。
- FC 异常时可切 `intent_routing` 保持业务连续性。

---

## 7. 扩展框架（新增能力标准流程）

当新增一个 Executive Chat 能力（例如“门店健康评分”）时，按以下最小闭环执行：

1. 在 `10-EXECUTIVE-CHAT-INTENTS-TOOLS.md` 明确意图边界与工具职责。
2. 新增或扩展 `chat_tools` 工具，补齐 schema、scope 过滤、异常语义。
3. 在 `chatAgentRunner` 接入映射/反推（若涉及 routing）。
4. 补齐关键链路验证（分类、工具调用、SSE 事件、历史兼容）。
5. 同步文档：本文（能力边界）+ `10`（实现映射）+ `04`（若外部契约变更）。

---

## 8. 文档职责边界（避免漂移）

- **`04-API-SPEC.md`**：字段级 API 契约（请求/响应/错误码）正本。
- **`09-EXECUTIVE-CHAT.md`（本文）**：产品能力边界 + 架构与技术路线正本。
- **`10-EXECUTIVE-CHAT-INTENTS-TOOLS.md`**：意图、工具、映射与扩展流程正本。
- **`11-EXECUTIVE-CHAT-REQUEST-FLOW.md`**：单条请求在服务端的分支、循环与数据流（与实现对照）正本。

当文档出现冲突时，优先按 `04` 的契约与当前代码行为对齐，再修订 `09/10/11` 的叙述。

