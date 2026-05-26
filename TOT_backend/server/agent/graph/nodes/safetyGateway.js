'use strict';

const { z } = require("zod");
const { SystemMessage, HumanMessage } = require("@langchain/core/messages");
const { renderConversation, renderLongTerm } = require("../shared/memoryBlock");
const { getClient, endGeneration, endSpan, maskPII, preview, promptHash, NOOP_TRACE } = require("../../../utils/tracer");
const { startNodeSpan } = require("../shared/spanHelper");
const promptRegistry = require("../../../prompts/registry");
const { routerModel } = require("../llm");
const { logAgentTrace } = require("../shared/agentTraceLog");

const SafetyGatewayV2Output = z.object({
  mode: z.enum(["chat", "tool", "deny"]),
  filters: z.object({
    task_name: z.string().nullable(),
    task_category: z.enum(["BAU", "NPI"]).nullable(),
    product_name: z.string().nullable(),
    priority: z.enum(["P0", "P1", "P2", "P3"]).nullable(),
    alert_level: z.enum(["P0", "P1", "P2", "P3", "new"]).nullable(),
    platform: z.enum(["MyPAL", "SmartSell", "AI Demo", "Live Broadcast"]).nullable(),
    org_name: z.string().nullable(),
    org_type: z.enum(["region", "store", "dealer", "l3", "l4"]).nullable(),
    time_range: z.object({
      start: z.string().nullable(),
      end: z.string().nullable(),
    }).nullable(),
    deadline_urgency: z.enum(["overdue", "soon"]).nullable(),
    status_filter: z.enum(["active", "ended", "all"]).nullable(),
  }),
  ambiguity: z.object({
    type: z.enum(["missing_task_ref", "vague_task_ref", "missing_context"]),
    description: z.string(),
    question: z.string(),
  }).nullable(),
  reason: z.string(),
});

const trace = require("../shared/runTrace");

async function safetyGateway(state, config) {
  const emitter = config?.configurable?.sseEmitter;
  trace.nodeEnter(emitter, state, 'SafetyGateway');
  const span = startNodeSpan(state, 'SafetyGateway', { userMessage: (state.userMessage || '').slice(0, 80) });
  console.log(`[SafetyGateway] 分析用户消息: ${(state.userMessage || '').slice(0, 80)}`);

  const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 10);
  const schemaDefinition = promptRegistry.get("safety_gateway_v2", { now: nowStr });
  const conversationBlock = renderConversation(state.conversation || []);
  const longTermBlock = renderLongTerm(state.long_term_memories || '');

  // 上下文块用 HumanMessage 包装，与 SystemMessage 指令隔离
  const contextParts = [conversationBlock, longTermBlock].filter(Boolean);
  const contextBlock = contextParts.length > 0 ? '[系统上下文]\n' + contextParts.join('\n\n') : '';

  const traceId = config?.configurable?.traceId;
  const client = getClient();
  const gen = client && traceId
    ? client.generation({ traceId, name: "SafetyGateway", model: "deepseek-chat", input: maskPII(state.userMessage), metadata: { promptVersion: promptRegistry.version("safety_gateway"), promptHash: promptHash(schemaDefinition) } })
    : NOOP_TRACE.generation({ name: "SafetyGateway" });

  const messages = [new SystemMessage(schemaDefinition)];
  if (contextBlock) {
    messages.push(new HumanMessage(contextBlock));
  }
  messages.push(new HumanMessage(state.userMessage));

  try {
    const structuredModel = routerModel.withStructuredOutput(SafetyGatewayV2Output, {
      name: "safety_gateway_v2_output",
      method: "jsonMode",
    });
    const parsed = await structuredModel.invoke(messages, { signal: config?.signal });
    const mode = parsed.mode;
    const ambiguity = parsed.ambiguity?.type && parsed.ambiguity.type !== "none" ? parsed.ambiguity : null;

    console.log(`[SafetyGateway] mode=${mode} ambiguity=${ambiguity?.type || "none"} task_name=${parsed.filters.task_name || "-"} task_category=${parsed.filters.task_category || "-"}`);

    logAgentTrace(state.sessionId, {
      step: 'safety_gateway',
      userMessage: state.userMessage,
      mode, ambiguity: ambiguity?.type || null,
      filters: parsed.filters,
    });

    endGeneration(gen, {
      output: maskPII(preview(JSON.stringify(parsed))),
      usage: parsed.usage_metadata || null,
      model: parsed.response_metadata?.model_name || "deepseek-chat",
      metadata: { mode, ambiguity: ambiguity?.type || null },
    });

    const result = {
      mode,
      query_filters: parsed.filters,
      // legacy fields (deprecated, retained for backward compat)
      extracted_task_ref: parsed.filters.task_name,
      extracted_org_ref: parsed.filters.org_name,
      extracted_org_type: parsed.filters.org_type,
      extracted_time_ref: null,
      ambiguity_payload: ambiguity ? {
        type: ambiguity.type,
        question: ambiguity.question,
        description: ambiguity.description,
        candidates: [],
      } : null,
    };
    endSpan(span, { output: `mode=${mode}`, metadata: { mode, ambiguity: ambiguity?.type || null } });
    trace.decision(emitter, state, `mode=${mode}`, parsed.reason || '', {
      node: 'SafetyGateway',
      task_name: parsed.filters.task_name,
      task_category: parsed.filters.task_category,
      org_name: parsed.filters.org_name,
      ambiguity: ambiguity?.type || null,
    });
    trace.nodeExit(emitter, state, 'SafetyGateway', { mode, ambiguity: ambiguity?.type || null });
    return result;
  } catch (err) {
    console.error(`[SafetyGateway] 失败，降级为 tool:`, err.message);
    endGeneration(gen, {
      output: maskPII(preview(err.message)),
      level: "ERROR",
      statusMessage: err.message,
      model: "deepseek-chat",
    });
    endSpan(span, { output: `fallback:tool`, level: "WARNING", metadata: { error: err.message } });
    trace.nodeExit(emitter, state, 'SafetyGateway', { mode: 'tool', fallback: true, error: err.message });
    return {
      mode: "tool",
      query_filters: {
        task_name: null, task_category: null, product_name: null,
        priority: null, alert_level: null, platform: null,
        org_name: null, org_type: null,
        time_range: null, deadline_urgency: null,
        status_filter: "active",
      },
      extracted_task_ref: null, extracted_org_ref: null,
      extracted_org_type: null, extracted_time_ref: null,
      ambiguity_payload: null,
    };
  }
}

module.exports = { safetyGateway };
