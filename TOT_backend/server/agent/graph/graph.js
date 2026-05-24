const { StateGraph, END, START } = require("@langchain/langgraph");
const { ExecChatGraphState } = require("./state");
const { loadContext } = require("./nodes/loadContext");
const { safetyGateway } = require("./nodes/safetyGateway");
const { fc_CheckSteps } = require("./nodes/fc_CheckSteps");
const { fc_LlmToolCallStep } = require("./nodes/fc_LlmToolCallStep");
const { fc_CheckDuplicate } = require("./nodes/fc_CheckDuplicate");
const { fc_ExecuteTool } = require("./nodes/fc_ExecuteTool");
const { fc_MergeToolResults } = require("./nodes/fc_MergeToolResults");

const { humanInTheLoopGate } = require("./nodes/humanInTheLoopGate");
const { resolveEntities } = require("./nodes/resolveEntities");
const { finalResponseStep } = require("./nodes/finalResponseStep");
const { persistAndEmit } = require("./nodes/persistAndEmit");
const { maybeWrapNode, maybeWrapRoute } = require("./shared/graphDebugger");

const routeAfterSafetyGateway = (state) => {
  if (state.mode === "deny") return "FinalResponseStep";
  if (state.mode === "chat") return "FinalResponseStep";
  return "resolveEntities";
};

const routeAfterResolveEntities = (state) => {
  if (state.ambiguity_payload) return "HumanInTheLoopGate";
  return "fc_CheckSteps";
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
  if (state.hitl_status === 'pending_interrupt') return "HumanInTheLoopGate";
  if (state.escalate_count >= 1) return "FinalResponseStep";
  return "fc_MergeToolResults";
};

const routeAfterMerge = (state) => {
  const maxSteps = Number(process.env.MAX_FC_ROUNDS) || 3;
  if (state.fc_super_step_count >= maxSteps) {
    return "FinalResponseStep";
  }
  return "fc_CheckSteps";
};

const routeAfterHumanInTheLoop = (state) => {
  if (state.fc_next_action === "finalize") return "FinalResponseStep";
  return "fc_CheckSteps";
};

const buildGraph = () => {
  const wn = (name, fn) => maybeWrapNode(name, fn);
  const wr = (from, fn) => maybeWrapRoute(from, fn);

  const workflow = new StateGraph(ExecChatGraphState)
    .addNode("LoadContext", wn("LoadContext", loadContext))
    .addNode("SafetyGateway", wn("SafetyGateway", safetyGateway))
    .addNode("resolveEntities", wn("resolveEntities", resolveEntities))
    .addNode("fc_CheckSteps", wn("fc_CheckSteps", fc_CheckSteps))
    .addNode("fc_LlmToolCallStep", wn("fc_LlmToolCallStep", fc_LlmToolCallStep))
    .addNode("fc_CheckDuplicate", wn("fc_CheckDuplicate", fc_CheckDuplicate))
    .addNode("fc_ExecuteTool", wn("fc_ExecuteTool", fc_ExecuteTool))
    .addNode("fc_MergeToolResults", wn("fc_MergeToolResults", fc_MergeToolResults))

    .addNode("HumanInTheLoopGate", wn("HumanInTheLoopGate", humanInTheLoopGate))
    .addNode("FinalResponseStep", wn("FinalResponseStep", finalResponseStep))
    .addNode("PersistAndEmit", wn("PersistAndEmit", persistAndEmit));

  workflow.addEdge(START, "LoadContext");
  workflow.addEdge("LoadContext", "SafetyGateway");

  workflow.addConditionalEdges("SafetyGateway", wr("SafetyGateway", routeAfterSafetyGateway), {
    "FinalResponseStep": "FinalResponseStep",
    "resolveEntities": "resolveEntities",
  });

  workflow.addConditionalEdges("resolveEntities", wr("resolveEntities", routeAfterResolveEntities), {
    "HumanInTheLoopGate": "HumanInTheLoopGate",
    "fc_CheckSteps": "fc_CheckSteps",
  });

  workflow.addConditionalEdges("fc_CheckSteps", wr("fc_CheckSteps", routeAfterFcCheckSteps), {
    "fc_LlmToolCallStep": "fc_LlmToolCallStep",
    "FinalResponseStep": "FinalResponseStep",
  });

  workflow.addConditionalEdges("fc_LlmToolCallStep", wr("fc_LlmToolCallStep", routeAfterFcLlm), {
    "fc_CheckDuplicate": "fc_CheckDuplicate",
    "FinalResponseStep": "FinalResponseStep",
  });

  workflow.addConditionalEdges("fc_CheckDuplicate", wr("fc_CheckDuplicate", routeAfterCheckDuplicate), {
    "fc_ExecuteTool": "fc_ExecuteTool",
    "fc_MergeToolResults": "fc_MergeToolResults",
  });

  workflow.addConditionalEdges("fc_ExecuteTool", wr("fc_ExecuteTool", routeAfterExecute), {
    "fc_MergeToolResults": "fc_MergeToolResults",

    "HumanInTheLoopGate": "HumanInTheLoopGate",
  });

  workflow.addConditionalEdges("fc_MergeToolResults", wr("fc_MergeToolResults", routeAfterMerge), {
    "fc_CheckSteps": "fc_CheckSteps",
    "FinalResponseStep": "FinalResponseStep",
  });

  workflow.addConditionalEdges("HumanInTheLoopGate", wr("HumanInTheLoopGate", routeAfterHumanInTheLoop), {
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
  routeAfterResolveEntities,
  routeAfterFcCheckSteps,
  routeAfterFcLlm,
  routeAfterCheckDuplicate,
  routeAfterExecute,
  routeAfterMerge,
  routeAfterHumanInTheLoop,
};
