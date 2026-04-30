'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const logger = require('../utils/logger');
logger.info = () => {};
logger.warn = () => {};
logger.error = () => {};

const { MemorySaver } = require('@langchain/langgraph');
const { buildGraph } = require('../agent/graph/graph');
const { db } = require('../db');
const { AIMessage, HumanMessage } = require("@langchain/core/messages");

async function runDebug() {
  const app = buildGraph().compile({ checkpointer: new MemorySaver() });
  const sessionId = `debug-${Date.now()}`;
  const thread = { configurable: { thread_id: sessionId } };
  
  db.run("INSERT OR IGNORE INTO users (id, username, password_hash, role) VALUES (999, 'debug_user', 'hash', 'store_manager')");
  db.run("INSERT INTO chat_sessions (id, user_id, role_scope) VALUES (?, 999, 'national')", [sessionId]);

  console.log("=== FIRST QUESTION ===");
  const inputState1 = { 
    userMessage: "有哪些门店需要重点关注？",
    sessionId,
    userId: 999,
    regionScope: { type: "national" }
  };

  const stream = await app.stream(inputState1, thread);
  for await (const chunk of stream) {
      const nodeName = Object.keys(chunk)[0];
      const stateAtNode = chunk[nodeName];
      console.log(`\n[Step] 🟢 Node 输出 -> ${nodeName}`);
      
      if (nodeName === 'ContextAnalyzerRouter') {
          console.log(`[Router Result] Intent: ${stateAtNode.intent}`);
      }
      
      if (nodeName === 'fc_LlmToolCallStep') {
          if (stateAtNode.messages && stateAtNode.messages.length > 0) {
              const lastMsg = stateAtNode.messages[stateAtNode.messages.length - 1];
              if (lastMsg.tool_calls && lastMsg.tool_calls.length > 0) {
                  console.log(`[LLM Output] Tool Calls generated:`, JSON.stringify(lastMsg.tool_calls));
              } else {
                  console.log(`[LLM Output] Content:`, lastMsg.content);
              }
          }
      }
      
      if (nodeName === 'fc_ValidateParams') {
          console.log(`[Validate] Next Action: ${stateAtNode.fc_next_action}`);
          console.log(`[Validate] Violations: ${stateAtNode.repair_error_reason}`);
          if (stateAtNode.finalResponse) {
             console.log(`[Validate] Final Response set to: ${stateAtNode.finalResponse}`);
          }
      }
  }
  
  const finalState = await app.getState(thread);
  console.log("\nFinal Response:", finalState.values.finalResponse);

}
runDebug().catch(console.error);
