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
  createSseSender,
};
