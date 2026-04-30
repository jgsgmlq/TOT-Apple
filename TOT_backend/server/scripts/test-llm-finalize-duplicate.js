const { StateGraph, END, START } = require("@langchain/langgraph");
const { ExecChatGraphState } = require("../agent/graph/state");
const { AIMessage } = require("@langchain/core/messages");

const mockLlm = async (state) => {
  const aiMessage = new AIMessage({ content: "我是大模型的最终回答" });
  return {
    messages: [aiMessage],
    finalResponse: aiMessage.content,
    reply_markdown: aiMessage.content,
    fc_next_action: 'finalize'
  };
};

const mockFinalResponse = async (state) => {
  let response = state.reply_markdown || state.finalResponse || "";
  return { finalResponse: response, reply_markdown: response, messages: [new AIMessage({ content: response })] };
};

const app = new StateGraph(ExecChatGraphState)
  .addNode("llm", mockLlm)
  .addNode("final", mockFinalResponse)
  .addEdge(START, "llm")
  .addEdge("llm", "final")
  .addEdge("final", END)
  .compile();

async function run() {
  const res = await app.invoke({ userMessage: "test" });
  console.log("Messages length:", res.messages.length);
  res.messages.forEach(m => console.log(m.constructor.name, m.content));
}
run();
