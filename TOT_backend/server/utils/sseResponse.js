'use strict';

/**
 * 与看板智能洞察、Executive Chat 流式接口共用的 SSE 响应头与写入格式。
 * 约定：`event: delta` | `done` | `error`，`data` 为单行 JSON。
 *
 * @param {import('express').Response} res
 */
function writeSseHeaders(res) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
}

/**
 * SSE keepalive：每隔 intervalMs 发送 SSE 注释行，防止代理/负载均衡器因
 * 长时间无数据而断开连接。SSE 规范以 `:` 开头的行视为注释，客户端会忽略。
 *
 * @param {import('express').Response} res
 * @param {number} [intervalMs=15000]
 * @returns {() => void} 停止 keepalive 的函数
 */
function startSseKeepalive(res, intervalMs = 15000) {
  const timer = setInterval(() => {
    if (res.writableEnded || res.destroyed) {
      clearInterval(timer);
      return;
    }
    res.write(': heartbeat\n\n');
  }, intervalMs);

  // 连接意外关闭时清理
  res.on('close', () => clearInterval(timer));

  return () => clearInterval(timer);
}

/**
 * @param {import('express').Response} res
 * @returns {(event: string, data: unknown) => void}
 */
function createSseSender(res) {
  return function send(event, data) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
}

module.exports = {
  writeSseHeaders,
  startSseKeepalive,
  createSseSender,
};
