'use strict';

const express = require('express');
const { db } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { createError } = require('../middleware/errorHandler');

const router = express.Router();

// GET /api/v1/stores — central only，返回全部门店
router.get('/', authenticate, requireRole(['central', 'admin']), (req, res, next) => {
  try {
    const rows = db.all('SELECT * FROM stores ORDER BY id');
    res.json({ code: 200, message: 'success', data: rows, requestId: req.requestId });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/stores — central/admin 创建门店
router.post('/', authenticate, requireRole(['central', 'admin']), (req, res, next) => {
  try {
    const { id, name, region, city, rtm, format, dealerName } = req.body;
    if (!id || !name || !region || !city || !rtm) {
      throw createError(400, 'id/name/region/city/rtm 不能为空', 'STORE_001');
    }

    const exists = db.get('SELECT id FROM stores WHERE id = ?', [id]);
    if (exists) throw createError(409, '门店ID已存在', 'STORE_002');

    db.run(
      'INSERT INTO stores (id, name, region, city, rtm, format, dealer_name) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, name, region, city, rtm, format ?? null, dealerName ?? null]
    );

    const row = db.get('SELECT * FROM stores WHERE id = ?', [id]);
    res.status(201).json({ code: 201, message: 'success', data: row, requestId: req.requestId });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/stores/:id — 门店详情
router.get('/:id', authenticate, (req, res, next) => {
  try {
    const row = db.get('SELECT * FROM stores WHERE id = ?', [req.params.id]);
    if (!row) throw createError(404, '门店不存在', 'STORE_003');
    res.json({ code: 200, message: 'success', data: row, requestId: req.requestId });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/stores/:id — central/admin 更新门店
router.patch('/:id', authenticate, requireRole(['central', 'admin']), (req, res, next) => {
  try {
    const existing = db.get('SELECT * FROM stores WHERE id = ?', [req.params.id]);
    if (!existing) throw createError(404, '门店不存在', 'STORE_003');

    const { name, region, city, rtm, format, dealerName } = req.body;
    db.run(
      `UPDATE stores
         SET name = ?, region = ?, city = ?, rtm = ?, format = ?, dealer_name = ?
       WHERE id = ?`,
      [
        name ?? existing.name,
        region ?? existing.region,
        city ?? existing.city,
        rtm ?? existing.rtm,
        format !== undefined ? format : existing.format,
        dealerName !== undefined ? dealerName : existing.dealer_name,
        existing.id,
      ]
    );

    const row = db.get('SELECT * FROM stores WHERE id = ?', [existing.id]);
    res.json({ code: 200, message: 'success', data: row, requestId: req.requestId });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/stores/:id — central/admin 删除门店（无关联员工时）
router.delete('/:id', authenticate, requireRole(['central', 'admin']), (req, res, next) => {
  try {
    const existing = db.get('SELECT id FROM stores WHERE id = ?', [req.params.id]);
    if (!existing) throw createError(404, '门店不存在', 'STORE_003');

    const refCount = db.get('SELECT COUNT(*) AS count FROM employees WHERE store_id = ?', [req.params.id]);
    if (refCount && refCount.count > 0) {
      throw createError(409, '门店下仍有关联员工，无法删除', 'STORE_004');
    }

    db.run('DELETE FROM stores WHERE id = ?', [req.params.id]);
    res.json({ code: 200, message: 'success', data: { deleted: true }, requestId: req.requestId });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
