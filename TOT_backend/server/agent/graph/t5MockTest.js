const { MemorySaver } = require("@langchain/langgraph");
const { buildGraph } = require("./graph");
// 引入核心的 Langfuse 客户端
const { Langfuse } = require("langfuse");

async function runT5MockTests() {
  console.log("=== T5: 观测与评测 测试 (真实 Langfuse Core SDK) ===");
  const app = buildGraph().compile({ checkpointer: new MemorySaver() });
  
  // 初始化真实 Langfuse Core 客户端
  const langfuse = new Langfuse({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    baseUrl: process.env.LANGFUSE_BASEURL || process.env.LANGFUSE_HOST
  });

  // 监听内部异常
  langfuse.on("error", (error) => {
    console.error("[Langfuse 内部错误]:", error);
  });

  const testCases = [
    {
      name: "核心场景回归: 正常查数据",
      input: { userMessage: "帮我查一下全国的营收", sessionId: "t5-core-native", regionScope: { type: "national" } }
    },
    {
      name: "风险场景回归: 参数修补超限熔断",
      input: { userMessage: "查营收 (无地点)", sessionId: "t5-risk-native", regionScope: { type: "national" } }
    }
  ];

  for (const tc of testCases) {
    console.log(`\n\n>> 执行: ${tc.name}`);
    
    // 从环境变量或系统环境中提取当前开发者和环境信息
    const currentDeveloper = process.env.USER || process.env.LOGNAME || "unknown_dev";
    const currentEnv = process.env.NODE_ENV || "development";
    // 假设可以通过环境变量注入当前的分支名，否则使用本地默认值
    const currentBranch = process.env.GIT_BRANCH || "Echat2.0";

    // T5: 在流程外层手动开启一个 Trace 根节点，注入高度区分的 Tags 和 Metadata
    const trace = langfuse.trace({
      name: `ExecutiveChat-LangGraph-[${currentDeveloper}]`, // 让追踪名称一目了然是谁的请求
      sessionId: tc.input.sessionId,
      userId: currentDeveloper, // 使用开发者作为 UserID
      tags: ["executive_chat", "langgraph_poc", `dev:${currentDeveloper}`, `env:${currentEnv}`],
      metadata: {
        environment: currentEnv,
        developer: currentDeveloper,
        branch: currentBranch,
      },
      input: tc.input
    });
    
    const thread = { 
      configurable: { thread_id: tc.input.sessionId }
    };
    
    // 执行图流转
    const finalState = await app.invoke(tc.input, thread);
    
    // 流程结束后，把状态机里的关键指标与之前的环境参数一并写入 Trace Metadata 中
    trace.update({
      output: finalState.finalResponse || finalState.messages[finalState.messages.length - 1]?.content,
      metadata: {
        environment: currentEnv,
        developer: currentDeveloper,
        branch: currentBranch,
        selected_tier: finalState.selected_tier,
        fc_steps_used: finalState.fc_super_step_count,
        repair_attempts: finalState.fc_repair_attempts,
        intent: finalState.intent,
        hitl_status: finalState.hitl_status
      }
    });

    console.log(`[Langfuse Trace] 已生成/更新 Trace: ${trace.id}`);
  }

  console.log("\n=== T5 测试执行完毕，等待数据 Flush ===");
  // Langfuse 是异步批量发送的，调用 flushAsync 等待上报完成
  try {
    await langfuse.flushAsync();
    console.log("=== 数据已成功 flush 到 Langfuse 面板 (" + langfuse.baseUrl + ") ===");
  } catch (err) {
    console.error("!!! [致命错误] Langfuse 数据上报失败:", err);
  }
}

runT5MockTests().catch(console.error);