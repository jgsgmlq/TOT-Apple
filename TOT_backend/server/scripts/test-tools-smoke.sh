#!/bin/bash
# Smoke test: 验证 8 个 V0.3 工具能正确加载
set -e
cd "$(dirname "$0")/.."

echo "=== 1. 工具加载验证 ==="
node -e "
const srv = require('./services/chatToolsService');
const names = srv.getRegisteredToolNames();
console.log('注册工具数:', names.length);
console.log('工具列表:', names.join(', '));
if (names.length !== 8) { console.error('ERROR: expected 8 tools'); process.exit(1); }
console.log('OK');
"

echo ""
echo "=== 2. 工具 Schema + Meta 验证 ==="
for name in get_task_dashboard list_task_progress query_trend query_metric funnel_analysis fetch_incomplete_persons fetch_alert_persons search_task; do
  node -e "
const srv = require('./services/chatToolsService');
const schema = srv.getToolSchema('${name}');
if (!schema) { console.error('ERROR: ${name} schema not found'); process.exit(1); }
if (!schema.function.parameters) { console.error('ERROR: ${name} missing parameters'); process.exit(1); }
const meta = srv.getToolMeta('${name}');
if (!meta) { console.error('ERROR: ${name} meta not found'); process.exit(1); }
if (!meta.scopePolicy) { console.error('ERROR: ${name} missing scopePolicy'); process.exit(1); }
if (!meta.requiredRole || meta.requiredRole.length === 0) { console.error('ERROR: ${name} missing requiredRole'); process.exit(1); }
console.log('${name}: schema OK, scopePolicy=' + meta.scopePolicy + ' roles=[' + meta.requiredRole.join(',') + ']');
"
done

echo ""
echo "=== ALL CHECKS PASSED ==="
