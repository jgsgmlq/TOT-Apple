const { AIMessage, HumanMessage, SystemMessage, ToolMessage } = require("@langchain/core/messages");
const { ChatOpenAI } = require("@langchain/openai");
const chatToolsService = require('../../services/chatToolsService');
const { memoryQueueProducer } = require("../queue/bullMqProducer");

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
const getLlmWithTools = () => {
  const bindableTools = [];
  chatToolsService.TOOL_SCHEMAS.forEach((schema) => {
    if (schema.function) {
      // 兼容原版的 schema 定义，将其包装成 Langchain bindTools 可接受的标准 OpenAI tools 格式
      bindableTools.push({
        type: "function",
        function: {
          name: schema.function.name,
          description: schema.function.description,
          parameters: schema.function.parameters
        }
      });
    }
  });
  return getFcModel().bindTools(bindableTools);
};

// == 图节点实现 (真实落地) ==

const loadContext = async (state) => {
  // 短期记忆注入（暂时留存 T4 简单字符串版，因为真实 Store 检索还未打通）
  const recentContextStr = "[近期记忆] 本周重点看新品培训任务";
  console.log(`[T4 记忆注入] LoadContext: ${recentContextStr}`);
  return { ...state };
};

const contextAnalyzerRouter = async (state) => {
  console.log(`[Router] 正在请求意图分类模型... 输入: ${state.userMessage}`);
  
  // T1 阶段二: 真实接入 LLM 进行意图分发
  const schemaDefinition = `
You are a highly efficient JSON routing bot for "Executive Chat".
Your task is to analyze the user's message and strictly output valid JSON matching this schema:
{
  "safety": "allow" | "deny", // return "deny" ONLY IF user asks to write/update/delete database, or send notifications/emails automatically. 
  "intent": "chat_only" | "tool_action", // return "chat_only" ONLY IF the user says "hello", "hi", "thanks" or asks unrelated chit-chat.
  "entities": {
    "metric": { "raw": string, "canonical": string, "confidence": number } 
    // extract metrics, regions, stores, etc.
  },
  "complexity_score": number // 0.0 to 1.0 (estimate how hard the query is, e.g. "national revenue" is 0.2, "correlations between region A and B" is 0.9)
}
NEVER wrap your response in markdown code blocks. OUTPUT RAW JSON ONLY.
  `;

  const messages = [
    new SystemMessage(schemaDefinition),
    new HumanMessage(state.userMessage)
  ];

  let rawJson = "";
  try {
    const res = await getRouterModel().invoke(messages);
    rawJson = res.content.trim();
    
    // Fallback: strip markdown JSON block if model misbehaved
    if (rawJson.startsWith('```json')) {
      rawJson = rawJson.replace(/^```json/, '').replace(/```$/, '').trim();
    }
    
    const parsed = JSON.parse(rawJson);
    console.log(`[Router] 解析结果:`, parsed);
    
    return { 
      safety: parsed.safety || "allow", 
      intent: parsed.intent || "tool_action",
      entities: parsed.entities || {},
      // 根据复杂度定级，这里实现一个极其简单的判定逻辑
      selected_tier: (parsed.complexity_score >= 0.7) ? "L4_heavy_fc" : ((parsed.complexity_score <= 0.35) ? "L2_intent_fastpath" : "L3_fc_guarded")
    };
  } catch (err) {
    console.error(`[Router] 意图解析失败，降级为默认安全流转. Raw: ${rawJson}`, err);
    // 降级策略
    return { safety: "allow", intent: "tool_action", selected_tier: "L3_fc_guarded", entities: {} };
  }
};

const toolRetrieve = async (state) => {
  return { ...state };
};

const fc_CheckSteps = async (state) => {
  return { fc_current_step: state.fc_current_step + 1 };
};

const fc_LlmToolCallStep = async (state, config) => {
  const trimMessages = (msgs) => msgs.slice(-10);
  const recentMessages = trimMessages(state.messages);

  const emitter = config?.configurable?.sseEmitter;

  // 如果已经达到了最大的步骤（由 RoutingPolicy 决定，这里简单假设是 3），强制要求 LLM 不要再返回工具，直接出答案
  const currentStep = state.fc_super_step_count;
  const maxSteps = state.selected_tier === "L4_heavy_fc" ? 5 : (state.selected_tier === "L2_intent_fastpath" ? 1 : 3);
  
  // 组装最终传给大模型的 Message 数组
  // OpenAI 对历史消息顺序有极高要求。在 PoC 阶段为了绝对稳定，每次都只给最新的 System 和 Human Message，
  // 加上本轮产生的新 ToolResult (如果有)。
  const safeHistory = [];
  const len = state.messages.length;
  if (len >= 2) {
    const lastMsg = state.messages[len - 1];
    const prevMsg = state.messages[len - 2];
    // 如果最后一条是 ToolMessage，并且前一条是产生这个 Tool 的 AIMessage，那么我们就把这一对合法历史带上
    if (lastMsg._getType() === "tool" && prevMsg._getType() === "ai" && prevMsg.tool_calls?.some(c => c.id === lastMsg.tool_call_id)) {
      safeHistory.push(prevMsg);
      safeHistory.push(lastMsg);
    }
  } else if (len === 1) {
    // 处理因为 AI 生成错误被降级而产生的孤立信息
    const singleMsg = state.messages[0];
    if (singleMsg._getType() === "ai" && (!singleMsg.tool_calls || singleMsg.tool_calls.length === 0)) {
        safeHistory.push(singleMsg);
    }
  }

  const messagesToSend = [
    new SystemMessage(`You are Executive Chat data analyst. Your namespace is ${state.tool_namespace}. 
Your current tier is ${state.selected_tier}, allowed steps: ${maxSteps}, current step: ${currentStep}.
If you have enough information, write a markdown summary.
When calling tools, omit the namespace prefix.`),
    new HumanMessage(state.userMessage),
    ...safeHistory
  ];

  // T2 阶段二: 真实落地 - 流式回调与 reasoning 截获
  let textBuffer = "";
  const callbacks = [{
    handleLLMNewToken(token, idx, runId, parentRunId, tags, kwargs) {
      if (!emitter || typeof emitter.handleLLMNewToken !== 'function') return;
      
      // 尝试从 Langchain 的底层 Chunk 中解析 DeepSeek R1 的 reasoning_content
      // 取决于 @langchain/openai 版本，可能在 kwargs.chunk.message.additional_kwargs.reasoning_content
      // 或者 kwargs.chunk.choices[0].delta.reasoning_content
      const chunk = kwargs?.chunk;
      const additionalKwargs = chunk?.message?.additional_kwargs || chunk?.additional_kwargs || {};
      const deltaReasoning = additionalKwargs.reasoning_content || 
                             chunk?.choices?.[0]?.delta?.reasoning_content;

      if (deltaReasoning) {
        emitter.handleLLMNewToken(deltaReasoning, { isReasoning: true });
      } else if (token) {
        // 常规文本输出
        emitter.handleLLMNewToken(token, { isReasoning: false });
        textBuffer += token;
      }
    }
  }];

  // 根据步数决定是否绑定工具
  const llm = currentStep >= maxSteps ? getFcModel() : getLlmWithTools();
  
  try {
    const aiMessage = await llm.invoke(messagesToSend, { callbacks });
    // 将 LangChain 产生的 Tool Calls 打回 state，确保带有正确的 ID 和参数
    return { messages: [aiMessage] };
  } catch (err) {
    console.error("[fc_LlmToolCallStep] 大模型调用失败:", err);
    return { messages: [new AIMessage({ content: `系统异常: 大模型响应失败 ${err.message}` })] };
  }
};

const fc_CheckDuplicate = async (state) => {
  return { ...state };
};

const fc_ValidateParams = async (state) => {
  const lastMsg = state.messages[state.messages.length - 1];
  if (!lastMsg || !lastMsg.tool_calls || lastMsg.tool_calls.length === 0) return { ...state };
  
  const toolCall = lastMsg.tool_calls[0];
  const toolName = toolCall.name;
  
  console.log(`[T3 护栏] 开始校验 ${toolName} 的参数:`, toolCall.args);

  // 这里应该接入真实的 Zod 或 JSON Schema 校验。
  // 为了确保图的通用流转，我们做一个简单的必填项兜底检查。
  let hasError = false;
  let missingParam = "";

  if (toolName.includes("queryExecutiveMetrics") && !toolCall.args.dimensions) {
     hasError = true;
     missingParam = "dimensions";
  }

  if (hasError) {
    if (state.fc_repair_attempts >= 2) {
      console.log("[T3 护栏] 参数修复超限，执行 Fail Fast 中止");
      return { 
        intent: "chat_only", 
        finalResponse: `SYSTEM_ERROR: 工具参数校验失败。缺少必填项：${missingParam}`,
        messages: [new AIMessage({ content: `很抱歉，我缺少查询所需的关键信息 [${missingParam}]，且自动补充失败，请重新提供。` })]
      };
    }
    console.log(`[T3 护栏] 参数校验失败 (尝试 ${state.fc_repair_attempts + 1})，触发修复循环...`);
    return { fc_repair_attempts: state.fc_repair_attempts + 1 };
  }
  
  return { ...state };
};

const fc_ParamRepair = async (state) => {
  // 把系统报错（比如缺参数）作为 Tool Message 塞回给模型，要求它自己修复
  const lastMsg = state.messages[state.messages.length - 1];
  const toolCall = lastMsg.tool_calls[0];
  
  const errorMessage = `Tool execution failed: Missing required parameter 'dimensions'. Please provide it or ask the user to clarify.`;
  
  return { 
    messages: [new ToolMessage({
      tool_call_id: toolCall.id,
      name: toolCall.name,
      content: errorMessage
    })]
  };
};


const fc_ExecuteTool = async (state, config) => {
  const emitter = config?.configurable?.sseEmitter;
  const lastMsg = state.messages[state.messages.length - 1];
  const toolCall = lastMsg?.tool_calls?.[0] || {};
  const toolName = toolCall.name || "executive_chat.unknown";
  
  // T3: 命名空间处理（兼容 legacy registry）
  // 假设旧版 chatToolsService 里注册的工具名是不带 "executive_chat." 前缀的
  const internalToolName = toolName.replace(`${state.tool_namespace}.`, '');

  // T3: Scope 硬校验保护
  if (state.regionScope.type === "store" && internalToolName.includes("national")) {
    console.log(`[fc_ExecuteTool] 越权拦截：门店级用户无法调用全局层级工具 (${toolName})`);
    return { 
      toolResults: { [toolCall.id]: { data: `Permission Denied: User role 'store' cannot access '${toolName}'` } }
    };
  }
  
  if (emitter && typeof emitter.handleToolStart === 'function') {
    emitter.handleToolStart({ name: internalToolName });
  }

  // T3 阶段二：真实落地 - 调用真实的工具执行服务
  let finalResult;
  try {
    const rawResult = await chatToolsService.executeByName(
      internalToolName, 
      toolCall.args || {}, 
      state.regionScope
    );
    // Legacy 约定：即使出错，也通常包含在返回对象的 error 字段或直接作为字符串返回
    finalResult = typeof rawResult === 'object' ? JSON.stringify(rawResult) : String(rawResult);
  } catch (err) {
    console.error(`[fc_ExecuteTool] 执行工具 ${internalToolName} 失败:`, err);
    finalResult = JSON.stringify({ error: err.message || "内部工具执行异常" });
  }

  if (emitter && typeof emitter.handleToolEnd === 'function') {
    emitter.handleToolEnd(finalResult);
  }

  return { 
    toolResults: { [toolCall.id]: { data: finalResult } }
  };
};

const fc_MergeToolResults = async (state) => {
  const lastMsg = state.messages[state.messages.length - 1];
  const toolCall = lastMsg?.tool_calls?.[0];
  
  if (!toolCall) return { fc_super_step_count: state.fc_super_step_count + 1 };
  
  const resultData = state.toolResults[toolCall.id]?.data || "No data returned";
  
  // LangChain 标准 ToolMessage 格式要求
  // 使用 type "tool" 或 ToolMessage 类来满足 OpenAI 对上下文历史的强制要求
  return { 
    fc_super_step_count: state.fc_super_step_count + 1,
    messages: [new ToolMessage({
      tool_call_id: toolCall.id,
      name: toolCall.name,
      content: resultData
    })]
  };
};

const humanInTheLoopGate = async (state) => {
  return { hitl_status: "pending_interrupt" };
};

const finalResponseStep = async (state) => {
  let response = state.finalResponse || "";
  if (!response) {
    if (state.safety === "deny") response = "DENY_MESSAGE";
    else if (state.intent === "chat_only") response = "CHAT_MESSAGE";
  }
  
  return { 
    finalResponse: response,
    messages: [new AIMessage({ content: response })]
  };
};

const persistAndEmit = async (state) => {
  // Fire & Forget 发布 MemoryIngestRequested 事件
  memoryQueueProducer.publishMemoryIngestion({
    userId: state.userId || "mock_user_1",
    sessionId: state.sessionId,
    userMessage: state.userMessage,
    finalResponse: state.finalResponse
  }).catch(e => console.error("发布记忆事件失败:", e));
  
  // T5 模拟：在流程结束时打点 Langfuse Metadata (或 Trace update)
  console.log(`[T5 观测打点] Trace Metadata Update:`);
  console.log(`  - selected_tier: ${state.selected_tier}`);
  console.log(`  - fc_steps_used: ${state.fc_super_step_count}`);
  console.log(`  - repair_attempts: ${state.fc_repair_attempts}`);
  console.log(`  - intent: ${state.intent}`);
  if (state.finalResponse && state.finalResponse.includes("SYSTEM_ERROR")) {
    console.log(`  - error_code: TOOL_PARAM_ERROR`);
  }

  return { ...state };
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
  finalResponseStep
};