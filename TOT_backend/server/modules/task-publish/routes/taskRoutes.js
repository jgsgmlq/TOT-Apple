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

const router = express.Router();

// ─── GET /api/v1/tasks ────────────────────────────────────────────

router.get('/', authenticate, (req, res, next) => {
  try {
    const list = taskService.listTasks(req.user);
    res.json(success(list));
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/v1/tasks/:id ────────────────────────────────────────

router.get('/:id', authenticate, (req, res, next) => {
  try {
    const task = taskService.getTaskDetail(req.params.id, req.user);
    res.json(success(task));
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/v1/tasks ───────────────────────────────────────────

router.post('/', authenticate, requireRole(['central', 'admin']), (req, res, next) => {
  try {
    const task = taskService.createTask(req.body, req.user.username);
    res.status(201).json(success(task));
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/v1/tasks/:id ──────────────────────────────────────

router.patch('/:id', authenticate, requireRole(['central', 'admin']), (req, res, next) => {
  try {
    const task = taskService.updateTask(req.params.id, req.body);
    res.json(success(task));
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/v1/tasks/:id/dispatch ──────────────────────────────

router.post('/:id/dispatch', authenticate, requireRole(['central', 'admin']), (req, res, next) => {
  try {
    const result = taskService.dispatchTask(req.params.id);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/v1/tasks/:id/revoke ────────────────────────────────

router.post('/:id/revoke', authenticate, requireRole(['central', 'admin']), (req, res, next) => {
  try {
    const result = taskService.revokeTask(req.params.id);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/v1/tasks/:id ─────────────────────────────────────

router.delete('/:id', authenticate, requireRole(['central', 'admin']), (req, res, next) => {
  try {
    const result = taskService.deleteTask(req.params.id);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
