'use strict';

const { SystemMessage, HumanMessage } = require("@langchain/core/messages");
const { startNodeSpan } = require('../shared/spanHelper');
const { renderMemoryBlock } = require('../shared/memoryBlock');
const { getClient, endGeneration, endSpan, maskPII, preview, promptHash, NOOP_TRACE } = require('../../../utils/tracer');
const promptRegistry = require('../../../prompts/registry');
const RoutingPolicy = require('../routingPolicy');
const decisionRules = require('../decisionRules');
const { routerModel } = require('../llm');

const contextAnalyzerRouter = async (state, config) => {
  console.log(`[Router] 正在请求意图分类模型... 输入: ${state.userMessage}`);

  // 如果是补槽恢复(slot_fill)，并且之前已经有了明确的意图和实体，可以考虑跳过重查
  // 但对于意图变更(intent_shift)，必须强制重查。这里简化为每次 Router 都重查，以覆盖 intent_shift 的强制安全检查要求

  const memoryBlock = renderMemoryBlock(state.memory_snippets);
  const schemaDefinition = promptRegistry.get('router') + `\n\n${memoryBlock}`;

  const traceId = config?.configurable?.traceId;
  const client = getClient();
  const gen = client && traceId
    ? client.generation({ traceId, name: 'Router_Intent_Classification', model: 'deepseek-chat', input: maskPII(state.userMessage), metadata: { promptVersion: promptRegistry.version('router'), promptHash: promptHash(schemaDefinition) } })
    : NOOP_TRACE.generation({ name: 'Router_Intent_Classification' });

  // 注入最近对话历史，让 Router 理解"可以""好的"等简短确认语的上下文
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

    const res = await routerModel.invoke(messages, invokeConfig);
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
