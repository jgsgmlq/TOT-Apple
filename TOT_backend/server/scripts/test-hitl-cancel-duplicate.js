const { StateGraph, END, START } = require("@langchain/langgraph");
const { ExecChatGraphState } = require("../agent/graph/state");
const { AIMessage } = require("@langchain/core/messages");

const mockHitlGate = async (state) => {
  const cancelMsg = '已取消本次查询。如需继续，请告诉我新的问题。';
  return {
    hitl_status: 'resumed',
    reply_markdown: cancelMsg,
    finalResponse: cancelMsg,
    fc_next_action: 'finalize',
    messages: [new AIMessage({ content: cancelMsg })]
  };
};

const mockFinalResponse = async (state) => {
  let response = state.reply_markdown || state.finalResponse || "";
  return { finalResponse: response, reply_markdown: response, messages: [new AIMessage({ content: response })] };
};

const app = new StateGraph(ExecChatGraphState)
  .addNode("hitl", mockHitlGate)
  .addNode("final", mockFinalResponse)
  .addEdge(START, "hitl")
  .addEdge("hitl", "final")
  .addEdge("final", END)
  .compile();

async function run() {
  const res = await app.invoke({ userMessage: "test" });
  console.log("Messages length:", res.messages.length);
  res.messages.forEach(m => console.log(m.constructor.name, m.content));
}
run();
