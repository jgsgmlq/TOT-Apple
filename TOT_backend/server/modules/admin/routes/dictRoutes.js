'use strict';

const express = require('express');
const dictService = require('../services/dictService');
const { authenticate, requireRole } = require('../../common/middleware/auth');
const { success } = require('../../common/responseHelper');

const router = express.Router();
router.use(authenticate);

router.get('/', requireRole(['central', 'admin']), async function(req, res, next) {
  try {
    const o = { dictType: req.query.dictType };
    const r = await dictService.getDictList(o);
    res.json(success(r));
  } catch (e) { next(e); }
});

router.get('/type/:dictType', requireRole(['central', 'admin', 'executive', 'employee']), async function(req, res, next) {
  try {
    const r = await dictService.getDictByType(req.params.dictType);
    res.json(success(r));
  } catch (e) { next(e); }
});

router.post('/', requireRole(['admin']), async function(req, res, next) {
  try {
    const d = await dictService.createDict(req.body);
    res.status(201).json(success(d));
  } catch (e) { next(e); }
});

router.put('/:id', requireRole(['admin']), async function(req, res, next) {
  try {
    const d = await dictService.updateDict(req.params.id, req.body);
    res.json(success(d));
  } catch (e) { next(e); }
});

router.delete('/:id', requireRole(['admin']), async function(req, res, next) {
  try {
    await dictService.deleteDict(req.params.id);
    res.json(success({ deleted: true }));
  } catch (e) { next(e); }
});

module.exports = router;
