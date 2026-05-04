'use strict';

const { db } = require('../db');
const logger = require('../utils/logger');
const { parseStoreDrill } = require('../utils/storeDrill');

/**
 * Executive Metrics 统一查询服务 (v4.0)
 *
 * 设计要点（与 PRD 3.0 / CEO 取数口径对齐）：
 * - 取数以"一个任务"为基本单位：taskId 强制必填（或可由 taskName/productName 解析）。
 * - 19 个指标全部支持，分两条数据通道：
 *     A. task_assignments 派生：reach / complete / incomplete / avg_duration_sec
 *     B. notification_events 历史事件流：p0/p1/p2_warning_count（去重 distinct user_id）
 * - 6 个催办转化指标（p0/p1/p2_conversion_*）按"分母 = 总人数"派生，clamp ≥ 0。
 * - 旧字段（completion_rate / completed_count / crisis_p0_rate / ...）保留为别名，向后兼容。
 * - 维度组合分组（多个 group_by）已修正历史 bug（之前只用 dim_0 匹配）。
 * - 可选 time filter：filters.time = { start, end, field }。
 * - 可选 aggregation：raw / topn / bottomn / mean / distribution。
 */

// 维度名 → stores 表列名（task_assignments / notification_events 都 JOIN stores）
const DIMENSION_MAP = {
  all: null,
  channel_l3: 's.rtm',
  channel_l4: 's.format',
  dealer: 's.dealer_name',
  store: 's.id',
};

// 事件类型 → P 级（来自 autoNudge.js L180–182：red→P0, orange→P1, yellow→P2）
const EVENT_TYPE_TO_PLEVEL = {
  nudge_red: 'p0',
  nudge_orange: 'p1',
  nudge_yellow: 'p2',
};

// 19 指标 + 旧别名白名单
const ALL_METRICS = new Set([
  // 8 个 assignment 派生
  'total_count',
  'reach_count', 'reach_rate',
  'complete_count', 'complete_rate',
  'incomplete_count', 'incomplete_rate',
  'avg_duration_sec',
  // 6 个 warning（来自 notification_events）
  'p0_warning_count', 'p0_warning_rate',
  'p1_warning_count', 'p1_warning_rate',
  'p2_warning_count', 'p2_warning_rate',
  // 6 个 conversion（派生）
  'p0_conversion_count', 'p0_conversion_rate',
  'p1_conversion_count', 'p1_conversion_rate',
  'p2_conversion_count', 'p2_conversion_rate',
]);

// 旧字段 → 新字段别名映射（输入与输出双向兼容）
const ALIAS_MAP = {
  completion_rate: 'complete_rate',
  completed_count: 'complete_count',
  crisis_p0_rate: 'p0_warning_rate',
  crisis_p1_rate: 'p1_warning_rate',
  crisis_p0_count: 'p0_warning_count',
  crisis_p1_count: 'p1_warning_count',
  // avg_completion_time_hours / read_rate / start_delay_rate 保留为输出层兼容字段（不进入新指标）
};

// 时间字段允许列表（防 SQL 注入）
const ALLOWED_TIME_FIELDS = new Set(['received_at', 'completed_at', 'started_at', 'created_at']);

function resolveTaskId(taskName, productName, explicitTaskId) {
  if (explicitTaskId) {
    const exists = db.get('SELECT id FROM tasks WHERE id = ?', [explicitTaskId]);
    if (exists) return exists.id;
    return null;
  }

  const tasks = db.all('SELECT id, title, mypal_product_name FROM tasks ORDER BY created_at DESC');

  const searchFor = String(taskName || productName || '').toLowerCase().trim();
  if (!searchFor) return null;

  // 1. 子串匹配
  for (const t of tasks) {
    const tTitle = (t.title || '').toLowerCase();
    if (tTitle.includes(searchFor) || searchFor.includes(tTitle)) {
      return t.id;
    }
  }

  // 2. 常见别名 / AI 幻觉映射
  const aliases = [
    { keys: ['phone', 'iphone', '17'], id: 'TASK_A' },
    { keys: ['pod', 'airpods'], id: 'TASK_B' },
    { keys: ['mac', 'macbook'], id: 'TASK_WARN_START' },
    { keys: ['watch', 'apple watch'], id: 'TASK_WARN_P0' },
    { keys: ['pad', 'ipad'], id: 'TASK_WARN_P1' },
    { keys: ['mono', '新春'], id: 'TASK_C' },
  ];
  for (const alias of aliases) {
    for (const key of alias.keys) {
      if (searchFor.includes(key)) return alias.id;
    }
  }

  // 3. Token 重叠
  const searchTokens = searchFor.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, ' ').split(/\s+/).filter(Boolean);
  if (searchTokens.length > 0) {
    let bestMatch = null;
    let maxOverlap = 0;
    for (const t of tasks) {
      const tTitle = (t.title || '').toLowerCase();
      let overlap = 0;
      for (const token of searchTokens) {
        if (token.length > 1 && tTitle.includes(token)) overlap++;
      }
      if (overlap > maxOverlap) {
        maxOverlap = overlap;
        bestMatch = t.id;
      }
    }
    if (bestMatch) return bestMatch;
  }

  return null;
}

function buildRegionFilter(regionScope) {
  if (!regionScope || regionScope.type === 'national') return { sql: '', params: [] };
  if (regionScope.type === 'regional' && Array.isArray(regionScope.regions)) {
    if (regionScope.regions.length === 0) return { sql: 'AND 1=0', params: [] };
    const placeholders = regionScope.regions.map(() => '?').join(',');
    return { sql: `AND s.region IN (${placeholders})`, params: regionScope.regions };
  }
  if (regionScope.type === 'rtm' && regionScope.rtm) {
    return { sql: `AND s.rtm = ?`, params: [regionScope.rtm] };
  }
  return { sql: '', params: [] };
}

/**
 * 构建分组 SQL（修正历史多维 bug：使用全部 dim_i 而不是只用 dim_0）
 */
function buildGroupBy(dimensions) {
  const dims = (dimensions || []).filter((d) => DIMENSION_MAP[d]);
  if (dims.length === 0) {
    return {
      selectSql: "'Total' AS dim_0",
      groupBySql: '',
      dimColumns: [],
      dimNames: [],
      extraSelects: [],
      hasStore: false,
    };
  }
  const dimColumns = dims.map((d) => DIMENSION_MAP[d]);
  const selectSql = dimColumns.map((col, i) => `${col} AS dim_${i}`).join(', ');
  const groupBySql = `GROUP BY ${dimColumns.join(', ')}`;
  // store 维度额外返回门店名称
  const hasStore = dims.includes('store');
  const extraSelects = hasStore ? [', s.name AS dim_store_name'] : [];
  return { selectSql, groupBySql, dimColumns, dimNames: dims, extraSelects, hasStore };
}

function makeGroupKey(row, dimNames) {
  if (dimNames.length === 0) return '__total__';
  return dimNames.map((_, i) => String(row[`dim_${i}`] ?? 'Total')).join('||');
}

/**
 * 解析时间过滤（防 SQL 注入：field 必须在白名单内）
 */
function parseTimeFilter(timeArg, columnPrefix) {
  if (!timeArg || !timeArg.start || !timeArg.end) return { sql: '', params: [] };
  const field = ALLOWED_TIME_FIELDS.has(timeArg.field) ? timeArg.field : 'received_at';
  return {
    sql: `AND ${columnPrefix}.${field} BETWEEN ? AND ?`,
    params: [timeArg.start, timeArg.end],
  };
}

/**
 * 矩阵查询主入口
 */
async function query(params = {}, regionScope = null) {
  // 1. task_id 强制必填（取数以一个任务为基本单位）
  const taskId = resolveTaskId(params.taskName, params.productName, params.taskId);
  if (!taskId) {
    return {
      error: 'TASK_REQUIRED',
      message: '取数以"一个任务"为基本单位。请提供任务名称、产品名称或 taskId（建议先调用 searchEntities 消歧）。',
      hint: 'task_required',
    };
  }

  // 2. metrics 必填
  const requestedMetrics = Array.isArray(params.metrics) ? params.metrics : [];
  if (requestedMetrics.length === 0) {
    return {
      error: 'INVALID_PARAMETERS',
      message: '请指定至少一个度量指标（如 complete_rate）。',
    };
  }

  // 3. 别名归一化 + 未知校验
  const normalizedMetrics = requestedMetrics.map((m) => ALIAS_MAP[m] || m);
  const unknown = normalizedMetrics.filter(
    (m) => !ALL_METRICS.has(m) && m !== 'avg_completion_time_hours' && m !== 'read_rate' && m !== 'start_delay_rate'
  );
  if (unknown.length > 0) {
    return {
      error: 'INVALID_PARAMETERS',
      message: `未识别的指标: ${unknown.join(', ')}。可用指标：${[...ALL_METRICS].join(', ')}`,
    };
  }

  const dimensions = Array.isArray(params.dimensions) && params.dimensions.length > 0 ? params.dimensions : ['all'];
  const drill = parseStoreDrill(params.filters || {});
  const scope = buildRegionFilter(regionScope);
  const { selectSql, groupBySql, dimNames, extraSelects, hasStore } = buildGroupBy(dimensions);
  const extraSelect = extraSelects.join('');

  // 时间过滤：A 通道用 task_assignments.<field>，B 通道用 notification_events.created_at
  const timeFilterA = parseTimeFilter(params.filters?.time, 'ta');
  const timeFilterB = (params.filters?.time && params.filters.time.start && params.filters.time.end)
    ? { sql: 'AND ne.created_at BETWEEN ? AND ?', params: [params.filters.time.start, params.filters.time.end] }
    : { sql: '', params: [] };

  // ─── Phase A: assignment 派生（reach / complete / incomplete / avg_duration_sec / total）───
  const phaseASql = `
    SELECT
      ${selectSql}${extraSelect},
      COUNT(ta.id) AS total_count,
      SUM(CASE WHEN ta.received_at IS NOT NULL THEN 1 ELSE 0 END) AS reach_count,
      SUM(CASE WHEN ta.status = 'completed' THEN 1 ELSE 0 END) AS complete_count,
      SUM(CASE WHEN ta.status != 'completed' THEN 1 ELSE 0 END) AS incomplete_count,
      AVG(CASE
            WHEN ta.status = 'completed'
             AND ta.completed_at IS NOT NULL
             AND ta.received_at IS NOT NULL
            THEN (julianday(ta.completed_at) - julianday(ta.received_at)) * 86400.0
          END) AS avg_duration_sec_raw,
      AVG(CASE
            WHEN ta.status = 'completed'
             AND ta.completed_at IS NOT NULL
             AND t.created_at IS NOT NULL
            THEN (julianday(ta.completed_at) - julianday(t.created_at)) * 24.0
          END) AS avg_completion_time_hours_raw
    FROM task_assignments ta
    JOIN stores s ON s.id = ta.store_id
    JOIN tasks t ON t.id = ta.task_id
    WHERE ta.task_id = ? ${drill.sql} ${scope.sql} ${timeFilterA.sql}
    ${groupBySql}
  `;
  const phaseAParams = [taskId, ...drill.params, ...scope.params, ...timeFilterA.params];

  let phaseARows = [];
  try {
    phaseARows = db.all(phaseASql, phaseAParams);
  } catch (err) {
    logger.error('executive_metrics_phase_a_failed', { error: err.message, taskId, sql: phaseASql });
    return { error: 'INTERNAL_ERROR', message: `Phase A 查询失败: ${err.message}` };
  }

  // ─── Phase B: notification_events 派生（P0/P1/P2 warning，distinct user）───
  const needPhaseB = normalizedMetrics.some((m) => /^p[012]_(warning|conversion)/.test(m));
  const phaseBMap = new Map();
  if (needPhaseB) {
    const phaseBSql = `
      SELECT
        ${selectSql}${extraSelect},
        SUM(CASE WHEN x.event_type = 'nudge_red'    THEN 1 ELSE 0 END) AS p0_warning_count,
        SUM(CASE WHEN x.event_type = 'nudge_orange' THEN 1 ELSE 0 END) AS p1_warning_count,
        SUM(CASE WHEN x.event_type = 'nudge_yellow' THEN 1 ELSE 0 END) AS p2_warning_count
      FROM (
        SELECT DISTINCT ne.target_user_id, ne.event_type, ne.store_id
        FROM notification_events ne
        WHERE ne.task_id = ?
          AND ne.event_type IN ('nudge_red','nudge_orange','nudge_yellow')
          ${timeFilterB.sql}
      ) x
      JOIN stores s ON s.id = x.store_id
      WHERE 1=1 ${drill.sql} ${scope.sql}
      ${groupBySql}
    `;
    const phaseBParams = [taskId, ...timeFilterB.params, ...drill.params, ...scope.params];
    try {
      const rows = db.all(phaseBSql, phaseBParams);
      for (const row of rows) {
        const key = makeGroupKey(row, dimNames);
        phaseBMap.set(key, {
          p0_warning_count: Number(row.p0_warning_count || 0),
          p1_warning_count: Number(row.p1_warning_count || 0),
          p2_warning_count: Number(row.p2_warning_count || 0),
        });
      }
    } catch (err) {
      logger.error('executive_metrics_phase_b_failed', { error: err.message, taskId, sql: phaseBSql });
      return { error: 'INTERNAL_ERROR', message: `Phase B 查询失败: ${err.message}` };
    }
  }

  // ─── 组合派生 ───
  const formattedRows = phaseARows.map((row) => {
    const key = makeGroupKey(row, dimNames);
    const total = Number(row.total_count || 0);
    const reach = Number(row.reach_count || 0);
    const complete = Number(row.complete_count || 0);
    const incomplete = Number(row.incomplete_count || 0);
    const warns = phaseBMap.get(key) || { p0_warning_count: 0, p1_warning_count: 0, p2_warning_count: 0 };
    const p0 = warns.p0_warning_count;
    const p1 = warns.p1_warning_count;
    const p2 = warns.p2_warning_count;

    // 转化人数（clamp ≥ 0；ddl 之前 P 级未触发时 max() 兜底）
    const p2Conv = Math.max(0, p2 - p1);
    const p1Conv = Math.max(0, p1 - p0);
    const p0Conv = Math.max(0, p0 - incomplete);

    const denom = total > 0 ? total : null;
    const pct = (n) => (denom ? parseFloat(((100.0 * n) / denom).toFixed(2)) : null);

    const allComputed = {
      // 基础
      total_count: total,
      reach_count: reach,
      reach_rate: pct(reach),
      complete_count: complete,
      complete_rate: pct(complete),
      incomplete_count: incomplete,
      incomplete_rate: pct(incomplete),
      avg_duration_sec:
        row.avg_duration_sec_raw != null ? Math.round(Number(row.avg_duration_sec_raw)) : null,
      // 预警
      p0_warning_count: p0,
      p0_warning_rate: pct(p0),
      p1_warning_count: p1,
      p1_warning_rate: pct(p1),
      p2_warning_count: p2,
      p2_warning_rate: pct(p2),
      // 转化
      p0_conversion_count: p0Conv,
      p0_conversion_rate: pct(p0Conv),
      p1_conversion_count: p1Conv,
      p1_conversion_rate: pct(p1Conv),
      p2_conversion_count: p2Conv,
      p2_conversion_rate: pct(p2Conv),
      // 旧别名兼容
      completion_rate: pct(complete),
      completed_count: complete,
      avg_completion_time_hours:
        row.avg_completion_time_hours_raw != null
          ? parseFloat(Number(row.avg_completion_time_hours_raw).toFixed(1))
          : null,
      crisis_p0_rate: pct(p0),
      crisis_p1_rate: pct(p1),
      crisis_p0_count: p0,
      crisis_p1_count: p1,
      // 占位（避免下游引用未定义）
      read_rate: null,
      start_delay_rate: null,
    };

    const dimResult = {};
    if (dimNames.length === 0) {
      dimResult.all = 'Total';
    } else {
      dimNames.forEach((d, i) => {
        dimResult[d] = row[`dim_${i}`] ?? 'Total';
      });
      // store 维度额外返回门店中文名称
      if (hasStore && row.dim_store_name) {
        dimResult.store_name = row.dim_store_name;
      }
    }

    const result = { dimensions: dimResult };
    for (const m of requestedMetrics) {
      const canonical = ALIAS_MAP[m] || m;
      result[m] = allComputed[canonical] !== undefined ? allComputed[canonical] : (allComputed[m] ?? null);
    }
    return result;
  });

  // ─── 排序 ───
  const finalSort =
    params.sort && params.sort.sortBy
      ? { sortBy: params.sort.sortBy, order: params.sort.order || 'desc' }
      : { sortBy: requestedMetrics[0], order: 'desc' };
  formattedRows.sort((a, b) => {
    const valA = a[finalSort.sortBy];
    const valB = b[finalSort.sortBy];
    if (valA == null && valB == null) return 0;
    if (valA == null) return 1;
    if (valB == null) return -1;
    return finalSort.order === 'desc' ? valB - valA : valA - valB;
  });

  // ─── 聚合算子（topn / bottomn / mean / distribution / raw）───
  let outputRows = formattedRows;
  let aggregationApplied = null;
  const agg = params.aggregation;
  if (agg && agg.type && agg.type !== 'raw') {
    const target = agg.target_metric || finalSort.sortBy;
    if ((agg.type === 'topn' || agg.type === 'bottomn') && Number.isFinite(agg.n)) {
      const n = Math.max(1, Math.min(1000, Math.floor(agg.n)));
      const desc = agg.type === 'topn';
      const sorted = [...formattedRows].sort((a, b) => {
        const va = Number(a[target]);
        const vb = Number(b[target]);
        if (!Number.isFinite(va) && !Number.isFinite(vb)) return 0;
        if (!Number.isFinite(va)) return 1;
        if (!Number.isFinite(vb)) return -1;
        return desc ? vb - va : va - vb;
      });
      outputRows = sorted.slice(0, n);
      aggregationApplied = { type: agg.type, n: outputRows.length, target_metric: target };
    } else if (agg.type === 'mean') {
      const vals = formattedRows.map((r) => r[target]).filter((v) => Number.isFinite(v));
      const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      outputRows = [
        {
          dimensions: { all: 'Mean' },
          [target]: mean != null ? parseFloat(mean.toFixed(2)) : null,
          _aggregated: 'mean',
          _sampleSize: vals.length,
        },
      ];
      aggregationApplied = { type: 'mean', target_metric: target, sampleSize: vals.length };
    } else if (agg.type === 'distribution' && Array.isArray(agg.bins) && agg.bins.length >= 2) {
      const vals = formattedRows.map((r) => r[target]).filter((v) => Number.isFinite(v));
      const bins = [...agg.bins].sort((a, b) => a - b);
      const buckets = [];
      for (let i = 0; i < bins.length - 1; i++) {
        const lo = bins[i];
        const hi = bins[i + 1];
        const cnt = vals.filter((v) => v >= lo && v < hi).length;
        buckets.push({
          dimensions: { bin: `[${lo}, ${hi})` },
          lo,
          hi,
          count: cnt,
          ratio: vals.length ? parseFloat((cnt / vals.length).toFixed(4)) : 0,
        });
      }
      outputRows = buckets;
      aggregationApplied = {
        type: 'distribution',
        target_metric: target,
        bins,
        sampleSize: vals.length,
      };
    }
  }

  return {
    taskId,
    dimensions,
    metrics: requestedMetrics,
    rows: outputRows,
    summary: {
      totalRows: outputRows.length,
      timestamp: new Date().toISOString(),
      aggregation: aggregationApplied,
    },
    appliedParams: { ...params, sort: finalSort, taskId },
    dataSource: needPhaseB ? 'task_assignments + notification_events' : 'task_assignments',
  };
}

module.exports = {
  query,
  resolveTaskId,
  buildRegionFilter,
  ALL_METRICS,
  ALIAS_MAP,
  DIMENSION_MAP,
  ALLOWED_TIME_FIELDS,
};
