'use strict';

var express = require('express');
var accountService = require('../services/accountService');
var { authenticate, requireRole } = require('../../common/middleware/auth');
var { success, paginated } = require('../../common/responseHelper');

var router = express.Router();
router.use(authenticate);

router.get('/', requireRole(['central', 'admin']), function(req, res, next) {
  try { var p = { page: +req.query.page || 1, pageSize: +req.query.pageSize || 20, role: req.query.role }; var r = accountService.getAccountPage(p); res.json(paginated(r.rows, { page: r.page, pageSize: r.pageSize, total: r.total })); } catch (e) { next(e); }
});

router.get('/:id', requireRole(['central', 'admin']), function(req, res, next) {
  try { res.json(success(accountService.getAccountById(req.params.id))); } catch (e) { next(e); }
});

router.post('/', requireRole(['admin']), function(req, res, next) {
  try { var a = accountService.createAccount(req.body); res.status(201).json(success(a)); } catch (e) { next(e); }
});

router.put('/:id', requireRole(['admin']), function(req, res, next) {
  try { var a = accountService.updateAccount(req.params.id, req.body); res.json(success(a)); } catch (e) { next(e); }
});

router.delete('/:id', requireRole(['admin']), function(req, res, next) {
  try { accountService.deleteAccount(req.params.id); res.json(success({ deleted: true })); } catch (e) { next(e); }
});

module.exports = router;
