'use strict';

/**
 * Smoke: Function-calling agent path (chatAgentRunner + chatWithTools + tools).
 * Sets CHAT_AGENT_MODE=function_calling before loading chatAgentRunner.
 *
 * Requires DEEPSEEK_API_KEY and a seeded SQLite DB (default server cwd).
 *
 *   node scripts/test-fc-e2e.js
 */

const fs = require('fs');
const path = require('path');

const envCandidates = [
  path.join(__dirname, '..', '.env'),
  path.join(__dirname, '..', '..', '.env'),
];
for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
  }
}

if (!process.env.DEEPSEEK_API_KEY) {
  console.log(JSON.stringify({
    event: 'fc_e2e_skipped',
    reason: 'DEEPSEEK_API_KEY not set',
    hint: 'Put DEEPSEEK_API_KEY in TOT_backend/server/.env or TOT_backend/.env (never commit).',
    checkedEnvFiles: envCandidates.filter((p) => fs.existsSync(p)),
  }));
  process.exit(0);
}

process.env.CHAT_AGENT_MODE = 'function_calling';

const chatAgentRunner = require('../services/chatAgentRunner');

async function main() {
  const regionScope = { type: 'national', regions: null, rtm: null };
  const reply = await chatAgentRunner.run(
    'Q1 培训完成率大概是多少？',
    [],
    regionScope,
    { sessionId: `fc-e2e-${Date.now()}` }
  );

  const ok =
    reply &&
    typeof reply.overview === 'string' &&
    reply.overview.length > 0;

  console.log(JSON.stringify({
    event: 'fc_e2e_done',
    ok,
    agentMode: chatAgentRunner.AGENT_MODE,
    intentType: reply._intentType,
    intentResolvedBy: reply._intentResolvedBy,
    toolMeta: reply._toolMeta,
    overviewPreview: reply.overview ? reply.overview.slice(0, 160) : null,
  }));

  if (!ok) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
