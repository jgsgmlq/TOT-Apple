'use strict';

const { db } = require('../../db');
const { generateText, generateTextDeepSeek } = require('../../utils/ai');
const { createError } = require('../../middleware/errorHandler');

/**
 * 校验入参并查询 DB，构造催办 Prompt 与 meta（Gemini / DeepSeek 共用）
 * @param {object} context
 * @returns {Promise<{ prompt: string, meta: { progress: number, compRate: number, hoursLeft: number } }>}
 */
async function buildNudgePromptAndMeta(context) {
  const { taskId, userId, severity } = context;

  if (!taskId) throw createError(400, 'taskId 不能为空', 'NUDGE_AI_001');
  if (!userId) throw createError(400, 'userId 不能为空', 'NUDGE_AI_001');
  if (!severity || !['yellow', 'orange', 'red'].includes(severity)) {
    throw createError(400, 'severity 必填且只能是 yellow/orange/red', 'NUDGE_AI_001');
  }

  const task = db.get('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task) throw createError(404, '任务不存在', 'TASK_002');

  const emp = db.get('SELECT * FROM employees WHERE id = ?', [userId]);
  if (!emp) throw createError(404, '员工不存在', 'EMP_001');

  const assignment = db.get('SELECT * FROM task_assignments WHERE task_id = ? AND user_id = ?', [taskId, userId]);
  const progress = assignment ? assignment.progress : 0;
  const nudgeCount = assignment ? assignment.nudge_count : 0;

  const storeStats = db.get(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
      FROM task_assignments
      WHERE task_id = ? AND store_id = ?
    `, [taskId, emp.store_id]);

  const compRate = storeStats && storeStats.total > 0
    ? Math.round((storeStats.completed / storeStats.total) * 100)
    : 0;

  const ddl = new Date(task.ddl_at);
  const now = new Date();
  const hoursLeft = Math.round((ddl - now) / (1000 * 60 * 60));
  const timeLeftStr = hoursLeft > 0 ? `不足 ${hoursLeft} 小时` : '已逾期';
  let severityText = '轻松、提醒';
  if (severity === 'orange') severityText = '适度紧迫、提醒';
  if (severity === 'red') severityText = '紧急、严肃';

  const prompt = `
你是一个总部培训督导。请为以下店员生成一条${severityText}的催办消息。
- 任务名称: ${task.title}
- 剩余时间: ${timeLeftStr}
- 员工进度: 已完成 ${progress}%
- 门店整体完成率: ${compRate}%
- 历史被催办次数: ${nudgeCount} 次

【约束条件】
1. 由于缺乏细粒度的题目数据，请使用百分比和剩余时间制造紧迫感。
2. 可以利用同辈压力（如“你们门店已经完成 ${compRate}% 了，大家都在等你”）。
3. 语气是“总部”发出，绝对不要提及“店长”。
4. 请直接返回催办的话术文案（长度在50字以内），不要加引号或多余解释。
`;

  return {
    prompt,
    meta: {
      progress,
      compRate,
      hoursLeft
    }
  };
}

/**
 * 技能：催办文案生成（Gemini / Floodgate）
 */
const generateNudgeSkill = {
  name: 'generate_nudge_message',
  description: '基于员工进度、门店情况和剩余时间，生成具有同理心或紧迫感的催办文案',

  handler: async (context) => {
    const { prompt, meta } = await buildNudgePromptAndMeta(context);
    const generatedText = await generateText(prompt);
    return {
      content: generatedText,
      meta
    };
  }
};

/**
 * 使用 DeepSeek 生成催办文案（与 generateNudgeSkill 同逻辑，不同模型）
 * @param {object} context 与 handler 相同：taskId, userId, severity
 * @returns {Promise<{ content: string, meta: object }>}
 */
async function generateNudgeWithDeepSeek(context) {
  const { prompt, meta } = await buildNudgePromptAndMeta(context);
  const generatedText = await generateTextDeepSeek(prompt);
  return {
    content: generatedText,
    meta
  };
}

/** 注册给 Agent 的 DeepSeek 版技能 */
const generateNudgeSkillDeepSeek = {
  name: 'generate_nudge_message_deepseek',
  description: '基于员工进度、门店情况和剩余时间，生成具有同理心或紧迫感的催办文案（DeepSeek）',
  handler: generateNudgeWithDeepSeek
};

module.exports = generateNudgeSkill;
module.exports.buildNudgePromptAndMeta = buildNudgePromptAndMeta;
module.exports.generateNudgeWithDeepSeek = generateNudgeWithDeepSeek;
module.exports.generateNudgeSkillDeepSeek = generateNudgeSkillDeepSeek;
