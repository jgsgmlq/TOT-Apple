'use strict';

/**
 * Executive Chat FC 节点共用 helper。
 *
 * 抽这一层是为了消除多个 FC 节点（fc_CheckDuplicate / fc_ValidateParams /
 * fc_ParamRepair / fc_ExecuteTool / fc_MergeToolResults）里重复的 anti-pattern：
 *   - 各自访问 `state.messages[state.messages.length - 1]` 拿 lastMsg
 *   - 各自手写 ToolMessage 构造、签名计算、JSON.stringify 防御
 *
 * 这些工具都是无状态的纯函数，不引入 chatToolsService / state graph 依赖，
 * 方便在测试和 renderer 端复用。
 */

const crypto = require('crypto');
const { ToolMessage } = require('@langchain/core/messages');

// ─── arg 规范化（同语义不同写法 → 相同 signature） ────────────────────────
//   - 递归排序 key（`{a,b}` ≡ `{b,a}`）
//   - 数字字符串归一为数字（`"3"` ≡ `3`）
//   - 空白裁剪、null/undefined 视为缺失（不进入序列化）
function normalizeArgValue(v) {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (trimmed === '') return undefined;
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
    return trimmed;
  }
  if (Array.isArray(v)) {
    return v.map(normalizeArgValue).filter(x => x !== undefined);
  }
  if (typeof v === 'object') {
    return canonicalizeArgs(v);
  }
  return v;
}

function canonicalizeArgs(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return normalizeArgValue(args);
  }
  const out = {};
  for (const k of Object.keys(args).sort()) {
    const norm = normalizeArgValue(args[k]);
    if (norm !== undefined) out[k] = norm;
  }
  return out;
}

function safeParseJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

const DEDUP_BUCKET_MS = Number(process.env.CHAT_DEDUP_BUCKET_MS || 60_000);

/**
 * 同语义 args + scope + 时间桶 算唯一 signature（md5），用作 cache / 去重 key。
 * 接受 args 为对象或 JSON 字符串两种形式。
 * nowMs 参数可选，方便单测注入；默认用 Date.now()。
 */
function buildToolSignature(toolName, args, scopeFingerprint, opts = {}) {
  const { nowMs = Date.now(), bucketMs } = opts;
  const parsed = typeof args === 'string' ? (safeParseJson(args) ?? args) : args;
  const canonical = canonicalizeArgs(parsed);
  const argsStr = typeof canonical === 'object' ? JSON.stringify(canonical) : String(canonical);
  const effectiveBucket = bucketMs || DEDUP_BUCKET_MS;
  const bucket = effectiveBucket > 0 ? Math.floor(nowMs / effectiveBucket) : nowMs;
  return crypto
    .createHash('md5')
    .update(`${toolName}|${argsStr}|${scopeFingerprint || ''}|${bucket}`)
    .digest('hex');
}

/**
 * 从后向前找最近一条带 tool_calls 的 AIMessage。
 * fc_MergeToolResults / fc_CheckDuplicate 都需要锚定这条消息，
 * 比简单取 `messages[length - 1]` 更稳健（中间可能被 ToolMessage / SystemMessage 隔开）。
 *
 * 返回 { anchor, anchorIdx, toolCalls } —— 找不到时 anchor=null, toolCalls=[]。
 */
function getLastAiToolCalls(state) {
  const messages = state?.messages || [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (
      m &&
      typeof m._getType === 'function' &&
      m._getType() === 'ai' &&
      Array.isArray(m.tool_calls) &&
      m.tool_calls.length > 0
    ) {
      return { anchor: m, anchorIdx: i, toolCalls: m.tool_calls };
    }
  }
  return { anchor: null, anchorIdx: -1, toolCalls: [] };
}

/**
 * JSON.stringify 加循环引用 / NaN / Infinity 防御。
 * 序列化失败时返回 `'{"error":"unstringifiable"}'` 占位，永不抛错。
 */
function safeJsonContent(value) {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, (k, v) => {
      if (typeof v === 'number' && !Number.isFinite(v)) return null;
      return v;
    });
  } catch {
    return JSON.stringify({ error: 'unstringifiable' });
  }
}

/**
 * 标准 ToolMessage 构造，统一 tool_call_id / name / content 的处理。
 * statusMeta 暂未使用（保留接口，未来可能附带 status/timing 元数据）。
 */
function makeToolMessage(toolCall, content, statusMeta = {}) {
  return new ToolMessage({
    tool_call_id: toolCall?.id || 'unknown_call_id',
    name: toolCall?.name || 'unknown_tool',
    content: typeof content === 'string' ? content : safeJsonContent(content),
    ...(statusMeta && Object.keys(statusMeta).length > 0 ? { additional_kwargs: statusMeta } : {}),
  });
}

module.exports = {
  normalizeArgValue,
  canonicalizeArgs,
  safeParseJson,
  buildToolSignature,
  getLastAiToolCalls,
  safeJsonContent,
  makeToolMessage,
};
