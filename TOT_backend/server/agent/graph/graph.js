const { StateGraph, END, START } = require("@langchain/langgraph");
const { ExecChatGraphState } = require("./state");
const { loadContext } = require("./nodes/loadContext");
const { contextAnalyzerRouter } = require("./nodes/contextAnalyzerRouter");
const { toolRetrieve } = require("./nodes/toolRetrieve");
const { fc_CheckSteps } = require("./nodes/fc_CheckSteps");
const { fc_LlmToolCallStep } = require("./nodes/fc_LlmToolCallStep");
const { fc_CheckDuplicate } = require("./nodes/fc_CheckDuplicate");
const { fc_ValidateParams } = require("./nodes/fc_ValidateParams");
const { fc_ParamRepair } = require("./nodes/fc_ParamRepair");
const { fc_ExecuteTool } = require("./nodes/fc_ExecuteTool");
const { fc_MergeToolResults } = require("./nodes/fc_MergeToolResults");
const { humanInTheLoopGate } = require("./nodes/humanInTheLoopGate");
const { finalResponseStep } = require("./nodes/finalResponseStep");
const { persistAndEmit } = require("./nodes/persistAndEmit");

// 路由条件分支
const routeAfterRouter = (state) => {
  if (state.mode === "deny") return "deny";

  // 闲聊捷径：极短消息（<5字）→ 无条件跳 FC 循环
  // 含 5-9 字 + 无数据上下文 → 也跳。长消息或已有数据上下文的短消息走 FC。
  if (state.mode === "chat_only" || state.intent === "chat_only") {
    const msg = (state.userMessage || '').trim();
    if (msg.length < 5) return "chat_only";
    if (msg.length < 10) {
      const hasDataContext = (state.messages || []).some(m => {
        if (!m._getType || m._getType() !== 'ai') return false;
        const c = typeof m.content === 'string' ? m.content : '';
        return c.includes('|') || c.includes('完成率') || c.includes('###');
      });
      if (!hasDataContext) return "chat_only";
    }
  }

  return "tool_action";
};

const RoutingPolicy = require('./routingPolicy');

const routeAfterFcCheckSteps = (state) => {
  const nextAction = state.fc_next_action;
  if (nextAction === 'finalize') return 'FinalResponseStep';
  if (nextAction === 'hitl') return 'HumanInTheLoopGate';
  if (nextAction === 'repair') return 'fc_ParamRepair';
  if (nextAction === 'validate') return 'fc_ValidateParams';
  if (nextAction === 'execute') return 'fc_ExecuteTool';
  if (nextAction === 'merge') return 'fc_MergeToolResults';

  // 必须保证只要还没有超过 maxSteps，每次 CheckSteps 都默认回流到 LLM 节点，以消化 tool result
  const maxSteps = RoutingPolicy.tiers[state.selected_tier]?.max_super_steps || 3;
  
  // 如果刚合并完工具结果，必须给 LLM 一次机会去总结，不管是不是超出了 maxSteps
  const lastMsg = state.messages[state.messages.length - 1];
  const isJustMerged = lastMsg && lastMsg._getType() === 'tool';
  
  if (state.fc_super_step_count >= maxSteps && !isJustMerged) {
    return 'FinalResponseStep';
  }
  
  return 'fc_LlmToolCallStep';
};

const routeAfterFcLlm = (state) => {
  const lastMsg = state.messages[state.messages.length - 1];
  if (lastMsg && lastMsg.tool_calls && lastMsg.tool_calls.length > 0) {
    return 'fc_CheckDuplicate';
  }
  return 'FinalResponseStep';
};

const routeAfterCheckDuplicate = (state) => {
  if (state.fc_next_action === 'merge') return 'fc_MergeToolResults';
  return 'fc_ValidateParams';
};

const routeAfterValidateParams = (state) => {
  if (state.fc_next_action === 'finalize') return 'FinalResponseStep';
  if (state.fc_next_action === 'hitl') return 'HumanInTheLoopGate';
  if (state.fc_next_action === 'repair') return 'fc_ParamRepair';
  if (state.fc_next_action === 'execute') return 'fc_ExecuteTool';
  if (state.fc_next_action === 're_route') return 'ContextAnalyzerRouter';
  return 'FinalResponseStep';
};

const routeAfterMerge = (state) => {
  if (state.fc_next_action === 'finalize') return 'FinalResponseStep';
  return 'fc_CheckSteps';
};

const routeAfterHumanInTheLoop = (state) => {
  if (state.fc_next_action === 're_route') return 'ContextAnalyzerRouter';
  if (state.fc_next_action === 'validate') return 'fc_ValidateParams';
  if (state.fc_next_action === 'finalize') return 'FinalResponseStep';
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
    .addNode("FinalResponseStep", finalResponseStep);

  // 定义边
  workflow.addEdge(START, "LoadContext");
  workflow.addEdge("LoadContext", "ContextAnalyzerRouter");

  // Router 三路分流：deny 拒绝 / 纯闲聊直达 / 其余走 FC 循环
  workflow.addConditionalEdges("ContextAnalyzerRouter", routeAfterRouter, {
    deny: "FinalResponseStep",
    chat_only: "FinalResponseStep",
    tool_action: "ToolRetrieve"
  });

  workflow.addEdge("ToolRetrieve", "fc_CheckSteps");
  workflow.addConditionalEdges("fc_CheckSteps", routeAfterFcCheckSteps, {
    "fc_LlmToolCallStep": "fc_LlmToolCallStep",
    "FinalResponseStep": "FinalResponseStep",
    "HumanInTheLoopGate": "HumanInTheLoopGate",
    "fc_ParamRepair": "fc_ParamRepair",
    "fc_ValidateParams": "fc_ValidateParams",
    "fc_ExecuteTool": "fc_ExecuteTool",
    "fc_MergeToolResults": "fc_MergeToolResults"
  });

  workflow.addConditionalEdges("fc_LlmToolCallStep", routeAfterFcLlm, {
    "fc_CheckDuplicate": "fc_CheckDuplicate",
    "FinalResponseStep": "FinalResponseStep"
  });

  workflow.addConditionalEdges("fc_CheckDuplicate", routeAfterCheckDuplicate, {
    "fc_ValidateParams": "fc_ValidateParams",
    "fc_MergeToolResults": "fc_MergeToolResults"
  });
  
  workflow.addConditionalEdges("fc_ValidateParams", routeAfterValidateParams, {
    "fc_ExecuteTool": "fc_ExecuteTool",
    "fc_ParamRepair": "fc_ParamRepair",
    "FinalResponseStep": "FinalResponseStep",
    "HumanInTheLoopGate": "HumanInTheLoopGate",
    "ContextAnalyzerRouter": "ContextAnalyzerRouter"
  });

  workflow.addEdge("fc_ParamRepair", "fc_ValidateParams"); // 闭环修参
  workflow.addEdge("fc_ExecuteTool", "fc_MergeToolResults");
  workflow.addConditionalEdges("fc_MergeToolResults", routeAfterMerge, {
    "fc_CheckSteps": "fc_CheckSteps",
    "FinalResponseStep": "FinalResponseStep"
  });

  workflow.addConditionalEdges("HumanInTheLoopGate", routeAfterHumanInTheLoop, {
    "ContextAnalyzerRouter": "ContextAnalyzerRouter",
    "fc_ValidateParams": "fc_ValidateParams",
    "FinalResponseStep": "FinalResponseStep",
    "fc_CheckSteps": "fc_CheckSteps"
  });
  workflow.addEdge("FinalResponseStep", "PersistAndEmit");
  workflow.addEdge("PersistAndEmit", END);

  return workflow;
};

module.exports = { buildGraph };
