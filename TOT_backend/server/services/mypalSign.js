'use strict';

const crypto = require('crypto');

/**
 * MyPal TOT 对接：按文档将所有参数（不含 sign）按 key 字母升序拼接后 HMAC-SHA256，输出小写 hex。
 * @param {Record<string, string|number|undefined|null>} params
 * @param {string} appSecret
 * @returns {string}
 */
function signParams(params, appSecret) {
  const keys = Object.keys(params).filter((k) => k !== 'sign').sort();
  const pairs = [];
  for (const key of keys) {
    const value = params[key];
    if (value === undefined || value === null) continue;
    const s = String(value).trim();
    if (!s) continue;
    pairs.push(`${key}=${s}`);
  }
  const signStr = pairs.join('&');
  return crypto.createHmac('sha256', appSecret).update(signStr, 'utf8').digest('hex');
}

module.exports = { signParams };
