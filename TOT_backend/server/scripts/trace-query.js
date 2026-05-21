'use strict';

process.env.DEBUG_GRAPH = 'true';
process.env.LOG_LEVEL = 'debug';

const path = require('path');
const fs = require('fs');

// Load env
const envFiles = [
  path.join(__dirname, '..', '.env'),
  path.join(__dirname, '..', '..', '.env'),
];
for (const f of envFiles) {
  if (fs.existsSync(f)) require('dotenv').config({ path: f });
}

const { buildGraph } = require('../agent/graph/graph');
const { resetStepCounter } = require('../agent/graph/shared/graphDebugger');
const { MemorySaver } = require('@langchain/langgraph');

async function run(message) {
  resetStepCounter();
  const checkpointer = new MemorySaver();
  const app = buildGraph().compile({ checkpointer });

  const input = {
    userMessage: message,
    sessionId: `trace-${Date.now()}`,
    userId: 'test_admin',
    regionScope: { type: 'national' },
  };

  const thread = {
    configurable: { thread_id: input.sessionId },
    recursionLimit: 60,
  };

  const t0 = Date.now();
  try {
    const state = await app.invoke(input, thread);
    const elapsed = Date.now() - t0;

    console.log(`\n========================================`);
    console.log(`QUERY: ${message}`);
    console.log(`TIME:  ${elapsed}ms`);
    console.log(`========================================`);
    console.log(`mode:            ${state.mode}`);
    console.log(`intent:          ${state.intent || '(none)'}`);
    console.log(`FC steps:        ${state.fc_super_step_count || 0}`);
    console.log(`calledTools:     [${(state.calledTools || []).join(', ')}]`);
    console.log(`ambiguity:       ${state.ambiguity_payload?.type || 'none'}`);
    console.log(`escalate_count:  ${state.escalate_count || 0}`);
    console.log(`meta_fallback:   ${state.meta_fallback_count || 0}`);
    console.log(`extracted_task:  ${state.extracted_task_ref || '-'}`);
    console.log(`extracted_org:   ${state.extracted_org_ref || '-'}`);
    console.log(`extracted_time:  ${state.extracted_time_ref || '-'}`);

    const reply = state.reply_markdown || state.finalResponse || '';
    console.log(`reply length:    ${reply.length}c`);
    if (reply) {
      console.log(`\n--- REPLY ---`);
      console.log(reply.slice(0, 1500));
      if (reply.length > 1500) console.log(`…(+${reply.length - 1500}c)`);
    }

    const trKeys = Object.keys(state.toolResults || {});
    if (trKeys.length > 0) {
      console.log(`\n--- TOOL RESULTS (${trKeys.length}) ---`);
      for (const k of trKeys) {
        const v = state.toolResults[k];
        const raw = typeof v?.data === 'string' ? v.data : JSON.stringify(v?.data || '');
        console.log(`  [${k.slice(0, 14)}] ${raw.slice(0, 300)}${raw.length > 300 ? '…' : ''}`);
      }
    }

    console.log(`\n=== DONE ===`);
    process.exit(0);
  } catch (e) {
    console.error(`\n=== ERROR ===`);
    console.error(e.message);
    if (e.stack) console.error(e.stack);
    process.exit(1);
  }
}

const msg = process.argv[2] || '有哪些门店需要重点关注？';
run(msg);
