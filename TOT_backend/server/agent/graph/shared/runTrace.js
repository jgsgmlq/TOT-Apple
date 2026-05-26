'use strict';

/**
 * 轻量级 Graph 运行追踪器
 *
 * 每个 trace 函数同时做两件事：
 * 1. 追加到 state.trace_log（持久化到 content_json._trace，历史消息可见）
 * 2. 推送到 emitter.handleTrace()（实时 SSE，流式对话可见）
 *
 * 使用方式（在节点函数内）：
 *   const trace = require('../shared/runTrace');
 *   const emitter = config?.configurable?.sseEmitter;
 *   trace.nodeEnter(emitter, state, 'LoadContext');
 *   // ... node logic ...
 *   trace.nodeExit(emitter, state, 'LoadContext', { snippets: 3 });
 */

let t0BySession = new Map(); // sessionId → start timestamp (for relative ts)

function trackT0(sessionId) {
  if (!t0BySession.has(sessionId)) {
    t0BySession.set(sessionId, Date.now());
  }
}

function clearT0(sessionId) {
  t0BySession.delete(sessionId);
}

function ts(state) {
  const sid = state?.sessionId || '';
  const base = t0BySession.get(sid) || Date.now();
  return Date.now() - base;
}

function push(emitter, state, event) {
  if (state && Array.isArray(state.trace_log)) {
    state.trace_log.push(event);
  }
  if (emitter && typeof emitter.handleTrace === 'function') {
    emitter.handleTrace(event);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────

function nodeEnter(emitter, state, nodeName, metadata) {
  push(emitter, state, {
    ts: ts(state),
    type: 'node_enter',
    node: nodeName,
    data: metadata || {},
  });
}

function nodeExit(emitter, state, nodeName, metadata) {
  push(emitter, state, {
    ts: ts(state),
    type: 'node_exit',
    node: nodeName,
    data: metadata || {},
  });
}

function toolCall(emitter, state, toolName, args) {
  push(emitter, state, {
    ts: ts(state),
    type: 'tool_call',
    node: 'fc_ExecuteTool',
    data: {
      tool: toolName,
      args: summarizeArgs(args),
    },
  });
}

function toolResult(emitter, state, toolName, summary) {
  push(emitter, state, {
    ts: ts(state),
    type: 'tool_result',
    node: 'fc_ExecuteTool',
    data: {
      tool: toolName,
      ...summary,
    },
  });
}

function decision(emitter, state, decisionName, reason, metadata) {
  push(emitter, state, {
    ts: ts(state),
    type: 'decision',
    node: metadata?.node || '',
    data: {
      decision: decisionName,
      reason: reason || '',
      ...(metadata || {}),
    },
  });
}

function llmGeneration(emitter, state, metadata) {
  push(emitter, state, {
    ts: ts(state),
    type: 'llm_generation',
    node: 'fc_LlmToolCallStep',
    data: metadata || {},
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function summarizeArgs(args) {
  if (!args || typeof args !== 'object') return '(none)';
  const out = {};

  function summarizeValue(v) {
    if (v === undefined || v === null) return null;
    if (typeof v === 'string') return v.length > 80 ? v.slice(0, 77) + '...' : v;
    if (typeof v === 'number' || typeof v === 'boolean') return v;
    if (Array.isArray(v)) {
      if (v.length === 0) return [];
      if (v.length <= 15) return v.map(item => summarizeValue(item)).filter(item => item !== null);
      // 大数组：显示前 5 项 + 剩余计数
      const head = v.slice(0, 5).map(item => summarizeValue(item)).filter(item => item !== null);
      head.push(`... 还有 ${v.length - 5} 项`);
      return head;
    }
    if (typeof v === 'object') {
      const keys = Object.keys(v);
      if (keys.length === 0) return {};
      if (keys.length <= 10) {
        const obj = {};
        for (const [sk, sv] of Object.entries(v)) {
          const svSummarized = summarizeValue(sv);
          if (svSummarized !== null) obj[sk] = svSummarized;
        }
        return obj;
      }
      return `{${keys.length} keys}`;
    }
    return String(v);
  }

  for (const [k, v] of Object.entries(args)) {
    const summarized = summarizeValue(v);
    if (summarized !== null) out[k] = summarized;
  }
  return out;
}

function summarizeToolResult(result) {
  if (!result) return { ok: false };
  if (typeof result === 'string') {
    try { const p = JSON.parse(result); return summarizeToolResult(p); } catch { return { ok: true, size: result.length }; }
  }
  if (result.success === false) return { ok: false, error: result.message || result.errorCode || 'unknown' };
  const data = result.data;
  if (!data) return { ok: true };
  return {
    ok: true,
    total: data.total_count,
    rows: data.rows?.length || 0,
    taskId: data.task_id?.slice(0, 20),
    taskName: data.task_name?.slice(0, 30),
    dimension: data.dimension || undefined,
  };
}

module.exports = {
  nodeEnter,
  nodeExit,
  toolCall,
  toolResult,
  decision,
  llmGeneration,
  trackT0,
  clearT0,
  summarizeArgs,
  summarizeToolResult,
};
