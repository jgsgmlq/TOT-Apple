'use strict';

const { nanoid }       = require('nanoid');
const { db, getDb }    = require('../db');
const { formatNowSqliteLocal } = require('../utils/ddlAt');
const logger = require('../utils/logger');
const { compressAssistantContent } = require('../utils/chatHistoryCompress');
const chatAgentRunner = require('./chatAgentRunner');
const { AGENT_MODE } = chatAgentRunner;
const chatSessionStateService = require('./chatSessionStateService');
const chatMemoryService = require('./chatMemoryService');
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

/**
 * Executive Chat 非流式 API（sendMessage / regenerate）返回体：只暴露前端契约字段，避免 `_toolMeta` 等混入 `res.json` 异常。
 */
function buildExecutiveMessageApiData(result) {
  const md =
    typeof result.markdownContent === 'string' && result.markdownContent.trim() !== ''
      ? result.markdownContent.trim()
      : null;
  if (md) {
    return { replyContent: null, markdownContent: md };
  }
  return {
    replyContent: {
      overview: typeof result.overview === 'string' ? result.overview : '',
      keyNumbers: Array.isArray(result.keyNumbers) ? result.keyNumbers : [],
      attentionPoints: Array.isArray(result.attentionPoints) ? result.attentionPoints : [],
      followUpSuggestions: Array.isArray(result.followUpSuggestions) ? result.followUpSuggestions : [],
      ...(Array.isArray(result.visualizations) ? { visualizations: result.visualizations } : {}),
      ...(result.statisticsProvenance && typeof result.statisticsProvenance === 'object'
        ? { statisticsProvenance: result.statisticsProvenance }
        : {}),
      ...(typeof result.forecastDisclaimer === 'string'
        ? { forecastDisclaimer: result.forecastDisclaimer }
        : {}),
    },
    markdownContent: null,
  };
}

/** 写入 chat_messages.content：优先 Markdown；否则 JSON；避免 stringify 循环引用等导致 500 / NOT NULL */
function storageContentFromAgentResult(result) {
  if (!result || typeof result !== 'object') {
    logger.warn('agent_result_invalid', { type: typeof result });
    return JSON.stringify({
      overview: '（无有效回复，请重试）',
      keyNumbers: [],
      attentionPoints: [],
      followUpSuggestions: [],
    });
  }
  if (typeof result.markdownContent === 'string' && result.markdownContent.trim() !== '') {
    return result.markdownContent;
  }
  try {
    return JSON.stringify(result);
  } catch (e) {
    logger.warn('agent_result_stringify_failed', { error: e.message });
    const overview =
      typeof result.overview === 'string' && result.overview.trim()
        ? result.overview
        : '（回答存储异常）请重试。';
    return JSON.stringify({
      overview,
      keyNumbers: Array.isArray(result.keyNumbers) ? result.keyNumbers : [],
      attentionPoints: Array.isArray(result.attentionPoints) ? result.attentionPoints : [],
      followUpSuggestions: Array.isArray(result.followUpSuggestions) ? result.followUpSuggestions : [],
    });
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

async function handleIncomingMessage(sessionId, userMessage, userId, reqBody = {}) {
  const { clarificationResponse, messageId } = reqBody;
  const now = formatNowSqliteLocal();

  // 1. 幂等检查
  if (messageId) {
    const existing = db.get('SELECT id FROM chat_messages WHERE client_message_id = ?', [messageId]);
    if (existing) {
      const err = new Error('Duplicate messageId');
      err.status = 409;
      err.code = 'CHAT_009';
      throw err;
    }
  }

  if (clarificationResponse && clarificationResponse.toolCallId) {
    // Phase 1.2: 如果是针对歧义的选择，插入一条 tool 角色消息
    // 注意：为了保持 FC 序列连贯，我们先插入 Tool 消息，再插入用于前端展示的 User 消息
    const toolMsgId = nanoid();
    db.run(
      'INSERT INTO chat_messages (id, session_id, role, content, tool_call_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [toolMsgId, sessionId, 'tool', JSON.stringify(clarificationResponse.result), clarificationResponse.toolCallId, now]
    );
    
    // 此时 userMessage 是用户的点击文本（用于展示），关联 client_message_id
    const userMsgId = nanoid();
    db.run(
      'INSERT INTO chat_messages (id, session_id, role, content, client_message_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', 
      [userMsgId, sessionId, 'user', userMessage, messageId || null, now]
    );
    return true; 
  }

  // 普通消息
  const userMsgId = nanoid();
  db.run(
    'INSERT INTO chat_messages (id, session_id, role, content, client_message_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', 
    [userMsgId, sessionId, 'user', userMessage, messageId || null, now]
  );
  return false;
}

/** 辅助：从数据库加载并格式化历史记录，传给 Agent 引擎 */
function loadFormattedHistory(sessionId) {
  const rows = db.all(
    `SELECT role, content, tool_calls, tool_call_id, client_message_id FROM chat_messages 
     WHERE session_id = ? 
     ORDER BY created_at ASC, rowid ASC LIMIT 10`,
    [sessionId]
  );
  return rows.map(r => ({
    role: r.role,
    content: r.role === 'assistant' ? compressAssistantContent(r.content) : r.content,
    tool_calls: r.tool_calls ? JSON.parse(r.tool_calls) : undefined,
    tool_call_id: r.tool_call_id || undefined,
    client_message_id: r.client_message_id || undefined
  }));
}

// ─── sendMessage (Non-stream) ──────────────────────────────────────────────────
async function sendMessage(sessionId, userMessage, userId, reqBody = {}) {
  const session = db.get('SELECT * FROM chat_sessions WHERE id = ?', [sessionId]);
  if (!session) throw Object.assign(new Error('Session not found'), { status: 404, code: 'CHAT_003' });
  if (Number(session.user_id) !== Number(userId)) throw Object.assign(new Error('Forbidden'), { status: 403, code: 'CHAT_004' });

  await handleIncomingMessage(sessionId, userMessage, userId, reqBody);

  const regionScope = {
    type: session.role_scope,
    regions: parseSessionRegionsStored(session.regions, sessionId),
    rtm: session.rtm || null,
  };

  const history = loadFormattedHistory(sessionId);
  const startMs = Date.now();
  const result = await chatAgentRunner.run(userMessage, history, regionScope, { sessionId, userId: session.user_id });
  const responseTime = Date.now() - startMs;

  const now = formatNowSqliteLocal();
  const assistMsgId = nanoid();
  const finalContent = storageContentFromAgentResult(result);
  const toolCallsStr = result._toolMeta?.toolCalls ? JSON.stringify(result._toolMeta.toolCalls) : null;

  db.run(
    'INSERT INTO chat_messages (id, session_id, role, content, intent_type, tool_calls, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', 
    [assistMsgId, sessionId, 'assistant', finalContent, result._intentType || null, toolCallsStr, now]
  );
  db.run('UPDATE chat_sessions SET last_active = ? WHERE id = ?', [now, sessionId]);

  // 异步提取记忆
  setImmediate(() => {
    chatMemoryService.extract(sessionId).catch(e => logger.warn('memory_extract_error', { sessionId, error: e.message }));
  });

  return {
    messageId: assistMsgId,
    ...buildExecutiveMessageApiData(result),
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

  await handleIncomingMessage(sessionId, userMessage, userId, req.body);

  const regionScope = {
    type: session.role_scope,
    regions: parseSessionRegionsStored(session.regions, sessionId),
    rtm: session.rtm || null,
  };

  const history = loadFormattedHistory(sessionId);

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
      userId: session.user_id,
      signal: abortController.signal,
      streamFormatCallbacks: {
        onDelta: (text, meta) => {
          send('delta', { 
            text, 
            phase: meta?.phase || 'content',
            reasoningLevel: meta?.reasoningLevel || undefined 
          });
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
  const assistMsgId = nanoid();
  const finalContent = storageContentFromAgentResult(result);
  const toolCallsStr = result._toolMeta?.toolCalls ? JSON.stringify(result._toolMeta.toolCalls) : null;

  logger.info('chat_turn', {
    sessionId, userId, intentType: result._intentType, agentMode: AGENT_MODE, responseTimeMs: responseTime,
    toolName: result._toolMeta?.toolName, msgId: assistMsgId, stream: true,
  });

  db.run(
    'INSERT INTO chat_messages (id, session_id, role, content, intent_type, tool_calls, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', 
    [assistMsgId, sessionId, 'assistant', finalContent, result._intentType, toolCallsStr, now]
  );
  db.run('UPDATE chat_sessions SET last_active = ? WHERE id = ?', [now, sessionId]);

  // 异步提取记忆
  setImmediate(() => {
    chatMemoryService.extract(sessionId).catch(e => logger.warn('memory_extract_error', { sessionId, error: e.message }));
  });

  send('done', {
    code: 200,
    message: 'success',
    data: {
      messageId: assistMsgId,
      ...buildExecutiveMessageApiData(result),
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

// ─── regenerateLastAssistantStream ────────────────────────────────────────────
async function regenerateLastAssistantStream(sessionId, messageId, userId, req, res) {
  const session = db.get('SELECT * FROM chat_sessions WHERE id = ?', [sessionId]);
  if (!session) {
    res.status(404).json({ code: 404, message: 'Session not found', errorCode: 'CHAT_003' });
    return;
  }
  if (Number(session.user_id) !== Number(userId)) {
    res.status(403).json({ code: 403, message: 'Forbidden', errorCode: 'CHAT_004' });
    return;
  }

  const lastMsgRow = db.get('SELECT id, role FROM chat_messages WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1', [sessionId]);
  if (!lastMsgRow || lastMsgRow.id !== messageId || lastMsgRow.role !== 'assistant') {
    res.status(400).json({ code: 400, message: 'Can only regenerate the last assistant message', errorCode: 'CHAT_008' });
    return;
  }

  const chronological = loadFormattedHistory(sessionId);
  if (chronological.length < 2) {
    res.status(400).json({ code: 400, message: 'Not enough history to regenerate', errorCode: 'CHAT_008' });
    return;
  }
  
  const lastTurn = chronological[chronological.length - 1];
  const prevTurn = chronological[chronological.length - 2];
  if (lastTurn.role !== 'assistant' || prevTurn.role !== 'user') {
    res.status(400).json({ code: 400, message: 'Expected user message before assistant message', errorCode: 'CHAT_008' });
    return;
  }
  
  const userPrompt = typeof prevTurn.content === 'string' ? prevTurn.content : '';
  if (!userPrompt.trim()) {
    res.status(400).json({ code: 400, message: 'User message is empty', errorCode: 'CHAT_008' });
    return;
  }

  const prior = chronological.slice(0, -2);
  const history = prior
    .filter((m) => m.role !== 'tool')
    .map((m) => ({
      role: m.role,
      content: m.role === 'assistant' ? compressAssistantContent(m.content) : (m.content ?? ''),
    }));

  const regionScope = { type: session.role_scope, regions: parseSessionRegionsStored(session.regions, sessionId), rtm: session.rtm || null };

  writeSseHeaders(res);
  const send = createSseSender(res);
  const abortController = new AbortController();

  req.on('close', () => {
    logger.info('client_aborted_stream_regenerate', { sessionId });
    abortController.abort();
  });

  const onDelta = (chunk, meta) => {
    send('message', {
      type: meta?.phase === 'reasoning' ? 'reasoning' : 'content',
      content: chunk,
      reasoningLevel: meta?.reasoningLevel,
    });
  };

  const startMs = Date.now();
  let result;
  try {
    result = await chatAgentRunner.run(userPrompt, history, regionScope, {
      sessionId,
      userId,
      signal: abortController.signal,
      streamFormatCallbacks: {
        onDelta: (text, meta) => {
          send('delta', { 
            text, 
            phase: meta?.phase || 'content',
            reasoningLevel: meta?.reasoningLevel || undefined 
          });
        },
      },
    });

    const responseTime = Date.now() - startMs;
    const now = formatNowSqliteLocal();
    const newAssistMsgId = nanoid();
    const finalContent = storageContentFromAgentResult(result);

    db.transaction(() => {
      db.run('DELETE FROM chat_message_feedback WHERE message_id = ?', [messageId]);
      db.run('DELETE FROM chat_messages WHERE id = ? AND session_id = ?', [messageId, sessionId]);
      db.run(
        'INSERT INTO chat_messages (id, session_id, role, content, intent_type, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [newAssistMsgId, sessionId, 'assistant', finalContent, result._intentType ?? null, now]
      );
      db.run('UPDATE chat_sessions SET last_active = ? WHERE id = ?', [now, sessionId]);
    });

    logger.info('chat_turn_regenerate_stream', {
      sessionId, userId, intentType: result._intentType, responseTimeMs: responseTime, msgId: newAssistMsgId,
    });

    const payload = buildExecutiveMessageApiData(result);

    send('done', {
      messageId: newAssistMsgId,
      intentType: result._intentType,
      replyContent: payload.replyContent,
      markdownContent: payload.markdownContent,
      toolData: result.toolData,
      suggestions: result.followUpSuggestions,
      _debug: result._debug,
    });
    res.end();
  } catch (err) {
    if (err.name === 'AbortError') {
      logger.info('chat_stream_regenerate_aborted', { sessionId });
      return;
    }
    logger.error('regenerate_agent_stream_failed', { sessionId, error: err.message, stack: err.stack });
    send('error', { message: err.message || '处理失败', code: err.code || 'CHAT_500', status: err.status || 500 });
    res.end();
  }
}

// ─── regenerateLastAssistant ──────────────────────────────────────────────────
async function regenerateLastAssistant(sessionId, messageId, userId) {
  const session = db.get('SELECT * FROM chat_sessions WHERE id = ?', [sessionId]);
  if (!session) throw Object.assign(new Error('Session not found'), { status: 404, code: 'CHAT_003' });
  if (Number(session.user_id) !== Number(userId)) {
    throw Object.assign(new Error('Forbidden'), { status: 403, code: 'CHAT_004' });
  }

  const lastMsgRow = db.get('SELECT id, role FROM chat_messages WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1', [sessionId]);
  if (!lastMsgRow || lastMsgRow.id !== messageId || lastMsgRow.role !== 'assistant') {
    throw Object.assign(new Error('Can only regenerate the last assistant message'), { status: 400, code: 'CHAT_008' });
  }

  // 与 sendMessageStream 一致：全量 ASC 历史（含 tool 行），再截取待重算的一轮 user+assistant
  const chronological = loadFormattedHistory(sessionId);
  if (chronological.length < 2) {
    throw Object.assign(new Error('Not enough history to regenerate'), { status: 400, code: 'CHAT_008' });
  }
  const lastTurn = chronological[chronological.length - 1];
  const prevTurn = chronological[chronological.length - 2];
  if (lastTurn.role !== 'assistant' || prevTurn.role !== 'user') {
    throw Object.assign(new Error('Expected user message before assistant message'), { status: 400, code: 'CHAT_008' });
  }
  const userPrompt = typeof prevTurn.content === 'string' ? prevTurn.content : '';
  if (!userPrompt.trim()) {
    throw Object.assign(new Error('User message is empty'), { status: 400, code: 'CHAT_008' });
  }

  const prior = chronological.slice(0, -2);
  // DeepSeek/OpenAI 要求 tool 角色消息携带 tool_call_id；runFunctionCalling 仅转发 content，会触发 400。
  // 歧义澄清等场景下库内可能存在 tool 行，这里在重生成上下文中省略（保留 user/assistant 与压缩后的正文）。
  const history = prior
    .filter((m) => m.role !== 'tool')
    .map((m) => ({
      role: m.role,
      content:
        m.role === 'assistant' ? compressAssistantContent(m.content) : (m.content ?? ''),
    }));

  const regionScope = { type: session.role_scope, regions: parseSessionRegionsStored(session.regions, sessionId), rtm: session.rtm || null };

  const startMs = Date.now();
  let result;
  try {
    result = await chatAgentRunner.run(userPrompt, history, regionScope, { sessionId });
  } catch (err) {
    logger.error('regenerate_agent_failed', {
      sessionId,
      messageId,
      error: err.message,
      stack: err.stack,
    });
    throw err;
  }
  const responseTime = Date.now() - startMs;
  const now = formatNowSqliteLocal();
  const newAssistMsgId = nanoid();
  const finalContent = storageContentFromAgentResult(result);

  logger.info('chat_turn', {
    sessionId, userId, intentType: result._intentType, agentMode: AGENT_MODE, responseTimeMs: responseTime,
    toolName: result._toolMeta?.toolName, msgId: newAssistMsgId,
  });

  // 替换最后一条 assistant：先删旧消息（及反馈），再插入新行，避免多次「重新生成」堆叠多条 assistant 导致 pop 错位与 500
  db.transaction(() => {
    db.run('DELETE FROM chat_message_feedback WHERE message_id = ?', [messageId]);
    const del = db.run('DELETE FROM chat_messages WHERE id = ? AND session_id = ?', [messageId, sessionId]);
    if (!del.changes) {
      throw Object.assign(new Error('Message not found'), { status: 404, code: 'CHAT_007' });
    }
    db.run(
      'INSERT INTO chat_messages (id, session_id, role, content, intent_type, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [newAssistMsgId, sessionId, 'assistant', finalContent, result._intentType ?? null, now]
    );
    db.run('UPDATE chat_sessions SET last_active = ? WHERE id = ?', [now, sessionId]);
  });

  const payload = buildExecutiveMessageApiData(result);
  return {
    messageId: newAssistMsgId,
    replyContent: payload.replyContent,
    markdownContent: payload.markdownContent,
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

module.exports = { createSession, sendMessage, sendMessageStream, getHistory, deleteSessionById, setMessageFeedback, regenerateLastAssistant, regenerateLastAssistantStream };
