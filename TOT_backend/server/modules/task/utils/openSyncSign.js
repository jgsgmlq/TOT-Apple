'use strict';

const crypto = require('crypto');

/**
 * 按对接方案 §3.3–3.4 校验 HMAC-SHA256 签名（十六进制小写）。
 */
function verifySignature({ method, path, appId, timestamp, nonce, formBody, appSecret, signature }) {
  const canonical = [method, path, appId, timestamp, nonce, formBody || ''].join('\n');
  const expected = crypto
    .createHmac('sha256', appSecret)
    .update(canonical, 'utf8')
    .digest('hex');
  if (!signature || typeof signature !== 'string') return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature.trim().toLowerCase(), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { verifySignature };
