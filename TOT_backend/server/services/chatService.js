'use strict';

const { nanoid }       = require('nanoid');
const { db, getDb }    = require('../db');
const { formatNowSqliteLocal } = require('../utils/ddlAt');
const logger = require('../utils/logger');
const { compressAssistantContent } = require('../utils/chatHistoryCompress');
const chatAgentRunner = require('./chatAgentRunner');
const { AGENT_MODE } = chatAgentRunner;
const chatSessionStateService = require('./chatSessionStateService');
const { writeSseHeaders, createSseSender } = require('../utils/sseResponse');

// ─── Region scope resolver ────────────────────────────────────────────────────
function resolveRegionScope(user) {
  if (user.executive_rtm) {
    return { type: 'rtm', rtm: user.executive_rtm, regions: null };
  }
  if (user.executive_regions) {
    try {
      const regions = JSON.parse(user.executive_regions);
      if (!Array.isArray(regions) || regions.length === 0) {
        throw Object.assign(new Error('executive_regions must be a non-empty array for regional scope'), { status: 400, code: 'AUTH_003' });
      }
      return { type: 'regional', regions, rtm: null };
    } catch (e) {
      if (e.code === 'AUTH_003') throw e;
    }
  }
  return { type: 'national', regions: null, rtm: null };
}

function parseSessionRegionsStored(regionsJson, sessionId = null) {
  if (!regionsJson) return null;
  try {
    return JSON.parse(regionsJson);
  } catch (e) {
    logger.warn('session_regions_parse_error', { sessionId, error: e.message });
    return null;
  }
}

function buildExampleQuestions() {
  const task = db.get("SELECT title FROM tasks WHERE status = 'dispatched' ORDER BY created_at DESC LIMIT 1");
  const taskRef = task ? `"${task.title}"` : '最近的';
  return [
    `${taskRef}培训完成率是多少？`,
    '有哪些门店需要重点关注？',
    '现在有哪些进行中的培训任务？',
  ];
}

// ─── createSession ────────────────────────────────────────────────────────────
function createSession(userId) {
  const user = db.get('SELECT id, executive_regions, executive_rtm FROM users WHERE id = ?', [userId]);
  if (!user) throw Object.assign(new Error('User not found'), { status: 404, code: 'CHAT_002' });

  const regionScope = resolveRegionScope(user);
  const sessionId = nanoid();
  const now = formatNowSqliteLocal();

  db.run(
    `INSERT INTO chat_sessions (id, user_id, role_scope, regions, rtm, created_at, last_active)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [sessionId, userId, regionScope.type, regionScope.regions ? JSON.stringify(regionScope.regions) : null, regionScope.rtm || null, now, now]
  );

  return { sessionId, contextId: sessionId, exampleQuestions: buildExampleQuestions() };
}

// ─── sendMessage (Non-stream) ──────────────────────────────────────────────────
async function sendMessage(sessionId, userMessage, userId) {
  const session = db.get('SELECT * FROM chat_sessions WHERE id = ?', [sessionId]);
  if (!session) throw Object.assign(new Error('Session not found'), { status: 404, code: 'CHAT_003' });
  if (Number(session.user_id) !== Number(userId)) throw Object.assign(new Error('Forbidden'), { status: 403, code: 'CHAT_004' });

  const regionScope = {
    type: session.role_scope,
    regions: parseSessionRegionsStored(session.regions, sessionId),
    rtm: session.rtm || null,
  };

  const historyRows = db.all(
    `SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 6`,
    [sessionId]
  ).reverse();

  const history = historyRows.map((r) => ({ role: r.role, content: compressAssistantContent(r.content) }));
  const startMs = Date.now();
  const result = await chatAgentRunner.run(userMessage, history, regionScope, { sessionId });
  const responseTime = Date.now() - startMs;

  const now = formatNowSqliteLocal();
  const userMsgId = nanoid();
  const assistMsgId = nanoid();
  const intentType = result._intentType || null;
  const toolMeta = result._toolMeta || {};

  logger.info('chat_turn', {
    sessionId, userId, intentType, agentMode: AGENT_MODE, responseTimeMs: responseTime,
    toolName: toolMeta.toolName, toolIterations: toolMeta.iterations, msgId: assistMsgId,
  });

  const finalContent = result.markdownContent || JSON.stringify(result);

  db.run('INSERT INTO chat_messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)', [userMsgId, sessionId, 'user', userMessage, now]);
  db.run('INSERT INTO chat_messages (id, session_id, role, content, intent_type, created_at) VALUES (?, ?, ?, ?, ?, ?)', [assistMsgId, sessionId, 'assistant', finalContent, intentType, now]);
  db.run('UPDATE chat_sessions SET last_active = ? WHERE id = ?', [now, sessionId]);

  return {
    messageId: assistMsgId,
    replyContent: result.markdownContent ? null : result,
    markdownContent: result.markdownContent || null,
    responseTime,
    contextId: sessionId,
    timestamp: now,
  };
}

// ─── sendMessageStream (SSE) ───────────────────────────────────────────────────
async function sendMessageStream(sessionId, userMessage, userId, req, res) {
  const session = db.get('SELECT * FROM chat_sessions WHERE id = ?', [sessionId]);
  if (!session) {
    res.status(404).json({ code: 404, message: '会话不存在', errorCode: 'CHAT_003', requestId: req.requestId });
    return;
  }
  if (Number(session.user_id) !== Number(userId)) {
    res.status(403).json({ code: 403, message: '无权访问此会话', errorCode: 'CHAT_004', requestId: req.requestId });
    return;
  }

  const regionScope = {
    type: session.role_scope,
    regions: parseSessionRegionsStored(session.regions, sessionId),
    rtm: session.rtm || null,
  };

  const historyRows = db.all(
    `SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 6`,
    [sessionId]
  ).reverse();

  const history = historyRows.map((r) => ({ role: r.role, content: compressAssistantContent(r.content) }));

  writeSseHeaders(res);
  const send = createSseSender(res);
  const abortController = new AbortController();
  
  // 联动客户端断开
  req.on('close', () => {
    abortController.abort();
  });

  const startMs = Date.now();
  let result;
  try {
    result = await chatAgentRunner.run(userMessage, history, regionScope, {
      sessionId,
      signal: abortController.signal,
      streamFormatCallbacks: {
        onDelta: (text, meta) => {
          send('delta', { text, phase: meta?.phase || 'content' });
        },
      },
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      logger.info('chat_stream_aborted', { sessionId });
      return;
    }
    send('error', { message: err.message || '处理失败', code: err.code || 'CHAT_500', status: err.status || 500 });
    res.end();
    return;
  }

  const responseTime = Date.now() - startMs;
  const now = formatNowSqliteLocal();
  const userMsgId = nanoid();
  const assistMsgId = nanoid();
  const finalContent = result.markdownContent || JSON.stringify(result);

  logger.info('chat_turn', {
    sessionId, userId, intentType: result._intentType, agentMode: AGENT_MODE, responseTimeMs: responseTime,
    toolName: result._toolMeta?.toolName, msgId: assistMsgId, stream: true,
  });

  db.run('INSERT INTO chat_messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)', [userMsgId, sessionId, 'user', userMessage, now]);
  db.run('INSERT INTO chat_messages (id, session_id, role, content, intent_type, created_at) VALUES (?, ?, ?, ?, ?, ?)', [assistMsgId, sessionId, 'assistant', finalContent, result._intentType, now]);
  db.run('UPDATE chat_sessions SET last_active = ? WHERE id = ?', [now, sessionId]);

  send('done', {
    code: 200,
    message: 'success',
    data: {
      messageId: assistMsgId,
      replyContent: result.markdownContent ? null : result,
      markdownContent: result.markdownContent || null,
      responseTime,
      contextId: sessionId,
      timestamp: now,
    },
    requestId: req.requestId,
  });
  res.end();
}

// ─── getHistory ───────────────────────────────────────────────────────────────
function getHistory(sessionId, pageNum, pageSize) {
  const offset = (pageNum - 1) * pageSize;
  const totalRow = db.get('SELECT COUNT(*) AS total FROM chat_messages WHERE session_id = ?', [sessionId]);
  const total = totalRow ? totalRow.total : 0;

  const rows = db.all(
    `SELECT cm.id, cm.role, cm.content, cm.intent_type, cm.created_at, cmf.feedback_type
     FROM chat_messages cm
     LEFT JOIN chat_message_feedback cmf ON cm.id = cmf.message_id AND cmf.user_id = (SELECT user_id FROM chat_sessions WHERE id = ?)
     WHERE cm.session_id = ?
     ORDER BY cm.created_at ASC, cm.rowid ASC LIMIT ? OFFSET ?`,
    [sessionId, sessionId, pageSize, offset]
  );

  const historyList = rows.map((r) => {
    let replyContent = null;
    if (r.role === 'assistant') {
      try {
        const parsed = JSON.parse(r.content);
        // 如果能解析且包含 legacy 核心字段，视为 replyContent
        if (parsed && typeof parsed === 'object' && (parsed.overview || parsed.keyNumbers)) {
          replyContent = parsed;
        }
      } catch (e) {
        replyContent = null;
      }
    }
    return {
      messageId: r.id,
      role: r.role,
      content: r.content, // assistant 始终返回原始内容 (Markdown)
      replyContent,
      intentType: r.intent_type,
      userFeedback: r.role === 'assistant' ? (r.feedback_type || null) : undefined,
      timestamp: r.created_at,
    };
  });

  return {
    historyList,
    pagination: { pageNum, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}

// ─── setMessageFeedback ───────────────────────────────────────────────────────
function setMessageFeedback(sessionId, messageId, userId, feedback) {
  const msg = db.get('SELECT id, role, session_id FROM chat_messages WHERE id = ?', [messageId]);
  if (!msg || msg.session_id !== sessionId) throw Object.assign(new Error('Message not found'), { status: 404, code: 'CHAT_007' });
  if (msg.role !== 'assistant') throw Object.assign(new Error('Can only provide feedback for assistant messages'), { status: 400, code: 'CHAT_006' });

  const now = formatNowSqliteLocal();
  if (feedback === 'none') {
    db.run('DELETE FROM chat_message_feedback WHERE message_id = ? AND user_id = ?', [messageId, userId]);
  } else if (feedback === 'like' || feedback === 'dislike') {
    db.run(
      `INSERT INTO chat_message_feedback (id, message_id, user_id, feedback_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(message_id, user_id) DO UPDATE SET feedback_type = excluded.feedback_type, updated_at = excluded.updated_at`,
      [nanoid(), messageId, userId, feedback, now, now]
    );
  } else {
    throw Object.assign(new Error('Invalid feedback type'), { status: 400, code: 'CHAT_006' });
  }
}

// ─── regenerateLastAssistant ──────────────────────────────────────────────────
async function regenerateLastAssistant(sessionId, messageId, userId) {
  const session = db.get('SELECT * FROM chat_sessions WHERE id = ?', [sessionId]);
  if (!session) throw Object.assign(new Error('Session not found'), { status: 404, code: 'CHAT_003' });

  const lastMsgRow = db.get('SELECT id, role FROM chat_messages WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1', [sessionId]);
  if (!lastMsgRow || lastMsgRow.id !== messageId || lastMsgRow.role !== 'assistant') {
    throw Object.assign(new Error('Can only regenerate the last assistant message'), { status: 400, code: 'CHAT_008' });
  }

  const historyRows = db.all(`SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 7`, [sessionId]).reverse();
  if (historyRows.length < 2) throw Object.assign(new Error('Not enough history to regenerate'), { status: 400, code: 'CHAT_008' });
  
  historyRows.pop(); // Remove assistant message being regenerated
  const userMessageRow = historyRows.pop();
  if (userMessageRow.role !== 'user') throw Object.assign(new Error('Expected user message before assistant message'), { status: 400, code: 'CHAT_008' });
  
  const history = historyRows.map((r) => ({ role: r.role, content: compressAssistantContent(r.content) }));
  const regionScope = { type: session.role_scope, regions: parseSessionRegionsStored(session.regions, sessionId), rtm: session.rtm || null };

  const startMs = Date.now();
  const result = await chatAgentRunner.run(userMessageRow.content, history, regionScope, { sessionId });
  const responseTime = Date.now() - startMs;
  const now = formatNowSqliteLocal();
  const newAssistMsgId = nanoid();
  const finalContent = result.markdownContent || JSON.stringify(result);

  logger.info('chat_turn', {
    sessionId, userId, intentType: result._intentType, agentMode: AGENT_MODE, responseTimeMs: responseTime,
    toolName: result._toolMeta?.toolName, msgId: newAssistMsgId,
  });

  db.run('INSERT INTO chat_messages (id, session_id, role, content, intent_type, created_at) VALUES (?, ?, ?, ?, ?, ?)', [newAssistMsgId, sessionId, 'assistant', finalContent, result._intentType, now]);
  db.run('UPDATE chat_sessions SET last_active = ? WHERE id = ?', [now, sessionId]);

  return {
    messageId: newAssistMsgId,
    replyContent: result.markdownContent ? null : result,
    markdownContent: result.markdownContent || null,
    responseTime,
    contextId: sessionId,
    timestamp: now,
  };
}

function deleteSessionById(sessionId) {
  const database = getDb();
  const runDelete = database.transaction(() => {
    database.prepare('DELETE FROM chat_message_feedback WHERE message_id IN (SELECT id FROM chat_messages WHERE session_id = ?)').run(sessionId);
    database.prepare('DELETE FROM chat_messages WHERE session_id = ?').run(sessionId);
    database.prepare('DELETE FROM chat_sessions WHERE id = ?').run(sessionId);
  });
  runDelete();
  chatSessionStateService.clearSession(sessionId);
}

module.exports = { createSession, sendMessage, sendMessageStream, getHistory, deleteSessionById, setMessageFeedback, regenerateLastAssistant };
