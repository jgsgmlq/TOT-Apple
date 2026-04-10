'use strict';

const express      = require('express');
const { db }       = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { createError } = require('../middleware/errorHandler');
const chatService  = require('../services/chatService');

const router = express.Router();

// POST /api/v1/chat/executive/sessions
// Creates a new chat session for the authenticated executive.
router.post(
  '/executive/sessions',
  authenticate,
  requireRole(['executive']),
  (req, res, next) => {
    try {
      const result = chatService.createSession(req.user.id);
      res.json({ code: 200, message: '会话创建成功', data: result, requestId: req.requestId });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/chat/executive/sessions/:sessionId/messages
// Sends a message and returns the agent's structured reply.
router.post(
  '/executive/sessions/:sessionId/messages',
  authenticate,
  requireRole(['executive']),
  async (req, res, next) => {
    try {
      const { sessionId } = req.params;
      const { content } = req.body;

      if (!content || !content.trim()) {
        throw createError(400, 'content 不能为空', 'CHAT_005');
      }

      // Ownership check: ensure session belongs to this user
      const session = db.get('SELECT user_id FROM chat_sessions WHERE id = ?', [sessionId]);
      if (!session) throw createError(404, '会话不存在', 'CHAT_003');
      if (session.user_id !== req.user.id) throw createError(403, '无权访问此会话', 'CHAT_004');

      const result = await chatService.sendMessage(sessionId, content.trim(), req.user.id);
      res.json({ code: 200, message: 'success', data: result, requestId: req.requestId });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/chat/executive/sessions/:sessionId/history
// Returns paginated chat message history.
router.get(
  '/executive/sessions/:sessionId/history',
  authenticate,
  requireRole(['executive']),
  (req, res, next) => {
    try {
      const { sessionId } = req.params;
      const pageNum  = Math.max(1, parseInt(req.query.pageNum, 10) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));

      // Ownership check
      const session = db.get('SELECT user_id FROM chat_sessions WHERE id = ?', [sessionId]);
      if (!session) throw createError(404, '会话不存在', 'CHAT_003');
      if (session.user_id !== req.user.id) throw createError(403, '无权访问此会话', 'CHAT_004');

      const data = chatService.getHistory(sessionId, pageNum, pageSize);
      res.json({
        code: 200, message: 'success',
        data: { sessionId, ...data },
        requestId: req.requestId,
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
