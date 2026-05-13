'use strict';

var express = require('express');
var dictService = require('../services/dictService');
var { authenticate, requireRole } = require('../../common/middleware/auth');
var { success } = require('../../common/responseHelper');

var router = express.Router();
router.use(authenticate);

router.get('/', requireRole(['central', 'admin']), function(req, res, next) {
  try { var o = { dictType: req.query.dictType }; var r = dictService.getDictList(o); res.json(success(r)); } catch (e) { next(e); }
});

router.get('/type/:dictType', requireRole(['central', 'admin', 'executive', 'employee']), function(req, res, next) {
  try { var r = dictService.getDictByType(req.params.dictType); res.json(success(r)); } catch (e) { next(e); }
});

router.post('/', requireRole(['admin']), function(req, res, next) {
  try { var d = dictService.createDict(req.body); res.status(201).json(success(d)); } catch (e) { next(e); }
});

router.put('/:id', requireRole(['admin']), function(req, res, next) {
  try { var d = dictService.updateDict(req.params.id, req.body); res.json(success(d)); } catch (e) { next(e); }
});

router.delete('/:id', requireRole(['admin']), function(req, res, next) {
  try { dictService.deleteDict(req.params.id); res.json(success({ deleted: true })); } catch (e) { next(e); }
});

module.exports = router;
