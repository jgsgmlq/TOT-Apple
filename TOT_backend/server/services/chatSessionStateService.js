'use strict';

const logger = require('../utils/logger');
const redisAdapter = require('../utils/redisAdapter');

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_CAPACITY = 20;

/**
 * memory_then_redis:
 * - phase 1: in-memory cache enabled by default
 * - phase 2: optional redis adapter can be injected later
 */
class ChatSessionStateService {
  constructor(options = {}) {
    this.ttlMs = Number(options.ttlMs || process.env.CHAT_SESSION_STATE_TTL_MS || DEFAULT_TTL_MS);
    this.capacity = Number(options.capacity || process.env.CHAT_SESSION_STATE_CAPACITY || DEFAULT_CAPACITY);
    this.memoryStore = new Map(); // sessionId -> { touchedAt, records: [] }
    this.redisAdapter = options.redisAdapter || null; // reserved extension point
  }

  now() {
    return Date.now();
  }

  normalizeEntities(entities = {}) {
    return {
      taskId: entities.taskId || null,
      region: entities.region || null,
      storeId: entities.storeId || null,
      analysisType: entities.analysisType || null,
    };
  }

  signature(intentType, entities = {}) {
    const e = this.normalizeEntities(entities);
    return `${intentType || 'unknown'}|${e.taskId || '-'}|${e.region || '-'}|${e.storeId || '-'}|${e.analysisType || '-'}`;
  }

  cleanupExpiredForSession(sessionId) {
    const row = this.memoryStore.get(sessionId);
    if (!row) return;
    const cutoff = this.now() - this.ttlMs;
    row.records = row.records.filter((r) => r.createdAt >= cutoff);
    if (!row.records.length && row.touchedAt < cutoff) {
      this.memoryStore.delete(sessionId);
    }
  }

  cleanupExpiredGlobal() {
    const cutoff = this.now() - this.ttlMs;
    for (const [sessionId, row] of this.memoryStore.entries()) {
      row.records = row.records.filter((r) => r.createdAt >= cutoff);
      if (!row.records.length && row.touchedAt < cutoff) {
        this.memoryStore.delete(sessionId);
      }
    }
  }

  evictIfNeeded() {
    if (this.memoryStore.size <= this.capacity) return;
    const sorted = [...this.memoryStore.entries()].sort((a, b) => a[1].touchedAt - b[1].touchedAt);
    while (sorted.length > this.capacity) {
      const [sessionId] = sorted.shift();
      this.memoryStore.delete(sessionId);
    }
  }

  buildScopeFingerprint(regionScope = {}) {
    const regions = Array.isArray(regionScope.regions)
      ? [...regionScope.regions].sort()
      : [];
    return JSON.stringify({
      type: regionScope.type || null,
      rtm: regionScope.rtm || null,
      regions,
    });
  }

  ensureSession(sessionId, regionScope = null) {
    const nextFingerprint = regionScope ? this.buildScopeFingerprint(regionScope) : null;
    if (!this.memoryStore.has(sessionId)) {
      this.memoryStore.set(sessionId, {
        touchedAt: this.now(),
        records: [],
        version: 1,
        scopeFingerprint: nextFingerprint,
      });
      this.evictIfNeeded();
    }
    const row = this.memoryStore.get(sessionId);
    // If the same sessionId is reused under different scope, invalidate old cache.
    if (nextFingerprint && row.scopeFingerprint && row.scopeFingerprint !== nextFingerprint) {
      row.records = [];
      row.version += 1;
      row.scopeFingerprint = nextFingerprint;
    } else if (nextFingerprint && !row.scopeFingerprint) {
      row.scopeFingerprint = nextFingerprint;
    }
    row.touchedAt = this.now();
    return row;
  }

  getSessionVersion(sessionId, regionScope = null) {
    if (!sessionId) return 0;
    const row = this.ensureSession(sessionId, regionScope);
    return Number(row.version || 0);
  }

  _sessionRedisKey(sessionId) {
    return `tot:chat:ss:${sessionId}`;
  }

  /**
   * When memory has no records for this session, load a snapshot from Redis (multi-instance cache share).
   */
  async hydrateIfNeeded(sessionId, regionScope = null) {
    if (!this.redisAdapter || !sessionId) return;
    this.cleanupExpiredForSession(sessionId);
    const row = this.ensureSession(sessionId, regionScope);
    if (row.records.length > 0) return;
    const raw = await this.redisAdapter.get(this._sessionRedisKey(sessionId));
    if (!raw) return;
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    if (!data || !Array.isArray(data.records)) return;
    const nextFp = regionScope ? this.buildScopeFingerprint(regionScope) : null;
    if (nextFp && data.scopeFingerprint && data.scopeFingerprint !== nextFp) return;
    row.records = data.records;
    row.version = Math.max(Number(row.version) || 0, Number(data.version) || 0);
    if (data.scopeFingerprint) row.scopeFingerprint = data.scopeFingerprint;
    row.touchedAt = data.touchedAt || row.touchedAt;
  }

  async persistSessionToRedis(sessionId) {
    if (!this.redisAdapter || !sessionId) return;
    const row = this.memoryStore.get(sessionId);
    if (!row) return;
    const payload = {
      scopeFingerprint: row.scopeFingerprint,
      version: row.version,
      records: row.records,
      touchedAt: row.touchedAt,
    };
    const sec = typeof this.redisAdapter.ttlSeconds === 'function'
      ? this.redisAdapter.ttlSeconds()
      : Math.max(60, Math.ceil(this.ttlMs / 1000));
    await this.redisAdapter.setex(this._sessionRedisKey(sessionId), sec, JSON.stringify(payload));
  }

  addRecord(sessionId, payload, regionScope = null, expectedVersion = null) {
    if (!sessionId) return;
    const row = this.ensureSession(sessionId, regionScope);
    // Prevent stale writers from overriding newer session state.
    if (Number.isInteger(expectedVersion) && expectedVersion !== row.version) {
      return false;
    }
    row.version += 1;
    row.records.push({
      ...payload,
      createdAt: this.now(),
      version: row.version,
    });
    if (row.records.length > this.capacity) {
      row.records.shift();
    }
    if (this.redisAdapter) {
      const sid = sessionId;
      setImmediate(() => {
        this.persistSessionToRedis(sid).catch((e) => {
          logger.warn('chat_session_redis_persist_failed', { sessionId: sid, message: e.message });
        });
      });
    }
    return true;
  }

  getLatestBySignature(sessionId, signature, regionScope = null) {
    if (!sessionId || !signature) return null;
    this.cleanupExpiredForSession(sessionId);
    const row = this.ensureSession(sessionId, regionScope);
    const nextFingerprint = regionScope ? this.buildScopeFingerprint(regionScope) : null;
    if (nextFingerprint && row.scopeFingerprint && row.scopeFingerprint !== nextFingerprint) {
      // defensive fallback, though ensureSession already clears on mismatch
      row.records = [];
      row.version += 1;
      row.scopeFingerprint = nextFingerprint;
      return null;
    }
    if (!row || !row.records.length) return null;
    for (let i = row.records.length - 1; i >= 0; i -= 1) {
      if (row.records[i].signature === signature) return row.records[i];
    }
    return null;
  }

  clearSession(sessionId) {
    if (!sessionId) return;
    this.memoryStore.delete(sessionId);
    if (this.redisAdapter) {
      const key = this._sessionRedisKey(sessionId);
      this.redisAdapter.del(key).catch((e) => {
        logger.warn('chat_session_redis_del_failed', { sessionId, message: e.message });
      });
    }
  }

  hasRedisAdapter() {
    return Boolean(this.redisAdapter);
  }
}

module.exports = new ChatSessionStateService({
  redisAdapter: redisAdapter.isAvailable() ? redisAdapter : null,
});
module.exports.ChatSessionStateService = ChatSessionStateService;
