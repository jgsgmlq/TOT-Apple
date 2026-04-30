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
const { createAgentTrace, endSpan, maskPII, preview, NOOP_TRACE } = require('../utils/tracer');
const { buildGraph } = require('../agent/graph/graph');
const { SqliteSaver } = require('@langchain/langgraph-checkpoint-sqlite');
const Database = require('better-sqlite3');
const path = require('path');
const { Langfuse } = require('langfuse');

// ─── Region scope resolver ────────────────────────────────────────────────────
function resolveRegionScope(reqUser) {
  const roles = reqUser?.roles;
  if (!roles || !Array.isArray(roles) || roles.length === 0) {
    throw Object.assign(new Error('User roles are missing or invalid'), { status: 403, code: 'AUTH_005' });
  }
  if (reqUser.executive_rtm) {
    return { type: 'rtm', rtm: reqUser.executive_rtm, regions: null, userRoles: roles };
  }
  if (reqUser.executive_regions) {
    try {
      const regions = JSON.parse(reqUser.executive_regions);
      if (!Array.isArray(regions) || regions.length === 0) {
        throw Object.assign(new Error('executive_regions must be a non-empty array for regional scope'), { status: 400, code: 'AUTH_003' });
      }
      return { type: 'regional', regions, rtm: null, userRoles: roles };
    } catch (e) {
      if (e.code === 'AUTH_003') throw e;
    }
  }
  return { type: 'national', regions: null, rtm: null, userRoles: roles };
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
  const replyContent = {
    overview: typeof result.overview === 'string' ? result.overview : '',
    keyNumbers: Array.isArray(result.keyNumbers) ? result.keyNumbers : [],
    attentionPoints: Array.isArray(result.attentionPoints) ? result.attentionPoints : [],
    followUpSuggestions: Array.isArray(result.followUpSuggestions) ? result.followUpSuggestions : [],
    ...(Array.isArray(result.visualizations) ? { visualizations: result.visualizations } : {}),
    ...(result.statisticsProvenance && typeof result.statisticsProvenance === 'object'
      ? { statisticsProvenance: result.statisticsProvenance }
      : {}),
    ...(typeof result.forecastDisclaimer === 'string' ? { forecastDisclaimer: result.forecastDisclaimer } : {}),
  };
  return {
    replyContent,
    markdownContent: JSON.stringify({ replyContent, markdownContent: null }),
  };
}

function buildSseFinalPayload(result, sessionId, requestId, responseTime, timestamp) {
  const payload = buildExecutiveMessageApiData(result);
  return {
    code: 200,
    message: 'success',
    data: {
      messageId: result?.messageId || nanoid(),
      ...payload,
      responseTime,
      contextId: sessionId,
      timestamp,
    },
    requestId,
  };
}

function buildSseErrorPayload(message, code = 'CHAT_500', status = 500, requestId) {
  return {
    code: status,
    message,
    errorCode: code,
    data: null,
    requestId,
  };
}

function isLikelyClientAbortError(err, abortSignal, sseClientAborted) {
  const msg = typeof err?.message === 'string' ? err.message : '';
  if (err?.name === 'AbortError') return true;
  if ((abortSignal?.aborted || sseClientAborted) && /abort/i.test(msg)) return true;
  return false;
}

function buildStreamAbortDiagnostics(err, req, res, abortSignal, sseClientAborted) {
  return {
    errName: err?.name || null,
    errMessage: err?.message || null,
    errCode: err?.code || null,
    errStack: err?.stack ? String(err.stack).split('\n').slice(0, 6).join(' | ') : null,
    errCtor: err?.constructor?.name || null,
    signalAborted: !!abortSignal?.aborted,
    signalReason: abortSignal?.reason ? String(abortSignal.reason).slice(0, 200) : null,
    sseClientAborted: !!sseClientAborted,
    reqAborted: !!req?.aborted,
    reqDestroyed: !!req?.destroyed,
    reqComplete: !!req?.complete,
    resWritableEnded: !!res?.writableEnded,
    resHeadersSent: !!res?.headersSent,
  };
}

function extractLangGraphInterrupt(finalState) {
  const interrupts = finalState && finalState.__interrupt__;
  if (!Array.isArray(interrupts) || interrupts.length === 0) return null;
  const first = interrupts[0];
  return first?.value || first || null;
}

function extractToolMetaForTrace(finalState) {
  const calledTools = Array.isArray(finalState?.calledTools) ? finalState.calledTools.filter(Boolean) : [];
  const toolResults = finalState?.toolResults && typeof finalState.toolResults === 'object'
    ? Object.values(finalState.toolResults)
    : [];
  const toolCallCount = Math.max(calledTools.length, toolResults.length);
  return {
    toolNames: Array.from(new Set(calledTools)),
    toolCallCount,
  };
}

function buildClarifySsePayload(interruptPayload, requestId) {
  const payload = interruptPayload && typeof interruptPayload === 'object' ? interruptPayload : {};
  const prompt = payload.prompt || payload.message || '需要您补充一些信息后才能继续。';
  return {
    code: 202,
    message: prompt,
    data: {
      ...payload,
      prompt,
      resumeToken: payload.resume_token || payload.resumeToken || null,
      payload,
    },
    requestId,
  };
}

function buildInterruptedDonePayload(interruptPayload, sessionId, requestId, responseTime, timestamp) {
  const payload = interruptPayload && typeof interruptPayload === 'object' ? interruptPayload : {};
  const prompt = payload.prompt || payload.message || '需要您补充一些信息后才能继续。';
  return {
    code: 202,
    message: 'interrupted',
    data: {
      status: 'interrupted',
      messageId: payload.resume_token || payload.resumeToken || nanoid(),
      replyContent: null,
      markdownContent: prompt,
      responseTime,
      contextId: sessionId,
      timestamp,
      interruptPayload: payload,
    },
    requestId,
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
function createSession(userId, reqUser) {
  const user = db.get('SELECT id, executive_regions, executive_rtm FROM users WHERE id = ?', [userId]);
  if (!user) throw Object.assign(new Error('User not found'), { status: 404, code: 'CHAT_002' });

  // 必须将原始请求中解析出的 roles 合并到 DB 查询出的 user 对象中
  const combinedUser = { ...user, roles: reqUser?.roles || ['executive'] };
  const regionScope = resolveRegionScope(combinedUser);
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
async function sendMessage(sessionId, userMessage, userId, req = {}) {
  const session = db.get('SELECT * FROM chat_sessions WHERE id = ?', [sessionId]);
  if (!session) throw Object.assign(new Error('Session not found'), { status: 404, code: 'CHAT_003' });
  if (Number(session.user_id) !== Number(userId)) throw Object.assign(new Error('Forbidden'), { status: 403, code: 'CHAT_004' });

  const regionScope = {
    type: session.role_scope,
    regions: parseSessionRegionsStored(session.regions, sessionId),
    rtm: session.rtm || null,
    userRoles: req?.user?.roles || ['executive']
  };

  if (!req?.user?.roles || !Array.isArray(req?.user?.roles) || req.user.roles.length === 0) {
    logger.warn('auth_roles_missing', { userId, reqUrl: req.originalUrl, usingFallback: 'executive' });
  }

  // 先建 trace，让 Persist_User_Message / Load_History 能挂在同一棵树下
  const trace = createAgentTrace({
    sessionId,
    userId: session.user_id,
    userMessage,
    scopeType: regionScope.type,
    agentMode: AGENT_MODE,
    entryKind: 'sendMessage',
  });

  await handleIncomingMessage(sessionId, userMessage, userId, req.body || {}, trace);
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

// ─── resumeMessageStreamLangGraph (T1 Phase 2 HITL 恢复专用) ─────────────────────
async function resumeMessageStreamLangGraph(sessionId, resumePayload, userId, req, res) {
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
    userRoles: req?.user?.roles || ['executive']
  };

  if (!req?.user?.roles || !Array.isArray(req?.user?.roles) || req.user.roles.length === 0) {
    logger.warn('auth_roles_missing', { userId, reqUrl: req.originalUrl, usingFallback: 'executive' });
  }

  const trace = createAgentTrace({
    sessionId,
    userId: session.user_id,
    userMessage: "<resume_payload>",
    scopeType: regionScope.type,
    agentMode: AGENT_MODE,
    entryKind: 'resumeMessageStreamLangGraph',
  });

  writeSseHeaders(res);
  const send = createSseSender(res);
  const abortController = new AbortController();

  const sseSpan = trace.span({ name: 'SSE_Stream', input: { sessionId, resumePayload } });
  let sseDeltaCount = 0, sseDeltaBytes = 0, sseReasoningCount = 0, sseToolStartCount = 0;
  const startMs = Date.now();
  
  const wrappedSend = (event, payload) => send(event, payload);
  let sseClientAborted = false;
  req.on('close', () => {
    sseClientAborted = true;
    abortController.abort();
  });

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
      wrappedSend('delta', { text: toolInfo?.name || '', phase: 'tool_start', toolName: toolInfo?.name });
    },
    handleToolEnd: (result) => {
      wrappedSend('delta', { text: '', phase: 'tool_end', status: 'success' });
    },
    handleError: (message) => {
      wrappedSend('error', { message, code: 'CHAT_500' });
    }
  };

  try {
    const sqliteDb = getDb();
    const checkpointer = new SqliteSaver(sqliteDb);
    
    const app = buildGraph().compile({ checkpointer }); 

    const currentDeveloper = process.env.USER || process.env.LOGNAME || "unknown_dev";
    
    if (trace && typeof trace.update === 'function' && trace !== NOOP_TRACE) {
       trace.update({
         name: `ExecutiveChat-LangGraph-[${currentDeveloper}]`,
         tags: ["executive_chat", "langgraph_prod", "hitl_resume", `dev:${currentDeveloper}`]
       });
    }

    const thread = { 
      configurable: { 
        thread_id: sessionId,
        sseEmitter,
        traceId: trace ? trace.id : undefined 
      },
      signal: abortController.signal
    };

    // T1: 这里不再是传递 inputState 重新开始，而是使用 Command/Command 形式向状态机发送 resume 值
    // 传递 null 作为 inputState 代表我们继续图里已有的执行
    const finalState = await app.invoke(
      new (require("@langchain/langgraph").Command)({ resume: resumePayload }), 
      thread
    );

    const interruptPayload = extractLangGraphInterrupt(finalState);
    if (interruptPayload) {
      const responseTime = Date.now() - startMs;
      const timestamp = formatNowSqliteLocal();
      wrappedSend('clarify', buildClarifySsePayload(interruptPayload, req.requestId));
      wrappedSend('done', buildInterruptedDonePayload(interruptPayload, sessionId, req.requestId, responseTime, timestamp));
      res.end();
      return { interrupted: true, interruptPayload };
    }
    
    const finalMarkdown = finalState.reply_markdown || finalState.finalResponse || finalState.messages[finalState.messages.length - 1]?.content;
    const assistMsgId = finalState.finalMessageId || nanoid();

    if (trace && typeof trace.update === 'function' && trace !== NOOP_TRACE) {
      const { toolNames, toolCallCount } = extractToolMetaForTrace(finalState);
      trace.update({
        output: finalMarkdown,
        metadata: {
          selected_tier: finalState.selected_tier,
          fc_steps_used: finalState.fc_super_step_count,
          repair_attempts: finalState.fc_repair_attempts,
          intent: finalState.intent,
          tool_names: toolNames,
          tool_call_count: toolCallCount,
        }
      });
    }

    const result = {
      _intentType: finalState.intent,
      _formatVersion: "v4.0.0",
      _safetyCheck: finalState.safety,
      markdownContent: finalMarkdown,
      replyContent: null,
      _toolMeta: { toolCalls: [] }
    };

    const responseTime = Date.now() - startMs;
    const timestamp = formatNowSqliteLocal();
    const donePayload = buildSseFinalPayload({ ...result, messageId: assistMsgId }, sessionId, req.requestId, responseTime, timestamp);

    endSpan(sseSpan, { output: 'success' });
    
    wrappedSend('done', donePayload);
    res.end();
    return result;

  } catch (err) {
    const abortDiagnostics = buildStreamAbortDiagnostics(err, req, res, abortController.signal, sseClientAborted);
    if (isLikelyClientAbortError(err, abortController.signal, sseClientAborted)) {
      logger.info('chat_stream_langgraph_aborted', { sessionId, ...abortDiagnostics });
      endSpan(sseSpan, {
        output: null,
        level: 'WARNING',
        metadata: { status: 'aborted', deltaCount: sseDeltaCount, deltaBytes: sseDeltaBytes, reasoningCount: sseReasoningCount }
      });
      if (trace && trace !== NOOP_TRACE) trace.update({ output: null, metadata: { status: 'aborted', reason: 'client_abort' } });
      return;
    }
    
    logger.error('chat_langgraph_resume_error', {
      sessionId,
      error: err.stack,
      ...abortDiagnostics,
    });
    endSpan(sseSpan, { level: 'ERROR', statusMessage: err.message });
    if (res.headersSent) {
      try { wrappedSend('error', buildSseErrorPayload('Agent LangGraph 唤醒出错', err.code || 'CHAT_500', err.status || 500, req.requestId)); } catch (_) {}
      try { res.end(); } catch (_) {}
      err._sseResponseSent = true;
    } else {
      wrappedSend('error', buildSseErrorPayload('Agent LangGraph 唤醒出错', err.code || 'CHAT_500', err.status || 500, req.requestId));
    }
    throw err;
  }
}

// ─── sendMessageStreamLangGraph (T1 Phase 2 调试专用) ────────────────────────────────
async function sendMessageStreamLangGraph(sessionId, userMessage, userId, req, res, options = {}) {
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
    userRoles: req?.user?.roles || ['executive']
  };

  if (!req?.user?.roles || !Array.isArray(req?.user?.roles) || req.user.roles.length === 0) {
    logger.warn('auth_roles_missing', { userId, reqUrl: req.originalUrl, usingFallback: 'executive' });
  }

  const trace = createAgentTrace({
    sessionId,
    userId: session.user_id,
    userMessage,
    scopeType: regionScope.type,
    agentMode: AGENT_MODE,
    entryKind: options.entryKind || 'sendMessageStreamLangGraph',
  });

  // T1: 必须调用 handleIncomingMessage 以保证外部 API (/history) 获取到的旧表 chat_messages 里有用户输入
  if (options.skipIncomingMessage !== true) {
    await handleIncomingMessage(sessionId, userMessage, userId, req.body, trace);
  }

  writeSseHeaders(res);
  const send = createSseSender(res);
  const abortController = new AbortController();

  const sseSpan = trace.span({ name: 'SSE_Stream', input: { sessionId } });
  let sseDeltaCount = 0, sseDeltaBytes = 0, sseReasoningCount = 0, sseToolStartCount = 0;
  const startMs = Date.now();
  
  const wrappedSend = (event, payload) => send(event, payload);
  let sseClientAborted = false;
  req.on('close', () => {
    sseClientAborted = true;
    abortController.abort();
  });

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
    const sqliteDb = getDb();
    const checkpointer = new SqliteSaver(sqliteDb);
    
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
        // 每次请求一个独立 thread_id，避免复用上一轮 checkpoint 把 fc_super_step_count
        // 等中间状态带进来导致 fc_CheckSteps 直接判超限、跳过 fc_LlmToolCallStep。
        // 历史对话上下文已经由 loadContext/loadFormattedHistory 从 chat_messages 表重建，
        // 不依赖 LangGraph checkpoint 续接。resume 路径仍用稳定 thread_id（在另一个函数里）。
        thread_id: `${sessionId}:${nanoid()}`,
        sseEmitter,
        // 将外层建好的 root TraceId 注入，好让子节点（Router 和 FC模型）生成的 Span 都挂在这棵树下
        traceId: trace ? trace.id : undefined
      },
      signal: abortController.signal
    };

    const finalState = await app.invoke(inputState, thread);

    const interruptPayload = extractLangGraphInterrupt(finalState);
    if (interruptPayload) {
      const responseTime = Date.now() - startMs;
      const timestamp = formatNowSqliteLocal();
      wrappedSend('clarify', buildClarifySsePayload(interruptPayload, req.requestId));
      wrappedSend('done', buildInterruptedDonePayload(interruptPayload, sessionId, req.requestId, responseTime, timestamp));
      res.end();
      return { interrupted: true, interruptPayload };
    }
    
    const finalMarkdown = finalState.reply_markdown || finalState.finalResponse || finalState.messages[finalState.messages.length - 1]?.content;
    const assistMsgId = finalState.finalMessageId || nanoid();

    if (trace && typeof trace.update === 'function' && trace !== NOOP_TRACE) {
      const { toolNames, toolCallCount } = extractToolMetaForTrace(finalState);
      trace.update({
        output: finalMarkdown,
        metadata: {
          selected_tier: finalState.selected_tier,
          fc_steps_used: finalState.fc_super_step_count,
          repair_attempts: finalState.fc_repair_attempts,
          intent: finalState.intent,
          tool_names: toolNames,
          tool_call_count: toolCallCount,
        }
      });
    }

    // 伪装兼容 response
    const result = {
      _intentType: finalState.intent,
      _formatVersion: "v4.0.0",
      _safetyCheck: finalState.safety,
      markdownContent: finalMarkdown,
      replyContent: null,
      _toolMeta: { toolCalls: [] } 
    };

    const responseTime = Date.now() - startMs;

    endSpan(sseSpan, { output: 'success' });
    
    wrappedSend('done', {
      code: 200,
      message: 'success',
      data: {
        messageId: assistMsgId,
        ...buildExecutiveMessageApiData(result),
        responseTime,
        contextId: sessionId,
        timestamp: formatNowSqliteLocal(),
      },
      requestId: req.requestId,
    });
    res.end();
    return result;

  } catch (err) {
    const abortDiagnostics = buildStreamAbortDiagnostics(err, req, res, abortController.signal, sseClientAborted);
    if (isLikelyClientAbortError(err, abortController.signal, sseClientAborted)) {
      logger.info('chat_stream_langgraph_aborted', { sessionId, ...abortDiagnostics });
      endSpan(sseSpan, {
        output: null,
        level: 'WARNING',
        metadata: {
          status: 'aborted',
          deltaCount: sseDeltaCount,
          deltaBytes: sseDeltaBytes,
          reasoningCount: sseReasoningCount,
        },
      });
      if (trace && trace !== NOOP_TRACE) {
        trace.update({
          output: null,
          metadata: { status: 'aborted', reason: 'client_abort' },
        });
      }
      // Abort 路径也要 throw，否则上层（如 regenerate wrapper）的 catch 不会触发，
      // 导致 restoreOldMessage 跳过、旧消息永久丢失、用户再点重新生成会 400。
      // 同时必须先发 event:error 再 res.end()——否则前端 fetch 会拿到空 body 200，
      // streamSsePostJson 的 reader.read() 立刻 done，onError/onComplete 都没机会调，
      // 上层 promise 永远 pending，UI 转圈卡死。发了 event:error 前端 onError 才能触发，
      // handleRegenerate 的 catch 才能 toast 失败 + 解锁 isRegenerating。
      try {
        wrappedSend('error', buildSseErrorPayload('请求被中断', 'CHAT_ABORT', 499, req.requestId));
      } catch (_) {}
      try { res.end(); } catch (_) {}
      err._sseResponseSent = true;
      err._abortedAfterDelete = true;
      throw err;
    }

    logger.error('chat_langgraph_stream_error', {
      sessionId,
      error: err.stack,
      ...abortDiagnostics,
    });
    endSpan(sseSpan, { level: 'ERROR', statusMessage: err.message });
    // SSE 已发 headers 时，先把 SSE error 事件写出去并 res.end()，再 throw 让上层（如 regenerate
    // wrapper 的 catch）做兜底（如 restoreOldMessage）。在 err 上打 _sseResponseSent 标记，
    // 路由层 error middleware 看到这个标记就不要再 res.status(500).json(...) 了，
    // 否则会触发 ERR_HTTP_HEADERS_SENT，前端拿到的就是 500 而非干净的 SSE error。
    if (res.headersSent) {
      try { wrappedSend('error', buildSseErrorPayload('Agent LangGraph 执行出错', err.code || 'CHAT_500', err.status || 500, req.requestId)); } catch (_) {}
      try { res.end(); } catch (_) {}
      err._sseResponseSent = true;
    } else {
      wrappedSend('error', buildSseErrorPayload('Agent LangGraph 执行出错', err.code || 'CHAT_500', err.status || 500, req.requestId));
    }
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
    userRoles: req?.user?.roles || ['executive']
  };

  if (!req?.user?.roles || !Array.isArray(req?.user?.roles) || req.user.roles.length === 0) {
    logger.warn('auth_roles_missing', { userId, reqUrl: req.originalUrl, usingFallback: 'executive' });
  }

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
            toolName:
              phase === 'tool_start' || phase === 'tool_end'
                ? meta?.text || undefined
                : undefined,
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
    toolName: result._toolMeta?.toolName, msgId: assistMsgId, stream: true,  });
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
    let markdownContent = null;
    if (r.role === 'assistant') {
      const normalizedContent = typeof r.content === 'string' ? r.content : '';
      markdownContent = normalizedContent || null;
      try {
        const parsed = JSON.parse(normalizedContent);
        if (parsed && typeof parsed === 'object') {
          if (typeof parsed.markdownContent === 'string' && parsed.markdownContent.trim()) {
            markdownContent = parsed.markdownContent.trim();
          }
          if (parsed.replyContent && typeof parsed.replyContent === 'object') {
            replyContent = parsed.replyContent;
          } else if (parsed && (parsed.overview || parsed.keyNumbers || parsed.attentionPoints || parsed.followUpSuggestions)) {
            replyContent = {
              overview: parsed.overview || '',
              keyNumbers: Array.isArray(parsed.keyNumbers) ? parsed.keyNumbers : [],
              attentionPoints: Array.isArray(parsed.attentionPoints) ? parsed.attentionPoints : [],
              followUpSuggestions: Array.isArray(parsed.followUpSuggestions) ? parsed.followUpSuggestions : [],
              ...(Array.isArray(parsed.visualizations) ? { visualizations: parsed.visualizations } : {}),
              ...(parsed.statisticsProvenance && typeof parsed.statisticsProvenance === 'object' ? { statisticsProvenance: parsed.statisticsProvenance } : {}),
              ...(typeof parsed.forecastDisclaimer === 'string' ? { forecastDisclaimer: parsed.forecastDisclaimer } : {}),
            };
          }
        }
      } catch (e) {
        replyContent = null;
      }
    }
    return {
      messageId: r.id,
      role: r.role,
      content: markdownContent || r.content,
      markdownContent,
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

// ─── regenerateLastAssistantStreamLangGraph ──────────────────────────────────
async function regenerateLastAssistantStreamLangGraph(sessionId, messageId, userId, req, res) {
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

  // 获取上一个 user message
  const chronological = loadFormattedHistory(sessionId, NOOP_TRACE);
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

  // 1. 删除旧消息（包括对应的 tool 消息）
  // 注：项目自定义 db.transaction(fn) 会同步执行并返回结果，不能再 () 调用一次。
  // 之前写成 `const doDelete = db.transaction(...); doDelete();` 直接 TypeError: doDelete is not a function。
  //
  // 同时为 sendMessageStreamLangGraph 失败做兜底：先快照旧消息与 feedback，
  // 流式失败时尝试还原，避免出现「旧消息已删 + 新消息没生成 + 用户彻底丢失原回复」。
  const oldMessageRow = db.get('SELECT * FROM chat_messages WHERE id = ? AND session_id = ?', [messageId, sessionId]);
  const oldFeedbackRows = db.all
    ? db.all('SELECT * FROM chat_message_feedback WHERE message_id = ?', [messageId])
    : [];

  db.transaction(() => {
    db.run('DELETE FROM chat_message_feedback WHERE message_id = ?', [messageId]);
    db.run('DELETE FROM chat_messages WHERE id = ? AND session_id = ?', [messageId, sessionId]);
  });

  const restoreOldMessage = () => {
    if (!oldMessageRow) return;
    try {
      db.transaction(() => {
        db.run(
          `INSERT OR IGNORE INTO chat_messages
            (id, session_id, role, content, intent_type, tool_calls, tool_call_id, client_message_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            oldMessageRow.id,
            oldMessageRow.session_id,
            oldMessageRow.role,
            oldMessageRow.content,
            oldMessageRow.intent_type,
            oldMessageRow.tool_calls,
            oldMessageRow.tool_call_id,
            oldMessageRow.client_message_id,
            oldMessageRow.created_at,
          ]
        );
        for (const fb of oldFeedbackRows || []) {
          db.run(
            `INSERT OR IGNORE INTO chat_message_feedback
              (id, message_id, user_id, feedback_type, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [fb.id, fb.message_id, fb.user_id, fb.feedback_type, fb.created_at, fb.updated_at]
          );
        }
      });
      logger.warn('regenerate_old_message_restored', { sessionId, messageId });
    } catch (restoreErr) {
      logger.error('regenerate_restore_failed', {
        sessionId,
        messageId,
        error: restoreErr.message,
      });
    }
  };

  // 2. 将请求桥接到标准的 LangGraph stream，跳过 handleIncomingMessage 避免重复插入 user 消息
  try {
    return await sendMessageStreamLangGraph(sessionId, userPrompt, userId, req, res, {
      skipIncomingMessage: true,
      entryKind: 'regenerateLastAssistantStreamLangGraph'
    });
  } catch (err) {
    // 流式重新生成失败 —— 还原旧消息，保证用户至少能继续看到之前的回复并再次重试。
    restoreOldMessage();
    throw err;
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

  if (!req?.user?.roles || !Array.isArray(req?.user?.roles) || req.user.roles.length === 0) {
    logger.warn('auth_roles_missing', { userId, reqUrl: req?.originalUrl, usingFallback: 'executive' });
  }

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
            toolName:
              phase === 'tool_start' || phase === 'tool_end'
                ? meta?.text || undefined
                : undefined,
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

    const timestamp = formatNowSqliteLocal();
    const donePayload = buildSseFinalPayload({ ...result, messageId: newAssistMsgId }, sessionId, req.requestId, responseTime, timestamp);

    send('done', donePayload);
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
    send('error', buildSseErrorPayload(err.message || '处理失败', err.code || 'CHAT_500', err.status || 500, req.requestId));
    res.end();
  }
}

// ─── regenerateLastAssistant ──────────────────────────────────────────────────
async function regenerateLastAssistant(sessionId, messageId, userId, req = {}) {
  const session = db.get('SELECT * FROM chat_sessions WHERE id = ?', [sessionId]);
  if (!session) throw Object.assign(new Error('Session not found'), { status: 404, code: 'CHAT_003' });
  if (Number(session.user_id) !== Number(userId)) {
    throw Object.assign(new Error('Forbidden'), { status: 403, code: 'CHAT_004' });
  }

  const lastMsgRow = db.get('SELECT id, role FROM chat_messages WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1', [sessionId]);
  if (!lastMsgRow || lastMsgRow.id !== messageId || lastMsgRow.role !== 'assistant') {
    throw Object.assign(new Error('Can only regenerate the last assistant message'), { status: 400, code: 'CHAT_008' });
  }

  const regionScope = { type: session.role_scope, regions: parseSessionRegionsStored(session.regions, sessionId), rtm: session.rtm || null, userRoles: req?.user?.roles || ['executive'] };
  if (!req?.user?.roles || !Array.isArray(req?.user?.roles) || req.user.roles.length === 0) {
    logger.warn('auth_roles_missing', { userId, reqUrl: req.originalUrl, usingFallback: 'executive' });
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

  if (!req?.user?.roles || !Array.isArray(req?.user?.roles) || req.user.roles.length === 0) {
    logger.warn('auth_roles_missing', { userId, reqUrl: req?.originalUrl, usingFallback: 'executive' });
  }

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

module.exports = { createSession, sendMessage, sendMessageStream, sendMessageStreamLangGraph, resumeMessageStreamLangGraph, getHistory, deleteSessionById, setMessageFeedback, regenerateLastAssistant, regenerateLastAssistantStream, regenerateLastAssistantStreamLangGraph };
