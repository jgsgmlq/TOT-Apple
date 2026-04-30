const { HumanMessage, AIMessage, ToolMessage } = require('@langchain/core/messages');

const state = {
  userMessage: "你好",
  messages: [
    new HumanMessage("你好"),
    new AIMessage({ content: "", tool_calls: [{ name: "test", args: {}, id: "1" }] }),
    new ToolMessage({ content: "test result", name: "test", tool_call_id: "1" })
  ]
};

const safeHistory = [...state.messages];
const lastMsg = safeHistory[safeHistory.length - 1];
const lastContent = typeof lastMsg.content === 'string' ? lastMsg.content : '';
if (lastMsg._getType() !== 'human' || lastContent !== state.userMessage) {
  safeHistory.push(new HumanMessage(state.userMessage));
}

console.log(safeHistory.map(m => `${m._getType()}: ${m.content}`));
