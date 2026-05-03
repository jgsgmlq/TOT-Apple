'use strict';

const { generateTextDeepSeek } = require('../utils/ai');
const { createError } = require('../middleware/errorHandler');
const { parseDdlAtToSqliteUtc } = require('../utils/ddlAt');

/**
 * 与 Prompt 约定一致：用于占位符展示的「当前系统时间」（本地时区）。
 * @returns {string} YYYY-MM-DD HH:MM:SS
 */
function formatCurrentTimeForPrompt() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * Prompt 要求输出 YYYY-MM-DD HH-MM-SS（时分秒为连字符）；转为可解析的 HH:MM:SS 供入库。
 * @param {string|null|undefined} s
 * @returns {string|null}
 */
function hyphenTimeToColon(s) {
  if (typeof s !== 'string' || !s.trim()) return null;
  const t = s.trim();
  const m = t.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]} ${m[2]}:${m[3]}:${m[4]}`;
  return t;
}

/** 将 YYYY-MM-DD HH:MM:SS 转为 Prompt 约定的时分连字符形式 */
function colonTimeToHyphen(s) {
  if (typeof s !== 'string') return s;
  return s.replace(/(\d{2}):(\d{2}):(\d{2})$/, '$1-$2-$3');
}

/** 在本地日历上为「YYYY-MM-DD HH:MM:SS」字符串加若干天，返回同格式字符串 */
function addLocalDaysToColonString(colonStr, days) {
  const m = colonStr.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const dt = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]) + days,
    Number(m[4]),
    Number(m[5]),
    Number(m[6])
  );
  const p = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())} ${p(dt.getHours())}:${p(dt.getMinutes())}:${p(dt.getSeconds())}`;
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1].trim() : raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('no json object');
  }
  return JSON.parse(body.slice(start, end + 1));
}

function buildSmartPublishPrompt(userInput, currentTime) {
  return `# Role
你是一个专为Apple Retail Store（苹果零售门店）设计的智能培训运营助手。你的任务是精准解析培训总部的自然语言输入，并将其转化为结构化的任务配置数据。

# Context
当前系统时间为：${currentTime} （时间格式为 YYYY-MM-DD HH:MM:SS）。所有涉及相对时间（如"现在"、"明天"、"下周"、"X天后"）的计算，都必须以此时间为绝对基准进行推算。

# Task
请解析用户的输入内容，并提取/生成以下五个核心字段：

1. task_name (任务名称)
   - 规则：请基于用户的输入进行高度概括和润色，生成专业、简练的培训任务名称。
   - 示例：例如用户说"让大家学一下新出的苹果智能怎么卖"，任务名称应总结为"Apple Intelligence 销售技巧培训"。
   - 限制：不要超过15个字。

2. passing_score (达标分数)
   - 规则：提取用户提到的通过或达标分数（纯数字）。
   - 限制：如果用户完全没有提及分数，请输出 80。

3. start_time (开始时间)
   - 规则：提取任务的开始时间。如果用户未提及具体开始时间，请严格默认使用上述提供的当前系统时间。
   - 格式限制：必须严格转换为 YYYY-MM-DD HH-MM-SS 格式（注意：时分秒之间使用连字符"-"而非冒号）。

4. end_time (结束时间)
   - 规则：提取任务的截止/结束时间。需具备高度容错性，无论是"下周五"、"7天后"还是"明天下午3点"，请基于当前系统时间准确推算。
   - 如果用户说"下周五"，请基于 [当前系统时间] 计算出下周五的 23:59:59。
   - 如果用户说"7天后"或"一周内"，请在 [当前系统时间] 的基础上增加相应的自然日。
   - 如果用户说的是具体时间（如"2026年4月15日"），请精准转换。
   - 如果用户未提供结束时间，请默认设置为开始时间之后的第 7 天（即 +7 天）。
   - 格式限制：必须严格转换为 YYYY-MM-DD HH-MM-SS 格式。

5. task_details (任务详情)
   - 规则：基于用户的描述重新润色生成任务要求。必须使用结构化语言（分点说明），语气需要符合Apple专业、积极、鼓励的品牌调性，并恰当使用Emoji增加阅读友好度。
   - 内容：学习任务更多是对于APPLE某款产品的参数了解和沟通话术
   - 限制：尽量精简，总字数控制在100字以内，避免冗长。

# Output Format
严格输出一个标准的JSON对象，不要包含任何Markdown标记（如\`\`\`json）、不要解释、不要多余文本。JSON的Key必须为：
{
  "task_name": "",
  "passing_score": 0,
  "start_time": "",
  "end_time": "",
  "task_details": ""
}

# Examples
输入样例：当前系统时间为 2026-04-13 10:00:00。用户输入："给大家发个MacBook Pro M4新品培训，及格分得85分啊，马上就开始，给你们7天时间看完。"
输出样例：
{
  "task_name": "MacBook Pro M4 新品培训",
  "passing_score": 85,
  "start_time": "2026-04-13 10-00-00",
  "end_time": "2026-04-20 10-00-00",
  "task_details": "Team，全新MacBook Pro M4培训已上线！💻\\n\\n🎯 学习重点：掌握M4芯片核心卖点与顾客沟通技巧\\n🏆 达标要求：测试需达到85分及以上\\n⏰ 截止时间：请务必在7天内完成\\n\\nLet's go, 期待大家在销售区的专业展现！✨"
}

# User Input
用户输入内容：${userInput}
请开始解析并返回JSON：`;
}

/**
 * 任务智能发布：自然语言 → 结构化字段（单次 DeepSeek 调用，含文案润色）。
 * @param {string} rawInput
 * @returns {Promise<object>}
 */
async function smartPublishParse(rawInput) {
  const userInput = rawInput != null ? String(rawInput).trim() : '';
  if (!userInput) {
    throw createError(400, 'input 不能为空', 'TASK_SMART_001');
  }

  const currentTime = formatCurrentTimeForPrompt();
  const userPrompt = buildSmartPublishPrompt(userInput, currentTime);

  let generated;
  try {
    generated = await generateTextDeepSeek(userPrompt, {
      system:
        '你只输出一个 JSON 对象，键为 task_name、passing_score、start_time、end_time、task_details。不要 Markdown、不要前后说明。',
      temperature: 0.2,
      maxTokens: 2048,
    });
  } catch (e) {
    console.error('[taskSmartPublish] AI failed:', e.message);
    throw createError(503, '智能解析失败，请稍后重试', 'TASK_SMART_002');
  }

  let parsed;
  try {
    parsed = extractJsonObject(generated);
  } catch (e) {
    console.error('[taskSmartPublish] JSON parse:', e.message);
    throw createError(503, '模型返回格式异常，请重试', 'TASK_SMART_002');
  }

  const taskName = parsed.task_name != null ? String(parsed.task_name).trim() : '';
  const taskDetails = parsed.task_details != null ? String(parsed.task_details).trim() : '';

  let passingScore = 80;
  if (parsed.passing_score !== undefined && parsed.passing_score !== null && parsed.passing_score !== '') {
    const n = Number(parsed.passing_score);
    if (!Number.isNaN(n) && n >= 0) passingScore = Math.round(n);
  }

  let startRaw = parsed.start_time != null ? String(parsed.start_time).trim() : '';
  let endRaw = parsed.end_time != null ? String(parsed.end_time).trim() : '';

  let startAt = null;
  let ddlAt = null;
  try {
    let startNorm = hyphenTimeToColon(startRaw);
    if (!startNorm) {
      startNorm = currentTime;
      startRaw = colonTimeToHyphen(currentTime);
    }
    // 校验可被 Date 解析；返回给前端的 startAt/ddlAt 与 startTime/endTime 同为「本地墙钟」语义，
    // 可直接作为 POST /tasks 的 startAt/ddlAt（与全库统一：本地墙钟规范化落库）。
    parseDdlAtToSqliteUtc(startNorm);
    startAt = startNorm;

    let endNorm = hyphenTimeToColon(endRaw);
    if (!endNorm) {
      endNorm = addLocalDaysToColonString(startNorm, 7);
    }
    if (!endNorm) {
      throw new Error('end time fallback failed');
    }
    parseDdlAtToSqliteUtc(endNorm);
    ddlAt = endNorm;
    endRaw = colonTimeToHyphen(endNorm);
  } catch (e) {
    console.error('[taskSmartPublish] time parse:', e.message);
    throw createError(502, '模型返回的时间格式无法解析', 'TASK_SMART_003');
  }

  return {
    taskName: taskName || null,
    passingScore,
    startTime: startRaw || null,
    endTime: endRaw || null,
    taskDetails: taskDetails || null,
    startAt,
    ddlAt,
  };
}

module.exports = {
  smartPublishParse,
  formatCurrentTimeForPrompt,
  hyphenTimeToColon,
  colonTimeToHyphen,
  addLocalDaysToColonString,
};
