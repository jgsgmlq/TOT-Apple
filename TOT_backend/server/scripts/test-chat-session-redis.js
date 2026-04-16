'use strict';

/**
 * Smoke: Redis adapter wiring for chat session cache (no live Redis required).
 * With REDIS_URL + ioredis installed, also pings Redis once.
 *
 *   node scripts/test-chat-session-redis.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const redisAdapter = require('../utils/redisAdapter');
const chatSessionStateService = require('../services/chatSessionStateService');

async function main() {
  const has = chatSessionStateService.hasRedisAdapter();
  console.log(JSON.stringify({ event: 'chat_session_redis_smoke', hasRedisAdapter: has }));

  if (!has) {
    console.log(JSON.stringify({
      hint: 'Set REDIS_URL to enable cross-process session tool cache (ioredis is a server dependency; no connection is made without REDIS_URL).',
    }));
    return;
  }

  const c = redisAdapter.getClient();
  if (c && typeof c.ping === 'function') {
    const pong = await c.ping();
    console.log(JSON.stringify({ event: 'redis_ping', pong: String(pong) }));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
