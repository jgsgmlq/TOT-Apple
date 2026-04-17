# Executive Chat Agent 重构设计文档

**日期：** 2026-04-18  
**状态：** 已批准，待实现（2026-04-18 已并入评审缺口：提示词 JSON 措辞、getHistory、`compressAssistantContent`、`req.on('close')`/AbortSignal、`done` 与 delta 真源、suggestions 围栏内 JSON 数组规范）  
**目标：** 让 Executive Chat Agent 的交互体验对标 Claude / ChatGPT / DeepSeek  
**交付策略：** 最小可用优先 — Markdown 渲染 + 停止生成 + FC 默认 + 系统提示词升级，二期再做状态机深化

---

## 一、背景与问题诊断

### 当前架构的核心缺陷（对比主流 Agent）

| 维度 | 当前 Executive Chat | Claude / ChatGPT / DeepSeek |
|------|--------------------|-----------------------------|
| LLM 调用次数 | 2次（`chatIntentService.classify` + `chatAnswerService.format`） | 1次 FC 循环，模型自主推理 + 输出 |
| 输出格式 | 结构化 JSON → 前端解析渲染卡片 | 直接流式 Markdown 文本 |
| 工具执行可见性 | 用户看不到，黑盒等待 | 实时显示「正在查询…」状态 |
| 多轮上下文 | 每轮独立意图分类，上下文靠压缩传入 | 模型在 FC 循环中持有完整推理状态 |
| 停止生成 | 不支持 | 支持 AbortController |
| 消息渲染 | 固定卡片区块（overview / keyNumbers / attentionPoints） | Markdown 散文 + 内嵌表格/图表 |

### 根因

当前系统把「意图分类」和「答案格式化」拆成两次 LLM 调用，并强制输出 JSON 结构，导致：
- 回答缺乏自然语言的流动感
- 新增意图必须手动维护映射表
- 模型无法在一次对话中自主推理「是否需要更多信息」

---

## 二、新架构设计

### 2.1 整体数据流

```
用户发送消息
  ↓
[正则短路] classifyExecutionMode()         ← 保留，安全兜底
  ├─ deny      → 直接返回固定拒绝话术（不走 LLM）
  ├─ chat_only → 直接返回固定引导话术（不走 LLM）
  └─ tool_action
       ↓
[FC 循环] runFunctionCalling()              ← 成为唯一主路径
  ├─ LLM 判断需要工具
  │    ├─ SSE 推送 { phase: "tool_start", text: "工具名" }  ← 前端显示「正在查询…」
  │    ├─ 执行工具（chatToolsService.executeByName）
  │    ├─ SSE 推送 { phase: "tool_end", text: "工具名" }
  │    └─ 工具结果塞回上下文，继续下一轮
  ├─ LLM 判断需要澄清
  │    └─ 直接流式输出澄清问题（Markdown）
  └─ LLM 生成最终回答
       └─ 直接流式输出 Markdown 文本        ← 不再调用 chatAnswerService.format()
  ↓
SSE 推送 done 事件 { messageId, responseTime }
  ↓
DB 存储 Markdown 文本到 chat_messages.content
```

### 2.2 关键架构决策

**决策 1：删除 FC 路径中的 `chatAnswerService.format()` 调用**  
理由：`chatAnswerService.format()` 是「第二次 LLM 调用」，职责是把工具结果格式化为 JSON。新架构中，这个职责由 FC 系统提示词直接承担——LLM 在 FC 循环结束时自己输出 Markdown。`chatAnswerService.js` 文件保留，仅供 `intent_routing` 兜底模式使用。

**决策 2：`intent_routing` 保留为紧急降级模式**  
理由：FC 模式上线初期可能不稳定。保留 `CHAT_AGENT_MODE=intent_routing` 环境变量作为回退开关，但默认改为 `function_calling`。

**决策 3：输出格式改为 Markdown + 特殊代码块**  
理由：纯 Markdown 无法表达图表和追问按钮。借鉴 Claude Artifacts 的代码块约定，用特殊 fence 标记结构化内容（见 2.4 节）。

---

## 三、后端改动详细说明

### 3.1 文件：`TOT_backend/server/services/chatAgentRunner.js`

#### 改动 1：切换默认模式

```javascript
// 第 11 行，改前：
const CHAT_AGENT_MODE = process.env.CHAT_AGENT_MODE || 'intent_routing';

// 改后：
const CHAT_AGENT_MODE = process.env.CHAT_AGENT_MODE || 'function_calling';
```

#### 改动 2：完全重写 FC 系统提示词（`SYSTEM_PROMPT`，第 357 行）

当前（旧）提示词的问题：
- 没有明确的多轮上下文继承规则（不知道从历史中推断实体）
- **将「对用户可见的回答格式」错误地约束为整段结构化 JSON**，与流式 Markdown 产品目标冲突；业务规则与输出形态混写
- 没有「主动澄清」指令

**评审补丁（避免自相矛盾）：** 新版 `SYSTEM_PROMPT` 全文**不得**再要求模型「输出 JSON」「返回 JSON 对象」作为回答主体。唯一允许出现 JSON 字符串的地方是 **Markdown 围栏代码块内部**（见下方 ```echarts），用于图表配置；追问建议用 ```suggestions 承载（围栏内格式见「suggestions 代码块格式」小节）。模型在围栏外对用户可见的正文只能是 Markdown。

新提示词结构（三段式，AI 容易遵循）：

```
【角色定义】
你是苹果零售培训系统的高管数据分析助手。服务对象是 VP 和区域总监。
你的能力范围：培训完成率查询、项目状态、预警门店、区域/门店下钻、统计分析（分位数/分布/相关性/预测）。
你没有能力：发送邮件、催办、修改数据。

【多轮对话规则】——AI 必须严格遵守
1. 实体继承：若用户问题中缺少区域/门店/任务信息，但历史对话中有，必须自动继承。
   例：上轮问「华东区情况」，本轮说「再看华南」，要理解为「查询华南区，对比上轮华东」。
2. 主动澄清：若问题模糊且无法从历史推断，先用自然语言问一个澄清问题，不要猜测调用工具。
   澄清问题示例：「你是想查哪个任务的数据？还是全部任务的总体情况？」
3. 直接行动：若已有足够信息，不要先征求用户同意，直接调用工具。

【输出格式规则】——AI 必须严格遵守
1. 所有回答用流式 Markdown 输出，先给一句结论，再展开数据。
2. 数字数据用 Markdown 表格呈现，不要用 JSON 对象。
3. 有图表时，把图表配置放在文末的 ```echarts 代码块中（格式见下方）。
4. 有追问建议时，把建议列表放在文末的 ```suggestions 代码块中（格式见下方）。
5. 严禁向用户输出裸 JSON 对象。

echarts 代码块格式：
```echarts
{"type":"bar|line|scatter|pie","title":"图表标题","xAxis":["标签1","标签2"],"series":[{"name":"系列名","data":[值1,值2]}]}
```

suggestions 代码块格式（**规范定义**，解析器按此实现）：
- 围栏标识：起始行精确为 \`\`\`suggestions（小写），结束行 \`\`\`。
- **围栏内正文**（去掉首尾空白后）**必须是一个合法 JSON 数组**，且：
  - 数组元素**全部为 string**，每个 string 为一条可点击的追问文案；
  - 元素顺序即 UI 展示顺序；
  - 不允许在 JSON 数组前后夹杂其它文字、注释或多余逗号；
  - 字符串内容可含中文、标点；若需前缀如「可追问：」由模型写在字符串内。
- 示例（多行排版仅便于阅读，解析时整段视为 JSON）：
```suggestions
[
  "可追问：问题1",
  "可追问：问题2",
  "可追问：[绘图] 生成图表"
]
```
- **非规范示例（禁止）**：围栏内写纯文本列表、Markdown 列表、或非 JSON 内容——前端可拒绝解析该块并记录告警。

（上文「新提示词结构」大段模板在编辑时注意：内嵌 \`\`\`echarts / \`\`\`suggestions 示例时，外层不要用同一套围栏包裹全文，以免 Markdown 嵌套解析错乱；可拆成「角色/规则」正文 + 独立小节示例。）

#### 改动 3：FC 循环中 SSE 推送工具执行状态

在 `runFunctionCalling()` 中，每次工具执行前后，通过 `options.streamFormatCallbacks.onDelta` 推送工具状态事件：

```javascript
// 工具开始前推送（现有代码中 executeByName 调用处）
if (options.streamFormatCallbacks?.onDelta) {
  options.streamFormatCallbacks.onDelta('', { phase: 'tool_start', toolName: tc.function.name });
}

// 工具完成后推送
if (options.streamFormatCallbacks?.onDelta) {
  options.streamFormatCallbacks.onDelta('', { phase: 'tool_end', toolName: tc.function.name });
}
```

#### 改动 4：FC 循环中删除「最终格式化」LLM 调用

当前 `runFunctionCalling()` 在 FC 循环结束后，若 `finalContent` 不是有效 JSON，会走 fallback 逻辑。新架构中：
- LLM 直接输出 Markdown，不需要解析 JSON
- 删除 `extractFirstJson()`、`normalizeReplyContent()` 在 FC 路径中的调用
- `finalContent` 直接作为 Markdown 字符串返回给 `chatService`

#### 改动 5：`run()` 返回值结构变化

```javascript
// 改前：返回 ReplyContent JSON 对象
// { overview, keyNumbers, attentionPoints, followUpSuggestions, ... }

// 改后：返回 Markdown 字符串对象
// { markdownContent: string, _intentType, _intentResolvedBy, _toolMeta }
```

`chatService.js` 接收后，将 `markdownContent` 存入 `chat_messages.content`，不再存 JSON 到 `reply_content`（或将 `reply_content` 设为 null）。

---

### 3.2 文件：`TOT_backend/server/services/chatService.js`

#### 改动：SSE done 事件结构简化

当前 `done` 事件携带完整 `replyContent` JSON。新架构中：

```javascript
// 改前的 done payload：
{ messageId, replyContent: { overview, keyNumbers, ... }, responseTime, contextId, timestamp }

// 改后的 done payload（data 层）：
{ messageId, responseTime, contextId, timestamp }
// 可选：markdownContent —— 仅当希望 done 再带一份完整落库正文时使用（与 DB 一致，便于对账）；非必须。
```

#### 评审补丁：`done` 与前端「最终渲染」以谁为准

- **正文真源**：流式过程中，所有 `phase === 'content'`（及兼容旧客户端时默认视为 content）的 `delta` 事件里的 `text` 片段，在前端累积为 `streamContent`。**最终气泡展示应以该累积结果为准**（用户停止生成时亦然，见下节断开处理）。
- **`onComplete(done)` 的职责**：用 `done.data.messageId` 等元数据更新消息对象；将 **`streamContent` 赋给 `msg.content` 并设 `msg.done = true`**。不要假设 `done` 里必有完整正文可用；若实现上在 `done` 中附带 `markdownContent`，可与 `streamContent` 做一次一致性校验或作为补全（例如中途重连），但**不应**作为唯一渲染来源。
- **意图**：避免「payload 改了但不知道用哪个字段触发最终渲染」的歧义。

#### 评审补丁：客户端中止与 `req.on('close')`

当前 `sendMessageStream` 若不在 HTTP 层感知客户端断开，会出现：前端 `AbortController` 已取消 `fetch`，而后端仍继续向 LLM 拉流、甚至仍写入完整 assistant 消息。

**必须**在 `sendMessageStream`（或 `chatAgentRunner.run` 的统一入口）中：

1. 创建 `AbortController`，将其 `signal` 传入所有下游可取消的异步调用（OpenAI/DeepSeek 流式请求等）。
2. 在 **`req.on('close')`**（并可辅以 **`req.on('aborted')`**，视 Node/Express 版本而定）中 `abort()` 该 controller。
3. **产品行为**：用户点击「停止」后，已推送的 delta 保留；是否将**当前已生成片段**写入 `chat_messages.content`（半成品）由实现选定，须在验收中写清（推荐：**写入**，便于历史与重进会话一致；`intent_type` 等照常）。

#### 改动：历史消息返回格式（`getHistory` 契约修正）

**现状问题**：`getHistory` 对 `assistant` 行仅执行 `replyContent = JSON.parse(r.content)`，且**不把** `r.content` 赋给 `content`。FC 模式下 `content` 列为 Markdown 时，`JSON.parse` 失败会得到 **`replyContent: null`**，同时 **`content` 仍缺省** → 前端历史列表对该条 assistant **空白**。

**修正契约**（`GET /history` 每条消息）：

| role | `content` | `replyContent` |
|------|-----------|----------------|
| `user` | 用户原文 | `undefined` |
| `assistant` | **始终**为 DB `chat_messages.content` 原始字符串（FC 下为 Markdown；intent_routing 下若仅存 JSON 字符串，则原样返回便于调试） | 仅当 `content` 能解析为** legacy `ReplyContent` JSON** 且结构合法时填充对象；**否则必须为 `null`** |

前端分支：**`replyContent != null`** → 旧版卡片渲染；**否则** → 用 `content` 走 `MarkdownRenderer`（与 §六 一致）。

#### 文件：`TOT_backend/server/utils/chatHistoryCompress.js`（评审补丁）

**现状问题**：`compressAssistantContent` 假定 `rawContent` 为 `ReplyContent` JSON；FC 后 assistant 存 Markdown 时，`JSON.parse` 失败走 `catch` 虽返回原串，但**长 Markdown 会撑爆多轮上下文**。

**修正要求**：

1. **优先**尝试 `JSON.parse`：若得到带 `overview` 的 legacy 对象，保持现有摘要逻辑（overview + 少量 keyNumbers）。
2. **否则**视为 Markdown：做**确定性截断**（例如按 Unicode 码点截取前 **N** 字符，N 建议 1500～2500，可配置），可选附加省略标记 `[…]`；不得静默返回空串。
3. `chatAnswerService` / `sendMessage` / `regenerateLastAssistant` 等所有拼装 `history` 的路径**统一**调用该函数，避免一处漏改。

---

### 3.3 文件：`TOT_backend/server/services/chatAnswerService.js`

**不修改**。保留原样作为 `intent_routing` 兜底模式的格式化服务。FC 路径不再调用此文件。

---

## 四、SSE 协议新增事件

前后端约定的 SSE delta 事件 `phase` 字段新增值：

| phase 值 | 方向 | payload 说明 | 前端行为 |
|----------|------|-------------|---------|
| `reasoning` | 已有 | DeepSeek 思考 token | 折叠「思考过程」|
| `content` | 已有 | 正式 Markdown 内容 | 流式渲染 |
| `tool_start` | **新增** | `text` 为工具名（如 `getOverviewData`） | 显示工具执行指示器 |
| `tool_end` | **新增** | `text` 为工具名 | 隐藏工具执行指示器 |

工具名到中文显示的映射（前端维护）：

```typescript
const TOOL_DISPLAY_NAMES: Record<string, string> = {
  getOverviewData: '查询培训进度总览',
  getTaskListData: '查询任务列表',
  getWarningsData: '查询预警门店',
  getRegionDetailData: '查询区域详情',
  getStoreDetailData: '查询门店详情',
  runAnalytics: '执行统计分析',
};
```

---

## 五、前端改动详细说明

### 5.1 新建组件：`TOT_frontend/src/views/executive/components/MarkdownRenderer.vue`

**职责**：接收流式 Markdown 字符串，实时渲染。解析特殊代码块（echarts / suggestions）。

**Props 接口**：
```typescript
interface Props {
  content: string;        // Markdown 文本（含特殊代码块）
  streaming?: boolean;    // 为 true 时显示光标动画
}

// Emits
interface Emits {
  (e: 'suggestion-click', text: string): void;
}
```

**内部渲染逻辑**：
1. 用正则提取所有 ` ```echarts ` 和 ` ```suggestions ` 代码块，替换为占位符
2. 用 `markdown-it` 渲染剩余 Markdown 为 HTML（`v-html` 渲染，需配合 DOMPurify 做 XSS 过滤）
3. 在占位符位置插入 `<AiChartRenderer>` 和追问气泡按钮组

**依赖安装**：
```bash
# 在 TOT_frontend 目录下
npm install markdown-it dompurify
npm install --save-dev @types/markdown-it @types/dompurify
```

### 5.2 修改文件：`TOT_frontend/src/views/executive/index.vue`

#### 改动 1：替换 AI 消息渲染区块

```vue
<!-- 改前：exec-structured 卡片区块（约第 231-334 行）整块替换为 -->
<MarkdownRenderer
  v-if="msg.streamContent || msg.content"
  :content="msg.streamContent || msg.content"
  :streaming="!msg.done"
  @suggestion-click="fillComposerWithSuggestion"
/>
```

#### 改动 2：新增停止生成按钮

```vue
<!-- 发送按钮（改前）：-->
<n-button type="primary" :loading="isSending" @click="handleSend">发送</n-button>

<!-- 改后：isSending 时变为停止按钮 -->
<n-button
  v-if="!isSending"
  type="primary"
  :disabled="!inputValue.trim() || isLoadingHistory"
  @click="handleSend"
>发送</n-button>
<n-button
  v-else
  type="default"
  @click="handleStop"
>
  <template #icon><n-icon><StopOutlined /></n-icon></template>
  停止
</n-button>
```

#### 改动 3：添加工具执行状态指示器

在 AI 消息气泡中，`streaming` 状态下显示当前工具执行进度：

```vue
<div v-if="msg.activeToolName" class="tool-indicator">
  <n-spin size="small" />
  <span>{{ TOOL_DISPLAY_NAMES[msg.activeToolName] || '正在查询…' }}</span>
</div>
```

#### 改动 4：ChatMessage 接口更新

```typescript
interface ChatMessage {
  id?: string;
  role: 'user' | 'ai';
  content: string;
  streamContent?: string;   // 新增：流式过程中的 Markdown 累积文本
  done?: boolean;           // 新增：流式是否完成
  activeToolName?: string;  // 新增：当前正在执行的工具名
  // 以下字段仅 intent_routing 兜底模式保留，FC 模式不使用
  replyContent?: ReplyContent | null;
  thinking?: string;
  jsonStream?: string;
  partialReply?: ReplyContent | null;
  // 以下字段保留
  userFeedback?: 'like' | 'dislike' | null;
  isRegenerating?: boolean;
  isFeedbackLoading?: boolean;
}
```

#### 改动 5：handleSend / handleStop 逻辑更新

```typescript
// 新增 abortController ref
const abortController = ref<AbortController | null>(null);

const handleStop = () => {
  abortController.value?.abort();
  abortController.value = null;
  isSending.value = false;
  // 将当前流式消息标记为完成（保留已生成内容）
  const lastMsg = messages.value[messages.value.length - 1];
  if (lastMsg?.role === 'ai') {
    lastMsg.done = true;
    lastMsg.activeToolName = undefined;
  }
};

// handleSend 中：
// 1. 创建 abortController
// 2. 传递给 streamExecutiveChatMessage（通过 signal 参数）
// 3. delta 回调中处理 tool_start / tool_end 事件（更新 activeToolName）
// 4. delta 回调中处理 content 事件（累积 streamContent）
// 5. done 回调：用 done.data.messageId 等更新状态；将已累积的 streamContent 写入 msg.content，设置 msg.done = true（不要依赖 done 携带完整正文，见 §3.2「done 与前端最终渲染」）
```

### 5.3 修改文件：`TOT_frontend/src/api/chat/index.ts`

#### 改动 1：SendMessageResult 简化

```typescript
// 改前：
export interface SendMessageResult {
  messageId: string;
  replyContent: ReplyContent;  // 移除（FC 模式不再需要）
  responseTime: number;
  contextId: string;
  timestamp: string;
}

// 改后：
export interface SendMessageResult {
  messageId: string;
  markdownContent?: string;   // 可选：服务端落库后的完整内容（用于 regenerate）
  responseTime: number;
  contextId: string;
  timestamp: string;
}
```

#### 改动 2：streamExecutiveChatMessage 支持 AbortSignal

```typescript
export const streamExecutiveChatMessage = async (
  sessionId: string,
  content: string,
  onMessage: (chunk: { text: string; phase?: string; toolName?: string }) => void,
  onComplete: (data: SendMessageResult) => void,
  onError: (error: unknown) => void,
  signal?: AbortSignal   // 新增
) => { ... };
```

### 5.4 修改文件：`TOT_frontend/src/utils/execChatStreamParts.ts`

FC 模式下，流式内容直接是 Markdown 文本，不需要解析 JSON。  
**保留现有函数**（供 intent_routing 兜底模式使用），**不删除**。  
新增一个工具函数用于从 Markdown 中提取 echarts/suggestions 代码块：

```typescript
// 新增函数
export function extractSpecialBlocks(markdown: string): {
  cleanMarkdown: string;                    // 去除特殊块后的纯 Markdown
  echartsBlocks: string[];                  // echarts JSON 字符串数组
  suggestions: string[];                    // 追问建议文本数组
} { ... }
```

---

## 六、数据库影响

### chat_messages 表

| 字段 | 改动 | 说明 |
|------|------|------|
| `content` | 存储内容变化 | FC 模式下存 Markdown 文本（原来存空字符串或摘要） |
| `reply_content` | 不变（仍存 JSON） | FC 模式下为 null；intent_routing 模式下仍有值 |

**无需 schema 迁移**，因为 `content` 和 `reply_content` 字段已存在。

### 历史记录加载

`GET /history` 返回的消息：
- FC 模式消息：`content` = Markdown 文本，`replyContent` = null → 前端用 `MarkdownRenderer` 渲染
- intent_routing 模式消息：`content` = 摘要，`replyContent` = JSON → 前端用旧卡片渲染（兼容）

前端根据 `replyContent` 是否为 null 判断用哪种渲染器。

---

## 六-B、补丁：四个额外改动点

> 以下改动由第二轮 spec 审查补入，AI 实现时与主流程同等优先级。

### 补丁 1：`regenerate` 端点适配 Markdown（`chatService.js`）

**问题**：`regenerateLastAssistant()` 调用 `chatAgentRunner.run()` → 拿到 `markdownContent`，存入 `chat_messages.content`。但 `regenerate` 路由返回的是**非流式 JSON 200**（04 §6.7），当前格式为 `{ messageId, replyContent, ... }`。改造后 `replyContent` 为 null，前端收到 `done` 时需用 `markdownContent` 驱动渲染。

**修正要求**：

```javascript
// chatService.js regenerateLastAssistant() 返回结构（改后）：
{
  messageId: string,
  markdownContent: string,   // 新增：Markdown 正文
  replyContent: null,        // FC 模式下为 null
  responseTime: number,
  contextId: string,
  timestamp: string,
}
```

前端 `handleRegenerate`（`index.vue` 约 L1007）改为：
```typescript
// 改前：从 result.replyContent 取内容
// 改后：
messages.value[index] = {
  id: result.messageId,
  role: 'ai',
  content: result.markdownContent || '',
  done: true,
  replyContent: result.replyContent ?? null,  // null → MarkdownRenderer
  userFeedback: null,
};
```

### 补丁 2：`streamSsePostJson` AbortSignal 集成（向后兼容）

**问题**：`streamSsePostJson`（`TOT_frontend/src/utils/http/ssePostStream.ts` 或同目录）是共享工具，也被 dashboard 智能洞察调用。若直接加 `signal` 参数改函数签名可能破坏已有调用者。

**修正要求**：
- `signal` 作为 **options 对象的可选字段**传入，不改函数主签名：
  ```typescript
  // 改前（示意）：
  streamSsePostJson({ path, body, onDelta, onDone, onError, fallbackErrorMessage })
  // 改后：
  streamSsePostJson({ path, body, onDelta, onDone, onError, fallbackErrorMessage, signal?: AbortSignal })
  ```
- 内部 `fetch(url, { method: 'POST', signal, ... })` 传入该 signal
- 已有调用者（dashboard）不传 `signal`，行为不变

`streamExecutiveChatMessage`（`api/chat/index.ts`）将 `AbortController.signal` 透传进 `streamSsePostJson`。

### 补丁 3：前端 `handleStop` 必须触发 fetch abort

**问题**：`handleStop` 只设 `isSending.value = false`，不会关闭底层 SSE 连接；浏览器继续缓冲后端数据流，后端也继续拉 LLM。

**修正要求**（`index.vue handleStop`）：
```typescript
const handleStop = () => {
  // 1. abort fetch（通过 AbortController）
  abortController.value?.abort();
  abortController.value = null;
  // 2. 更新 UI 状态
  isSending.value = false;
  const lastMsg = messages.value[messages.value.length - 1];
  if (lastMsg?.role === 'ai') {
    // 3. 以当前 streamContent 为准，标记完成
    lastMsg.content = lastMsg.streamContent || lastMsg.content || '';
    lastMsg.done = true;
    lastMsg.activeToolName = undefined;
    lastMsg.streamContent = undefined;
  }
};
```

`AbortController.abort()` → `fetch` 抛出 `AbortError` → `streamSsePostJson` 的 `onError` 被调用 → 后端 `req.on('close')` 触发 → 后端 AbortController abort → LLM 拉流中止。整条链路必须贯通。

**前端对 `AbortError` 的处理**：`onError` 回调中检查 `err?.name === 'AbortError'`，静默处理（不弹错误 toast），因为这是用户主动停止。

### 补丁 4：`chatAgentRunner.js` 「绘图」快捷路径 JSON.parse 失效

**问题**：`runIntentRouting()` 第 199 行：
```javascript
const lastContent = JSON.parse(lastValidMsg.content);
if (lastContent.statisticsProvenance?.analysisType) { ... }
```
FC 模式下 `lastValidMsg.content` 是 Markdown，`JSON.parse` 抛错，走 `catch` 静默跳过 → 绘图快捷路径失效，需重新调用工具（性能退化，但不崩溃）。

**修正要求**：
- FC 模式（`markdownContent`）中，`visualizationSummary` 和 `analysisType` 改从 `sessionState` 的缓存记录中读取，不再依赖 `JSON.parse(content)`
- 具体：`chatSessionStateService.getLatestByIntent(sessionId, 'analytics_query')` 已可返回上一轮 `toolResult`，从中提取 `analysisType`；这个路径本身已在代码 L209-215 存在，只需去掉前面依赖 `JSON.parse` 的分支
- 修改后逻辑：直接从 sessionState 取 `analysisType`，跳过 JSON.parse 的历史消息解析

---

## 七、实现顺序（最小可用优先）

按依赖顺序，AI 实现时应严格遵循此顺序：

### Phase 1：后端（4–5 个文件改动）

1. **`chatAgentRunner.js`**
   - 改默认模式为 `function_calling`
   - 重写 FC `SYSTEM_PROMPT`（三段式，含 echarts/suggestions 格式规范；**禁止**整段回答要求 JSON）
   - FC 循环中添加 `tool_start` / `tool_end` SSE 推送
   - FC 路径删除 `chatAnswerService.format()` 调用
   - `run()` 返回值改为 `{ markdownContent, _intentType, _toolMeta }`
   - 支持传入 **`AbortSignal`**，在 signal abort 时停止拉流并向上抛出/返回可识别错误（供 `chatService` 决定是否半成品落库）

2. **`chatService.js`**
   - 接收 `markdownContent`，存入 `chat_messages.content`
   - `sendMessageStream`：`req.on('close')`（及必要时 `aborted`）联动 **AbortSignal**
   - `done` 事件 payload 简化（移除 `replyContent`）；文档约定前端以 delta 累积为正文真源
   - **`getHistory`**：assistant 行必须返回 `content` + 按 legacy JSON 条件填充的 `replyContent`（见 §3.2）

3. **`chatHistoryCompress.js`**
   - 扩展 Markdown 分支截断逻辑，避免 FC 历史撑爆上下文

### Phase 2：前端（3-4 个文件改动）

4. **新建 `MarkdownRenderer.vue`**
   - markdown-it 渲染
   - 解析 echarts / suggestions 代码块（suggestions 须符合本文 JSON 数组规范）
   - streaming 光标动画

5. **`api/chat/index.ts`**
   - `SendMessageResult` 接口更新
   - `streamExecutiveChatMessage` 增加 `AbortSignal` 参数

6. **`utils/execChatStreamParts.ts`**
   - 新增 `extractSpecialBlocks()` 函数

7. **`views/executive/index.vue`**
   - 替换消息渲染为 `MarkdownRenderer`
   - 停止按钮逻辑
   - 工具执行状态指示器
   - delta 回调处理 `tool_start` / `tool_end`
   - `ChatMessage` 接口更新

---

## 八、验收标准

| 场景 | 期望行为 |
|------|---------|
| 发送「Q1完成率？」 | 流式输出 Markdown 文本，含表格数据，无 JSON 卡片 |
| 发送「华东区怎么样」 | 先出现「正在查询区域详情…」指示器，然后流式 Markdown |
| 发送「帮我看看最差的5家门店」 | 工具执行指示器出现，Markdown 表格列出门店排名 |
| 数据分析类问题 | Markdown 末尾有 ```echarts``` 块，前端渲染为图表 |
| 点击停止按钮 | 生成立即停止，已生成内容保留；后端停止继续拉流（`AbortSignal` + `req.on('close')`） |
| `GET /history`（FC 消息） | assistant 行 `content` 有 Markdown，`replyContent` 为 null，列表不空白 |
| 上轮问华东，本轮问「再看华南」 | AI 自动继承上下文，不要求用户重复说明 |
| 历史消息加载 | FC 模式消息用 MarkdownRenderer 渲染，旧消息用卡片兼容渲染 |
| intent_routing 兜底 | 设置 `CHAT_AGENT_MODE=intent_routing` 后，旧卡片渲染正常工作 |

---

## 九、不在本期范围内（二期）

- 完整对话状态机（`IDLE → CLARIFYING → QUERYING → ANSWERING`）
- 斜杠命令 `/` 快捷输入
- 消息编辑功能
- 图表交互增强（ECharts dataZoom 等）

---

## 十、文件改动速查表（给 AI 编码时用）

| 文件路径 | 改动类型 | 核心改动点 |
|---------|---------|-----------|
| `TOT_backend/server/services/chatAgentRunner.js` | 修改 | 默认 FC、重写提示词（禁 JSON 正文）、tool_start/end 推送、删除 format 调用、AbortSignal 支持、绘图快捷路径去 JSON.parse |
| `TOT_backend/server/services/chatService.js` | 修改 | done 简化、存 markdownContent、`getHistory` 双字段契约、`req.on('close')` 中止、regenerate 返回 markdownContent |
| `TOT_backend/server/utils/chatHistoryCompress.js` | 修改 | Markdown 截断分支（JSON.parse 失败时截前 1500-2500 字符） |
| `TOT_frontend/src/views/executive/components/MarkdownRenderer.vue` | **新建** | Markdown 渲染 + echarts/suggestions 解析 |
| `TOT_frontend/src/utils/http/ssePostStream.ts`（或同路径） | 修改 | options 对象加可选 `signal?: AbortSignal`，向后兼容 |
| `TOT_frontend/src/api/chat/index.ts` | 修改 | SendMessageResult 更新、透传 AbortSignal |
| `TOT_frontend/src/utils/execChatStreamParts.ts` | 修改 | 新增 extractSpecialBlocks() |
| `TOT_frontend/src/views/executive/index.vue` | 修改 | 替换渲染、停止按钮（含 fetch abort + AbortError 静默）、工具状态指示器、handleRegenerate 用 markdownContent |
