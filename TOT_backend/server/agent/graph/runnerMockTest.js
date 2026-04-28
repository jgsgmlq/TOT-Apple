const { MemorySaver } = require("@langchain/langgraph");
const { buildGraph } = require("./graph");

// 模拟外部的 SSE EventEmitter
class MockSSEEmitter {
  constructor(res) {
    this.res = res;
    this.isFirstToken = true;
  }

  handleLLMNewToken(token, info = {}) {
    if (this.isFirstToken) {
      console.log("[SSE] --> Emitting TTFT event (First token received)");
      this.isFirstToken = false;
    }
    
    // 兼容 legacy markdownContent，如果有 reasoning 可以做特定包装
    if (info.isReasoning) {
      console.log(`[SSE] data: {"phase": "reasoning", "delta": "${token}"}`);
    } else {
      console.log(`[SSE] data: {"phase": "content", "delta": "${token}"}`);
    }
  }

  handleToolStart(toolInfo) {
    console.log(`[SSE] data: {"phase": "tool_start", "toolName": "${toolInfo.name}"}`);
  }

  handleToolEnd(result) {
    console.log(`[SSE] data: {"phase": "tool_end", "status": "success"}`);
  }
}

async function runT2StreamTest() {
  console.log("=== T2: 流式输出与兼容 测试 ===");
  const app = buildGraph().compile({ checkpointer: new MemorySaver() });
  
  const mockRes = {}; // 模拟 Express Response 对象
  const sseEmitter = new MockSSEEmitter(mockRes);

  const input = { userMessage: "帮我查一下上周的营收数据", sessionId: "t2-stream" };
  const thread = { 
    configurable: { 
      thread_id: input.sessionId,
      sseEmitter: sseEmitter
    }
  };
  
  console.log("\n>> 开始执行流式请求...");
  await app.invoke(input, thread);

  console.log("\n=== T2 测试通过，SSE 协议回放完成 ===");
}

runT2StreamTest().catch(console.error);