'use strict';

const { db } = require('../db');

/**
 * listRecords — 员工 / 任务记录明细查询
 *
 * 新增工具，填补明细查询缺口。
 * 替代 getStoreDetailData。
 */

const schema = {
  type: 'function',
  function: {
    name: 'listRecords',
    description: '查询员工或任务记录的明细数据。支持按门店、状态、预警等级筛选。task_id 必填。',
    parameters: {
      type: 'object',
      required: ['entity_type', 'fields', 'task_id'],
      properties: {
        entity_type: {
          type: 'string',
          enum: ['employee', 'task_record'],
          description: '查哪种对象。employee=员工维度, task_record=任务记录维度。',
        },
        fields: {
          type: 'array',
          items: { type: 'string' },
          description: '要返回的字段。可选: employee_name, store_name, task_name, status, complete_time, reach_time, warning_level, overdue_days。',
        },
        task_id: {
          type: 'string',
          description: '任务 ID。',
        },
        store_ids: {
          type: 'array',
          items: { type: 'string' },
          description: '门店 ID 过滤（可选，多选）。',
        },
        status: {
          type: 'array',
          items: { type: 'string', enum: ['not_started', 'in_progress', 'completed', 'overdue'] },
          description: '状态过滤（可选）。',
        },
        warning_level: {
          type: 'array',
          items: { type: 'string', enum: ['P0', 'P1', 'P2'] },
          description: '预警等级过滤（可选）。',
        },
        sort_by:    { type: 'string', description: '排序字段。' },
        sort_order: { type: 'string', enum: ['asc', 'desc'], description: '升序/降序。' },
        limit:      { type: 'number', description: '返回条数上限，默认 100，最大 500。' },
      },
    },
  },
};

const meta = {
  enabled: true,
  requiredRole: ['executive', 'central', 'admin'],
  scopePolicy: 'any',
  timeoutMs: 10000,
};

async function handler(args, regionScope) {
  const limit = Math.min(500, Math.max(1, args.limit || 100));
  const fields = args.fields || ['employee_name', 'store_name', 'status'];

  let sql;
  let params = [];

  if (args.entity_type === 'task_record') {
    const selectCols = [];
    for (const f of fields) {
      switch (f) {
        case 'employee_name': selectCols.push('e.name AS employee_name'); break;
        case 'store_name':    selectCols.push('s.name AS store_name'); break;
        case 'task_name':     selectCols.push('t.title AS task_name'); break;
        case 'status':        selectCols.push('ta.status'); break;
        case 'complete_time': selectCols.push('ta.completed_at AS complete_time'); break;
        case 'reach_time':    selectCols.push('ta.received_at AS reach_time'); break;
        case 'overdue_days':  selectCols.push("CASE WHEN ta.completed_at IS NULL AND t.ddl_at < datetime('now','localtime') THEN CAST(julianday('now') - julianday(t.ddl_at) AS INTEGER) ELSE 0 END AS overdue_days"); break;
        default: break;
      }
    }

    const conditions = ['ta.task_id = ?'];
    params.push(args.task_id);

    if (args.store_ids && args.store_ids.length > 0) {
      conditions.push(`ta.store_id IN (${args.store_ids.map(() => '?').join(',')})`);
      params.push(...args.store_ids);
    }
    if (args.status && args.status.length > 0) {
      const statusMap = { not_started: 'pending', in_progress: 'in_progress', completed: 'completed' };
      const statusConditions = args.status.map(s => {
        if (s === 'overdue') return "(ta.status != 'completed' AND t.ddl_at < datetime('now','localtime'))";
        return `ta.status = ?`;
      });
      conditions.push(`(${statusConditions.join(' OR ')})`);
      for (const s of args.status) {
        if (s !== 'overdue') params.push(statusMap[s] || s);
      }
    }
    if (args.warning_level && args.warning_level.length > 0) {
      const wlMap = { P0: 'nudge_red', P1: 'nudge_orange', P2: 'nudge_yellow' };
      const eventTypes = args.warning_level.map(w => wlMap[w]).filter(Boolean);
      if (eventTypes.length > 0) {
        conditions.push(`EXISTS (SELECT 1 FROM notification_events ne WHERE ne.task_id = ta.task_id AND ne.target_user_id = ta.employee_id AND ne.event_type IN (${eventTypes.map(() => '?').join(',')}))`);
        params.push(...eventTypes);
      }
    }

    const where = conditions.join(' AND ');
    const orderBy = args.sort_by ? `ORDER BY ${args.sort_by} ${args.sort_order === 'asc' ? 'ASC' : 'DESC'}` : '';

    sql = `SELECT ${selectCols.join(', ')} FROM task_assignments ta JOIN employees e ON e.id = ta.employee_id JOIN stores s ON s.id = ta.store_id JOIN tasks t ON t.id = ta.task_id WHERE ${where} ${orderBy} LIMIT ${limit}`;
  } else {
    // entity_type = 'employee'
    sql = `SELECT e.id, e.name AS employee_name, s.name AS store_name, s.region, COUNT(ta.id) AS total_assignments, SUM(CASE WHEN ta.status = 'completed' THEN 1 ELSE 0 END) AS completed_count FROM employees e JOIN task_assignments ta ON ta.employee_id = e.id JOIN stores s ON s.id = ta.store_id WHERE ta.task_id = ? GROUP BY e.id ORDER BY completed_count ASC LIMIT ${limit}`;
    params = [args.task_id];
  }

  try {
    const rows = db.all(sql, params);
    return { success: true, entity_type: args.entity_type, rows, row_count: rows.length };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = { schema, meta, handler };
