'use strict';

const { nanoid }       = require('nanoid');
const { db, getDb }    = require('../db');
const chatAgentRunner  = require('./chatAgentRunner');

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
      return { type: 'regional', regions, rtm: null };
    } catch {
      // Malformed JSON — fall through to national
    }
  }
  return { type: 'national', regions: null, rtm: null };
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
  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

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
    regions: session.regions ? JSON.parse(session.regions) : null,
    rtm: session.rtm || null,
  };

  // Load last 6 messages (3 rounds) for context
  const historyRows = db.all(
    `SELECT role, content FROM chat_messages
     WHERE session_id = ?
     ORDER BY created_at DESC LIMIT 6`,
    [sessionId]
  ).reverse(); // oldest first for LLM

  const history = historyRows.map((r) => ({ role: r.role, content: r.content }));

  const startMs = Date.now();

  // Call agent (async LLM calls happen inside)
  const replyContent = await chatAgentRunner.run(userMessage, history, regionScope);
  const responseTime = Date.now() - startMs;

  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  const userMsgId   = nanoid();
  const assistMsgId = nanoid();
  const intentType  = replyContent._intentType || null;
  delete replyContent._intentType; // don't leak internal field

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
    `SELECT id, role, content, intent_type, created_at
     FROM chat_messages
     WHERE session_id = ?
     ORDER BY created_at ASC
     LIMIT ? OFFSET ?`,
    [sessionId, pageSize, offset]
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

// ─── deleteSessionById ────────────────────────────────────────────────────────
/**
 * 硬删除：从 SQLite 中删除该会话及 `chat_messages` 中所有关联行（路由层需先校验归属）。
 * 使用 `getDb().transaction()` 与 better-sqlite3 官方用法一致，保证原子提交。
 * @param {string} sessionId
 */
function deleteSessionById(sessionId) {
  const database = getDb();
  const runDelete = database.transaction(() => {
    database.prepare('DELETE FROM chat_messages WHERE session_id = ?').run(sessionId);
    database.prepare('DELETE FROM chat_sessions WHERE id = ?').run(sessionId);
  });
  runDelete();
}

module.exports = { createSession, sendMessage, getHistory, deleteSessionById };
