const { StateGraph, END, START } = require("@langchain/langgraph");
const { ExecChatGraphState } = require("../agent/graph/state");
const { AIMessage } = require("@langchain/core/messages");

const mockValidate = async (state) => {
  return {
    finalResponse: "SYSTEM_ERROR: 工具参数校验失败。",
    messages: [new AIMessage({ content: "很抱歉，我无法执行该操作" })],
    fc_next_action: 'finalize'
  };
};

const mockFinalResponse = async (state) => {
  let response = state.reply_markdown || state.finalResponse || "";
  return { finalResponse: response, reply_markdown: response, messages: [new AIMessage({ content: response })] };
};

const app = new StateGraph(ExecChatGraphState)
  .addNode("val", mockValidate)
  .addNode("final", mockFinalResponse)
  .addEdge(START, "val")
  .addEdge("val", "final")
  .addEdge("final", END)
  .compile();

async function run() {
  const res = await app.invoke({ userMessage: "test" });
  console.log("Messages length:", res.messages.length);
  res.messages.forEach(m => console.log(m.constructor.name, m.content));
}
run();
