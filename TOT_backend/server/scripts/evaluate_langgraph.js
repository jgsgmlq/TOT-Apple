'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { Langfuse } = require('langfuse');
const { MemorySaver } = require('@langchain/langgraph');
const { buildGraph } = require('../agent/graph/graph');

/**
 * T5 阶段二: 真实落地 - 评测脚本
 * 模拟从 Langfuse 拉取 Dataset、批量执行并回传 Score (如 routing_compliance, param_first_pass_rate)
 */
async function runEvaluation() {
  console.log('=== 开始执行 Executive Chat LangGraph 自动化评测 ===');

  const langfuse = new Langfuse({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    baseUrl: process.env.LANGFUSE_BASEURL || process.env.LANGFUSE_HOST
  });

  const datasetName = 'executive_chat_core_regression';
  let dataset;

  try {
    // 尝试拉取线上数据集
    console.log(`[Eval] 尝试从 Langfuse 拉取数据集: ${datasetName}...`);
    dataset = await langfuse.getDataset(datasetName);
    console.log(`[Eval] 成功拉取数据集，包含 ${dataset.items.length} 条测试用例。`);
  } catch (err) {
    console.warn(`[Eval] 未找到线上数据集或连接失败 (${err.message})。将使用本地 mock 数据集兜底运行。`);
    // 兜底本地 Mock 数据集
    dataset = {
      name: datasetName,
      items: [
        {
          id: 'test-case-1',
          input: { userMessage: "帮我查一下上周全国的营收", regionScope: { type: "national" } },
          expectedOutput: { intent: "tool_action" }
        },
        {
          id: 'test-case-2',
          input: { userMessage: "你好", regionScope: { type: "national" } },
          expectedOutput: { intent: "chat_only" }
        }
      ]
    };
  }

  const app = buildGraph().compile({ checkpointer: new MemorySaver() });

  let totalCases = 0;
  let passedCases = 0;

  // 遍历并执行每一条测试
  for (const item of dataset.items) {
    totalCases++;
    console.log(`\n>> 评测用例: ${item.id}`);
    
    const sessionId = `eval-${Date.now()}-${item.id}`;
    
    // 启动 Trace
    const trace = langfuse.trace({
      name: `Eval-${dataset.name}`,
      sessionId,
      tags: ['eval_run'],
      metadata: { dataset_item_id: item.id }
    });

    const thread = { configurable: { thread_id: sessionId } };
    const inputState = { 
      userMessage: item.input.userMessage, 
      sessionId,
      userId: "eval_user",
      regionScope: item.input.regionScope
    };

    let score = 0;
    try {
      const finalState = await app.invoke(inputState, thread);

      // 评估路由准确性 (routing_compliance)
      if (finalState.intent === item.expectedOutput.intent) {
        score = 1;
        passedCases++;
        console.log(`✅ [通过] 预期意图与实际相符: ${finalState.intent}`);
      } else {
        console.log(`❌ [失败] 预期意图: ${item.expectedOutput.intent}, 实际: ${finalState.intent}`);
      }

      // 这里可根据附件D继续扩展打分：param_first_pass_rate, tool_selection_accuracy 等...
      
      trace.update({
        output: finalState.finalResponse,
        metadata: {
          intent: finalState.intent,
          fc_steps_used: finalState.fc_super_step_count
        }
      });

    } catch (err) {
      console.error(`❌ [报错] 执行异常:`, err);
      trace.update({ output: err.message, metadata: { error: true } });
    }

    // 若通过了 Dataset 对象获取到的 item，则可以调用创建 run 对象
    // langfuse SDK 目前对于 link dataset_item 主要是用 trace 关联，这里简单给 Trace 打个分
    langfuse.score({
      traceId: trace.id,
      name: "routing_compliance",
      value: score,
      comment: score === 1 ? "Passed" : "Intent mismatch"
    });
  }

  console.log(`\n=== 评测完成 ===`);
  console.log(`通过率: ${passedCases}/${totalCases} (${Math.round(passedCases/totalCases*100)}%)`);

  await langfuse.flushAsync();
  console.log(`[Eval] 评测数据与 Score 已同步至 Langfuse。`);

  // CI 门禁拦截
  if (passedCases < totalCases) {
    console.error("⛔ [CI 阻断] 回归测试存在失败用例，请检查！");
    process.exit(1);
  } else {
    console.log("🟢 [CI 通过] 回归测试全量通过！");
    process.exit(0);
  }
}

runEvaluation().catch((err) => {
  console.error("评测脚本运行崩溃:", err);
  process.exit(1);
});