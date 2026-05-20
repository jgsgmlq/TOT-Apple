'use strict';

const express = require('express');
const router = express.Router();
const campaignService = require('../services/campaignService');
const { authenticate, requireRole } = require('../../common/middleware/auth');

router.use(authenticate);

/**
 * @route GET /api/v1/data-import/campaign/page
 * @description 分页获取培训活动列表
 * @access central, admin, executive
 */
router.get('/page', requireRole(['central', 'admin', 'executive']), async function(req, res, next) {
  try {
    await campaignService.getPage(req, res, next);
  } catch (e) {
    next(e);
  }
});

/**
 * @route GET /api/v1/data-import/campaign/options
 * @description 获取培训活动筛选项选项
 * @access central, admin, executive
 */
router.get('/options', requireRole(['central', 'admin', 'executive']), async function(req, res, next) {
  try {
    await campaignService.getOptions(req, res, next);
  } catch (e) {
    next(e);
  }
});

/**
 * @route POST /api/v1/data-import/campaign
 * @description 新增培训活动
 * @access central, admin
 */
router.post('/', requireRole(['central', 'admin']), async function(req, res, next) {
  try {
    await campaignService.create(req, res, next);
  } catch (e) {
    next(e);
  }
});

/**
 * @route PUT /api/v1/data-import/campaign/:id
 * @description 修改培训活动
 * @access central, admin
 */
router.put('/:id', requireRole(['central', 'admin']), async function(req, res, next) {
  try {
    await campaignService.update(req, res, next);
  } catch (e) {
    next(e);
  }
});

/**
 * @route DELETE /api/v1/data-import/campaign/:id
 * @description 删除培训活动
 * @access central, admin
 */
router.delete('/:id', requireRole(['central', 'admin']), async function(req, res, next) {
  try {
    await campaignService.remove(req, res, next);
  } catch (e) {
    next(e);
  }
});

/**
 * @route POST /api/v1/data-import/campaign/batch
 * @description 批量上传培训活动
 * @access central, admin
 */
router.post('/batch', requireRole(['central', 'admin']), async function(req, res, next) {
  try {
    await campaignService.batchUpload(req, res, next);
  } catch (e) {
    next(e);
  }
});

/**
 * @route POST /api/v1/data-import/campaign/batch-delete
 * @description 批量删除培训活动
 * @access central, admin
 */
router.post('/batch-delete', requireRole(['central', 'admin']), async function(req, res, next) {
  try {
    await campaignService.batchDelete(req, res, next);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
