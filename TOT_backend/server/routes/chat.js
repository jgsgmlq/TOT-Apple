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

// ─── 共享 handlers（Executive Chat 与总部看板机器人共用 chatService）────────────────

function handleCreateSession(req, res, next) {
  try {
    const result = chatService.createSession(req.user.id);
    res.json({ code: 200, message: '会话创建成功', data: result, requestId: req.requestId });
  } catch (err) {
    next(err);
  }
}

async function handlePostMessage(req, res, next) {
  try {
    const { sessionId } = req.params;
    const { content, stream } = req.body;

    if (!content || !content.trim()) {
      throw createError(400, 'content 不能为空', 'CHAT_005');
    }

    if (stream === 'langgraph') {
      await chatService.sendMessageStreamLangGraph(sessionId, content.trim(), req.user.id, req, res);
      return;
    }

    if (stream === true) {
      await chatService.sendMessageStream(sessionId, content.trim(), req.user.id, req, res);
      return;
    }

    const result = await chatService.sendMessage(sessionId, content.trim(), req.user.id, req);
    res.json({ code: 200, message: 'success', data: result, requestId: req.requestId });
  } catch (err) {
    next(err);
  }
}

async function handleResume(req, res, next) {
  try {
    const { sessionId } = req.params;
    const { resumePayload, stream } = req.body;

    if (!resumePayload) {
      throw createError(400, 'resumePayload 不能为空', 'CHAT_006');
    }

    if (stream === 'langgraph') {
      await chatService.resumeMessageStreamLangGraph(sessionId, resumePayload, req.user.id, req, res);
      return;
    }

    // 默认回退逻辑
    throw createError(400, '仅支持 LangGraph 模式下的流式 resume 操作', 'CHAT_007');
  } catch (err) {
    next(err);
  }
}

function handleFeedback(req, res, next) {
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

async function handleRegenerate(req, res, next) {
  try {
    const { sessionId, messageId } = req.params;
    const { stream } = req.body;

    if (stream === true) {
      await chatService.regenerateLastAssistantStream(sessionId, messageId, req.user.id, req, res);
      return;
    }

    const result = await chatService.regenerateLastAssistant(sessionId, messageId, req.user.id, req);

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

function handleDeleteSession(req, res, next) {
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

function handleHistory(req, res, next) {
  try {
    const { sessionId } = req.params;
    const pageNum  = Math.max(1, parseInt(req.query.pageNum, 10) || 1);
    const pageSize = Math.min(500, Math.max(1, parseInt(req.query.pageSize, 10) || 20));

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

/**
 * @param {string} prefix  如 `executive` 或 `dashboard`
 * @param {string[]} roles  允许的角色
 */
function mountChatRoutes(prefix, roles) {
  const base = `/${prefix}/sessions`;

  router.post(
    base,
    authenticate,
    requireRole(roles),
    handleCreateSession
  );

  router.post(
    `${base}/:sessionId/messages`,
    authenticate,
    requireRole(roles),
    requireSessionOwnership,
    handlePostMessage
  );

  router.post(
    `${base}/:sessionId/resume`,
    authenticate,
    requireRole(roles),
    requireSessionOwnership,
    handleResume
  );

  router.post(
    `${base}/:sessionId/messages/:messageId/feedback`,
    authenticate,
    requireRole(roles),
    requireSessionOwnership,
    handleFeedback
  );

  router.post(
    `${base}/:sessionId/messages/:messageId/regenerate`,
    authenticate,
    requireRole(roles),
    requireSessionOwnership,
    handleRegenerate
  );

  router.delete(
    `${base}/:sessionId`,
    authenticate,
    requireRole(roles),
    requireSessionOwnership,
    handleDeleteSession
  );

  router.get(
    `${base}/:sessionId/history`,
    authenticate,
    requireRole(roles),
    requireSessionOwnership,
    handleHistory
  );
}

// Executive Chat（区域/高管）
mountChatRoutes('executive', ['executive']);

// 总部端看板机器人：与 E-chat 同一套 chatService / 数据表，路径前缀为 dashboard
mountChatRoutes('dashboard', ['central', 'admin']);

module.exports = router;
