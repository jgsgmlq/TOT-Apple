'use strict';

const { AIMessage, HumanMessage, SystemMessage } = require("@langchain/core/messages");
const { buildFcEntityBlock } = require('./resolveEntities');
const { startNodeSpan } = require('../shared/spanHelper');
const { getClient, endGeneration, endSpan, maskPII, preview, NOOP_TRACE } = require('../../../utils/tracer');
const chatToolsService = require('../../../services/chatToolsService');
const promptRegistry = require('../../../prompts/registry');

const { fcModel } = require('../llm');
const trace = require('../shared/runTrace');
const { logAgentTrace } = require('../shared/agentTraceLog');

const getFcModel = () => fcModel;

// 动态将 chatToolsService 中所有的 Schema 转换为 LangChain bindTools 可用的格式
const getLlmWithTools = () => {
  const allToolNames = chatToolsService.getRegisteredToolNames();
  const finalTools = chatToolsService.getToolSchemasByNames(allToolNames).map((schema) => ({
    type: "function",
    function: {
      name: schema.function.name,
      description: schema.function.description,
      parameters: schema.function.parameters
    }
  }));

  return finalTools.length > 0 ? getFcModel().bindTools(finalTools) : getFcModel();
};

const fc_LlmToolCallStep = async (state, config) => {
  const emitter = config?.configurable?.sseEmitter;
  const traceId = config?.configurable?.traceId;

  const client = getClient();
  const fcGen = client && traceId
    ? client.generation({ traceId, name: 'FC_LLM_Tool_Decision', model: 'deepseek-chat', input: maskPII(preview(state.userMessage)), metadata: { step: state.fc_super_step_count } })
    : NOOP_TRACE.generation({ name: 'FC_LLM_Tool_Decision' });

  // 1. 步数控制
  const currentStep = state.fc_super_step_count;
  const maxSteps = Number(process.env.MAX_FC_ROUNDS) || 3;
  trace.nodeEnter(emitter, state, 'fc_LlmToolCallStep', { step: currentStep, maxSteps });

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

  // 上下文截断：防止长会话 tokens 超限。保留最近 N 条消息，N 由环境变量
  // FC_HISTORY_MAX_MESSAGES 控制（默认 30，覆盖典型 5-6 轮对话含工具调用）。
  // 截断时保留消息顺序（System → Human → [AI → Tool]*），确保末尾仍是 Human/Tool。
  const FC_HISTORY_MAX = Number(process.env.FC_HISTORY_MAX_MESSAGES || 30);
  if (safeHistory.length > FC_HISTORY_MAX) {
    const trimmed = safeHistory.slice(-FC_HISTORY_MAX);
    console.log(`[fc_LlmToolCallStep] 上下文截断: ${safeHistory.length} → ${trimmed.length} 条消息 (FC_HISTORY_MAX_MESSAGES=${FC_HISTORY_MAX})`);
    safeHistory.length = 0;
    safeHistory.push(...trimmed);
  }

  const entityBlock = buildFcEntityBlock(state) || '（无预解析实体）';

  const systemPrompt = promptRegistry.get('fc_agent', {
    maxSteps,
    currentStep,
    now: new Date().toISOString().replace('T', ' ').slice(0, 19),
    chartContext: '',
    entityBlock: entityBlock,
  });

  const messagesToSend = [
    new SystemMessage(systemPrompt),
    ...safeHistory
  ];

  // 3. 流式：用 model.stream() AsyncIterator 显式拿 chunk，逐帧推给 SSE emitter。
  // 不用 ChatOpenAI 的 streaming:true + invoke + handleLLMNewToken callbacks 那套，
  // 因为它跟 DeepSeek 不兼容（B/D 二分测试过，invoke 那条路 SDK 内 stream reader 死锁）。
  // FC 循环的全部文本作为思考过程（isReasoning: true）传给前端，由 FinalResponseStep 生成最终回复。
  const emitThinkingToSse = (token) => {
    if (!emitter || typeof emitter.handleLLMNewToken !== 'function') return;
    if (typeof token !== 'string' || !token) return;
    emitter.handleLLMNewToken(token, { isReasoning: true });
  };

  // 4. 根据步数决定是否绑定工具
  const isOverCap = currentStep >= maxSteps;
  const llm = isOverCap ? getFcModel() : getLlmWithTools();
  const signal = config?.signal;

  if (isOverCap) {
    messagesToSend.push(new SystemMessage("CRITICAL NOTICE: You have reached the maximum tool call budget. You MUST summarize the final answer based ONLY on the data already collected in the chat history. DO NOT request any more tools. DO NOT use JSON tool calls. DO NOT output any <｜｜DSML｜｜> tags. Just write a summary to the user."));
  }

  console.log(`[fc_LlmToolCallStep] step=${currentStep}/${maxSteps} isOverCap=${isOverCap} → 调用 DeepSeek (stream)...`);
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
    const DSML_CLOSE = '</｜tool_calls>';
    const flushSafeFromDsmlBuffer = () => {
      while (true) {
        const o = dsmlBuffer.indexOf(DSML_OPEN);
        if (o === -1) break;
        const c = dsmlBuffer.indexOf(DSML_CLOSE, o);
        if (c === -1) break;
        dsmlBuffer = dsmlBuffer.slice(0, o) + dsmlBuffer.slice(c + DSML_CLOSE.length);
      }
      const dangling = dsmlBuffer.indexOf(DSML_OPEN);
      if (dangling !== -1) {
        const safe = dsmlBuffer.slice(0, dangling);
        dsmlBuffer = dsmlBuffer.slice(dangling);
        return safe;
      }
      for (let len = Math.min(DSML_OPEN.length - 1, dsmlBuffer.length); len > 0; len--) {
        if (DSML_OPEN.startsWith(dsmlBuffer.slice(-len))) {
          const safe = dsmlBuffer.slice(0, -len);
          dsmlBuffer = dsmlBuffer.slice(-len);
          return safe;
        }
      }
      const safe = dsmlBuffer;
      dsmlBuffer = '';
      return safe;
    };
    try {
      const stream = await llm.stream(messagesToSend, { signal: mergedSignal });
      for await (const chunk of stream) {
        chunkCount += 1;
        const additionalKwargs = chunk?.additional_kwargs || {};
        const deltaReasoning = additionalKwargs.reasoning_content;
        if (deltaReasoning) {
          // deepseek-reasoner 原生思考内容：直接以 reasoning phase 发送
          if (emitter && typeof emitter.handleLLMNewToken === 'function') {
            emitter.handleLLMNewToken(deltaReasoning, { isReasoning: true });
          }
        }
        const deltaText = typeof chunk.content === 'string' ? chunk.content : '';
        if (deltaText) {
          dsmlBuffer += deltaText;
          const safe = flushSafeFromDsmlBuffer();
          if (safe) emitThinkingToSse(safe);
        }
        aiMessage = aiMessage ? aiMessage.concat(chunk) : chunk;
      }
      if (dsmlBuffer) {
        emitThinkingToSse(dsmlBuffer);
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

    if (typeof aiMessage.content === 'string' && aiMessage.content.includes('<｜tool_calls>')) {
      if (!isOverCap) {
        const invokeRegex = /<｜invoke\s+name=[""]([^""]+)[""]>([\s\S]*?)<\/｜invoke>/g;
        const paramRegex = /<｜parameter\s+name=[""]([^""]+)[""][^>]*>([\s\S]*?)<\/｜parameter>/g;
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
        }
      }
      aiMessage.content = aiMessage.content.replace(/<｜tool_calls>[\s\S]*?<\/｜tool_calls>/g, '').trim();
    }

    if (!aiMessage.tool_calls) aiMessage.tool_calls = [];
    const hasTools = aiMessage.tool_calls.length > 0;
    const callNames = hasTools ? aiMessage.tool_calls.map((call) => call?.name).filter(Boolean) : [];

    trace.llmGeneration(emitter, state, {
      step: currentStep, maxSteps,
      chunks: chunkCount,
      latencyMs: Date.now() - fcInvokeT0,
      toolCallCount: callNames.length,
      toolCallNames: callNames,
      isOverCap,
    });

    if (hasTools) {
      console.log(`[fc_LlmToolCallStep] 工具调用: ${callNames.join(', ')} | args: ${JSON.stringify(aiMessage.tool_calls.map(c => c?.args))}`);
    }
    console.log(`[fc_LlmToolCallStep] DeepSeek 返回，耗时 ${Date.now() - fcInvokeT0}ms, chunks=${chunkCount}, hasToolCalls=${hasTools}`);

    logAgentTrace(state.sessionId, {
      step: 'llm_tool_decision',
      round: currentStep, maxRounds: maxSteps, isOverCap,
      latencyMs: Date.now() - fcInvokeT0,
      hasTools,
      toolCalls: hasTools ? aiMessage.tool_calls.map(c => ({ name: c?.name, args: c?.args })) : [],
      thinkingPreview: (aiMessage.content || '').slice(0, 500),
    });
    endGeneration(fcGen, {
      output: maskPII(preview(aiMessage.content)),
      usage: aiMessage.usage_metadata || aiMessage.usage || null,
      model: 'deepseek-chat',
      metadata: { step: currentStep, maxSteps, toolCallCount: callNames.length, toolCallNames: callNames, isOverCap },
    });

    const finalUpdates = { messages: [aiMessage] };
    trace.nodeExit(emitter, state, 'fc_LlmToolCallStep', { hasTools, callNames, step: currentStep });
    return finalUpdates;
  } catch (err) {
    if (err.name === 'AbortError' || err.message?.includes('abort')) {
      console.log("[fc_LlmToolCallStep] 客户端中止了流式生成");
      endGeneration(fcGen, {
        output: maskPII('[aborted]'),
        level: 'WARNING',
        statusMessage: 'client abort',
        model: 'deepseek-chat',
        metadata: { step: currentStep, maxSteps },
      });
      const abortMsg = "\n[已中止生成]";
      trace.nodeExit(emitter, state, 'fc_LlmToolCallStep', { aborted: true });
      return {
        messages: [new AIMessage({ content: abortMsg })],
        reply_markdown: abortMsg,
        finalResponse: abortMsg
      };
    }
    console.error("[fc_LlmToolCallStep] 大模型调用失败:", err);
    endGeneration(fcGen, {
      output: maskPII(preview(err.message)),
      level: 'ERROR',
      statusMessage: err.message,
      model: 'deepseek-chat',
      metadata: { step: currentStep, maxSteps },
    });
    const errMsg = `系统异常: 大模型响应失败 ${err.message}`;
    trace.nodeExit(emitter, state, 'fc_LlmToolCallStep', { error: err.message });
    return {
      messages: [new AIMessage({ content: errMsg })],
      reply_markdown: errMsg,
      finalResponse: errMsg
    };
  }
};

module.exports = { fc_LlmToolCallStep, getFcModel, getLlmWithTools };
