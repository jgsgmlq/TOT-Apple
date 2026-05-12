const { BaseMessage } = require("@langchain/core/messages");
const { Annotation } = require("@langchain/langgraph");

/**
 * ExecChatGraphState - Executive Chat 单层拍平状态模型
 *
 * 字段所有权（owner = 写入节点；其他节点只读）
 * ──────────────────────────────────────────────
 *   sessionId / userId / userMessage   ← 入口（chatService）
 *   messages                            ← LoadContext, fc_LlmToolCallStep, fc_ParamRepair,
 *                                         fc_ExecuteTool, fc_MergeToolResults,
 *                                         HumanInTheLoopGate, FinalResponseStep
 *   regionScope / tool_namespace        ← 入口（chatService）
 *
 *   mode / intent / entities /          ← ContextAnalyzerRouter （路由决策唯一真值源）
 *   entities_confidence / selected_tier /
 *   meta_fallback_count
 *
 *   memory_snippets                     ← LoadContext
 *
 *   candidateTools                      ← ToolRetrieve
 *
 *   fc_super_step_count                 ← fc_CheckSteps
 *   fc_next_action                      ← 各 FC 节点（每次循环写自己的下一步）
 *   pending_tool_calls                  ← fc_LlmToolCallStep, fc_CheckDuplicate,
 *                                         fc_ValidateParams, fc_ParamRepair, fc_ExecuteTool
 *   fc_repair_attempts / repair_error_reason ← fc_ValidateParams, fc_ParamRepair
 *   toolResults / calledTools           ← fc_ExecuteTool（toolResults 用 merge reducer）
 *
 *   hitl_status / interrupt_payload     ← fc_ValidateParams（pause）, HumanInTheLoopGate（resume）
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
  tool_namespace: Annotation({ reducer: (x, y) => y ?? x, default: () => "executive_chat" }),

  // ─── Router 输出 (ContextAnalyzerRouter) ───
  // mode 是路由决策的唯一真值源：chat_only | tool_action | deny
  mode: Annotation({ reducer: (x, y) => y ?? x, default: () => "chat_only" }),
  intent: Annotation({ reducer: (x, y) => y ?? x, default: () => "" }),
  prevIntent: Annotation({ reducer: (x, y) => y ?? x, default: () => "" }),
  prevEntities: Annotation({ reducer: (x, y) => y ?? x, default: () => ({}) }),

  entities: Annotation({ reducer: (x, y) => y ?? x, default: () => ({}) }),
  entities_raw: Annotation({ reducer: (x, y) => y ?? x, default: () => ({}) }),
  entities_confidence: Annotation({ reducer: (x, y) => y ?? x, default: () => ({}) }),

  // ─── 记忆注入 (LoadContext) ───
  // 注：之前还有一个 memoryContext（预格式化字符串），已移除；
  // 使用点（router prompt、fc llm prompt）按需从 memory_snippets 渲染。
  memory_snippets: Annotation({ reducer: (x, y) => y ?? x, default: () => [] }),

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
  // hitl_status: idle | pending_interrupt | resumed
  // interrupt_payload: pause 时由 fc_ValidateParams 写入；resume 后被 HITLGate 清空
  // hitl_resume_payload: 用户回包（可能是确认/选择/intent_shift）
  hitl_status: Annotation({ reducer: (x, y) => y ?? x, default: () => "idle" }),
  interrupt_payload: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  hitl_resume_payload: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),

  // ─── 元数据与跟踪 ───
  meta_trace_id: Annotation({ reducer: (x, y) => y ?? x, default: () => "" }),
  meta_routing_tier: Annotation({ reducer: (x, y) => y ?? x, default: () => "" }),
  meta_fallback_count: Annotation({ reducer: (x, y) => (y !== undefined ? y : x), default: () => 0 })
});

module.exports = { ExecChatGraphState };
