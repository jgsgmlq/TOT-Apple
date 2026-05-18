'use strict';

const { z } = require("zod");
const { SystemMessage, HumanMessage } = require("@langchain/core/messages");
const { renderMemoryBlock } = require("../shared/memoryBlock");
const { getClient, endGeneration, endSpan, maskPII, preview, promptHash, NOOP_TRACE } = require("../../../utils/tracer");
const { startNodeSpan } = require("../shared/spanHelper");
const promptRegistry = require("../../../prompts/registry");
const { routerModel } = require("../llm");

const SafetyGatewayOutput = z.object({
  mode: z.enum(["chat", "tool", "deny"]),
  extracted: z.object({
    task_ref: z.string().nullable(),
    org_ref: z.string().nullable(),
    org_type: z.enum(["region","store","dealer","l3","l4"]).nullable(),
    time_ref: z.string().nullable(),
  }),
  ambiguity: z.object({
    type: z.enum(["missing_task_ref","vague_task_ref","missing_context"]),
    description: z.string(),
    question: z.string(),
    candidates: z.array(z.object({
      id: z.string(),
      label: z.string(),
      value: z.string(),
    })).optional(),
  }).nullable(),
  reason: z.string(),
});

function correctMode(parsed) {
  if (parsed.mode === "chat" && (parsed.extracted?.task_ref || parsed.extracted?.org_ref)) {
    return "tool";
  }
  return parsed.mode;
}

async function safetyGateway(state, config) {
  const span = startNodeSpan(state, 'SafetyGateway', { userMessage: (state.userMessage || '').slice(0, 80) });
  console.log(`[SafetyGateway] 分析用户消息: ${(state.userMessage || '').slice(0, 80)}`);

  const memoryBlock = renderMemoryBlock(state.memory_snippets);
  const schemaDefinition = promptRegistry.get("safety_gateway");

  const traceId = config?.configurable?.traceId;
  const client = getClient();
  const gen = client && traceId
    ? client.generation({ traceId, name: "SafetyGateway", model: "deepseek-chat", input: maskPII(state.userMessage), metadata: { promptVersion: promptRegistry.version("safety_gateway"), promptHash: promptHash(schemaDefinition) } })
    : NOOP_TRACE.generation({ name: "SafetyGateway" });

  const recentHistory = (state.messages || []).filter(m => {
    const t = m._getType ? m._getType() : "";
    return t === "human" || t === "ai";
  }).slice(-4);
  const historyCtx = recentHistory.length > 1
    ? `\n\nRECENT CONVERSATION:\n${recentHistory.map(m => `${m._getType() === "human" ? "User" : "Assistant"}: ${typeof m.content === "string" ? m.content.slice(0, 300) : ""}`).join("\n")}`
    : "";

  const messages = [
    new SystemMessage(schemaDefinition + historyCtx),
    new HumanMessage(state.userMessage)
  ];

  try {
    const structuredModel = routerModel.withStructuredOutput(SafetyGatewayOutput, {
      name: "safety_gateway_output",
      method: "jsonMode",
    });
    const parsed = await structuredModel.invoke(messages, { signal: config?.signal });
    const mode = correctMode(parsed);
    const ambiguity = parsed.ambiguity?.type && parsed.ambiguity.type !== "none" ? parsed.ambiguity : null;

    console.log(`[SafetyGateway] mode=${mode} ambiguity=${ambiguity?.type || "none"} task_ref=${parsed.extracted.task_ref || "-"}`);

    endGeneration(gen, {
      output: maskPII(preview(JSON.stringify(parsed))),
      usage: parsed.usage_metadata || null,
      model: parsed.response_metadata?.model_name || "deepseek-chat",
      metadata: { mode, ambiguity: ambiguity?.type || null },
    });

    const result = {
      mode,
      extracted_task_ref: parsed.extracted.task_ref,
      extracted_org_ref: parsed.extracted.org_ref,
      extracted_org_type: parsed.extracted.org_type,
      extracted_time_ref: parsed.extracted.time_ref,
      ambiguity_payload: ambiguity ? {
        type: ambiguity.type,
        question: ambiguity.question,
        candidates: ambiguity.candidates || [],
      } : null,
    };
    endSpan(span, { output: `mode=${mode}`, metadata: { mode, ambiguity: ambiguity?.type || null } });
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
    return {
      mode: "tool",
      extracted_task_ref: null,
      extracted_org_ref: null,
      extracted_org_type: null,
      extracted_time_ref: null,
      ambiguity_payload: null,
    };
  }
}

module.exports = { safetyGateway };
