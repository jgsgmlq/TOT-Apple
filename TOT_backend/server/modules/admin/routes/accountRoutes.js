'use strict';

const express = require('express');
const accountService = require('../services/accountService');
const { authenticate, requireRole } = require('../../common/middleware/auth');
const { success, paginated } = require('../../common/responseHelper');

const router = express.Router();
router.use(authenticate);

router.get('/', requireRole(['central', 'admin']), async function(req, res, next) {
  try {
    const p = { page: +req.query.page || 1, pageSize: +req.query.pageSize || 20, role: req.query.role };
    const r = await accountService.getAccountPage(p);
    res.json(paginated(r.rows, { page: r.page, pageSize: r.pageSize, total: r.total }));
  } catch (e) { next(e); }
});

router.get('/:id', requireRole(['central', 'admin']), async function(req, res, next) {
  try {
    res.json(success(await accountService.getAccountById(req.params.id)));
  } catch (e) { next(e); }
});

router.post('/', requireRole(['admin']), async function(req, res, next) {
  try {
    const { emailId, password, name, role } = req.body;
    if (!emailId || !password || !name || !role) {
      const e = new Error('emailId, password, name, role 为必填字段');
      e.status = 400;
      throw e;
    }
    const a = await accountService.createAccount(req.body);
    res.status(201).json(success(a));
  } catch (e) { next(e); }
});

router.put('/:id', requireRole(['admin']), async function(req, res, next) {
  try {
    const a = await accountService.updateAccount(req.params.id, req.body);
    res.json(success(a));
  } catch (e) { next(e); }
});

router.delete('/:id', requireRole(['admin']), async function(req, res, next) {
  try {
    await accountService.deleteAccount(req.params.id);
    res.json(success({ deleted: true }));
  } catch (e) { next(e); }
});

module.exports = router;
