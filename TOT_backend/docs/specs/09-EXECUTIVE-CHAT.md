# Executive Chat 规格

**版本:** 2.3.0 | **重构日期:** 2026-04-18 | **状态:** Agent UX Redesign Implemented

**HTTP 契约正本：** 请求/响应字段级定义以 [04-API-SPEC.md](./04-API-SPEC.md) **§6 Executive Chat Agent API** 为准。

---

## 统一回答格式 (2026-04-18 重构)

自 V2.3.0 起，Executive Chat 从“固定卡片式”全面转向 **“Markdown 原生 Agent”** 交互模型。

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
