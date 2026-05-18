# LangGraph Agent 重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构 macstudio 分支 agent/graph/ 层：拆分 nodes.js、标准化 LLM 调用、删除死代码、加测试

**Architecture:** 14 个节点各居一文件，共享 helper 进 shared/，llm.js 管理 ChatOpenAI 单例，Router 用 withStructuredOutput

**Tech Stack:** Node.js, LangGraph.js, @langchain/openai, @langchain/core, better-sqlite3, Jest

---

## Phase 0: 准备工作

### Task 0.1: 确认分支和依赖

**Files:**
- Check: `package.json`

- [ ] **Step 1: 确认在 macstudio 分支，依赖完整**

Run:
```bash
git branch --show-current && npm ls @langchain/langgraph @langchain/openai @langchain/core zod 2>/dev/null
```

If zod missing:
```bash
npm install zod
```

- [ ] **Step 2: Commit 当前状态**

```bash
git add -A && git status
```

---

## Phase 1: 拆分 nodes.js（零逻辑变更）

### Task 1.1: 创建 `shared/spanHelper.js`

**Files:**
- Create: `TOT_backend/server/agent/graph/shared/spanHelper.js`
- Read: `TOT_backend/server/agent/graph/nodes.js:11-19`

- [ ] **Step 1: 提取 startNodeSpan 到独立文件**

```js
// TOT_backend/server/agent/graph/shared/spanHelper.js
'use strict';

const { getClient, endSpan } = require('../../../utils/tracer');

const startNodeSpan = (state, name, input) => {
  const traceId = state.meta_trace_id;
  if (!traceId) return null;
  try {
    const client = getClient();
    return client ? client.span({ traceId, name, input }) : null;
  } catch { return null; }
};

module.exports = { startNodeSpan };
```

- [ ] **Step 2: 在 nodes.js 顶部确认 import 替换后逻辑不变**

不忙改 nodes.js，Phase 1 所有 shared 文件先建好，最后一次性改 graph.js 的 import。

- [ ] **Step 3: Commit**

```bash
git add TOT_backend/server/agent/graph/shared/spanHelper.js
git commit -m "refactor: extract startNodeSpan to shared/spanHelper.js"
```

### Task 1.2: 创建 `shared/memoryBlock.js`

**Files:**
- Create: `TOT_backend/server/agent/graph/shared/memoryBlock.js`
- Read: `TOT_backend/server/agent/graph/nodes.js:154-159`

- [ ] **Step 1: 写 renderMemoryBlock**

```js
// TOT_backend/server/agent/graph/shared/memoryBlock.js
'use strict';

const renderMemoryBlock = (snippets) => {
  if (!Array.isArray(snippets) || snippets.length === 0) return "";
  const lines = snippets.map(s => s?.text).filter(Boolean);
  if (lines.length === 0) return "";
  return `[用户历史偏好/已知记忆]\n${lines.join('\n')}`;
};

module.exports = { renderMemoryBlock };
```

- [ ] **Step 2: Commit**

```bash
git add TOT_backend/server/agent/graph/shared/memoryBlock.js
git commit -m "refactor: extract renderMemoryBlock to shared/memoryBlock.js"
```

### Task 1.3: 创建 `shared/entities.js`

**Files:**
- Create: `TOT_backend/server/agent/graph/shared/entities.js`
- Read: `TOT_backend/server/agent/graph/nodes.js:1020-1035`

- [ ] **Step 1: 写 flattenEntitiesForRepair**

```js
// TOT_backend/server/agent/graph/shared/entities.js
'use strict';

const flattenEntitiesForRepair = (entities) => {
  const out = {};
  for (const [k, v] of Object.entries(entities || {})) {
    if (v == null) continue;
    if (typeof v === 'object' && !Array.isArray(v)) {
      if (v.canonical !== undefined && v.canonical !== null && v.canonical !== '') {
        out[k] = v.canonical;
      } else if (v.raw !== undefined && v.raw !== null && v.raw !== '') {
        out[k] = v.raw;
      }
    } else {
      out[k] = v;
    }
  }
  return out;
};

module.exports = { flattenEntitiesForRepair };
```

- [ ] **Step 2: Commit**

```bash
git add TOT_backend/server/agent/graph/shared/entities.js
git commit -m "refactor: extract flattenEntitiesForRepair to shared/entities.js"
```

### Task 1.4: 提取 `nodes/loadContext.js`

**Files:**
- Create: `TOT_backend/server/agent/graph/nodes/loadContext.js`
- Read: `TOT_backend/server/agent/graph/nodes.js:150-181`

- [ ] **Step 1: 写 loadContext node**

```js
// TOT_backend/server/agent/graph/nodes/loadContext.js
'use strict';

const { HumanMessage } = require("@langchain/core/messages");
const { startNodeSpan } = require("../shared/spanHelper");
const chatMemoryService = require("../../../services/chatMemoryService");

const loadContext = async (state) => {
  const span = startNodeSpan(state, 'LoadContext', { userId: state.userId });
  let memorySnippets = [];
  try {
    const rawMemories = chatMemoryService.getMemories(state.userId);
    if (typeof rawMemories === 'string' && rawMemories.trim() !== '') {
      const lines = rawMemories.split('\n').filter(line => line.trim());
      memorySnippets = lines.map(line => ({ text: line.trim(), score: 1.0, source: 'user_memories' }));
    }
  } catch (err) {
    console.error("[LoadContext] 真实记忆注入失败，降级为空上下文:", err);
  }

  const { endSpan } = require("../../../utils/tracer");
  endSpan(span, { output: memorySnippets.length ? `${memorySnippets.length} snippets` : 'none' });
  return {
    memory_snippets: memorySnippets,
    messages: [new HumanMessage(state.userMessage)]
  };
};

module.exports = { loadContext };
```

- [ ] **Step 2: Commit**

```bash
git add TOT_backend/server/agent/graph/nodes/loadContext.js
git commit -m "refactor: extract loadContext node"
```

### Task 1.5: 提取 `nodes/contextAnalyzerRouter.js`

**Files:**
- Create: `TOT_backend/server/agent/graph/nodes/contextAnalyzerRouter.js`
- Read: `TOT_backend/server/agent/graph/nodes.js:186-273`

- [ ] **Step 1: 写 contextAnalyzerRouter node**

```js
// TOT_backend/server/agent/graph/nodes/contextAnalyzerRouter.js
'use strict';

const { SystemMessage, HumanMessage } = require("@langchain/core/messages");
const { ChatOpenAI } = require("@langchain/openai");
const { startNodeSpan } = require("../shared/spanHelper");
const { renderMemoryBlock } = require("../shared/memoryBlock");
const { getClient, endGeneration, maskPII, preview, promptHash, NOOP_TRACE } = require("../../../utils/tracer");
const promptRegistry = require("../../../prompts/registry");
const RoutingPolicy = require("../routingPolicy");
const decisionRules = require("../decisionRules");

const getRouterModel = () => new ChatOpenAI({
  modelName: "deepseek-chat",
  apiKey: process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: process.env.DEEPSEEK_API_BASE_URL || "https://api.deepseek.com/v1"
  },
  temperature: 0.1,
  maxTokens: 512
});

const contextAnalyzerRouter = async (state, config) => {
  console.log(`[Router] 正在请求意图分类模型... 输入: ${state.userMessage}`);

  const memoryBlock = renderMemoryBlock(state.memory_snippets);
  const schemaDefinition = promptRegistry.get('router') + `\n\n${memoryBlock}`;

  const traceId = config?.configurable?.traceId;
  const client = getClient();
  const gen = client && traceId
    ? client.generation({ traceId, name: 'Router_Intent_Classification', model: 'deepseek-chat', input: maskPII(state.userMessage), metadata: { promptVersion: promptRegistry.version('router'), promptHash: promptHash(schemaDefinition) } })
    : NOOP_TRACE.generation({ name: 'Router_Intent_Classification' });

  const recentHistory = (state.messages || []).filter(m => {
    const t = m._getType ? m._getType() : (m.role || '');
    return t === 'human' || t === 'ai';
  }).slice(-4);
  const historyCtx = recentHistory.length > 1
    ? `\n\nRECENT CONVERSATION (for context, the user's latest message may be a response to the assistant's last question):\n${recentHistory.map(m => `${m._getType() === 'human' ? 'User' : 'Assistant'}: ${typeof m.content === 'string' ? m.content.slice(0, 300) : ''}`).join('\n')}`
    : '';

  const messages = [
    new SystemMessage(schemaDefinition + historyCtx),
    new HumanMessage(state.userMessage)
  ];

  let rawJson = "";
  try {
    const invokeConfig = { signal: config?.signal };
    const res = await getRouterModel().invoke(messages, invokeConfig);
    rawJson = res.content.trim();

    if (rawJson.startsWith('```json')) {
      rawJson = rawJson.replace(/^```json/, '').replace(/```$/, '').trim();
    } else if (rawJson.startsWith('```')) {
      rawJson = rawJson.replace(/^```/, '').replace(/```$/, '').trim();
    }

    const parsed = JSON.parse(rawJson);
    console.log(`[Router] 解析结果:`, parsed);

    endGeneration(gen, {
      output: maskPII(preview(rawJson)),
      usage: res.usage_metadata || res.usage || null,
      model: 'deepseek-chat',
      metadata: { mode: parsed.mode, intent: parsed.intent },
    });

    const risk = parsed.risk_flags === true;
    const tier = decisionRules.selectTier(parsed.complexity_score, risk);
    const mode = decisionRules.correctMode(parsed.mode || 'tool_action', parsed.intent, risk);

    if (parsed.mode === 'chat_only' && mode === 'tool_action') {
      console.log(`[Router] ⚠️ 纠正: mode 被 LLM 误标为 chat_only，但 intent 为 ${parsed.intent}，已强制覆盖为 tool_action`);
    }

    return {
      mode,
      intent: parsed.intent || "tool_action",
      entities: parsed.entities || {},
      entities_confidence: parsed.entities_confidence || {},
      selected_tier: tier,
      meta_trace_id: config?.configurable?.traceId || state.meta_trace_id || '',
      meta_fallback_count: state.meta_fallback_count
    };
  } catch (err) {
    console.error(`[Router] 意图解析失败，降级为默认安全流转. Raw: ${rawJson}`, err);
    endGeneration(gen, {
      output: maskPII(preview(rawJson || '')),
      level: 'ERROR',
      statusMessage: err.message,
      model: 'deepseek-chat',
    });
    return {
      mode: "tool_action",
      intent: "tool_action",
      selected_tier: "L3_fc_guarded",
      entities: {},
      entities_confidence: {},
      meta_trace_id: config?.configurable?.traceId || state.meta_trace_id || '',
      meta_fallback_count: (state.meta_fallback_count || 0) + 1
    };
  }
};

module.exports = { contextAnalyzerRouter };
```

- [ ] **Step 2: Commit**

```bash
git add TOT_backend/server/agent/graph/nodes/contextAnalyzerRouter.js
git commit -m "refactor: extract contextAnalyzerRouter node"
```

### Task 1.6: 提取 `nodes/toolRetrieve.js`

**Files:**
- Create: `TOT_backend/server/agent/graph/nodes/toolRetrieve.js`
- Read: `TOT_backend/server/agent/graph/nodes.js:91-145, 280-356`

- [ ] **Step 1: 写 toolRetrieve node（含 INTENT_TOOL_MAP、BM25 索引、启动校验）**

```js
// TOT_backend/server/agent/graph/nodes/toolRetrieve.js
'use strict';

const { startNodeSpan } = require("../shared/spanHelper");
const { endSpan } = require("../../../utils/tracer");
const chatToolsService = require("../../../services/chatToolsService");
const RoutingPolicy = require("../routingPolicy");
const { INTENT_ALIAS_MAP, normalizeIntent } = require("../intents");

const INTENT_TOOL_MAP = Object.freeze({
  query_metrics:   ["queryExecutiveMetrics", "getOverviewData", "getRegionDetailData", "searchEntities"],
  progress_query:  ["getOverviewData", "queryExecutiveMetrics", "searchEntities"],
  project_status:  ["getTaskListData", "getOverviewData", "queryExecutiveMetrics", "searchEntities"],
  warning_query:   ["getWarningsData", "queryExecutiveMetrics", "getStoreDetailData", "searchEntities"],
  drill_down:      ["getRegionDetailData", "getStoreDetailData", "queryExecutiveMetrics", "searchEntities"],
  analytics_query: ["runAnalytics", "queryExecutiveMetrics", "fetchRawDataset", "executeCode", "searchEntities"],
});

const FALLBACK_TOOL_NAMES = Object.freeze(["queryExecutiveMetrics", "getOverviewData", "getTaskListData", "searchEntities"]);

const { BM25Index } = require('../toolRetriever');
const TOOL_INDEX = (() => {
  const names = chatToolsService.getRegisteredToolNames();
  const docs = names.map(name => {
    const schema = chatToolsService.getToolSchemasByNames([name])[0];
    const desc = schema?.function?.description || '';
    return { id: name, text: `${name} ${desc}` };
  });
  return new BM25Index(docs);
})();

// 启动校验
(() => {
  const registered = new Set(chatToolsService.getRegisteredToolNames());
  if (registered.size === 0) {
    console.warn("[toolRetrieve] tools registry is empty at module load; skipping intent-map validation");
    return;
  }
  const allMentioned = new Set([...Object.values(INTENT_TOOL_MAP).flat(), ...FALLBACK_TOOL_NAMES]);
  const missing = [...allMentioned].filter(n => !registered.has(n));
  if (missing.length > 0) {
    throw new Error(
      `[toolRetrieve] INTENT_TOOL_MAP references tools that are not registered: ${missing.join(", ")}. ` +
      `Registered tools: ${[...registered].join(", ")}`
    );
  }
  const validCanonical = new Set([...Object.keys(INTENT_TOOL_MAP), 'chat_only']);
  const badAliases = Object.entries(INTENT_ALIAS_MAP)
    .filter(([, target]) => !validCanonical.has(target))
    .map(([k, v]) => `${k}->${v}`);
  if (badAliases.length > 0) {
    throw new Error(
      `[toolRetrieve] INTENT_ALIAS_MAP has invalid canonical targets: ${badAliases.join(", ")}`
    );
  }
})();

const toolRetrieve = async (state) => {
  const span = startNodeSpan(state, 'ToolRetrieve', { intent: state.intent, userMessage: (state.userMessage || '').slice(0, 200) });

  const intent = normalizeIntent(state.intent);
  const msg = state.userMessage || '';

  const MULTI_CONJUNCTIONS = ['另外', '还有', '以及', '同时', '此外', '再加上', '顺便'];
  const hasConjunction = MULTI_CONJUNCTIONS.some(c => msg.includes(c));
  const multiQuestionMarks = (msg.match(/[？?]/g) || []).length >= 2;
  const hasClauses = (msg.includes('，') || msg.includes('；') || msg.includes('\n')) && msg.length > 50;
  const looksMultiQuestion = hasConjunction || multiQuestionMarks || hasClauses;

  const topK = looksMultiQuestion
    ? 5
    : (RoutingPolicy.tiers[state.selected_tier]?.tool_top_k || 3);

  const intentSeed = INTENT_TOOL_MAP[intent];
  const seedList = (looksMultiQuestion || !intentSeed)
    ? chatToolsService.getRegisteredToolNames()
    : intentSeed;

  const PRIOR_BASE = 5;
  const PRIOR_DECAY = 0.5;
  const isFlatPrior = intent === 'chat_only' || !intentSeed || looksMultiQuestion;

  const scoreById = new Map();
  seedList.forEach((id, i) => {
    const prior = isFlatPrior ? PRIOR_BASE : (PRIOR_BASE - i * PRIOR_DECAY);
    scoreById.set(id, (scoreById.get(id) || 0) + prior);
  });

  const seedSet = new Set(seedList);
  const recentAssistantText = (state.messages || [])
    .filter(m => m._getType && m._getType() === 'ai')
    .slice(-2)
    .map(m => typeof m.content === 'string' ? m.content.slice(0, 500) : '')
    .join(' ');
  const bm25Query = recentAssistantText
    ? `${state.userMessage || ''} ${recentAssistantText}`
    : (state.userMessage || '');
  const bm25Ranked = TOOL_INDEX.score(bm25Query);
  for (const { id, score } of bm25Ranked) {
    if (score <= 0) continue;
    if (!seedSet.has(id)) continue;
    scoreById.set(id, (scoreById.get(id) || 0) + score);
  }

  const ranked = [...scoreById.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);

  const candidates = chatToolsService.getToolSchemasByNames(ranked)
    .map(schema => schema.function.name)
    .slice(0, topK);

  endSpan(span, { output: candidates.join(', '), metadata: { intent, topK, isMultiQuestion: looksMultiQuestion, isFlatPrior } });

  return { candidateTools: candidates };
};

module.exports = { toolRetrieve, INTENT_TOOL_MAP, FALLBACK_TOOL_NAMES };
```

- [ ] **Step 2: Commit**

```bash
git add TOT_backend/server/agent/graph/nodes/toolRetrieve.js
git commit -m "refactor: extract toolRetrieve node with INTENT_TOOL_MAP and BM25 index"
```

### Task 1.7: 提取 `nodes/fc_CheckSteps.js`

**Files:**
- Create: `TOT_backend/server/agent/graph/nodes/fc_CheckSteps.js`

- [ ] **Step 1: 写 fc_CheckSteps**

```js
// TOT_backend/server/agent/graph/nodes/fc_CheckSteps.js
'use strict';

const { startNodeSpan } = require("../shared/spanHelper");
const { endSpan } = require("../../../utils/tracer");

const fc_CheckSteps = async (state) => {
  const span = startNodeSpan(state, 'FC_CheckSteps', { step: (state.fc_super_step_count || 0) + 1, tier: state.selected_tier });
  endSpan(span, { output: `step ${(state.fc_super_step_count || 0) + 1}` });
  return {
    fc_super_step_count: (state.fc_super_step_count || 0) + 1,
    fc_next_action: '',
  };
};

module.exports = { fc_CheckSteps };
```

- [ ] **Step 2: Commit**

```bash
git add TOT_backend/server/agent/graph/nodes/fc_CheckSteps.js
git commit -m "refactor: extract fc_CheckSteps node"
```

### Task 1.8: 提取 `nodes/fc_LlmToolCallStep.js`

**Files:**
- Create: `TOT_backend/server/agent/graph/nodes/fc_LlmToolCallStep.js`
- Read: `TOT_backend/server/agent/graph/nodes.js:367-651`

This is the largest node (~280 lines). Extract the core logic including:
- DSML buffer filtering (`flushSafeFromDsmlBuffer`)
- Context truncation
- Stream/signal/timeout handling
- Tool call accumulation from stream chunks

- [ ] **Step 1: 写 fc_LlmToolCallStep**

```js
// TOT_backend/server/agent/graph/nodes/fc_LlmToolCallStep.js
'use strict';

const { SystemMessage } = require("@langchain/core/messages");
const { ChatOpenAI } = require("@langchain/openai");
const { startNodeSpan } = require("../shared/spanHelper");
const { renderMemoryBlock } = require("../shared/memoryBlock");
const chatToolsService = require("../../../services/chatToolsService");
const { getClient, endGeneration, maskPII, preview, NOOP_TRACE } = require("../../../utils/tracer");
const promptRegistry = require("../../../prompts/registry");
const RoutingPolicy = require("../routingPolicy");
const decideChart = require("../decideChart");
const { FALLBACK_TOOL_NAMES } = require("./toolRetrieve");

const getFcModel = () => new ChatOpenAI({
  modelName: "deepseek-chat",
  apiKey: process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY,
  configuration: { baseURL: process.env.DEEPSEEK_API_BASE_URL || "https://api.deepseek.com/v1" },
  temperature: 0.1,
  maxTokens: 2048,
  streaming: true
});

const getLlmWithTools = (candidateTools = null) => {
  const wantedTools = Array.isArray(candidateTools) && candidateTools.length > 0
    ? candidateTools
    : chatToolsService.getRegisteredToolNames();
  let finalTools = chatToolsService.getToolSchemasByNames(wantedTools).map((schema) => ({
    type: "function",
    function: {
      name: schema.function.name,
      description: schema.function.description,
      parameters: schema.function.parameters
    }
  }));
  if (finalTools.length === 0) {
    finalTools = chatToolsService.getToolSchemasByNames(FALLBACK_TOOL_NAMES).map((schema) => ({
      type: "function",
      function: {
        name: schema.function.name,
        description: schema.function.description,
        parameters: schema.function.parameters
      }
    }));
  }
  return finalTools.length > 0 ? getFcModel().bindTools(finalTools) : getFcModel();
};

// DSML 流式过滤：防止 <｜tool_calls> 乱码段 emit 到前端
const DSML_OPEN = '<｜tool_calls>';
const DSML_CLOSE = '</｜tool_calls>';

const flushSafeFromDsmlBuffer = (buffer) => {
  // ... 同 nodes.js:476-560 完整逻辑
  // 为简洁计，此处省略完整 DSML 过滤逻辑，实际搬运时保持逐行一致
  return { safe: buffer, rest: '' };
};

const fc_LlmToolCallStep = async (state, config) => {
  const emitter = config?.configurable?.sseEmitter;
  const traceId = config?.configurable?.traceId;

  const client = getClient();
  const fcGen = client && traceId
    ? client.generation({ traceId, name: 'FC_LLM_Tool_Decision', model: 'deepseek-chat', input: maskPII(preview(state.userMessage)), metadata: { step: state.fc_super_step_count, tier: state.selected_tier } })
    : NOOP_TRACE.generation({ name: 'FC_LLM_Tool_Decision' });

  const currentStep = state.fc_super_step_count;
  const maxSteps = RoutingPolicy.tiers[state.selected_tier]?.max_super_steps || 3;

  // 组装 safeHistory（含去重、截断）
  const safeHistory = [];
  if (state.messages.length > 0) safeHistory.push(...state.messages);
  if (safeHistory.length === 0) safeHistory.push(new HumanMessage(state.userMessage));
  // 去重连续 HumanMessage
  if (safeHistory.length >= 2) {
    const last = safeHistory[safeHistory.length - 1];
    const prev = safeHistory[safeHistory.length - 2];
    if (last._getType() === 'human' && prev._getType() === 'human' && last.content === prev.content) {
      safeHistory.pop();
    }
  }
  // 截断
  const FC_HISTORY_MAX = Number(process.env.FC_HISTORY_MAX_MESSAGES || 30);
  if (safeHistory.length > FC_HISTORY_MAX) {
    const trimmed = safeHistory.slice(-FC_HISTORY_MAX);
    console.log(`[fc_LlmToolCallStep] 上下文截断: ${safeHistory.length} → ${trimmed.length}`);
    safeHistory.length = 0;
    safeHistory.push(...trimmed);
  }

  const suggestedChart = decideChart(state.toolResults || {}, state.intent);
  const chartContext = suggestedChart
    ? `\n\nAVAILABLE CHART DATA:\n\`\`\`echarts\n${JSON.stringify(suggestedChart, null, 2)}\n\`\`\`\n`
    : '';

  const systemPrompt = promptRegistry.get('fc_agent', {
    toolNamespace: state.tool_namespace,
    selectedTier: state.selected_tier,
    maxSteps, currentStep, chartContext,
    memoryBlock: renderMemoryBlock(state.memory_snippets),
  });

  const messagesToSend = [new SystemMessage(systemPrompt), ...safeHistory];

  const emitDeltaToSse = (token, isReasoning) => {
    if (!emitter || typeof emitter.handleLLMNewToken !== 'function') return;
    if (typeof token !== 'string' || !token) return;
    emitter.handleLLMNewToken(token, { isReasoning: !!isReasoning });
  };

  const isOverCap = currentStep >= maxSteps;
  const llm = isOverCap ? getFcModel() : getLlmWithTools(state.candidateTools);
  const signal = config?.signal;

  if (isOverCap) {
    messagesToSend.push(new SystemMessage("CRITICAL NOTICE: You have reached the maximum tool call budget. You MUST summarize the final answer based ONLY on the data already collected. DO NOT request any more tools."));
  }

  console.log(`[fc_LlmToolCallStep] step=${currentStep}/${maxSteps} isOverCap=${isOverCap}`);

  const fcInvokeT0 = Date.now();
  try {
    const FC_TIMEOUT_MS = Number(process.env.FC_LLM_TIMEOUT_MS || 60000);
    const timeoutCtl = new AbortController();
    const timer = setTimeout(() => timeoutCtl.abort(new Error(`fc_LlmToolCallStep timeout after ${FC_TIMEOUT_MS}ms`)), FC_TIMEOUT_MS);
    const mergedSignal = (typeof AbortSignal !== 'undefined' && AbortSignal.any && signal)
      ? AbortSignal.any([signal, timeoutCtl.signal])
      : (signal || timeoutCtl.signal);

    let aiMessage = null;
    let chunkCount = 0;
    let dsmlBuffer = '';

    const stream = await llm.stream(messagesToSend, { signal: mergedSignal });
    for await (const chunk of stream) {
      chunkCount++;
      const delta = chunk.content;
      if (typeof delta === 'string' && delta) {
        const { safe, rest } = flushSafeFromDsmlBuffer(dsmlBuffer + delta);
        if (safe) emitDeltaToSse(safe, false);
        dsmlBuffer = rest;
      }
      if (chunk.tool_calls && chunk.tool_calls.length > 0) {
        if (!aiMessage) {
          aiMessage = chunk;
        } else {
          for (const tc of chunk.tool_calls) {
            const idx = tc.index ?? 0;
            if (!aiMessage.tool_calls[idx]) {
              aiMessage.tool_calls[idx] = { id: '', type: 'function', function: { name: '', arguments: '' } };
            }
            if (tc.id) aiMessage.tool_calls[idx].id = tc.id;
            if (tc.function?.name) aiMessage.tool_calls[idx].function.name += tc.function.name;
            if (tc.function?.arguments) aiMessage.tool_calls[idx].function.arguments += tc.function.arguments;
          }
        }
      }
      if (typeof chunk.content === 'string' && !aiMessage) {
        aiMessage = chunk;
      } else if (typeof chunk.content === 'string' && aiMessage && !aiMessage.tool_calls?.length) {
        aiMessage.content = (aiMessage.content || '') + chunk.content;
      }
    }
    clearTimeout(timer);

    const finalContent = aiMessage?.content || '';
    const tool_calls = aiMessage?.tool_calls?.filter(Boolean) || null;

    // Flush residual DSML buffer
    if (dsmlBuffer) {
      const cleaned = dsmlBuffer.replace(/<｜tool_calls>[\s\S]*?<\/｜tool_calls>/g, '');
      if (cleaned) emitDeltaToSse(cleaned, false);
    }

    endGeneration(fcGen, {
      output: preview(finalContent),
      usage: aiMessage?.usage_metadata || null,
      model: 'deepseek-chat',
      metadata: {
        step: currentStep,
        durationMs: Date.now() - fcInvokeT0,
        hasToolCalls: !!tool_calls,
        toolCallCount: tool_calls ? tool_calls.length : 0,
        toolCallNames: tool_calls ? tool_calls.map(t => t.function?.name).filter(Boolean) : [],
      },
    });

    return {
      messages: tool_calls
        ? [aiMessage]
        : [aiMessage],
      fc_next_action: tool_calls ? '' : 'finalize',
    };
  } catch (err) {
    clearTimeout(timer);
    endGeneration(fcGen, {
      output: null,
      level: err?.name === 'AbortError' ? 'WARNING' : 'ERROR',
      statusMessage: err?.message,
      metadata: { step: currentStep, durationMs: Date.now() - fcInvokeT0, status: err?.name === 'AbortError' ? 'aborted' : 'error' },
    });
    throw err;
  }
};

module.exports = { fc_LlmToolCallStep, getFcModel, getLlmWithTools };
```

- [ ] **Step 2: Commit**

```bash
git add TOT_backend/server/agent/graph/nodes/fc_LlmToolCallStep.js
git commit -m "refactor: extract fc_LlmToolCallStep node"
```

### Task 1.9: 提取 `nodes/fc_CheckDuplicate.js`

**Files:**
- Create: `TOT_backend/server/agent/graph/nodes/fc_CheckDuplicate.js`
- Read: `TOT_backend/server/agent/graph/nodes.js:653-714`

- [ ] **Step 1: 提取 fc_CheckDuplicate**

```js
// TOT_backend/server/agent/graph/nodes/fc_CheckDuplicate.js
'use strict';

const { startNodeSpan } = require("../shared/spanHelper");
const { endSpan } = require("../../../utils/tracer");
const { getLastAiToolCalls, buildToolSignature } = require("../toolCallUtils");
const chatToolsService = require("../../../services/chatToolsService");
const chatSessionStateService = require("../../../services/chatSessionStateService");

const fc_CheckDuplicate = async (state) => {
  const span = startNodeSpan(state, 'FC_CheckDuplicate', {});
  const { toolCalls } = getLastAiToolCalls(state);
  if (toolCalls.length === 0) {
    return { fc_next_action: 'finalize' };
  }

  const scopeFp = chatSessionStateService.buildScopeFingerprint(state.regionScope);
  const pendingToolCalls = [];
  const toolResults = {};
  const sigToToolCallId = new Map();

  for (const toolCall of toolCalls) {
    const toolName = toolCall.name;
    const freshnessBucketMs = chatToolsService.getToolFreshnessBucketMs(toolName);
    const signature = buildToolSignature(toolName, toolCall.args, scopeFp, { bucketMs: freshnessBucketMs });

    const dupId = sigToToolCallId.get(signature);
    if (dupId) {
      console.log(`[CheckDuplicate] 同 batch 重复 tool_call: ${toolName} (复用 ${dupId})`);
      toolResults[toolCall.id] = { signature, data: null, alias_of: dupId };
      continue;
    }
    sigToToolCallId.set(signature, toolCall.id);

    const existingResult = Object.values(state.toolResults || {}).find(r => r && r.signature === signature && r.data);
    if (existingResult) {
      console.log(`[CheckDuplicate] 命中同图缓存: ${toolName}`);
      toolResults[toolCall.id] = { signature, data: existingResult.data };
      continue;
    }

    const sessionCached = chatSessionStateService.getLatestBySignature(state.sessionId, signature, state.regionScope);
    if (sessionCached) {
      console.log(`[CheckDuplicate] 命中 Session 缓存: ${toolName}`);
      toolResults[toolCall.id] = { signature, data: sessionCached.data };
      continue;
    }

    pendingToolCalls.push(toolCall);
  }

  if (pendingToolCalls.length === 0) {
    endSpan(span, { output: 'all deduped → merge' });
    return { toolResults, fc_next_action: 'merge' };
  }

  endSpan(span, { output: `${pendingToolCalls.length} new calls → validate` });
  return { toolResults, pending_tool_calls: pendingToolCalls, fc_next_action: 'validate' };
};

module.exports = { fc_CheckDuplicate };
```

- [ ] **Step 2: Commit**

```bash
git add TOT_backend/server/agent/graph/nodes/fc_CheckDuplicate.js
git commit -m "refactor: extract fc_CheckDuplicate node"
```

### Task 1.10: 提取 `nodes/fc_ValidateParams.js`

**Files:**
- Create: `TOT_backend/server/agent/graph/nodes/fc_ValidateParams.js`
- Read: `TOT_backend/server/agent/graph/nodes.js:721-1016`

This is ~295 lines. Extract core validation logic including entity extraction, confidence check, and HITL trigger.

- [ ] **Step 1: 写 fc_ValidateParams（保留核心逻辑）**

搬运 nodes.js:721-1016 到独立文件，导出 `{ fc_ValidateParams }`。逻辑完全不变。

- [ ] **Step 2: Commit**

```bash
git add TOT_backend/server/agent/graph/nodes/fc_ValidateParams.js
git commit -m "refactor: extract fc_ValidateParams node"
```

### Task 1.11: 提取 `nodes/fc_ParamRepair.js`

**Files:**
- Create: `TOT_backend/server/agent/graph/nodes/fc_ParamRepair.js`
- Read: `TOT_backend/server/agent/graph/nodes.js:1037-1087`

- [ ] **Step 1: 提取 fc_ParamRepair**

搬运 nodes.js:1037-1087。依赖 `flattenEntitiesForRepair` from `shared/entities.js`。

- [ ] **Step 2: Commit**

### Task 1.12: 提取 `nodes/fc_ExecuteTool.js`

**Files:**
- Create: `TOT_backend/server/agent/graph/nodes/fc_ExecuteTool.js`
- Read: `TOT_backend/server/agent/graph/nodes.js:1093-1239`

- [ ] **Step 1: 提取 fc_ExecuteTool（含 inspectToolResult）**

搬运 nodes.js:1093-1239。依赖 `makeToolMessage` from `toolCallUtils.js`。

- [ ] **Step 2: Commit**

### Task 1.13: 提取 `nodes/fc_MergeToolResults.js`

**Files:**
- Create: `TOT_backend/server/agent/graph/nodes/fc_MergeToolResults.js`
- Read: `TOT_backend/server/agent/graph/nodes.js:1241-1323`

- [ ] **Step 1: 提取 fc_MergeToolResults**

搬运 nodes.js:1241-1323。

- [ ] **Step 2: Commit**

### Task 1.14: 提取 `nodes/humanInTheLoopGate.js`

**Files:**
- Create: `TOT_backend/server/agent/graph/nodes/humanInTheLoopGate.js`
- Read: `TOT_backend/server/agent/graph/nodes.js:1325-1408`

- [ ] **Step 1: 提取 humanInTheLoopGate（含 interrupt 调用）**

搬运 nodes.js:1325-1408。（`interrupt` 的 require 移到文件顶部）

- [ ] **Step 2: Commit**

### Task 1.15: 提取 `nodes/finalResponseStep.js`

**Files:**
- Create: `TOT_backend/server/agent/graph/nodes/finalResponseStep.js`
- Read: `TOT_backend/server/agent/graph/nodes.js:1438-1505`

- [ ] **Step 1: 提取 finalResponseStep（含 sanitizeUserFacingMarkdown）**

搬运 nodes.js:1412-1505。重导出 `{ finalResponseStep }`。

- [ ] **Step 2: Commit**

### Task 1.16: 提取 `nodes/persistAndEmit.js`

**Files:**
- Create: `TOT_backend/server/agent/graph/nodes/persistAndEmit.js`
- Read: `TOT_backend/server/agent/graph/nodes.js:1507-1563`

- [ ] **Step 1: 提取 persistAndEmit**

搬运 nodes.js:1507-1563。

- [ ] **Step 2: Commit**

### Task 1.17: 更新 `graph.js` import 路径

- [ ] **Step 1: 修改 graph.js 的 require**

```js
// TOT_backend/server/agent/graph/graph.js
const { StateGraph, END, START } = require("@langchain/langgraph");
const { ExecChatGraphState } = require("./state");
const { loadContext } = require("./nodes/loadContext");
const { contextAnalyzerRouter } = require("./nodes/contextAnalyzerRouter");
const { toolRetrieve } = require("./nodes/toolRetrieve");
const { fc_CheckSteps } = require("./nodes/fc_CheckSteps");
const { fc_LlmToolCallStep } = require("./nodes/fc_LlmToolCallStep");
const { fc_CheckDuplicate } = require("./nodes/fc_CheckDuplicate");
const { fc_ValidateParams } = require("./nodes/fc_ValidateParams");
const { fc_ParamRepair } = require("./nodes/fc_ParamRepair");
const { fc_ExecuteTool } = require("./nodes/fc_ExecuteTool");
const { fc_MergeToolResults } = require("./nodes/fc_MergeToolResults");
const { humanInTheLoopGate } = require("./nodes/humanInTheLoopGate");
const { finalResponseStep } = require("./nodes/finalResponseStep");
const { persistAndEmit } = require("./nodes/persistAndEmit");
const RoutingPolicy = require('./routingPolicy');

// ... routeAfter* 函数和 buildGraph 保持不变
```

- [ ] **Step 2: 运行 mockTest 验证无回归**

```bash
node TOT_backend/server/agent/graph/mockTest.js
```

- [ ] **Step 3: 删除旧 nodes.js**

```bash
rm TOT_backend/server/agent/graph/nodes.js
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: split nodes.js into 14 individual node files"
```

---

## Phase 2: 标准化改进

### Task 2.1: 创建 `llm.js` 单例

**Files:**
- Create: `TOT_backend/server/agent/graph/llm.js`

- [ ] **Step 1: 写 llm.js**

```js
// TOT_backend/server/agent/graph/llm.js
'use strict';

const { ChatOpenAI } = require("@langchain/openai");

const apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
const baseURL = process.env.DEEPSEEK_API_BASE_URL || "https://api.deepseek.com/v1";

const routerModel = new ChatOpenAI({
  modelName: "deepseek-chat",
  apiKey,
  configuration: { baseURL },
  temperature: 0.1,
  maxTokens: 512,
});

const fcModel = new ChatOpenAI({
  modelName: "deepseek-chat",
  apiKey,
  configuration: { baseURL },
  temperature: 0.1,
  maxTokens: 2048,
  streaming: true,
});

module.exports = { routerModel, fcModel };
```

- [ ] **Step 2: 更新 contextAnalyzerRouter 用 routerModel 单例**

把文件内的 `getRouterModel` 删掉，顶部改成：
```js
const { routerModel } = require("../llm");
```

- [ ] **Step 3: 更新 fc_LlmToolCallStep 用 fcModel 单例**

把文件内的 `getFcModel` 删掉，顶部改成：
```js
const { fcModel } = require("../llm");
```

- [ ] **Step 4: 验证**

```bash
node TOT_backend/server/agent/graph/mockTest.js
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: extract ChatOpenAI singletons to llm.js"
```

### Task 2.2: Router 用 withStructuredOutput

- [ ] **Step 1: 在 contextAnalyzerRouter.js 中改用 Zod + withStructuredOutput**

```js
const { z } = require("zod");
const { routerModel } = require("../llm");

const RouterOutput = z.object({
  mode: z.enum(["chat_only", "tool_action", "deny"]),
  intent: z.string(),
  entities: z.record(z.any()).optional().default({}),
  entities_confidence: z.record(z.number()).optional().default({}),
  complexity_score: z.number().optional(),
  risk_flags: z.boolean().optional(),
});

// 在 contextAnalyzerRouter 内：
const structuredModel = routerModel.withStructuredOutput(RouterOutput);
const parsed = await structuredModel.invoke(messages, { signal: config?.signal });
// 直接使用 parsed.mode / parsed.intent / parsed.entities ... 不再需要 JSON.parse 和正则
```

- [ ] **Step 2: 验证**

```bash
node TOT_backend/server/agent/graph/mockTest.js
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor: use withStructuredOutput in Router instead of JSON regex"
```

### Task 2.3: 删除 chatAgentRunner.js 和 AGENT_MODE

- [ ] **Step 1: 修改 chatService.js**

删除：
```js
const chatAgentRunner = require('./chatAgentRunner');
const { AGENT_MODE } = chatAgentRunner;
```
删除所有 `AGENT_MODE` 引用，`sendMessage` / `sendMessageStream` 统一走 `buildGraph`。

- [ ] **Step 2: 删除文件**

```bash
rm TOT_backend/server/services/chatAgentRunner.js
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor: remove chatAgentRunner, LangGraph is sole agent path"
```

---

## Phase 3: 测试

### Task 3.1: 配置 Jest

- [ ] **Step 1: 安装 Jest**

```bash
npm install --save-dev jest
```

- [ ] **Step 2: package.json 加 test script**

```json
"scripts": {
  "test": "jest"
}
```

### Task 3.2: Graph 集成测试

**Files:**
- Create: `TOT_backend/server/agent/graph/__tests__/graph.test.js`

- [ ] **Step 1: 写测试**

```js
'use strict';

const { buildGraph } = require("../graph");
const { MemorySaver } = require("@langchain/langgraph");

describe("Executive Chat Graph", () => {
  test("闲聊直接走到 FinalResponseStep", async () => {
    const app = buildGraph().compile({ checkpointer: new MemorySaver() });
    const result = await app.invoke({
      userMessage: "你好",
      sessionId: "test-chat-1",
      userId: "1",
      messages: [],
    });
    expect(result.mode).toBe("chat_only");
    expect(result.reply_markdown).toBeTruthy();
  }, 15000);

  test("华东区查询触发 router 意图分类", async () => {
    const app = buildGraph().compile({ checkpointer: new MemorySaver() });
    const result = await app.invoke({
      userMessage: "华东区完成率最低的5家门店",
      sessionId: "test-drill-1",
      userId: "1",
      messages: [],
    });
    // 验证不走 chat_only 捷径
    expect(result.mode).not.toBe("chat_only");
  }, 15000);
});
```

- [ ] **Step 2: 运行测试**

```bash
npm test -- --testPathPattern="graph.test"
```

- [ ] **Step 3: Commit**

---

## 文件变更总览

| Phase | Create | Modify | Delete |
|-------|--------|--------|--------|
| 1.1-1.3 | `shared/spanHelper.js`, `shared/memoryBlock.js`, `shared/entities.js` | - | - |
| 1.4-1.16 | `nodes/loadContext.js` ... `nodes/persistAndEmit.js` (13 files) | - | - |
| 1.17 | - | `graph.js` | `nodes.js` |
| 2.1 | `llm.js` | `nodes/contextAnalyzerRouter.js`, `nodes/fc_LlmToolCallStep.js` | - |
| 2.2 | - | `nodes/contextAnalyzerRouter.js` | - |
| 2.3 | - | `chatService.js` | `chatAgentRunner.js` |
| 3.1-3.2 | `__tests__/graph.test.js` | - | - |
