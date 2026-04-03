'use strict';

/**
 * middleware/errorHandler.js
 * 统一错误响应格式：{ code, message, data, requestId }
 */

function errorHandler(err, req, res, next) {
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

  console.error("DEBUG ERR:", err.stack); payload.stack = err.stack; res.status(status).json(payload);
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
