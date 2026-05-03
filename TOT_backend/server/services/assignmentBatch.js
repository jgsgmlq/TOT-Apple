'use strict';

const { nanoid } = require('nanoid');
const { createError } = require('../middleware/errorHandler');
const { formatNowSqliteLocal } = require('../utils/ddlAt');

/**
 * Dev1：§3.4 批量创建分配记录（仅写 task_assignments，不含通知事件）
 * @param {object} db - server/db
 * @param {string} taskId
 * @param {Array<{ userId: string, storeId: string }>} targetUsers
 * @returns {{ successCount: number, skippedCount: number, failedCount: number, failedUsers: Array<{userId:string,reason:string}> }}
 */
function batchCreateAssignments(db, taskId, targetUsers) {
  const task = db.get('SELECT id FROM tasks WHERE id = ?', [taskId]);
  if (!task) {
    throw createError(404, '任务不存在', 'TASK_002');
  }

  let successCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const failedUsers = [];
  const now = formatNowSqliteLocal();

  for (const u of targetUsers) {
    const { userId, storeId } = u;
    if (!userId || !storeId) {
      failedCount += 1;
      failedUsers.push({ userId: userId || '', reason: 'userId/storeId 缺失' });
      continue;
    }

    const employee = db.get('SELECT id, store_id FROM employees WHERE id = ?', [userId]);
    if (!employee) {
      failedCount += 1;
      failedUsers.push({ userId, reason: '用户不存在' });
      continue;
    }
    if (employee.store_id !== storeId) {
      failedCount += 1;
      failedUsers.push({ userId, reason: 'storeId 与 userId 不匹配' });
      continue;
    }

    const assignmentId = nanoid();
    const insertAssignment = db.run(
      `INSERT OR IGNORE INTO task_assignments
        (id, task_id, user_id, store_id, status, progress, nudge_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', 0, 0, ?, ?)`,
      [assignmentId, taskId, userId, storeId, now, now]
    );

    if (insertAssignment.changes > 0) {
      successCount += 1;
    } else {
      skippedCount += 1;
    }
  }

  return { successCount, skippedCount, failedCount, failedUsers };
}

module.exports = { batchCreateAssignments };
