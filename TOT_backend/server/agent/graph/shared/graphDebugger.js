'use strict';

/**
 * Graph 终端调试追踪器
 *
 * 通过包装节点函数和路由函数，在终端输出完整的图执行链路。
 * 启用条件：DEBUG_GRAPH=true 或 LOG_LEVEL=debug
 * 关闭时零开销：maybeWrap* 直接返回原函数。
 */

const logger = require('../../../utils/logger');

let stepCounter = 0;

function isEnabled() {
  return (
    process.env.DEBUG_GRAPH === 'true' ||
    (process.env.LOG_LEVEL || '').toLowerCase() === 'debug'
  );
}

function formatElapsed(ms) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * 提取节点返回对象中的 key 列表（即该节点写入的 state 字段）。
 * 过滤掉 messages，因为 messages 的摘要太长且不直观。
 */
function wroteKeys(result) {
  if (!result || typeof result !== 'object') return [];
  return Object.keys(result).filter((k) => k !== 'messages');
}

/**
 * 包装节点函数：记录 entry / exit(含耗时+wroteKeys) / error
 */
function wrapNode(name, fn) {
  return async (state, config) => {
    const step = ++stepCounter;
    const sessionId = state.sessionId || (config?.configurable?.thread_id) || '';
    const t0 = Date.now();

    logger.debug('graph_node_enter', {
      node: name,
      sessionId,
      graphStep: step,
    });

    try {
      const result = await fn(state, config);
      const elapsed = Date.now() - t0;
      const keys = wroteKeys(result);

      logger.debug('graph_node_exit', {
        node: name,
        elapsed: formatElapsed(elapsed),
        elapsedMs: elapsed,
        wroteKeys: keys.length ? keys : undefined,
        sessionId,
        graphStep: step,
      });

      return result;
    } catch (err) {
      const elapsed = Date.now() - t0;
      logger.error('graph_node_error', {
        node: name,
        elapsed: formatElapsed(elapsed),
        elapsedMs: elapsed,
        error: err.message,
        code: err.code || undefined,
        sessionId,
        graphStep: step,
      });
      throw err;
    }
  };
}

/**
 * 包装条件路由函数：记录路由决策
 */
function wrapRoute(fromName, fn) {
  return (state) => {
    const sessionId = state.sessionId || '';
    const decision = fn(state);

    logger.debug('graph_route', {
      from: fromName,
      to: decision,
      sessionId,
    });

    return decision;
  };
}

/**
 * 条件包装：未启用时直接返回原函数
 */
function maybeWrapNode(name, fn) {
  return isEnabled() ? wrapNode(name, fn) : fn;
}

function maybeWrapRoute(fromName, fn) {
  return isEnabled() ? wrapRoute(fromName, fn) : fn;
}

/** 重置步数计数器（每次 run 前调用） */
function resetStepCounter() {
  stepCounter = 0;
}

module.exports = { maybeWrapNode, maybeWrapRoute, resetStepCounter, isEnabled };
