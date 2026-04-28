const { BaseMessage } = require("@langchain/core/messages");
const { Annotation } = require("@langchain/langgraph");

// 按 2026-04-27-t0-freeze-spec.md 冻结的 ExecChatGraphState 定义单层状态机
const ExecChatGraphState = Annotation.Root({
  sessionId: Annotation({ reducer: (x, y) => y ?? x, default: () => "" }),
  userId: Annotation({ reducer: (x, y) => y ?? x, default: () => "" }),
  userMessage: Annotation({ reducer: (x, y) => y ?? x, default: () => "" }),
  memoryContext: Annotation({ reducer: (x, y) => y ?? x, default: () => "" }),
  
  // 消息追加
  messages: Annotation({ 
    reducer: (x, y) => x.concat(y), 
    default: () => [] 
  }),
  
  // 工具结果字典，按 tool_call_id 为键合并
  toolResults: Annotation({ 
    reducer: (x, y) => ({ ...x, ...y }), 
    default: () => ({}) 
  }),
  
  regionScope: Annotation({ reducer: (x, y) => y ?? x, default: () => ({ type: "national" }) }),
  tool_namespace: Annotation({ reducer: (x, y) => y ?? x, default: () => "executive_chat" }),

  // Router 输出
  intent: Annotation({ reducer: (x, y) => y ?? x, default: () => "" }),
  safety: Annotation({ reducer: (x, y) => y ?? x, default: () => "allow" }),
  entities: Annotation({ reducer: (x, y) => y ?? x, default: () => ({}) }),
  selected_tier: Annotation({ reducer: (x, y) => y ?? x, default: () => "L3_fc_guarded" }),
  
  // FC 控制字段
  fc_super_step_count: Annotation({ reducer: (x, y) => (y !== undefined ? y : x), default: () => 0 }),
  fc_current_step: Annotation({ reducer: (x, y) => (y !== undefined ? y : x), default: () => 0 }),
  fc_repair_attempts: Annotation({ reducer: (x, y) => (y !== undefined ? y : x), default: () => 0 }),
  repair_error_reason: Annotation({ reducer: (x, y) => y ?? x, default: () => "" }),
  
  // 错误或终止信息
  finalResponse: Annotation({ reducer: (x, y) => y ?? x, default: () => "" }),
  
  // 人在回路
  hitl_status: Annotation({ reducer: (x, y) => y ?? x, default: () => "idle" }),
  hitl_payload: Annotation({ reducer: (x, y) => y ?? x, default: () => null })
});

module.exports = { ExecChatGraphState };