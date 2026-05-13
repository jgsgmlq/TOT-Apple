'use strict';

var express = require('express');
var storeService = require('../services/storeService');
var { authenticate, requireRole } = require('../../common/middleware/auth');
var { success, paginated } = require('../../common/responseHelper');

var router = express.Router();
router.use(authenticate);

router.get('/', requireRole(['central', 'admin', 'executive']), function(req, res, next) {
  try { var o = { rtm4: req.query.rtm4, hqAppleId: req.query.hqAppleId, subRegion: req.query.subRegion, limit: +req.query.limit || 200 }; var r = storeService.getStoreList(o); res.json(success(r)); } catch (e) { next(e); }
});

router.get('/hq', requireRole(['central', 'admin']), function(req, res, next) {
  try { var r = storeService.getHqList({ country: req.query.country, rtm4: req.query.rtm4 }); res.json(success(r)); } catch (e) { next(e); }
});

router.get('/:id', requireRole(['central', 'admin', 'executive']), function(req, res, next) {
  try { res.json(success(storeService.getStoreById(req.params.id))); } catch (e) { next(e); }
});

module.exports = router;
