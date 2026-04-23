'use strict';

/**
 * 将 assistant 消息的 replyContent 压缩为 LLM 上下文友好字符串。
 * 保留 overview + keyNumbers（约 100–150 token 量级）。
 * @param {string} rawContent  DB 中 assistant 消息的 JSON 字符串
 */
function compressAssistantContent(rawContent) {
  if (!rawContent) return '';
  try {
    const parsed = JSON.parse(rawContent);
    let text = '';
    // Legacy / Intent Routing JSON
    if (parsed && typeof parsed.overview === 'string') {
      const numSummary = Array.isArray(parsed.keyNumbers) && parsed.keyNumbers.length > 0
        ? parsed.keyNumbers
            .slice(0, 4)
            .map((k) => `${k.label}${k.value}${k.unit || ''}`)
            .join('、')
        : '';
      text = numSummary ? `${parsed.overview}（${numSummary}）` : parsed.overview;
      
      if (parsed.visualizationSummary) {
        text += ` [${parsed.visualizationSummary}]`;
      }
      return text;
    }
    // Buggy FC JSON (markdownContent: null) or valid FC JSON with markdownContent string
    if (parsed && ('markdownContent' in parsed || '_intentType' in parsed)) {
      return typeof parsed.markdownContent === 'string' && parsed.markdownContent.trim()
        ? parsed.markdownContent
        : '（因查询中断未能提供完整结论，请缩小查询范围）';
    }
    return rawContent;
  } catch {
    // 如果是 Markdown 文本，执行确定性截断
    const limit = Number(process.env.CHAT_HISTORY_MARKDOWN_LIMIT) || 2000;
    if (rawContent.length <= limit) return rawContent;
    // 尽量在换行符处截断以保持格式相对完整
    const truncated = rawContent.substring(0, limit);
    const lastNewline = truncated.lastIndexOf('\n');
    if (lastNewline > limit * 0.8) {
      return truncated.substring(0, lastNewline) + '\n[...]';
    }
    return truncated + ' [...]';
  }
}

module.exports = { compressAssistantContent };