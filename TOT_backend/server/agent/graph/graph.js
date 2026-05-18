const { StateGraph, END, START } = require("@langchain/langgraph");
const { ExecChatGraphState } = require("./state");
const { loadContext } = require("./nodes/loadContext");
const { safetyGateway } = require("./nodes/safetyGateway");
const { fc_CheckSteps } = require("./nodes/fc_CheckSteps");
const { fc_LlmToolCallStep } = require("./nodes/fc_LlmToolCallStep");
const { fc_CheckDuplicate } = require("./nodes/fc_CheckDuplicate");
const { fc_ExecuteTool } = require("./nodes/fc_ExecuteTool");
const { fc_MergeToolResults } = require("./nodes/fc_MergeToolResults");
const { fc_Escalate } = require("./nodes/fc_Escalate");
const { humanInTheLoopGate } = require("./nodes/humanInTheLoopGate");
const { finalResponseStep } = require("./nodes/finalResponseStep");
const { persistAndEmit } = require("./nodes/persistAndEmit");

const routeAfterSafetyGateway = (state) => {
  if (state.mode === "deny") return "deny";
  if (state.mode === "chat") return "chat";
  if (state.ambiguity_payload) return "hitl";
  return "fc";
};

const routeAfterFcCheckSteps = (state) => {
  const maxSteps = Number(process.env.MAX_FC_ROUNDS) || 3;
  if (state.fc_super_step_count >= maxSteps) {
    return "FinalResponseStep";
  }
  return "fc_LlmToolCallStep";
};

const routeAfterFcLlm = (state) => {
  const lastMsg = state.messages[state.messages.length - 1];
  if (lastMsg && lastMsg.tool_calls && lastMsg.tool_calls.length > 0) {
    return "fc_CheckDuplicate";
  }
  return "FinalResponseStep";
};

const routeAfterCheckDuplicate = (state) => {
  if (state.pending_tool_calls && state.pending_tool_calls.length > 0) {
    return "fc_ExecuteTool";
  }
  return "fc_MergeToolResults";
};

const routeAfterExecute = (state) => {
  if (state.escalate_count >= 1) return "fc_Escalate";
  return "fc_MergeToolResults";
};

const routeAfterMerge = (state) => {
  const maxSteps = Number(process.env.MAX_FC_ROUNDS) || 3;
  if (state.fc_super_step_count >= maxSteps) {
    return "FinalResponseStep";
  }
  return "fc_CheckSteps";
};

const routeAfterEscalate = (state) => {
  if (state.fc_next_action === "continue") return "fc_LlmToolCallStep";
  return "FinalResponseStep";
};

const routeAfterHumanInTheLoop = (state) => {
  if (state.fc_next_action === "finalize") return "FinalResponseStep";
  return "fc_CheckSteps";
};

const buildGraph = () => {
  const workflow = new StateGraph(ExecChatGraphState)
    .addNode("LoadContext", loadContext)
    .addNode("SafetyGateway", safetyGateway)
    .addNode("fc_CheckSteps", fc_CheckSteps)
    .addNode("fc_LlmToolCallStep", fc_LlmToolCallStep)
    .addNode("fc_CheckDuplicate", fc_CheckDuplicate)
    .addNode("fc_ExecuteTool", fc_ExecuteTool)
    .addNode("fc_MergeToolResults", fc_MergeToolResults)
    .addNode("fc_Escalate", fc_Escalate)
    .addNode("HumanInTheLoopGate", humanInTheLoopGate)
    .addNode("FinalResponseStep", finalResponseStep)
    .addNode("PersistAndEmit", persistAndEmit);

  workflow.addEdge(START, "LoadContext");
  workflow.addEdge("LoadContext", "SafetyGateway");

  workflow.addConditionalEdges("SafetyGateway", routeAfterSafetyGateway, {
    deny: "FinalResponseStep",
    chat: "FinalResponseStep",
    hitl: "HumanInTheLoopGate",
    fc: "fc_CheckSteps",
  });

  workflow.addConditionalEdges("fc_CheckSteps", routeAfterFcCheckSteps, {
    "fc_LlmToolCallStep": "fc_LlmToolCallStep",
    "FinalResponseStep": "FinalResponseStep",
  });

  workflow.addConditionalEdges("fc_LlmToolCallStep", routeAfterFcLlm, {
    "fc_CheckDuplicate": "fc_CheckDuplicate",
    "FinalResponseStep": "FinalResponseStep",
  });

  workflow.addConditionalEdges("fc_CheckDuplicate", routeAfterCheckDuplicate, {
    "fc_ExecuteTool": "fc_ExecuteTool",
    "fc_MergeToolResults": "fc_MergeToolResults",
  });

  workflow.addConditionalEdges("fc_ExecuteTool", routeAfterExecute, {
    "fc_MergeToolResults": "fc_MergeToolResults",
    "fc_Escalate": "fc_Escalate",
  });

  workflow.addConditionalEdges("fc_MergeToolResults", routeAfterMerge, {
    "fc_CheckSteps": "fc_CheckSteps",
    "FinalResponseStep": "FinalResponseStep",
  });

  workflow.addConditionalEdges("fc_Escalate", routeAfterEscalate, {
    "fc_LlmToolCallStep": "fc_LlmToolCallStep",
    "FinalResponseStep": "FinalResponseStep",
  });

  workflow.addConditionalEdges("HumanInTheLoopGate", routeAfterHumanInTheLoop, {
    "fc_CheckSteps": "fc_CheckSteps",
    "FinalResponseStep": "FinalResponseStep",
  });

  workflow.addEdge("FinalResponseStep", "PersistAndEmit");
  workflow.addEdge("PersistAndEmit", END);

  return workflow;
};

module.exports = {
  buildGraph,
  routeAfterSafetyGateway,
  routeAfterFcCheckSteps,
  routeAfterFcLlm,
  routeAfterCheckDuplicate,
  routeAfterExecute,
  routeAfterMerge,
  routeAfterEscalate,
  routeAfterHumanInTheLoop,
};
