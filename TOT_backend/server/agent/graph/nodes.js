const { AIMessage, HumanMessage, SystemMessage, ToolMessage } = require("@langchain/core/messages");
const { ChatOpenAI } = require("@langchain/openai");
const { nanoid } = require('nanoid');
const { db } = require('../../db');
const { formatNowSqliteLocal } = require('../../utils/ddlAt');
const chatToolsService = require('../../services/chatToolsService');
const { memoryQueueProducer } = require("../queue/bullMqProducer");
const { getClient, endSpan, argsHash, keyedFields, maskPII, preview } = require("../../utils/tracer");
// Langfuse 的链路追踪已由 `server/utils/tracer.js` 统一接管。
// 这里保留函数但不再注入 `langfuse-langchain` CallbackHandler，避免版本不兼容导致模型调用直接崩溃。
const getLangfuseCallback = () => null;

// === 真实的 LLM 配置 (复用项目的 DeepSeek API Key) ===
// 考虑到意图路由这种一次性、低延迟的操作，推荐配置较小或响应更快的模型。
const getRouterModel = () => new ChatOpenAI({
  modelName: "deepseek-chat", // 或者 deepseek-coder
  apiKey: process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY, 
  configuration: {
    baseURL: process.env.DEEPSEEK_API_BASE_URL || "https://api.deepseek.com/v1" // 兼容 OpenAI 接口规范的地址
  },
  temperature: 0.1,
  maxTokens: 512
});

const getFcModel = () => new ChatOpenAI({
  modelName: "deepseek-chat",
  apiKey: process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: process.env.DEEPSEEK_API_BASE_URL || "https://api.deepseek.com/v1"
  },
  temperature: 0.1,
  maxTokens: 2048,
  // 必须 streaming:true + 调用方用 model.stream() 才会真流式（多 chunks）。
  // 三种坑组合的隔离测试结论（server/scripts/test-fc-isolation.js）：
  //   - streaming:true  + invoke()  → SDK 内 stream reader 死锁，30s timeout（B/D）
  //   - streaming:false + .stream() → 只吐 1 个聚合 chunk，没有打字机效果（F）
  //   - streaming:true  + .stream() → 18 chunks，~1s 完成，正常 ✓（G）
  // 调用方在 fc_LlmToolCallStep 用 .stream() AsyncIterator，绝不要改成 .invoke()。
  streaming: true
});

// 动态将 chatToolsService 中所有的 Schema 转换为 LangChain bindTools 可用的格式
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

// ─── 工具候选映射（intent → 工具名列表） ─────────────────────────────────────
// 这是 ToolRetrieve 节点和 getLlmWithTools 的唯一权威来源。
// 任何对工具集合的修改都应该改这里，并由下方启动校验保证名字真实存在。
const INTENT_TOOL_MAP = Object.freeze({
  query_metrics:   ["queryExecutiveMetrics", "getOverviewData", "getRegionDetailData"],
  progress_query:  ["getOverviewData", "queryExecutiveMetrics"],
  project_status:  ["getTaskListData", "getOverviewData", "queryExecutiveMetrics"],
  warning_query:   ["getWarningsData", "queryExecutiveMetrics", "getStoreDetailData"],
  drill_down:      ["getRegionDetailData", "getStoreDetailData", "queryExecutiveMetrics"],
  analytics_query: ["runAnalytics", "queryExecutiveMetrics", "fetchRawDataset", "executeCode"],
});

// Router LLM 偶尔会输出 spec 文档里的别名（task_status/store_warning/...）或常见错别字，
// 不要让它们落到 fallback 走错工具。INTENT_ALIAS_MAP / normalizeIntent 已抽到
// `./intents.js`（避免与 renderers.js 形成循环依赖），这里直接 require。
// 新增 alias 在 intents.js 添加，不要在这里复制一份。
const { INTENT_ALIAS_MAP, normalizeIntent } = require('./intents');

// intent 未命中时的兜底候选；同时也是 getLlmWithTools 的最终 fallback。
const FALLBACK_TOOL_NAMES = Object.freeze(["queryExecutiveMetrics", "getOverviewData", "getTaskListData"]);

// ─── BM25 工具索引 ──────────────────────────────────────────────────────
// 在模块加载时为所有注册工具的 description 建立 BM25 索引；
// ToolRetrieve 使用 「intent_map (prior) + bm25(userMessage) (likelihood)」 的混合排序。
const { BM25Index } = require('./toolRetriever');
const TOOL_INDEX = (() => {
  const names = chatToolsService.getRegisteredToolNames();
  const docs = names.map(name => {
    const schema = chatToolsService.getToolSchemasByNames([name])[0];
    const desc = schema?.function?.description || '';
    return { id: name, text: `${name} ${desc}` };
  });
  return new BM25Index(docs);
})();

// 启动校验：若 intentMap / fallback 引用了未注册的工具名，立即崩溃 — 强制开发者修复。
(() => {
  const registered = new Set(chatToolsService.getRegisteredToolNames());
  if (registered.size === 0) {
    console.warn("[graph/nodes] tools registry is empty at module load; skipping intent-map validation");
    return;
  }
  const allMentioned = new Set([
    ...Object.values(INTENT_TOOL_MAP).flat(),
    ...FALLBACK_TOOL_NAMES,
  ]);
  const missing = [...allMentioned].filter(n => !registered.has(n));
  if (missing.length > 0) {
    throw new Error(
      `[graph/nodes] INTENT_TOOL_MAP references tools that are not registered: ${missing.join(", ")}. ` +
      `Registered tools: ${[...registered].join(", ")}`
    );
  }

  // 同样校验 INTENT_ALIAS_MAP：每个 alias 的 value 都必须是 INTENT_TOOL_MAP 的 key 或 'chat_only'。
  // 防止以后加 alias 时拼错 canonical 名。
  const validCanonical = new Set([...Object.keys(INTENT_TOOL_MAP), 'chat_only']);
  const badAliases = Object.entries(INTENT_ALIAS_MAP)
    .filter(([, target]) => !validCanonical.has(target))
    .map(([k, v]) => `${k}->${v}`);
  if (badAliases.length > 0) {
    throw new Error(
      `[graph/nodes] INTENT_ALIAS_MAP has invalid canonical targets: ${badAliases.join(", ")}. ` +
      `Valid targets: ${[...validCanonical].join(", ")}`
    );
  }
})();


// == 图节点实现 (真实落地) ==

const chatMemoryService = require('../../services/chatMemoryService');

// 将 memory_snippets 渲染为可注入到 system prompt 的字符串。
// 任何节点需要把记忆塞进 prompt 时，调用这里而不是把格式化字符串写回 state。
const renderMemoryBlock = (snippets) => {
  if (!Array.isArray(snippets) || snippets.length === 0) return "";
  const lines = snippets.map(s => s?.text).filter(Boolean);
  if (lines.length === 0) return "";
  return `[用户历史偏好/已知记忆]\n${lines.join('\n')}`;
};

const loadContext = async (state) => {
  // T4 阶段二：真实调用 Store API 读取 `mid_term` 等记忆
  let memorySnippets = [];
  try {
    const rawMemories = chatMemoryService.getMemories(state.userId);
    if (typeof rawMemories === 'string' && rawMemories.trim() !== '') {
      const lines = rawMemories.split('\n').filter(line => line.trim());
      memorySnippets = lines.map(line => ({ text: line.trim(), score: 1.0, source: 'user_memories' }));
      console.log(`[T4 记忆注入] 真实加载到 ${state.userId} 的长期偏好`);
    }
  } catch (err) {
    console.error("[LoadContext] 真实记忆注入失败，降级为空上下文:", err);
  }

  return {
    memory_snippets: memorySnippets,
    messages: [new HumanMessage(state.userMessage)]
  };
};

const RoutingPolicy = require('./routingPolicy');

const contextAnalyzerRouter = async (state, config) => {
  console.log(`[Router] 正在请求意图分类模型... 输入: ${state.userMessage}`);
  
  // 如果是补槽恢复(slot_fill)，并且之前已经有了明确的意图和实体，可以考虑跳过重查
  // 但对于意图变更(intent_shift)，必须强制重查。这里简化为每次 Router 都重查，以覆盖 intent_shift 的强制安全检查要求
  
  const memoryBlock = renderMemoryBlock(state.memory_snippets);
  const schemaDefinition = `
You are a highly efficient JSON routing bot for "Executive Chat".
Your task is to analyze the user's message and strictly output valid JSON matching this schema:
{
  "mode": "chat_only" | "tool_action" | "deny",
  "intent": string, // MUST be one of: "query_metrics", "progress_query", "drill_down", "project_status", "warning_query", "analytics_query", or "chat_only"
  "entities": {
    "metric": { "raw": string, "canonical": string, "confidence": number }
  },
  "entities_confidence": { "metric": number },
  "complexity_score": number,
  "risk_flags": boolean
}
SAFETY RULES:
1. If the user asks to send emails, nudge people, write, update, or delete any data, set "risk_flags": true and "mode": "deny". Executive Chat is strictly read-only.
2. If the user asks "who are you", "what can you do", or says "hello", set "mode": "chat_only" and "intent": "chat_only". Do NOT swallow "remember my preference" as chat_only; memory updates are "tool_action" or normal queries.
3. OUTPUT RAW JSON ONLY. NEVER wrap your response in markdown code blocks.

INTENT CLASSIFICATION RULES:
- "warning_query": MUST be used when the user asks about "重点关注" (needing attention), "预警" (warnings), "最差" (worst), "落后" (falling behind), or "0%". Example: "有哪些门店需要重点关注？" -> "warning_query"
- "query_metrics": General data/numbers (e.g., "Q1 completion rate").
- "drill_down": Asking for a breakdown or details of a specific region/store.
- "project_status": Asking about overall tasks or project list.

${memoryBlock}
`;

  const messages = [
    new SystemMessage(schemaDefinition),
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
    
    // 如果存在风险，强制禁止提升权限档位
    const risk = parsed.risk_flags === true;
    let tier = "L3_fc_guarded";
    const cScore = parsed.complexity_score || 0.5;

    if (!risk) {
      if (cScore >= RoutingPolicy.thresholds.complexity_score_l4_min) {
        tier = "L4_heavy_fc";
      } else if (cScore <= RoutingPolicy.thresholds.complexity_score_l2_max) {
        tier = "L2_intent_fastpath";
      }
    }

    // mode 是路由唯一真值源；risk_flags 强制 deny。
    let mode = parsed.mode || "tool_action";
    if (risk) {
      mode = "deny";
    } else if (mode === "chat_only") {
      const toolIntents = ["query_metrics", "progress_query", "drill_down", "project_status", "warning_query", "analytics_query"];
      if (toolIntents.includes(parsed.intent)) {
        mode = "tool_action";
        console.log(`[Router] ⚠️ 纠正: mode 被 LLM 误标为 chat_only，但 intent 为 ${parsed.intent}，已强制覆盖为 tool_action`);
      }
    }

    return {
      mode,
      intent: parsed.intent || "tool_action",
      entities: parsed.entities || {},
      entities_confidence: parsed.entities_confidence || {},
      selected_tier: tier,
      meta_fallback_count: state.meta_fallback_count
    };
  } catch (err) {
    console.error(`[Router] 意图解析失败，降级为默认安全流转. Raw: ${rawJson}`, err);
    return {
      mode: "tool_action",
      intent: "tool_action",
      selected_tier: "L3_fc_guarded",
      entities: {},
      entities_confidence: {},
      meta_fallback_count: (state.meta_fallback_count || 0) + 1
    };
  }
};

// 内部 inline normalizeIntent 已迁移到顶层（line ~85），保留这一行注释提示修改史。
// 注意：原版本把 progress_query 当 alias 映射到 query_metrics；现在 progress_query 已升为
// INTENT_TOOL_MAP 独立 key，候选工具更精准（[getOverviewData, queryExecutiveMetrics]），
// 不要再恢复 alias 映射。

const toolRetrieve = async (state) => {
  const intent = normalizeIntent(state.intent);
  const topK = RoutingPolicy.tiers[state.selected_tier]?.tool_top_k || 3;

  // ── Prior：intent map 给出的候选（按列表顺序赋递减分数） ────────────
  const intentSeed = INTENT_TOOL_MAP[intent];
  if (!intentSeed) {
    console.warn(`[ToolRetrieve] 意图 '${intent}' 未在 INTENT_TOOL_MAP 中注册，使用 FALLBACK_TOOL_NAMES`);
  }
  const seedList = intentSeed || FALLBACK_TOOL_NAMES;
  const PRIOR_BASE = 5;     // 比 BM25 典型分数 (0~3) 大一档，确保 intent 命中的工具不会被淘汰出 topK
  const PRIOR_DECAY = 0.5;  // 顺序惩罚

  const scoreById = new Map();
  seedList.forEach((id, i) => {
    scoreById.set(id, (scoreById.get(id) || 0) + PRIOR_BASE - i * PRIOR_DECAY);
  });

  // ── Likelihood：BM25(userMessage) ─────────────────────────────────
  const bm25Ranked = TOOL_INDEX.score(state.userMessage || '');
  for (const { id, score } of bm25Ranked) {
    if (score <= 0) continue;
    scoreById.set(id, (scoreById.get(id) || 0) + score);
  }

  // ── 排序、Top-K、与真实注册表二次过滤 ──────────────────────────────
  const ranked = [...scoreById.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);

  const candidates = chatToolsService.getToolSchemasByNames(ranked)
    .map(schema => schema.function.name)
    .slice(0, topK);

  console.log(`[ToolRetrieve] 意图: ${intent}, 候选工具(混合排序): ${candidates.join(', ')}`);

  return {
    candidateTools: candidates
  };
};

const fc_CheckSteps = async (state) => {
  return { 
    fc_super_step_count: (state.fc_super_step_count || 0) + 1,
    fc_next_action: '',
  };
};

const fc_LlmToolCallStep = async (state, config) => {
  const emitter = config?.configurable?.sseEmitter;
  const traceId = config?.configurable?.traceId;

  // 1. 步数控制
  const currentStep = state.fc_super_step_count;
  const maxSteps = RoutingPolicy.tiers[state.selected_tier]?.max_super_steps || 3;
  
  // 2. 组装历史消息 (openAI 格式严苛：System -> Human -> [AI -> Tool]* )
  // 必须保证最后一条是 HumanMessage 或 ToolMessage
  const safeHistory = [];
  const len = state.messages.length;
  
  if (len > 0) {
    safeHistory.push(...state.messages);
  }
  
  if (safeHistory.length === 0) {
    safeHistory.push(new HumanMessage(state.userMessage));
  }

  // Deduplicate consecutive identical HumanMessages that might have been pushed by loadContext
  if (safeHistory.length >= 2) {
    const last = safeHistory[safeHistory.length - 1];
    const prev = safeHistory[safeHistory.length - 2];
    if (last._getType() === 'human' && prev._getType() === 'human' && last.content === prev.content) {
      safeHistory.pop();
    }
  }

  const systemPrompt = `You are a professional Executive Chat data analyst. Your namespace is ${state.tool_namespace}.
Current tier: ${state.selected_tier}.
Budget steps: ${maxSteps}. Current super-step: ${currentStep}.

GUIDELINES:
1. If you have enough data from tool results, provide a concise Markdown summary.
2. If tools failed or steps are exceeded, explain what happened and suggest alternatives.
3. Use tables or lists for data presentation.
4. When calling tools, use ONLY the tools provided in your tool belt.
5. **Step budget is tight**: if multiple tools from your belt are obviously useful for the user's question, return them all in a single response (parallel tool_calls) instead of calling them one-by-one across multiple steps.
6. **Stop and Ask (CRITICAL)**: If a tool returns an error about missing parameters (e.g., INVALID_PARAMETERS, "请明确您要查询的培训任务名称"), **DO NOT retry calling the tool repeatedly**. Immediately stop and output a natural language response asking the user to provide the missing information.

${renderMemoryBlock(state.memory_snippets)}`;

  const messagesToSend = [
    new SystemMessage(systemPrompt),
    ...safeHistory
  ];

  // 3. 流式：用 model.stream() AsyncIterator 显式拿 chunk，逐帧推给 SSE emitter。
  // 不用 ChatOpenAI 的 streaming:true + invoke + handleLLMNewToken callbacks 那套，
  // 因为它跟 DeepSeek 不兼容（B/D 二分测试过，invoke 那条路 SDK 内 stream reader 死锁）。
  const emitDeltaToSse = (token, isReasoning) => {
    if (!emitter || typeof emitter.handleLLMNewToken !== 'function') return;
    if (typeof token !== 'string' || !token) return;
    emitter.handleLLMNewToken(token, { isReasoning: !!isReasoning });
  };

  // 4. 根据步数决定是否绑定工具
  const isOverCap = currentStep >= maxSteps;
  const llm = isOverCap ? getFcModel() : getLlmWithTools(state.candidateTools);
  const signal = config?.signal;

  if (isOverCap) {
    messagesToSend.push(new SystemMessage("CRITICAL NOTICE: You have reached the maximum tool call budget. You MUST summarize the final answer based ONLY on the data already collected in the chat history. DO NOT request any more tools. DO NOT use JSON tool calls. DO NOT output any <｜｜DSML｜｜> tags. Just write a summary to the user."));
  }

  console.log(`[fc_LlmToolCallStep] step=${currentStep}/${maxSteps} isOverCap=${isOverCap} candidateTools=${(state.candidateTools||[]).join(',')} → 调用 DeepSeek (stream)...`);
  const fcInvokeT0 = Date.now();
  try {
    const FC_TIMEOUT_MS = Number(process.env.FC_LLM_TIMEOUT_MS || 60000);

    // 用 AbortSignal.any 把外层 signal 和 timeout signal 合并，超时直接 abort 流。
    const timeoutCtl = new AbortController();
    const timer = setTimeout(() => timeoutCtl.abort(new Error(`fc_LlmToolCallStep timeout after ${FC_TIMEOUT_MS}ms`)), FC_TIMEOUT_MS);
    const mergedSignal = (typeof AbortSignal !== 'undefined' && AbortSignal.any && signal)
      ? AbortSignal.any([signal, timeoutCtl.signal])
      : (signal || timeoutCtl.signal);

    let aiMessage = null;
    let chunkCount = 0;
    // DSML（DeepSeek Markup Language）流式过滤缓冲：DeepSeek 偶尔会把 tool_calls 编码成
    // <｜｜DSML｜｜tool_calls>...</...> 的乱码段。直接 emit 给前端会让用户看到一段乱码闪现，
    // 之后被聚合 aiMessage.content 的清理代码（下方）擦掉，体验很差。
    // 这里在流式 emit 阶段做 sliding-window 过滤：
    //   1. 已经收齐一对 OPEN/CLOSE → 直接从缓冲里删整段
    //   2. 看到 OPEN 但没看到 CLOSE → 只 emit OPEN 之前，OPEN 之后全留在缓冲等
    //   3. 缓冲末尾是 OPEN 的 partial 前缀（如 "<｜"）→ 留住等下一帧
    //   4. 都不是 → 整段 emit
    let dsmlBuffer = '';
    const DSML_OPEN = '<｜｜DSML｜｜tool_calls>';
    const DSML_CLOSE = '</｜｜DSML｜｜tool_calls>';
    const flushSafeFromDsmlBuffer = () => {
      // 1. 移除已闭合的整段（可能多段）
      while (true) {
        const o = dsmlBuffer.indexOf(DSML_OPEN);
        if (o === -1) break;
        const c = dsmlBuffer.indexOf(DSML_CLOSE, o);
        if (c === -1) break;
        dsmlBuffer = dsmlBuffer.slice(0, o) + dsmlBuffer.slice(c + DSML_CLOSE.length);
      }
      // 2. 仅有未闭合 OPEN，flush OPEN 之前
      const dangling = dsmlBuffer.indexOf(DSML_OPEN);
      if (dangling !== -1) {
        const safe = dsmlBuffer.slice(0, dangling);
        dsmlBuffer = dsmlBuffer.slice(dangling);
        return safe;
      }
      // 3. 缓冲末尾可能是 OPEN 的 partial 前缀，hold 住
      for (let len = Math.min(DSML_OPEN.length - 1, dsmlBuffer.length); len > 0; len--) {
        if (DSML_OPEN.startsWith(dsmlBuffer.slice(-len))) {
          const safe = dsmlBuffer.slice(0, -len);
          dsmlBuffer = dsmlBuffer.slice(-len);
          return safe;
        }
      }
      // 4. 全部 safe
      const safe = dsmlBuffer;
      dsmlBuffer = '';
      return safe;
    };
    try {
      const stream = await llm.stream(messagesToSend, { signal: mergedSignal });
      for await (const chunk of stream) {
        chunkCount += 1;
        // chunk.content 是本次增量文本；reasoning_content 在 additional_kwargs 里
        const additionalKwargs = chunk?.additional_kwargs || {};
        const deltaReasoning = additionalKwargs.reasoning_content;
        if (deltaReasoning) emitDeltaToSse(deltaReasoning, true);

        const deltaText = typeof chunk.content === 'string' ? chunk.content : '';
        if (deltaText) {
          dsmlBuffer += deltaText;
          const safe = flushSafeFromDsmlBuffer();
          if (safe) emitDeltaToSse(safe, false);
        }

        aiMessage = aiMessage ? aiMessage.concat(chunk) : chunk;
      }
      // stream 收尾：缓冲里剩下的内容 emit 出去（即使有未闭合 DSML 残片，下游聚合代码会清掉）
      if (dsmlBuffer) {
        emitDeltaToSse(dsmlBuffer, false);
        dsmlBuffer = '';
      }
    } finally {
      clearTimeout(timer);
    }

    if (timeoutCtl.signal.aborted) {
      const e = new Error(`fc_LlmToolCallStep timeout after ${FC_TIMEOUT_MS}ms`);
      e.code = 'FC_LLM_TIMEOUT';
      throw e;
    }
    if (!aiMessage) {
      const e = new Error('fc_LlmToolCallStep produced no chunks');
      e.code = 'FC_LLM_EMPTY';
      throw e;
    }

    console.log(`[fc_LlmToolCallStep] DeepSeek 返回，耗时 ${Date.now() - fcInvokeT0}ms, chunks=${chunkCount}, hasToolCalls=${!!(aiMessage.tool_calls && aiMessage.tool_calls.length)}`);
    
    // 兼容 DeepSeek 偶尔输出的 DSML (DeepSeek Markup Language)
    if (typeof aiMessage.content === 'string' && aiMessage.content.includes('<｜｜DSML｜｜tool_calls>')) {
      if (!isOverCap) {
        // 解析所有 <DSML invoke ...>...</DSML invoke> 块（之前只解析第一个，多工具会丢）
        const invokeRegex = /<｜｜DSML｜｜invoke\s+name=["“”]([^"“”]+)["“”]>([\s\S]*?)<\/｜｜DSML｜｜invoke>/g;
        const paramRegex = /<｜｜DSML｜｜parameter\s+name=["“”]([^"“”]+)["“”][^>]*>([\s\S]*?)<\/｜｜DSML｜｜parameter>/g;

        if (!aiMessage.tool_calls) aiMessage.tool_calls = [];
        let invokeMatch;
        let dsmlIndex = 0;
        while ((invokeMatch = invokeRegex.exec(aiMessage.content)) !== null) {
          const toolName = invokeMatch[1];
          const innerBody = invokeMatch[2];
          const args = {};
          let pMatch;
          paramRegex.lastIndex = 0;
          while ((pMatch = paramRegex.exec(innerBody)) !== null) {
            args[pMatch[1]] = pMatch[2].trim();
          }
          aiMessage.tool_calls.push({
            name: toolName,
            args,
            id: `call_${Date.now()}_dsml_${dsmlIndex++}`
          });
          console.log(`[fc_LlmToolCallStep] 拦截到 DSML 工具调用并成功修复: ${toolName}`, args);
        }
      }

      // 无论是否超限，清理掉它乱吐出来的乱码，免得用户看到
      aiMessage.content = aiMessage.content.replace(/<｜｜DSML｜｜tool_calls>[\s\S]*?<\/｜｜DSML｜｜tool_calls>/g, '').trim();
    }

    if (!aiMessage.tool_calls) aiMessage.tool_calls = [];

    // 如果没有 tool_calls，标记为最终回复
    const hasTools = aiMessage.tool_calls.length > 0;
    if (traceId && hasTools) {
      try {
        const lf = getClient();
        if (lf) {
          const callNames = aiMessage.tool_calls.map((call) => call?.name).filter(Boolean);
          lf.trace({ id: traceId }).span({
            name: "LLM_Decide_Tools",
            input: {
              candidateTools: state.candidateTools || [],
              selectedTier: state.selected_tier,
            },
            output: {
              toolCallNames: callNames,
              toolCallCount: callNames.length,
            },
            metadata: {
              step: currentStep,
              maxSteps,
            },
          }).end();
        }
      } catch (traceErr) {
        console.warn("[fc_LlmToolCallStep] trace span write failed:", traceErr.message);
      }
    }
    const finalUpdates = { messages: [aiMessage] };
    
    if (!hasTools) {
      finalUpdates.reply_markdown = aiMessage.content;
      finalUpdates.finalResponse = aiMessage.content;
    }
    
    return finalUpdates;
  } catch (err) {
    if (err.name === 'AbortError' || err.message?.includes('abort')) {
      console.log("[fc_LlmToolCallStep] 客户端中止了流式生成");
      const abortMsg = "\n[已中止生成]";
      return { 
        messages: [new AIMessage({ content: abortMsg })],
        reply_markdown: abortMsg,
        finalResponse: abortMsg
      };
    }
    console.error("[fc_LlmToolCallStep] 大模型调用失败:", err);
    const errMsg = `系统异常: 大模型响应失败 ${err.message}`;
    return { 
      messages: [new AIMessage({ content: errMsg })],
      reply_markdown: errMsg,
      finalResponse: errMsg
    };
  }
};

const chatSessionStateService = require('../../services/chatSessionStateService');
const crypto = require('crypto');

// ─── 工具调用签名 / 规范化 / 安全 JSON / 标准 ToolMessage ──────────────────
// 全部抽到 ./toolCallUtils.js（无 graph 依赖，方便测试与复用）。
// FC 节点共享同一份 canonicalize / signature 算法，避免漂移。
const {
  buildToolSignature,
  safeParseJson,
  getLastAiToolCalls,
  safeJsonContent,
  makeToolMessage,
} = require('./toolCallUtils');
// computeToolCallSignature 是早期命名，保留 alias 让既有调用点最小改动。
const computeToolCallSignature = buildToolSignature;

const fc_CheckDuplicate = async (state) => {
  // 用 helper 找最近一条带 tool_calls 的 AIMessage，比直接取 lastMsg 更稳健
  // （中间可能被 ToolMessage / SystemMessage 穿插）。
  const { toolCalls } = getLastAiToolCalls(state);
  if (toolCalls.length === 0) {
    return { fc_next_action: 'finalize' };
  }

  const scopeFp = chatSessionStateService.buildScopeFingerprint(state.regionScope);
  const pendingToolCalls = [];
  const toolResults = {};
  // 同 batch 内去重：LLM 偶尔会在一条 AIMessage 里塞重复 tool_call。
  // 第二份直接复用第一份的执行结果，不再进入 pending 列表。
  const sigToToolCallId = new Map();

  for (const toolCall of toolCalls) {
    const toolName = toolCall.name;
    const signature = buildToolSignature(toolName, toolCall.args, scopeFp);

    // 1) 同 batch 重复
    const dupId = sigToToolCallId.get(signature);
    if (dupId) {
      console.log(`[CheckDuplicate] 同 batch 重复 tool_call: ${toolName} (复用 ${dupId})`);
      // 暂记一个"待解析"的占位 — fc_MergeToolResults 会从同 signature 的兄弟 tool_call 复制结果
      toolResults[toolCall.id] = { signature, data: null, alias_of: dupId };
      continue;
    }
    sigToToolCallId.set(signature, toolCall.id);

    // 2) 同图（本次 graph 调用内）已执行
    const existingResult = Object.values(state.toolResults || {}).find(r => r && r.signature === signature && r.data);
    if (existingResult) {
      console.log(`[CheckDuplicate] 命中同图缓存: ${toolName}`);
      toolResults[toolCall.id] = { signature, data: existingResult.data };
      continue;
    }

    // 3) Session 缓存
    const sessionCached = chatSessionStateService.getLatestBySignature(state.sessionId, signature, state.regionScope);
    if (sessionCached) {
      console.log(`[CheckDuplicate] 命中 Session 缓存: ${toolName}`);
      toolResults[toolCall.id] = { signature, data: sessionCached.data };
      continue;
    }

    pendingToolCalls.push(toolCall);
  }

  if (pendingToolCalls.length === 0) {
    return { toolResults, fc_next_action: 'merge' };
  }

  return {
    toolResults,
    pending_tool_calls: pendingToolCalls,
    fc_next_action: 'validate'
  };
};

// T3 阶段二：真实的参数校验
// 因为我们无法穷举所有工具的 schema，实际业务中应该读取 toolModule.schema.function.parameters
// 然后动态转换为 Ajv 验证，或者如果是 Zod 定义的则直接执行 z.parse()
// 在这里为了 PoC，我们对核心工具（例如 queryExecutiveMetrics）应用明确的 Zod 约束

const fc_ValidateParams = async (state) => {
  const pendingToolCalls = state.pending_tool_calls || [];

  // ── HITL resume consumption ─────────────────────────────────────────
  // 防止死循环：HumanInTheLoopGate 恢复后路由回这里时，必须吸收 resume，
  // 否则会再次基于同样的 entities_confidence 触发 HITL，造成无限循环。
  const confidenceThreshold = RoutingPolicy.thresholds.ner_confidence ?? 0.85;
  const justResumed = state.hitl_status === 'resumed';
  const resumePatch = justResumed ? (state.hitl_resume_payload || {}) : null;

  // resume 后的 entities_confidence：对所有低置信项强制提升到 1.0（视为已澄清）
  let entitiesConfidence = state.entities_confidence || {};
  if (justResumed) {
    entitiesConfidence = Object.fromEntries(
      Object.entries(entitiesConfidence).map(([k, v]) => [k, v < confidenceThreshold ? 1.0 : v])
    );
  }
  // 若 resume payload 显式给了 entity patch，覆盖之
  let entitiesPatch = null;
  if (resumePatch && typeof resumePatch === 'object') {
    if (resumePatch.entities && typeof resumePatch.entities === 'object') {
      entitiesPatch = resumePatch.entities;
    }
    if (resumePatch.entities_confidence && typeof resumePatch.entities_confidence === 'object') {
      entitiesConfidence = { ...entitiesConfidence, ...resumePatch.entities_confidence };
    }
  }

  // 若 resume payload 显式给了 args 补丁，按 toolCallId 合并到 pending tool calls
  let resolvedToolCalls = pendingToolCalls;
  if (resumePatch && resumePatch.toolArgsPatch && typeof resumePatch.toolArgsPatch === 'object') {
    resolvedToolCalls = pendingToolCalls.map(tc => {
      const patch = resumePatch.toolArgsPatch[tc.id];
      if (!patch || typeof patch !== 'object') return tc;
      return { ...tc, args: { ...(tc.args || {}), ...patch } };
    });
  }

  // resume 副作用：所有 return 路径都要清空 hitl 状态
  const hitlReset = justResumed ? { hitl_status: 'idle', hitl_resume_payload: null } : {};

  if (resolvedToolCalls.length === 0) return { ...hitlReset, fc_next_action: 'finalize' };

  const validatedToolCalls = [];
  const toolResults = { ...(state.toolResults || {}) };
  const violationsByToolCall = {};
  const lowConfidenceEntities = Object.entries(entitiesConfidence).filter(([, v]) => v < confidenceThreshold);

  // 实体置信度过低 — 在所有 tool call 校验之前统一走澄清。
  // payload 必须基于真实的低置信实体生成，不能再用 O1/O2 占位。
  if (lowConfidenceEntities.length > 0) {
    const firstField = lowConfidenceEntities[0][0];
    const entityObj = (state.entities || {})[firstField] || {};
    const raw = entityObj.raw || '';
    const canonical = entityObj.canonical || '';
    const options = [];
    if (canonical) {
      options.push({
        id: `confirm_${firstField}_${canonical}`,
        label: `就是「${canonical}」`,
        meta: { field: firstField, value: canonical }
      });
    }
    if (raw && raw !== canonical) {
      options.push({
        id: `confirm_${firstField}_raw`,
        label: `按字面理解「${raw}」`,
        meta: { field: firstField, value: raw }
      });
    }
    options.push({
      id: `clarify_${firstField}_other`,
      label: '都不是，我重新描述',
      meta: { field: firstField, intent_shift: true }
    });

    const payload = {
      type: options.length > 1 ? 'select' : 'input',
      prompt: raw
        ? `我对「${raw}」的理解还不够确定，能帮我确认下是指什么吗？`
        : `我需要您补充一下「${firstField}」的具体范围。`,
      options,
      agent_id: 'executive_chat',
      reason: 'low_confidence_entity',
      resume_token: resolvedToolCalls[0]?.id || `lc_${firstField}`,
      context: { field: firstField, raw, canonical, confidence: entitiesConfidence[firstField] }
    };
    return {
      ...hitlReset,
      hitl_status: 'pending_interrupt',
      interrupt_payload: payload,
      pending_tool_calls: resolvedToolCalls,
      fc_next_action: 'hitl'
    };
  }

  for (const toolCall of resolvedToolCalls) {
    const toolName = chatToolsService.normalizeToolName(toolCall.name);
    const args = typeof toolCall.args === 'object' && toolCall.args ? toolCall.args : (toolCall.args || {});
    const meta = chatToolsService.getToolMeta(toolName);
    const violations = [];

    console.log(`[fc_ValidateParams] 正在校验工具 ${toolName} 的参数...`);

    if (!meta) {
      violations.push({ tool_call_id: toolCall.id, field: 'toolName', code: 'INVALID_TOOL', message: `工具 ${toolName} 不存在或不可用，请使用候选工具列表中的工具。`, repairable: false });
    } else {
      // 参数 schema 校验：所有 enum/array.items/object.properties/nullable 等深度规则
      // 都收口到 chatToolsService.validateToolArgs，这里只需要把每条 violation 加 tool_call_id。
      // 不要再在节点内手写 type/enum/required 检查 — 维护成本高且容易和 service 层口径漂移。
      if (meta.schema) {
        const argCheck = chatToolsService.validateToolArgs(toolName, meta.schema, args);
        for (const v of argCheck.violations) {
          violations.push({ tool_call_id: toolCall.id, ...v });
        }
      }

      // 角色 / scope 校验：同样收口到 service 层 authorizeToolCall。
      // 不再在 nodes.js 里硬编码 scopePolicy === 'national_only' 之类业务规则；
      // 后续新增业务规则统一加在 service 层，不要散落到 graph 节点。
      const sessionContext = {
        regionScope: state.regionScope,
        userRoles: state.regionScope?.userRoles || ['executive'],
      };
      const authCheck = chatToolsService.authorizeToolCall(toolName, meta, sessionContext);
      for (const v of authCheck.violations) {
        violations.push({ tool_call_id: toolCall.id, ...v });
      }
    }

    if (violations.length > 0) {
      violationsByToolCall[toolCall.id] = violations;
      continue;
    }

    validatedToolCalls.push(toolCall);
  }

  // 持久化 entities 补丁（仅在 resume 路径上触发，常态返回为空）
  const entitiesUpdate = (justResumed || entitiesPatch)
    ? {
        entities_confidence: entitiesConfidence,
        ...(entitiesPatch ? { entities: { ...(state.entities || {}), ...entitiesPatch } } : {}),
      }
    : {};

  if (Object.keys(violationsByToolCall).length > 0) {
    const allViolations = Object.values(violationsByToolCall).flat();
    const hasUnrepairable = allViolations.some(v => !v.repairable);
    const maxRepairAttempts = RoutingPolicy.tiers[state.selected_tier]?.max_repair_attempts ?? 2;
    const reachedRepairCap = state.fc_repair_attempts >= maxRepairAttempts;

    if (hasUnrepairable || reachedRepairCap) {
      // 命中上限时，如果剩下的全是「缺失必填参数」这种用户能补充的错，
      // 就升级到 HITL，让用户直接补；其它（类型错误等）才走兜底文案。
      const missingParams = allViolations.filter(v => v.repairable && v.code === 'MISSING_PARAM' && v.field);
      const onlyMissingRepairable = !hasUnrepairable && reachedRepairCap && missingParams.length > 0;

      if (onlyMissingRepairable) {
        const fields = Array.from(new Set(missingParams.map(v => v.field)));
        const firstViolation = missingParams[0];
        const payload = {
          type: 'input',
          prompt: `还需要您补充：${fields.join('、')}。请直接告诉我具体值。`,
          options: [],
          agent_id: 'executive_chat',
          reason: 'missing_required_param',
          resume_token: firstViolation.tool_call_id || resolvedToolCalls[0]?.id || `mp_${fields[0]}`,
          context: { missingFields: fields, violations: missingParams }
        };
        return {
          ...hitlReset,
          ...entitiesUpdate,
          hitl_status: 'pending_interrupt',
          interrupt_payload: payload,
          pending_tool_calls: resolvedToolCalls,
          fc_next_action: 'hitl'
        };
      }

      const errorMsg = allViolations.map(v => v.message).join('; ');
      return {
        ...hitlReset,
        ...entitiesUpdate,
        mode: 'chat_only',
        intent: 'chat_only',
        finalResponse: `SYSTEM_ERROR: 工具参数校验失败。${errorMsg}`,
        messages: [new AIMessage({ content: `很抱歉，我无法执行该操作：${errorMsg}。建议您提供更准确的信息。` })],
        fc_next_action: 'finalize'
      };
    }
    return {
      ...hitlReset,
      ...entitiesUpdate,
      fc_repair_attempts: state.fc_repair_attempts + 1,
      repair_error_reason: JSON.stringify(violationsByToolCall),
      pending_tool_calls: resolvedToolCalls,
      fc_next_action: 'repair'
    };
  }

  return {
    ...hitlReset,
    ...entitiesUpdate,
    pending_tool_calls: validatedToolCalls,
    toolResults,
    fc_next_action: 'execute'
  };
};

// 把 router 给出的 entities（{ field: { canonical, raw, confidence } }）
// 拍平为 { field: value } 用于 repair 时做缺失参数推断。
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

const fc_ParamRepair = async (state) => {
  const pendingToolCalls = state.pending_tool_calls || [];
  if (pendingToolCalls.length === 0) {
    return { fc_next_action: 'validate' };
  }

  let violationsByToolCall = {};
  try {
    violationsByToolCall = JSON.parse(state.repair_error_reason || '{}');
    if (!violationsByToolCall || typeof violationsByToolCall !== 'object') {
      violationsByToolCall = {};
    }
  } catch {
    violationsByToolCall = {};
  }

  const entityMap = flattenEntitiesForRepair(state.entities);

  const repaired = pendingToolCalls.map((toolCall) => {
    const violations = Array.isArray(violationsByToolCall[toolCall.id])
      ? violationsByToolCall[toolCall.id]
      : [];
    const args = typeof toolCall.args === 'object' && toolCall.args ? { ...toolCall.args } : {};
    for (const v of violations) {
      if (!v || !v.field) continue;
      // 1) 校验层给出的修复值（典型：enum 兜底）
      if (v.repairValue !== undefined) {
        args[v.field] = v.repairValue;
        continue;
      }
      // 2) 缺失必填参数：尝试从 router 解析的 entities 推断
      if (v.code === 'MISSING_PARAM' && entityMap[v.field] !== undefined) {
        args[v.field] = entityMap[v.field];
        continue;
      }
      // 3) 不可推断：保留原 args，让 fc_ValidateParams 重新校验，
      //    若仍命中且达到 max_repair_attempts 会被升级到 HITL/finalize。
    }
    return { ...toolCall, args };
  });

  // 注：不再写入「假 ToolMessage」（之前 content 是 {repaired:true}），
  // 否则它会被后续 LLM 误读为真实工具结果，污染会话历史。
  return {
    pending_tool_calls: repaired,
    fc_next_action: 'validate'
  };
};


// 解析 chatToolsService.executeByName 的结果，判断是工具自身的错误还是成功数据。
// executeByName 失败时返回 { error: { code, message, recommendation } } 而不抛异常，
// 所以单纯的 try/catch 无法识别 PERMISSION_DENIED / EXECUTION_ERROR / TIMEOUT_ERROR。
const inspectToolResult = (rawResult) => {
  if (rawResult && typeof rawResult === 'object') {
    // 处理标准 error 对象包裹
    if (rawResult.error && typeof rawResult.error === 'object') {
      return {
        ok: false,
        errorCode: rawResult.error.code || 'EXECUTION_ERROR',
        errorMessage: rawResult.error.message || '工具执行失败',
      };
    }
    // 处理带有 success: false 的业务层报错 (如 queryExecutiveMetrics)
    if (rawResult.success === false) {
      return {
        ok: false,
        errorCode: rawResult.errorCode || 'EXECUTION_ERROR',
        errorMessage: rawResult.message || '工具执行失败',
      };
    }
  }
  return { ok: true, errorCode: null, errorMessage: null };
};

const fc_ExecuteTool = async (state, config) => {
  const emitter = config?.configurable?.sseEmitter;
  const traceId = config?.configurable?.traceId;
  const pendingToolCalls = state.pending_tool_calls || [];
  if (pendingToolCalls.length === 0) return { fc_next_action: 'merge' };

  const toolResults = {};
  const calledTools = [];
  // 一旦命中权限拒绝，后续 pending tool calls 不再执行 —— 写入结构化 skip 结果，
  // 让 LLM 在最终回复里说明无法访问，而不是带着部分数据继续推理。
  let denyShortCircuit = null;

  for (const toolCall of pendingToolCalls) {
    const toolName = chatToolsService.normalizeToolName(toolCall.name);
    const internalToolName = toolName.startsWith(`${state.tool_namespace}.`)
      ? toolName.replace(`${state.tool_namespace}.`, '')
      : toolName;

    if (denyShortCircuit) {
      const skipResult = JSON.stringify({
        error: {
          code: 'SKIPPED_AFTER_DENY',
          message: `因前序工具被拒绝（${denyShortCircuit.errorCode}），本工具未执行。`,
          blockedBy: denyShortCircuit.toolCallId,
        },
      });
      toolResults[toolCall.id] = { data: skipResult, signature: null, error: true };
      // tool_start/end 也要发，让前端进度条与 trace 收齐
      if (emitter && typeof emitter.handleToolStart === 'function') {
        emitter.handleToolStart({ name: internalToolName, status: 'skipped' });
      }
      if (emitter && typeof emitter.handleToolEnd === 'function') {
        emitter.handleToolEnd(skipResult, { status: 'skipped' });
      }
      continue;
    }

    if (emitter && typeof emitter.handleToolStart === 'function') {
      emitter.handleToolStart({ name: internalToolName });
    }

    let toolSpan = null;
    if (traceId) {
      try {
        const lf = getClient();
        if (lf) {
          toolSpan = lf.trace({ id: traceId }).span({
            name: `Tool_Call:${internalToolName}`,
            input: {
              toolCallId: toolCall.id,
              toolName: internalToolName,
              argsHash: argsHash(toolCall.args || {}),
              argFields: keyedFields(toolCall.args || {}),
            },
            metadata: {
              namespace: state.tool_namespace,
              selectedTier: state.selected_tier,
            },
          });
        }
      } catch (traceErr) {
        console.warn("[fc_ExecuteTool] tool span start failed:", traceErr.message);
      }
    }

    let finalResult;
    let inspect = { ok: true, errorCode: null, errorMessage: null };
    try {
      const rawResult = await chatToolsService.executeByName(
        internalToolName,
        toolCall.args || {},
        state.regionScope
      );
      inspect = inspectToolResult(rawResult);
      finalResult = typeof rawResult === 'object' ? JSON.stringify(rawResult) : String(rawResult);

      endSpan(toolSpan, {
        output: maskPII(preview(finalResult, 500)),
        level: inspect.ok ? undefined : 'ERROR',
        statusMessage: inspect.ok ? undefined : inspect.errorMessage,
        metadata: {
          status: inspect.ok ? 'success' : 'error',
          toolCallId: toolCall.id,
          errorCode: inspect.errorCode || undefined,
        },
      });
    } catch (err) {
      // executeByName 通常不抛，这里兜底真正的运行时异常（如超时/网络断）。
      inspect = { ok: false, errorCode: 'EXECUTION_ERROR', errorMessage: err.message || '内部工具执行异常' };
      finalResult = JSON.stringify({ error: { code: 'EXECUTION_ERROR', message: inspect.errorMessage } });
      endSpan(toolSpan, {
        output: maskPII(preview(finalResult, 500)),
        level: 'ERROR',
        statusMessage: err.message,
        metadata: {
          status: 'error',
          toolCallId: toolCall.id,
          errorCode: err.code || 'EXECUTION_ERROR',
        },
      });
    }

    if (emitter && typeof emitter.handleToolEnd === 'function') {
      emitter.handleToolEnd(finalResult, {
        status: inspect.ok ? 'success' : 'error',
        errorCode: inspect.errorCode || undefined,
      });
    }

    toolResults[toolCall.id] = {
      data: finalResult,
      signature: null,
      error: !inspect.ok,
      errorCode: inspect.errorCode || null,
    };
    calledTools.push(internalToolName);

    // 权限拒绝：阻断后续工具，避免在已知越权后继续探测其它敏感工具。
    if (!inspect.ok && inspect.errorCode === 'PERMISSION_DENIED') {
      denyShortCircuit = { toolCallId: toolCall.id, errorCode: inspect.errorCode };
    }
  }

  return { toolResults, calledTools, fc_next_action: 'merge' };
};

const fc_MergeToolResults = async (state) => {
  // 从后向前找最近一条带 tool_calls 的 AIMessage 作为 anchor，
  // 而不是脆弱地依赖 lastMsg —— 后者在「部分缓存命中」等场景下不一定是 AI 消息。
  let anchor = null;
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const m = state.messages[i];
    if (m && m._getType && m._getType() === 'ai' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      anchor = m;
      break;
    }
  }
  if (!anchor) {
    return { fc_next_action: '' };
  }

  // 收集 anchor 之后已经存在的 ToolMessage tool_call_ids，避免重复发射。
  const anchorIdx = state.messages.lastIndexOf(anchor);
  const alreadyEmitted = new Set();
  for (let i = anchorIdx + 1; i < state.messages.length; i++) {
    const m = state.messages[i];
    if (m && m._getType && m._getType() === 'tool' && m.tool_call_id) {
      alreadyEmitted.add(m.tool_call_id);
    }
  }

  const newMessages = [];
  const scopeFp = chatSessionStateService.buildScopeFingerprint(state.regionScope);
  let fallbackBump = 0;

  // 判断一段 JSON 字符串是否承载错误（避免靠 includes('NO_TOOL_RESULT') 这种字符串嗅探）
  const isErrorPayload = (data) => {
    if (typeof data !== 'string') return false;
    try {
      const parsed = JSON.parse(data);
      return Boolean(parsed && parsed.error && parsed.error.code);
    } catch {
      return false;
    }
  };

  for (const toolCall of anchor.tool_calls) {
    if (alreadyEmitted.has(toolCall.id)) continue;

    let resultObj = state.toolResults?.[toolCall.id];
    // 同 batch 重复：复用 alias_of 兄弟 tool_call 的结果
    if (resultObj && resultObj.alias_of && !resultObj.data) {
      const sibling = state.toolResults?.[resultObj.alias_of];
      if (sibling?.data) {
        resultObj = { signature: resultObj.signature, data: sibling.data, error: !!sibling.error };
      }
    }

    let resultData = resultObj?.data;
    let isError = !!resultObj?.error;
    if (!resultData) {
      resultData = JSON.stringify({ error: { code: 'NO_TOOL_RESULT', message: 'No data returned' } });
      isError = true;
      fallbackBump += 1;
    } else if (!isError && isErrorPayload(resultData)) {
      // fc_ExecuteTool 没标 error（例如缓存命中里塞了脏数据），兜底再判一次
      isError = true;
    }

    newMessages.push(makeToolMessage(toolCall, resultData));

    // 仅当本轮新执行（非缓存命中）且非错误时回写 session 缓存。
    // 之前的实现用 includes('NO_TOOL_RESULT') 漏掉了 EXECUTION_ERROR / PERMISSION_DENIED / SKIPPED_AFTER_DENY，
    // 会把失败结果当成正常缓存，下次相同 signature 直接命中错误数据。
    if (resultObj && !resultObj.signature && !isError) {
      const signature = computeToolCallSignature(toolCall.name, toolCall.args, scopeFp);
      chatSessionStateService.addRecord(state.sessionId, { signature, data: resultData }, state.regionScope);
    }
  }

  const updates = { messages: newMessages, pending_tool_calls: [], fc_next_action: '' };
  if (fallbackBump > 0) {
    updates.meta_fallback_count = (state.meta_fallback_count || 0) + fallbackBump;
  }
  return updates;
};

const { interrupt } = require("@langchain/langgraph");

const humanInTheLoopGate = async (state) => {
  const payload = state.interrupt_payload;
  console.log(`[HITL] 图执行流挂起，等待客户端发送 resume。 payload:`, payload);

  const userResponse = interrupt(payload);
  console.log(`[HITL] 已收到用户选择/确认:`, userResponse);
  const normalized = userResponse?.resumePayload || userResponse?.resume_payload || userResponse?.value || userResponse;
  const resumeType = normalized?.resume_type
    || (normalized?.selected_option_id?.startsWith('clarify_') ? 'intent_shift' : 'slot_fill');
  const isIntentShift = resumeType === 'intent_shift';
  const isCancel = resumeType === 'cancel';

  // 提取用户实际给出的文本（用于 intent_shift 的 router 重跑）
  const userText = typeof normalized?.user_text === 'string' && normalized.user_text.trim()
    ? normalized.user_text.trim()
    : (typeof normalized?.value === 'string' ? normalized.value.trim() : '');

  if (isCancel) {
    const cancelMsg = '已取消本次查询。如需继续，请告诉我新的问题。';
    return {
      hitl_status: 'resumed',
      interrupt_payload: null,
      hitl_resume_payload: normalized,
      pending_tool_calls: [],
      reply_markdown: cancelMsg,
      finalResponse: cancelMsg,
      fc_next_action: 'finalize',
      messages: [new AIMessage({ content: cancelMsg })]
    };
  }

  if (isIntentShift) {
    // intent_shift：必须把用户新输入写回 userMessage，并清空旧 router 决策，
    // 否则 ContextAnalyzerRouter 会用旧消息重新分类，等于没切意图。
    const nextUserMessage = userText || state.userMessage;

    // 【修复】：必须用 ToolMessage 闭合上一轮被打断的 tool_calls，否则 OpenAI API 会报 400 sequence 错误
    const cancelMessages = (state.pending_tool_calls || []).map(tc =>
      makeToolMessage(
        { id: tc.id || 'unknown', name: tc.name || 'clarify_intent' },
        { error: 'User cancelled this operation due to intent shift.' }
      )
    );

    return {
      hitl_status: 'resumed',
      interrupt_payload: null,
      hitl_resume_payload: normalized,
      userMessage: nextUserMessage,
      intent: '',
      entities: {},
      entities_confidence: {},
      candidateTools: [],
      pending_tool_calls: [],
      fc_next_action: 're_route',
      messages: [
        ...cancelMessages,
        new HumanMessage(nextUserMessage)
      ]
    };
  }

  // slot_fill：保留 pending_tool_calls 让 fc_ValidateParams 消费 resumePayload 的补丁
  const messageContent = `用户确认了选项/补充了信息: ${JSON.stringify(normalized?.value ?? normalized?.selected_option_id ?? normalized)}`;
  return {
    hitl_status: 'resumed',
    interrupt_payload: null,
    hitl_resume_payload: normalized,
    fc_next_action: 'validate',
    messages: [
      new ToolMessage({
        tool_call_id: payload?.resume_token || 'unknown_token',
        name: 'clarify_intent',
        content: messageContent
      })
    ]
  };
};

// renderToolResultsMarkdown 已抽到 ./renderers.js（含 5 个 intent 专属 renderer）。
// finalResponseStep 兜底链路依赖它生成给用户看的 markdown，不要再回到 nodes.js 里实现。
const { renderToolResultsMarkdown } = require('./renderers');

const sanitizeUserFacingMarkdown = (content) => {
  const text = typeof content === 'string' ? content : '';
  if (!text) return text;
  const hasInternalMarkers =
    text.includes('执行已达到复杂度上限') ||
    text.includes('工具查询片段');
  if (!hasInternalMarkers) return text;
  return '我已完成查询并提取了核心数据。若需更精确结果，可指定时间范围、大区或门店，我会继续为您细化。';
};

const finalResponseStep = async (state, config) => {
  let response = state.reply_markdown || state.finalResponse || "";
  
  if (!response) {
    if (state.mode === "deny") {
      response = "### ⚠️ 请求被拒绝\n\n抱歉，Executive Chat 目前仅支持**只读查询**。我无法帮您执行修改数据、发送催办通知或直接处理业务流等操作。\n\n💡 *建议您可以在系统中手动处理，或询问我当前的数据完成情况。*";
    } else if ((state.mode === "chat_only" || state.intent === "chat_only") && Object.keys(state.toolResults || {}).length === 0) {
      console.log(`[FinalResponseStep] 检测到纯聊天意图，调用大模型进行回复...`);
      const emitter = config?.configurable?.sseEmitter;
      const llm = getFcModel(); // 使用不带工具的基础模型
      
      const chatPrompt = `You are a professional and polite Executive Assistant AI for Apple Retail training management.
The user is having a casual conversation with you.
Respond politely and concisely in Chinese (1-3 sentences).
If they ask what you can do, explain that you can query training progress, store warnings, and project metrics.
Do NOT output any markdown code blocks for JSON or tool calls. Just natural text.`;

      try {
        const stream = await llm.stream([
          new SystemMessage(chatPrompt),
          new HumanMessage(state.userMessage)
        ]);

        response = "";
        for await (const chunk of stream) {
          const deltaText = typeof chunk.content === 'string' ? chunk.content : '';
          if (deltaText) {
            response += deltaText;
            if (emitter && typeof emitter.handleLLMNewToken === 'function') {
              emitter.handleLLMNewToken(deltaText, { isReasoning: false });
            }
          }
        }
      } catch (err) {
        console.error('[FinalResponseStep] 闲聊回复生成失败:', err);
        response = "你好！我是您的 Executive Chat 智能助理。我能帮您查询门店表现、任务完成率、下钻区域数据等。";
      }
    } else {
      response = renderToolResultsMarkdown(state.toolResults || {}, state.intent) || "抱歉，我暂时无法回答这个问题，或者执行过程中遇到了错误。请稍后重试或尝试缩小查询范围。";
    }
  }
  
  response = sanitizeUserFacingMarkdown(response);
  return { finalResponse: response, reply_markdown: response, messages: [new AIMessage({ content: response })] };
};

const persistAndEmit = async (state, config) => {
  const sessionId = state.sessionId;
  const replyContent = state.reply_markdown || state.finalResponse || "";
  const now = formatNowSqliteLocal();
  const assistMsgId = nanoid();

  console.log(`[PersistAndEmit] 正在持久化会话 ${sessionId} 的机器人回复...`);

  try {
    db.transaction(() => {
      db.run(
        'INSERT INTO chat_messages (id, session_id, role, content, intent_type, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [assistMsgId, sessionId, 'assistant', replyContent, state.intent || null, now]
      );
      db.run('UPDATE chat_sessions SET last_active = ? WHERE id = ?', [now, sessionId]);
    });
  } catch (err) {
    throw Object.assign(new Error(`CHAT_PERSIST_FAILED: ${err.message}`), { code: 'CHAT_PERSIST_FAILED', status: 500 });
  }

  // 2. Fire & Forget 发布 MemoryIngestRequested 事件
  memoryQueueProducer.publishMemoryIngestion({
    userId: state.userId || "mock_user_1",
    sessionId: state.sessionId,
    userMessage: state.userMessage,
    finalResponse: replyContent
  }).catch(e => console.error("发布记忆事件失败:", e));
  
  // 3. T5 阶段二: 更新 Langfuse Trace 元数据
  if (config?.configurable?.traceId) {
    try {
      const { Langfuse } = require('langfuse');
      const lf = new Langfuse({
        publicKey: process.env.LANGFUSE_PUBLIC_KEY,
        secretKey: process.env.LANGFUSE_SECRET_KEY,
        baseUrl: process.env.LANGFUSE_BASEURL || process.env.LANGFUSE_HOST
      });
      lf.trace({ id: config.configurable.traceId }).update({
        output: replyContent,
        metadata: {
          selected_tier: state.selected_tier,
          fc_steps_used: state.fc_super_step_count,
          repair_attempts: state.fc_repair_attempts,
          intent: state.intent,
          error_code: (replyContent && replyContent.includes("SYSTEM_ERROR")) ? "TOOL_PARAM_ERROR" : undefined
        }
      });
      lf.flushAsync().catch(() => {});
    } catch (err) {
      console.warn('[Langfuse] final trace update skipped:', err.message);
    }
  }

  return { 
    finalMessageId: assistMsgId,
    reply_markdown: replyContent
  };
};

module.exports = {
  loadContext,
  contextAnalyzerRouter,
  toolRetrieve,
  fc_CheckSteps,
  fc_LlmToolCallStep,
  fc_CheckDuplicate,
  fc_ValidateParams,
  fc_ParamRepair,
  fc_ExecuteTool,
  fc_MergeToolResults,
  persistAndEmit,
  humanInTheLoopGate,
  finalResponseStep,
  renderToolResultsMarkdown
};
