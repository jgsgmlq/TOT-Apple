'use strict';

const logger = require('./logger');

let Redis = null;
try {
  // optionalDependency; may be absent until `npm install ioredis`
  Redis = require('ioredis');
} catch {
  Redis = null;
}

const REDIS_URL = process.env.REDIS_URL;
const DEFAULT_TTL_MS = 30 * 60 * 1000;

function isAvailable() {
  return Boolean(Redis && REDIS_URL && String(REDIS_URL).trim());
}

let client = null;

function getClient() {
  if (!isAvailable()) return null;
  if (!client) {
    client = new Redis(String(REDIS_URL).trim(), {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
    });
    client.on('error', (err) => {
      logger.warn('redis_client_error', { message: err.message });
    });
  }
  return client;
}

function ttlSeconds() {
  const ms = Number(process.env.CHAT_SESSION_STATE_TTL_MS) || DEFAULT_TTL_MS;
  return Math.max(60, Math.ceil(ms / 1000));
}

async function get(key) {
  const c = getClient();
  if (!c) return null;
  try {
    return await c.get(key);
  } catch (e) {
    logger.warn('redis_get_failed', { key, message: e.message });
    return null;
  }
}

async function setex(key, seconds, value) {
  const c = getClient();
  if (!c) return;
  try {
    await c.setex(key, seconds, value);
  } catch (e) {
    logger.warn('redis_setex_failed', { key, message: e.message });
  }
}

async function del(key) {
  const c = getClient();
  if (!c) return;
  try {
    await c.del(key);
  } catch (e) {
    logger.warn('redis_del_failed', { key, message: e.message });
  }
}

async function quit() {
  if (client) {
    try {
      await client.quit();
    } catch (e) {
      logger.warn('redis_quit_failed', { message: e.message });
    } finally {
      client = null;
    }
  }
}

module.exports = {
  isAvailable,
  getClient,
  get,
  setex,
  del,
  ttlSeconds,
  quit,
};
