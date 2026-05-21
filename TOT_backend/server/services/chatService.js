'use strict';

const { nanoid }       = require('nanoid');
const { getDb }    = require('../db');
const chatCrud = require('../modules/dashboard/crud/chatCrud');
const mysql = require('../modules/common/db/mysql');
const { formatNowSqliteLocal } = require('../utils/ddlAt');
const logger = require('../utils/logger');
const { compressAssistantContent } = require('../utils/chatHistoryCompress');
const AGENT_MODE = process.env.CHAT_AGENT_MODE || 'function_calling';
const chatSessionStateService = require('./chatSessionStateService');
const chatMemoryService = require('./chatMemoryService');
const { writeSseHeaders, startSseKeepalive, createSseSender } = require('../utils/sseResponse');
const { createAgentTrace, endSpan, maskPII, preview, NOOP_TRACE } = require('../utils/tracer');
const { buildGraph } = require('../agent/graph/graph');
const { SqliteSaver } = require('@langchain/langgraph-checkpoint-sqlite');
const { Langfuse } = require('langfuse');
const { HumanMessage, AIMessage, ToolMessage } = require("@langchain/core/messages");

// ─── Region scope resolver ────────────────────────────────────────────────────
function resolveRegionScope(reqUser) {
  const roles = reqUser?.roles;
  if (!roles || !Array.isArray(roles) || roles.length === 0) {
    throw Object.assign(new Error('User roles are missing or invalid'), { status: 403, code: 'AUTH_005' });
  }
  if (reqUser.rtm) {
    return { type: 'rtm', rtm: reqUser.rtm, regions: null, userRoles: roles };
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
    // 检测是否是结构化 JSON (FinalResponse 输出)
    let replyContent = null;
    try {
      const parsed = JSON.parse(md);
      if (parsed && typeof parsed.overview === 'string') {
        replyContent = {
          overview: parsed.overview,
          keyNumbers: Array.isArray(parsed.keyNumbers) ? parsed.keyNumbers : [],
          attentionPoints: Array.isArray(parsed.attentionPoints) ? parsed.attentionPoints : [],
          followUpSuggestions: Array.isArray(parsed.followUpSuggestions) ? parsed.followUpSuggestions : [],
          ...(Array.isArray(parsed.visualizations) ? { visualizations: parsed.visualizations } : {}),
          ...(parsed.statisticsProvenance ? { statisticsProvenance: parsed.statisticsProvenance } : {}),
          ...(parsed.forecastDisclaimer ? { forecastDisclaimer: parsed.forecastDisclaimer } : {}),
          ...(parsed.table ? { table: parsed.table } : {}),
          ...(Array.isArray(parsed.tables) ? { tables: parsed.tables } : {}),
        };
      }
    } catch (_) { /* not JSON, keep as plain markdown */ }
    return { replyContent, markdownContent: md };
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

/**
 * 从结构化 JSON（content_json 或 FinalResponse JSON）提取 ReplyContent。
 * 与 buildExecutiveMessageApiData 逻辑一致，但接受已解析的对象。
 */
function buildReplyContentFromStructured(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  if (!parsed.overview && !parsed.keyNumbers && !parsed.attentionPoints && !parsed.followUpSuggestions) return null;
  return {
    overview: parsed.overview || '',
    keyNumbers: Array.isArray(parsed.keyNumbers) ? parsed.keyNumbers : [],
    attentionPoints: Array.isArray(parsed.attentionPoints) ? parsed.attentionPoints : [],
    followUpSuggestions: Array.isArray(parsed.followUpSuggestions) ? parsed.followUpSuggestions : [],
    ...(Array.isArray(parsed.visualizations) ? { visualizations: parsed.visualizations } : {}),
    ...(parsed.statisticsProvenance && typeof parsed.statisticsProvenance === 'object' ? { statisticsProvenance: parsed.statisticsProvenance } : {}),
    ...(typeof parsed.forecastDisclaimer === 'string' ? { forecastDisclaimer: parsed.forecastDisclaimer } : {}),
    ...(parsed.table && typeof parsed.table === 'object' ? { table: parsed.table } : {}),
    ...(Array.isArray(parsed.tables) ? { tables: parsed.tables } : {}),
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

function buildClarifySsePayload(interruptPayload, requestId, extra = {}) {
  const payload = interruptPayload && typeof interruptPayload === 'object' ? interruptPayload : {};
  const prompt = payload.prompt || payload.message || '需要您补充一些信息后才能继续。';
  return {
    code: 202,
    message: prompt,
    data: {
      ...payload,
      prompt,
      resumeToken: payload.resume_token || payload.resumeToken || null,
      threadId: extra.threadId || null,
      payload,
    },
    requestId,
  };
}

function buildInterruptedDonePayload(interruptPayload, sessionId, requestId, responseTime, timestamp, extra = {}) {
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
      threadId: extra.threadId || null,
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

async function buildExampleQuestions() {
  const task = await chatCrud.getLatestDispatchedTask();
  const taskRef = task ? `"${task.title}"` : '最近的';
  return [
    `${taskRef}培训完成率是多少？`,
    '有哪些门店需要重点关注？',
    '现在有哪些进行中的培训任务？',
  ];
}

// ─── createSession ────────────────────────────────────────────────────────────
async function createSession(userId, reqUser, ipAddress) {
  const user = await chatCrud.getUserById(userId);
  if (!user) throw Object.assign(new Error('User not found'), { status: 404, code: 'CHAT_002' });

  // 必须将原始请求中解析出的 roles 合并到 DB 查询出的 user 对象中
  const combinedUser = { ...user, roles: reqUser?.roles || ['executive'] };
  const regionScope = resolveRegionScope(combinedUser);
  const sessionId = nanoid();

  await chatCrud.createSession({
    id: sessionId,
    userId,
    entryType: 'executive',
    scopeType: regionScope.type,
    scopeRegionsJson: regionScope.regions ? JSON.stringify(regionScope.regions) : null,
    scopeRtm: regionScope.rtm || null,
    ipAddress: ipAddress || null,
  });

  return { sessionId, contextId: sessionId, exampleQuestions: await buildExampleQuestions() };
}

async function handleIncomingMessage(sessionId, userMessage, userId, reqBody = {}, trace = null) {
  const { clarificationResponse, messageId } = reqBody;
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
      const existing = await chatCrud.getMessageByClientId(messageId);
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
      await chatCrud.insertMessage({
        id: toolMsgId, sessionId, role: 'tool',
        contentText: JSON.stringify(clarificationResponse.result),
        toolCallId: clarificationResponse.toolCallId,
      });

      const userMsgId = nanoid();
      await chatCrud.insertMessage({
        id: userMsgId, sessionId, role: 'user',
        contentText: userMessage,
        clientMessageId: messageId || null,
      });
      endSpan(persistSpan, {
        output: 'clarify_turn',
        metadata: { status: 'ok', wroteRows: 2, kind: 'clarification', durationMs: Date.now() - t0 },
      });
      return true;
    }

    // 普通消息
    const userMsgId = nanoid();
    await chatCrud.insertMessage({
      id: userMsgId, sessionId, role: 'user',
      contentText: userMessage,
      clientMessageId: messageId || null,
    });
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

// ─── Shared SSE context factory ──────────────────────────────────────────────────
// Extracts the boilerplate (writeSseHeaders / createSseSender / keepalive /
// AbortController / req.on('close') / counters) shared by sendMessageStreamLangGraph,
// resumeMessageStreamLangGraph, and regenerateLastAssistantStreamLangGraph.
// Returns a context object; callers build their own sseEmitter and error handling.

function createSseContext(req, res, trace, extra = {}) {
  writeSseHeaders(res);
  const send = createSseSender(res);
  const stopKeepalive = startSseKeepalive(res);
  const abortController = new AbortController();

  const sseSpan = trace.span({
    name: 'SSE_Stream',
    input: extra.spanInput || { sessionId: extra.sessionId },
  });

  const counters = { deltaCount: 0, deltaBytes: 0, reasoningCount: 0, toolStartCount: 0 };
  const clientAborted = { value: false };

  req.on('close', () => {
    if (res.headersSent) {
      clientAborted.value = true;
      abortController.abort();
    }
  });

  const wrappedSend = (event, payload) => send(event, payload);

  return { send, wrappedSend, abortController, stopKeepalive, sseSpan, counters, clientAborted };
}

/**
 * Shared abort-error handler. Returns true if the error was a client abort and has
 * been fully handled (span closed, trace updated). Returns false for real errors
 * that the caller still needs to handle.
 */
function handleSseClientAbort(err, ctx, { trace, sessionId, loggerTag }) {
  const abortDiagnostics = buildStreamAbortDiagnostics(err, null, null, ctx.abortController.signal, ctx.clientAborted.value);
  if (isLikelyClientAbortError(err, ctx.abortController.signal, ctx.clientAborted.value)) {
    logger.info(loggerTag, { sessionId, ...abortDiagnostics });
    endSpan(ctx.sseSpan, {
      output: null,
      level: 'WARNING',
      metadata: { status: 'aborted', ...ctx.counters },
    });
    if (trace && trace !== NOOP_TRACE) {
      trace.update({ output: null, metadata: { status: 'aborted', reason: 'client_abort' } });
    }
    return true;
  }
  return false;
}
async function loadFormattedHistory(sessionId, trace = null) {
  const loadSpan = trace && typeof trace.span === 'function'
    ? trace.span({ name: 'Load_History', input: { sessionId } })
    : null;
  const t0 = Date.now();
  try {
    const limit = Number(process.env.CHAT_HISTORY_MAX_ROWS || 100);
    const rows = await chatCrud.getMessages(sessionId);
    const limited = rows.slice(0, limit);
    const formatted = limited.map((r) => ({
      role: r.role,
      content: r.role === 'assistant' ? compressAssistantContent(r.content_text) : r.content_text,
      tool_calls: r.tool_calls_json ? JSON.parse(r.tool_calls_json) : undefined,
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

/** 将 loadFormattedHistory 返回的行转换为 LangChain 消息对象，用于注入图的 messages 状态 */
function historyToLangChainMessages(rows) {
  const msgs = [];
  for (const r of rows) {
    if (r.role === 'user') {
      msgs.push(new HumanMessage(r.content));
    } else if (r.role === 'assistant') {
      const opts = {};
      if (r.tool_calls) opts.tool_calls = r.tool_calls;
      msgs.push(new AIMessage({ content: r.content, ...opts }));
    } else if (r.role === 'tool') {
      msgs.push(new ToolMessage({ content: r.content, tool_call_id: r.tool_call_id || '' }));
    }
  }
  return msgs;
}

// ─── sendMessage (Non-stream) ──────────────────────────────────────────────────
async function sendMessage(sessionId, userMessage, userId, req = {}) {
  const session = await chatCrud.getSession(sessionId);
  if (!session) throw Object.assign(new Error('Session not found'), { status: 404, code: 'CHAT_003' });
  if (String(session.user_id) !== String(userId)) throw Object.assign(new Error('Forbidden'), { status: 403, code: 'CHAT_004' });

  const regionScope = {
    type: session.scope_type,
    regions: parseSessionRegionsStored(session.scope_regions_json, sessionId),
    rtm: session.scope_rtm || null,
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
  const history = await loadFormattedHistory(sessionId, trace);

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
    await chatCrud.insertMessage({
      id: assistMsgId, sessionId, role: 'assistant',
      contentText: finalContent,
      intentType: result._intentType || null,
      toolCallsJson: toolCallsStr,
    });
    await chatCrud.updateSessionActive(sessionId);
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
async function resumeMessageStreamLangGraph(sessionId, resumePayload, threadId, userId, req, res) {
  if (!threadId || !threadId.startsWith(`${sessionId}:`)) {
    throw Object.assign(new Error('threadId 与 sessionId 不匹配'), { status: 400, code: 'CHAT_011' });
  }

  const session = await chatCrud.getSession(sessionId);
  if (!session) {
    res.status(404).json({ code: 404, message: '会话不存在', errorCode: 'CHAT_003', requestId: req.requestId });
    return;
  }
  if (String(session.user_id) !== String(userId)) {
    res.status(403).json({ code: 403, message: '无权访问此会话', errorCode: 'CHAT_004', requestId: req.requestId });
    return;
  }

  const regionScope = {
    type: session.scope_type,
    regions: parseSessionRegionsStored(session.scope_regions_json, sessionId),
    rtm: session.scope_rtm || null,
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

  const sseCtx = createSseContext(req, res, trace, { sessionId, spanInput: { sessionId, resumePayload } });
  const startMs = Date.now();

  const sseEmitter = {
    handleLLMNewToken: (token, info = {}) => {
      const phase = info.isReasoning ? 'reasoning' : 'content';
      if (phase === 'reasoning') sseCtx.counters.reasoningCount += 1;
      if (typeof token === 'string' && token) {
        sseCtx.counters.deltaCount += 1;
        sseCtx.counters.deltaBytes += token.length;
      }
      sseCtx.wrappedSend('delta', { text: token, phase });
    },
    handleToolStart: (toolInfo) => {
      sseCtx.counters.toolStartCount += 1;
      sseCtx.wrappedSend('delta', { text: toolInfo?.name || '', phase: 'tool_start', toolName: toolInfo?.name });
    },
    handleToolEnd: (result) => {
      sseCtx.wrappedSend('delta', { text: '', phase: 'tool_end', status: 'success' });
    },
    handleError: (message) => {
      sseCtx.wrappedSend('error', { message, code: 'CHAT_500' });
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
        thread_id: threadId,
        sseEmitter,
        traceId: trace ? trace.id : undefined
      },
      recursionLimit: 60,
      signal: sseCtx.abortController.signal
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
      sseCtx.wrappedSend('clarify', buildClarifySsePayload(interruptPayload, req.requestId, { threadId }));
      sseCtx.wrappedSend('done', buildInterruptedDonePayload(interruptPayload, sessionId, req.requestId, responseTime, timestamp, { threadId }));
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

    endSpan(sseCtx.sseSpan, { output: 'success' });

    sseCtx.wrappedSend('done', donePayload);
    res.end();
    return result;

  } catch (err) {
    if (handleSseClientAbort(err, sseCtx, { trace, sessionId, loggerTag: 'chat_stream_langgraph_aborted' })) {
      return;
    }

    const abortDiagnostics = buildStreamAbortDiagnostics(err, req, res, sseCtx.abortController.signal, sseCtx.clientAborted.value);
    logger.error('chat_langgraph_resume_error', {
      sessionId,
      error: err.stack,
      ...abortDiagnostics,
    });
    endSpan(sseCtx.sseSpan, { level: 'ERROR', statusMessage: err.message });
    if (res.headersSent) {
      try { sseCtx.wrappedSend('error', buildSseErrorPayload('Agent LangGraph 唤醒出错', err.code || 'CHAT_500', err.status || 500, req.requestId)); } catch (_) {}
      try { res.end(); } catch (_) {}
      err._sseResponseSent = true;
    } else {
      sseCtx.wrappedSend('error', buildSseErrorPayload('Agent LangGraph 唤醒出错', err.code || 'CHAT_500', err.status || 500, req.requestId));
    }
    throw err;
  }
}

// ─── sendMessageStreamLangGraph (T1 Phase 2 调试专用) ────────────────────────────────
async function sendMessageStreamLangGraph(sessionId, userMessage, userId, req, res, options = {}) {
  const session = await chatCrud.getSession(sessionId);
  if (!session) {
    res.status(404).json({ code: 404, message: '会话不存在', errorCode: 'CHAT_003', requestId: req.requestId });
    return;
  }
  if (String(session.user_id) !== String(userId)) {
    res.status(403).json({ code: 403, message: '无权访问此会话', errorCode: 'CHAT_004', requestId: req.requestId });
    return;
  }

  const regionScope = {
    type: session.scope_type,
    regions: parseSessionRegionsStored(session.scope_regions_json, sessionId),
    rtm: session.scope_rtm || null,
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

  const sseCtx = createSseContext(req, res, trace, { sessionId });
  const startMs = Date.now();

  const sseEmitter = {
    handleLLMNewToken: (token, info = {}) => {
      const phase = info.isReasoning ? 'reasoning' : 'content';
      if (phase === 'reasoning') sseCtx.counters.reasoningCount += 1;
      if (typeof token === 'string' && token) {
        sseCtx.counters.deltaCount += 1;
        sseCtx.counters.deltaBytes += token.length;
      }
      sseCtx.wrappedSend('delta', { text: token, phase });
    },
    handleToolStart: (toolInfo) => {
      sseCtx.counters.toolStartCount += 1;
      sseCtx.wrappedSend('delta', { text: '', phase: 'tool_start', toolName: toolInfo.name });
    },
    handleToolEnd: (result) => {
      sseCtx.wrappedSend('delta', { text: '', phase: 'tool_end', status: 'success' });
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

    const historyRows = await loadFormattedHistory(sessionId, trace);
    const historyMessages = historyToLangChainMessages(historyRows);

    const allSessionMessages = await chatCrud.getMessages(sessionId);
    const lastAssistantRow = [...allSessionMessages].reverse().find(m => m.role === 'assistant') || null;

    const inputState = {
      userMessage,
      sessionId,
      userId: session.user_id.toString(),
      regionScope,
      messages: historyMessages,
      prevIntent: lastAssistantRow?.intent_type || '',
      prevEntities: {}
    };

    const threadId = `${sessionId}:${nanoid()}`;
    const thread = {
      configurable: {
        thread_id: threadId,
        sseEmitter,
        // 将外层建好的 root TraceId 注入，好让子节点（Router 和 FC模型）生成的 Span 都挂在这棵树下
        traceId: trace ? trace.id : undefined
      },
      recursionLimit: 60,
      signal: sseCtx.abortController.signal
    };

    const finalState = await app.invoke(inputState, thread);

    const interruptPayload = extractLangGraphInterrupt(finalState);
    if (interruptPayload) {
      const responseTime = Date.now() - startMs;
      const timestamp = formatNowSqliteLocal();
      sseCtx.wrappedSend('clarify', buildClarifySsePayload(interruptPayload, req.requestId, { threadId }));
      sseCtx.wrappedSend('done', buildInterruptedDonePayload(interruptPayload, sessionId, req.requestId, responseTime, timestamp, { threadId }));
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

    endSpan(sseCtx.sseSpan, { output: 'success' });

    sseCtx.wrappedSend('done', {
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
    if (handleSseClientAbort(err, sseCtx, { trace, sessionId, loggerTag: 'chat_stream_langgraph_aborted' })) {
      // Abort 路径也要 throw，否则上层（如 regenerate wrapper）的 catch 不会触发，
      // 导致 restoreOldMessage 跳过、旧消息永久丢失、用户再点重新生成会 400。
      try {
        sseCtx.wrappedSend('error', buildSseErrorPayload('请求被中断', 'CHAT_ABORT', 499, req.requestId));
      } catch (_) {}
      try { res.end(); } catch (_) {}
      err._sseResponseSent = true;
      err._abortedAfterDelete = true;
      throw err;
    }

    const abortDiagnostics = buildStreamAbortDiagnostics(err, req, res, sseCtx.abortController.signal, sseCtx.clientAborted.value);
    logger.error('chat_langgraph_stream_error', {
      sessionId,
      error: err.stack,
      ...abortDiagnostics,
    });
    endSpan(sseCtx.sseSpan, { level: 'ERROR', statusMessage: err.message });
    if (res.headersSent) {
      try { sseCtx.wrappedSend('error', buildSseErrorPayload('Agent LangGraph 执行出错', err.code || 'CHAT_500', err.status || 500, req.requestId)); } catch (_) {}
      try { res.end(); } catch (_) {}
      err._sseResponseSent = true;
    } else {
      sseCtx.wrappedSend('error', buildSseErrorPayload('Agent LangGraph 执行出错', err.code || 'CHAT_500', err.status || 500, req.requestId));
    }
    throw err;
  }
}
// ─── getHistory ───────────────────────────────────────────────────────────────
async function getHistory(sessionId, pageNum, pageSize) {
  const offset = (pageNum - 1) * pageSize;
  const total = await chatCrud.getMessageCount(sessionId);

  const allMessages = await chatCrud.getMessages(sessionId);
  const pageMessages = allMessages.slice(offset, offset + pageSize);

  // 查询消息反馈
  const sessionInfo = await chatCrud.getSession(sessionId);
  let feedbackMap = {};
  if (sessionInfo && pageMessages.length > 0) {
    const messageIds = pageMessages.map(m => m.id);
    const placeholders = messageIds.map(() => '?').join(',');
    const feedbackRows = await mysql.all(
      `SELECT message_id, feedback_type FROM chat_message_feedback WHERE message_id IN (${placeholders}) AND user_id = ?`,
      [...messageIds, sessionInfo.user_id]
    );
    for (const fb of feedbackRows) {
      feedbackMap[fb.message_id] = fb.feedback_type;
    }
  }

  const historyList = pageMessages.map((r) => {
    let replyContent = null;
    let markdownContent = null;
    if (r.role === 'assistant') {
      const normalizedContent = typeof r.content_text === 'string' ? r.content_text : '';
      markdownContent = normalizedContent || null;

      // content_json (MySQL JSON 列) 可能已被驱动解析为对象
      const contentJson =
        r.content_json && typeof r.content_json === 'object' ? r.content_json : null;

      try {
        const parsed = JSON.parse(normalizedContent);
        if (parsed && typeof parsed === 'object') {
          if (typeof parsed.markdownContent === 'string' && parsed.markdownContent.trim()) {
            markdownContent = parsed.markdownContent.trim();
          }
          if (parsed.replyContent && typeof parsed.replyContent === 'object') {
            replyContent = parsed.replyContent;
          } else {
            replyContent = buildReplyContentFromStructured(parsed);
          }
        }
      } catch (_) {
        // content_text 不是 JSON（如 FinalResponse 只存了 overview 文本），
        // 回退到 content_json（结构化数据单独存储）
        if (contentJson) {
          replyContent = buildReplyContentFromStructured(contentJson);
          const ov = typeof contentJson.overview === 'string' ? contentJson.overview : '';
          if (ov && !markdownContent) markdownContent = ov;
        }
      }
    }
    return {
      messageId: r.id,
      role: r.role,
      content: markdownContent || r.content_text,
      markdownContent,
      replyContent,
      intentType: r.intent_type,
      userFeedback: r.role === 'assistant' ? (feedbackMap[r.id] || null) : undefined,
      timestamp: r.created_at,
    };
  });

  return {
    historyList,
    pagination: { pageNum, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}

// ─── setMessageFeedback ───────────────────────────────────────────────────────
async function setMessageFeedback(sessionId, messageId, userId, feedback) {
  const msg = await chatCrud.getMessageById(messageId);
  if (!msg || msg.session_id !== sessionId) throw Object.assign(new Error('Message not found'), { status: 404, code: 'CHAT_007' });
  if (msg.role !== 'assistant') throw Object.assign(new Error('Can only provide feedback for assistant messages'), { status: 400, code: 'CHAT_006' });

  if (feedback === 'none') {
    await chatCrud.deleteFeedback(messageId, userId);
  } else if (feedback === 'like' || feedback === 'dislike') {
    await chatCrud.insertFeedback({ id: nanoid(), messageId, userId, feedbackType: feedback });
  } else {
    throw Object.assign(new Error('Invalid feedback type'), { status: 400, code: 'CHAT_006' });
  }
}

// ─── regenerateLastAssistantStreamLangGraph ──────────────────────────────────
async function regenerateLastAssistantStreamLangGraph(sessionId, messageId, userId, req, res) {
  const session = await chatCrud.getSession(sessionId);
  if (!session) {
    res.status(404).json({ code: 404, message: 'Session not found', errorCode: 'CHAT_003' });
    return;
  }
  if (String(session.user_id) !== String(userId)) {
    res.status(403).json({ code: 403, message: 'Forbidden', errorCode: 'CHAT_004' });
    return;
  }

  const lastMsgRow = await chatCrud.getLastAssistantMessage(sessionId);
  if (!lastMsgRow || lastMsgRow.id !== messageId) {
    res.status(400).json({ code: 400, message: 'Can only regenerate the last assistant message', errorCode: 'CHAT_008' });
    return;
  }

  // 获取上一个 user message
  const chronological = await loadFormattedHistory(sessionId, NOOP_TRACE);
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

  // 1. 删除旧消息：先快照，再软删除（chatCrud 使用 deleted_at 标记）。
  // 流式失败时尝试还原，避免出现「旧消息已删 + 新消息没生成 + 用户彻底丢失原回复」。
  const allMsgs = await chatCrud.getMessages(sessionId);
  const oldMessageRow = allMsgs.find(m => m.id === messageId) || null;
  const oldFeedbackRows = await mysql.all(
    'SELECT * FROM chat_message_feedback WHERE message_id = ?',
    [messageId]
  );

  await chatCrud.deleteMessage(messageId);
  await mysql.run('DELETE FROM chat_message_feedback WHERE message_id = ?', [messageId]);

  const restoreOldMessage = async () => {
    if (!oldMessageRow) return;
    try {
      await chatCrud.insertMessage({
        id: oldMessageRow.id,
        sessionId: oldMessageRow.session_id,
        role: oldMessageRow.role,
        contentText: oldMessageRow.content_text,
        intentType: oldMessageRow.intent_type,
        toolCallsJson: oldMessageRow.tool_calls_json,
        toolCallId: oldMessageRow.tool_call_id,
        clientMessageId: oldMessageRow.client_message_id,
      });
      for (const fb of oldFeedbackRows || []) {
        await chatCrud.insertFeedback({
          id: fb.id,
          messageId: fb.message_id,
          userId: fb.user_id,
          feedbackType: fb.feedback_type,
        });
      }
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
    await restoreOldMessage();
    throw err;
  }
}



async function deleteSessionById(sessionId) {
  await chatCrud.softDeleteSessionMessages(sessionId);
  await chatCrud.softDeleteSession(sessionId);
  chatSessionStateService.clearSession(sessionId);
}

module.exports = { createSession, sendMessage, sendMessageStreamLangGraph, resumeMessageStreamLangGraph, getHistory, deleteSessionById, setMessageFeedback, regenerateLastAssistantStreamLangGraph };
