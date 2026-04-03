'use strict';

const express = require('express');
const { db } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { createError } = require('../middleware/errorHandler');
const { normalizeEmail } = require('../services/mypalLink');

const router = express.Router();

// GET /api/v1/employees — 支持 ?storeId=S001 过滤
router.get('/', authenticate, requireRole(['central', 'admin']), (req, res, next) => {
  try {
    const { storeId } = req.query;

    let rows;
    if (storeId) {
      rows = db.all('SELECT * FROM employees WHERE store_id = ? ORDER BY id', [storeId]);
    } else {
      rows = db.all('SELECT * FROM employees ORDER BY store_id, id');
    }

    res.json({ code: 200, message: 'success', data: rows, requestId: req.requestId });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/employees — central/admin 创建员工
router.post('/', authenticate, requireRole(['central', 'admin']), (req, res, next) => {
  try {
    const { id, storeId, name, role, email } = req.body;
    if (!id || !storeId || !name || !role) {
      throw createError(400, 'id/storeId/name/role 不能为空', 'EMP_001');
    }

    const store = db.get('SELECT id FROM stores WHERE id = ?', [storeId]);
    if (!store) throw createError(400, 'storeId 不存在', 'EMP_002');

    const exists = db.get('SELECT id FROM employees WHERE id = ?', [id]);
    if (exists) throw createError(409, '员工ID已存在', 'EMP_003');

    const emailNorm = normalizeEmail(email);
    if (emailNorm) {
      const dup = db.get(
        'SELECT id FROM employees WHERE lower(trim(email)) = ?',
        [emailNorm]
      );
      if (dup) throw createError(409, '该邮箱已绑定其他员工', 'EMP_007');
    }

    db.run(
      'INSERT INTO employees (id, store_id, name, role, email) VALUES (?, ?, ?, ?, ?)',
      [id, storeId, name, role, emailNorm]
    );

    const row = db.get('SELECT * FROM employees WHERE id = ?', [id]);
    res.status(201).json({ code: 201, message: 'success', data: row, requestId: req.requestId });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/employees/:id
router.get('/:id', authenticate, (req, res, next) => {
  try {
    const row = db.get('SELECT * FROM employees WHERE id = ?', [req.params.id]);
    if (!row) throw createError(404, '员工不存在', 'EMP_004');
    res.json({ code: 200, message: 'success', data: row, requestId: req.requestId });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/employees/:id — central/admin 更新员工信息
router.patch('/:id', authenticate, requireRole(['central', 'admin']), (req, res, next) => {
  try {
    const existing = db.get('SELECT * FROM employees WHERE id = ?', [req.params.id]);
    if (!existing) throw createError(404, '员工不存在', 'EMP_004');

    const { storeId, name, role, email } = req.body;
    if (storeId !== undefined) {
      const store = db.get('SELECT id FROM stores WHERE id = ?', [storeId]);
      if (!store) throw createError(400, 'storeId 不存在', 'EMP_002');
    }

    let nextEmail = existing.email;
    if (email !== undefined) {
      nextEmail = email === null || email === '' ? null : normalizeEmail(email);
      if (nextEmail) {
        const dup = db.get(
          'SELECT id FROM employees WHERE lower(trim(email)) = ? AND id != ?',
          [nextEmail, existing.id]
        );
        if (dup) throw createError(409, '该邮箱已绑定其他员工', 'EMP_007');
      }
    }

    db.run(
      `UPDATE employees
         SET store_id = ?, name = ?, role = ?, email = ?
       WHERE id = ?`,
      [
        storeId ?? existing.store_id,
        name ?? existing.name,
        role ?? existing.role,
        nextEmail,
        existing.id,
      ]
    );

    const row = db.get('SELECT * FROM employees WHERE id = ?', [existing.id]);
    res.json({ code: 200, message: 'success', data: row, requestId: req.requestId });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/employees/:id — central/admin 删除员工（无关联用户与 assignment）
router.delete('/:id', authenticate, requireRole(['central', 'admin']), (req, res, next) => {
  try {
    const existing = db.get('SELECT id FROM employees WHERE id = ?', [req.params.id]);
    if (!existing) throw createError(404, '员工不存在', 'EMP_004');

    const userRef = db.get('SELECT COUNT(*) AS count FROM users WHERE employee_id = ?', [req.params.id]);
    if (userRef && userRef.count > 0) {
      throw createError(409, '员工已绑定用户账号，无法删除', 'EMP_005');
    }

    const assignRef = db.get('SELECT COUNT(*) AS count FROM task_assignments WHERE user_id = ?', [req.params.id]);
    if (assignRef && assignRef.count > 0) {
      throw createError(409, '员工已有任务分配记录，无法删除', 'EMP_006');
    }

    db.run('DELETE FROM employees WHERE id = ?', [req.params.id]);
    res.json({ code: 200, message: 'success', data: { deleted: true }, requestId: req.requestId });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
