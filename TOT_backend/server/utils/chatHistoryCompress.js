'use strict';

/**
 * 将 assistant 消息的 replyContent 压缩为 LLM 上下文友好字符串。
 * 保留 overview + keyNumbers（约 100–150 token 量级）。
 * @param {string} rawContent  DB 中 assistant 消息的 JSON 字符串
 */
function compressAssistantContent(rawContent) {
  try {
    const parsed = JSON.parse(rawContent);
    if (!parsed || typeof parsed.overview !== 'string') return rawContent;

    const numSummary = Array.isArray(parsed.keyNumbers) && parsed.keyNumbers.length > 0
      ? parsed.keyNumbers
          .slice(0, 4)
          .map((k) => `${k.label}${k.value}${k.unit || ''}`)
          .join('、')
      : '';

    return numSummary
      ? `${parsed.overview}（${numSummary}）`
      : parsed.overview;
  } catch {
    return rawContent;
  }
}

module.exports = { compressAssistantContent };
