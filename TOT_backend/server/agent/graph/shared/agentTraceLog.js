'use strict';

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '../../../logs/agent-traces');

function ensureDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function logAgentTrace(sessionId, event) {
  if (!sessionId) return;
  ensureDir();
  const filename = `${sessionId}.jsonl`;
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n';
  try {
    fs.appendFileSync(path.join(LOG_DIR, filename), line, 'utf-8');
  } catch (_) { /* 磁盘满等极端情况静默跳过 */ }
}

module.exports = { logAgentTrace, LOG_DIR };
