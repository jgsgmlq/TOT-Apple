'use strict';

const { z } = require("zod");
const { SystemMessage, HumanMessage } = require("@langchain/core/messages");
const { startNodeSpan } = require('../shared/spanHelper');
const { renderMemoryBlock } = require('../shared/memoryBlock');
const { getClient, endGeneration, endSpan, maskPII, preview, promptHash, NOOP_TRACE } = require('../../../utils/tracer');
const promptRegistry = require('../../../prompts/registry');
const RoutingPolicy = require('../routingPolicy');
const decisionRules = require('../decisionRules');
const { routerModel } = require('../llm');

const RouterOutput = z.object({
  mode: z.enum(["chat_only", "tool_action", "deny"]),
  intent: z.string(),
  entities: z.record(z.any()).optional().default({}),
  entities_confidence: z.record(z.number()).optional().default({}),
  complexity_score: z.number().optional(),
  risk_flags: z.boolean().optional(),
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

  try {
    const invokeConfig = { signal: config?.signal };
    const structuredModel = routerModel.withStructuredOutput(RouterOutput, {
      name: "router_output",
      method: "json_mode",
    });
    const parsed = await structuredModel.invoke(messages, invokeConfig);
    console.log(`[Router] 解析结果:`, parsed);

    endGeneration(gen, {
      output: maskPII(preview(JSON.stringify(parsed))),
      usage: parsed.usage_metadata || null,
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
    console.error(`[Router] 意图解析失败，降级为默认安全流转.`, err);
    endGeneration(gen, {
      output: maskPII(preview(err.message)),
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
