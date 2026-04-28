const { AIMessage } = require("@langchain/core/messages");

const { memoryQueueProducer } = require("../queue/bullMqProducer");

// == 骨架节点实现（Mock 测试逻辑） ==

const loadContext = async (state) => {
  // Mock 短期记忆注入
  const recentContextStr = "[近期记忆] 用户本周重点看新品培训任务";
  console.log(`[T4 记忆注入] LoadContext: ${recentContextStr}`);
  return { ...state }; // 在真实场景会拼接到系统 prompt
};

const contextAnalyzerRouter = async (state) => {
  const msg = state.userMessage || "";
  if (msg.includes("发邮件") || msg.includes("修改")) {
    return { safety: "deny", intent: "chat_only" };
  } else if (msg.includes("你好")) {
    return { safety: "allow", intent: "chat_only" };
  } else {
    return { 
      safety: "allow", 
      intent: "tool_action",
      entities: { "metric": { raw: "营收", canonical: "revenue", confidence: 0.9 } }
    };
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

  if (state.fc_super_step_count >= 1) {
    if (emitter && typeof emitter.handleLLMNewToken === 'function') {
      emitter.handleLLMNewToken("根", { isReasoning: true });
      emitter.handleLLMNewToken("据数据，营收为100万。");
    }
    return { messages: [new AIMessage({ content: "根据数据，营收为100万。" })] };
  }
  
  if (emitter && typeof emitter.handleLLMNewToken === 'function') {
    emitter.handleLLMNewToken("正在思考...");
  }

  const toolName = state.userMessage.includes("全国") 
    ? "executive_chat.query_national_analytics" 
    : "executive_chat.query_analytics";

  // 根据用户输入动态 mock 参数，如果包含"无地点"就故意漏掉 region_id 以触发 T3 的 Fail Fast 测试
  const args = state.userMessage.includes("无地点") 
    ? { metric: "revenue" } 
    : { metric: "revenue", region_id: "all" };

  return { 
    messages: [
      new AIMessage({
        content: "",
        tool_calls: [{
          id: "call_mock123",
          name: toolName,
          args: args
        }]
      })
    ] 
  };
};

const fc_CheckDuplicate = async (state) => {
  return { ...state };
};

const fc_ValidateParams = async (state) => {
  const lastMsg = state.messages[state.messages.length - 1];
  if (!lastMsg || !lastMsg.tool_calls || lastMsg.tool_calls.length === 0) return { ...state };
  
  const toolCall = lastMsg.tool_calls[0];
  
  // T3 模拟: 强制触发参数校验失败 (比如需要 "region_id" 但未提供)
  if (toolCall.name === "executive_chat.query_analytics" && !toolCall.args.region_id) {
    if (state.fc_repair_attempts >= 2) {
      // 超过重试上限，触发直接抛错（Fail Fast）
      console.log("[T3 护栏] 参数修复超限，执行 Fail Fast 中止");
      return { 
        intent: "chat_only", // 降级以终止 FC
        finalResponse: "SYSTEM_ERROR: 工具参数校验失败，且已超过最大自动修复次数。缺少必填项：region_id",
        messages: [new AIMessage({ content: "很抱歉，我缺少查询所需的具体地区信息，且自动补充失败，请重新描述。" })]
      };
    }
    // 未超限，进入 Repair 闭环
    console.log(`[T3 护栏] 参数校验失败 (尝试 ${state.fc_repair_attempts + 1})，触发修复循环...`);
    return { fc_repair_attempts: state.fc_repair_attempts + 1 };
  }
  
  return { ...state };
};

const fc_ParamRepair = async (state) => {
  // Mock大模型修参行为，这里可以假装我们往 messages 中加入了一个系统提示“请修复参数”
  // 简单起见，仅状态计数加 1，并回吐给 LLM 重新生成
  return { ...state }; // 次数已在 Validate 中增加
};

const fc_ExecuteTool = async (state, config) => {
  const emitter = config?.configurable?.sseEmitter;
  const lastMsg = state.messages[state.messages.length - 1];
  const toolCall = lastMsg?.tool_calls?.[0] || {};
  const toolName = toolCall.name || "executive_chat.unknown";

  // T3: 命名空间隔离与硬校验
  if (!toolName.startsWith(state.tool_namespace)) {
    throw new Error(`权限受限：仅允许访问 ${state.tool_namespace} 命名空间下的工具`);
  }

  // T3: Scope/national_only 硬校验
  if (state.regionScope.type === "store" && toolName.includes("national")) {
    throw new Error(`越权拦截：门店级用户无法调用全局层级工具 (${toolName})`);
  }
  
  if (emitter && typeof emitter.handleToolStart === 'function') {
    emitter.handleToolStart({ name: toolName });
  }

  // Mock 执行工具耗时
  const mockData = `成功执行了 ${toolName}，传入参数: ${JSON.stringify(toolCall.args || {})}`;

  if (emitter && typeof emitter.handleToolEnd === 'function') {
    emitter.handleToolEnd(mockData);
  }

  return { 
    toolResults: { [toolCall.id]: { data: mockData } }
  };
};

const fc_MergeToolResults = async (state) => {
  return { fc_super_step_count: state.fc_super_step_count + 1 };
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