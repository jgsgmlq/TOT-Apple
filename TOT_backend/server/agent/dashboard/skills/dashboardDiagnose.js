'use strict';

const { chatWithTools } = require('../../../utils/ai');
const { createError } = require('../../../middleware/errorHandler');
const { dashboardToolsSchema, executeDashboardTool } = require('../tools/dashboardTools');
const { extractJsonSafely } = require('../../../services/dashboardSubAgents/shared');

/**
 * 宽容版 JSON 提取：依次尝试 纯 JSON / fenced 代码块 / 大括号区段。
 * 复用 dashboardSubAgents/shared.extractJsonSafely 的实现，避免双份代码。
 */
function extractJsonFromText(text) {
  const obj = extractJsonSafely(text);
  if (obj && typeof obj === 'object') return obj;
  throw createError(
    500,
    '解析 AI 返回的 JSON 失败（已尝试 plain / fenced / brace 三种回退）\nOriginal Text: ' + text,
    'AGENT_001'
  );
}

async function dashboardDiagnoseHandler(context) {
  const { tasks } = context;
  if (!tasks || !Array.isArray(tasks)) {
    throw createError(400, '执行 dashboard_diagnose 需要 tasks 数组', 'AGENT_002');
  }

  // 注入自身的身份类型以区分记忆库
  context.agentType = 'dashboard';

  // 解决大模型幻觉，强行注入当前的系统绝对时间作为锚点
  const nowString = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  const systemPrompt = `你是一个高度智能、可结合历史经验准则的 Apple 培训看板数据分析 Agent。
你的核心任务是对当前看板正在执行的培训任务进行全局深度诊断，发现异常，并给出优化建议。

【当前系统时间（重要基准）】
现在的真实系统时间是：${nowString}
请你以此作为时间基准，去判断各个任务数据中的 \`ddl_at\` 距离今天还有多久。绝对不要自己胡编乱造“今天”是哪一天，在计算逾期、临期情况时务必做准确的相对时间运算。

【主 Agent 输入说明（多 Agent 协作模式）】
本系统采用「主 Agent + 4 个区域子 Agent」协作架构。\`query_active_tasks\` 返回的每个任务对象不再带原始看板大数据，而是仅含：
- \`taskId\` / \`title\` / \`ddl_at\` / \`avgProgressPercent\`（学员平均进度 0–100）
- \`regionInsights\`：4 个区域子 Agent 已经分别独立分析后的结果，对应看板上的四个版块：
  - \`regionInsights.funnel\`：转化漏斗（reach → read → completion → nudge 链路）
  - \`regionInsights.warning\`：预警风险漏斗（P2/P1/P0 + 红橙黄催办）
  - \`regionInsights.trend\`：完成趋势（按日新增 / 累计完成 / 距 ddl 时间风险）
  - \`regionInsights.rtm\`：RTM/门店进度排行（区域分化与拖后腿门店）
每个 region 形如：\`{ severity, summary, keyFindings, focusHint, degraded? }\`：
  - \`summary\` 是该区域子 Agent 的一句业务白话；可直接引用其措辞。
  - \`keyFindings\` 是该区域真实硬数据。**你引用数字时必须来自 keyFindings 或 avgProgressPercent**，禁止臆造。
  - \`focusHint\` 是该区域推荐的 focusModule 候选，仅作参考。
  - \`degraded=true\` 表示该子 Agent 走了模板降级，可信度较低，使用时酌情打折。

【你的职责】
- 综合 4 个 region 的 \`severity\` 与 \`focusHint\`，**为每个任务选出最严重的一个 focusModule（优先细粒度）**：
  - 任务整体 severity = 4 个 region 中最严重者（red > orange > green）。
  - focusModule 优先取最严重 region 的 focusHint；多个区域同等严重时按 warning_p0_rate > overdue_count > nudge_total_conversion > task_read_rate > rtm_completion_gap > trend_daily_drop > north_star 的优先级裁决。
- 全局最多 1 个任务被评为 "red"（按"最坏"挑选）。
- 整理 \`insight\` 与 \`focusReason\`：要复用对应 region.summary 与 keyFindings 的真实数字与说法，禁止出现后端变量名。

【执行 SOP 必选动作（严格按顺序，每个工具只能调用 1 次）】
1. 第 1 轮：先调用 \`read_agent_guidelines\` 读取历史经验准则。
2. 第 2 轮：再调用一次 \`query_active_tasks\` 获取所有任务的 \`regionInsights\`。
3. 第 3 轮：**不要再调任何工具**，直接输出最终 JSON 报告。
注意：\`query_active_tasks\` 的返回结果是稳定的，重复调用只会得到同样数据并浪费宝贵时间；如果你发现自己想再调一次工具，请抑制冲动，直接进入第 3 轮输出 JSON。

【最终轮输出格式（强制）】
当你不再调用任何工具时，**消息内容必须是一个可以被 JSON.parse 直接解析的对象**，遵守以下硬约束：
- 第一个字符必须是 \`{\`，最后一个字符必须是 \`}\`。
- 不得包含任何分析过程、Markdown 标题、列表、围栏（不要 \`\`\`json\`\`\`）、注释、说明、表情符号或前后缀。
- 如果你在心里有思考过程，请保留在心里，不要写到消息内容里。
- 总输出请控制在 1500 token 以内，必要时压缩 \`focusReason\`，绝对不要因为长度而截断 JSON。

【输出约束】
你的最终回复（不需要调工具的那一轮）必须是一个严格符合下面格式的 JSON 字符串（不要说任何除了 JSON 之外的废话）：

{
  "topTasks": [
    {
      "taskId": "...",
      "severity": "red|orange|green",
      "insight": "一句话建议(不超过30字)，必须聚焦到一个具体模块",
      "focusModule": "none|north_star|warning_details|rtm_timezone|crisis_p0|funnel_read_rate|nudge_conversion|metrics_overdue|on_time_completion_rate|avg_completion_time|task_reach_rate|task_read_rate|warning_count_total|warning_p2_rate|warning_p1_rate|warning_p0_rate|warning_p2_stores|warning_p1_stores|warning_p0_stores|nudge_red_conversion|nudge_orange_conversion|nudge_yellow_conversion|nudge_total_conversion|overdue_count|deadline_risk|trend_daily_drop|trend_silent_days|rtm_completion_gap|rtm_worst_bucket|store_worst_bucket",
      "focusReason": "详细解释为什么推荐聚焦在这个模块。要求有具体数据和业务逻辑支撑，字数30-50字"
    }
  ],
  "overallSummary": "不重复前三的前提下，一句话总结其余任务情况(不超过40字)"
}

【聚焦模块 (focusModule) 取值与含义】
- 若无需跳转：\`none\`
- 粗粒度板块：\`north_star\`、\`warning_details\`、\`rtm_timezone\`、\`crisis_p0\`、\`funnel_read_rate\`、\`nudge_conversion\`、\`metrics_overdue\`
- 细粒度下钻（优先使用）：
  - 漏斗与核心指标：\`on_time_completion_rate\`、\`avg_completion_time\`、\`task_reach_rate\`、\`task_read_rate\`
  - 预警：\`warning_count_total\`、\`warning_p2_rate\`、\`warning_p1_rate\`、\`warning_p0_rate\`、\`warning_p2_stores\`、\`warning_p1_stores\`、\`warning_p0_stores\`
  - 催办转化：\`nudge_red_conversion\`、\`nudge_orange_conversion\`、\`nudge_yellow_conversion\`、\`nudge_total_conversion\`
  - 截止/趋势：\`overdue_count\`、\`deadline_risk\`、\`trend_daily_drop\`、\`trend_silent_days\`
  - 区域排行：\`rtm_completion_gap\`、\`rtm_worst_bucket\`、\`store_worst_bucket\`

【业务硬性要求】
- 全局最多 1 个任务被评为 "red"。
- \`topTasks\` 必须按 severity (red > orange > green) 降序排列。
- 对 red/orange 任务，\`focusModule\` 应优先选择细粒度键；不要总是回退到粗粒度（如 \`crisis_p0\`、\`nudge_conversion\`）除非你确信细粒度定位不足。
- \`insight\` 和 \`focusReason\` 必须复用对应 region 的 summary/keyFindings 措辞与数字，禁止出现后端变量名（如严禁出现 "crisisP0Rate=94%"），应转换为业务白话（如"面临 P0 危机的占比达到 94%"）。
- 只有当你确信已经准备好上述要求的 JSON 数据时，才输出文本内容！
`;

  let messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: '现在是整点分析时间，请开始你的数据诊断与分析。' }
  ];

  let loopCount = 0;
  const MAX_LOOPS = 4;
  const toolsCalled = new Set();
  const REQUIRED_TOOLS = ['read_agent_guidelines', 'query_active_tasks'];

  while (loopCount < MAX_LOOPS) {
    loopCount++;

    // SOP 已经走完（两个工具都调过）→ 不再让模型自由发挥，直接强制 JSON 模式收尾。
    // 这样可以省掉模型在 content 里写大段散文的浪费。
    const sopComplete = REQUIRED_TOOLS.every((t) => toolsCalled.has(t));
    if (sopComplete) {
      console.log(`[Dashboard Agent] SOP tools done → forced finalize (JSON mode)`);
      return await finalizeWithJsonMode(messages);
    }

    console.log(`[Dashboard Agent] ReAct Loop ${loopCount} starting...`);

    const response = await chatWithTools({
      model: 'deepseek-v4-pro',
      messages,
      tools: dashboardToolsSchema,
      maxTokens: 4096,
      disableThinking: true,
    });

    const msg = { role: 'assistant', content: response.content || '' };
    if (response.tool_calls && response.tool_calls.length > 0) {
      msg.tool_calls = response.tool_calls;
      messages.push(msg);

      for (const tc of response.tool_calls) {
        const toolName = tc.function.name;
        let toolArgs = {};
        try {
          if (tc.function.arguments) {
            let cleanArgs = tc.function.arguments;
            cleanArgs = cleanArgs.replace(/\\n/g, "\\n")
               .replace(/\\'/g, "\\'")
               .replace(/\\"/g, '\\"')
               .replace(/\\&/g, "\\&")
               .replace(/\\r/g, "\\r")
               .replace(/\\t/g, "\\t")
               .replace(/\\b/g, "\\b")
               .replace(/\\f/g, "\\f");
            toolArgs = JSON.parse(cleanArgs);
          }
        } catch (e) {
          console.error(`[Dashboard Agent] Error parsing arguments for ${toolName}: ${e.message}`);
          toolArgs = { parse_error: true, raw_arguments: tc.function.arguments };
        }
        console.log(`[Dashboard Agent] Calling tool ${toolName}`);
        toolsCalled.add(toolName);

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
      // 模型已经决定不调工具：宽容解析；失败则 JSON mode 兜底。
      messages.push(msg);
      const rawText = response.content || '';
      const parsed = extractJsonSafely(rawText);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
      console.warn(
        `[Dashboard Agent] free-form parse failed (rawLen=${rawText.length}); retrying with response_format=json_object`
      );
      return await finalizeWithJsonMode(messages);
    }
  }

  throw createError(500, 'Agent 执行超出最大循环次数 (MAX_LOOPS)', 'AGENT_003');
}

/**
 * 兜底重跑：把当前完整对话历史塞进去，但**不再附带 tools**，并强制 DeepSeek 返回 JSON 对象。
 * DeepSeek 文档要求 system 中显式写出 "JSON" 字样并提供 schema 示例；我们已在 systemPrompt 中给了。
 */
async function finalizeWithJsonMode(messages) {
  const finalize = await chatWithTools({
    model: 'deepseek-v4-pro',
    messages: [
      ...messages,
      {
        role: 'user',
        content:
          '请基于以上工具结果，**仅**输出最终诊断 JSON 对象，必须以 "{" 开头、以 "}" 结尾，不要任何思考过程、Markdown、围栏或前后缀。',
      },
    ],
    maxTokens: 4096,
    temperature: 0,
    response_format: { type: 'json_object' },
    disableThinking: true,
  });
  const content = finalize.content || '';
  console.log(
    `[Dashboard Agent] json_object retry done (len=${content.length}, finishReason=${finalize.finish_reason || 'n/a'})`
  );
  return extractJsonFromText(content);
}

module.exports = {
  name: 'dashboard_diagnose',
  description: '基于 Tool Calling 与只读经验准则执行看板任务深度诊断。',
  handler: dashboardDiagnoseHandler
};