'use strict';

const express = require('express');
const router = express.Router();
const learnerService = require('../services/learnerService');
const { authenticate, requireRole } = require('../../common/middleware/auth');

router.use(authenticate);

/**
 * @route GET /api/v1/admin/learners/page
 * @description 分页获取学员列表（支持模糊搜索与多字段筛选排序）
 * @access central, admin, executive
 */
router.get('/page', requireRole(['central', 'admin', 'executive']), async function(req, res, next) {
  try {
    await learnerService.getPage(req, res, next);
  } catch (e) {
    next(e);
  }
});

/**
 * @route POST /api/v1/admin/learners
 * @description 新增单个学员记录
 * @access central, admin
 */
router.post('/', requireRole(['central', 'admin']), async function(req, res, next) {
  try {
    await learnerService.create(req, res, next);
  } catch (e) {
    next(e);
  }
});

/**
 * @route PUT /api/v1/admin/learners/:id
 * @description 更新指定的学员信息
 * @access central, admin
 */
router.put('/:id', requireRole(['central', 'admin']), async function(req, res, next) {
  try {
    await learnerService.update(req, res, next);
  } catch (e) {
    next(e);
  }
});

/**
 * @route DELETE /api/v1/admin/learners/:id
 * @description 删除指定的学员记录
 * @access central, admin
 */
router.delete('/:id', requireRole(['central', 'admin']), async function(req, res, next) {
  try {
    await learnerService.remove(req, res, next);
  } catch (e) {
    next(e);
  }
});

/**
 * @route POST /api/v1/admin/learners/batch
 * @description 批量上传导入学员数据
 * @access central, admin
 */
router.post('/batch', requireRole(['central', 'admin']), async function(req, res, next) {
  try {
    await learnerService.batchUpload(req, res, next);
  } catch (e) {
    next(e);
  }
});

/**
 * @route POST /api/v1/data-import/learner/batch-delete
 * @description 批量删除学员账户
 * @access central, admin
 */
router.post('/batch-delete', requireRole(['central', 'admin']), async function(req, res, next) {
  try {
    await learnerService.batchDelete(req, res, next);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
