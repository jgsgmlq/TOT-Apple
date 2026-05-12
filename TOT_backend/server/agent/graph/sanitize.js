'use strict';

/**
 * 用户可见 Markdown 净化为友好话术。
 *
 * 纯函数，零外部依赖 — 不访问 db / state / LLM。
 * 替换内部错误标记和中间产物标记，确保最终呈现给用户的文本不含系统内部信息。
 */

function sanitizeUserFacingMarkdown(content) {
  const text = typeof content === 'string' ? content : '';
  if (!text) return text;

  // 内部错误标记 → 友好话术
  if (text.startsWith('SYSTEM_ERROR:') || text.includes('SYSTEM_ERROR')) {
    const reason = text.replace(/^SYSTEM_ERROR:\s*/i, '').replace(/工具参数校验失败[。.]?\s*/g, '');
    if (reason.includes('区域范围限定') || reason.includes('regions') || reason.includes('rtm')) {
      return '抱歉，当前无法查询该范围的数据。请检查您的访问权限范围，或尝试指定更具体的查询条件。';
    }
    if (reason.includes('必填') || reason.includes('MISSING') || reason.includes('storeId') || reason.includes('taskName')) {
      return '我需要更多信息才能完成查询。请告诉我具体的任务名称、门店名称或产品名称，我会立即为您查询。';
    }
    return '抱歉，查询过程中遇到了问题。请尝试缩小查询范围，或换个方式重新描述您的问题。';
  }

  const hasInternalMarkers =
    text.includes('执行已达到复杂度上限') ||
    text.includes('工具查询片段');
  if (!hasInternalMarkers) return text;
  return '我已完成查询并提取了核心数据。若需更精确结果，可指定时间范围、大区或门店，我会继续为您细化。';
}

module.exports = { sanitizeUserFacingMarkdown };
