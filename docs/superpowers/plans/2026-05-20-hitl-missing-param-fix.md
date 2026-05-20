# HITL 缺参反问 + 任务状态映射修复

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修两件事：(1) `list_task_progress` 状态映射 `active`→`dispatched`；(2) FC LLM 缺参时主动列任务让用户选，走 HITL 流程而非给泛化回复。

**Architecture:** 不改管道、不改工具接口、不改数据库。只改 `fc_agent.js` prompt 和 `tool_list_task_progress.js` 一行映射。

**Tech Stack:** Node.js, LangGraph.js, DeepSeek-chat

---

## Task 1: 修复 list_task_progress 状态映射

**Files:**
- Modify: `TOT_backend/server/chat_tools/tool_list_task_progress.js`

- [ ] **Step 1: 改一行状态映射**

MySQL `task_publish.publish_status` 的取值是 `dispatched`/`ended`，没有 `active`。工具里 `status='active'` 永远查不到数据。

将 handler 开头的 statuses 映射改为：

```js
// 旧:
const statuses = args.status === 'ended'
  ? ['ended'] : args.status === 'all'
  ? ['active', 'ended'] : ['active'];

// 新:
const statuses = args.status === 'ended'
  ? ['ended'] : args.status === 'all'
  ? ['dispatched', 'ended'] : ['dispatched'];
```

- [ ] **Step 2: 运行 node --check**

```bash
cd TOT_backend/server && node --check chat_tools/tool_list_task_progress.js
```

Expected: 无输出。

- [ ] **Step 3: 验证工具直接调用**

```bash
cd TOT_backend/server && node -e "
require('dotenv').config({ path: '../.env' });
const chatToolsService = require('./services/chatToolsService');
(async () => {
  const r = await chatToolsService.executeByName('list_task_progress', {}, { type: 'national', userRoles: ['executive'] });
  console.log('success:', r.success, '| count:', r.data?.total_count, '| first:', r.data?.rows?.[0]?.task_name);
  process.exit(r.success ? 0 : 1);
})().catch(err => { console.error(err.message); process.exit(1); });
"
```

Expected: `success: true | count: 4 | first: 【Mock】iPad mini 常规周培训`

- [ ] **Step 4: 提交**

```bash
git add TOT_backend/server/chat_tools/tool_list_task_progress.js
git commit -m "fix: map status 'active' to 'dispatched' in list_task_progress"
```

---

## Task 2: 更新 FC LLM prompt — 缺参时走 HITL 流程

**Files:**
- Modify: `TOT_backend/server/prompts/fc_agent.js`

- [ ] **Step 1: 重写 ERROR HANDLING 段**

当前的 ERROR HANDLING 只说"检查错误、修复参数、有一次重试机会"。需要加入 HITL 引导逻辑。

将 `constraints` 段里的 `ERROR HANDLING` 部分替换为：

```js
const toolReference = `TOOL SELECTION:
You have access to a set of data retrieval tools. Each tool's description tells you when to use it. Read the descriptions carefully and pick the right tool(s).

CRITICAL — SHORT REPLIES IN CONTEXT:
If the user's latest message is very short (e.g. "可以", "好的", "需要", "行", "对", "是的") and the conversation history shows you previously asked a question or offered to look up data, the user is CONFIRMING your suggestion. Call the appropriate tool based on what you offered in the previous turn.

CRITICAL — PARAMETER EXTRACTION:
The user's message may contain task names (e.g. "iPhone 17 新品培训"), region names (e.g. "华东"), or store names. Extract these directly as tool parameters. Use named parameters. If a specific entity was pre-extracted (shown in PREDICTED ENTITIES), use it directly unless the user's query contradicts it.

ERROR HANDLING — HITL FOR MISSING PARAMETERS:
When a tool returns an error about missing required parameters (MISSING_PARAM, INVALID_PARAMETERS, or a message asking to specify a task/product):

1. **First, try to infer from context.** Check PREDICTED ENTITIES, the user's original message, and conversation history. If you can fill the missing parameter from context, retry the tool call ONCE with the inferred value.

2. **If the missing parameter is task_id/taskName and you cannot infer it:**
   a. Call \`list_task_progress\` to get the list of available tasks.
   b. Output a natural language message listing the tasks as numbered options, asking the user to pick one. Example:
      "请问您要查询哪个任务？当前进行中的任务有：
      1. 【Mock】iPad mini 常规周培训
      2. 【Mock】Apple Watch 销售技巧
      请告诉我序号或任务名称。"
   c. Do NOT call any more tools after this — just output this question and wait.

3. **If the missing parameter is something else (alert_level, dimension, etc.):**
   Ask the user ONE clear question to clarify. Do not guess.

4. **Do NOT retry the same tool with the same broken args.** If you already tried to fix and it still failed, go to step 2 or 3.

PARALLEL TOOL CALLS:
If you need data from multiple independent tools, call them all in a single response. Parallel calls count as ONE step.`;
```

- [ ] **Step 2: 运行 node --check**

```bash
cd TOT_backend/server && node --check prompts/fc_agent.js
```

Expected: 无输出。

- [ ] **Step 3: 提交**

```bash
git add TOT_backend/server/prompts/fc_agent.js
git commit -m "feat: add HITL flow for missing params in FC agent prompt"
```

---

## Task 3: 端到端验证

- [ ] **Step 1: 重启服务**

```bash
pkill -f "node.*app.js" 2>/dev/null; sleep 2
cd TOT_backend/server && node app.js &
sleep 3
curl -s http://localhost:3000/api/health
```

- [ ] **Step 2: 测试"进行中的任务"**

```bash
cd TOT_backend/server && node -e "
require('dotenv').config({ path: '../.env' });
const chatCrud = require('./modules/dashboard/crud/chatCrud');
const { nanoid } = require('nanoid');
const sid = 'test-' + nanoid(6);
await chatCrud.createSession({ id: sid, userId: '1', entryType: 'executive', scopeType: 'national' });

const { buildGraph } = require('./agent/graph/graph');
const { SqliteSaver } = require('@langchain/langgraph-checkpoint-sqlite');
const app = (buildGraph()).compile({ checkpointer: SqliteSaver.fromConnString(':memory:') });
const state = await app.invoke({
  userMessage: '现在有哪些进行中的培训任务？', sessionId: sid, userId: '1', regionScope: { type: 'national' }, messages: []
}, { configurable: { thread_id: sid }, recursionLimit: 60 });

const reply = state.reply_markdown || state.finalResponse || '';
console.log('回复:', reply.slice(0, 500));
console.log(reply.includes('iPad mini') ? '✅ 任务列表正确' : '❌ 未列出任务');
process.exit(0);
"
```

Expected: 回复里列出任务名称。

- [ ] **Step 3: 测试"缺参反问"**

```bash
cd TOT_backend/server && node -e "
require('dotenv').config({ path: '../.env' });
const chatCrud = require('./modules/dashboard/crud/chatCrud');
const { nanoid } = require('nanoid');
const sid = 'test-' + nanoid(6);
await chatCrud.createSession({ id: sid, userId: '1', entryType: 'executive', scopeType: 'national' });

const { buildGraph } = require('./agent/graph/graph');
const { SqliteSaver } = require('@langchain/langgraph-checkpoint-sqlite');
const app = (buildGraph()).compile({ checkpointer: SqliteSaver.fromConnString(':memory:') });
const state = await app.invoke({
  userMessage: '有哪些门店需要重点关注？', sessionId: sid, userId: '1', regionScope: { type: 'national' }, messages: []
}, { configurable: { thread_id: sid }, recursionLimit: 60 });

const reply = state.reply_markdown || state.finalResponse || '';
console.log('回复:', reply.slice(0, 500));
const shouldAsk = reply.includes('哪个任务') || reply.includes('选择') || reply.includes('序号');
console.log(shouldAsk ? '✅ LLM 在反问用户选任务' : '⚠️ 未触发反问');
process.exit(0);
"
```

Expected: LLM 列出任务让用户选择，而不是直接报错或给泛化回复。

- [ ] **Step 4: 提交**（如有新文件）

```bash
git add -A && git commit -m "test: verify task list fix and HITL missing param flow"
```

---

## 不改的文件

- Agent 管道 (`SafetyGateway`, FC 循环, graph.js)
- 工具接口 (`fetch_alert_persons` 的 required 字段不改)
- 数据库 (MySQL, SQLite)
- 前端
