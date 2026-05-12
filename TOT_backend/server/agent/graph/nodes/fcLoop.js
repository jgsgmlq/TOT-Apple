'use strict';

const { AIMessage, HumanMessage, SystemMessage } = require("@langchain/core/messages");
const { getFcModel, getLlmWithTools } = require('../modelFactory');
const { INTENT_TOOL_MAP, FALLBACK_TOOL_NAMES, TOOL_INDEX } = require('../toolIndex');
const { normalizeIntent } = require('../intents');
const RoutingPolicy = require('../routingPolicy');
const { DsmlFilter } = require('../dsmlFilter');
const { getClient, endGeneration, endSpan, maskPII, preview, NOOP_TRACE } = require("../../../utils/tracer");
const promptRegistry = require('../../../prompts/registry');
const chatToolsService = require('../../../services/chatToolsService');
const { renderMemoryBlock } = require('./routerNode');
const { decideChart } = require('../decideChart');

const startNodeSpan = (state, name, input) => {
  const traceId = state.meta_trace_id;
  if (!traceId) return null;
  try { const client = getClient(); return client ? client.span({ traceId, name, input }) : null; }
  catch { return null; }
};

const toolRetrieve = async (state) => {
  const span = startNodeSpan(state, 'ToolRetrieve', { intent: state.intent, userMessage: (state.userMessage || '').slice(0, 200) });
  const intent = normalizeIntent(state.intent);
  const msg = state.userMessage || '';

  const MULTI_CONJUNCTIONS = ['另外', '还有', '以及', '同时', '此外', '再加上', '顺便'];
  const hasConjunction = MULTI_CONJUNCTIONS.some(c => msg.includes(c));
  const multiQuestionMarks = (msg.match(/[？?]/g) || []).length >= 2;
  const hasClauses = (msg.includes('，') || msg.includes('；') || msg.includes('\n')) && msg.length > 50;
  const looksMultiQuestion = hasConjunction || multiQuestionMarks || hasClauses;

  const topK = looksMultiQuestion ? 5 : (RoutingPolicy.tiers[state.selected_tier]?.tool_top_k || 3);
  const intentSeed = INTENT_TOOL_MAP[intent];
  const seedList = (looksMultiQuestion || !intentSeed) ? chatToolsService.getRegisteredToolNames() : intentSeed;
  const PRIOR_BASE = 10, PRIOR_DECAY = 1.0;
  const BM25_MAX_BOOST = 3;
  const isFlatPrior = intent === 'chat_only' || !intentSeed || looksMultiQuestion;

  const scoreById = new Map();
  seedList.forEach((id, i) => {
    const prior = isFlatPrior ? PRIOR_BASE : (PRIOR_BASE - i * PRIOR_DECAY);
    scoreById.set(id, (scoreById.get(id) || 0) + prior);
  });

  const seedSet = new Set(seedList);
  const recentAssistantText = (state.messages || []).filter(m => m._getType && m._getType() === 'ai').slice(-2).map(m => typeof m.content === 'string' ? m.content.slice(0, 500) : '').join(' ');
  const bm25Query = recentAssistantText ? `${state.userMessage || ''} ${recentAssistantText}` : (state.userMessage || '');
  for (const { id, score } of TOOL_INDEX.score(bm25Query)) {
    if (score <= 0 || !seedSet.has(id)) continue;
    const bm25Boost = Math.min(score, BM25_MAX_BOOST);
    scoreById.set(id, (scoreById.get(id) || 0) + bm25Boost);
  }

  const ranked = [...scoreById.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const candidates = chatToolsService.getToolSchemasByNames(ranked).map(s => s.function.name).slice(0, topK);
  console.log(`[ToolRetrieve] intent: ${intent}, candidates: ${candidates.join(', ')}`);
  endSpan(span, { output: candidates.join(', '), metadata: { intent, topK, isMultiQuestion: looksMultiQuestion, isFlatPrior } });
  return { candidateTools: candidates };
};

const fc_CheckSteps = async (state) => {
  const span = startNodeSpan(state, 'FC_CheckSteps', { step: (state.fc_super_step_count || 0) + 1, tier: state.selected_tier });
  endSpan(span, { output: `step ${(state.fc_super_step_count || 0) + 1}` });
  return { fc_super_step_count: (state.fc_super_step_count || 0) + 1, fc_next_action: '' };
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
  const safeHistory = state.messages.length > 0 ? [...state.messages] : [new HumanMessage(state.userMessage)];
  if (safeHistory.length >= 2) {
    const last = safeHistory[safeHistory.length - 1], prev = safeHistory[safeHistory.length - 2];
    if (last._getType() === 'human' && prev._getType() === 'human' && last.content === prev.content) safeHistory.pop();
  }
  const FC_HISTORY_MAX = Number(process.env.FC_HISTORY_MAX_MESSAGES || 30);
  if (safeHistory.length > FC_HISTORY_MAX) { const trimmed = safeHistory.slice(-FC_HISTORY_MAX); safeHistory.length = 0; safeHistory.push(...trimmed); }

  const suggestedChart = decideChart(state.toolResults || {}, state.intent);
  const chartContext = suggestedChart
    ? `\n\nAVAILABLE CHART DATA (use this pre-computed ECharts option for rendering — do NOT invent different chart data):\n\`\`\`json\n${JSON.stringify(suggestedChart, null, 2)}\n\`\`\`\n`
    : '';
  const prevEntities = state.prevEntities || {};
  const prevEntityKeys = Object.keys(prevEntities).filter(k => prevEntities[k]?.canonical);
  const entitiesHint = prevEntityKeys.length > 0
    ? `\n\nCONTEXT ENTITIES FROM PREVIOUS TURN (if the user is asking a follow-up question without re-stating these, reuse them when calling tools):\n${prevEntityKeys.map(k => `- ${k}: "${prevEntities[k].canonical}"`).join('\n')}\n`
    : '';
  const systemPrompt = promptRegistry.get('fc_agent', { toolNamespace: state.tool_namespace, selectedTier: state.selected_tier, maxSteps, currentStep, chartContext, memoryBlock: renderMemoryBlock(state.memory_snippets) }) + entitiesHint;
  const messagesToSend = [new SystemMessage(systemPrompt), ...safeHistory];
  const emitDeltaToSse = (token, isReasoning) => { if (emitter?.handleLLMNewToken && typeof token === 'string' && token) emitter.handleLLMNewToken(token, { isReasoning: !!isReasoning }); };

  const isOverCap = currentStep >= maxSteps;
  const llm = isOverCap ? getFcModel() : getLlmWithTools(state.candidateTools);
  if (isOverCap) messagesToSend.push(new SystemMessage("CRITICAL: Max tool call budget reached. Summarize from existing data only. DO NOT request more tools."));

  console.log(`[fc_LlmToolCallStep] step=${currentStep}/${maxSteps} isOverCap=${isOverCap}`);
  let timedOut = false;
  try {
    const FC_TIMEOUT_MS = Number(process.env.FC_LLM_TIMEOUT_MS || 60000);
    const timeoutCtl = new AbortController();
    const timer = setTimeout(() => timeoutCtl.abort(new Error(`fc timeout`)), FC_TIMEOUT_MS);
    const mergedSignal = (AbortSignal?.any && config?.signal) ? AbortSignal.any([config.signal, timeoutCtl.signal]) : (config?.signal || timeoutCtl.signal);

    let aiMessage = null, chunkCount = 0;
    const dsml = new DsmlFilter();
    try {
      const stream = await llm.stream(messagesToSend, { signal: mergedSignal });
      for await (const chunk of stream) {
        chunkCount += 1;
        const deltaReasoning = (chunk?.additional_kwargs || {}).reasoning_content;
        if (deltaReasoning) emitDeltaToSse(deltaReasoning, true);
        const deltaText = typeof chunk.content === 'string' ? chunk.content : '';
        if (deltaText) { const safe = dsml.feed(deltaText); if (safe) emitDeltaToSse(safe, false); }
        aiMessage = aiMessage ? aiMessage.concat(chunk) : chunk;
      }
      const rest = dsml.drain(); if (rest) emitDeltaToSse(rest, false);
    } finally { clearTimeout(timer); timedOut = timeoutCtl.signal.aborted; }

    if (timedOut) { const e = new Error('fc_LlmToolCallStep timeout'); e.code = 'FC_LLM_TIMEOUT'; throw e; }
    if (!aiMessage) { const e = new Error('no chunks'); e.code = 'FC_LLM_EMPTY'; throw e; }

    if (typeof aiMessage.content === 'string' && aiMessage.content.includes('<｜｜DSML｜｜tool_calls>')) {
      if (!isOverCap) {
        const invokeRegex = /<\｜｜DSML｜｜invoke\s+name=[""]([^""]+)[""]>([\s\S]*?)<\/\｜｜DSML｜｜invoke>/g;
        const paramRegex = /<\｜｜DSML｜｜parameter\s+name=[""]([^""]+)[""][^>]*>([\s\S]*?)<\/\｜｜DSML｜｜parameter>/g;
        if (!aiMessage.tool_calls) aiMessage.tool_calls = [];
        let invokeMatch, dsmlIndex = 0;
        while ((invokeMatch = invokeRegex.exec(aiMessage.content)) !== null) {
          const args = {}; let pMatch; paramRegex.lastIndex = 0;
          while ((pMatch = paramRegex.exec(invokeMatch[2])) !== null) args[pMatch[1]] = pMatch[2].trim();
          aiMessage.tool_calls.push({ name: invokeMatch[1], args, id: `call_${Date.now()}_dsml_${dsmlIndex++}` });
        }
      }
      aiMessage.content = aiMessage.content.replace(/<\｜｜DSML｜｜tool_calls>[\s\S]*?<\/\｜｜DSML｜｜tool_calls>/g, '').trim();
    }

    if (!aiMessage.tool_calls) aiMessage.tool_calls = [];
    const hasTools = aiMessage.tool_calls.length > 0;
    const callNames = hasTools ? aiMessage.tool_calls.map(c => c?.name).filter(Boolean) : [];
    endGeneration(fcGen, { output: maskPII(preview(aiMessage.content)), usage: aiMessage.usage_metadata || aiMessage.usage || null, model: 'deepseek-chat', metadata: { step: currentStep, maxSteps, toolCallCount: callNames.length, toolCallNames: callNames, isOverCap } });

    const finalUpdates = { messages: [aiMessage] };
    if (!hasTools) { finalUpdates.reply_markdown = aiMessage.content; finalUpdates.finalResponse = aiMessage.content; }
    return finalUpdates;
  } catch (err) {
    if (err.name === 'AbortError' || err.message?.includes('abort')) {
      console.log("[fc_LlmToolCallStep] aborted");
      endGeneration(fcGen, { output: '[aborted]', level: 'WARNING', statusMessage: 'abort', model: 'deepseek-chat', metadata: { step: currentStep } });
      const abortMsg = "\n[已中止生成]";
      return { messages: [new AIMessage({ content: abortMsg })], reply_markdown: abortMsg, finalResponse: abortMsg };
    }
    console.error("[fc_LlmToolCallStep] failed:", err);
    endGeneration(fcGen, { output: preview(err.message), level: 'ERROR', statusMessage: err.message, model: 'deepseek-chat', metadata: { step: currentStep } });
    const errMsg = `系统异常: 大模型响应失败 ${err.message}`;
    return { messages: [new AIMessage({ content: errMsg })], reply_markdown: errMsg, finalResponse: errMsg };
  }
};

module.exports = { toolRetrieve, fc_CheckSteps, fc_LlmToolCallStep };
