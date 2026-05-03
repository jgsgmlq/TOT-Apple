const { AIMessage, HumanMessage, SystemMessage, ToolMessage } = require("@langchain/core/messages");
const { ChatOpenAI } = require("@langchain/openai");
const { nanoid } = require('nanoid');
const { db } = require('../../db');
const { formatNowSqliteLocal } = require('../../utils/ddlAt');
const chatToolsService = require('../../services/chatToolsService');
const { memoryQueueProducer } = require("../queue/bullMqProducer");
const { chatWithToolsStream } = require('../../utils/ai');
// Langfuse 追踪: 复用 tracer.js 的单例 client，遵守 LANGFUSE_ENABLED / 采样率 / PII 脱敏 等全局开关。
const { getClient: getLangfuseClient, isSampled } = require('../../utils/tracer');
// langfuse-langchain CallbackHandler 在当前 @langchain/core v1.x 下不兼容，保留为 null
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
  // CRIT-3 修复后使用 .stream() 替代 .invoke() + callbacks，modelConfig 不必开启 streaming
  // .stream() 本身即为流式调用，双重 streaming 可能导致 bindTools 上下文丢失
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

  // 将记忆同时写入 state.memoryContext（供 Router/FC prompt 模板读取）和
  // state.messages（作为 SystemMessage，供 checkpoint 恢复后的 FC 循环复用）
  const updates = {
    memoryContext: memoryContextStr,
    memory_snippets: memorySnippets
  };
  if (memoryContextStr) {
    updates.messages = [new SystemMessage(memoryContextStr)];
  }
  return updates;
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
2. ONLY set mode to "chat_only" for pure greetings/smalltalk (hello, hi, thanks, who are you). If the user mentions ANY task name, product, store, region, or business metric — even without a question — use "tool_action" and infer the appropriate intent. Task/product names → query_metrics, store/region names → drill_down.
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
    // queryExecutiveMetrics 只用于明确任务+指标的查询，不在探索性意图中出现
    "query_metrics": ["queryExecutiveMetrics", "getOverviewData", "getRegionDetailData"],
    "project_status": ["getTaskListData", "getOverviewData"],
    "warning_query": ["getWarningsData", "getStoreDetailData", "getRegionDetailData"],
    "drill_down": ["getWarningsData", "getStoreDetailData", "getRegionDetailData"],
    "analytics_query": ["runAnalytics", "fetchRawDataset", "executeCode"]
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
  if (!emitter || typeof emitter.handleLLMNewToken !== 'function') {
    console.log('[fc_LlmToolCallStep] WARNING: emitter missing or invalid, SSE streaming disabled');
  }

  // 1. 步数控制
  const currentStep = state.fc_super_step_count;
  const maxSteps = RoutingPolicy.tiers[state.selected_tier]?.max_super_steps || 3;
  
  // 2. 组装历史消息：保留当前 FC 迭代的 assistant+tool 完整对
  //    在 plainMessages 转换层修复跨轮次的 tool_calls/tool 消息配对问题
  const safeHistory = [];
  for (const m of state.messages) {
    const lcRole = m._getType ? m._getType() : (m.role || '');
    if (lcRole === 'ai' && m.tool_calls && m.tool_calls.length > 0) {
      safeHistory.push(m); // 保留 assistant(tool_calls)
    } else if (lcRole === 'tool' || lcRole === 'function') {
      safeHistory.push(m); // 保留 tool 消息
    } else {
      safeHistory.push(m);
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

${state.memoryContext || ''}`;

  const messagesToSend = [
    new SystemMessage(systemPrompt),
    new HumanMessage(state.userMessage),
    ...safeHistory
  ];

  // 3. 流式输出：使用 chatWithToolsStream 直接调 DeepSeek API
  //    当下一步合并后将超限时，本步不给 tools，强制 LLM 做最终总结
  //    HITL resume 后用户已选择具体任务/指标，不给 tools 直接总结
  const isOverCap = (state.fc_super_step_count + 1) >= maxSteps || state.hitl_status === 'resumed';
  const signal = config?.signal;
  const toolSchemas = isOverCap
    ? []
    : chatToolsService.getToolSchemasByNames(state.candidateTools);

  console.log(`[fc_LlmToolCallStep] step=${currentStep}/${maxSteps}, tools=${toolSchemas.length}, hitl=${state.hitl_status || 'none'}`);

  // HITL resume 后，历史中最后一条 assistant(tool_calls) 没有对应的 tool response
  // （因为 HITL 中断了工具执行，并插入了 SystemMessage），DeepSeek API 要求
  // "tool_calls must be followed by tool messages"。
  // 此处剥离悬空 tool_calls，并移除后面所有孤儿 tool 消息（tool_call_id 匹配但
  // 前面已无 assistant(tool_calls) 的 tool 消息）。
  if (state.hitl_status === 'resumed') {
    let strippedToolCallIds = new Set();
    for (let i = messagesToSend.length - 1; i >= 0; i--) {
      const m = messagesToSend[i];
      const lcRole = m._getType ? m._getType() : (m.role || '');
      if ((lcRole === 'ai' || lcRole === 'assistant') && m.tool_calls && m.tool_calls.length > 0) {
        // 检查这条 tool_calls 后面是否有 tool 消息响应
        let hasToolResponse = false;
        for (let j = i + 1; j < messagesToSend.length; j++) {
          const next = messagesToSend[j];
          const nextRole = next._getType ? next._getType() : (next.role || '');
          if (nextRole === 'tool' || nextRole === 'function') {
            hasToolResponse = true;
            break;
          }
          if (nextRole === 'system' || nextRole === 'ai' || nextRole === 'assistant') {
            break;
          }
        }
        if (!hasToolResponse) {
          console.log(`[fc_LlmToolCallStep] HITL resumed: stripping dangling tool_calls from message[${i}]`);
          // 收集所有 tool_call_id 以便清理孤儿 tool 消息
          for (const tc of (m.tool_calls || [])) {
            strippedToolCallIds.add(tc.id);
          }
          m.tool_calls = undefined;
          m.additional_kwargs = m.additional_kwargs || {};
          delete m.additional_kwargs.tool_calls;
        }
        break; // 只处理最后一条 tool_calls，前面的应该已经配对了
      }
    }
    // 清理孤儿 tool 消息：移除 tool_call_id 匹配已剥离 tool_calls 的 tool 消息
    if (strippedToolCallIds.size > 0) {
      const cleaned = messagesToSend.filter((m) => {
        const lcRole = m._getType ? m._getType() : (m.role || '');
        if (lcRole === 'tool' || lcRole === 'function') {
          const tcid = m.tool_call_id || (m.lc_kwargs && m.lc_kwargs.tool_call_id);
          if (tcid && strippedToolCallIds.has(tcid)) {
            console.log(`[fc_LlmToolCallStep] HITL resumed: removing orphan tool message tool_call_id=${tcid}`);
            return false;
          }
        }
        return true;
      });
      // 替换 messagesToSend，注意这里不能直接给 messagesToSend 赋新值
      // 需要原地修改（splice）
      messagesToSend.length = 0;
      messagesToSend.push(...cleaned);
    }
  }

  try {
    const plainMessages = messagesToSend.map((m) => {
      const lcRole = m._getType ? m._getType() : (m.role || 'user');
      const roleMap = { human: 'user', ai: 'assistant', system: 'system', tool: 'tool', function: 'tool' };
      const role = roleMap[lcRole] || lcRole;
      let content = m.content || '';
      const tcid = m.tool_call_id;
      // 将 LangChain 格式 tool_calls ({id, name, args}) 转回 OpenAI 格式 ({id, type, function: {name, arguments}})
      let tc = m.tool_calls;
      if (tc && Array.isArray(tc) && tc.length > 0) {
        tc = tc.map(t => ({
          id: t.id,
          type: t.type || 'function',
          function: { name: t.name || t.function?.name || '', arguments: typeof t.args === 'string' ? t.args : JSON.stringify(t.args || t.function?.arguments || {}) }
        }));
      }
      if (role === 'assistant' && tc && tc.length > 0) {
        return { role, content, tool_calls: tc };
      }
      if (role === 'tool' && tcid) {
        return { role, tool_call_id: tcid, content };
      }
      return { role, content };
    });

    const result = await chatWithToolsStream({
      messages: plainMessages,
      tools: toolSchemas,
      tool_choice: toolSchemas.length > 0 ? 'auto' : undefined,
      onDelta: (token, info = {}) => {
        if (info.phase === 'reasoning' && emitter && typeof emitter.handleLLMNewToken === 'function') {
          emitter.handleLLMNewToken(token, { isReasoning: true });
        } else if (token && emitter && typeof emitter.handleLLMNewToken === 'function') {
          emitter.handleLLMNewToken(token, { isReasoning: false });
        }
      },
      signal,
    });

    // chatWithToolsStream 返回原始 OpenAI 格式: {id, type, function: {name, arguments}}
    // 下游节点(fc_CheckDuplicate等)期望 LangChain 格式: {id, name, args}
    const mergedToolCalls = (result.tool_calls || []).map(tc => ({
      id: tc.id,
      name: tc.function?.name || '',
      args: (() => { try { return JSON.parse(tc.function?.arguments || '{}'); } catch { return {}; } })(),
      type: tc.type || 'function',
    }));
    const fullContent = result.content || '';
    console.log(`[fc_LlmToolCallStep] 流结束: content长度=${fullContent.length}, toolCalls=${mergedToolCalls.length}, content前100字="${fullContent.slice(0,100)}"`);

    const aiMessage = new AIMessage({
      content: fullContent,
      tool_calls: mergedToolCalls.length > 0 ? mergedToolCalls : undefined,
    });

    const hasTools = mergedToolCalls.length > 0;
    const finalUpdates = {};

    if (hasTools) {
      // 有工具调用时，将 AIMessage(tool_calls) 写入 messages，供后续节点处理
      finalUpdates.messages = [aiMessage];
    } else {
      // 最终总结（无工具调用）：只写 reply_markdown/finalResponse，
      // 由 finalResponseStep 统一写入 AIMessage，避免重复。
      finalUpdates.reply_markdown = fullContent;
      finalUpdates.finalResponse = fullContent;
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
    const normalizedArgs = typeof args === 'string' ? args : JSON.stringify(args, Object.keys(args).sort());
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
  // HITL resume 后不再重复触发低置信度检查
  const justResumedFromHitl = state.hitl_status === 'resumed';

  for (const toolCall of pendingToolCalls) {
    const toolName = chatToolsService.normalizeToolName(toolCall.name);
    const args = typeof toolCall.args === 'object' && toolCall.args ? toolCall.args : (toolCall.args || {});
    const meta = chatToolsService.getToolMeta(toolName);
    const violations = [];

    console.log(`[fc_ValidateParams] 正在校验工具 ${toolName} 的参数...`);

    if (!justResumedFromHitl && (lowConfidenceEntities.length > 0 || toolName === 'clarify_intent')) {
      // 动态生成选项：优先执行工具获取真实数据作为选项
      const intent = state.intent || '';
      const wantsTaskPicker = intent === 'project_status' || toolName === 'getTaskListData';
      const wantsProgressPicker = intent === 'query_metrics' && lowConfidenceEntities.length > 0;

      let dynamicOptions = [];
      let _rawToolResult = null;

      if (wantsTaskPicker) {
        try {
          const tasksResult = await chatToolsService.executeByName('getTaskListData', {}, state.regionScope);
          _rawToolResult = tasksResult;
          const raw = typeof tasksResult === 'object' ? JSON.stringify(tasksResult) : String(tasksResult);
          const parsed = JSON.parse(raw);
          const rows = (parsed?.success ? parsed.data : null) || (Array.isArray(parsed) ? parsed : []);
          if (Array.isArray(rows) && rows.length > 0) {
            dynamicOptions = rows.slice(0, 8).map((t, i) => ({
              id: t.id || t.taskId || `task_${i}`,
              label: t.title || t.taskName || `任务 ${i + 1}`,
              value: { taskId: t.id || t.taskId, taskName: t.title || t.taskName },
            }));
          }
        } catch (e) { /* fall through to tool-based options */ }
      } else if (wantsProgressPicker) {
        try {
          const overviewResult = await chatToolsService.executeByName('getOverviewData', {}, state.regionScope);
          _rawToolResult = overviewResult;
          if (overviewResult && !overviewResult.error) {
            const entries = Object.entries(overviewResult).filter(([,v]) => v !== null && v !== undefined);
            dynamicOptions = entries.map(([k, v]) => ({
              id: `metric_${k}`,
              label: `${k}: ${typeof v === 'number' ? v.toFixed(1) : v}`,
              value: { metric: k },
            }));
          }
        } catch (e) { /* fall through */ }
      }

      // Fallback: 如果工具执行失败，使用工具名+实体标签
      if (dynamicOptions.length === 0) {
        const toolLabelMap = {
          getOverviewData: '查整体完成率/进度', getTaskListData: '查培训任务列表',
          getWarningsData: '查预警门店', getRegionDetailData: '查区域详细数据',
          getStoreDetailData: '查门店详细数据', queryExecutiveMetrics: '查高管指标矩阵',
          runAnalytics: '做高阶统计分析', fetchRawDataset: '获取原始数据集', executeCode: '执行代码分析',
        };
        dynamicOptions = pendingToolCalls.map(tc => ({
          id: tc.id,
          label: toolLabelMap[chatToolsService.normalizeToolName(tc.name)] || `执行 ${tc.name}`,
        }));
        for (const [ename] of lowConfidenceEntities) {
          dynamicOptions.push({ id: `clarify_${ename}`, label: state.entities?.[ename]?.raw || ename });
        }
      }

      const prompt = wantsTaskPicker
        ? `找到 ${dynamicOptions.length} 个任务，请选择要查看的任务：`
        : wantsProgressPicker
        ? '请选择要深入查看的指标：'
        : '请确认您要查询的方向：';

      // 将动态查询的原始结果写入 toolResults，以便 resume 后 LLM 能用真实数据总结
      const dynamicResultKey = `dynamic_clarify_${toolCall.id}`;
      const mergedToolResults = { ...toolResults };
      // _rawResultForLLM 保存工具返回的原始 JSON，供后续 LLM 总结使用
      if (typeof _rawToolResult !== 'undefined' && _rawToolResult !== null) {
        mergedToolResults[dynamicResultKey] = {
          data: typeof _rawToolResult === 'string' ? _rawToolResult : JSON.stringify(_rawToolResult),
          signature: null,
        };
      }

      const payload = {
        type: 'select',
        prompt,
        options: dynamicOptions,
        agent_id: 'executive_chat',
        resume_token: toolCall.id,
      };

      return {
        human_in_the_loop_status: 'pending_interrupt',
        interrupt_payload: payload,
        hitl_status: 'pending_interrupt',
        hitl_payload: { ...payload, _dynamicData: dynamicOptions },
        fc_next_action: 'hitl',
        toolResults: mergedToolResults,
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
  // 反向查找最近一条含 tool_calls 的 AIMessage（fc_CheckDuplicate 可能在末尾追加了 ToolMessage）
  let lastToolCallMsg = null;
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const msg = state.messages[i];
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      lastToolCallMsg = msg;
      break;
    }
  }
  if (!lastToolCallMsg) {
    return { fc_super_step_count: state.fc_super_step_count + 1 };
  }

  const newMessages = [];
  const scopeFp = chatSessionStateService.buildScopeFingerprint(state.regionScope);

  for (const toolCall of lastToolCallMsg.tool_calls) {
    const resultObj = state.toolResults?.[toolCall.id];
    const resultData = resultObj?.data || JSON.stringify({ error: { code: 'NO_TOOL_RESULT', message: 'No data returned' } });
    newMessages.push(new ToolMessage({ tool_call_id: toolCall.id, name: toolCall.name, content: resultData }));

    if (resultObj && !resultObj.signature && !resultData.includes('NO_TOOL_RESULT')) {
      const args = toolCall.args;
      const normalizedArgs = typeof args === 'string' ? args : JSON.stringify(args, Object.keys(args).sort());
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

  // 将低置信度实体统一提升到阈值以上，避免 ValidateParams 再次触发 HITL 死循环
  const boostedConfidence = {};
  if (!isIntentShift && state.entities_confidence) {
    for (const [k, v] of Object.entries(state.entities_confidence)) {
      boostedConfidence[k] = v < 0.85 ? 0.90 : v;
    }
  }

  // 如果用户选择了具体的任务/实体，直接路由到 LLM 总结，跳过工具执行
  let updatedEntities = state.entities || {};
  let updatedPendingToolCalls = isIntentShift ? [] : (state.pending_tool_calls || []);
  let directToLlm = false; // 是否跳过 validate/execute 直接去 LLM

  // 前端 HITL 选项值可能嵌套在 value.value 中（如 { action, value: { id, label, value: { taskId, taskName } } }）
  // 需要同时支持扁平结构和嵌套结构
  const resolveSelection = (obj) => {
    if (!obj || typeof obj !== 'object') return {};
    // 扁平结构：{ taskId: 'TASK_A', taskName: '...' }
    if (obj.taskId) return { taskId: String(obj.taskId), taskName: String(obj.taskName || obj.taskId) };
    // 前端选项嵌套结构：{ value: { taskId: 'TASK_A', taskName: '...' } }
    if (obj.value && typeof obj.value === 'object' && obj.value.taskId) {
      return { taskId: String(obj.value.taskId), taskName: String(obj.value.taskName || obj.value.taskId) };
    }
    // 指标选择
    if (obj.metric) return { metric: String(obj.metric) };
    if (obj.value && typeof obj.value === 'object' && obj.value.metric) {
      return { metric: String(obj.value.metric) };
    }
    return {};
  };

  if (!isIntentShift && typeof normalized === 'object' && normalized !== null && !Array.isArray(normalized)) {
    const sel = resolveSelection(normalized);
    if (sel.taskId) {
      updatedEntities = {
        ...updatedEntities,
        taskId: { raw: sel.taskId, canonical: sel.taskId, confidence: 0.95 },
        taskName: { raw: sel.taskName, canonical: sel.taskName, confidence: 0.95 },
      };
      updatedPendingToolCalls = [];
      directToLlm = true;
      // 从 toolResults 中提取 HITL 前动态查询到的真实数据，只注入用户选择的任务
      let toolDataContext = '';
      const toolResults = state.toolResults || {};
      for (const [key, result] of Object.entries(toolResults)) {
        if (key.startsWith('dynamic_clarify_') && result?.data) {
          try {
            const allTasks = typeof result.data === 'string' ? JSON.parse(result.data) : result.data;
            if (Array.isArray(allTasks)) {
              const matched = allTasks.find(t => (t.taskId || t.id) === sel.taskId);
              if (matched) {
                toolDataContext += `\n\n[用户选择的任务真实数据，请严格基于此数据仅回答该任务]\n${JSON.stringify(matched)}`;
              }
            } else {
              toolDataContext += `\n\n[工具查询原始数据]\n${typeof result.data === 'string' ? result.data : JSON.stringify(result.data)}`;
            }
          } catch {
            toolDataContext += `\n\n[工具查询原始数据]\n${typeof result.data === 'string' ? result.data : JSON.stringify(result.data)}`;
          }
        }
      }
      messageContent = `用户选择了任务「${sel.taskName}」(ID: ${sel.taskId})。${toolDataContext ? '请严格基于以下该任务的真实数据，给出一条简洁的分析（完成率、进度、预警状态等），不要列出其他任务，不要编造。' + toolDataContext : '请基于之前已获取的工具查询结果给出分析。'}`;
    } else if (sel.metric) {
      updatedEntities = { ...updatedEntities, [sel.metric]: { raw: sel.metric, canonical: sel.metric, confidence: 0.90 } };
      updatedPendingToolCalls = [];
      directToLlm = true;
      let toolDataContext = '';
      const toolResults = state.toolResults || {};
      for (const [key, result] of Object.entries(toolResults)) {
        if (key.startsWith('dynamic_clarify_') && result?.data) {
          toolDataContext += `\n\n[工具查询原始数据，请严格基于此数据回答]\n${result.data}`;
        }
      }
      messageContent = `用户选择了指标: ${sel.metric}。${toolDataContext ? '请严格基于以下真实数据给出分析，不要编造：' + toolDataContext : '请基于已有的查询结果分析。'}`;
    }
  }

  return {
    hitl_status: 'resumed',
    human_in_the_loop_status: 'resumed',
    hitl_payload: null,
    interrupt_payload: null,
    hitl_resume_payload: normalized,
    clarification_response: normalized,
    entities: updatedEntities,
    entities_confidence: Object.keys(boostedConfidence).length > 0 ? boostedConfidence : undefined,
    fc_next_action: isIntentShift ? 're_route' : (directToLlm ? 'llm_direct' : 'validate'),
    pending_tool_calls: updatedPendingToolCalls,
    messages: [
      new SystemMessage(`[用户选择结果] ${messageContent}`)
    ]
  };
};

const renderToolResultsMarkdown = (toolResults, intent) => {
  const keys = Object.keys(toolResults || {});
  if (keys.length === 0) return '';
  const taskRows = [];
  const summaryMetrics = [];
  let totalRecordCount = 0;
  let hasError = false;

  keys.forEach((key, idx) => {
    const raw = toolResults[key]?.data || '';
    try {
      const parsed = JSON.parse(raw);
      // 格式1: { error: {...} }
      if (parsed?.error) {
        hasError = true;
        return;
      }
      // 格式2: { success: true/false, data: [...] }
      if (parsed?.success !== undefined) {
        if (parsed.success === false) { hasError = true; return; }
        const inner = parsed.data;
        if (Array.isArray(inner)) {
          totalRecordCount += inner.length;
          inner.forEach(item => { if (item && typeof item === 'object') taskRows.push(item); });
        } else if (inner && typeof inner === 'object') {
          totalRecordCount += 1;
          taskRows.push(inner);
        }
        return;
      }
      // 格式3: { data: [...] } or { data: {...} }
      if (Array.isArray(parsed?.data)) {
        totalRecordCount += parsed.data.length;
        parsed.data.forEach(item => { if (item && typeof item === 'object') taskRows.push(item); });
      } else if (parsed?.data && typeof parsed.data === 'object') {
        totalRecordCount += 1;
        taskRows.push(parsed.data);
      } else {
        // 格式4: 扁平对象 { totalAssignments, completionRate, ... }
        totalRecordCount += 1;
        summaryMetrics.push(parsed);
      }
    } catch {
      // 非 JSON 字符串，尝试作为纯文本展示
      if (raw && typeof raw === 'string' && raw.trim()) {
        totalRecordCount += 1;
        summaryMetrics.push({ _text: raw.trim().slice(0, 200) });
      }
    }
  });

  // 渲染项目状态表格
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
        ? `已找到 ${taskRows.length} 个任务。可继续追问"按完成率从低到高排序"或"仅看本周到期任务"。`
        : '可继续追问"按完成率从低到高排序"或"仅看本周到期任务"。',
    ].join('\n');
  }

  // 渲染汇总指标（query_metrics / progress_query 等）
  if (summaryMetrics.length > 0) {
    const lines = [];
    for (const m of summaryMetrics) {
      if (m._text) { lines.push(m._text); continue; }
      // 常见指标的中文映射
      const labelMap = {
        totalAssignments: '总任务量', completedCount: '已完成', inProgressCount: '进行中',
        pendingCount: '待开始', completionRate: '完成率(%)', onTimeCompletionRate: '按时完成率(%)',
        avgCompletionTimeHours: '平均耗时(小时)', total: '总数', completed: '已完成',
        rowCount: '记录数',
      };
      const entries = Object.entries(m).filter(([, v]) => v !== null && v !== undefined);
      if (entries.length === 0) continue;
      lines.push(entries.map(([k, v]) => {
        const label = labelMap[k] || k;
        if (v === null || v === undefined) return '';
        if (typeof v === 'object') return `${label}: ${JSON.stringify(v)}`;
        return typeof v === 'number' ? `${label}: ${v}` : `${label}: ${v}`;
      }).filter(Boolean).join('，'));
    }
    if (lines.length > 0) {
      return `📊 查询结果：\n\n${lines.join('\n\n')}\n\n可继续追问更多细节。`;
    }
  }

  // 渲染有行数据的表格（通用）
  if (taskRows.length > 0) {
    const preview = taskRows.slice(0, 5);
    const headers = Object.keys(preview[0] || {}).filter(k => !k.startsWith('_')).slice(0, 4);
    const headerRow = '| ' + headers.join(' | ') + ' |';
    const sepRow = '|' + headers.map(() => '---').join('|') + '|';
    const dataRows = preview.map(row =>
      '| ' + headers.map(h => String(row[h] ?? '')).join(' | ') + ' |'
    );
    return [
      `查询到 ${taskRows.length} 条记录：`,
      '',
      headerRow,
      sepRow,
      ...dataRows,
      '',
      taskRows.length > 5 ? `（仅展示前5条，共${taskRows.length}条。可继续追问以缩小范围）` : '',
    ].join('\n');
  }

  if (totalRecordCount > 0) {
    return `查询到 ${totalRecordCount} 条数据，但无法解析为表格。建议换个更具体的问题。`;
  }

  if (hasError) {
    return '查询时部分数据源返回异常。建议缩小范围（如指定大区或门店）后重试。';
  }

  return '';
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
      isGreetingLikeMessage(state.userMessage)
    ) {
      response = "你好！我是您的 Executive Chat 智能助理。我能帮您查询门店表现、任务完成率、下钻区域数据等。\n\n例如，您可以问我：\n- 本月华东区的新品培训完成率是多少？\n- 有哪些门店需要重点关注？";
    } else if (state.mode === "chat_only" || state.intent === "chat_only") {
      // Router 误判为 chat_only 但用户其实问了业务相关内容，引导用户换个问法
      console.warn('[FinalResponseStep] chat_only_non_greeting', {
        message: (state.userMessage || '').slice(0, 80),
        toolResultCount: Object.keys(state.toolResults || {}).length
      });
      response = "我不太确定您想查什么。您可以直接问我，例如：\n- 某个培训任务的完成率是多少？\n- 华东区有哪些门店需要关注？\n- 当前进行中的任务有哪些？";
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
  
  // 3. T5 阶段二: 更新 Langfuse Trace 元数据（复用 tracer.js 单例，遵守全局开关与采样率）
  const traceId = config?.configurable?.traceId;
  if (traceId && isSampled(state.sessionId)) {
    try {
      const lf = getLangfuseClient();
      if (lf) {
        lf.trace({ id: traceId }).update({
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
      }
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
