'use strict';

/**
 * Langfuse Tracer (M1 scaffold)
 *
 * 语义对齐：`docs/plans/2026-04-23-agent-execution-telemetry.md`
 * 设计原则：
 *   - 可关闭 / 可降级：未配置密钥、`LANGFUSE_ENABLED !== "true"`、SDK 初始化失败，或采样未命中，
 *     对外统一返回 `NoopTrace`，所有 `.span() / .generation() / .update()` 调用均为 no-op，
 *     Executive Chat 主链路不受任何影响。
 *   - PII 脱敏（可选）：默认仅做轻量手机号 / 邮箱打码，`input / output` 入参均应包裹 `maskPII()`。
 *   - 采样：按 sessionId 哈希分桶，保证同一会话的所有 trace 要么全部上报、要么全部跳过，
 *     方便根据 trace-id 链路分析。
 *
 * M1 仅暴露 `createAgentTrace()` 与 `maskPII()`；更细粒度（tool spans、memory trace）在 M2+ 补齐。
 */

const crypto = require('crypto');
const logger = require('./logger');

// ─── Feature switches ─────────────────────────────────────────────────────────
function isEnabled() {
  return (
    process.env.LANGFUSE_ENABLED === 'true' &&
    Boolean(process.env.LANGFUSE_PUBLIC_KEY) &&
    Boolean(process.env.LANGFUSE_SECRET_KEY)
  );
}

function shouldMaskPII() {
  return process.env.LANGFUSE_MASK_PII === 'true';
}

// ─── Singleton SDK handle ─────────────────────────────────────────────────────
let langfuseClient = null;
let langfuseLoadFailed = false;

function getClient() {
  if (!isEnabled() || langfuseLoadFailed) return null;
  if (langfuseClient) return langfuseClient;
  try {
    const { Langfuse } = require('langfuse');
    langfuseClient = new Langfuse({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      baseUrl: process.env.LANGFUSE_BASEURL || 'https://cloud.langfuse.com',
      // flushAt / flushInterval 走默认值即可；node 进程退出时 SDK 自身会 best-effort flush
    });
    if (typeof langfuseClient.on === 'function') {
      langfuseClient.on('error', (err) => {
        logger.warn('langfuse_sdk_error', { message: err?.message });
      });
    }
    logger.info('langfuse_initialized', {
      baseUrl: process.env.LANGFUSE_BASEURL || 'https://cloud.langfuse.com',
      sampleRate: process.env.LANGFUSE_SAMPLE_RATE || '1.0',
      maskPII: shouldMaskPII(),
    });
  } catch (err) {
    langfuseLoadFailed = true;
    langfuseClient = null;
    logger.warn('langfuse_init_failed', { message: err.message });
  }
  return langfuseClient;
}

// ─── Sampling ─────────────────────────────────────────────────────────────────
function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function isSampled(sessionId) {
  const raw = process.env.LANGFUSE_SAMPLE_RATE;
  const rate = raw == null || raw === '' ? 1 : Number(raw);
  if (!Number.isFinite(rate) || rate >= 1) return true;
  if (rate <= 0) return false;
  if (!sessionId) return Math.random() < rate;
  return hashString(String(sessionId)) % 1000 < Math.floor(rate * 1000);
}

// ─── PII masking (lightweight) ────────────────────────────────────────────────
function maskPII(value) {
  if (!shouldMaskPII()) return value;
  if (value == null) return value;
  if (typeof value === 'string') {
    return value
      .replace(/(?:\+?86)?\b1[3-9]\d{9}\b/g, '[PHONE]')
      .replace(/[\w.\-]+@[\w.\-]+\.[a-z]{2,}/gi, '[EMAIL]');
  }
  if (Array.isArray(value)) return value.map(maskPII);
  if (typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = maskPII(value[k]);
    return out;
  }
  return value;
}

// ─── Noop fallbacks ───────────────────────────────────────────────────────────
const NOOP_SPAN = Object.freeze({
  end() {},
  update() {},
  event() {},
  span() { return NOOP_SPAN; },
  generation() { return NOOP_SPAN; },
});

const NOOP_TRACE = Object.freeze({
  id: null,
  span() { return NOOP_SPAN; },
  generation() { return NOOP_SPAN; },
  event() {},
  update() {},
});

// ─── Public API ───────────────────────────────────────────────────────────────
/**
 * 创建一次 Executive Chat 请求对应的根 Trace。
 * 返回 Langfuse Trace（真实）或 NoopTrace（降级），两者对外签名一致：
 *   trace.span({ name, input, metadata })
 *   trace.generation({ name, model, input, metadata })
 *   trace.update({ output, metadata })
 *   trace.event({ name, input, metadata })
 *
 * @param {Object} ctx
 * @param {string} [ctx.sessionId]
 * @param {string|number} [ctx.userId]
 * @param {string} [ctx.userMessage]
 * @param {string} [ctx.scopeType]   national | regional | rtm
 * @param {string} [ctx.agentMode]   function_calling | intent_routing
 * @param {string} [ctx.entryKind]   sendMessage | sendMessageStream | regenerate
 * @param {string[]} [ctx.tags]
 * @returns {Object} trace-like 对象（真实或 no-op）
 */
function createAgentTrace(ctx = {}) {
  const client = getClient();
  if (!client) return NOOP_TRACE;
  if (!isSampled(ctx.sessionId)) return NOOP_TRACE;

  try {
    const tags = [
      'exec-chat',
      'v4',
      ctx.entryKind ? `entry:${ctx.entryKind}` : null,
      ctx.scopeType ? `scope:${ctx.scopeType}` : null,
      ctx.agentMode ? `agent:${ctx.agentMode}` : null,
      ...(Array.isArray(ctx.tags) ? ctx.tags : []),
    ].filter(Boolean);

    return client.trace({
      name: 'Executive_Chat_Request',
      sessionId: ctx.sessionId || undefined,
      userId: ctx.userId != null ? String(ctx.userId) : undefined,
      input: maskPII(ctx.userMessage),
      tags,
      metadata: {
        scopeType: ctx.scopeType || null,
        agentMode: ctx.agentMode || null,
        entryKind: ctx.entryKind || null,
      },
    });
  } catch (err) {
    logger.warn('langfuse_trace_create_failed', { message: err.message });
    return NOOP_TRACE;
  }
}

/** 兜底：对传入内容做预览截断（配合 generation.output，避免单条 event 过大） */
function preview(text, max = 800) {
  if (typeof text !== 'string') return text;
  if (text.length <= max) return text;
  return text.slice(0, max) + `…(+${text.length - max}c)`;
}

// ─── Hash helpers（§5.3 / §5.10） ──────────────────────────────────────────────
/**
 * 生成 args 的 SHA1 前 12 位 hex。用于 `Tool_<name>.input.argsHash` 防止明文参数泄漏。
 * 相同参数聚合、不同参数分叉，但不保留原文。
 */
function argsHash(args) {
  try {
    return crypto.createHash('sha1')
      .update(JSON.stringify(args || {}))
      .digest('hex')
      .slice(0, 12);
  } catch (e) {
    return null;
  }
}

/**
 * 提取 args 里非 null / 非 undefined 字段名列表。
 * 只上字段名（keys），不上字段值，便于在 Langfuse UI 侧一眼看到「这次调用带了哪些类别的参数」。
 */
function keyedFields(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return [];
  return Object.keys(args).filter((k) => args[k] != null);
}

/**
 * System Prompt 的 SHA1 前 12 位 hex，用于 §5.10「Prompt 版本跟踪」。
 * 配合 `<FEATURE>_PROMPT_VERSION` 常量，在 Langfuse generation.metadata 上报
 * `{ promptVersion, promptHash }`，便于 M5 的 Bad Case 按 prompt 版本聚合。
 */
function promptHash(systemPrompt) {
  try {
    return crypto.createHash('sha1')
      .update(String(systemPrompt || ''))
      .digest('hex')
      .slice(0, 12);
  } catch (e) {
    return null;
  }
}

/**
 * 异步记忆抽取独立 Trace（`chatMemoryService.extract` 用）。
 * 原请求 Trace 已随 SSE done/HTTP response 结束，这里另起一个独立 Trace
 * 保证 LLM 调用能在 Langfuse UI 里单独成图，不依赖主请求生命周期。
 *
 * @param {Object} ctx
 * @param {string} [ctx.sessionId]
 * @param {string|number} [ctx.userId]
 * @param {string} [ctx.summary]      供脱敏后做 input（例如最近对话摘要片段）
 * @param {number} [ctx.turnCount]    触发时已累积的对话轮次
 * @param {string} [ctx.triggeredBy]  'setImmediate' | 'manual' | 'cron' ...
 * @param {string[]} [ctx.tags]
 * @returns {Object} trace-like 对象（真实或 no-op）
 */
function createMemoryTrace(ctx = {}) {
  const client = getClient();
  if (!client) return NOOP_TRACE;
  if (!isSampled(ctx.sessionId)) return NOOP_TRACE;

  try {
    const tags = [
      'exec-chat',
      'memory_extract',
      ...(Array.isArray(ctx.tags) ? ctx.tags : []),
    ].filter(Boolean);

    return client.trace({
      name: 'Memory_Extract',
      sessionId: ctx.sessionId || undefined,
      userId: ctx.userId != null ? String(ctx.userId) : undefined,
      input: maskPII(ctx.summary || null),
      tags,
      metadata: {
        turnCount: ctx.turnCount ?? null,
        triggeredBy: ctx.triggeredBy || 'setImmediate',
      },
    });
  } catch (err) {
    logger.warn('langfuse_memory_trace_create_failed', { message: err.message });
    return NOOP_TRACE;
  }
}

/**
 * 统一的 span.end 包装：output 预览/脱敏 + level 注入 + 异常吞掉。
 * 设计为 NoopSpan 安全：真实 span 与 NOOP_SPAN 都有 `.end()`，此处仅多一层保护。
 *
 * @param {{ end: Function }} span
 * @param {{ output?: any, metadata?: object, level?: 'DEBUG'|'INFO'|'WARNING'|'ERROR', statusMessage?: string }} [opts]
 */
function endSpan(span, opts = {}) {
  if (!span || typeof span.end !== 'function') return;
  try {
    const payload = {};
    if ('output' in opts) payload.output = maskPII(opts.output);
    if (opts.metadata && typeof opts.metadata === 'object') payload.metadata = opts.metadata;
    if (opts.level) payload.level = opts.level;
    if (opts.statusMessage) payload.statusMessage = String(opts.statusMessage).slice(0, 400);
    span.end(payload);
  } catch (err) {
    logger.warn('langfuse_span_end_failed', { message: err.message });
  }
}

/**
 * 统一的 generation.end 包装：usage/model/output/level/metadata 全量注入。
 * Langfuse v3 SDK 的 `generation.end({ usage })` 接受 OpenAI 风格
 * `{ prompt_tokens, completion_tokens, total_tokens }`，SDK 内部会做映射，故直接透传。
 *
 * @param {{ end: Function }} gen
 * @param {{
 *   output?: any,
 *   usage?: { prompt_tokens?: number, completion_tokens?: number, total_tokens?: number } | object,
 *   model?: string,
 *   metadata?: object,
 *   level?: 'DEBUG'|'INFO'|'WARNING'|'ERROR',
 *   statusMessage?: string,
 * }} [opts]
 */
function endGeneration(gen, opts = {}) {
  if (!gen || typeof gen.end !== 'function') return;
  try {
    const payload = {};
    if ('output' in opts) payload.output = maskPII(opts.output);
    if (opts.usage && typeof opts.usage === 'object') payload.usage = opts.usage;
    if (opts.model) payload.model = opts.model;
    if (opts.metadata && typeof opts.metadata === 'object') payload.metadata = opts.metadata;
    if (opts.level) payload.level = opts.level;
    if (opts.statusMessage) payload.statusMessage = String(opts.statusMessage).slice(0, 400);
    gen.end(payload);
  } catch (err) {
    logger.warn('langfuse_generation_end_failed', { message: err.message });
  }
}

module.exports = {
  createAgentTrace,
  createMemoryTrace,
  endSpan,
  endGeneration,
  getClient,
  maskPII,
  preview,
  argsHash,
  keyedFields,
  promptHash,
  isEnabled,
  NOOP_TRACE,
};
