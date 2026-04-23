'use strict';

const { chatWithTools } = require('../../utils/ai');
const { createError } = require('../../middleware/errorHandler');
const { dashboardToolsSchema, executeDashboardTool } = require('../tools/dashboardTools');

function extractJsonFromText(text) {
  try {
    const matched = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (matched && matched[1]) {
      return JSON.parse(matched[1].trim());
    }
    return JSON.parse(text.trim());
  } catch (err) {
    throw createError(500, '解析 AI 返回的 JSON 失败: ' + err.message + '\nOriginal Text: ' + text, 'AGENT_001');
  }
}

async function dashboardDiagnoseHandler(context) {
  const { tasks } = context;
  if (!tasks || !Array.isArray(tasks)) {
    throw createError(400, '执行 dashboard_diagnose 需要 tasks 数组', 'AGENT_002');
  }

  // 注入自身的身份类型以区分记忆库
  context.agentType = 'dashboard';

  const systemPrompt = `你是一个高度智能、可自我进化和记忆的 Apple 培训看板数据分析 Agent。
你的核心任务是对当前看板正在执行的培训任务进行全局深度诊断，发现异常，并给出优化建议。

【执行 SOP 必选动作】
你必须按以下顺序行动，否则是不称职的：
1. 必须优先调用 \`read_agent_guidelines\` 读取你在过去积累的经验准则。不要错过历史教训。
2. 必须接着调用 \`query_active_tasks\` 获取最新的活数据。
3. （可选）如果你认为有必要沉淀经验（如发现之前没被写下的规律或易错点），调用 \`upsert_agent_guidelines\`。
   **注意**：你是在维护一份状态维基，而不是写日记！你必须将新经验与刚才读到的旧经验进行合并去重、化解冲突，提炼成一篇不超过 1000 字的精炼 Markdown，然后使用它进行全量覆写。
4. 一旦所有信息收集和思考完毕，请直接输出最终的 JSON 报告。

【输出约束】
你的最终回复（不需要调工具的那一轮）必须是一个严格符合下面格式的 JSON 字符串（不要说任何除了 JSON 之外的废话）：

{
  "topTasks": [
    {
      "taskId": "...",
      "severity": "red|orange|green",
      "insight": "一句话建议(不超过30字)，必须聚焦到一个具体模块",
      "focusModule": "north_star|warning_details|rtm_timezone"
    }
  ],
  "overallSummary": "不重复前三的前提下，一句话总结其余任务情况(不超过40字)"
}

【业务硬性要求】
- 全局最多 1 个任务被评为 "red"。
- \`topTasks\` 必须按 severity (red > orange > green) 降序排列。
- 只有当你确信已经准备好上述要求的 JSON 数据时，才输出文本内容！
`;

  let messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: '现在是整点分析时间，请开始你的数据诊断与分析。' }
  ];

  let loopCount = 0;
  const MAX_LOOPS = 6;

  while (loopCount < MAX_LOOPS) {
    loopCount++;
    console.log(`[Dashboard Agent] ReAct Loop ${loopCount} starting...`);

    const response = await chatWithTools({
      model: 'deepseek-chat',
      messages,
      tools: dashboardToolsSchema,
      maxTokens: 4096,
    });

    const msg = { role: 'assistant', content: response.content || '' };
    if (response.tool_calls && response.tool_calls.length > 0) {
      msg.tool_calls = response.tool_calls;
      messages.push(msg);

      for (const tc of response.tool_calls) {
        const toolName = tc.function.name;
        const toolArgs = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        console.log(`[Dashboard Agent] Calling tool ${toolName}`);

        let toolResult;
        try {
          toolResult = await executeDashboardTool(toolName, toolArgs, context);
        } catch (e) {
          toolResult = { error: e.message };
        }

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult)
        });
      }
    } else {
      // 模型决定不调工具，直接输出结果
      messages.push(msg);
      return extractJsonFromText(response.content || '');
    }
  }

  throw createError(500, 'Agent 执行超出最大循环次数 (MAX_LOOPS)', 'AGENT_003');
}

module.exports = {
  name: 'dashboard_diagnose',
  description: '基于 Tool Calling 和动态经验库执行看板任务深度诊断。',
  handler: dashboardDiagnoseHandler
};