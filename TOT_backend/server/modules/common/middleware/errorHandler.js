'use strict';

function errorHandler(err, req, res, next) {
  if (err && err._sseResponseSent) { return; }
  if (res.headersSent) { return next(err); }

  const status = err.status || err.statusCode || 500;
  const message = err.message || '服务器内部错误';

  const payload = { code: status, message, data: null, requestId: req.requestId || null };
  if (err.errorCode) { payload.errorCode = err.errorCode; }

  if (err.errorCode === 'CHAT_003') {
    console.warn('[expected]', status, message, err.errorCode);
  } else {
    console.error('DEBUG ERR:', err.stack);
  }
  res.status(status).json(payload);
}

function createError(status, message, errorCode) {
  const err = new Error(message);
  err.status = status;
  err.errorCode = errorCode;
  return err;
}

module.exports = { errorHandler, createError };
