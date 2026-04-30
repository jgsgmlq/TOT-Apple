const { ChatOpenAI } = require("@langchain/openai");
const { HumanMessage, AIMessage, ToolMessage } = require("@langchain/core/messages");
require('dotenv').config({ path: '../../.env' });

const llm = new ChatOpenAI({
  modelName: "deepseek-chat",
  apiKey: process.env.DEEPSEEK_API_KEY || "dummy",
  configuration: { baseURL: process.env.DEEPSEEK_API_BASE_URL || "https://api.deepseek.com/v1" }
});

const msgs = [
  new HumanMessage("查一下南京门店"),
  new AIMessage({ content: "", tool_calls: [{ name: "clarify", args: {}, id: "123" }] }),
  new HumanMessage("算了，给我看全国的完成率")
];

llm.invoke(msgs).then(console.log).catch(err => console.error(err.message));
