const { MemorySaver } = require("@langchain/langgraph");
const { buildGraph } = require("./graph");

async function runMockTests() {
  console.log("=== T1: LangGraph Executive Chat PoC 骨架测试 ===");
  const checkpointer = new MemorySaver(); // PoC/单元测试期使用 MemorySaver，生产级将替换为 Postgres Checkpointer
  const app = buildGraph().compile({ checkpointer });

  const testCases = [
    {
      name: "测试 1: 闲聊分流 (chat_only)",
      input: { userMessage: "你好，最近怎么样？", sessionId: "t1-chat" }
    },
    {
      name: "测试 2: 危险操作拦截 (deny)",
      input: { userMessage: "帮我发邮件通知所有人", sessionId: "t1-deny" }
    },
    {
      name: "测试 3: 工具调用流转 (fc_*)",
      input: { userMessage: "帮我查一下上周的营收数据", sessionId: "t1-tool" }
    }
  ];

  for (const tc of testCases) {
    console.log(`\n\n>> 执行: ${tc.name}`);
    const thread = { configurable: { thread_id: tc.input.sessionId } };
    
    const finalState = await app.invoke(tc.input, thread);
    
    console.log("[State Router]:", { intent: finalState.intent, safety: finalState.safety });
    console.log("[Final Response]:", finalState.finalResponse || finalState.messages[finalState.messages.length - 1].content);
    if (tc.input.userMessage.includes("查数据") || finalState.intent === "tool_action") {
      console.log("[FC 循环次数]:", finalState.fc_super_step_count);
      console.log("[收集到的工具结果]:", Object.keys(finalState.toolResults || {}));
    }
  }

  console.log("\n=== T1 测试通过 ===");
}

runMockTests().catch(console.error);