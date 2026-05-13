'use strict';

var express = require('express');
var learnerService = require('../services/learnerService');
var { authenticate, requireRole } = require('../../common/middleware/auth');
var { success, paginated } = require('../../common/responseHelper');

var router = express.Router();
router.use(authenticate);

router.get('/', requireRole(['central', 'admin', 'executive']), function(req, res, next) {
  try { var o = { storeAppleId: req.query.storeAppleId, role: req.query.role, limit: +req.query.limit || 200 }; var r = learnerService.getLearnerList(o); res.json(success(r)); } catch (e) { next(e); }
});

router.get('/:id', requireRole(['central', 'admin', 'executive']), function(req, res, next) {
  try { res.json(success(learnerService.getLearnerById(req.params.id))); } catch (e) { next(e); }
});

module.exports = router;
