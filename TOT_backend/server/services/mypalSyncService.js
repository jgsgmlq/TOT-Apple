'use strict';

const { db } = require('../db');
const { createError } = require('../middleware/errorHandler');
const { normalizeEmail } = require('./mypalLink');
const { computeAssignmentProgressStatus } = require('./assignmentProgress');
const {
  isMypalIntegrationEnabled,
  getUserWeeklyStatus,
  getUserDatasPage,
} = require('./mypalClient');
const { broadcastToUser, broadcastToUsers } = require('../ws/manager');

const WEEKLY_THROTTLE_MS = 1100;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 从批量结果中解析与任务匹配的一条进度行。
 * @param {Array<{ seedId?: string, productName?: string, progress?: number }>} rows
 * @param {string} normSeed
 * @param {string|null} productNameFilter
 * @returns {{ row: object|null, ambiguous: boolean }}
 */
function pickProgressRow(rows, normSeed, productNameFilter) {
  const forSeed = rows.filter((r) => normalizeEmail(r.seedId) === normSeed);
  if (forSeed.length === 0) return { row: null, ambiguous: false };
  if (productNameFilter) {
    const matched = forSeed.filter((r) => r.productName === productNameFilter);
    if (matched.length === 1) return { row: matched[0], ambiguous: false };
    if (matched.length === 0) return { row: null, ambiguous: false };
    return { row: null, ambiguous: true };
  }
  if (forSeed.length === 1) return { row: forSeed[0], ambiguous: false };
  return { row: null, ambiguous: true };
}

async function fetchAllUserDatas(queryDate) {
  const all = [];
  let pageNum = 1;
  let totalPages = 1;
  for (;;) {
    const json = await getUserDatasPage(queryDate, pageNum, 100);
    const chunk = Array.isArray(json.data) ? json.data : [];
    all.push(...chunk);
    const tp = json.totalPages != null ? Number(json.totalPages) : 1;
    totalPages = Number.isFinite(tp) && tp >= 1 ? tp : 1;
    if (pageNum >= totalPages) break;
    pageNum += 1;
  }
  return all;
}

/**
 * 应用 MyPal 行：若 progress===100 则写 mypal_completed，并重算 progress/status；可选 WS。
 * @returns {'updated'|'skipped'|'no_match'}
 */
function applyMypalRowToAssignment(assignmentRow, task, mypalRow, nowIso) {
  if (!mypalRow || typeof mypalRow.progress !== 'number') return 'no_match';
  if (mypalRow.progress !== 100) return 'skipped';

  if (assignmentRow.mypal_completed === 1) {
    return 'skipped';
  }

  let broadcast = null;

  db.transaction(() => {
    db.run(
      'UPDATE task_assignments SET mypal_completed = 1, updated_at = ? WHERE id = ?',
      [nowIso, assignmentRow.id]
    );

    const updated = db.get('SELECT * FROM task_assignments WHERE id = ?', [assignmentRow.id]);
    const computed = computeAssignmentProgressStatus(updated, task, nowIso);

    db.run(
      `UPDATE task_assignments SET progress = ?, status = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
      [
        computed.progress,
        computed.nextStatus,
        computed.completedAt,
        nowIso,
        assignmentRow.id,
      ]
    );

    if (computed.nextStatus === 'completed') {
      const fin = db.get('SELECT * FROM task_assignments WHERE id = ?', [assignmentRow.id]);
      broadcast = {
        assignmentId: fin.id,
        taskId: fin.task_id,
        userId: fin.user_id,
        storeId: fin.store_id,
        completedAt: computed.completedAt,
      };
    }
  });

  if (broadcast) {
    const wsPayload = { event: 'assignment_completed', data: broadcast };
    broadcastToUser(broadcast.userId, wsPayload);
    const storePeers = db.all(
      'SELECT id FROM employees WHERE store_id = ? AND id != ?',
      [broadcast.storeId, broadcast.userId]
    );
    broadcastToUsers(storePeers.map((p) => p.id), wsPayload);
  }

  return 'updated';
}

/**
 * @param {{ mode?: 'batch'|'weekly', taskId?: string, queryDate?: string }} opts
 */
async function syncMypal(opts) {
  if (!isMypalIntegrationEnabled()) {
    throw createError(503, 'MyPal 集成未启用或配置不完整', 'MYPAL_DISABLED');
  }

  const mode = opts.mode === 'weekly' ? 'weekly' : 'batch';
  const nowIso = new Date().toISOString();

  let tasks;
  if (opts.taskId) {
    const t = db.get('SELECT * FROM tasks WHERE id = ?', [opts.taskId]);
    if (!t) throw createError(404, '任务不存在', 'TASK_002');
    if (t.has_mypal !== 1) {
      throw createError(400, '该任务未配置 MyPal 平台', 'MYPAL_NOTASK');
    }
    tasks = [t];
  } else {
    tasks = db.all(
      `SELECT * FROM tasks WHERE status = 'dispatched' AND has_mypal = 1`
    );
  }

  const summary = {
    mode,
    tasksConsidered: tasks.length,
    assignmentsExamined: 0,
    assignmentsUpdated: 0,
    skippedNotComplete: 0,
    skippedNoEmployeeEmail: 0,
    skippedAmbiguousProduct: 0,
    skippedNoRow: 0,
    errors: [],
  };

  for (const task of tasks) {
    const queryDate = (opts.queryDate || task.mypal_task_week || '').trim();
    if (!queryDate) {
      summary.errors.push({ taskId: task.id, message: '缺少 queryDate / mypal_task_week' });
      continue;
    }

    let batchRows = null;
    if (mode === 'batch') {
      try {
        batchRows = await fetchAllUserDatas(queryDate);
      } catch (e) {
        summary.errors.push({ taskId: task.id, message: e.message || String(e) });
        continue;
      }
    }

    const assignments = db.all(
      'SELECT * FROM task_assignments WHERE task_id = ?',
      [task.id]
    );

    for (const a of assignments) {
      summary.assignmentsExamined += 1;

      const emp = db.get('SELECT email FROM employees WHERE id = ?', [a.user_id]);
      const email = emp && emp.email ? normalizeEmail(emp.email) : null;
      if (!email) {
        summary.skippedNoEmployeeEmail += 1;
        continue;
      }

      const productFilter = task.mypal_product_name ? String(task.mypal_product_name).trim() : null;

      try {
        if (mode === 'batch') {
          const { row, ambiguous } = pickProgressRow(batchRows, email, productFilter || null);
          if (ambiguous) {
            summary.skippedAmbiguousProduct += 1;
            continue;
          }
          if (!row) {
            summary.skippedNoRow += 1;
            continue;
          }
          if (row.progress !== 100) {
            summary.skippedNotComplete += 1;
            continue;
          }

          const fresh = db.get('SELECT * FROM task_assignments WHERE id = ?', [a.id]);
          const r = applyMypalRowToAssignment(fresh, task, row, nowIso);
          if (r === 'updated') summary.assignmentsUpdated += 1;
          else if (r === 'skipped') summary.skippedNotComplete += 1;
          else summary.skippedNoRow += 1;
        } else {
          // weekly: 单学员单周
          const json = await getUserWeeklyStatus(email, queryDate);
          const row = json.data;
          if (!row) {
            summary.skippedNoRow += 1;
            await sleep(WEEKLY_THROTTLE_MS);
            continue;
          }
          if (productFilter && row.productName !== productFilter) {
            summary.skippedNoRow += 1;
            await sleep(WEEKLY_THROTTLE_MS);
            continue;
          }
          if (row.progress !== 100) {
            summary.skippedNotComplete += 1;
            await sleep(WEEKLY_THROTTLE_MS);
            continue;
          }

          const fresh = db.get('SELECT * FROM task_assignments WHERE id = ?', [a.id]);
          const r = applyMypalRowToAssignment(fresh, task, row, nowIso);
          if (r === 'updated') summary.assignmentsUpdated += 1;
          else if (r === 'skipped') summary.skippedNotComplete += 1;
          else summary.skippedNoRow += 1;

          await sleep(WEEKLY_THROTTLE_MS);
        }
      } catch (e) {
        summary.errors.push({
          taskId: task.id,
          assignmentId: a.id,
          message: e.message || String(e),
        });
      }
    }
  }

  return summary;
}

module.exports = { syncMypal, pickProgressRow };
