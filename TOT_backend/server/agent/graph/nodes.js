const { AIMessage, HumanMessage, SystemMessage, ToolMessage } = require("@langchain/core/messages");
const { ChatOpenAI } = require("@langchain/openai");
const { nanoid } = require('nanoid');
const { db } = require('../../db');
const { formatNowSqliteLocal } = require('../../utils/ddlAt');
const chatToolsService = require('../../services/chatToolsService');
const { memoryQueueProducer } = require("../queue/bullMqProducer");
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
  // 必须开启流式，否则 handleLLMNewToken 等事件不会触发
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
    const fallbackNames = ["queryExecutiveMetrics", "getOverviewData", "getTaskListData"];
    finalTools = chatToolsService.getToolSchemasByNames(fallbackNames).map((schema) => ({
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

// == 图节点实现 (真实落地) ==

const chatMemoryService = require('../../services/chatMemoryService');

const loadContext = async (state) => {
  // T4 阶段二：真实调用 Store API 读取 `mid_term` 等记忆
  let memoryContextStr = "";
  let memorySnippets = [];
  try {
    const rawMemories = chatMemoryService.getMemories(state.userId);
    if (typeof rawMemories === 'string' && rawMemories.trim() !== '') {
      memoryContextStr = `[用户历史偏好/已知记忆]\n${rawMemories}`;
      const lines = rawMemories.split('\n').filter(line => line.trim());
      memorySnippets = lines.map(line => ({ text: line.trim(), score: 1.0, source: 'user_memories' }));
    }
  } catch (err) {
    console.error("[LoadContext] 真实记忆注入失败，降级为空上下文:", err);
  }
  
  if (memoryContextStr) {
    console.log(`[T4 记忆注入] 真实加载到 ${state.userId} 的长期偏好`);
  }
  
  return { 
    memoryContext: memoryContextStr,
    memory_snippets: memorySnippets
  };
};

const RoutingPolicy = require('./routingPolicy');

const contextAnalyzerRouter = async (state, config) => {
  console.log(`[Router] 正在请求意图分类模型... 输入: ${state.userMessage}`);
  
  // 如果是补槽恢复(slot_fill)，并且之前已经有了明确的意图和实体，可以考虑跳过重查
  // 但对于意图变更(intent_shift)，必须强制重查。这里简化为每次 Router 都重查，以覆盖 intent_shift 的强制安全检查要求
  
  const schemaDefinition = `
You are a highly efficient JSON routing bot for "Executive Chat".
Your task is to analyze the user's message and strictly output valid JSON matching this schema:
{
  "mode": "chat_only" | "tool_action" | "deny",
  "global_safety_decision": "allow" | "deny",
  "intent": string, // canonical intent such as "query_metrics", "drill_down", "project_status", "warning_query", "analytics_query", or "chat_only"
  "entities": {
    "metric": { "raw": string, "canonical": string, "confidence": number }
  },
  "entities_confidence": { "metric": number },
  "complexity_score": number,
  "risk_flags": boolean
}
SAFETY RULES:
1. If the user asks to send emails, nudge people, write, update, or delete any data, set "risk_flags": true, "global_safety_decision": "deny", and "mode": "deny". Executive Chat is strictly read-only.
2. If the user asks "who are you", "what can you do", or says "hello", set "mode": "chat_only" and "intent": "chat_only". Do NOT swallow "remember my preference" as chat_only; memory updates are "tool_action" or normal queries.
3. OUTPUT RAW JSON ONLY. NEVER wrap your response in markdown code blocks.

${state.memoryContext || ''}
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

    return { 
      mode: parsed.mode || "tool_action",
      global_safety_decision: parsed.global_safety_decision || "allow",
      safety: parsed.global_safety_decision || "allow", // 旧字段兼容
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
      global_safety_decision: "allow", 
      safety: "allow", 
      intent: "tool_action", 
      selected_tier: "L3_fc_guarded", 
      entities: {},
      entities_confidence: {},
      meta_fallback_count: (state.meta_fallback_count || 0) + 1
    };
  }
};

const normalizeIntent = (intent) => {
  const aliasMap = {
    query_metrics: 'query_metrics',
    matrix_query: 'query_metrics',
    progress_query: 'query_metrics',
    project_status: 'project_status',
    task_status: 'project_status',
    warning_query: 'warning_query',
    store_warning: 'warning_query',
    drill_down: 'drill_down',
    analytics: 'analytics_query',
    analytics_query: 'analytics_query',
  };
  return aliasMap[intent] || intent || 'tool_action';
};

const toolRetrieve = async (state) => {
  const intent = normalizeIntent(state.intent);
  const topK = RoutingPolicy.tiers[state.selected_tier]?.tool_top_k || 3;
  
  const intentMap = {
    "query_metrics": ["queryExecutiveMetrics", "getOverviewData", "getRegionDetailData"],
    "project_status": ["getTaskListData", "getOverviewData", "queryExecutiveMetrics"],
    "warning_query": ["getWarningsData", "queryExecutiveMetrics", "getStoreDetailData"],
    "drill_down": ["getRegionDetailData", "getStoreDetailData", "queryExecutiveMetrics"],
    "analytics_query": ["runAnalytics", "queryExecutiveMetrics", "fetchRawDataset", "executeCode"]
  };

  let candidates = intentMap[intent] || [];
  if (candidates.length === 0) {
    candidates = ["queryExecutiveMetrics", "getOverviewData", "getTaskListData"];
  }

  candidates = chatToolsService.getToolSchemasByNames(candidates)
    .map(schema => schema.function.name)
    .slice(0, topK);

  console.log(`[ToolRetrieve] 意图: ${intent}, 筛选出候选工具: ${candidates.join(', ')}`);

  return {
    candidateTools: candidates
  };
};

const fc_CheckSteps = async (state) => {
  return { 
    fc_current_step: state.fc_current_step + 1,
    fc_next_action: '',
  };
};

const fc_LlmToolCallStep = async (state, config) => {
  const emitter = config?.configurable?.sseEmitter;

  // 1. 步数控制
  const currentStep = state.fc_super_step_count;
  const maxSteps = RoutingPolicy.tiers[state.selected_tier]?.max_super_steps || 3;
  
  // 2. 组装历史消息 (openAI 格式严苛：System -> Human -> [AI -> Tool]* )
  // 必须保证最后一条是 HumanMessage 或 ToolMessage
  const safeHistory = [];
  const len = state.messages.length;
  
  // 基础历史：如果不是第一轮，寻找最近的有效 AI-Tool 对
  if (len > 0) {
    // 简单策略：提取所有已有的消息，并过滤掉可能导致 400 的非法中间态
    // LangChain 的 messages 数组如果是从 state 自动还原的，通常是安全的
    safeHistory.push(...state.messages);
  }

  const systemPrompt = `You are a professional Executive Chat data analyst. Your namespace is ${state.tool_namespace}. 
Current tier: ${state.selected_tier}.
Budget steps: ${maxSteps}. Current super-step: ${currentStep}.

GUIDELINES:
1. If you have enough data from tool results, provide a concise Markdown summary.
2. If tools failed or steps are exceeded, explain what happened and suggest alternatives.
3. Use tables or lists for data presentation.
4. When calling tools, use ONLY the tools provided in your tool belt.

${state.memoryContext || ''}`;

  const messagesToSend = [
    new SystemMessage(systemPrompt),
    new HumanMessage(state.userMessage),
    ...safeHistory
  ];

  // 3. 流式回调处理
  let textBuffer = "";
  const callbacks = [{
    handleLLMNewToken(token, idx, runId, parentRunId, tags, kwargs) {
      if (!emitter || typeof emitter.handleLLMNewToken !== 'function') return;
      
      const chunk = kwargs?.chunk;
      const additionalKwargs = chunk?.message?.additional_kwargs || chunk?.additional_kwargs || {};
      const deltaReasoning = additionalKwargs.reasoning_content || 
                             chunk?.choices?.[0]?.delta?.reasoning_content;

      if (deltaReasoning) {
        emitter.handleLLMNewToken(deltaReasoning, { isReasoning: true });
      } else if (token) {
        emitter.handleLLMNewToken(token, { isReasoning: false });
        textBuffer += token;
      }
    }
  }];

  // 4. 根据步数决定是否绑定工具
  const isOverCap = currentStep >= maxSteps;
  const llm = isOverCap ? getFcModel() : getLlmWithTools(state.candidateTools);
  const signal = config?.signal;

  try {
    const aiMessage = await llm.invoke(messagesToSend, { callbacks, signal });
    
    // 如果没有 tool_calls，标记为最终回复
    const hasTools = aiMessage.tool_calls && aiMessage.tool_calls.length > 0;
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

const fc_CheckDuplicate = async (state) => {
  const lastMsg = state.messages[state.messages.length - 1];
  if (!lastMsg || !lastMsg.tool_calls || lastMsg.tool_calls.length === 0) {
    return { fc_next_action: 'finalize' };
  }

  const scopeFp = chatSessionStateService.buildScopeFingerprint(state.regionScope);
  const newMessages = [];
  const pendingToolCalls = [];
  const toolResults = {};

  for (const toolCall of lastMsg.tool_calls) {
    const toolName = toolCall.name;
    const args = toolCall.args;
    const normalizedArgs = typeof args === 'string' ? args : JSON.stringify(args);
    const rawSig = `${toolName}|${normalizedArgs}|${scopeFp}`;
    const signature = crypto.createHash('md5').update(rawSig).digest('hex');
    const existingResult = Object.values(state.toolResults || {}).find(r => r.signature === signature);

    if (existingResult) {
      console.log(`[CheckDuplicate] 命中同图缓存: ${toolName}`);
      toolResults[toolCall.id] = existingResult;
      newMessages.push(new ToolMessage({
        tool_call_id: toolCall.id,
        name: toolName,
        content: existingResult.data
      }));
      continue;
    }

    const sessionCached = chatSessionStateService.getLatestBySignature(state.sessionId, signature, state.regionScope);
    if (sessionCached) {
      console.log(`[CheckDuplicate] 命中 Session 缓存: ${toolName}`);
      const newToolResult = { signature, data: sessionCached.data };
      toolResults[toolCall.id] = newToolResult;
      newMessages.push(new ToolMessage({
        tool_call_id: toolCall.id,
        name: toolName,
        content: sessionCached.data
      }));
      continue;
    }

    pendingToolCalls.push(toolCall);
  }

  if (pendingToolCalls.length === 0) {
    return {
      toolResults,
      messages: newMessages,
      fc_next_action: 'merge'
    };
  }

  return {
    toolResults,
    pending_tool_calls: pendingToolCalls,
    messages: newMessages,
    fc_next_action: 'validate'
  };
};

// T3 阶段二：真实的参数校验
// 因为我们无法穷举所有工具的 schema，实际业务中应该读取 toolModule.schema.function.parameters
// 然后动态转换为 Ajv 验证，或者如果是 Zod 定义的则直接执行 z.parse()
// 在这里为了 PoC，我们对核心工具（例如 queryExecutiveMetrics）应用明确的 Zod 约束

const fc_ValidateParams = async (state) => {
  const pendingToolCalls = state.pending_tool_calls || [];
  if (pendingToolCalls.length === 0) return { fc_next_action: 'finalize' };

  const validatedToolCalls = [];
  const toolResults = { ...(state.toolResults || {}) };
  const violationsByToolCall = {};
  const confidenceThreshold = RoutingPolicy.thresholds.ner_confidence ?? 0.85;
  const lowConfidenceEntities = Object.entries(state.entities_confidence || {}).filter(([, v]) => v < confidenceThreshold);

  for (const toolCall of pendingToolCalls) {
    const toolName = chatToolsService.normalizeToolName(toolCall.name);
    const args = typeof toolCall.args === 'object' && toolCall.args ? toolCall.args : (toolCall.args || {});
    const meta = chatToolsService.getToolMeta(toolName);
    const violations = [];

    console.log(`[fc_ValidateParams] 正在校验工具 ${toolName} 的参数...`);

    if (lowConfidenceEntities.length > 0 || toolName === 'clarify_intent') {
      const payload = {
        type: 'select',
        prompt: '我需要您确认具体的意图/选项',
        options: [{ id: 'O1', label: '选项一' }, { id: 'O2', label: '选项二' }],
        agent_id: 'executive_chat',
        resume_token: toolCall.id
      };
      return {
        human_in_the_loop_status: 'pending_interrupt',
        interrupt_payload: payload,
        hitl_status: 'pending_interrupt',
        hitl_payload: payload,
        fc_next_action: 'hitl'
      };
    }

    if (meta && meta.schema) {
      const schema = meta.schema;
      const required = Array.isArray(schema.required) ? schema.required : [];
      const properties = schema.properties || {};
      for (const req of required) {
        if (args[req] === undefined || args[req] === null || args[req] === '') {
          violations.push({ tool_call_id: toolCall.id, field: req, code: 'MISSING_PARAM', message: `缺失必要参数: ${req}`, repairable: true });
        }
      }
      for (const [field, propSchema] of Object.entries(properties)) {
        const value = args[field];
        if (value === undefined || value === null) continue;
        if (propSchema.enum && !propSchema.enum.includes(value)) {
          violations.push({ tool_call_id: toolCall.id, field, code: 'INVALID_ENUM', message: `字段 ${field} 的值不合法`, repairable: true, repairValue: propSchema.enum[0] });
        }
        if (propSchema.type === 'array' && !Array.isArray(value)) {
          violations.push({ tool_call_id: toolCall.id, field, code: 'INVALID_TYPE', message: `字段 ${field} 应为数组`, repairable: false });
        }
        if (propSchema.type === 'number' && typeof value !== 'number') {
          violations.push({ tool_call_id: toolCall.id, field, code: 'INVALID_TYPE', message: `字段 ${field} 应为数字`, repairable: false });
        }
        if (propSchema.type === 'string' && typeof value !== 'string') {
          violations.push({ tool_call_id: toolCall.id, field, code: 'INVALID_TYPE', message: `字段 ${field} 应为字符串`, repairable: false });
        }
      }
    }

    if (meta && meta.scopePolicy === 'national_only' && state.regionScope.type !== 'national') {
      violations.push({ tool_call_id: toolCall.id, field: 'scope', code: 'PERMISSION_DENIED', message: '该工具仅限全国权限用户使用', repairable: false });
    }

    if (violations.length > 0) {
      violationsByToolCall[toolCall.id] = violations;
      continue;
    }

    validatedToolCalls.push(toolCall);
  }

  if (Object.keys(violationsByToolCall).length > 0) {
    const hasUnrepairable = Object.values(violationsByToolCall).flat().some(v => !v.repairable);
    const maxRepairAttempts = RoutingPolicy.tiers[state.selected_tier]?.max_repair_attempts ?? 2;
    if (hasUnrepairable || state.fc_repair_attempts >= maxRepairAttempts) {
      const errorMsg = Object.values(violationsByToolCall).flat().map(v => v.message).join('; ');
      return {
        mode: 'chat_only',
        intent: 'chat_only',
        finalResponse: `SYSTEM_ERROR: 工具参数校验失败。${errorMsg}`,
        messages: [new AIMessage({ content: `很抱歉，我无法执行该操作：${errorMsg}。建议您提供更准确的信息。` })],
        fc_next_action: 'finalize'
      };
    }
    return {
      fc_repair_attempts: state.fc_repair_attempts + 1,
      repair_error_reason: JSON.stringify(violationsByToolCall),
      pending_tool_calls: pendingToolCalls,
      fc_next_action: 'repair'
    };
  }

  return {
    pending_tool_calls: validatedToolCalls,
    toolResults,
    fc_next_action: 'execute'
  };
};

const fc_ParamRepair = async (state) => {
  const pendingToolCalls = state.pending_tool_calls || [];
  let errorDetails = state.repair_error_reason || 'Missing or invalid parameters.';
  let repairedToolCalls = pendingToolCalls;
  try {
    const violationsByToolCall = JSON.parse(state.repair_error_reason || '{}');
    const repaired = pendingToolCalls.map((toolCall) => {
      const violations = violationsByToolCall[toolCall.id] || [];
      const args = typeof toolCall.args === 'object' && toolCall.args ? { ...toolCall.args } : {};
      for (const v of Array.isArray(violations) ? violations : []) {
        if (v.field && v.repairValue !== undefined) {
          args[v.field] = v.repairValue;
        }
      }
      return { ...toolCall, args };
    });
    repairedToolCalls = repaired;
    const messages = repaired.map(toolCall => new ToolMessage({
      tool_call_id: toolCall.id,
      name: toolCall.name,
      content: JSON.stringify({ repaired: true, toolCallId: toolCall.id })
    }));
    return {
      messages,
      pending_tool_calls: repaired,
      fc_next_action: 'validate'
    };
  } catch (e) {
    // fallback to raw string
  }

  const messages = pendingToolCalls.map(toolCall => new ToolMessage({
    tool_call_id: toolCall.id,
    name: toolCall.name,
    content: `Tool validation failed: ${errorDetails}`
  }));
  return { messages, pending_tool_calls: repairedToolCalls, fc_next_action: 'validate' };
};


const fc_ExecuteTool = async (state, config) => {
  const emitter = config?.configurable?.sseEmitter;
  const pendingToolCalls = state.pending_tool_calls || [];
  if (pendingToolCalls.length === 0) return { fc_next_action: 'merge' };

  const toolResults = {};
  const calledTools = [];

  for (const toolCall of pendingToolCalls) {
    const toolName = chatToolsService.normalizeToolName(toolCall.name);
    const internalToolName = toolName.startsWith(`${state.tool_namespace}.`)
      ? toolName.replace(`${state.tool_namespace}.`, '')
      : toolName;

    if (emitter && typeof emitter.handleToolStart === 'function') {
      emitter.handleToolStart({ name: internalToolName });
    }

    let finalResult;
    try {
      const rawResult = await chatToolsService.executeByName(
        internalToolName,
        toolCall.args || {},
        state.regionScope
      );
      finalResult = typeof rawResult === 'object' ? JSON.stringify(rawResult) : String(rawResult);
    } catch (err) {
      finalResult = JSON.stringify({ error: { code: 'EXECUTION_ERROR', message: err.message || '内部工具执行异常' } });
    }

    if (emitter && typeof emitter.handleToolEnd === 'function') {
      emitter.handleToolEnd(finalResult);
    }

    toolResults[toolCall.id] = { data: finalResult, signature: null };
    calledTools.push(internalToolName);
  }

  return { toolResults, calledTools, fc_next_action: 'merge' };
};

const fc_MergeToolResults = async (state) => {
  const lastMsg = state.messages[state.messages.length - 1];
  if (!lastMsg || !lastMsg.tool_calls || lastMsg.tool_calls.length === 0) {
    return { fc_super_step_count: state.fc_super_step_count + 1 };
  }

  const newMessages = [];
  const scopeFp = chatSessionStateService.buildScopeFingerprint(state.regionScope);

  for (const toolCall of lastMsg.tool_calls) {
    const resultObj = state.toolResults?.[toolCall.id];
    const resultData = resultObj?.data || JSON.stringify({ error: { code: 'NO_TOOL_RESULT', message: 'No data returned' } });
    newMessages.push(new ToolMessage({ tool_call_id: toolCall.id, name: toolCall.name, content: resultData }));

    if (resultObj && !resultObj.signature && !resultData.includes('NO_TOOL_RESULT')) {
      const args = toolCall.args;
      const normalizedArgs = typeof args === 'string' ? args : JSON.stringify(args);
      const rawSig = `${toolCall.name}|${normalizedArgs}|${scopeFp}`;
      const signature = crypto.createHash('md5').update(rawSig).digest('hex');
      chatSessionStateService.addRecord(state.sessionId, { signature, data: resultData }, state.regionScope);
    }
  }

  return { fc_super_step_count: state.fc_super_step_count + 1, messages: newMessages, pending_tool_calls: [], fc_next_action: '' };
};

const { interrupt } = require("@langchain/langgraph");

const humanInTheLoopGate = async (state) => {
  const payload = state.hitl_payload || state.interrupt_payload;
  console.log(`[HITL] 图执行流挂起，等待客户端发送 resume。 payload:`, payload);
  
  const userResponse = interrupt(payload);
  console.log(`[HITL] 已收到用户选择/确认:`, userResponse);
  const normalized = userResponse?.resumePayload || userResponse?.resume_payload || userResponse?.value || userResponse;
  const isIntentShift = normalized && normalized.resume_type === 'intent_shift';
  let messageContent = '';

  if (isIntentShift) {
    messageContent = `用户意图发生变更或选择了重新开始。新的输入是: ${JSON.stringify(normalized.value)}。请立即中止当前任务调用，返回提示让用户重新提问。`;
  } else {
    messageContent = `用户确认了选项/补充了信息: ${JSON.stringify(normalized?.value || normalized)}`;
  }

  return { 
    hitl_status: 'resumed',
    human_in_the_loop_status: 'resumed',
    hitl_payload: null,
    interrupt_payload: null,
    hitl_resume_payload: normalized,
    clarification_response: normalized,
    fc_next_action: isIntentShift ? 're_route' : 'validate',
    pending_tool_calls: [],
    messages: [
      new ToolMessage({
        tool_call_id: payload?.resume_token || 'unknown_token',
        name: 'clarify_intent',
        content: messageContent
      })
    ]
  };
};

const renderToolResultsMarkdown = (toolResults, intent) => {
  const keys = Object.keys(toolResults || {});
  if (keys.length === 0) return '';
  const taskRows = [];
  let totalRecordCount = 0;
  let hasError = false;

  keys.forEach((key, idx) => {
    const raw = toolResults[key]?.data || '';
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.error) {
        hasError = true;
      } else if (Array.isArray(parsed?.data)) {
        totalRecordCount += parsed.data.length;
        if (intent === 'project_status') {
          parsed.data.forEach((item) => {
            if (item && typeof item === 'object') {
              taskRows.push(item);
            }
          });
        }
      } else if (parsed?.data && typeof parsed.data === 'object') {
        totalRecordCount += 1;
      }
    } catch {
      // ignore parse failure and continue best-effort summarization
    }
  });

  if (intent === 'project_status' && taskRows.length > 0) {
    const preview = taskRows.slice(0, 6).map((task, idx) => {
      const title = task.title || `任务 ${idx + 1}`;
      const ddlAt = task.ddlAt || '未提供截止时间';
      const rate = Number.isFinite(Number(task.completionRate))
        ? `${Number(task.completionRate)}%`
        : '暂无';
      return `- ${title}（完成率：${rate}；截止：${ddlAt}）`;
    });
    return [
      '我为您整理了当前进行中的培训任务：',
      '',
      ...preview,
      '',
      taskRows.length > preview.length
        ? `已找到 ${taskRows.length} 个任务。可继续追问“按完成率从低到高排序”或“仅看本周到期任务”。`
        : '可继续追问“按完成率从低到高排序”或“仅看本周到期任务”。',
    ].join('\n');
  }

  if (totalRecordCount > 0) {
    return `我已为您提取核心数据（共 ${totalRecordCount} 条），如需更精确结果，可指定时间范围、大区或门店。`;
  }

  if (hasError) {
    return '我已完成查询，但本次部分数据源返回异常。建议重试，或指定更小范围（时间/大区/门店）后再查询。';
  }

  return '我已完成查询，但当前结果不足以生成稳定结论。建议指定时间范围、大区或门店后重试。';
};

const sanitizeUserFacingMarkdown = (content) => {
  const text = typeof content === 'string' ? content : '';
  if (!text) return text;
  const hasInternalMarkers =
    text.includes('执行已达到复杂度上限') ||
    text.includes('工具查询片段');
  if (!hasInternalMarkers) return text;
  return '我已完成查询并提取了核心数据。若需更精确结果，可指定时间范围、大区或门店，我会继续为您细化。';
};

const CHAT_ONLY_GREETING_RE = /^(你好|您好|hi|hello|谢谢|thanks|你是谁|你能做什么|help)([!！,.。?？\s]|$)/i;

const isGreetingLikeMessage = (message) => {
  if (typeof message !== 'string') return false;
  const text = message.trim();
  if (!text) return false;
  return CHAT_ONLY_GREETING_RE.test(text);
};

const finalResponseStep = async (state) => {
  let response = state.reply_markdown || state.finalResponse || "";
  if (!response) {
    if (state.mode === "deny" || state.global_safety_decision === "deny") {
      response = "### ⚠️ 请求被拒绝\n\n抱歉，Executive Chat 目前仅支持**只读查询**。我无法帮您执行修改数据、发送催办通知或直接处理业务流等操作。\n\n💡 *建议您可以在系统中手动处理，或询问我当前的数据完成情况。*";
    } else if (
      (state.mode === "chat_only" || state.intent === "chat_only") &&
      isGreetingLikeMessage(state.userMessage) &&
      Object.keys(state.toolResults || {}).length === 0
    ) {
      response = "你好！我是您的 Executive Chat 智能助理。我能帮您查询门店表现、任务完成率、下钻区域数据等。\n\n例如，您可以问我：\n- “本月华东区的新品培训完成率是多少？”\n- “有哪些门店需要重点关注？”";
    } else {
      if (state.mode === 'chat_only' || state.intent === 'chat_only') {
        console.warn('[FinalResponseStep] blocked_chat_only_greeting_fallback', {
          mode: state.mode,
          intent: state.intent,
          hasUserMessage: typeof state.userMessage === 'string' && state.userMessage.trim().length > 0,
          toolResultCount: Object.keys(state.toolResults || {}).length
        });
      }
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
