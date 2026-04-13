#!/usr/bin/env bash
# Smoke test for chatToolsService (import + stub data round-trip)
set -e
node -e "
const svc = require('./services/chatToolsService');
// TOOL_SCHEMAS shape check
const s = svc.TOOL_SCHEMAS;
if (!Array.isArray(s) || s.length !== 4) throw new Error('Expected 4 TOOL_SCHEMAS, got ' + s.length);
const names = s.map(t => t.function.name);
['getOverviewData','getTaskListData','getWarningsData','getStoreDetailData'].forEach(n => {
  if (!names.includes(n)) throw new Error('Missing tool: ' + n);
});
console.log('TOOL_SCHEMAS OK');

// executeByName dispatch check (with stub taskId that likely has no data)
const scope = { type: 'national', regions: null, rtm: null };
const result = svc.executeByName('getTaskListData', {}, scope);
if (!Array.isArray(result)) throw new Error('getTaskListData should return array');
console.log('executeByName dispatch OK');
console.log('ALL PASS');
"
