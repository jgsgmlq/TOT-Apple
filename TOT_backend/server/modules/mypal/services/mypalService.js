'use strict';

var crypto = require('crypto');
var mypalCrud = require('../crud/mypalCrud');
var learnerCrud = require('../../admin/crud/learnerCrud');

// ═══ 配置 ═══════════════════════════════════════════════════

function getConfig() {
  var enabled = process.env.MYPAL_ENABLED === '1';
  var base = (process.env.MYPAL_API_BASE || '').trim().replace(/\/$/, '');
  var appId = (process.env.MYPAL_APP_ID || '').trim();
  var appSecret = process.env.MYPAL_APP_SECRET || '';
  var timeoutMs = parseInt(process.env.MYPAL_REQUEST_TIMEOUT_MS || '3000', 10);
  return { enabled: enabled, base: base, appId: appId, appSecret: appSecret, timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 3000 };
}

function isMypalEnabled() {
  var c = getConfig();
  return c.enabled && !!c.base && !!c.appId && !!c.appSecret;
}

// ═══ 签名 ═══════════════════════════════════════════════════

function signParams(params, appSecret) {
  var keys = Object.keys(params).filter(function(k) { return k !== 'sign'; }).sort();
  var pairs = [];
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var value = params[key];
    if (value === undefined || value === null) continue;
    var s = String(value).trim();
    if (!s) continue;
    pairs.push(key + '=' + s);
  }
  var signStr = pairs.join('&');
  return crypto.createHmac('sha256', appSecret).update(signStr, 'utf8').digest('hex');
}

// ═══ 邮箱规范化 ═══════════════════════════════════════════════

function normalizeEmail(email) {
  if (email == null || typeof email !== 'string') return null;
  var t = email.trim().toLowerCase();
  return t.length ? t : null;
}

function resolveLearnerByEmail(email) {
  var norm = normalizeEmail(email);
  if (!norm) return null;
  return learnerCrud.getLearnerByEmail(norm);
}

// ═══ API 调用 ════════════════════════════════════════════════

async function callMyPalApi(endpoint, params) {
  var config = getConfig();
  if (!isMypalEnabled()) {
    throw new Error('MyPal integration is not enabled');
  }

  var ts = String(Date.now());
  var nonce = require('crypto').randomBytes(16).toString('hex');
  var publicParams = { app_id: config.appId, timestamp: ts, nonce: nonce };
  var allParams = Object.assign({}, publicParams, params);
  allParams.sign = signParams(allParams, config.appSecret);

  var qs = Object.keys(allParams).map(function(k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(allParams[k]);
  }).join('&');

  var url = config.base + endpoint + '?' + qs;
  var startMs = Date.now();

  var controller = new AbortController();
  var timer = setTimeout(function() { controller.abort(); }, config.timeoutMs);

  try {
    var res = await fetch(url, { signal: controller.signal });
    var body = await res.text();
    var durationMs = Date.now() - startMs;
    var json = null;
    try { json = JSON.parse(body); } catch (e) { /* ignore */ }

    return {
      status: res.status,
      body: body,
      json: json,
      durationMs: durationMs,
      url: url,
    };
  } catch (err) {
    var durationMs = Date.now() - startMs;
    throw { message: err.message, durationMs: durationMs, url: url };
  } finally {
    clearTimeout(timer);
  }
}

// ═══ 同步编排 ════════════════════════════════════════════════

async function syncLearningProgress(queryDate) {
  if (!isMypalEnabled()) {
    return { synced: 0, message: 'MyPal disabled' };
  }

  var pageNum = 1;
  var totalPages = 1;
  var synced = 0;

  for (;;) {
    var result = await callMyPalApi('/api/v1/datas/page', {
      query_date: queryDate,
      page_num: String(pageNum),
      page_size: '100',
    });

    if (result.status !== 200 || !result.json || result.json.code !== 0) {
      throw new Error('MyPal API error: ' + (result.json ? result.json.message : result.status));
    }

    var rows = Array.isArray(result.json.data) ? result.json.data : [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      mypalCrud.upsertSyncData({
        id: row.seedId + '_' + queryDate,
        taskWeek: queryDate,
        emailId: row.seedId || row.email,
        productName: row.productName,
        progress: row.progress,
        passedWeek: row.passedWeek,
        passedTime: row.passedTime,
        firstUseTime: row.firstUseTime,
        weekStartTime: row.weekStartTime,
        syncMode: 'api_pull',
        sourceEndpoint: '/api/v1/datas/page',
      });
      synced++;
    }

    totalPages = Number(result.json.totalPages) || 1;
    if (pageNum >= totalPages) break;
    pageNum++;
    await sleep(1100);
  }

  return { synced: synced, pages: totalPages };
}

function sleep(ms) {
  return new Promise(function(r) { setTimeout(r, ms); });
}

// ═══ 查询 ═══════════════════════════════════════════════════

function getSyncStatus(queryDate) {
  return mypalCrud.getSyncDataList({ taskWeek: queryDate, limit: 500 });
}

function getSyncAuditLogs(syncDataId) {
  return mypalCrud.getSyncAuditLogs(syncDataId);
}

module.exports = {
  isMypalEnabled: isMypalEnabled,
  callMyPalApi: callMyPalApi,
  syncLearningProgress: syncLearningProgress,
  getSyncStatus: getSyncStatus,
  getSyncAuditLogs: getSyncAuditLogs,
  normalizeEmail: normalizeEmail,
  resolveLearnerByEmail: resolveLearnerByEmail,
};
