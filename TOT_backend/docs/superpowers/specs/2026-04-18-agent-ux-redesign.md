# Executive Chat Agent 重构设计文档

**日期：** 2026-04-18  
**状态：** 已批准，待实现  
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

当前提示词的问题：
- 没有明确的多轮上下文继承规则（不知道从历史中推断实体）
- 输出格式要求（JSON）和业务规则混在一起
- 没有「主动澄清」指令

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

suggestions 代码块格式：
```suggestions
["可追问：问题1","可追问：问题2","可追问：[绘图] 生成图表"]
```
```

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

// 改后的 done payload：
{ messageId, responseTime, contextId, timestamp }
// replyContent 不再需要，Markdown 内容已通过 delta 事件流式传输完毕
```

#### 改动：历史消息返回格式

`GET /history` 接口返回的 `ChatHistoryItem` 中：
- `content` 字段：存储 Markdown 文本（原来存纯文本摘要）
- `replyContent` 字段：仍保留（用于 intent_routing 兜底模式的历史消息），FC 模式下为 null

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
// 5. done 回调中将 streamContent 转为 content，设置 done = true
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

## 七、实现顺序（最小可用优先）

按依赖顺序，AI 实现时应严格遵循此顺序：

### Phase 1：后端（2-3 个文件改动）

1. **`chatAgentRunner.js`**
   - 改默认模式为 `function_calling`
   - 重写 FC `SYSTEM_PROMPT`（三段式，含 echarts/suggestions 格式规范）
   - FC 循环中添加 `tool_start` / `tool_end` SSE 推送
   - FC 路径删除 `chatAnswerService.format()` 调用
   - `run()` 返回值改为 `{ markdownContent, _intentType, _toolMeta }`

2. **`chatService.js`**
   - 接收 `markdownContent`，存入 `chat_messages.content`
   - `done` 事件 payload 简化（移除 `replyContent`）

### Phase 2：前端（3-4 个文件改动）

3. **新建 `MarkdownRenderer.vue`**
   - markdown-it 渲染
   - 解析 echarts / suggestions 代码块
   - streaming 光标动画

4. **`api/chat/index.ts`**
   - `SendMessageResult` 接口更新
   - `streamExecutiveChatMessage` 增加 `AbortSignal` 参数

5. **`utils/execChatStreamParts.ts`**
   - 新增 `extractSpecialBlocks()` 函数

6. **`views/executive/index.vue`**
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
| 点击停止按钮 | 生成立即停止，已生成内容保留 |
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
| `TOT_backend/server/services/chatAgentRunner.js` | 修改 | 默认 FC、重写提示词、tool_start/end 推送、删除 format 调用 |
| `TOT_backend/server/services/chatService.js` | 修改 | done 事件简化、存 markdownContent |
| `TOT_frontend/src/views/executive/components/MarkdownRenderer.vue` | **新建** | Markdown 渲染 + echarts/suggestions 解析 |
| `TOT_frontend/src/api/chat/index.ts` | 修改 | SendMessageResult 更新、AbortSignal 支持 |
| `TOT_frontend/src/utils/execChatStreamParts.ts` | 修改 | 新增 extractSpecialBlocks() |
| `TOT_frontend/src/views/executive/index.vue` | 修改 | 替换渲染、停止按钮、工具状态指示器 |
