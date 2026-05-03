const { MemorySaver } = require("@langchain/langgraph");
const { buildGraph } = require("./graph");
const { memoryQueueProducer } = require("../queue/bullMqProducer");

async function runT4MockTests() {
  console.log("=== T4: 记忆链路（Queue 抽象先行） 测试 ===");
  
  // 模拟启动时连接 Redis
  await memoryQueueProducer.connect();
  
  const checkpointer = new MemorySaver();
  const app = buildGraph().compile({ checkpointer });

  const input = { 
    userMessage: "你好，我现在只看华东区的营收", 
    sessionId: "t4-memory-stream",
    userId: "user_777"
  };
  const thread = { configurable: { thread_id: input.sessionId } };
  
  console.log(`\n>> 执行请求: "${input.userMessage}"`);
  
  const start = Date.now();
  const finalState = await app.invoke(input, thread);
  const end = Date.now();
  
  console.log(`\n[请求结束] 主线程耗时: ${end - start}ms (未被异步 MemoryWorker 阻塞)`);
  console.log("[Final Response]:", finalState.finalResponse);

  // 我们等待 1s 以便观察异步 Worker (setTimeout) 打印日志
  console.log("\n>> 等待后台异步队列消费...");
  await new Promise(resolve => setTimeout(resolve, 1000));

  console.log("\n=== T4 测试通过 ===");
}

runT4MockTests().catch(console.error);