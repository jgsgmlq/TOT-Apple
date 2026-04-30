'use strict';

/**
 * middleware/errorHandler.js
 * 统一错误响应格式：{ code, message, data, requestId }
 */

function errorHandler(err, req, res, next) {
  // SSE 路径出错时，service 已经把 SSE error 事件写出并 res.end()，再写一次会触发
  // ERR_HTTP_HEADERS_SENT 让前端拿到 500 而非干净的 SSE error。看到标记直接静默返回。
  if (err && err._sseResponseSent) {
    return;
  }
  if (res.headersSent) {
    // 兜底：标记没打但 headers 已发的极端情况，交给 Express 默认行为关连接，不再写 body
    return next(err);
  }

  const status = err.status || err.statusCode || 500;
  const message = err.message || '服务器内部错误';

  const payload = {
    code: status,
    message,
    data: null,
    requestId: req.requestId || null,
  };

  // 兼容联调：业务错误可携带稳定 errorCode，便于前端分支处理
  if (err.errorCode) {
    payload.errorCode = err.errorCode;
  }

  // 客户端可恢复的预期错误（如本地仍缓存已删会话 id）不打满栈，避免 seed/刷新后刷屏
  if (err.errorCode === 'CHAT_003') {
    console.warn('[expected]', status, message, err.errorCode);
  } else {
    console.error('DEBUG ERR:', err.stack);
    payload.stack = err.stack;
  }
  res.status(status).json(payload);
}

/**
 * 业务错误工厂函数，统一 throw 格式
 * 用法：throw createError(403, '无权限', 'AUTH_003')
 */
function createError(status, message, errorCode) {
  const err = new Error(message);
  err.status = status;
  err.errorCode = errorCode;
  return err;
}

module.exports = { errorHandler, createError };
