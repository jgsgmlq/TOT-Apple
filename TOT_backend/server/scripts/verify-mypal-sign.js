#!/usr/bin/env node
'use strict';

/**
 * 对照对接文档示例参数，验证 signParams 与已知 HMAC 结果一致（见 06-MYPAL-INTEGRATION.md）。
 * 用法：node scripts/verify-mypal-sign.js
 */

const { signParams } = require('../services/mypalSign');

const params = {
  appId: 'app_001',
  timestamp: '1704700800000',
  nonce: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6',
  seedId: 'user1@example.com',
  queryDate: 'FY26Q2W1',
};
const secret = 'your_secret_key_here';

const ours = signParams(params, secret);
const expectedOpenssl = '2c2279ff0e854601f5adbf62e88c802dc48c0053d3b759337b417afc145272be';

if (ours !== expectedOpenssl) {
  console.error('sign mismatch', { ours, expectedOpenssl });
  process.exit(1);
}
console.log('ok: mypalSign matches openssl reference');
