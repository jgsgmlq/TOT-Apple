'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const logger = require('../utils/logger');
logger.info = () => {};
logger.warn = () => {};
logger.error = console.error;

const { Langfuse } = require('langfuse');
const { MemorySaver } = require('@langchain/langgraph');
const { buildGraph } = require('../agent/graph/graph');
const { db } = require('../db');

const langfuse = new Langfuse({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  baseUrl: process.env.LANGFUSE_BASEURL || process.env.LANGFUSE_HOST || 'https://cloud.langfuse.com'
});

langfuse.on("error", (error) => {
  console.error("Langfuse error:", error);
});

async function runDebug() {
  const app = buildGraph().compile({ checkpointer: new MemorySaver() });
  const sessionId = `debug-${Date.now()}`;
  
  db.run("INSERT OR IGNORE INTO users (id, username, password_hash, role) VALUES (999, 'debug_user', 'hash', 'store_manager')");
  db.run("INSERT INTO chat_sessions (id, user_id, role_scope) VALUES (?, 999, 'national')", [sessionId]);

  const inputState = { 
    userMessage: "有哪些门店需要重点关注？",
    sessionId,
    userId: 999,
    regionScope: { type: "national" }
  };

  const thread = { configurable: { thread_id: sessionId } };
  
  const trace = langfuse.trace({
    name: "ExecutiveChat-Debug-Test-Warning",
    sessionId: sessionId,
    input: inputState,
    tags: ["debug", "state-machine"]
  });

  console.log(`🔗 Langfuse Trace URL: ${langfuse.baseUrl}/trace/${trace.id}`);
  console.log(`[Input] ${inputState.userMessage}\n`);

  try {
    let stepCount = 0;
    const stream = await app.stream(inputState, thread);
    for await (const chunk of stream) {
      stepCount++;
      const nodeName = Object.keys(chunk)[0];
      const stateAtNode = chunk[nodeName];
      console.log(`[Step ${stepCount}] 🟢 Node 输出 -> ${nodeName}`);
      
      const keyState = {
        mode: stateAtNode.mode,
        intent: stateAtNode.intent,
        fc_next_action: stateAtNode.fc_next_action,
        fc_super_step_count: stateAtNode.fc_super_step_count,
        pending_tool_calls: stateAtNode.pending_tool_calls?.length || 0,
        hitl_status: stateAtNode.hitl_status,
      };
      
      if (nodeName === 'fc_ValidateParams' && keyState.fc_next_action === 'hitl') {
         console.log(`  [HITL Triggered] Graph execution suspended.`);
      }

      if (nodeName === 'fc_MergeToolResults' || nodeName === 'FinalResponseStep') {
         if (stateAtNode.messages && stateAtNode.messages.length > 0) {
             const lastMsg = stateAtNode.messages[stateAtNode.messages.length - 1];
             if (lastMsg._getType() === 'tool') {
                console.log(`  [Tool Result] ${lastMsg.content.substring(0, 100)}...`);
             }
             if (nodeName === 'FinalResponseStep') {
                console.log(`  [Final Response] ${stateAtNode.finalResponse}`);
             }
         }
      }

      const span = trace.span({
        name: `Node: ${nodeName}`,
        input: keyState,
        startTime: new Date()
      });
      span.end({ output: { next_action: keyState.fc_next_action } });
    }
  } catch (err) {
    console.error(`\n❌ 执行崩溃:`, err);
    trace.update({ level: "ERROR", statusMessage: err.message });
  }
  await langfuse.flushAsync();
}
runDebug().catch(console.error);
