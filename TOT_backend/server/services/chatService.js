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
const { createAgentTrace, endSpan, maskPII, preview } = require('../utils/tracer');
const { buildGraph } = require('../agent/graph/graph');
const { SqliteSaver } = require('@langchain/langgraph-checkpoint-sqlite');
const Database = require('better-sqlite3');
const path = require('path');
const { Langfuse } = require('langfuse');

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

async function handleIncomingMessage(sessionId, userMessage, userId, reqBody = {}, trace = null) {
  const { clarificationResponse, messageId } = reqBody;
  const now = formatNowSqliteLocal();
  const persistSpan = trace && typeof trace.span === 'function'
    ? trace.span({
        name: 'Persist_User_Message',
        input: { sessionId, hasClarification: !!clarificationResponse, hasMessageId: !!messageId },
      })
    : null;
  const t0 = Date.now();

  try {
    // 1. 幂等检查
    if (messageId) {
      const existing = db.get('SELECT id FROM chat_messages WHERE client_message_id = ?', [messageId]);
      if (existing) {
        const err = new Error('Duplicate messageId');
        err.status = 409;
        err.code = 'CHAT_009';
        endSpan(persistSpan, {
          output: 'duplicate',
          level: 'WARNING',
          metadata: { status: 'duplicate', durationMs: Date.now() - t0 },
        });
        throw err;
      }
    }

    if (clarificationResponse && clarificationResponse.toolCallId) {
      // Phase 1.2: 先插入 tool 消息，再插入用于展示的 user 消息，保持 FC 序列连贯
      const toolMsgId = nanoid();
      db.run(
        'INSERT INTO chat_messages (id, session_id, role, content, tool_call_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [toolMsgId, sessionId, 'tool', JSON.stringify(clarificationResponse.result), clarificationResponse.toolCallId, now]
      );

      const userMsgId = nanoid();
      db.run(
        'INSERT INTO chat_messages (id, session_id, role, content, client_message_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [userMsgId, sessionId, 'user', userMessage, messageId || null, now]
      );
      endSpan(persistSpan, {
        output: 'clarify_turn',
        metadata: { status: 'ok', wroteRows: 2, kind: 'clarification', durationMs: Date.now() - t0 },
      });
      return true;
    }

    // 普通消息
    const userMsgId = nanoid();
    db.run(
      'INSERT INTO chat_messages (id, session_id, role, content, client_message_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [userMsgId, sessionId, 'user', userMessage, messageId || null, now]
    );
    endSpan(persistSpan, {
      output: 'ok',
      metadata: { status: 'ok', wroteRows: 1, kind: 'user', durationMs: Date.now() - t0 },
    });
    return false;
  } catch (err) {
    if (err.code !== 'CHAT_009') {
      endSpan(persistSpan, {
        output: null,
        level: 'ERROR',
        statusMessage: err.message,
        metadata: { durationMs: Date.now() - t0 },
      });
    }
    throw err;
  }
}

/** 辅助：从数据库加载并格式化历史记录，传给 Agent 引擎 */
function loadFormattedHistory(sessionId, trace = null) {
  const loadSpan = trace && typeof trace.span === 'function'
    ? trace.span({ name: 'Load_History', input: { sessionId } })
    : null;
  const t0 = Date.now();
  try {
    const rows = db.all(
      `SELECT role, content, tool_calls, tool_call_id, client_message_id FROM chat_messages 
       WHERE session_id = ? 
       ORDER BY created_at ASC, rowid ASC LIMIT 10`,
      [sessionId]
    );
    const formatted = rows.map((r) => ({
      role: r.role,
      content: r.role === 'assistant' ? compressAssistantContent(r.content) : r.content,
      tool_calls: r.tool_calls ? JSON.parse(r.tool_calls) : undefined,
      tool_call_id: r.tool_call_id || undefined,
      client_message_id: r.client_message_id || undefined,
    }));
    endSpan(loadSpan, {
      output: `rows=${formatted.length}`,
      metadata: {
        rowCount: formatted.length,
        hasAssistant: formatted.some((m) => m.role === 'assistant'),
        durationMs: Date.now() - t0,
      },
    });
    return formatted;
  } catch (err) {
    endSpan(loadSpan, {
      output: null,
      level: 'ERROR',
      statusMessage: err.message,
      metadata: { durationMs: Date.now() - t0 },
    });
    throw err;
  }
}

// ─── sendMessage (Non-stream) ──────────────────────────────────────────────────
async function sendMessage(sessionId, userMessage, userId, reqBody = {}) {
  const session = db.get('SELECT * FROM chat_sessions WHERE id = ?', [sessionId]);
  if (!session) throw Object.assign(new Error('Session not found'), { status: 404, code: 'CHAT_003' });
  if (Number(session.user_id) !== Number(userId)) throw Object.assign(new Error('Forbidden'), { status: 403, code: 'CHAT_004' });

  const regionScope = {
    type: session.role_scope,
    regions: parseSessionRegionsStored(session.regions, sessionId),
    rtm: session.rtm || null,
  };

  // 先建 trace，让 Persist_User_Message / Load_History 能挂在同一棵树下
  const trace = createAgentTrace({
    sessionId,
    userId: session.user_id,
    userMessage,
    scopeType: regionScope.type,
    agentMode: AGENT_MODE,
    entryKind: 'sendMessage',
  });

  await handleIncomingMessage(sessionId, userMessage, userId, reqBody, trace);
  const history = loadFormattedHistory(sessionId, trace);

  const startMs = Date.now();
  let result;
  try {
    result = await chatAgentRunner.run(userMessage, history, regionScope, {
      sessionId,
      userId: session.user_id,
      trace,
    });
  } catch (err) {
    trace.update({
      output: maskPII(err.message || String(err)),
      metadata: { status: 'error', errorCode: err.code || 'CHAT_500' },
    });
    throw err;
  }
  const responseTime = Date.now() - startMs;

  const now = formatNowSqliteLocal();
  const assistMsgId = nanoid();
  const finalContent = storageContentFromAgentResult(result);
  const toolCallsStr = result._toolMeta?.toolCalls ? JSON.stringify(result._toolMeta.toolCalls) : null;

  const persistAsstSpan = trace.span({
    name: 'Persist_Assistant_Message',
    input: { sessionId, assistMsgId, intentType: result._intentType || null },
  });
  const persistT0 = Date.now();
  try {
    db.run(
      'INSERT INTO chat_messages (id, session_id, role, content, intent_type, tool_calls, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [assistMsgId, sessionId, 'assistant', finalContent, result._intentType || null, toolCallsStr, now]
    );
    db.run('UPDATE chat_sessions SET last_active = ? WHERE id = ?', [now, sessionId]);
    endSpan(persistAsstSpan, {
      output: 'ok',
      metadata: {
        contentBytes: typeof finalContent === 'string' ? finalContent.length : 0,
        hasToolCalls: !!toolCallsStr,
        durationMs: Date.now() - persistT0,
      },
    });
  } catch (err) {
    endSpan(persistAsstSpan, {
      output: null,
      level: 'ERROR',
      statusMessage: err.message,
      metadata: { durationMs: Date.now() - persistT0 },
    });
    throw err;
  }

  trace.update({
    output: maskPII(preview(finalContent)),
    metadata: {
      status: 'ok',
      intentType: result._intentType || null,
      intentResolvedBy: result._intentResolvedBy || null,
      toolName: result._toolMeta?.toolName || null,
      toolNames: result._toolMeta?.toolNames || null,
      iterations: result._toolMeta?.iterations || null,
      responseTimeMs: responseTime,
      msgId: assistMsgId,
    },
  });

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

// ─── sendMessageStreamLangGraph (T1 Phase 2 调试专用) ────────────────────────────────
async function sendMessageStreamLangGraph(sessionId, userMessage, userId, req, res) {
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

  const trace = createAgentTrace({
    sessionId,
    userId: session.user_id,
    userMessage,
    scopeType: regionScope.type,
    agentMode: AGENT_MODE,
    entryKind: 'sendMessageStreamLangGraph',
  });

  // 我们不再依赖旧的 handleIncomingMessage，因为 LangGraph 会自己存消息
  writeSseHeaders(res);
  const send = createSseSender(res);
  const abortController = new AbortController();

  const sseSpan = trace.span({ name: 'SSE_Stream', input: { sessionId } });
  let sseDeltaCount = 0, sseDeltaBytes = 0, sseReasoningCount = 0, sseToolStartCount = 0;
  
  const wrappedSend = (event, payload) => send(event, payload);
  const sseEmitter = {
    handleLLMNewToken: (token, info = {}) => {
      const phase = info.isReasoning ? 'reasoning' : 'content';
      if (phase === 'reasoning') sseReasoningCount += 1;
      if (typeof token === 'string' && token) {
        sseDeltaCount += 1;
        sseDeltaBytes += token.length;
      }
      wrappedSend('delta', { text: token, phase });
    },
    handleToolStart: (toolInfo) => {
      sseToolStartCount += 1;
      wrappedSend('delta', { text: '', phase: 'tool_start', toolName: toolInfo.name });
    },
    handleToolEnd: (result) => {
      wrappedSend('delta', { text: '', phase: 'tool_end', status: 'success' });
    }
  };

  try {
    const dbPath = path.join(__dirname, '..', 'database.db');
    const sqliteDb = new Database(dbPath);
    const checkpointer = new SqliteSaver(sqliteDb);
    checkpointer.setup(); 
    
    const app = buildGraph().compile({ checkpointer }); 

    const currentDeveloper = process.env.USER || process.env.LOGNAME || "unknown_dev";
    
    if (trace && typeof trace.update === 'function' && trace !== NOOP_TRACE) {
       trace.update({
         name: `ExecutiveChat-LangGraph-[${currentDeveloper}]`,
         tags: ["executive_chat", "langgraph_prod", `dev:${currentDeveloper}`]
       });
    }

    const inputState = { 
      userMessage, 
      sessionId,
      userId: session.user_id.toString(),
      regionScope 
    };

    const thread = { 
      configurable: { 
        thread_id: sessionId,
        sseEmitter 
      },
      signal: abortController.signal
    };

    const finalState = await app.invoke(inputState, thread);
    
    if (trace && typeof trace.update === 'function' && trace !== NOOP_TRACE) {
      trace.update({
        output: finalState.finalResponse || finalState.messages[finalState.messages.length - 1]?.content,
        metadata: {
          selected_tier: finalState.selected_tier,
          fc_steps_used: finalState.fc_super_step_count,
          repair_attempts: finalState.fc_repair_attempts,
          intent: finalState.intent
        }
      });
    }

    // 伪装兼容 response
    const result = {
      _intentType: finalState.intent,
      _formatVersion: "v4.0.0",
      _safetyCheck: finalState.safety,
      markdownContent: finalState.finalResponse || finalState.messages[finalState.messages.length - 1]?.content,
      _toolMeta: { toolCalls: [] } 
    };

    endSpan(sseSpan, { output: 'success' });
    wrappedSend('done', '[DONE]');
    return result;

  } catch (err) {
    logger.error('chat_langgraph_stream_error', { sessionId, error: err.stack });
    endSpan(sseSpan, { level: 'ERROR', statusMessage: err.message });
    wrappedSend('error', { message: 'Agent LangGraph 执行出错' });
    throw err;
  }
}
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

  const trace = createAgentTrace({
    sessionId,
    userId: session.user_id,
    userMessage,
    scopeType: regionScope.type,
    agentMode: AGENT_MODE,
    entryKind: 'sendMessageStream',
  });

  await handleIncomingMessage(sessionId, userMessage, userId, req.body, trace);
  const history = loadFormattedHistory(sessionId, trace);

  writeSseHeaders(res);
  const send = createSseSender(res);
  const abortController = new AbortController();

  // §4 SSE_Stream span：覆盖整条 SSE 流存活期，metadata 聚合 delta / phase 统计。
  const sseSpan = trace.span({
    name: 'SSE_Stream',
    input: { sessionId },
  });
  const sseT0 = Date.now();
  let sseDeltaCount = 0;
  let sseDeltaBytes = 0;
  let sseReasoningCount = 0;
  let sseToolStartCount = 0;
  let sseClientAborted = false;

  // 联动客户端断开
  req.on('close', () => {
    sseClientAborted = true;
    abortController.abort();
  });

  const wrappedSend = (event, payload) => send(event, payload);

  const startMs = Date.now();
  let result;
  try {
    // 【紧急修复】恢复生产真实能力，将 LangGraph 切回旧版 chatAgentRunner
    result = await chatAgentRunner.run(userMessage, history, regionScope, {
      sessionId,
      userId: session.user_id,
      signal: abortController.signal,
      trace,
      streamFormatCallbacks: {
        onDelta: (text, meta) => {
          const phase = meta?.phase || 'content';
          if (phase === 'reasoning') sseReasoningCount += 1;
          else if (phase === 'tool_start') sseToolStartCount += 1;
          if (typeof text === 'string' && text) {
            sseDeltaCount += 1;
            sseDeltaBytes += text.length;
          }
          wrappedSend('delta', {
            text,
            phase,
            reasoningLevel: meta?.reasoningLevel || undefined,
          });
        },
      },
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      logger.info('chat_stream_aborted', { sessionId });
      endSpan(sseSpan, {
        output: null,
        level: 'WARNING',
        metadata: {
          status: 'aborted',
          clientAborted: sseClientAborted,
          deltaCount: sseDeltaCount,
          deltaBytes: sseDeltaBytes,
          reasoningCount: sseReasoningCount,
          toolStartCount: sseToolStartCount,
          durationMs: Date.now() - sseT0,
        },
      });
      trace.update({
        output: null,
        metadata: { status: 'aborted', reason: 'client_abort' },
      });
      return;
    }
    endSpan(sseSpan, {
      output: null,
      level: 'ERROR',
      statusMessage: err.message,
      metadata: {
        status: 'error',
        deltaCount: sseDeltaCount,
        deltaBytes: sseDeltaBytes,
        durationMs: Date.now() - sseT0,
      },
    });
    trace.update({
      output: maskPII(err.message || String(err)),
      metadata: { status: 'error', errorCode: err.code || 'CHAT_500' },
    });
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

  const persistAsstSpan = trace.span({
    name: 'Persist_Assistant_Message',
    input: { sessionId, assistMsgId, intentType: result._intentType || null },
  });
  const persistT0 = Date.now();
  try {
    db.run(
      'INSERT INTO chat_messages (id, session_id, role, content, intent_type, tool_calls, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [assistMsgId, sessionId, 'assistant', finalContent, result._intentType, toolCallsStr, now]
    );
    db.run('UPDATE chat_sessions SET last_active = ? WHERE id = ?', [now, sessionId]);
    endSpan(persistAsstSpan, {
      output: 'ok',
      metadata: {
        contentBytes: typeof finalContent === 'string' ? finalContent.length : 0,
        hasToolCalls: !!toolCallsStr,
        durationMs: Date.now() - persistT0,
      },
    });
  } catch (err) {
    endSpan(persistAsstSpan, {
      output: null,
      level: 'ERROR',
      statusMessage: err.message,
      metadata: { durationMs: Date.now() - persistT0 },
    });
    throw err;
  }

  trace.update({
    output: maskPII(preview(finalContent)),
    metadata: {
      status: 'ok',
      intentType: result._intentType || null,
      intentResolvedBy: result._intentResolvedBy || null,
      toolName: result._toolMeta?.toolName || null,
      toolNames: result._toolMeta?.toolNames || null,
      iterations: result._toolMeta?.iterations || null,
      responseTimeMs: responseTime,
      msgId: assistMsgId,
      stream: true,
    },
  });

  // 异步提取记忆
  setImmediate(() => {
    chatMemoryService.extract(sessionId).catch(e => logger.warn('memory_extract_error', { sessionId, error: e.message }));
  });

  endSpan(sseSpan, {
    output: 'done',
    metadata: {
      status: 'ok',
      deltaCount: sseDeltaCount,
      deltaBytes: sseDeltaBytes,
      reasoningCount: sseReasoningCount,
      toolStartCount: sseToolStartCount,
      durationMs: Date.now() - sseT0,
      msgId: assistMsgId,
    },
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

  // §5.9：先建 trace，让 Load_History / SSE_Stream / Persist_Assistant_Message 都挂在同一棵树。
  const trace = createAgentTrace({
    sessionId,
    userId,
    userMessage: '<regenerate placeholder>',
    scopeType: session.role_scope,
    agentMode: AGENT_MODE,
    entryKind: 'regenerateStream',
    tags: ['regenerate'],
  });

  const chronological = loadFormattedHistory(sessionId, trace);
  if (chronological.length < 2) {
    trace.update({
      output: null,
      metadata: { status: 'bad_request', reason: 'not_enough_history' },
    });
    res.status(400).json({ code: 400, message: 'Not enough history to regenerate', errorCode: 'CHAT_008' });
    return;
  }

  const lastTurn = chronological[chronological.length - 1];
  const prevTurn = chronological[chronological.length - 2];
  if (lastTurn.role !== 'assistant' || prevTurn.role !== 'user') {
    trace.update({
      output: null,
      metadata: { status: 'bad_request', reason: 'unexpected_history_shape' },
    });
    res.status(400).json({ code: 400, message: 'Expected user message before assistant message', errorCode: 'CHAT_008' });
    return;
  }

  const userPrompt = typeof prevTurn.content === 'string' ? prevTurn.content : '';
  if (!userPrompt.trim()) {
    trace.update({
      output: null,
      metadata: { status: 'bad_request', reason: 'empty_user_prompt' },
    });
    res.status(400).json({ code: 400, message: 'User message is empty', errorCode: 'CHAT_008' });
    return;
  }

  // 实际 userMessage 已可知，回填给 trace（保留原 entryKind/tags）
  trace.update({ input: maskPII(preview(userPrompt)) });

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

  const sseSpan = trace.span({ name: 'SSE_Stream', input: { sessionId, kind: 'regenerate' } });
  const sseT0 = Date.now();
  let sseDeltaCount = 0;
  let sseDeltaBytes = 0;
  let sseReasoningCount = 0;
  let sseToolStartCount = 0;
  let sseClientAborted = false;

  req.on('close', () => {
    logger.info('client_aborted_stream_regenerate', { sessionId });
    sseClientAborted = true;
    abortController.abort();
  });

  const startMs = Date.now();
  let result;
  try {
    result = await chatAgentRunner.run(userPrompt, history, regionScope, {
      sessionId,
      userId,
      signal: abortController.signal,
      trace,
      streamFormatCallbacks: {
        onDelta: (text, meta) => {
          const phase = meta?.phase || 'content';
          if (phase === 'reasoning') sseReasoningCount += 1;
          else if (phase === 'tool_start') sseToolStartCount += 1;
          if (typeof text === 'string' && text) {
            sseDeltaCount += 1;
            sseDeltaBytes += text.length;
          }
          send('delta', {
            text,
            phase,
            reasoningLevel: meta?.reasoningLevel || undefined,
          });
        },
      },
    });

    const responseTime = Date.now() - startMs;
    const now = formatNowSqliteLocal();
    const newAssistMsgId = nanoid();
    const finalContent = storageContentFromAgentResult(result);

    const persistSpan = trace.span({
      name: 'Persist_Assistant_Message',
      input: { sessionId, newAssistMsgId, replacedMessageId: messageId, intentType: result._intentType ?? null },
    });
    const persistT0 = Date.now();
    try {
      db.transaction(() => {
        db.run('DELETE FROM chat_message_feedback WHERE message_id = ?', [messageId]);
        db.run('DELETE FROM chat_messages WHERE id = ? AND session_id = ?', [messageId, sessionId]);
        db.run(
          'INSERT INTO chat_messages (id, session_id, role, content, intent_type, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [newAssistMsgId, sessionId, 'assistant', finalContent, result._intentType ?? null, now]
        );
        db.run('UPDATE chat_sessions SET last_active = ? WHERE id = ?', [now, sessionId]);
      });
      endSpan(persistSpan, {
        output: 'ok',
        metadata: {
          replaced: true,
          contentBytes: typeof finalContent === 'string' ? finalContent.length : 0,
          durationMs: Date.now() - persistT0,
        },
      });
    } catch (err) {
      endSpan(persistSpan, {
        output: null,
        level: 'ERROR',
        statusMessage: err.message,
        metadata: { durationMs: Date.now() - persistT0 },
      });
      throw err;
    }

    logger.info('chat_turn_regenerate_stream', {
      sessionId, userId, intentType: result._intentType, responseTimeMs: responseTime, msgId: newAssistMsgId,
    });

    endSpan(sseSpan, {
      output: 'done',
      metadata: {
        status: 'ok',
        deltaCount: sseDeltaCount,
        deltaBytes: sseDeltaBytes,
        reasoningCount: sseReasoningCount,
        toolStartCount: sseToolStartCount,
        durationMs: Date.now() - sseT0,
        msgId: newAssistMsgId,
      },
    });
    trace.update({
      output: maskPII(preview(finalContent)),
      metadata: {
        status: 'ok',
        intentType: result._intentType || null,
        intentResolvedBy: result._intentResolvedBy || null,
        toolName: result._toolMeta?.toolName || null,
        iterations: result._toolMeta?.iterations || null,
        responseTimeMs: responseTime,
        msgId: newAssistMsgId,
        stream: true,
      },
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
      endSpan(sseSpan, {
        output: null,
        level: 'WARNING',
        metadata: {
          status: 'aborted',
          clientAborted: sseClientAborted,
          deltaCount: sseDeltaCount,
          deltaBytes: sseDeltaBytes,
          durationMs: Date.now() - sseT0,
        },
      });
      trace.update({
        output: null,
        metadata: { status: 'aborted', reason: 'client_abort' },
      });
      return;
    }
    endSpan(sseSpan, {
      output: null,
      level: 'ERROR',
      statusMessage: err.message,
      metadata: { status: 'error', durationMs: Date.now() - sseT0 },
    });
    trace.update({
      output: maskPII(err.message || String(err)),
      metadata: { status: 'error', errorCode: err.code || 'CHAT_500' },
    });
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

  // 先建 trace 让 Load_History / Persist 挂上去
  const trace = createAgentTrace({
    sessionId,
    userId,
    userMessage: '<regenerate placeholder>',
    scopeType: session.role_scope,
    agentMode: AGENT_MODE,
    entryKind: 'regenerate',
    tags: ['regenerate'],
  });

  // 与 sendMessageStream 一致：全量 ASC 历史（含 tool 行），再截取待重算的一轮 user+assistant
  const chronological = loadFormattedHistory(sessionId, trace);
  if (chronological.length < 2) {
    trace.update({ metadata: { status: 'bad_request', reason: 'not_enough_history' } });
    throw Object.assign(new Error('Not enough history to regenerate'), { status: 400, code: 'CHAT_008' });
  }
  const lastTurn = chronological[chronological.length - 1];
  const prevTurn = chronological[chronological.length - 2];
  if (lastTurn.role !== 'assistant' || prevTurn.role !== 'user') {
    trace.update({ metadata: { status: 'bad_request', reason: 'unexpected_history_shape' } });
    throw Object.assign(new Error('Expected user message before assistant message'), { status: 400, code: 'CHAT_008' });
  }
  const userPrompt = typeof prevTurn.content === 'string' ? prevTurn.content : '';
  if (!userPrompt.trim()) {
    trace.update({ metadata: { status: 'bad_request', reason: 'empty_user_prompt' } });
    throw Object.assign(new Error('User message is empty'), { status: 400, code: 'CHAT_008' });
  }

  trace.update({ input: maskPII(preview(userPrompt)) });

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
    result = await chatAgentRunner.run(userPrompt, history, regionScope, {
      sessionId,
      userId,
      trace,
    });
  } catch (err) {
    trace.update({
      output: maskPII(err.message || String(err)),
      metadata: { status: 'error', errorCode: err.code || 'CHAT_500' },
    });
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
  const persistSpan = trace.span({
    name: 'Persist_Assistant_Message',
    input: { sessionId, newAssistMsgId, replacedMessageId: messageId, intentType: result._intentType ?? null },
  });
  const persistT0 = Date.now();
  try {
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
    endSpan(persistSpan, {
      output: 'ok',
      metadata: {
        replaced: true,
        contentBytes: typeof finalContent === 'string' ? finalContent.length : 0,
        durationMs: Date.now() - persistT0,
      },
    });
  } catch (err) {
    endSpan(persistSpan, {
      output: null,
      level: 'ERROR',
      statusMessage: err.message,
      metadata: { durationMs: Date.now() - persistT0 },
    });
    throw err;
  }

  trace.update({
    output: maskPII(preview(finalContent)),
    metadata: {
      status: 'ok',
      intentType: result._intentType || null,
      intentResolvedBy: result._intentResolvedBy || null,
      toolName: result._toolMeta?.toolName || null,
      iterations: result._toolMeta?.iterations || null,
      responseTimeMs: responseTime,
      msgId: newAssistMsgId,
    },
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

module.exports = { createSession, sendMessage, sendMessageStream, sendMessageStreamLangGraph, getHistory, deleteSessionById, setMessageFeedback, regenerateLastAssistant, regenerateLastAssistantStream };
