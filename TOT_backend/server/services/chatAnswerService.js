'use strict';

const { generateTextDeepSeek } = require('../utils/ai');

const SYSTEM_PROMPT = `你是一个培训数据分析助手，请根据以下查询结果，用中文回答用户问题。
输出严格符合以下 JSON 格式（不加代码块标记，不加任何说明文字）:
{
  "overview": "...",
  "keyNumbers": [{"label": "...", "value": "...", "unit": "..."}],
  "attentionPoints": ["...", "..."],
  "followUpSuggestions": ["...", "..."]
}

要求：
- overview：不超过 60 字，简明总结数据情况
- keyNumbers：最多 4 项，数字必须来自查询结果，不得捏造；无数据时返回 []
- attentionPoints：最多 3 项，聚焦问题与风险；无问题时返回 []
- followUpSuggestions：最多 3 项，以"可追问："开头；无建议时返回 []
- 如果查询结果为空或 null，overview 说明"暂无相关数据"，其余字段返回空数组`;

const FALLBACK_REPLY = {
  overview: '抱歉，回复生成时遇到了问题，请稍后重试。',
  keyNumbers: [],
  attentionPoints: [],
  followUpSuggestions: [],
};

/**
 * Format tool results into a structured ReplyContent object.
 * @param {string} userMessage
 * @param {any} toolResult  — result from chatToolsService.executeByName (or null for unknown intent)
 * @param {Array<{role:string, content:string}>} history
 * @returns {Promise<ReplyContent>}
 */
async function format(userMessage, toolResult, history) {
  const dataSection = toolResult != null
    ? `查询结果数据：\n${JSON.stringify(toolResult, null, 2)}`
    : '查询结果数据：无（用户问题不涉及系统数据，请自由回答或说明暂无相关数据）';

  const historyText = history
    .slice(-6)
    .map((m) => {
      // assistant messages in DB are JSON-stringified ReplyContent; extract overview for brevity
      if (m.role === 'assistant') {
        try {
          const rc = JSON.parse(m.content);
          return `Assistant: ${rc.overview || m.content}`;
        } catch {
          return `Assistant: ${m.content ?? ''}`;
        }
      }
      return `User: ${m.content ?? ''}`;
    })
    .join('\n');

  const prompt = [
    historyText ? `历史对话:\n${historyText}\n` : '',
    `用户问题：${userMessage}\n`,
    dataSection,
  ].join('\n');

  let raw;
  try {
    raw = await generateTextDeepSeek(prompt, {
      system: SYSTEM_PROMPT,
      temperature: 0.3,
      maxTokens: 1024,
    });
  } catch (err) {
    console.error('[chatAnswerService] LLM call failed:', err.message);
    return FALLBACK_REPLY;
  }

  try {
    if (typeof raw !== 'string') {
      console.warn('[chatAnswerService] LLM returned non-string:', raw);
      return FALLBACK_REPLY;
    }
    // Strip markdown code fences that LLMs sometimes add despite instructions
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(cleaned);
    return {
      overview:             String(parsed.overview || ''),
      keyNumbers:           Array.isArray(parsed.keyNumbers) ? parsed.keyNumbers : [],
      attentionPoints:      Array.isArray(parsed.attentionPoints) ? parsed.attentionPoints : [],
      followUpSuggestions:  Array.isArray(parsed.followUpSuggestions) ? parsed.followUpSuggestions : [],
    };
  } catch (e) {
    console.warn('[chatAnswerService] Failed to parse LLM response:', e.message, 'Raw:', raw);
    return FALLBACK_REPLY;
  }
}

module.exports = { format };
