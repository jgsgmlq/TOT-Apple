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
/**
 * Read users.executive_regions / executive_rtm and resolve to a regionScope object.
 * NULL columns → national (MVP default: single account with full access).
 */
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
      // Malformed JSON — fall through to national
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

// ─── Dynamic example questions ────────────────────────────────────────────────
function buildExampleQuestions() {
  // Try to find the most recently created dispatched task for a contextual question
  const task = db.get(
    "SELECT title FROM tasks WHERE status = 'dispatched' ORDER BY created_at DESC LIMIT 1"
  );
  const taskRef = task ? `"${task.title}"` : '最近的';
  return [
    `${taskRef}培训完成率是多少？`,
    '有哪些门店需要重点关注？',
    '现在有哪些进行中的培训任务？',
  ];
}

// ─── createSession ────────────────────────────────────────────────────────────
/**
 * @param {number} userId  — req.user.id (JWT, integer)
 * @returns {{ sessionId: string, contextId: string, exampleQuestions: string[] }}
 */
function createSession(userId) {
  // Load user's executive scope columns
  const user = db.get(
    'SELECT id, executive_regions, executive_rtm FROM users WHERE id = ?',
    [userId]
  );
  if (!user) throw Object.assign(new Error('User not found'), { status: 404, code: 'CHAT_002' });

  const regionScope = resolveRegionScope(user);
  const sessionId = nanoid();
  const now = formatNowSqliteLocal();

  db.run(
    `INSERT INTO chat_sessions (id, user_id, role_scope, regions, rtm, created_at, last_active)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
      userId,
      regionScope.type,
      regionScope.regions ? JSON.stringify(regionScope.regions) : null,
      regionScope.rtm || null,
      now,
      now,
    ]
  );

  return {
    sessionId,
    contextId: sessionId,
    exampleQuestions: buildExampleQuestions(),
  };
}

// ─── sendMessage ──────────────────────────────────────────────────────────────
/**
 * @param {string} sessionId
 * @param {string} userMessage
 * @param {number} userId  — for ownership check
 * @returns {Promise<{ messageId, replyContent, responseTime, contextId, timestamp }>}
 */
async function sendMessage(sessionId, userMessage, userId) {
  // Ownership verified at route layer — double-check here for safety
  const session = db.get('SELECT * FROM chat_sessions WHERE id = ?', [sessionId]);
  if (!session) throw Object.assign(new Error('Session not found'), { status: 404, code: 'CHAT_003' });
  if (Number(session.user_id) !== Number(userId)) {
    throw Object.assign(new Error('Forbidden'), { status: 403, code: 'CHAT_004' });
  }

  // Restore regionScope from session row
  const regionScope = {
    type: session.role_scope,
    regions: parseSessionRegionsStored(session.regions, sessionId),
    rtm: session.rtm || null,
  };

  // Load last 6 messages (3 rounds) for context
  const historyRows = db.all(
    `SELECT role, content FROM chat_messages
     WHERE session_id = ?
     ORDER BY created_at DESC, rowid DESC LIMIT 6`,
    [sessionId]
  ).reverse(); // oldest first for LLM

  const history = historyRows.map((r) => {
    let content = r.content;
    if (r.role === 'assistant') {
      content = compressAssistantContent(r.content);
    }
    return { role: r.role, content };
  });

  const startMs = Date.now();

  // Call agent (async LLM calls happen inside)
  const replyContent = await chatAgentRunner.run(userMessage, history, regionScope, { sessionId });
  const responseTime = Date.now() - startMs;

  const now = formatNowSqliteLocal();
  const userMsgId   = nanoid();
  const assistMsgId = nanoid();
  const intentType  = replyContent._intentType || null;
  delete replyContent._intentType; // don't leak internal field

  const intentResolvedBy = replyContent._intentResolvedBy || null;
  delete replyContent._intentResolvedBy;

  const toolMeta = replyContent._toolMeta || {};
  delete replyContent._toolMeta;

  logger.info('chat_turn', {
    sessionId,
    userId,
    intentType,
    agentMode: AGENT_MODE,
    responseTimeMs: responseTime,
    toolName: toolMeta.toolName ?? null,
    toolCacheHit: toolMeta.cacheHit ?? null,
    toolSkipped: toolMeta.skipped === true,
    toolIterations: toolMeta.iterations || 0,
    msgId: assistMsgId,
  });

  // Persist both messages (synchronous)
  db.run(
    'INSERT INTO chat_messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
    [userMsgId, sessionId, 'user', userMessage, now]
  );
  db.run(
    'INSERT INTO chat_messages (id, session_id, role, content, intent_type, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [assistMsgId, sessionId, 'assistant', JSON.stringify(replyContent), intentType, now]
  );

  // Touch last_active
  db.run('UPDATE chat_sessions SET last_active = ? WHERE id = ?', [now, sessionId]);

  return {
    messageId:    assistMsgId,
    replyContent,
    responseTime,
    contextId:    sessionId,
    timestamp:    now,
  };
}

// ─── sendMessageStream（SSE，与看板智能洞察一致：delta / done / error）──────────
/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function sendMessageStream(sessionId, userMessage, userId, req, res) {
  const session = db.get('SELECT * FROM chat_sessions WHERE id = ?', [sessionId]);
  if (!session) {
    res.status(404).json({
      code: 404,
      message: '会话不存在',
      errorCode: 'CHAT_003',
      requestId: req.requestId,
    });
    return;
  }
  if (Number(session.user_id) !== Number(userId)) {
    res.status(403).json({
      code: 403,
      message: '无权访问此会话',
      errorCode: 'CHAT_004',
      requestId: req.requestId,
    });
    return;
  }

  const regionScope = {
    type: session.role_scope,
    regions: parseSessionRegionsStored(session.regions, sessionId),
    rtm: session.rtm || null,
  };

  const historyRows = db.all(
    `SELECT role, content FROM chat_messages
     WHERE session_id = ?
     ORDER BY created_at DESC, rowid DESC LIMIT 6`,
    [sessionId]
  ).reverse();

  const history = historyRows.map((r) => {
    let content = r.content;
    if (r.role === 'assistant') {
      content = compressAssistantContent(r.content);
    }
    return { role: r.role, content };
  });

  writeSseHeaders(res);
  const send = createSseSender(res);

  const startMs = Date.now();
  let replyContent;
  try {
    replyContent = await chatAgentRunner.run(userMessage, history, regionScope, {
      sessionId,
      streamFormatCallbacks: {
        onDelta: (text, meta) => {
          send('delta', {
            text,
            phase: meta && meta.phase ? meta.phase : 'content',
          });
        },
      },
    });
  } catch (err) {
    const code = err.code || 'CHAT_500';
    const status = err.status || 500;
    send('error', {
      message: err.message || 'Executive Chat 处理失败',
      code,
      status,
    });
    res.end();
    return;
  }

  const responseTime = Date.now() - startMs;
  const now = formatNowSqliteLocal();
  const userMsgId = nanoid();
  const assistMsgId = nanoid();
  const intentType = replyContent._intentType || null;
  delete replyContent._intentType;

  const intentResolvedBy = replyContent._intentResolvedBy || null;
  delete replyContent._intentResolvedBy;

  const toolMeta = replyContent._toolMeta || {};
  delete replyContent._toolMeta;

  logger.info('chat_turn', {
    sessionId,
    userId,
    intentType,
    agentMode: AGENT_MODE,
    responseTimeMs: responseTime,
    toolName: toolMeta.toolName ?? null,
    toolCacheHit: toolMeta.cacheHit ?? null,
    toolSkipped: toolMeta.skipped === true,
    toolIterations: toolMeta.iterations || 0,
    msgId: assistMsgId,
    stream: true,
  });

  db.run(
    'INSERT INTO chat_messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
    [userMsgId, sessionId, 'user', userMessage, now]
  );
  db.run(
    'INSERT INTO chat_messages (id, session_id, role, content, intent_type, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [assistMsgId, sessionId, 'assistant', JSON.stringify(replyContent), intentType, now]
  );
  db.run('UPDATE chat_sessions SET last_active = ? WHERE id = ?', [now, sessionId]);

  send('done', {
    code: 200,
    message: 'success',
    data: {
      messageId: assistMsgId,
      replyContent,
      responseTime,
      contextId: sessionId,
      timestamp: now,
    },
    requestId: req.requestId,
  });
  res.end();
}

// ─── getHistory ───────────────────────────────────────────────────────────────
/**
 * @param {string} sessionId
 * @param {number} pageNum   1-indexed
 * @param {number} pageSize
 * @returns {{ historyList, pagination }}
 */
function getHistory(sessionId, pageNum, pageSize) {
  const offset = (pageNum - 1) * pageSize;
  const totalRow = db.get(
    'SELECT COUNT(*) AS total FROM chat_messages WHERE session_id = ?',
    [sessionId]
  );
  const total = totalRow ? totalRow.total : 0;

  const rows = db.all(
    `SELECT cm.id, cm.role, cm.content, cm.intent_type, cm.created_at, cmf.feedback_type
     FROM chat_messages cm
     LEFT JOIN chat_message_feedback cmf ON cm.id = cmf.message_id AND cmf.user_id = (SELECT user_id FROM chat_sessions WHERE id = ?)
     WHERE cm.session_id = ?
     ORDER BY cm.created_at ASC, cm.rowid ASC
     LIMIT ? OFFSET ?`,
    [sessionId, sessionId, pageSize, offset]
  );

  const historyList = rows.map((r) => {
    const item = {
      messageId:    r.id,
      role:         r.role,
      content:      r.role === 'user' ? r.content : undefined,
      replyContent: r.role === 'assistant'
        ? (() => { try { return JSON.parse(r.content); } catch { return null; } })()
        : undefined,
      intentType:   r.intent_type,
      userFeedback: r.role === 'assistant' ? (r.feedback_type || null) : undefined,
      timestamp:    r.created_at,
    };
    return item;
  });

  return {
    historyList,
    pagination: {
      pageNum,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

// ─── setMessageFeedback ───────────────────────────────────────────────────────
/**
 * @param {string} sessionId
 * @param {string} messageId
 * @param {number} userId
 * @param {string} feedback  'like', 'dislike', or 'none'
 */
function setMessageFeedback(sessionId, messageId, userId, feedback) {
  const msg = db.get(
    'SELECT id, role, session_id FROM chat_messages WHERE id = ?',
    [messageId]
  );
  if (!msg) {
    throw Object.assign(new Error('Message not found'), { status: 404, code: 'CHAT_007' });
  }
  if (msg.session_id !== sessionId) {
    throw Object.assign(new Error('Message not found in session'), { status: 404, code: 'CHAT_007' });
  }
  if (msg.role !== 'assistant') {
    throw Object.assign(new Error('Can only provide feedback for assistant messages'), { status: 400, code: 'CHAT_006' });
  }

  const now = formatNowSqliteLocal();

  if (feedback === 'none') {
    db.run(
      'DELETE FROM chat_message_feedback WHERE message_id = ? AND user_id = ?',
      [messageId, userId]
    );
  } else if (feedback === 'like' || feedback === 'dislike') {
    db.run(
      `INSERT INTO chat_message_feedback (id, message_id, user_id, feedback_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(message_id, user_id) DO UPDATE SET
       feedback_type = excluded.feedback_type,
       updated_at = excluded.updated_at`,
      [nanoid(), messageId, userId, feedback, now, now]
    );
  } else {
    throw Object.assign(new Error('Invalid feedback type'), { status: 400, code: 'CHAT_006' });
  }
}

// ─── regenerateLastAssistant ──────────────────────────────────────────────────
/**
 * @param {string} sessionId
 * @param {string} messageId
 * @param {number} userId
 */
async function regenerateLastAssistant(sessionId, messageId, userId) {
  const session = db.get('SELECT * FROM chat_sessions WHERE id = ?', [sessionId]);
  if (!session) throw Object.assign(new Error('Session not found'), { status: 404, code: 'CHAT_003' });
// Get the last assistant message
  const lastMsgRow = db.get(
    'SELECT id, role FROM chat_messages WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
    [sessionId]
  );
  
  if (!lastMsgRow || lastMsgRow.id !== messageId || lastMsgRow.role !== 'assistant') {
    throw Object.assign(new Error('Can only regenerate the last assistant message'), { status: 400, code: 'CHAT_008' });
  }

// To regenerate, we need the history *before* this assistant message
// and the user message that prompted it. We'll just fetch the last 7 messages,
// skip the last one (the assistant message being regenerated),
// and the new last message should be the user message.
  const historyRows = db.all(
    `SELECT role, content FROM chat_messages
     WHERE session_id = ?
     ORDER BY created_at DESC, rowid DESC LIMIT 7`,
    [sessionId]
  ).reverse();

  if (historyRows.length < 2) {
    throw Object.assign(new Error('Not enough history to regenerate'), { status: 400, code: 'CHAT_008' });
  }
  
  // The last item in historyRows is the assistant message being regenerated.
  historyRows.pop();
  
  // The new last item is the user's prompt.
  const userMessageRow = historyRows.pop();
  if (userMessageRow.role !== 'user') {
      throw Object.assign(new Error('Expected user message before assistant message'), { status: 400, code: 'CHAT_008' });
  }
  
  const userMessage = userMessageRow.content;
  
  // What remains in historyRows is the context history
  const history = historyRows.map((r) => {
    let content = r.content;
    if (r.role === 'assistant') {
      content = compressAssistantContent(r.content);
    }
    return { role: r.role, content };
  });
  
  const regionScope = {
    type: session.role_scope,
    regions: parseSessionRegionsStored(session.regions, sessionId),
    rtm: session.rtm || null,
  };

  const startMs = Date.now();
  const replyContent = await chatAgentRunner.run(userMessage, history, regionScope, { sessionId });
  const responseTime = Date.now() - startMs;

  const now = formatNowSqliteLocal();
  const newAssistMsgId = nanoid();
  const intentType = replyContent._intentType || null;
  delete replyContent._intentType;

  const intentResolvedBy = replyContent._intentResolvedBy || null;
  delete replyContent._intentResolvedBy;

  const toolMeta = replyContent._toolMeta || {};
  delete replyContent._toolMeta;

  logger.info('chat_turn', {
    sessionId,
    userId,
    intentType,
    agentMode: AGENT_MODE,
    responseTimeMs: responseTime,
    toolName: toolMeta.toolName ?? null,
    toolCacheHit: toolMeta.cacheHit ?? null,
    toolSkipped: toolMeta.skipped === true,
    toolIterations: toolMeta.iterations || 0,
    msgId: newAssistMsgId,
  });

  db.run(
    'INSERT INTO chat_messages (id, session_id, role, content, intent_type, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [newAssistMsgId, sessionId, 'assistant', JSON.stringify(replyContent), intentType, now]
  );
  
  db.run('UPDATE chat_sessions SET last_active = ? WHERE id = ?', [now, sessionId]);

  return {
    messageId:    newAssistMsgId,
    replyContent,
    responseTime,
    contextId:    sessionId,
    timestamp:    now,
  };
}

// ─── deleteSessionById ────────────────────────────────────────────────────────
/**
 * 硬删除：从 SQLite 中删除该会话及 `chat_messages` 中所有关联行（路由层需先校验归属）。
 * 使用 `getDb().transaction()` 与 better-sqlite3 官方用法一致，保证原子提交。
 * @param {string} sessionId
 */
function deleteSessionById(sessionId) {
  const database = getDb();
  const runDelete = database.transaction(() => {
    // Delete feedback for messages in this session
    database.prepare(`
      DELETE FROM chat_message_feedback
      WHERE message_id IN (SELECT id FROM chat_messages WHERE session_id = ?)
    `).run(sessionId);
    database.prepare('DELETE FROM chat_messages WHERE session_id = ?').run(sessionId);
    database.prepare('DELETE FROM chat_sessions WHERE id = ?').run(sessionId);
  });
  runDelete();
  chatSessionStateService.clearSession(sessionId);
}

module.exports = {
  createSession,
  sendMessage,
  sendMessageStream,
  getHistory,
  deleteSessionById,
  setMessageFeedback,
  regenerateLastAssistant,
};
