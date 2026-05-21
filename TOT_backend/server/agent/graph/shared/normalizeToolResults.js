'use strict';

/**
 * 将 toolResults map 统一规范化为 datasets 数组。
 * 这是 toolResults 解析的单一真源（single source of truth）——
 * renderers、decideChart、extractPlottableData、finalResponseStep 都从本模块获取数据。
 *
 * 输入：
 *   toolResults: { [toolCallId]: { data: string|object, error?, toolName?, ... } }
 *
 * 输出：
 *   [{ id: toolCallId, toolName, rows: [...], meta: {...} }]
 */

function safeParse(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function normalizeToolResults(toolResults) {
  const datasets = [];

  for (const [callId, entry] of Object.entries(toolResults || {})) {
    if (!entry || entry.error) continue;
    const parsed = safeParse(entry.data);
    if (!parsed) continue;

    // { data: [...] }
    if (Array.isArray(parsed.data)) {
      datasets.push({ id: callId, toolName: entry.toolName || '', rows: parsed.data, meta: parsed });
      continue;
    }
    // { data: { rows: [...] } } — list_task_progress 等工具的输出格式
    if (parsed.data && Array.isArray(parsed.data.rows)) {
      datasets.push({ id: callId, toolName: entry.toolName || '', rows: parsed.data.rows, meta: parsed });
      continue;
    }
    // { rows: [...] } — query_metric 等工具的输出格式（rows 直接在顶层 data 下）
    if (Array.isArray(parsed.rows)) {
      datasets.push({ id: callId, toolName: entry.toolName || '', rows: parsed.rows, meta: parsed });
      continue;
    }
    // { data: { overall_metrics: {...}, ... } } — get_task_dashboard 格式
    if (parsed.data && parsed.data.overall_metrics && typeof parsed.data.overall_metrics === 'object') {
      const flatRows = [{ ...parsed.data.overall_metrics, task_name: parsed.data.task_name, task_id: parsed.data.task_id }];
      datasets.push({ id: callId, toolName: entry.toolName || '', rows: flatRows, meta: parsed });
      continue;
    }
    // { data: { ... } } 单条对象
    if (parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data)) {
      datasets.push({ id: callId, toolName: entry.toolName || '', rows: [parsed.data], meta: parsed });
      continue;
    }
    // 裸 array
    if (Array.isArray(parsed)) {
      datasets.push({ id: callId, toolName: entry.toolName || '', rows: parsed, meta: {} });
      continue;
    }
    // 裸对象
    if (typeof parsed === 'object') {
      datasets.push({ id: callId, toolName: entry.toolName || '', rows: [parsed], meta: parsed });
    }
  }

  return datasets;
}

module.exports = { normalizeToolResults, safeParse };
