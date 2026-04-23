'use strict';
const { db } = require('../../db/index');
const { nanoid } = require('nanoid');

const dashboardToolsSchema = [
  {
    type: 'function',
    function: {
      name: 'query_active_tasks',
      description: '获取当前看板上所有下发中的活跃任务及其执行进度指标数据。这些数据是由你的用户提供给你的业务基石。',
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
  },
  {
    type: 'function',
    function: {
      name: 'add_agent_guideline',
      description: '追加一条新的经验准则到你的记忆库。如果你在本次分析中发现了值得以后注意的新规律、易错点或更好的沟通口吻，可以调用它自我进化。',
      parameters: {
        type: 'object',
        properties: {
          rule_text: { type: 'string', description: '要追加的具体规则或经验内容' }
        },
        required: ['rule_text']
      }
    }
  }
];

// Context 必须包含通过 db 查询到的最新 tasks 数据，以及表明身份的 agentType
async function executeDashboardTool(name, args, context) {
  const agentType = context.agentType || 'dashboard';

  if (name === 'query_active_tasks') {
    return context.tasks || [];
  }
  
  if (name === 'read_agent_guidelines') {
    const rows = db.all(
      'SELECT rule_text FROM agent_guidelines WHERE agent_type = ? ORDER BY created_at ASC',
      [agentType]
    );
    if (!rows || rows.length === 0) return '暂无经验准则，请自由发挥。';
    return rows.map((r, i) => `${i + 1}. ${r.rule_text}`).join('\n');
  }

  if (name === 'add_agent_guideline') {
    const { rule_text } = args;
    if (!rule_text) return { error: 'rule_text 不能为空' };
    db.run(
      'INSERT INTO agent_guidelines (id, agent_type, rule_text) VALUES (?, ?, ?)',
      [nanoid(), agentType, rule_text]
    );
    return { status: 'success', added: rule_text };
  }

  throw new Error(`Unknown tool ${name}`);
}

module.exports = {
  dashboardToolsSchema,
  executeDashboardTool
};