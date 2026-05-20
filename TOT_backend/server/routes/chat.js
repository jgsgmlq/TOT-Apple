'use strict';

const express      = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { createError } = require('../middleware/errorHandler');
const chatService  = require('../services/chatService');
const chatCrud = require('../modules/dashboard/crud/chatCrud');

const router = express.Router();

/** MySQL account_id / JWT id 均为字符串，直接比较 */
function sameChatUser(sessionUserId, reqUserId) {
  if (!sessionUserId || !reqUserId) return false;
  return String(sessionUserId) === String(reqUserId);
}

/** 校验会话归属权中间件 */
async function requireSessionOwnership(req, res, next) {
  const { sessionId } = req.params;
  if (!sessionId) return next();
  try {
    const session = await chatCrud.getSession(sessionId);
    if (!session) return next(createError(404, '会话不存在', 'CHAT_003'));
    if (!sameChatUser(session.user_id, req.user.id)) return next(createError(403, '无权访问此会话', 'CHAT_004'));
    next();
  } catch (err) {
    next(err);
  }
}

// ─── 共享 handlers（Executive Chat 与总部看板机器人共用 chatService）────────────────

async function handleCreateSession(req, res, next) {
  try {
    const ip = req.headers['x-real-ip'] || req.ip || req.socket?.remoteAddress || null;
    const result = await chatService.createSession(req.user.id, req.user, ip);
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

    if (stream === true || stream === 'langgraph') {
      // 默认将前端的所有流式请求（前端传 stream: true）全部导向新版 LangGraph 引擎
      await chatService.sendMessageStreamLangGraph(sessionId, content.trim(), req.user.id, req, res);
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
    const { resumePayload, stream, threadId } = req.body;

    if (!resumePayload) {
      throw createError(400, 'resumePayload 不能为空', 'CHAT_006');
    }

    if (!threadId) {
      throw createError(400, 'threadId 不能为空（HITL 续接必需）', 'CHAT_010');
    }

    if (stream === true || stream === 'langgraph') {
      await chatService.resumeMessageStreamLangGraph(sessionId, resumePayload, threadId, req.user.id, req, res);
      return;
    }

    // 默认回退逻辑
    throw createError(400, '仅支持 LangGraph 模式下的流式 resume 操作', 'CHAT_007');
  } catch (err) {
    next(err);
  }
}

async function handleFeedback(req, res, next) {
  try {
    const { sessionId, messageId } = req.params;
    const { feedback } = req.body;

    if (!['like', 'dislike', 'none'].includes(feedback)) {
      throw createError(400, '无效的反馈类型', 'CHAT_006');
    }

    await chatService.setMessageFeedback(sessionId, messageId, req.user.id, feedback);

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

    // All regenerate requests go through LangGraph
    await chatService.regenerateLastAssistantStreamLangGraph(sessionId, messageId, req.user.id, req, res);
  } catch (err) {
    next(err);
  }
}

async function handleDeleteSession(req, res, next) {
  try {
    const { sessionId } = req.params;
    await chatService.deleteSessionById(sessionId);
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

async function handleHistory(req, res, next) {
  try {
    const { sessionId } = req.params;
    const pageNum  = Math.max(1, parseInt(req.query.pageNum, 10) || 1);
    const pageSize = Math.min(500, Math.max(1, parseInt(req.query.pageSize, 10) || 20));

    const data = await chatService.getHistory(sessionId, pageNum, pageSize);
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
mountChatRoutes('executive', ['executive', 'central', 'admin']);

// 总部端看板机器人：与 E-chat 同一套 chatService / 数据表，路径前缀为 dashboard
mountChatRoutes('dashboard', ['central', 'admin']);

module.exports = router;
