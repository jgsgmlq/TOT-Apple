'use strict';

const { AIMessage, HumanMessage, SystemMessage } = require("@langchain/core/messages");
const { getRouterModel } = require('../modelFactory');
const { getClient, endGeneration, endSpan, maskPII, preview, promptHash, NOOP_TRACE } = require("../../../utils/tracer");
const promptRegistry = require('../../../prompts/registry');
const chatMemoryService = require('../../../services/chatMemoryService');
const RoutingPolicy = require('../routingPolicy');
const decisionRules = require('../decisionRules');

const startNodeSpan = (state, name, input) => {
  const traceId = state.meta_trace_id;
  if (!traceId) return null;
  try { const client = getClient(); return client ? client.span({ traceId, name, input }) : null; }
  catch { return null; }
};

const renderMemoryBlock = (snippets) => {
  if (!Array.isArray(snippets) || snippets.length === 0) return "";
  const lines = snippets.map(s => s?.text).filter(Boolean);
  if (lines.length === 0) return "";
  return `[用户历史偏好/已知记忆]\n${lines.join('\n')}`;
};

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
    console.error("[LoadContext] memory load failed:", err);
  }
  endSpan(span, { output: memorySnippets.length ? `${memorySnippets.length} snippets` : 'none' });
  return { memory_snippets: memorySnippets, messages: [new HumanMessage(state.userMessage)] };
};

const contextAnalyzerRouter = async (state, config) => {
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
    ? `\n\nRECENT CONVERSATION:\n${recentHistory.map(m => `${m._getType() === 'human' ? 'User' : 'Assistant'}: ${typeof m.content === 'string' ? m.content.slice(0, 300) : ''}`).join('\n')}`
    : '';

  let intentHint = '';
  const prevIntent = state.prevIntent || '';
  if (prevIntent && prevIntent !== 'chat_only') {
    const msgLen = (state.userMessage || '').trim().length;
    if (msgLen < 10) {
      intentHint = `\n\nCONTEXT: The last turn intent was "${prevIntent}". The current short message is likely a FOLLOW-UP. Do NOT classify as chat_only unless the user is explicitly greeting/ending the conversation.`;
    }
  }

  const messages = [new SystemMessage(schemaDefinition + historyCtx + intentHint), new HumanMessage(state.userMessage)];

  let rawJson = "";
  const ROUTER_TIMEOUT_MS = Number(process.env.ROUTER_LLM_TIMEOUT_MS || 15000);
  const timeoutCtl = new AbortController();
  const timer = setTimeout(() => timeoutCtl.abort(new Error(`Router timeout after ${ROUTER_TIMEOUT_MS}ms`)), ROUTER_TIMEOUT_MS);
  const mergedSignal = (typeof AbortSignal !== 'undefined' && AbortSignal.any && config?.signal)
    ? AbortSignal.any([config.signal, timeoutCtl.signal])
    : (config?.signal || timeoutCtl.signal);

  try {
    const res = await getRouterModel().invoke(messages, { signal: mergedSignal });
    rawJson = res.content.trim();
    if (rawJson.startsWith('```json')) rawJson = rawJson.replace(/^```json/, '').replace(/```$/, '').trim();
    else if (rawJson.startsWith('```')) rawJson = rawJson.replace(/^```/, '').replace(/```$/, '').trim();

    const parsed = JSON.parse(rawJson);
    console.log(`[Router] parsed:`, parsed);
    endGeneration(gen, { output: maskPII(preview(rawJson)), usage: res.usage_metadata || res.usage || null, model: 'deepseek-chat', metadata: { mode: parsed.mode, intent: parsed.intent } });

    const risk = parsed.risk_flags === true;
    const tier = decisionRules.selectTier(parsed.complexity_score, risk);
    const mode = decisionRules.correctMode(parsed.mode || 'tool_action', parsed.intent, risk);
    if (parsed.mode === 'chat_only' && mode === 'tool_action') console.log(`[Router] mode corrected: chat_only → tool_action`);

    return { mode, intent: parsed.intent || "tool_action", entities: parsed.entities || {}, entities_confidence: parsed.entities_confidence || {}, selected_tier: tier, meta_trace_id: config?.configurable?.traceId || state.meta_trace_id || '', meta_fallback_count: state.meta_fallback_count };
  } catch (err) {
    if (err.name === 'AbortError' || err.message?.includes('abort')) console.warn(`[Router] timed out/aborted → safe default`);
    else console.error(`[Router] parse failed. Raw: ${rawJson}`, err);
    endGeneration(gen, { output: maskPII(preview(rawJson || '')), level: 'ERROR', statusMessage: err.message, model: 'deepseek-chat' });
    return { mode: "tool_action", intent: "tool_action", selected_tier: "L3_fc_guarded", entities: {}, entities_confidence: {}, meta_trace_id: config?.configurable?.traceId || state.meta_trace_id || '', meta_fallback_count: (state.meta_fallback_count || 0) + 1 };
  } finally { clearTimeout(timer); }
};

module.exports = { renderMemoryBlock, loadContext, contextAnalyzerRouter };
