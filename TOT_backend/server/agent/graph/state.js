const { BaseMessage } = require("@langchain/core/messages");
const { Annotation } = require("@langchain/langgraph");

/**
 * ExecChatGraphState - Executive Chat 单层拍平状态模型
 * 参考 appendix-a-as-is-vs-to-be.md A3 节定义。
 * 
 * 包含旧字段兼容以避免节点代码大范围修改。
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
  tool_namespace: Annotation({ reducer: (x, y) => y ?? x, default: () => "executive_chat" }),

  // ─── Router 输出 (ContextAnalyzerRouter) ───
  mode: Annotation({ reducer: (x, y) => y ?? x, default: () => "chat_only" }), // chat_only | tool_action | pending_clarification
  intent: Annotation({ reducer: (x, y) => y ?? x, default: () => "" }),
  global_safety_decision: Annotation({ reducer: (x, y) => y ?? x, default: () => "allow" }), // allow | deny | pending
  safety: Annotation({ reducer: (x, y) => y ?? x, default: () => "allow" }), // 兼容旧字段
  
  entities: Annotation({ reducer: (x, y) => y ?? x, default: () => ({}) }),
  entities_raw: Annotation({ reducer: (x, y) => y ?? x, default: () => ({}) }),
  entities_confidence: Annotation({ reducer: (x, y) => y ?? x, default: () => ({}) }),

  // ─── 记忆注入 (LoadContext) ───
  memory_snippets: Annotation({ reducer: (x, y) => y ?? x, default: () => [] }),
  memoryContext: Annotation({ reducer: (x, y) => y ?? x, default: () => "" }), // 兼容旧字段
  
  // ─── 工具执行与 FC 循环 ───
  candidateTools: Annotation({ reducer: (x, y) => y ?? x, default: () => [] }),
  toolResults: Annotation({ 
    reducer: (x, y) => ({ ...x, ...y }), 
    default: () => ({}) 
  }),
  calledTools: Annotation({ 
    reducer: (x, y) => (x || []).concat(y || []), 
    default: () => [] 
  }),
  
  selected_tier: Annotation({ reducer: (x, y) => (y !== undefined ? y : x), default: () => "L3_fc_guarded" }),
  fc_super_step_count: Annotation({ reducer: (x, y) => (y !== undefined ? y : x), default: () => 0 }),
  fc_current_step: Annotation({ reducer: (x, y) => (y !== undefined ? y : x), default: () => 0 }),
  fc_repair_attempts: Annotation({ reducer: (x, y) => (y !== undefined ? y : x), default: () => 0 }),
  repair_error_reason: Annotation({ reducer: (x, y) => y ?? x, default: () => "" }),
  pending_tool_calls: Annotation({ reducer: (x, y) => (y !== undefined ? y : x), default: () => [] }),
  fc_next_action: Annotation({ reducer: (x, y) => (y !== undefined ? y : x), default: () => "" }),
  
  // ─── 最终回答 ───
  finalMessageId: Annotation({ reducer: (x, y) => y ?? x, default: () => "" }),
  finalResponse: Annotation({ reducer: (x, y) => y ?? x, default: () => "" }), 
  reply_markdown: Annotation({ reducer: (x, y) => y ?? x, default: () => "" }),
  reply_structured: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  
  // ─── 人在回路 (HITL) ───
  human_in_the_loop_status: Annotation({ reducer: (x, y) => y ?? x, default: () => "idle" }), // idle | pending_interrupt | resumed
  hitl_status: Annotation({ reducer: (x, y) => y ?? x, default: () => "idle" }), // 兼容旧字段
  interrupt_payload: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  hitl_payload: Annotation({ reducer: (x, y) => y ?? x, default: () => null }), // 兼容旧字段
  hitl_resume_payload: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  clarification_response: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),

  // ─── 元数据与跟踪 ───
  meta_trace_id: Annotation({ reducer: (x, y) => y ?? x, default: () => "" }),
  meta_routing_tier: Annotation({ reducer: (x, y) => y ?? x, default: () => "" }),
  meta_fallback_count: Annotation({ reducer: (x, y) => (y !== undefined ? y : x), default: () => 0 })
});

module.exports = { ExecChatGraphState };
