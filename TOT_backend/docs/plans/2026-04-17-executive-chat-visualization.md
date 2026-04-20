# Executive Chat 数据可视化前端落地计划

**最后更新：** 2026-04-17（**§6.1** 计划自检；按阶段表 **任务执行状态**；**V2.1** + **`visualizationSummary`**；[§4](#4-数据契约草案需写入-04--09-后定稿)、[§1.3](#13-v21-补丁上下文流式高亮多图全屏)）  
**状态：** Draft（待评审 / 分阶段执行）  
**关联规格：** [09-EXECUTIVE-CHAT.md](../specs/09-EXECUTIVE-CHAT.md)（`replyContent` 扩展字段）、[04-API-SPEC.md](../specs/04-API-SPEC.md) §6（`replyContent` 示例与可选键说明）、[10-EXECUTIVE-CHAT-INTENTS-TOOLS.md](../specs/10-EXECUTIVE-CHAT-INTENTS-TOOLS.md)（意图 / 工具 / `analysisType`）

**文档范围：** 数据可视化（`visualizations`）与 **追问气泡（§3.4）**。**推荐排期**见文首 **[按阶段执行计划（推荐顺序）](#按阶段执行计划推荐顺序)**；分阶段任务明细见 [§5](#5-实施阶段与受影响文件)。

**执行约束：** 实施本计划时须 **及时更新关联规格**（AI 辅助编码亦然），详见 [§1.1](#11-关联文档同步执行约束)。

---

## 按阶段执行计划（推荐顺序）

默认 **按下列序号依次交付**（与 [§5](#5-实施阶段与受影响文件) 阶段表、[§8](#8-执行清单跟踪) 勾选清单一致）。**阶段 3a** 可与 **阶段 1** 并行，不阻塞单独发版；**阶段 3b** 须待 **阶段 1、2** 完成后进行。

| 序号 | 阶段 | 目标（摘要） | 主要产出 / 验收 | 任务执行状态 |
|:----:|------|--------------|------------------|--------------|
| **①** | **阶段 3a** | 追问气泡交互 | `followUpSuggestions` 逐条可点 → 填入输入框 → 可编辑 → 原「发送」链路；流式 **`done`** 后再展示可点气泡（§3.4） | 已完成 |
| **②** | **阶段 1** | 协议与后端 | `parseReplyFromRaw` allowlist（`visualizationSummary`、`visualizations`、`highlights`、`customOptions` 等）；工具侧可选 **图 + 摘要**；**历史拼装** 剥 `visualizations`、留 `visualizationSummary`；FC / 提示词与 §3.4.2 对齐；**04 / 09 / 10** 同步（§1.1） | 已完成 |
| **③** | **阶段 2** | 前端类型与流式 | `ReplyContent` 扩展；`execChatStreamParts` / `tryParseReplyContent`；**流式闸门**（未 `done` / 未闭合不 `setOption`）；`normalizeChartPayload`（§3.2） | 已完成 |
| **④** | **阶段 3b** | 图表组件与集成 | `ExecChatChart` + `executive/index.vue` 挂载；`reportChartError`、重试；**`done` + 完整解析** 后再渲染；多图 **Swiper/Tab**；**大图/全屏**；**`highlights`** 映射（§1.3、§3.2） | 已完成 |
| **⑤** | **阶段 4.1**（建议） | Mock Gallery | 受控路由 + 极限样例，**复用正式图表组件**（§5） | 已完成 |
| **⑥** | **阶段 4** | 联调与验收 | 按 §5 阶段 4 场景表（分布/预测/相关/流式/摘要追问/多图/高亮/大图/失败/追问×图表）逐项通过 | 进行中 |

**任务执行状态（本列）：** 随迭代更新；建议取值 **`未开始` / `进行中` / `已完成` / `阻塞`**；阶段 4.1 可选用 **`已跳过`**。与 [§8](#8-执行清单跟踪) 勾选保持一致（阶段完成时本列改为 **`已完成`** 并勾选对应项）。

**每阶段 DoD：** 行为或对外契约有变 → 执行 [§1.1](#11-关联文档同步执行约束)；里程碑变化 → [§9](#9-修订记录) 追加一行。

---

## 1. 目标与背景

在 **Executive Chat（P1）** 中，将后端返回的 **`replyContent` 可选扩展**（如 `visualizations`）解析并在 **H5 / 桌面端** 渲染为图表，使分位数、分布、相关性、预测等高阶分析可一眼读懂。

**追问交互（与 09 规格一致）：** AI 仍可在回答中给出追问；本次落地将追问从纯文案改为 **可选中的气泡**。用户点击气泡后，**追问全文进入输入框**，可修改后再发送，与手动输入同一发送链路。AI 根据用户意图与本轮结果，**自行判断**是否在追问列表中加入「是否生成本轮图表」类邀请（见 [§3.4](#34-追问气泡可编辑发送与是否生成图表类追问)）。

**本计划与仓库现状对齐：** 前端已集成 **ECharts 5** 与通用封装；Executive 页已结构化展示 `overview` / `keyNumbers` / `attentionPoints` / `followUpSuggestions`，并支持 **SSE 流式**；后端 **当前格式化层仅保留四段式字段**，若要让模型输出 `visualizations`，需扩展解析与白名单透传。追问气泡仅依赖现有 `followUpSuggestions: string[]`，**可与图表协议解耦先发版**。

### 1.1 关联文档同步（执行约束）

使用 **AI 或人工** 按本计划修改代码、**对外契约**、字段形状、意图/工具行为、提示词或 **用户可见交互** 时，须在 **同一交付单元内**（例如同一 PR 或同一迭代收尾前）**及时更新下列关联文档**，避免「代码已合、文档仍旧」。

| 文档 | 何时必须修订 |
|------|----------------|
| [04-API-SPEC.md](../specs/04-API-SPEC.md) | `replyContent` 形状、聊天相关请求/响应、示例与错误码等有任何约定变化 |
| [09-EXECUTIVE-CHAT.md](../specs/09-EXECUTIVE-CHAT.md) | Executive 产品描述、追问/气泡交互、可视化与免责等用户可见行为 |
| [10-EXECUTIVE-CHAT-INTENTS-TOOLS.md](../specs/10-EXECUTIVE-CHAT-INTENTS-TOOLS.md) | 意图、工具、`analysisType`、示例问法或 IR/FC 与工具映射说明变化 |
| [specs/index.md](../specs/index.md) | 增删或重命名规格文件、入口目录需反映时 |
| **本计划** [§9](#9-修订记录) | 里程碑、排期或行为约定变化时 **追加一行**（无需改 §9 可省略） |

仓库根 [README.md](../../../README.md) 等对外说明：仅在 **接入方式或用户可见能力** 变化时更新。

### 1.2 方案评审摘要（外部反馈纳管）

以下节录自对本计划的独立评审结论，已映射到后续 §3.2、§4、§5（含 **4.1**）、§6；**V2.1** 专项见 [§1.3](#13-v21-补丁上下文流式高亮多图全屏)。实施时以本计划任务为准。

**优点（合理性）**

- **职责解耦（Frontend Mapping）**：后端只传业务数据载荷，前端统一 `option` 与主题，避免后端关心字号、网格、配色，利于 H5 多屏一致表现。
- **按需出图（轨 B + 追问）**：通过追问再带 `visualizations`，减轻首轮大包 JSON 与延迟，符合「先结论、后详情」的阅读习惯。
- **稳定性意识**：对非确定性输出需 **校验 / 降级 / 重试 / 隔离报错**（与 §6、阶段 3b 一致）。

**待加固点（已在正文展开）**

| 主题 | 对应位置 |
|------|----------|
| LLM / 协议与前端预期微差导致 `setOption` 失败 | §3.2 数据清洗、§6 |
| 新图表类型需发版 | §3.2 `customOptions` 预留、§4 示例 |
| 历史消息中厚重 `visualizations` 撑爆上下文 | §5 阶段 1：**剥 JSON + 保留 `visualizationSummary`**（§4）、§6 |
| 移动端 Tooltip / 密数据可读性 | §3.2 交互约定、§6 |
| 联调前缺少无 LLM 的 UI 验收面 | §5 **阶段 4.1 Mock Gallery** |
| 图表失败线上不可观测 | §3.2 **`reportChartError`**、阶段 3b、§6 |
| **剥离图表后模型「看不见图」、追问幻觉** | **§1.3 漏洞 1**、§5 阶段 1 **可视化文本摘要**（非裸剥离） |
| **SSE 半包 JSON 导致 parse/半渲染崩溃** | **§1.3 漏洞 2**、§3.2 **流式闭合闸门**、阶段 2 / 3b |
| **固定模板无法点状强调** | **§1.3 漏洞 3**、§3.2 **`highlights`**、§4 |
| **多图 H5 纵向堆叠卡顿** | **§1.3 漏洞 4**、§3.2 **Swiper/Tab**、阶段 3b |
| **窄屏读轴困难** | §3.2 **查看大图 / 全屏** |

### 1.3 V2.1 补丁（上下文·流式·高亮·多图·全屏）

本节收纳二次评审中识别的 **协议/交互漏洞** 与对应修复，实施时与 §3.2、§4、§5、§6 一并验收。

| ID | 漏洞 / 现象 | 修复要点（摘要） | 正文落点 |
|----|----------------|------------------|----------|
| **1** | **上下文剥离 → AI 视觉盲区**：历史里去掉完整 `visualizations` 后，用户追问「图上异常点为何这么高」「第三根柱子怎么算的」，模型看不到数据，易 **拒答或幻觉**。 | **不用「裸剥离」**：在 `replyContent` 上 **持久化可选 `visualizationSummary`**（见 [§4](#4-数据契约草案需写入-04--09-后定稿)）；喂给 LLM 时 **剥 `visualizations` 数组、保留 `visualizationSummary` 字符串**（或等价注入 assistant 文本）。摘要宜 **工具侧确定性生成**；缺省时由历史拼装层对落库 `visualizations` **反推** best-effort。**落库仍为完整 JSON**（含图数据）。 | §4、§5 **阶段 1**；§6 |
| **2** | **SSE 流式 → JSON 半截**：`visualizations` 常在报文末尾；网络中断或分包导致字符串停在 `{"xAxis": [1, 2, …` 时，`JSON.parse` / `tryParseReplyContent` 失败或若误用半对象会 **中间态崩溃**。 | **闭合后渲染**：图表组件（`ExecChatChart` / `AiChartRenderer`）仅在 **`done === true`** 且 **载荷已解析为完整对象**（或对原始片段做 **括号/引号闭合校验** 通过）后，才 **初始化 ECharts 并 `setOption`**；此前仅 **Loading / 骨架屏**，不把半截字符串当有效 option。与 §3.4.1 追问气泡「`done` 后再点」一致。 | §3.2；§5 阶段 2 / 3b；§6 |
| **3** | **静态前端映射 vs 业务动态标注**：如「把华东区柱子标红」「强调：均值已剔极值」，固定模板难以表达 **按索引/按语义** 的高亮。 | 协议增加可选 **`highlights`**（例：`number[]` **0-based** 类目或 series 索引，**精确语义以 04 定稿为准**）；`buildOption` 读取后对对应柱/系列应用 **强调色**（可与 `customOptions` 并存，但高亮以 `highlights` 为优先契约）。 | §3.2；§4 示例 |
| **4** | **多图数组 vs H5 窄屏**：一轮返回 3 张图若 **纵向全长堆叠**，页面过长且 **多 Canvas 同屏** 易 **滑动卡顿、内存压力**。 | **`visualizations.length > 1`** 时 H5 **默认横向 Swiper（或 Tab 卡片）**，**单屏主区域只保留一个活跃图表实例**（或惰性挂载非当前页）；桌面端可并排或同样轮播，产品定稿。 | §3.2；§5 阶段 3b；§6 |
| **UX** | 小屏看不清坐标轴、图例。 | **「查看大图」/ 全屏**（如 `n-modal` 内嵌同一图表组件或放大 `grid`），与 §6 移动端行互补。 | §3.2；阶段 3b；阶段 4 验收 |

**优化建议汇总（与上表一致）：**（1）后端：**剥离 → 可视化文本摘要压缩**；（2）前端：**`highlights`**、**流式闭合闸门**、**多图 Swiper**；（3）UI：**大图/全屏**。

---

## 2. 项目结构速查（与本功能相关）

### 2.1 前端（`TOT_frontend/`）

| 路径 | 说明 |
|------|------|
| [src/views/executive/index.vue](../../../TOT_frontend/src/views/executive/index.vue) | Executive Chat 主界面：结构化气泡、流式、`followUpSuggestions` 展示 |
| [src/views/executive/login.vue](../../../TOT_frontend/src/views/executive/login.vue) | Executive 登录 |
| [src/api/chat/index.ts](../../../TOT_frontend/src/api/chat/index.ts) | Chat API 类型：`ReplyContent`、`SendMessageResult`、流式 `streamExecutiveChatMessage` |
| [src/utils/execChatStreamParts.ts](../../../TOT_frontend/src/utils/execChatStreamParts.ts) | 流式 JSON 拆分与 `tryParseReplyContent`（**当前只解析四段式**） |
| [src/hooks/web/useECharts.ts](../../../TOT_frontend/src/hooks/web/useECharts.ts) | 通用 ECharts 封装（按需引入 chart 组件，利于包体） |
| [src/utils/lib/echarts.ts](../../../TOT_frontend/src/utils/lib/echarts.ts) | 树摇后的 ECharts 入口（与 `useECharts` 配套） |
| [src/views/central/board/index.vue](../../../TOT_frontend/src/views/central/board/index.vue) | 参考：完整 `echarts` 引用与复杂 option（Executive 侧优先复用 `useECharts` 模式以控制体积） |

**依赖：** [package.json](../../../TOT_frontend/package.json) 已声明 `"echarts": "^5.6.0"`，**默认不新增** Executive 专用依赖（除非产品要求 `@vue-echarts` 等）。**多图横向滑动（§3.2）** 优先用 **Naive UI `n-tabs`、自研横向滚动或 CSS scroll-snap**；若必须引入 **`swiper`**，在阶段 3b **单独立项**并更新本段与 [§6.1](#61-计划自检与待对齐项滚动维护)。

### 2.2 后端（`TOT_backend/server/`）

| 路径 | 说明 |
|------|------|
| [routes/chat.js](../../server/routes/chat.js) | `POST .../messages` 请求体实际字段：`content`、可选 `stream`（与 04 文档中部分示例字段可能不一致，联调以本文件为准） |
| [services/chatService.js](../../server/services/chatService.js) | 会话与消息落库、`replyContent` 整对象 JSON 存储 |
| [services/chatAnswerService.js](../../server/services/chatAnswerService.js) | **Intent Routing 下**将 tool 结果格式化为 `replyContent`；`parseReplyFromRaw` **当前丢弃**四段式以外字段 |
| [services/chatAgentRunner.js](../../server/services/chatAgentRunner.js) | IR / FC 调度；FC 最终 JSON 亦需与前端约定一致 |
| [chat_tools/tool_runAnalytics.js](../../server/chat_tools/tool_runAnalytics.js) 等 | 统计分析原始结果，可作为 **确定性生成 `visualizations` 数据源**（减少纯靠 LLM 拼图表 JSON 的不稳定） |

---

## 3. 架构设计与技术选型

### 3.1 触发时机（建议：两轨并存）

| 轨 | 行为 | 适用 |
|----|------|------|
| **A. 同轮返回** | 当 `intentType` 为 `analytics_query`（或工具结果为分布/趋势/相关）时，后端在 `replyContent` 中附带 `visualizations`（可由 **工具结果映射** + 少量 LLM 补全标题） | 首屏即有图，路径短 |
| **B. 追问触发** | 首轮仅文字 + `followUpSuggestions` 中含「生成图表」类建议；用户点击后再发一条明确指令，第二轮再带 `visualizations` | 省 token、符合原讨论 |

产品可默认 **A**，用 **B** 作为「用户只要数字不要图」时的降级。

### 3.2 组件与图表策略

- **新建组件**：建议在 [`TOT_frontend/src/views/executive/components/`](../../../TOT_frontend/src/views/executive/) 下新增 `ExecChatChart.vue`（或原计划名 `AiChartRenderer.vue`；若目录尚未存在则新建 `components/`）。
- **ECharts 接入**：优先使用 **`useECharts` + `src/utils/lib/echarts.ts`**，与控制台图表一致；避免在 Executive 页直接 `import * as echarts from 'echarts'`，除非确有未注册图表类型需求。
- **配置职责划分**：后端 / 协议层只约定 **`type` + 数据载荷**（如 categories、series、scatter points）；**颜色、grid、axisLabel、dataZoom、移动端字号** 由前端 `buildOption(type, payload)` 统一处理，减少 LLM 胡编 style。
- **数据清洗（必做）**：在 `setOption` 前增加轻量 **`normalizeChartPayload`（或等价逻辑）**：校正数值/字符串类型、截断或对齐 categories 与 series 长度、过滤 `NaN` 等，避免 ECharts 内部异常导致白屏；失败时走组件内降级文案（见 §6）。
- **扩展性：`customOptions`（可选）**：在 `visualizations[]` 上预留 **`customOptions?: Record<string, unknown>`**（命名以 04 定稿为准）：常规类型仍走前端模板；少数定制可在白名单内合并进 `option`（需防任意代码/过大对象，建议键级 allowlist + 大小上限）。
- **移动端 Tooltip / 缩放**：`tooltip` 使用可配置 `position`（或等价策略）使浮层尽量留在可视区；默认启用 **`dataZoom`（如 `inside`）** 支持双指/手势查看密数据；具体与 [§6](#6-潜在风险与缓解) 一致。
- **错误观测与上报（MVP，对齐仓库现状）**：当前 `TOT_frontend` **未引入 Sentry** 等 APM（以 [package.json](../../../TOT_frontend/package.json) 为准）。图表组件对 **`setOption` / `init` 等** 使用 **try/catch**，失败时 **不冒泡白屏**；统一经 **`reportChartError(payload)`** 输出（默认实现为 **结构化 `console.error`**：固定前缀如 `[exec-chat-chart]`，字段含 `type`、`message`、可选 `visualizationType`、是否已做清洗等）。后续若接入 Sentry/自研埋点，**只改 `reportChartError` 一处**，不必散落改组件。
- **流式渲染闸门（V2.1，防半截 JSON）**：`visualizations` 的 **ECharts 初始化与 `setOption`** 仅在 **SSE 流结束（`done === true`）** 且 **`replyContent` 已得到完整解析结果** 之后执行；流式过程中若仅存在 **不完整 JSON 片段**，图表区保持 **Loading / 骨架屏**，**禁止**用半截对象驱动图表（与 [§1.3](#13-v21-补丁上下文流式高亮多图全屏) 漏洞 2 一致）。`tryParseReplyContent` / [execChatStreamParts.ts](../../../TOT_frontend/src/utils/execChatStreamParts.ts) 可在 JSON 未闭合时返回「不可展示图」状态；具体以阶段 2 实现为准。
- **动态高亮：`highlights`（V2.1）**：在 `visualizations[]` 上增加可选 **`highlights?: number[]`**（**0-based** 索引，表示需强调的 **类目或 series 项**，与 `type` 组合的精确语义写入 **04**）：`buildOption` 将对应项设为 **强调色**（如告警红），满足「某区域柱标红」「标出异常桶」等 **协议驱动** 需求，避免仅靠固定配色无法表达 AI 意图。
- **多图 H5：Swiper / Tab（V2.1）**：当 **`visualizations.length > 1`** 时，移动端 **默认横向滑动卡片**（如 Swiper）或 **Tab 切换**，**避免** 多个大图纵向无限堆叠；优先 **单屏一个活跃实例** 或惰性挂载，减轻滚动与内存压力（见 [§1.3](#13-v21-补丁上下文流式高亮多图全屏) 漏洞 4）。
- **窄屏大图 / 全屏（V2.1）**：提供 **「查看大图」** 入口，在 **全屏 Modal**（如 Naive `n-modal`）或等价容器中复用同一图表组件，便于阅读坐标轴与图例。

### 3.3 建议支持的图表类型（与 `runAnalytics` 对齐）

| analysisType（后端） | 建议 `visualizations[].type` | 图表形态 |
|----------------------|-------------------------------|----------|
| `completion_time_distribution` | `bar` / `histogram` | 柱状或直方（按桶 label） |
| `completion_rate_forecast` | `line` | 折线（历史点 + 预测点，预测段虚线可选） |
| `metric_correlation` | `scatter` | 散点（tooltip 带门店或样本 id 若可公开） |
| `quantile_duration` / `trimmed_mean_duration` | `bar`（单柱或多指标）或仅 `keyNumbers` 无图 | 简单条形或省略图表 |
| `progress_variance_by_channel` | `bar`（横向） | 各渠道完成率对比 |

### 3.4 追问气泡：可编辑发送与「是否生成图表」类追问

**现状：** [executive/index.vue](../../../TOT_frontend/src/views/executive/index.vue) 将 `followUpSuggestions` 用 `join(' / ')` 拼成一段静态文案，用户无法单条选用或编辑。

**目标：** 保持 API 字段仍为 **`string[]`**（与 [04-API-SPEC.md](../specs/04-API-SPEC.md) / 后端一致），仅改前端呈现与交互；行为与 **09** 中「AI 可在回答中追问」一致，只是把追问做成 **可选气泡**。

#### 3.4.1 气泡交互（填入输入框 → 可改 → 发送）

| 项 | 约定 |
|----|------|
| **展示** | 每条建议单独一块可点击控件，视觉呈现为 **气泡 / chip**（推荐 `n-button` secondary / quaternary，或 `n-tag` + `role="button"`）；可换行排列；移动端保证最小点击高度（约 44px）。 |
| **点击行为（主路径）** | 点击后将**该条字符串完整**写入 **输入框**（与 `inputValue` / 当前 composer 绑定字段一致），并 **聚焦输入框**；**不自动发送**。用户可编辑文案后，再点现有「发送」走 `handleSend` / SSE，与手动输入 **同一条链路**。（产品已确认采用本路径，不提供并列「直接发送」。） |
| **与「一键直发」** | 默认不要求「点气泡即发送」；若后续产品要加「长按 / 次要操作直发」，可作为二期，避免误触。 |
| **前缀** | 后端 Few-shot 若带「可追问：」等前缀，填入输入框时 **原样写入**（用户可删改）；若产品希望气泡展示与发送文案分离，再用 UI 层 `displayText` / `sendText`（二期）。 |
| **无障碍** | 每条控件 `aria-label` 建议为「将追问填入输入框：…」或「选用追问：…」，避免仅靠「💡」表达动作。 |
| **流式** | `partialReply.followUpSuggestions` 在 JSON 未闭合前可能不完整；仅在 **`done` 后**或 `tryParseReplyContent` 成功解析出完整数组后渲染可点气泡，避免点到半句。 |
| **空态** | `length === 0` 时不展示追问区（与现逻辑一致）。 |

**实现提示：** 在 `index.vue` 中抽取 `fillComposerWithSuggestion(text: string)`（赋值输入框 + `nextTick` 聚焦）；**发送**仍只经现有「发送」按钮（内部可保留 `submitExecutiveQuestion(text)` 仅在用户确认发送时调用），避免重复逻辑。

#### 3.4.2 图表类追问由模型可选加入

**产品规则：** 在生成 `followUpSuggestions` 时，模型应 **结合用户意图、本轮 `intentType`、是否已带 `visualizations`、分析类型是否适合出图** 等，**自行决定**是否在数组中 **追加 0 或 1 条**「邀请用户确认是否生成本轮图表」的文案。

| 情况 | 建议行为（写入 SYSTEM_PROMPT / 09 对齐） |
|------|------------------------------------------|
| 本轮 **已返回** `visualizations` | 通常 **不再** 追问「要不要生成图表」，可改为「要换另一种图吗」等（按需）。 |
| 用户 **明确只要数字/不要图** | **不要** 强塞图表类追问。 |
| `analytics_query` 且结果 **明显可可视化**、且当前走 [§3.1](#31-触发时机建议两轨并存) **轨 B**（首轮仅文字） | **宜** 加入 1 条清晰、可点的邀请句，例如：「需要我根据本次统计生成完成耗时分布图吗？」（具体措辞由提示词统一风格）。 |
| 非分析类意图或样本量过小等 **不适合出图** | **不** 加入图表邀请，避免空头承诺。 |

**协议：** **不强制** 新增 `chartOffer: boolean` 等独立字段；图表邀请作为 `followUpSuggestions` 中 **普通一条字符串**（与现有 API 的 `string[]` 一致）即可，前端与其他气泡 **无差别**（同样填入输入框）。若未来要做埋点 / A-B，再考虑结构化扩展。

用户点击该条气泡 → 输入框出现邀请句 → 用户可改成更明确的指令（如「生成柱状图」）再发送 → 第二轮后端返回带 `visualizations` 的 `replyContent`，与轨 B 一致。

---

## 4. 数据契约（草案，需写入 04 / 09 后定稿）

在既有四段式之外，增加可选字段（与 [04-API-SPEC.md](../specs/04-API-SPEC.md) 注释一致）：

```json
{
  "overview": "...",
  "keyNumbers": [],
  "attentionPoints": [],
  "followUpSuggestions": [],
  "statisticsProvenance": { "sampleSize": 120, "taskFilter": "...", "regionFilter": "华东" },
  "forecastDisclaimer": "线性外推，仅供运营预估",
  "visualizationSummary": "[图表记忆] 直方图：X=耗时桶，Y=人数；峰值在 4–8h 桶（精确数以会话内图表为准）。",
  "visualizations": [
    {
      "type": "bar",
      "title": "完成耗时分布",
      "data": {
        "categories": ["0-4h", "4-8h", "8-24h", "24h+"],
        "values": [10, 25, 30, 5]
      },
      "highlights": [1],
      "customOptions": {}
    }
  ]
}
```

**原则：** `visualizations[].data` 仅包含数据与轴标签，**不包含**完整 ECharts `option`；前端负责 theme 与响应式。`customOptions` 为 **可选**，仅用于在白名单内覆盖模板默认值（见 [§3.2](#32-组件与图表策略)）。**`highlights`** 为 **可选**，用于 **索引级高亮**（与 04 定稿的 `type` 语义一致，见 [§1.3](#13-v21-补丁上下文流式高亮多图全屏)）。

**`visualizationSummary`（可选，推荐与图同发）**

| 项 | 约定 |
|----|------|
| **类型** | `string`，建议 **极短**（如 ≤3 句或 200～300 字上限，**04 可再收紧**）。 |
| **用途** | **模型上下文**：后续轮次拼装 **发往 LLM 的历史** 时，**省略 `visualizations` 大 JSON**，但 **保留本字段**，避免 [§1.3](#13-v21-补丁上下文流式高亮多图全屏) 漏洞 1。**前端展示可不渲染**（或仅在调试模式显示），与 `overview` 分工见下。 |
| **与 `overview`** | `overview` 面向 **用户** 叙述；`visualizationSummary` 面向 **下一轮模型** 的 **图意压缩**（轴含义、单位、峰值/异常桶、索引提示等），允许与 `overview` 部分重复关键事实。 |
| **谁写入** | **优先** 工具映射 / `chatAnswerService` 格式化层 **确定性生成**；LLM 路径若输出图表，可由解析白名单透传或由服务端在 `parseReplyFromRaw` 后 **补写**。 |
| **缺省** | 若落库无此字段，**历史拼装** 应对该条 `visualizations` **反推**摘要再剥 JSON（best effort）；仍无法满足时沿用阶段 1 的 **占位句** 策略。 |
| **命名** | 对外契约统一 **`visualizationSummary`**。讨论稿中的 **`chartMemory` 不作为 API 键名**，避免与通用「会话记忆」混淆。 |

**与阶段 3a：** `followUpSuggestions` 字段形状不变；追问气泡不改变本契约，仅改变前端展示与交互。

---

## 5. 实施阶段与受影响文件

**说明：** 下表按 **图表链路的依赖关系** 排列阶段 1→2→3b；**实际迭代顺序**以 [推荐实施顺序](#推荐实施顺序排期约定) 为准（**3a 优先**）。

### 推荐实施顺序（排期约定）

**默认迭代顺序：先追问气泡，再图表全链路。** 二者无协议硬依赖；气泡可单独发版，图表依赖阶段 1–2 与 ECharts 集成。

| 次序 | 范围 | 说明 |
|------|------|------|
| **①** | [§3.4](#34-追问气泡可编辑发送与是否生成图表类追问) **追问气泡**（对应下表 **阶段 3a**） | 主要改 [executive/index.vue](../../../TOT_frontend/src/views/executive/index.vue)；沿用现有 `followUpSuggestions`（`string[]`），**不依赖** `visualizations` 透传与 `ExecChatChart`。 |
| **②** | **阶段 1 → 2 → 3b →（建议 4.1）→ 4** | 后端 allowlist 透传、前端类型与流式解析、图表组件与挂载、可选 Mock Gallery、端到端验收（与文首按阶段表一致）。 |

**§3.4.2 提示词**：可与 **①** 同迭代（仅改模型输出习惯），或并入 **阶段 1** 与 `chatAgentRunner` / `chatAnswerService` 一并收紧。图表（②）未上线时，「是否生图」类气泡仍可先出现；用户发第二条后，直至 **②** 完成才会真正返回 `visualizations`。

---

### 阶段 1：协议与后端透传（图表链路必须先做）

**目标：** 后端产出的 `replyContent` 可合法携带 `visualizations` / `visualizationSummary` / `statisticsProvenance` / `forecastDisclaimer`，且落库与历史接口不回溯丢字段。

| 任务 | 文件 |
|------|------|
| 扩展 `SYSTEM_PROMPT` 与解析白名单 | [chatAnswerService.js](../../server/services/chatAnswerService.js)：`parseReplyFromRaw` 在校验四段式后 **透传**约定可选键（勿把未知键全量透传，建议 allowlist），**须含** `visualizationSummary`、`visualizations`、`highlights`（在 `visualizations[]` 内）、`customOptions` 等（与 [§4](#4-数据契约草案需写入-04--09-后定稿) 一致） |
| `followUpSuggestions` 生成规则 | 同上或在 [chatAgentRunner.js](../../server/services/chatAgentRunner.js) FC 提示词中明确：[§3.4.2](#342-图表类追问由模型可选加入)（气泡文案含可选「是否生图」一条、已出图则不重复等） |
| （可选）工具结果 → 图表数据 | [chatAnalyticsService.js](../../server/services/chatAnalyticsService.js) 或 `chatAnswerService` 内：对 `runAnalytics` 的返回做 **确定性** `visualizations` 构建，LLM 只写文案与 `followUpSuggestions` |
| FC 路径一致性 | [chatAgentRunner.js](../../server/services/chatAgentRunner.js)：FC 最终 `json_object` 与 IR 使用同一套 `replyContent` 形状说明 |
| **上下文：可视化摘要压缩（V2.1，替代「裸剥离」）** | 在拼装 **发往 LLM 的历史消息** 时（具体落点以实现为准，如 [chatService.js](../../server/services/chatService.js) / agent 入口）：对历史 **assistant** 的 `replyContent`，**不**向模型投喂完整 `visualizations` JSON（防 Token 爆），**保留** 持久化字段 **`visualizationSummary`**（见 [§4](#4-数据契约草案需写入-04--09-后定稿)）；若无该字段则 **反推** 或 **占位句**。使后续追问「图上某点/某柱/异常」时模型仍具备 **可引用语境**（[§1.3](#13-v21-补丁上下文流式高亮多图全屏) 漏洞 1）。**落库与拉取历史 API** 仍为 **完整** `replyContent`（含 `visualizations`）；仅 **构造 LLM messages** 时使用摘要视图，避免与会话回放混淆。定稿写入 04/09 并满足 [§1.1](#11-关联文档同步执行约束)。 |
| 文档 | [04-API-SPEC.md](../specs/04-API-SPEC.md) §6、`replyContent` 示例；[09-EXECUTIVE-CHAT.md](../specs/09-EXECUTIVE-CHAT.md) PRD 扩展字段表；[10-EXECUTIVE-CHAT-INTENTS-TOOLS.md](../specs/10-EXECUTIVE-CHAT-INTENTS-TOOLS.md) 若提示词或工具映射有变。**须满足** [§1.1](#11-关联文档同步执行约束)。 |

**注意：** [routes/chat.js](../../server/routes/chat.js) 当前请求体为 `{ content, stream }`，若 04 中仍写 `messageId`/`contextId` 等，联调以 **路由实现** 为准，计划执行时建议 **顺带修订 04** 避免文档漂移。表中 **`followUpSuggestions` 生成规则** 不阻塞 **阶段 3a**（气泡 UI），但建议在 **3b 前** 落地，以免「是否生图」气泡与真实出图能力长期脱节（见 [§6](#6-潜在风险与缓解) 末行）。

### 阶段 2：前端类型与流式解析

| 任务 | 文件 |
|------|------|
| 扩展 `ReplyContent` | [src/api/chat/index.ts](../../../TOT_frontend/src/api/chat/index.ts)：`visualizationSummary?`、`visualizations[]`（项内 **`highlights?: number[]`**、**`customOptions?`** 等，语义见 04） |
| 流式中途解析 | [execChatStreamParts.ts](../../../TOT_frontend/src/utils/execChatStreamParts.ts)：`tryParseReplyContent` 在 JSON 闭合后合并可选键（至少 `visualizations`）；与 **§3.2 流式闸门** 对齐：**未闭合 / 未 `done`** 时前端图表区不进入 `setOption`（仅 Loading/骨架） |
| 纯文本拼接（若有） | [formatReplyContentText](../../../TOT_frontend/src/api/chat/index.ts)：**默认不把** `visualizationSummary` 暴露给最终用户（避免与 `overview` 重复）；若需无障碍/纯文本模式，可拼接一句「含图表」或摘要（产品定） |
| **图表数据清洗** | 图表组件旁或 `utils/`：`normalizeChartPayload`（或内联于 `ExecChatChart.vue`），`setOption` 前统一执行；与 [§3.2](#32-组件与图表策略) 一致 |

### 阶段 3a：追问气泡（优先，可单独发版）

| 任务 | 文件 |
|------|------|
| 追问气泡 | [index.vue](../../../TOT_frontend/src/views/executive/index.vue)：将 `.exec-follow` 从 `join` 改为 `v-for` + 气泡控件；点击 **填入输入框、可编辑**，发送走原按钮；行为见 [§3.4](#34-追问气泡可编辑发送与是否生成图表类追问) |

**说明：** 对应 [推荐实施顺序](#推荐实施顺序排期约定) 的 **①**；建议在 **阶段 1** 之前或并行完成，不阻塞发版。合入前按 [§1.1](#11-关联文档同步执行约束) 检查 **09**（追问气泡交互）是否需补写；无契约变更则 04/10 可仅快速核对。

### 阶段 3b：图表组件与 Executive 集成

| 任务 | 文件 |
|------|------|
| 新建图表组件 | `TOT_frontend/src/views/executive/components/ExecChatChart.vue`（名称可议） |
| 挂载位置 | [index.vue](../../../TOT_frontend/src/views/executive/index.vue)：在 `.exec-structured` 内、`followUpSuggestions` 之上或之下，展示 `v-if="replyContent.visualizations?.length"` |
| 免责与口径 | 同一气泡内展示 `forecastDisclaimer`、`statisticsProvenance` 折叠区（Naive UI `n-collapse` 与现有「思考过程」一致） |
| **错误隔离与观测** | `setOption` / 初始化包在 try/catch 内；用户侧兜底文案 + **[重试]**；开发/测试环境依赖 **§3.2** 的 `reportChartError`（默认 `console.error`）。与 [useECharts.ts](../../../TOT_frontend/src/hooks/web/useECharts.ts) 现状一致：通用 hook 未统一 catch，**Executive 图表须在组件层收口**。 |
| **流式闸门 + 多图 + 大图** | **`done` 且解析完整** 后再 mount 图表；多图 **Swiper/Tab**（H5）；**查看大图/全屏**；**`buildOption` 应用 `highlights`**（§3.2、§1.3） |

**说明：** 对应 [推荐实施顺序](#推荐实施顺序排期约定) 的 **②** 中与图表相关的前端工作；依赖 **阶段 1–2** 已具备 `visualizations` 数据。

### 阶段 4：联调与验收

| 场景 | 验收要点 |
|------|----------|
| 追问气泡（3a，可先于图表） | 流式 `done` 后气泡列表完整；点击写入输入框、可编辑；发送后与历史回放一致；`isSending` 时禁用 |
| 会话历史回放 | 从接口载入的过往 assistant 消息 **`replyContent` 含完整 `visualizations`（若曾返回）**，图表可再次渲染；与「喂模型时剥 JSON」正交 |
| 分布类 | `completion_time_distribution` 返回桶数据 → 柱状图正确 |
| 预测类 | `completion_rate_forecast` → 折线 + `forecastDisclaimer` 展示 |
| 相关类 | `metric_correlation` → 散点 + 样本量过小时降级为仅文字 |
| 流式 | SSE 过程中 `partialReply` 最终合并含 `visualizations`；**中途**图表区仅为 Loading/骨架；**`done` 后**且解析完整再出图；`done` 与 non-stream 一致 |
| 追问 × 历史摘要 | 多轮后用户追问「上一张图某点」：模型应答应 **与 `visualizationSummary`（或反推摘要）** 一致；接口/落库含该字段（§4）；无摘要场景下降级提示（§1.3） |
| 多图 H5 | 多图 **Swiper/Tab**，无明显滚动卡顿；与 Mock Gallery 矩阵可对齐 |
| 高亮 | `highlights` 传入后对应项颜色与默认系列区分 |
| 大图 | 「查看大图」全屏可读轴与图例 |
| 失败 | `setOption` 抛错 → 兜底文案 + 重试；不白屏 |
| 追问 × 图表 | 含「是否生图」类一条且用户确认发送后，在 **阶段 1–3b 已上线** 的前提下，第二轮出现 `visualizations`（轨 B）；若仅 3a 上线，第二轮仍为文字属预期 |

### 阶段 4.1：Mock Gallery（建议，可缩短联调）

**目标：** 在不依赖 LLM 的情况下，由产品/前端快速确认各 `type` 与极端数据的 UI 表现，再进入真实联调。

| 任务 | 说明 |
|------|------|
| 临时路由 | 在前端增加 **仅开发或受控环境可见** 的路由（如 `/test/charts` 或 `?debugCharts=1`，以项目路由惯例为准），避免生产误暴露。 |
| 样例矩阵 | 列出计划支持的 `visualizations[].type`，并覆盖 **极限情况**：大量类目（如 50+）、全 0、负数、单点、空数组等；建议含 **`highlights`**、**多图 Swiper**、**全屏** 的静态样例。 |
| 与正式组件复用 | Gallery 直接渲染与 Executive 相同的 **`ExecChatChart` / `AiChartRenderer`**，避免「画廊一套、线上一套」。 |
| 生命周期 | MVP 验收通过后可移除路由或改为内部 Story；若保留，须在 README/09 注明为调试入口。 |

---

## 6. 潜在风险与缓解

| 风险 | 缓解 |
|------|------|
| LLM 拼 `visualizations` 结构不稳定 | **优先工具侧确定性映射**；LLM 只生成 `overview` 与建议 |
| `parseReplyFromRaw` 丢弃扩展字段 | 阶段 1 必须改 allowlist 透传 |
| 流式 `tryParseReplyContent` 丢字段 | 阶段 2 同步扩展；**仅 `done` 且 JSON 完整闭合后** 渲染图表（§3.2 闸门，防半截崩溃） |
| 移动端拥挤 | `axisLabel` 旋转、`dataZoom`、减小 `grid`；必要时横屏提示 |
| 包体 | 使用 `src/utils/lib/echarts.ts` 按需注册，勿全量引入 |
| 先发 3a、后发图表，用户点「是否生图」仍无图 | 产品文案可注明「图表能力陆续开放」；或 **3a 与 3b 同版本** 发布；或阶段 1 完成前按 §3.4.2 少生成图表类追问 |
| 代码与文档脱节 | 交付前强制执行 [§1.1](#11-关联文档同步执行约束)；DoD 含规格勾选与本计划 §9 一行（若有行为变更） |
| **数据结构微差**（数值变字符串、轴与 series 长度不一致等） | **阶段 2** `normalizeChartPayload`；组件内 try/catch + 兜底 UI；优先 **工具映射** 减少 LLM 直接拼结构（见既有「LLM 拼 visualizations」行） |
| **新图表类型即发版** | 常规走前端模板；**`customOptions` 白名单** 承接少量定制；真正新 type 仍须发版并更新 04/10 |
| **历史消息中图表 JSON 撑爆上下文** | **阶段 1 摘要压缩**：喂给 LLM 时 **去掉大 JSON**，以 **短文本摘要替代**（[§1.3](#13-v21-补丁上下文流式高亮多图全屏)）；完整对象仍存 DB。**禁止**仅剥离无摘要，否则 **追问「图上…」幻觉** |
| **SSE 半包 JSON、中间态误渲染** | **§3.2 流式闸门**：未 `done` 或载荷未完整解析 → 仅骨架；`setOption` 仅在完整对象上执行 |
| **固定模板无法点状强调** | 协议 **`highlights` + `buildOption`**（§4）；与 `customOptions` 边界在 04 写明 |
| **多图 H5 纵向堆叠卡顿** | **Swiper/Tab + 单屏主实例/惰性挂载**（阶段 3b） |
| **移动端 Tooltip 裁切、点选困难** | `tooltip.position` / 限制浮层；`dataZoom`；必要时全屏/放大查看（与 09 交互一致后定稿） |
| **图表异常线上不可查** | **阶段 3b** 落地 `reportChartError`；MVP 用带前缀、可检索的 `console.error`；上线后若接 APM，仅替换该函数实现；**09** 可注明「用户可见为兜底文案，详情见控制台/埋点」（按需） |

### 6.1 计划自检与待对齐项（滚动维护）

实施过程中可在此表 **打勾或改状态**；与 [§8](#8-执行清单跟踪)、文首 **任务执行状态** 列同步更新。

| 项 | 现状 / 风险 | 建议 |
|----|-------------|------|
| **04 / 09 契约** | [04-API-SPEC.md](../specs/04-API-SPEC.md) 对 `replyContent` 仍以 PRD 指向为主；**`visualizationSummary`、`highlights`、`visualizations[]` 形状未在 04 中单段定稿** | 阶段 1 收尾：**04** §6 补正式字段表与示例；**09** 补用户可见图表、免责、大图入口 |
| **多图滑动实现** | 「Swiper」在 §3.2 中为 **产品表述**；与 §2.1「少增依赖」需一致 | 优先 **Tabs / scroll-snap**；引入 `swiper` 须更新依赖说明与包体评估（§6 包体行） |
| **`highlights` 语义** | 柱状 **类目索引** vs 散点 **series/点索引** 未在正文锁死 | **04** 按 `type` 分表定义；前端 `buildOption` 与 Mock Gallery 覆盖各 type |
| **无障碍** | `visualizationSummary` 默认不对用户展示 | 图表区设 **`aria-label` / `role`/`img` 替代文本**（可由 `title` + 一句概述），避免视障用户完全无图意 |
| **安全与大小** | `visualizations` 大数组、`customOptions` 可能过大 | 阶段 1：**单条消息 `replyContent` 序列化大小上限**（如 256KB 量级，数值产品定）；超限截断或拒写并日志 |

---

## 7. 与相关计划的衔接

- **工具编排：** [2026-04-17-executive-chat-tool-orchestration.md](./2026-04-17-executive-chat-tool-orchestration.md)（FC 多工具时，图表数据仍建议由 **最终 tool 结果** 映射，避免多跳后格式发散）。
- **意图与工具清单：** [10-EXECUTIVE-CHAT-INTENTS-TOOLS.md](../specs/10-EXECUTIVE-CHAT-INTENTS-TOOLS.md)。

---

## 8. 执行清单（跟踪）

**顺序：** 与文首 **[按阶段执行计划（推荐顺序）](#按阶段执行计划推荐顺序)** 一致：先做 **阶段 3a**，再做 **阶段 1 → 2 → 3b →（建议 4.1）→ 4**；细节见 [§5 推荐实施顺序](#推荐实施顺序排期约定)。

**文档：** 每个阶段收尾前完成 [§1.1](#11-关联文档同步执行约束)；有约定变化时更新 [§9](#9-修订记录)。

- [x] 阶段 3a：`followUpSuggestions` 气泡可点、填入输入框可编辑发送（§3.4）。
- [x] 阶段 1：`chatAnswerService` 透传可选键（含 **`visualizationSummary`**）；可选工具→`visualizations` + **摘要** 映射；**历史拼装** 剥 `visualizations`、留 `visualizationSummary`（§4、§1.3）；提示词「是否生图」追问规则（§3.4.2）与 FC / 格式化对齐；按 [§1.1](#11-关联文档同步执行约束) 更新 04 / 09 / 10。
- [x] 阶段 2：`ReplyContent` 类型（含 **`highlights`**）+ `execChatStreamParts` 流式解析对齐；**流式闸门**与 **`normalizeChartPayload`**（§3.2）。
- [x] 阶段 3b：`ExecChatChart.vue` + `executive/index.vue` 图表挂载与移动端样式；**try/catch + `reportChartError` + 用户重试**；**`done` 后完整再渲染**；多图 **Swiper/Tab**；**大图/全屏**；**`highlights` 样式**（§1.3、§3.2）。
- [x] 阶段 4.1（建议）：Mock Gallery 路由 + 极限样例，与正式图表组件复用。
- [ ] 阶段 4：按 `analysisType` 端到端验收与错误兜底（含追问气泡 + 图表）。

---

## 9. 修订记录

| 日期 | 摘要 |
|------|------|
| 2026-04-17 | **初稿与功能范围：** 可视化目标、仓库路径速查、两轨触发（§3.1）、图表类型与 `visualizations` 草案（§4）、阶段 1–4 与执行清单；§3.4 追问气泡（填输入框可编辑）、§3.4.2 模型可选「是否生图」追问；阶段拆为 **3a / 3b**，推荐排期 **3a → 1 → 2 → 3b → 4**；与编排计划、09/04/10 衔接。 |
| 2026-04-17 | **复审修订：** `docs/plans` 下后端文件链接统一为 `../../server/…`；文首补充 10 规格与文档范围；§4 与 3a 关系、§5 标题与说明、阶段 1 注意、阶段 4 追问验收、§6 期望落差风险；修正风险表列数；更新「最后更新」脚注；**新增本节**。 |
| 2026-04-17 | **关联文档同步：** 文首执行约束 + **§1.1** 表（AI/人工须及时更新 04/09/10、specs/index、本计划 §9）；阶段 1 文档任务、3a 说明、§6 风险、§8 清单对齐。 |
| 2026-04-17 | **恢复：** 用户本地精简版覆盖后，按会话中已定稿内容 **全文恢复** 本计划（含 §1.1～§9、正确相对路径与 3a/3b 排期）。 |
| 2026-04-17 | **外部评审纳入：** 新增 **§1.2** 摘要；§3.2 数据清洗、`customOptions`、移动端 Tooltip/dataZoom；§4 示例补 `customOptions`；阶段 1 **上下文裁剪**、阶段 2 清洗任务、**阶段 4.1 Mock Gallery**；§6 增 4 行风险；§8 清单对齐。 |
| 2026-04-17 | **图表错误观测：** §3.2 增加 `reportChartError`（默认 `console.error`，无 Sentry）；阶段 3b 任务行 + §6「线上不可查」；§8 阶段 3b 勾选；与 `useECharts` 在组件层收口说明一致。 |
| 2026-04-17 | **V2.1 补丁：** 新增 **§1.3**（漏洞 1–4 + 全屏 UX）；§1.2 表增行；§3.2 流式闸门、`highlights`、Swiper、大图；§4 示例 `highlights`；阶段 1 改为 **可视化摘要压缩**；阶段 2/3b/§6/§8/阶段 4 验收对齐。 |
| 2026-04-17 | **`visualizationSummary` 定稿：** §4 JSON + 字段表（与 `overview` 分工、缺省反推、`chartMemory` 不采用）；阶段 1 allowlist/历史拼装/目标行；阶段 2 `ReplyContent` 与 `formatReplyContentText` 说明；§1.3 漏洞 1 与 §8 对齐。 |
| 2026-04-17 | **按阶段执行计划：** 文首新增 **「按阶段执行计划（推荐顺序）」** 表（①3a → ②1 → ③2 → ④3b → ⑤4.1 → ⑥4）；§8 增加与该节交叉引用。 |
| 2026-04-17 | 按阶段执行计划表新增 **任务执行状态** 列（默认 `未开始`）及状态取值说明。 |
| 2026-04-17 | **计划自检：** 新增 **§6.1**（04/09 对齐、Swiper 与依赖、highlights 语义、a11y、`replyContent` 大小上限）；§2.1 依赖与多图方案一致；§5 推荐顺序表含 4.1；阶段 1 区分 **落库/API 完整** vs **喂模型摘要**；阶段 2 合并 `highlights` 重复行；阶段 4 增 **历史回放** 验收。 |
