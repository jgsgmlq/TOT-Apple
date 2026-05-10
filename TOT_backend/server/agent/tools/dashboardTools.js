'use strict';
const util = require('util');
const { db } = require('../../db/index');

const dashboardToolsSchema = [
  {
    type: 'function',
    function: {
      name: 'query_active_tasks',
      description:
        '获取当前下发中活跃任务列表。每项仅含 taskId / title / ddl_at / avgProgressPercent / regionInsights，其中 regionInsights 由 4 个区域子 Agent (funnel/warning/trend/rtm) 已经分别分析得到的结构化结果（severity/summary/keyFindings/focusHint/degraded?）。主 Agent 依据这些 regionInsights 综合得出 topTasks 与 focusModule，不再处理原始看板大数据。',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_agent_guidelines',
      description: '阅读你所属 Agent 类型的历史经验准则。在开始分析数据之前，务必调用此工具以获取你的历史教训和预设的关注点。',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  }
];

// Context 必须包含通过 db 查询到的最新 tasks 数据，以及表明身份的 agentType
async function executeDashboardTool(name, args, context) {
  const agentType = context.agentType || 'dashboard';

  if (name === 'query_active_tasks') {
    const tasks = context.tasks || [];
    const callCount = (context._toolCallCounts ||= {});
    callCount.query_active_tasks = (callCount.query_active_tasks || 0) + 1;

    if (callCount.query_active_tasks > 1) {
      console.warn(
        `[Dashboard Agent] query_active_tasks called ${callCount.query_active_tasks} times; returning short-circuit notice instead of full payload.`
      );
      return {
        notice:
          '你已经调用过 query_active_tasks 一次，并且返回结果是稳定不变的。请不要再调用任何工具，立即基于已有的 regionInsights 直接输出最终 JSON 报告。',
        taskCount: tasks.length,
      };
    }

    const sample = tasks[0];
    console.log(
      '[Dashboard Agent] query_active_tasks:',
      sample && {
        taskCount: tasks.length,
        sampleTaskId: sample.taskId,
        regionKeys: sample.regionInsights && Object.keys(sample.regionInsights),
        regionSeverities:
          sample.regionInsights &&
          Object.fromEntries(
            Object.entries(sample.regionInsights).map(([k, v]) => [k, v ? v.severity : null])
          ),
        jsonBytes: JSON.stringify(tasks).length,
      }
    );
    if (process.env.DEBUG_DASHBOARD_AGENT === '1') {
      console.log(util.inspect(tasks, { depth: 6, maxArrayLength: 4, breakLength: 100 }));
    }
    return tasks;
  }
  
  if (name === 'read_agent_guidelines') {
    const rows = db.all(
      'SELECT rule_text FROM agent_guidelines WHERE agent_type = ? ORDER BY created_at ASC',
      [agentType]
    );
    if (!rows || rows.length === 0) return '暂无经验准则，请自由发挥。';
    return rows.map((r, i) => `${i + 1}. ${r.rule_text}`).join('\n');
  }

  throw new Error(`Unknown tool ${name}`);
}

module.exports = {
  dashboardToolsSchema,
  executeDashboardTool
};