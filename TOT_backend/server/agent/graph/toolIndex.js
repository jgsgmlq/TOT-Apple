'use strict';

const chatToolsService = require('../../services/chatToolsService');
const { BM25Index } = require('./toolRetriever');
const { INTENT_ALIAS_MAP } = require('./intents');

const INTENT_TOOL_MAP = Object.freeze({
  query_metrics:   ["queryExecutiveMetrics", "getOverviewData", "getRegionDetailData", "searchEntities"],
  progress_query:  ["getOverviewData", "queryExecutiveMetrics", "searchEntities"],
  project_status:  ["getTaskListData", "getOverviewData", "queryExecutiveMetrics", "searchEntities"],
  warning_query:   ["getWarningsData", "queryExecutiveMetrics", "getStoreDetailData", "searchEntities"],
  drill_down:      ["getRegionDetailData", "getStoreDetailData", "queryExecutiveMetrics", "searchEntities"],
  analytics_query: ["runAnalytics", "queryExecutiveMetrics", "fetchRawDataset", "executeCode", "searchEntities"],
});

const FALLBACK_TOOL_NAMES = Object.freeze(["queryExecutiveMetrics", "getOverviewData", "getTaskListData", "searchEntities"]);

const TOOL_INDEX = (() => {
  const names = chatToolsService.getRegisteredToolNames();
  const docs = names.map(name => {
    const schema = chatToolsService.getToolSchemasByNames([name])[0];
    const desc = schema?.function?.description || '';
    return { id: name, text: `${name} ${desc}` };
  });
  return new BM25Index(docs);
})();

(() => {
  const registered = new Set(chatToolsService.getRegisteredToolNames());
  if (registered.size === 0) {
    console.warn("[graph/toolIndex] tools registry empty; skipping validation");
    return;
  }
  const allMentioned = new Set([
    ...Object.values(INTENT_TOOL_MAP).flat(),
    ...FALLBACK_TOOL_NAMES,
  ]);
  const missing = [...allMentioned].filter(n => !registered.has(n));
  if (missing.length > 0) {
    throw new Error(
      `[graph/toolIndex] INTENT_TOOL_MAP references unregistered tools: ${missing.join(", ")}`
    );
  }
  const validCanonical = new Set([...Object.keys(INTENT_TOOL_MAP), 'chat_only']);
  const badAliases = Object.entries(INTENT_ALIAS_MAP)
    .filter(([, target]) => !validCanonical.has(target))
    .map(([k, v]) => `${k}->${v}`);
  if (badAliases.length > 0) {
    throw new Error(
      `[graph/toolIndex] INTENT_ALIAS_MAP has invalid targets: ${badAliases.join(", ")}`
    );
  }
})();

module.exports = { INTENT_TOOL_MAP, FALLBACK_TOOL_NAMES, TOOL_INDEX };
