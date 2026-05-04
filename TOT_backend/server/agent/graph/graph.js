const { StateGraph, END, START } = require("@langchain/langgraph");
const { ExecChatGraphState } = require("./state");
const { loadContext, contextAnalyzerRouter, toolRetrieve, fc_CheckSteps, fc_LlmToolCallStep, fc_CheckDuplicate, fc_ValidateParams, fc_ParamRepair, fc_ExecuteTool, fc_MergeToolResults, persistAndEmit, humanInTheLoopGate, finalResponseAgent } = require("./nodes");

// 路由条件分支
const routeAfterRouter = (state) => {
  if (state.mode === "deny" || state.global_safety_decision === "deny") return "deny";
  if (state.mode === "chat_only") return "chat_only";
  if (state.mode === "tool_action") return "tool_action";
  return "chat_only"; // default
};

const RoutingPolicy = require('./routingPolicy');

const routeAfterFcCheckSteps = (state) => {
  const nextAction = state.fc_next_action;
  if (nextAction === 'finalize') return 'FinalResponseAgent';
  if (nextAction === 'hitl') return 'HumanInTheLoopGate';
  if (nextAction === 'repair') return 'fc_ParamRepair';
  if (nextAction === 'validate') return 'fc_ValidateParams';
  if (nextAction === 'execute') return 'fc_ExecuteTool';
  if (nextAction === 'merge') return 'fc_MergeToolResults';

  if (state.fc_super_step_count === 0) return 'fc_LlmToolCallStep';

  const maxSteps = state.router_max_steps || 3;
  if (state.fc_super_step_count >= maxSteps) return 'FinalResponseAgent';
  return 'fc_LlmToolCallStep';
};

const routeAfterFcLlm = (state) => {
  const lastMsg = state.messages[state.messages.length - 1];
  if (lastMsg && lastMsg.tool_calls && lastMsg.tool_calls.length > 0) {
    return 'fc_CheckDuplicate';
  }
  return 'FinalResponseAgent';
};

const routeAfterCheckDuplicate = (state) => {
  if (state.fc_next_action === 'merge') return 'fc_MergeToolResults';
  return 'fc_ValidateParams';
};

const routeAfterValidateParams = (state) => {
  if (state.fc_next_action === 'finalize') return 'FinalResponseAgent';
  if (state.fc_next_action === 'hitl') return 'HumanInTheLoopGate';
  if (state.fc_next_action === 'repair') return 'fc_ParamRepair';
  if (state.fc_next_action === 'execute') return 'fc_ExecuteTool';
  if (state.fc_next_action === 're_route') return 'ContextAnalyzerRouter';
  return 'FinalResponseAgent';
};

const routeAfterMerge = (state) => {
  if (state.fc_next_action === 'finalize') return 'FinalResponseAgent';
  return 'fc_CheckSteps';
};

const routeAfterHumanInTheLoop = (state) => {
  if (state.fc_next_action === 're_route') return 'ContextAnalyzerRouter';
  if (state.fc_next_action === 'validate') return 'fc_ValidateParams';
  if (state.fc_next_action === 'llm_direct') return 'fc_LlmToolCallStep';
  if (state.fc_next_action === 'finalize') return 'FinalResponseAgent';
  return 'fc_CheckSteps';
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
    .addNode("FinalResponseAgent", finalResponseAgent);

  // 定义边
  workflow.addEdge(START, "LoadContext");
  workflow.addEdge("LoadContext", "ContextAnalyzerRouter");

  // Router 三路分流
  workflow.addConditionalEdges("ContextAnalyzerRouter", routeAfterRouter, {
    deny: "FinalResponseAgent",
    chat_only: "FinalResponseAgent",
    tool_action: "ToolRetrieve"
  });

  workflow.addEdge("ToolRetrieve", "fc_CheckSteps");
  workflow.addConditionalEdges("fc_CheckSteps", routeAfterFcCheckSteps, {
    "fc_LlmToolCallStep": "fc_LlmToolCallStep",
    "FinalResponseAgent": "FinalResponseAgent",
    "HumanInTheLoopGate": "HumanInTheLoopGate",
    "fc_ParamRepair": "fc_ParamRepair",
    "fc_ValidateParams": "fc_ValidateParams",
    "fc_ExecuteTool": "fc_ExecuteTool",
    "fc_MergeToolResults": "fc_MergeToolResults"
  });

  workflow.addConditionalEdges("fc_LlmToolCallStep", routeAfterFcLlm, {
    "fc_CheckDuplicate": "fc_CheckDuplicate",
    "FinalResponseAgent": "FinalResponseAgent"
  });

  workflow.addConditionalEdges("fc_CheckDuplicate", routeAfterCheckDuplicate, {
    "fc_ValidateParams": "fc_ValidateParams",
    "fc_MergeToolResults": "fc_MergeToolResults"
  });
  
  workflow.addConditionalEdges("fc_ValidateParams", routeAfterValidateParams, {
    "fc_ExecuteTool": "fc_ExecuteTool",
    "fc_ParamRepair": "fc_ParamRepair",
    "FinalResponseAgent": "FinalResponseAgent",
    "HumanInTheLoopGate": "HumanInTheLoopGate",
    "ContextAnalyzerRouter": "ContextAnalyzerRouter"
  });

  workflow.addEdge("fc_ParamRepair", "fc_ValidateParams"); // 闭环修参
  workflow.addEdge("fc_ExecuteTool", "fc_MergeToolResults");
  workflow.addConditionalEdges("fc_MergeToolResults", routeAfterMerge, {
    "fc_CheckSteps": "fc_CheckSteps",
    "FinalResponseAgent": "FinalResponseAgent"
  });

  workflow.addConditionalEdges("HumanInTheLoopGate", routeAfterHumanInTheLoop, {
    "ContextAnalyzerRouter": "ContextAnalyzerRouter",
    "fc_ValidateParams": "fc_ValidateParams",
    "fc_LlmToolCallStep": "fc_LlmToolCallStep",
    "FinalResponseAgent": "FinalResponseAgent",
    "fc_CheckSteps": "fc_CheckSteps"
  });
  workflow.addEdge("FinalResponseAgent", "PersistAndEmit");
  workflow.addEdge("PersistAndEmit", END);

  return workflow;
};

module.exports = { buildGraph };
