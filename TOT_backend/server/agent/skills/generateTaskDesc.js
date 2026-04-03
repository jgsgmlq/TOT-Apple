'use strict';

const { generateText, generateTextDeepSeek } = require('../../utils/ai');
const { createError } = require('../../middleware/errorHandler');

/**
 * 构建任务下发文案的 Prompt（Gemini / DeepSeek 共用）
 * @param {object} context
 * @returns {string}
 */
function buildTaskDescriptionPrompt(context) {
  const { instruction, ddlAt, platforms } = context;

  if (!instruction) throw createError(400, 'instruction (核心指令) 不能为空', 'TASK_AI_001');

  const ddlStr = ddlAt ? new Date(ddlAt).toLocaleString('zh-CN') : '未指定具体时间';
  const platStr = (Array.isArray(platforms) ? platforms : []).join(', ');

  return `
你是一个专业的零售培训运营官。请根据以下核心指令，生成一段专业、具有鼓动性的任务下发说明（用于展示给门店店员）。
- 核心指令: ${instruction}
- 截止时间: ${ddlStr}
- 涉及平台: ${platStr || '未指定'}

【约束条件】
1. 由于系统当前不支持上传实际课件，无法得知具体的课件字数或视频时长。因此，请仅基于上述已有信息进行适当的扩写。
2. 请强调完成此任务对日常销售或规范操作的重要性。
3. 语气面向一线实操人员，专业且具有同理心。不要出现店长的语气（系统不支持店长角色下发）。
4. 请直接返回文案内容，无需任何前置寒暄或解释。
`;
}

/**
 * 技能：任务下发文案生成（Gemini / Floodgate）
 */
const generateTaskDescriptionSkill = {
  name: 'generate_task_description',
  description: '根据简单的指令、截止时间和平台，扩写出专业、有鼓动性的培训下发长文案',

  handler: async (context) => {
    const prompt = buildTaskDescriptionPrompt(context);
    const generatedText = await generateText(prompt);
    return {
      description: generatedText
    };
  }
};

/**
 * 使用 DeepSeek 生成任务下发文案（与 generateTaskDescriptionSkill 同逻辑，不同模型）
 * @param {object} context 与 handler 相同：instruction, ddlAt, platforms
 * @returns {Promise<{ description: string }>}
 */
async function generateTaskDescriptionWithDeepSeek(context) {
  const prompt = buildTaskDescriptionPrompt(context);
  const generatedText = await generateTextDeepSeek(prompt);
  return {
    description: generatedText
  };
}

/** 注册给 Agent 的 DeepSeek 版技能 */
const generateTaskDescriptionSkillDeepSeek = {
  name: 'generate_task_description_deepseek',
  description: '根据简单的指令、截止时间和平台，扩写出专业、有鼓动性的培训下发长文案（DeepSeek）',
  handler: generateTaskDescriptionWithDeepSeek
};

module.exports = generateTaskDescriptionSkill;
module.exports.buildTaskDescriptionPrompt = buildTaskDescriptionPrompt;
module.exports.generateTaskDescriptionWithDeepSeek = generateTaskDescriptionWithDeepSeek;
module.exports.generateTaskDescriptionSkillDeepSeek = generateTaskDescriptionSkillDeepSeek;
