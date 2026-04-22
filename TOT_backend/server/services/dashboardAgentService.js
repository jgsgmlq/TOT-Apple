'use strict';

const { db } = require('../db/index');
const { generateTextDeepSeek } = require('../utils/ai');
const { nanoid } = require('nanoid');
const { formatNowSqliteLocal } = require('../utils/ddlAt');

/**
 * 提取并解析大模型返回的 JSON
 */
function extractJsonFromText(text) {
  try {
    const matched = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (matched && matched[1]) {
      return JSON.parse(matched[1].trim());
    }
    return JSON.parse(text.trim());
  } catch (err) {
    throw new Error('解析 AI 返回的 JSON 失败: ' + err.message + '\nOriginal Text: ' + text);
  }
}

async function generateDashboardAgentInsight(userId) {
  const tasks = db.all(`
    SELECT 
      t.id, t.title, t.ddl_at,
      COUNT(ta.id) as total_count,
      SUM(CASE WHEN ta.status = 'completed' THEN 1 ELSE 0 END) as completed_count,
      ROUND(SUM(ta.progress) * 1.0 / MAX(COUNT(ta.id), 1), 1) as avg_progress,
      SUM(CASE WHEN t.ddl_at < datetime('now', 'localtime') AND ta.status != 'completed' THEN 1 ELSE 0 END) as overdue_count,
      SUM(ta.nudge_count) as total_nudges
    FROM tasks t
    LEFT JOIN task_assignments ta ON t.id = ta.task_id
    WHERE t.status = 'dispatched'
    GROUP BY t.id
  `);

  if (!tasks || tasks.length === 0) {
    return {
      redCount: 0,
      orangeCount: 0,
      greenCount: 0,
      topTasks: [],
      overallSummary: "当前没有下发的活跃任务，大家都在休息中。",
      allTasks: []
    };
  }

  const prompt = `你是一个专业的培训看板数据分析智能助手（Agent）。请根据下方给出的当前正在执行的活跃任务及其进度数据，进行诊断分析。

输入任务数据：
${JSON.stringify(tasks, null, 2)}

请完成以下两项分析并严格以 JSON 格式输出：

1. 【单任务诊断与优先级排序】：
   - 为每个任务指定一个紧急程度 (severity)："red"(最紧急)、"orange"(次紧急)、"green"(正常)。
   - **全局只能有最多 1 个任务被评为 "red"**，可以有多个 "orange" 或 "green"。
   - 针对每个任务生成一句话诊断建议 (insight，不超过30字)，必须聚焦到一个具体的看板模块以指导用户点击下钻。
   - 聚焦的看板模块 (focusModule) 只能从以下三个 Key 中选择其一：
     - "north_star" (北极星_漏斗模块)
     - "warning_details" (预警详情模块)
     - "rtm_timezone" (分RTM完成率下钻和分时区完成人数模块)
   - 对 tasks 数组按紧急程度 (red > orange > green) 进行降序排序。

2. 【全局业务总结】：
   - 除了排名前三的最紧急任务以外，用一句话总结其余任务的情况，或者给出一个全局的行动建议（overallSummary，不超过40字）。
   - 如果总任务数不超过 3 个，则整体总结一句即可。
   - 文案语调应该体现总结性，与具体单个任务的诊断区别开。

务必直接返回合法的 JSON，不要附加任何其他废话：
{
  "tasks": [
    {
      "taskId": "对应的任务ID",
      "severity": "red|orange|green",
      "insight": "给出的诊断建议...",
      "focusModule": "north_star|warning_details|rtm_timezone"
    }
  ],
  "overallSummary": "其余任务的总体总结文案..."
}`;

  const aiText = await generateTextDeepSeek(prompt, { maxTokens: 4096, responseFormat: { type: 'json_object' } });
  const parsed = extractJsonFromText(aiText);

  // 校验并补充基础信息
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  let redCount = 0, orangeCount = 0, greenCount = 0;
  
  const allTasks = (parsed.tasks || []).map(t => {
    if (t.severity === 'red') redCount++;
    else if (t.severity === 'orange') orangeCount++;
    else greenCount++;

    const dbTask = taskMap.get(t.taskId);
    return {
      taskId: t.taskId,
      title: dbTask ? dbTask.title : '未知任务',
      severity: t.severity || 'green',
      insight: t.insight || '',
      focusModule: t.focusModule || 'north_star',
      progress: dbTask ? (dbTask.avg_progress || 0) : 0
    };
  });

  const resultData = {
    redCount,
    orangeCount,
    greenCount,
    topTasks: allTasks.slice(0, 3),
    overallSummary: parsed.overallSummary || '所有任务都在稳步推进中。',
    allTasks: allTasks
  };

  const id = nanoid();
  const now = formatNowSqliteLocal();
  db.run(`
    INSERT INTO dashboard_insights 
      (id, module_type, content, context_json, created_by, created_at)
    VALUES (?, 'global_agent', ?, ?, ?, ?)
  `, [
    id,
    'agent response',
    JSON.stringify(resultData),
    userId,
    now
  ]);

  return { ...resultData, generatedAt: now };
}

async function getDashboardAgentInsight(userId, refresh = false) {
  if (!refresh) {
    const latest = db.get(`
      SELECT context_json, created_at 
      FROM dashboard_insights 
      WHERE module_type = 'global_agent'
      ORDER BY created_at DESC 
      LIMIT 1
    `);
    if (latest) {
      const data = JSON.parse(latest.context_json);
      data.generatedAt = latest.created_at;
      return data;
    }
  }

  return await generateDashboardAgentInsight(userId);
}

module.exports = {
  getDashboardAgentInsight
};
