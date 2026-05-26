'use strict';

const { generateTextDeepSeek } = require('../../../utils/ai');
const { createError } = require('../../../middleware/errorHandler');

function buildParseTaskPrompt(instruction) {
  if (!instruction) throw createError(400, 'instruction (核心指令) 不能为空', 'TASK_AI_001');

  return `
你是一个专业的零售培训运营官。请根据以下店长或总部的核心指令（自然语言），帮我解析出一个培训任务的配置表单，并自动生成一段专业、具有鼓动性的任务下发长说明。

- 核心指令: ${instruction}

【解析规则与约束】
1. 分析指令中提到的平台，如果是MyPAL、SmartSell等请解析出来（布尔值，是否包含该平台）。
2. 分析指令中的截止时间要求，生成一个推荐的 ddlAt（格式必须为 "YYYY-MM-DD HH:MM:SS"），如果未提及则推断一个合理时间（如当前时间的一周后）。
3. 分析指令中的开始时间要求，生成一个推荐的 startAt（格式必须为 "YYYY-MM-DD HH:MM:SS"），如果未提及则默认为当前时间。
4. 根据指令推断该任务的标题 title（10-20字以内）。
5. 自动扩写任务 description，必须强调完成此任务对日常销售或规范操作的重要性。语气面向一线实操人员，专业且具有同理心。不要出现店长的语气。
6. 根据指令推断 RTM 筛选范围或门店 scope，如果没有提及则全员（storeScope="all"）。
7. **你必须且只能返回一段合法的 JSON 格式数据**，不可包含任何 Markdown 格式(如 \`\`\`json)、不可包含前言后语。
8. 如果无法解析出某个数值字段，则对应字段返回 null。

返回的 JSON 结构严格如下：
{
  "title": "任务标题 或 null",
  "description": "扩写后的任务说明... 或 null",
  "hasMypal": true 或 false 或 null,
  "hasSmartSell": true 或 false 或 null,
  "hasAiDemo": true 或 false 或 null,
  "hasLiveBroadcast": true 或 false 或 null,
  "startAt": "YYYY-MM-DD HH:MM:SS" 或 null,
  "ddlAt": "YYYY-MM-DD HH:MM:SS" 或 null,
  "passScore": 100 // 若未提及则默认给100
}
`;
}

async function parseTaskWithDeepSeek(context) {
  const prompt = buildParseTaskPrompt(context.instruction);
  const generatedText = await generateTextDeepSeek(prompt, { temperature: 0.1 });
  try {
    const jsonStr = generatedText.replace(/^[\s\S]*?\{/, '{').replace(/\}[\s\S]*?$/, '}');
    const parsed = JSON.parse(jsonStr);
    return parsed;
  } catch (e) {
    throw createError(500, '大模型返回的数据格式异常', 'TASK_AI_002');
  }
}

const parseTaskSkillDeepSeek = {
  name: 'parse_task_deepseek',
  description: '根据自然语言指令一键解析任务信息并返回JSON格式',
  handler: parseTaskWithDeepSeek
};

module.exports = parseTaskSkillDeepSeek;
module.exports.buildParseTaskPrompt = buildParseTaskPrompt;
module.exports.parseTaskWithDeepSeek = parseTaskWithDeepSeek;
module.exports.parseTaskSkillDeepSeek = parseTaskSkillDeepSeek;
