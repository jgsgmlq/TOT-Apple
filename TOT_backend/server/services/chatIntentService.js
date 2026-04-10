'use strict';

const { generateTextDeepSeek } = require('../utils/ai');

const VALID_INTENTS = new Set([
  'progress_query',
  'project_status',
  'warning_query',
  'drill_down',
  'unknown',
]);

const SYSTEM_PROMPT = `你是一个培训管理系统的意图分类助手。
根据用户提问，输出以下 JSON（不加代码块标记，不加任何说明文字）：
{
  "intentType": "<类型>",
  "entities": {
    "taskId": null,
    "storeId": null,
    "storeName": null,
    "region": null,
    "rtm": null,
    "topN": null
  }
}

合法 intentType:
- progress_query   查完成率/进度数据（如"Q1培训完成率是多少？"）
- project_status   查任务列表/状态概览（如"现在有哪些进行中的任务？"）
- warning_query    查预警/风险门店（如"有哪些门店需要关注？"）
- drill_down       查具体门店员工进度（如"上���环球港店具体情况怎么样？"）
- unknown          闲聊/打招呼，或系统无对应数据的业务问题

unknown 的判断标准：
- 闲聊/打招呼（如"你好"、"谢谢"）→ unknown
- 业务问题但系统无对应数据（如"员工学习偏好"、"心理状态分析"）→ unknown

示例：
用户: "Q1培训完成率？" → { "intentType": "progress_query", "entities": { "taskId": null, "storeId": null, "storeName": null, "region": null, "rtm": null, "topN": null } }
用户: "上海环球港店怎么样？" → { "intentType": "drill_down", "entities": { "taskId": null, "storeId": null, "storeName": "上海环球港", "region": null, "rtm": null, "topN": null } }
用户: "你好！" → { "intentType": "unknown", "entities": { "taskId": null, "storeId": null, "storeName": null, "region": null, "rtm": null, "topN": null } }`;

/**
 * Classify a user message into an intent + entities.
 * @param {string} userMessage
 * @param {Array<{role:string, content:string}>} history  — last 6 DB messages as [{role,content}]
 * @returns {Promise<{ intentType: string, entities: object }>}
 */
async function classify(userMessage, history) {
  // Build history context (last 3 rounds = 6 messages)
  const historyText = history
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content ?? ''}`)
    .join('\n');

  const prompt = historyText
    ? `历史对话:\n${historyText}\n\n当前提问:\n${userMessage}`
    : userMessage;

  let raw;
  try {
    raw = await generateTextDeepSeek(prompt, {
      system: SYSTEM_PROMPT,
      temperature: 0,
      maxTokens: 256,
    });
  } catch (err) {
    console.error('[chatIntentService] LLM call failed:', err.message);
    // Fallback: treat as progress_query with empty entities
    return { intentType: 'progress_query', entities: {} };
  }

  try {
    if (typeof raw !== 'string') {
      console.warn('[chatIntentService] LLM returned non-string:', raw);
      return { intentType: 'progress_query', entities: {} };
    }
    // Strip markdown code fences that LLMs sometimes add despite instructions
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(cleaned);
    const intentType = VALID_INTENTS.has(parsed.intentType)
      ? parsed.intentType
      : 'progress_query';
    const entities =
      parsed.entities &&
      typeof parsed.entities === 'object' &&
      !Array.isArray(parsed.entities)
        ? parsed.entities
        : {};
    return { intentType, entities };
  } catch (e) {
    console.warn('[chatIntentService] Failed to parse LLM response:', e.message, 'Raw:', raw);
    return { intentType: 'progress_query', entities: {} };
  }
}

module.exports = { classify };
