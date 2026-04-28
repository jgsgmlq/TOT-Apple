const { StateGraph, END, START } = require("@langchain/langgraph");
const { ExecChatGraphState } = require("./state");
const { loadContext, contextAnalyzerRouter, toolRetrieve, fc_CheckSteps, fc_LlmToolCallStep, fc_CheckDuplicate, fc_ValidateParams, fc_ParamRepair, fc_ExecuteTool, fc_MergeToolResults, persistAndEmit, humanInTheLoopGate, finalResponseStep } = require("./nodes");

// 路由条件分支
const routeAfterRouter = (state) => {
  if (state.safety === "deny") return "deny";
  if (state.intent === "chat_only") return "chat_only";
  if (state.intent === "tool_action") return "tool_action";
  return "chat_only"; // default
};

const routeAfterFcCheckSteps = (state) => {
  // 根据阈值决定是继续还是终止循环
  const maxSteps = 3; // Mock value
  if (state.fc_super_step_count >= maxSteps) return "PersistAndEmit";
  return "fc_LlmToolCallStep";
};

const routeAfterFcLlm = (state) => {
  // 假如有 tool_calls，则进入 duplicate 校验
  const lastMsg = state.messages[state.messages.length - 1];
  if (lastMsg && lastMsg.tool_calls && lastMsg.tool_calls.length > 0) {
    return "fc_CheckDuplicate";
  }
  // 如果大模型不返回 tool_calls，说明得出答案或拒绝，直接走到 emit
  return "PersistAndEmit";
};

const routeAfterValidateParams = (state) => {
  // 如果意图已经降级（Fail Fast 中止），退出当前 FC 链
  if (state.intent === "chat_only") return "FinalResponseStep";

  // 根据上一步是否抛出 param 错误，如果是走 repair，否走 execute
  if (state.hitl_status === "pending_interrupt") return "HumanInTheLoopGate"; 
  
  // check if params failed and we incremented repair_attempts
  if (state.fc_repair_attempts > 0) {
    const lastMsg = state.messages[state.messages.length - 1];
    // 为了防止无限循环，这里简单判定如果 AI 输出包含 "SYSTEM_ERROR"，说明被 fail_fast 中止了
    if (state.intent === "chat_only") return "FinalResponseStep";
    return "fc_ParamRepair"; 
  }
  
  return "fc_ExecuteTool";
};

const routeAfterMerge = (state) => {
  return "fc_CheckSteps"; // 回到 Check 决定是否继续 super step
};

// 骨架搭建
const buildGraph = () => {
  const workflow = new StateGraph(ExecChatGraphState)
    // 注册节点
    .addNode("LoadContext", loadContext)
    .addNode("ContextAnalyzerRouter", contextAnalyzerRouter)
    .addNode("ToolRetrieve", toolRetrieve)
    .addNode("fc_CheckSteps", fc_CheckSteps)
    .addNode("fc_LlmToolCallStep", fc_LlmToolCallStep)
    .addNode("fc_CheckDuplicate", fc_CheckDuplicate)
    .addNode("fc_ValidateParams", fc_ValidateParams)
    .addNode("fc_ParamRepair", fc_ParamRepair)
    .addNode("fc_ExecuteTool", fc_ExecuteTool)
    .addNode("fc_MergeToolResults", fc_MergeToolResults)
    .addNode("PersistAndEmit", persistAndEmit)
    .addNode("HumanInTheLoopGate", humanInTheLoopGate)
    .addNode("FinalResponseStep", finalResponseStep);

  // 定义边
  workflow.addEdge(START, "LoadContext");
  workflow.addEdge("LoadContext", "ContextAnalyzerRouter");

  // Router 三路分流
  workflow.addConditionalEdges("ContextAnalyzerRouter", routeAfterRouter, {
    deny: "FinalResponseStep",
    chat_only: "FinalResponseStep",
    tool_action: "ToolRetrieve"
  });

  workflow.addEdge("ToolRetrieve", "fc_CheckSteps");
  workflow.addConditionalEdges("fc_CheckSteps", routeAfterFcCheckSteps, {
    "fc_LlmToolCallStep": "fc_LlmToolCallStep",
    "PersistAndEmit": "PersistAndEmit"
  });

  workflow.addConditionalEdges("fc_LlmToolCallStep", routeAfterFcLlm, {
    "fc_CheckDuplicate": "fc_CheckDuplicate",
    "PersistAndEmit": "PersistAndEmit"
  });

  workflow.addEdge("fc_CheckDuplicate", "fc_ValidateParams");
  
  workflow.addConditionalEdges("fc_ValidateParams", routeAfterValidateParams, {
    "fc_ExecuteTool": "fc_ExecuteTool",
    "fc_ParamRepair": "fc_ParamRepair",
    "FinalResponseStep": "FinalResponseStep",
    "HumanInTheLoopGate": "HumanInTheLoopGate"
  });

  workflow.addEdge("fc_ParamRepair", "fc_ValidateParams"); // 闭环修参
  workflow.addEdge("fc_ExecuteTool", "fc_MergeToolResults");
  workflow.addConditionalEdges("fc_MergeToolResults", routeAfterMerge, {
    "fc_CheckSteps": "fc_CheckSteps"
  });

  workflow.addEdge("HumanInTheLoopGate", "fc_CheckSteps"); // 从挂起恢复后重新进入 loop
  workflow.addEdge("FinalResponseStep", "PersistAndEmit");
  workflow.addEdge("PersistAndEmit", END);

  return workflow;
};

module.exports = { buildGraph };