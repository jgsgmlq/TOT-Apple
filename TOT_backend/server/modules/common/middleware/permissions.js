'use strict';

const { db } = require('../../../db');
const { createError } = require('./errorHandler');

function requireTaskAccess(req, res, next) {
  const { role, storeId, employeeId } = req.user;
  const { id: taskId } = req.params;

  if (role === 'central' || role === 'admin') return next();

  if (role === 'employee') {
    const row = db.get(
      'SELECT 1 FROM task_assignments WHERE task_id = ? AND user_id = ? LIMIT 1',
      [taskId, employeeId]
    );
    if (!row) return next(createError(403, '无权查看此任务', 'AUTH_003'));
    return next();
  }

  return next(createError(403, '权限不足', 'AUTH_003'));
}

module.exports = { requireTaskAccess };
