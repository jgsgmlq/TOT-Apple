'use strict';

const renderMemoryBlock = (snippets) => {
  if (!Array.isArray(snippets) || snippets.length === 0) return "";
  const lines = snippets.map(s => s?.text).filter(Boolean);
  if (lines.length === 0) return "";
  return `[用户历史偏好/已知记忆]\n${lines.join('\n')}`;
};

module.exports = { renderMemoryBlock };
