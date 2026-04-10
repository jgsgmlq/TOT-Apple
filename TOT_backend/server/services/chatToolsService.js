'use strict';

const { db } = require('../db');

// ─── TOOL_SCHEMAS ─────────────────────────────────────────────────────────────
// MVP: written here but NOT passed to LLM (intent_routing mode).
// FC upgrade: pass directly as `tools` param to openai.chat.completions.create().
const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'getOverviewData',
      description: '查询培训任务整体完成率、进度统计、预警率等汇总数据',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: '任务ID，不传则汇总所有已下发任务' },
          region: { type: 'string', description: '大区名称过滤，如"华东"' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'getTaskListData',
      description: '查询当前所有已下发培训任务的列表、截止时间与完成情况',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'getWarningsData',
      description: '查询存在风险的门店列表（完成率低或临近截止），即预警数据',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: '任务ID，不传则扫描所有任务' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'getStoreDetailData',
      description: '查询某一具体门店内所有员工的培训进度明细',
      parameters: {
        type: 'object',
        required: ['storeId'],
        properties: {
          storeId: { type: 'string', description: '门店ID' },
          taskId:  { type: 'string', description: '任务ID，不传则取最近一个任务' }
        }
      }
    }
  }
];

// ─── Region filter builder ─────────────────────────────────────────────────────
/**
 * Builds a SQL fragment + params array for region-scoped queries.
 * @param {object} regionScope  { type: 'national'|'regional'|'rtm', regions: string[]|null, rtm: string|null }
 * @returns {{ sql: string, params: any[] }}
 */
function buildRegionFilter(regionScope) {
  if (!regionScope || regionScope.type === 'national') {
    return { sql: '', params: [] };
  }
  if (regionScope.type === 'regional') {
    if (!regionScope.regions || regionScope.regions.length === 0) {
      return { sql: '', params: [] };
    }
    const placeholders = regionScope.regions.map(() => '?').join(',');
    return { sql: `AND s.region IN (${placeholders})`, params: regionScope.regions };
  }
  if (regionScope.type === 'rtm') {
    return { sql: 'AND s.rtm = ?', params: [regionScope.rtm] };
  }
  return { sql: '', params: [] };
}

// ─── Store name → ID resolver ──────────────────────────────────────────────────
/**
 * Resolves a storeName string to stores.id using LIKE matching.
 * Returns the matched storeId or null if ambiguous/not found.
 * @param {string} storeName
 * @returns {string|null}
 */
function resolveStoreId(storeName) {
  if (!storeName) return null;
  const rows = db.all(
    'SELECT id FROM stores WHERE name LIKE ?',
    [`%${storeName}%`]
  );
  if (rows.length === 1) return rows[0].id;
  return null; // ambiguous or not found
}

// ─── Tool functions ────────────────────────────────────────────────────────────

/**
 * getOverviewData — 汇总完成率/进度/预警率
 */
function getOverviewData(taskId, regionScope) {
  const filter = buildRegionFilter(regionScope);
  const taConditions = ['1=1'];
  const params = [];

  if (taskId) {
    taConditions.push('ta.task_id = ?');
    params.push(taskId);
  }

  // Need JOIN stores when region filter is active
  const joinStore = filter.sql ? 'JOIN stores s ON s.id = ta.store_id' : '';
  const whereClause = taConditions.join(' AND ') + (filter.sql ? ' ' + filter.sql : '');
  const allParams = [...params, ...filter.params];

  const row = db.get(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN ta.status = 'completed'   THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN ta.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
       SUM(CASE WHEN ta.status = 'pending'     THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN ta.status = 'completed' AND ta.completed_at <= t.ddl_at THEN 1 ELSE 0 END) AS on_time,
       AVG(CASE WHEN ta.status = 'completed' AND ta.completed_at IS NOT NULL AND t.created_at IS NOT NULL
           THEN (julianday(ta.completed_at) - julianday(t.created_at)) * 24 END) AS avg_hours,
       MAX(ta.updated_at) AS last_updated
     FROM task_assignments ta
     JOIN tasks t ON t.id = ta.task_id
     ${joinStore}
     WHERE ${whereClause}`,
    allParams
  );

  const total = row ? (row.total ?? 0) : 0;
  return {
    totalAssignments: total,
    completedCount: row ? (row.completed ?? 0) : 0,
    inProgressCount: row ? (row.in_progress ?? 0) : 0,
    pendingCount: row ? (row.pending ?? 0) : 0,
    completionRate: total > 0 ? parseFloat(((row.completed / total) * 100).toFixed(1)) : 0,
    onTimeCompletionRate: total > 0 ? parseFloat(((row.on_time / total) * 100).toFixed(1)) : 0,
    avgCompletionTimeHours: row && row.avg_hours ? parseFloat(row.avg_hours.toFixed(1)) : null,
    updatedAt: row ? row.last_updated : null,
  };
}

/**
 * getTaskListData — 已下发任务列表
 */
function getTaskListData(regionScope) {
  const filter = buildRegionFilter(regionScope);

  const rows = db.all(
    `SELECT
       t.id,
       t.title,
       t.ddl_at,
       COUNT(ta.id) AS total,
       SUM(CASE WHEN ta.status = 'completed' THEN 1 ELSE 0 END) AS completed
     FROM tasks t
     LEFT JOIN task_assignments ta ON ta.task_id = t.id
     ${filter.sql ? 'LEFT JOIN stores s ON s.id = ta.store_id' : ''}
     WHERE t.status = 'dispatched'
     ${filter.sql}
     GROUP BY t.id
     ORDER BY t.ddl_at ASC`,
    filter.params
  );

  return rows.map((r) => ({
    taskId: r.id,
    title: r.title,
    ddlAt: r.ddl_at,
    totalAssignments: r.total || 0,
    completedCount: r.completed || 0,
    completionRate: r.total > 0 ? parseFloat(((r.completed / r.total) * 100).toFixed(1)) : 0,
  }));
}

/**
 * getWarningsData — 风险门店列表（完成率 < 80%）
 * 直接查询 SQLite，不走 routes/dashboard.js（该路由仅限 central 角色）
 */
function getWarningsData(taskId, regionScope) {
  const filter = buildRegionFilter(regionScope);
  const taskFilter = taskId ? 'AND ta.task_id = ?' : "AND t.status = 'dispatched'";
  const taskParams = taskId ? [taskId] : [];

  const rows = db.all(
    `SELECT
       ta.task_id,
       s.id    AS store_id,
       s.name  AS store_name,
       s.region,
       t.ddl_at,
       COUNT(*) AS total,
       SUM(CASE WHEN ta.status = 'completed' THEN 1 ELSE 0 END) AS completed
     FROM task_assignments ta
     JOIN stores s ON s.id = ta.store_id
     JOIN tasks  t ON t.id = ta.task_id
     WHERE 1=1 ${taskFilter} ${filter.sql}
     GROUP BY ta.task_id, ta.store_id
     HAVING CAST(completed AS FLOAT) / total < 0.8
     ORDER BY CAST(completed AS FLOAT) / total ASC
     LIMIT 20`,
    [...taskParams, ...filter.params]
  );

  return rows.map((r) => ({
    taskId: r.task_id,
    storeId: r.store_id,
    storeName: r.store_name,
    region: r.region,
    ddlAt: r.ddl_at,
    totalCount: r.total,
    completedCount: r.completed,
    completionRate: r.total > 0 ? parseFloat(((r.completed / r.total) * 100).toFixed(1)) : 0,
  }));
}

/**
 * getStoreDetailData — 具体门店员工进度明细
 */
function getStoreDetailData(storeId, taskId) {
  // Fallback: if storeId looks like a name (no S prefix), try resolving
  let resolvedId = storeId;
  if (storeId && !storeId.match(/^S\d+$/i)) {
    resolvedId = resolveStoreId(storeId) || storeId;
  }

  // If no taskId, use the most recently created dispatched task for this store
  let resolvedTaskId = taskId;
  if (!resolvedTaskId) {
    const taskRow = db.get(
      `SELECT ta.task_id FROM task_assignments ta
       JOIN tasks t ON t.id = ta.task_id
       WHERE ta.store_id = ? AND t.status = 'dispatched'
       ORDER BY t.created_at DESC LIMIT 1`,
      [resolvedId]
    );
    resolvedTaskId = taskRow ? taskRow.task_id : null;
  }
  if (!resolvedTaskId) return { storeId: resolvedId, employees: [], summary: null };

  const storeRow = db.get('SELECT id, name, region, rtm, format FROM stores WHERE id = ?', [resolvedId]);
  const employees = db.all(
    `SELECT
       e.id AS employee_id,
       e.name AS employee_name,
       ta.status,
       ta.progress,
       ta.mypal_completed,
       ta.smartsell_completed,
       ta.ai_demo_completed,
       ta.live_broadcast_completed,
       ta.nudge_count,
       ta.received_at,
       ta.started_at,
       ta.completed_at
     FROM task_assignments ta
     JOIN employees e ON e.id = ta.user_id
     WHERE ta.task_id = ? AND ta.store_id = ?
     ORDER BY ta.progress DESC`,
    [resolvedTaskId, resolvedId]
  );

  const total = employees.length;
  const completed = employees.filter((e) => e.status === 'completed').length;

  return {
    taskId: resolvedTaskId,
    store: storeRow || { id: resolvedId },
    summary: {
      totalCount: total,
      completedCount: completed,
      completionRate: total > 0 ? parseFloat(((completed / total) * 100).toFixed(1)) : 0,
      inProgressCount: employees.filter((e) => e.status === 'in_progress').length,
      pendingCount: employees.filter((e) => e.status === 'pending').length,
    },
    employees: employees.map((e) => ({
      employeeId: e.employee_id,
      employeeName: e.employee_name,
      status: e.status,
      progress: e.progress,
      platformStatus: {
        mypalCompleted:          !!e.mypal_completed,
        smartsellCompleted:      !!e.smartsell_completed,
        aiDemoCompleted:         !!e.ai_demo_completed,
        liveBroadcastCompleted:  !!e.live_broadcast_completed,
      },
      nudgeCount: e.nudge_count,
      receivedAt: e.received_at,
      startedAt:  e.started_at,
      completedAt: e.completed_at,
    })),
  };
}

// ─── FC-ready unified dispatch entry point ────────────────────────────────────
/**
 * executeByName — single entry for both intent_routing and FC Loop.
 */
function executeByName(toolName, params, regionScope) {
  switch (toolName) {
    case 'getOverviewData':
      return getOverviewData(params.taskId || null, regionScope);
    case 'getTaskListData':
      return getTaskListData(regionScope);
    case 'getWarningsData':
      return getWarningsData(params.taskId || null, regionScope);
    case 'getStoreDetailData':
      if (!params.storeId) throw new Error('getStoreDetailData requires storeId');
      return getStoreDetailData(params.storeId, params.taskId || null);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

module.exports = {
  TOOL_SCHEMAS,
  executeByName,
  buildRegionFilter,
  resolveStoreId,
  // Individual functions exported for direct testing
  getOverviewData,
  getTaskListData,
  getWarningsData,
  getStoreDetailData,
};
