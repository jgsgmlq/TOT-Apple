const { MemorySaver } = require("@langchain/langgraph");
const { buildGraph } = require("./graph");

// 模拟官方的 langfuse-langchain 里的 CallbackHandler
class MockLangfuseCallbackHandler {
  constructor(options) {
    this.name = "LangfuseCallbackHandler";
    this.sessionId = options.sessionId;
    this.userId = options.userId;
    console.log(`[Langfuse Init] 注入全局追踪, sessionId: ${this.sessionId}`);
  }

  handleChainStart(run) {
    console.log(`[Langfuse Trace] Chain / Root Span Started: ${run.name || 'AgentGraph'}`);
  }
  
  handleToolStart(tool) {
    console.log(`[Langfuse Trace] Tool Span Started: ${tool.name}`);
  }

  handleToolEnd(output) {
    console.log(`[Langfuse Trace] Tool Span Ended, Output Len: ${output?.length}`);
  }
}

async function runT5MockTests() {
  console.log("=== T5: 观测与评测 测试 ===");
  const app = buildGraph().compile({ checkpointer: new MemorySaver() });
  
  const testCases = [
    {
      name: "核心场景回归: 正常查数据",
      input: { userMessage: "帮我查一下全国的营收", sessionId: "t5-core", regionScope: { type: "national" } }
    },
    {
      name: "风险场景回归: 参数修补超限熔断",
      input: { userMessage: "查营收 (无地点)", sessionId: "t5-risk", regionScope: { type: "national" } }
    }
  ];

  for (const tc of testCases) {
    console.log(`\n\n>> 执行: ${tc.name}`);
    const langfuseHandler = new MockLangfuseCallbackHandler({ sessionId: tc.input.sessionId, userId: "tester_01" });
    
    // T5: 将 Langfuse Handler 作为标准 callback 传入 graph 的 config 中
    const thread = { 
      configurable: { thread_id: tc.input.sessionId },
      callbacks: [langfuseHandler]
    };
    
    await app.invoke(tc.input, thread);
  }

  console.log("\n=== T5 测试通过 ===");
}

runT5MockTests().catch(console.error);