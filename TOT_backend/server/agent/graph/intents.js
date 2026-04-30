'use strict';

/**
 * Executive Chat 的 intent 规范化层 — 单一来源。
 *
 * INTENT_TOOL_MAP 在 nodes.js（依赖 toolRetriever 的 BM25 索引初始化时机），
 * 但 alias 映射 / normalizeIntent helper 不依赖任何运行时状态，独立放这里，
 * 让 renderers.js / 测试 / 其它节点都能直接 require，避免与 nodes.js 形成循环依赖。
 *
 * 别名映射的口径必须跟 spec 文档 `docs/specs/10-EXECUTIVE-CHAT-INTENTS-TOOLS.md`
 * 的 alias 表保持一致。新增 alias 在这两处同步加。
 */

const INTENT_ALIAS_MAP = Object.freeze({
  matrix_query:   'query_metrics',
  task_status:    'project_status',
  store_warning:  'warning_query',
  analytics:      'analytics_query',
  unknown:        'chat_only',
});

function normalizeIntent(intent) {
  if (!intent || typeof intent !== 'string') return 'chat_only';
  return INTENT_ALIAS_MAP[intent] || intent;
}

module.exports = {
  INTENT_ALIAS_MAP,
  normalizeIntent,
};
