'use strict';

const { randomBytes } = require('crypto');
const { signParams } = require('./mypalSign');

function getConfig() {
  const enabled = process.env.MYPAL_ENABLED === '1';
  const base = (process.env.MYPAL_API_BASE || '').trim().replace(/\/$/, '');
  const appId = (process.env.MYPAL_APP_ID || '').trim();
  const appSecret = process.env.MYPAL_APP_SECRET || '';
  const timeoutMs = parseInt(process.env.MYPAL_REQUEST_TIMEOUT_MS || '3000', 10);
  return {
    enabled,
    base,
    appId,
    appSecret,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 3000,
  };
}

function isMypalIntegrationEnabled() {
  const c = getConfig();
  return c.enabled && !!c.base && !!c.appId && !!c.appSecret;
}

function buildPublicParams() {
  const ts = String(Date.now());
  const nonce = randomBytes(16).toString('hex');
  return { timestamp: ts, nonce };
}

/**
 * @param {Record<string, string>} signedBody key=value 参与签名与 POST body
 */
async function postForm(pathSuffix, signedBody) {
  const c = getConfig();
  if (!c.enabled) {
    const err = new Error('MyPal 集成未启用（MYPAL_ENABLED!=1）');
    err.code = 'MYPAL_DISABLED';
    throw err;
  }
  if (!c.base || !c.appId || !c.appSecret) {
    const err = new Error('MyPal 配置不完整（MYPAL_API_BASE / MYPAL_APP_ID / MYPAL_APP_SECRET）');
    err.code = 'MYPAL_CONFIG';
    throw err;
  }

  const url = `${c.base}${pathSuffix}`;
  const bodyObj = {
    appId: c.appId,
    ...signedBody,
  };
  const sign = signParams(bodyObj, c.appSecret);
  const finalBody = { ...bodyObj, sign };

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(finalBody)) {
    params.set(k, String(v));
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), c.timeoutMs);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: params.toString(),
      signal: controller.signal,
    });
  } catch (e) {
    const err = new Error(e.name === 'AbortError' ? 'MyPal 请求超时' : e.message || 'MyPal 网络错误');
    err.code = e.name === 'AbortError' ? 'MYPAL_TIMEOUT' : 'MYPAL_NETWORK';
    err.cause = e;
    throw err;
  } finally {
    clearTimeout(t);
  }

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    const err = new Error(`MyPal 响应非 JSON：HTTP ${res.status}`);
    err.code = 'MYPAL_PARSE';
    err.httpStatus = res.status;
    err.bodyPreview = text.slice(0, 200);
    throw err;
  }

  if (!res.ok && (json.code === undefined || json.code === null)) {
    const err = new Error(`MyPal HTTP ${res.status}`);
    err.code = 'MYPAL_HTTP';
    err.httpStatus = res.status;
    throw err;
  }

  if (json.code !== 0) {
    const err = new Error(json.message || `MyPal 业务错误 code=${json.code}`);
    err.code = 'MYPAL_API';
    err.mypalCode = json.code;
    err.mypalMessage = json.message;
    throw err;
  }

  return json;
}

/**
 * 单学员单周学习状态
 * @param {string} seedId 学员邮箱
 * @param {string} queryDate 任务周 FY26Q2W1
 */
async function getUserWeeklyStatus(seedId, queryDate) {
  const pub = buildPublicParams();
  return postForm('/air2/api/sync/tot/getUserWeeklyStatus', {
    timestamp: pub.timestamp,
    nonce: pub.nonce,
    seedId,
    queryDate,
  });
}

/**
 * 批量分页
 * @param {string} queryDate
 * @param {number} pageNum
 * @param {number} pageSize 1–100
 */
async function getUserDatasPage(queryDate, pageNum, pageSize) {
  const pub = buildPublicParams();
  return postForm('/air2/api/sync/tot/getUserDatas', {
    timestamp: pub.timestamp,
    nonce: pub.nonce,
    queryDate,
    pageNum: String(pageNum),
    pageSize: String(pageSize),
  });
}

module.exports = {
  getConfig,
  isMypalIntegrationEnabled,
  getUserWeeklyStatus,
  getUserDatasPage,
};
