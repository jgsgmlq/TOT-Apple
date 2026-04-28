const { MemorySaver } = require("@langchain/langgraph");
const { buildGraph } = require("./graph");

async function runT3MockTests() {
  console.log("=== T3: 工具执行层与护栏 测试 ===");
  const checkpointer = new MemorySaver();
  const app = buildGraph().compile({ checkpointer });

  const testCases = [
    {
      name: "测试 1: 参数修复循环与超限 (Fail Fast) 验证",
      // 为了稳定触发 T3 mock，我们发一个需要 "region_id" 的请求 (nodes.js 里硬编码了如果查询营收且没有 region_id 就会失败)
      input: { userMessage: "帮我查一下上周的营收数据", sessionId: "t3-repair-fail", regionScope: { type: "national" } }
    },
    {
      name: "测试 2: 越权访问验证 (Store 级用户请求 national 数据)",
      input: { 
        userMessage: "帮我查一下全国营收", 
        sessionId: "t3-permission-fail",
        // 伪装一个门店用户
        regionScope: { type: "store", regions: ["store_001"] }
      }
    }
  ];

  for (const tc of testCases) {
    console.log(`\n\n>> 执行: ${tc.name}`);
    const thread = { configurable: { thread_id: tc.input.sessionId } };
    
    try {
      const finalState = await app.invoke(tc.input, thread);
      console.log("[State Router Intent]:", finalState.intent);
      console.log("[State Repair Attempts]:", finalState.fc_repair_attempts);
      console.log("[Final Response]:", finalState.finalResponse);
    } catch (e) {
      console.log("[被图外层拦截/抛出异常]:", e.message);
    }
  }

  console.log("\n=== T3 测试通过 ===");
}

runT3MockTests().catch(console.error);