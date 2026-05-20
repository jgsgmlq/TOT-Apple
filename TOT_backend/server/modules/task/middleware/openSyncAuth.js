'use strict';

const crypto = require('crypto');
const { verifySignature } = require('../utils/openSyncSign');

const NONCE_TTL_MS = 10 * 60 * 1000;
const TIMESTAMP_WINDOW_MS = 5 * 60 * 1000;
const nonceCache = new Map();

function getOpenSyncConfig() {
  return {
    appId: (process.env.OPEN_SYNC_APP_ID || '').trim(),
    appSecret: process.env.OPEN_SYNC_APP_SECRET || '',
  };
}

function pruneNonceCache(now) {
  for (const [key, exp] of nonceCache) {
    if (exp <= now) nonceCache.delete(key);
  }
}

function openSyncFail(res, httpStatus, code, message, requestId) {
  return res.status(httpStatus).json({
    code,
    message,
    requestId: requestId || null,
    data: null,
  });
}

function openSyncAuth(req, res, next) {
  const requestId = crypto.randomBytes(16).toString('hex');
  req.openSyncRequestId = requestId;

  const appId = req.get('appId');
  const timestamp = req.get('timestamp');
  const nonce = req.get('nonce');
  const signature = req.get('Signature');

  if (!appId || !timestamp || !nonce || !signature) {
    return openSyncFail(res, 400, '40001', '缺少必要请求头', requestId);
  }

  const config = getOpenSyncConfig();
  if (!config.appId || !config.appSecret) {
    return openSyncFail(res, 500, '50001', '系统内部错误', requestId);
  }
  if (appId !== config.appId) {
    return openSyncFail(res, 401, '40101', 'appId 无效', requestId);
  }

  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum) || tsNum <= 0) {
    return openSyncFail(res, 400, '40003', '时间戳格式错误', requestId);
  }
  if (Math.abs(Date.now() - tsNum) > TIMESTAMP_WINDOW_MS) {
    return openSyncFail(res, 401, '40102', '时间戳过期', requestId);
  }

  const nonceKey = appId + ':' + nonce;
  pruneNonceCache(Date.now());
  if (nonceCache.has(nonceKey)) {
    return openSyncFail(res, 401, '40103', 'nonce 重复', requestId);
  }
  nonceCache.set(nonceKey, Date.now() + NONCE_TTL_MS);

  const formBody = typeof req.rawBody === 'string' ? req.rawBody : '';
  const ok = verifySignature({
    method: req.method,
    path: req.baseUrl + req.path,
    appId,
    timestamp,
    nonce,
    formBody,
    appSecret: config.appSecret,
    signature,
  });
  if (!ok) {
    return openSyncFail(res, 401, '40105', '签名校验失败', requestId);
  }

  next();
}

module.exports = { openSyncAuth, getOpenSyncConfig };
