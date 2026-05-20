'use strict';

/**
 * taskRoutes.js — 任务发布路由
 *
 * 职责：参数校验、调 taskService、格式化响应。零 SQL。
 */

const express = require('express');
const { authenticate, requireRole } = require('../../common/middleware/auth');
const { success } = require('../../common/responseHelper');
const taskService = require('../services/taskService');
const audienceService = require('../services/audienceService');

const router = express.Router();

// ─── 静态路由（必须在 /:id 之前注册，避免被 :id 捕获）───────────────

// POST /api/v1/tasks/audience/preview
// 根据受众条件实时计算预计覆盖人数，不存库
router.post('/audience/preview', authenticate, requireRole(['central', 'admin']), async (req, res, next) => {
  try {
    const { conditions, allow_no_filter } = req.body;
    const count = await audienceService.previewCoverage(conditions || [], {
      allow_no_filter: !!allow_no_filter,
    });
    res.json(success({ estimated_count: count }));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/tasks/audience/dimensions
// 返回各维度的可选值，供前端下拉框动态渲染
router.get('/audience/dimensions', authenticate, async (req, res, next) => {
  try {
    const dims = await audienceService.getDimensionValues();
    res.json(success(dims));
  } catch (err) {
    next(err);
  }
});

// ─── 受众模板 CRUD ────────────────────────────────────────────────

// GET /api/v1/tasks/audience/templates — 获取所有已保存的模板
router.get('/audience/templates', authenticate, async (req, res, next) => {
  try {
    const list = await audienceService.listTemplates();
    res.json(success(list));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/tasks/audience/templates — 保存当前条件为模板
router.post('/audience/templates', authenticate, requireRole(['central', 'admin']), async (req, res, next) => {
  try {
    const template = await audienceService.saveTemplate(req.body, req.user.username);
    res.status(201).json(success(template));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/tasks/audience/templates/:id — 删除模板
router.delete('/audience/templates/:id', authenticate, requireRole(['central', 'admin']), async (req, res, next) => {
  try {
    const result = await audienceService.deleteTemplate(req.params.id);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/v1/tasks ────────────────────────────────────────────

router.get('/', authenticate, async (req, res, next) => {
  try {
    const list = await taskService.listTasks(req.user);
    res.json(success(list));
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/v1/tasks/:id ────────────────────────────────────────

router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const task = await taskService.getTaskDetail(req.params.id, req.user);
    res.json(success(task));
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/v1/tasks ───────────────────────────────────────────

router.post('/', authenticate, requireRole(['central', 'admin']), async (req, res, next) => {
  try {
    const task = await taskService.createTask(req.body, req.user.username);
    res.status(201).json(success(task));
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/v1/tasks/:id ──────────────────────────────────────

router.patch('/:id', authenticate, requireRole(['central', 'admin']), async (req, res, next) => {
  try {
    const task = await taskService.updateTask(req.params.id, req.body, req.user.username);
    res.json(success(task));
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/v1/tasks/:id/dispatch ──────────────────────────────

router.post('/:id/dispatch', authenticate, requireRole(['central', 'admin']), async (req, res, next) => {
  try {
    const result = await taskService.dispatchTask(req.params.id, req.user.username);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
