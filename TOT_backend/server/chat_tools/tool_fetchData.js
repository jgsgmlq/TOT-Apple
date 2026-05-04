'use strict';

const { db } = require('../db');

/**
 * fetchData — 导出 CSV 数据集 + 可选 Python 沙箱执行
 * 合并原 fetchRawDataset + executeCode
 */

const schema = {
  type: 'function',
  function: {
    name: 'fetchData',
    description: '导出任务数据的 CSV 数据集，可选附带 Python 代码在沙箱中执行分析。task_id 必填。',
    parameters: {
      type: 'object',
      required: ['task_id'],
      properties: {
        task_id: { type: 'string', description: '任务 ID。' },
        metrics: { type: 'array', items: { type: 'string' }, description: '要导出的指标（可选，默认全部）。' },
        code:    { type: 'string', description: '可选：Python 代码。数据预装在 /data/input.csv。不传则只导出 CSV。' },
      },
    },
  },
};

const meta = {
  enabled: true,
  requiredRole: ['executive', 'central', 'admin'],
  scopePolicy: 'any',
  timeoutMs: 30000,
};

async function handler(args, _regionScope) {
  // 导出 CSV 逻辑（复用原 fetchRawDataset 的查询逻辑）
  const taskId = args.task_id;
  const rows = db.all(
    `SELECT e.name AS employee_name, s.name AS store_name, s.region, s.format,
            ta.status, ta.received_at, ta.completed_at,
            CASE WHEN ta.completed_at IS NOT NULL
              THEN ROUND((julianday(ta.completed_at) - julianday(ta.received_at)) * 24, 1)
              ELSE NULL END AS completion_hours
     FROM task_assignments ta
     JOIN employees e ON e.id = ta.employee_id
     JOIN stores s ON s.id = ta.store_id
     WHERE ta.task_id = ?`, [taskId]
  );

  if (rows.length === 0) {
    return { success: false, error: 'NO_DATA', message: '该任务无数据。' };
  }

  // Build CSV
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(','), ...rows.map(r => headers.map(h => JSON.stringify(r[h] || '')).join(','))].join('\n');

  const result = { success: true, task_id: taskId, row_count: rows.length, csv_preview: csv.slice(0, 500) };

  // If code is provided, attempt E2B execution
  if (args.code) {
    try {
      const e2b = require('../utils/e2b');
      const execResult = await e2b.runCode(args.code, csv);
      result.python_output = execResult;
    } catch (err) {
      result.python_error = err.message;
    }
  }

  return result;
}

module.exports = { schema, meta, handler };
