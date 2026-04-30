'use strict';

/**
 * Executive Chat 最终回复 markdown 渲染器集合。
 *
 * `finalResponseStep` 当 LLM 没产出 reply_markdown 时（兜底场景），用本文件的
 * `renderToolResultsMarkdown(toolResults, intent)` 把 toolResults 直接渲染成给用户看的
 * markdown。每个 intent 有专属 renderer；解析失败统一降级到 `renderGeneric`。
 *
 * 不要在这里写"拒绝/欢迎/系统错误"等通用文案 — 那些由 finalResponseStep 自己负责。
 *
 * toolResults 形状（来自 fc_MergeToolResults）：
 *   { [toolCallId]: { data: string|object, error?: { code, message }, toolName, ... } }
 *
 * 当 data 是字符串时，按 JSON 解析；解析后的结构通常是 `{ data: array|object, error?: ... }`
 * 或裸 array / object。renderer 各自做 best-effort 提取。
 */

const { normalizeIntent } = require('./intents');

const MAX_ROWS_PREVIEW = 8;

function _safeParse(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// 把 toolResults map 拍平成 [{ toolName, data, error }]，data 是 best-effort 解析后的对象/数组
function _flattenToolResults(toolResults) {
  const out = [];
  for (const [, entry] of Object.entries(toolResults || {})) {
    if (!entry) continue;
    const inner = _safeParse(entry.data);
    out.push({
      toolName: entry.toolName || null,
      raw: entry,
      parsed: inner,
      error: entry.error || (inner && inner.error) || null,
    });
  }
  return out;
}

// 从 parsed 里抽取数组类记录（兼容 { data: [...] } 与裸数组两种形状）
function _extractRows(parsed) {
  if (!parsed) return [];
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.data)) return parsed.data;
  return [];
}

// 数字格式化：百分比 / 数字防止 NaN
function _fmtPercent(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `${n}%`;
}
function _fmtNumber(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return String(n);
}
function _truncate(text, n = 20) {
  if (typeof text !== 'string') return '';
  return text.length <= n ? text : `${text.slice(0, n)}…`;
}

// ─── 各 intent 专属 renderer ────────────────────────────────────────────────

// project_status：任务列表
function renderTaskList(items) {
  const rows = items.flatMap(it => _extractRows(it.parsed));
  if (rows.length === 0) return null;
  const preview = rows.slice(0, MAX_ROWS_PREVIEW);
  const lines = [
    '我为您整理了当前进行中的培训任务：',
    '',
    '| 任务 | 完成率 | 截止 |',
    '|---|---|---|',
  ];
  for (const t of preview) {
    if (!t || typeof t !== 'object') continue;
    const title = _truncate(t.title || t.name || '未命名任务', 40);
    const rate = _fmtPercent(t.completionRate ?? t.completion_rate);
    const ddl = t.ddlAt || t.ddl_at || t.deadline || '—';
    lines.push(`| ${title} | ${rate} | ${ddl} |`);
  }
  lines.push('');
  if (rows.length > preview.length) {
    lines.push(`已找到 ${rows.length} 个任务（仅显示前 ${preview.length} 条）。可继续追问"按完成率从低到高排序"或"仅看本周到期任务"。`);
  } else {
    lines.push('可继续追问"按完成率从低到高排序"或"仅看本周到期任务"。');
  }
  return lines.join('\n');
}

// warning_query：⚠️ 高风险门店列表
function renderWarnings(items) {
  const rows = items.flatMap(it => _extractRows(it.parsed));
  if (rows.length === 0) return null;
  const preview = rows.slice(0, MAX_ROWS_PREVIEW);
  const lines = [
    '### ⚠️ 需要重点关注的门店',
    '',
    '| 门店 | 完成率 | 备注 |',
    '|---|---|---|',
  ];
  for (const r of preview) {
    if (!r || typeof r !== 'object') continue;
    const name = _truncate(r.storeName || r.store_name || r.name || r.title || '未命名', 30);
    const rate = _fmtPercent(r.completionRate ?? r.completion_rate);
    const note = _truncate(r.caliberNote || r.note || r.reason || '', 40) || '—';
    lines.push(`| ${name} | ${rate} | ${note} |`);
  }
  lines.push('');
  if (rows.length > preview.length) {
    lines.push(`共 ${rows.length} 家门店进入预警范围（仅显示前 ${preview.length}）。可追问"展开门店明细"。`);
  } else {
    lines.push('如需查看具体原因，可追问"为什么 XX 门店完成率低"。');
  }
  return lines.join('\n');
}

// query_metrics：指标摘要表（按 metric/region 等维度）
function renderMetrics(items) {
  const rows = items.flatMap(it => _extractRows(it.parsed));
  if (rows.length === 0) {
    // metrics 也可能是 { data: { kpi: ... } } 的对象（单条），尝试当成 KV 渲染
    for (const it of items) {
      if (it.parsed && typeof it.parsed === 'object' && !Array.isArray(it.parsed.data)) {
        const kv = it.parsed.data && typeof it.parsed.data === 'object' ? it.parsed.data : it.parsed;
        const entries = Object.entries(kv).filter(([k]) => k !== 'error');
        if (entries.length > 0) {
          const lines = ['### 核心指标', ''];
          for (const [k, v] of entries.slice(0, 12)) {
            lines.push(`- **${k}**：${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
          }
          return lines.join('\n');
        }
      }
    }
    return null;
  }
  const preview = rows.slice(0, MAX_ROWS_PREVIEW);
  // 自动选 1-3 列展示：metric/dimension/value/rate 这类常见字段
  const sample = preview[0];
  const candidateCols = ['metric', 'dimension', 'region', 'rtm', 'storeName', 'date', 'value', 'completionRate', 'count'];
  const cols = candidateCols.filter(c => sample && sample[c] !== undefined).slice(0, 4);
  if (cols.length === 0) {
    // 退回 KV 列表
    const lines = ['### 查询结果', ''];
    for (const r of preview) {
      lines.push(`- ${JSON.stringify(r)}`);
    }
    return lines.join('\n');
  }
  const lines = ['### 指标查询结果', '', `| ${cols.join(' | ')} |`, `| ${cols.map(() => '---').join(' | ')} |`];
  for (const r of preview) {
    lines.push(`| ${cols.map(c => {
      const v = r[c];
      if (typeof v === 'number') return c.toLowerCase().includes('rate') ? _fmtPercent(v) : _fmtNumber(v);
      return v == null ? '—' : _truncate(String(v), 24);
    }).join(' | ')} |`);
  }
  if (rows.length > preview.length) {
    lines.push('', `共 ${rows.length} 条记录（仅显示前 ${preview.length}）。如需更精确结果，可指定时间范围、大区或门店。`);
  }
  return lines.join('\n');
}

// drill_down：区域/门店详情。一条聚合摘要 + 关键指标列表
function renderDrillDown(items) {
  const rows = items.flatMap(it => _extractRows(it.parsed));
  if (rows.length === 0) {
    // drill_down 经常是单条 detail，尝试当成 KV
    for (const it of items) {
      const node = it.parsed && (it.parsed.data || it.parsed);
      if (node && typeof node === 'object' && !Array.isArray(node)) {
        const entries = Object.entries(node).filter(([k]) => k !== 'error' && k !== 'data');
        if (entries.length > 0) {
          const title = node.regionName || node.region || node.storeName || node.store_name || '详情';
          const lines = [`### ${title} — 详情`, ''];
          for (const [k, v] of entries.slice(0, 16)) {
            const display = typeof v === 'number'
              ? (k.toLowerCase().includes('rate') ? _fmtPercent(v) : _fmtNumber(v))
              : (typeof v === 'object' ? JSON.stringify(v) : String(v));
            lines.push(`- **${k}**：${display}`);
          }
          return lines.join('\n');
        }
      }
    }
    return null;
  }
  // 多条 detail：列表化
  const preview = rows.slice(0, MAX_ROWS_PREVIEW);
  const lines = ['### 下钻结果', ''];
  for (const r of preview) {
    if (!r || typeof r !== 'object') continue;
    const name = r.storeName || r.store_name || r.regionName || r.region || r.name || '记录';
    const rate = _fmtPercent(r.completionRate ?? r.completion_rate);
    const extra = r.totalCount != null ? `（共 ${r.totalCount} 条）` : '';
    lines.push(`- **${name}**：完成率 ${rate}${extra}`);
  }
  if (rows.length > preview.length) {
    lines.push('', `共 ${rows.length} 条（仅显示前 ${preview.length}）。`);
  }
  return lines.join('\n');
}

// analytics_query：分析摘要 + 关键发现
function renderAnalytics(items) {
  // analytics 通常是 runAnalytics 返回的 { summary, findings, data } 或 fetchRawDataset 的原始数据
  const lines = [];
  for (const it of items) {
    if (!it.parsed) continue;
    const node = it.parsed.data || it.parsed;
    if (node && typeof node === 'object') {
      if (typeof node.summary === 'string') {
        lines.push('### 分析结论', '', node.summary, '');
      }
      if (Array.isArray(node.findings) && node.findings.length > 0) {
        lines.push('### 关键发现', '');
        for (const f of node.findings.slice(0, 6)) {
          const text = typeof f === 'string' ? f : (f?.text || JSON.stringify(f));
          lines.push(`- ${text}`);
        }
        lines.push('');
      }
    }
  }
  if (lines.length === 0) {
    // 回退 metrics 风格
    return renderMetrics(items);
  }
  return lines.join('\n').trim();
}

// 通用兜底（保留原有计数/降级文案，但不输出 raw JSON code block）
function renderGeneric(items) {
  let totalRows = 0;
  let hasError = false;
  let errorMsg = null;

  for (const it of items) {
    if (it.error) {
      hasError = true;
      if (it.parsed && typeof it.parsed === 'object') {
        if (it.parsed.message && typeof it.parsed.message === 'string') {
          errorMsg = it.parsed.message;
        } else if (it.parsed.error && typeof it.parsed.error.message === 'string') {
          errorMsg = it.parsed.error.message;
        }
      }
    }
    if (it.parsed && !it.error) {
      const rows = _extractRows(it.parsed);
      totalRows += rows.length;
      if (rows.length === 0 && it.parsed.data && typeof it.parsed.data === 'object') totalRows += 1;
    }
  }

  if (totalRows > 0) {
    return `我已为您提取核心数据（共 ${totalRows} 条），如需更精确结果，可指定时间范围、大区或门店。`;
  }
  if (hasError) {
    if (errorMsg) {
      // 若系统返回了具体的中文报错信息 (如 "请明确您要查询的培训任务名称")，直接友好地反馈给用户
      return `抱歉，执行查询时遇到问题：${errorMsg}`;
    }
    return '我已完成查询，但本次部分数据源返回异常。建议重试，或指定更小范围（时间/大区/门店）后再查询。';
  }
  return '我已完成查询，但当前结果不足以生成稳定结论。建议指定时间范围、大区或门店后重试。';
}

const RENDERERS = {
  query_metrics: renderMetrics,
  progress_query: renderMetrics,
  project_status: renderTaskList,
  warning_query: renderWarnings,
  drill_down: renderDrillDown,
  analytics_query: renderAnalytics,
};

/**
 * 主入口。失败/数据为空时返回空字符串，让上层 finalResponseStep 用通用兜底文案。
 */
function renderToolResultsMarkdown(toolResults, intent) {
  const keys = Object.keys(toolResults || {});
  if (keys.length === 0) return '';
  const items = _flattenToolResults(toolResults);

  const renderer = RENDERERS[normalizeIntent(intent)] || renderGeneric;
  let out = null;
  try {
    out = renderer(items);
  } catch {
    out = null;
  }
  if (out && typeof out === 'string' && out.trim().length > 0) {
    return out;
  }
  // 专属 renderer 没解析出结果就降级到通用
  return renderGeneric(items);
}

module.exports = {
  renderToolResultsMarkdown,
  RENDERERS,
  // 暴露给后续可能的单测
  _internals: {
    renderMetrics,
    renderTaskList,
    renderWarnings,
    renderDrillDown,
    renderAnalytics,
    renderGeneric,
    _flattenToolResults,
    _extractRows,
  },
};
