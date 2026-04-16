'use strict';

const express      = require('express');
const { db }       = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { createError } = require('../middleware/errorHandler');
const chatService  = require('../services/chatService');

const router = express.Router();

/** SQLite / JWT 下 user id 可能 number|string，避免 !== 误判无权 */
function sameChatUser(sessionUserId, reqUserId) {
  return Number(sessionUserId) === Number(reqUserId);
}

/** 校验会话归属权中间件 */
function requireSessionOwnership(req, res, next) {
  const { sessionId } = req.params;
  if (!sessionId) return next();
  const session = db.get('SELECT user_id FROM chat_sessions WHERE id = ?', [sessionId]);
  if (!session) return next(createError(404, '会话不存在', 'CHAT_003'));
  if (!sameChatUser(session.user_id, req.user.id)) return next(createError(403, '无权访问此会话', 'CHAT_004'));
  next();
}

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
  requireSessionOwnership,
  async (req, res, next) => {
    try {
      const { sessionId } = req.params;
      const { content } = req.body;

      if (!content || !content.trim()) {
        throw createError(400, 'content 不能为空', 'CHAT_005');
      }

      const result = await chatService.sendMessage(sessionId, content.trim(), req.user.id);
      res.json({ code: 200, message: 'success', data: result, requestId: req.requestId });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/chat/executive/sessions/:sessionId/messages/:messageId/feedback
// Submit feedback for an AI message.
router.post(
  '/executive/sessions/:sessionId/messages/:messageId/feedback',
  authenticate,
  requireRole(['executive']),
  requireSessionOwnership,
  (req, res, next) => {
    try {
      const { sessionId, messageId } = req.params;
      const { feedback } = req.body;

      if (!['like', 'dislike', 'none'].includes(feedback)) {
        throw createError(400, '无效的反馈类型', 'CHAT_006');
      }

      chatService.setMessageFeedback(sessionId, messageId, req.user.id, feedback);

      res.json({
        code: 200,
        message: 'success',
        data: {
          sessionId,
          messageId,
          userFeedback: feedback === 'none' ? null : feedback,
        },
        requestId: req.requestId,
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/chat/executive/sessions/:sessionId/messages/:messageId/regenerate
// Regenerate the last AI message.
router.post(
  '/executive/sessions/:sessionId/messages/:messageId/regenerate',
  authenticate,
  requireRole(['executive']),
  requireSessionOwnership,
  async (req, res, next) => {
    try {
      const { sessionId, messageId } = req.params;
      const result = await chatService.regenerateLastAssistant(sessionId, messageId, req.user.id);
      
      res.json({
        code: 200,
        message: 'success',
        data: result,
        requestId: req.requestId,
      });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/v1/chat/executive/sessions/:sessionId
// Removes session and all messages (ownership required).
router.delete(
  '/executive/sessions/:sessionId',
  authenticate,
  requireRole(['executive']),
  requireSessionOwnership,
  (req, res, next) => {
    try {
      const { sessionId } = req.params;
      chatService.deleteSessionById(sessionId);
      res.json({
        code: 200,
        message: '会话已删除',
        data: { sessionId },
        requestId: req.requestId,
      });
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
  requireSessionOwnership,
  (req, res, next) => {
    try {
      const { sessionId } = req.params;
      const pageNum  = Math.max(1, parseInt(req.query.pageNum, 10) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));

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
