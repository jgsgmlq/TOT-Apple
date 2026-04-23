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
      name: 'upsert_agent_guidelines',
      description: '更新你的经验记忆库。如果你在本次分析中获得了新知识或教训，必须将新旧知识融合成一篇不超过1000字的完整 Markdown 文档，然后调用此工具进行【全量覆写】。这是你在维护一份状态维基，而不是写日记。',
      parameters: {
        type: 'object',
        properties: {
          merged_markdown_content: { type: 'string', description: '融合了新旧知识的、精炼后的全量经验 Markdown 文本' }
        },
        required: ['merged_markdown_content']
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

  if (name === 'upsert_agent_guidelines') {
    const { merged_markdown_content } = args;
    if (!merged_markdown_content) return { error: 'merged_markdown_content 不能为空' };
    
    try {
      db.transaction(() => {
        // 先清理该 agentType 下的所有旧记忆
        db.run('DELETE FROM agent_guidelines WHERE agent_type = ?', [agentType]);
        // 插入全量融合成的一条最新记录
        db.run(
          'INSERT INTO agent_guidelines (id, agent_type, rule_text) VALUES (?, ?, ?)',
          [nanoid(), agentType, merged_markdown_content]
        );
      });
      return { status: 'success', message: '记忆库维基已成功覆写' };
    } catch (e) {
      return { error: '覆写记忆库失败: ' + e.message };
    }
  }

  throw new Error(`Unknown tool ${name}`);
}

module.exports = {
  dashboardToolsSchema,
  executeDashboardTool
};