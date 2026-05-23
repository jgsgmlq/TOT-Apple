const { BaseMessage } = require("@langchain/core/messages");
const { Annotation } = require("@langchain/langgraph");

/**
 * ExecChatGraphState - Executive Chat 单层拍平状态模型
 *
 * 字段所有权（owner = 写入节点；其他节点只读）
 * ──────────────────────────────────────────────
 *   sessionId / userId / userMessage   ← 入口（chatService）
 *   messages                            ← LoadContext, fc_LlmToolCallStep,
 *                                         fc_ExecuteTool, fc_MergeToolResults,
 *                                         HumanInTheLoopGate, FinalResponseStep
 *   regionScope                         ← 入口（chatService）
 *
 *   mode / intent / entities /
 *   entities_confidence /
 *   meta_fallback_count
 *
 *   conversation / long_term_memories    ← LoadContext
 *
 *   fc_super_step_count                 ← fc_CheckSteps
 *   fc_next_action                      ← 各 FC 节点（每次循环写自己的下一步）
 *   pending_tool_calls                  ← fc_LlmToolCallStep, fc_CheckDuplicate, fc_ExecuteTool
 *   toolResults / calledTools           ← fc_ExecuteTool（toolResults 用 merge reducer）
 *
 *   hitl_status / interrupt_payload     ← HITL 节点（pause）, HumanInTheLoopGate（resume）
 *   hitl_resume_payload                 ← HumanInTheLoopGate
 *
 *   finalResponse / reply_markdown /    ← FinalResponseStep
 *   reply_structured
 *   finalMessageId                      ← PersistAndEmit
 *
 *   meta_trace_id / meta_routing_tier   ← 入口/中间件
 */
const ExecChatGraphState = Annotation.Root({
  // ─── 核心上下文 ───
  sessionId: Annotation({ reducer: (x, y) => y ?? x, default: () => "" }),
  userId: Annotation({ reducer: (x, y) => y ?? x, default: () => "" }),
  userMessage: Annotation({ reducer: (x, y) => y ?? x, default: () => "" }),

  // 消息序列（追加模式）
  messages: Annotation({
    reducer: (x, y) => x.concat(y),
    default: () => []
  }),

  // 权限与工具域
  regionScope: Annotation({ reducer: (x, y) => y ?? x, default: () => ({ type: "national" }) }),

  // ─── 路由决策 ───
  // mode 是路由决策的唯一真值源：chat_only | tool_action | deny
  mode: Annotation({ reducer: (x, y) => y ?? x, default: () => "chat_only" }),
  intent: Annotation({ reducer: (x, y) => y ?? x, default: () => "" }),

  entities: Annotation({ reducer: (x, y) => y ?? x, default: () => ({}) }),
  entities_raw: Annotation({ reducer: (x, y) => y ?? x, default: () => ({}) }),
  entities_confidence: Annotation({ reducer: (x, y) => y ?? x, default: () => ({}) }),

  // ─── 会话级上下文 (LoadContext) ───
  conversation: Annotation({ reducer: (x, y) => y ?? x, default: () => [] }),

  // ─── 长期记忆 (LoadContext) ───
  long_term_memories: Annotation({ reducer: (x, y) => y ?? x, default: () => '' }),

  // ─── 工具执行与 FC 循环 ───
  toolResults: Annotation({
    reducer: (x, y) => ({ ...x, ...y }),
    default: () => ({})
  }),
  calledTools: Annotation({
    reducer: (x, y) => (x || []).concat(y || []),
    default: () => []
  }),

  fc_super_step_count: Annotation({ reducer: (x, y) => (y !== undefined ? y : x), default: () => 0 }),
  fc_current_step: Annotation({ reducer: (x, y) => (y !== undefined ? y : x), default: () => 0 }),
  pending_tool_calls: Annotation({ reducer: (x, y) => (y !== undefined ? y : x), default: () => [] }),
  fc_next_action: Annotation({ reducer: (x, y) => (y !== undefined ? y : x), default: () => "" }),

  // ─── 最终回答 ───
  finalMessageId: Annotation({ reducer: (x, y) => y ?? x, default: () => "" }),
  finalResponse: Annotation({ reducer: (x, y) => y ?? x, default: () => "" }),
  reply_markdown: Annotation({ reducer: (x, y) => y ?? x, default: () => "" }),
  sessionTitle: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  reply_structured: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),

  // ─── 人在回路 (HITL) ───
  // hitl_status: idle | pending_interrupt | resumed
  // interrupt_payload: pause 时写入；resume 后被 HITLGate 清空
  // hitl_resume_payload: 用户回包（可能是确认/选择/intent_shift）
  hitl_status: Annotation({ reducer: (x, y) => y ?? x, default: () => "idle" }),
  interrupt_payload: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  hitl_resume_payload: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),

  // ─── 元数据与跟踪 ───
  meta_trace_id: Annotation({ reducer: (x, y) => y ?? x, default: () => "" }),
  meta_routing_tier: Annotation({ reducer: (x, y) => y ?? x, default: () => "" }),
  meta_fallback_count: Annotation({ reducer: (x, y) => (y !== undefined ? y : x), default: () => 0 }),

  // 运行追踪日志（每个 node 在 enter/exit 时追加，最终写入 content_json._trace）
  trace_log: Annotation({
    reducer: (x, y) => (x || []).concat(y || []),
    default: () => []
  }),

  // ─── SafetyGateway 输出 ───
  extracted_task_ref: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  extracted_org_ref: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  extracted_org_type: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  extracted_time_ref: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  ambiguity_payload: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  escalate_count: Annotation({ reducer: (x, y) => (y !== undefined ? y : x), default: () => 0 }),
});

module.exports = { ExecChatGraphState };
