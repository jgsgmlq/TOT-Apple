'use strict';

const renderConversation = (conv) => {
  if (!Array.isArray(conv) || conv.length === 0) return '';
  const lines = [];
  for (const entry of conv) {
    if (entry.role === 'user') {
      lines.push(`User: ${entry.content}`);
    } else if (entry.role === 'assistant') {
      const scope = entry.provenance?.scope || '';
      const scopeNote = scope ? ` [范围: ${scope}]` : '';
      lines.push(`Assistant${scopeNote}: ${entry.content}`);
    }
  }
  if (lines.length === 0) return '';
  return '## 对话历史\n' + lines.join('\n');
};

const renderLongTerm = (text) => {
  if (!text || typeof text !== 'string' || !text.trim()) return '';
  return '## 长期记忆\n' + text.trim();
};

module.exports = { renderConversation, renderLongTerm };
