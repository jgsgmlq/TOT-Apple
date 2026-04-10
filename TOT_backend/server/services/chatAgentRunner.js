'use strict';

const chatIntentService = require('./chatIntentService');
const chatToolsService  = require('./chatToolsService');
const chatAnswerService = require('./chatAnswerService');

// Toggle via .env: CHAT_AGENT_MODE=function_calling activates FC mode after upgrade.
// Default is intent_routing (MVP).
const CHAT_AGENT_MODE = process.env.CHAT_AGENT_MODE || 'intent_routing';

/**
 * Main entry point for the chat agent.
 * chatService.js calls this and does NOT know which mode is active.
 *
 * @param {string} userMessage
 * @param {Array<{role:string, content:string}>} history  — last 6 DB messages
 * @param {{ type: string, regions: string[]|null, rtm: string|null }} regionScope
 * @returns {Promise<ReplyContent>}
 */
async function run(userMessage, history, regionScope) {
  if (CHAT_AGENT_MODE === 'function_calling') {
    return runFunctionCalling(userMessage, history, regionScope);
  }
  return runIntentRouting(userMessage, history, regionScope);
}

// ─── MVP mode: intent routing ─────────────────────────────────────────────────
async function runIntentRouting(userMessage, history, regionScope) {
  // LLM Call 1: classify intent
  const { intentType, entities } = await chatIntentService.classify(userMessage, history);

  // Dispatch to tool (or skip for unknown intent)
  let toolResult = null;
  if (intentType !== 'unknown') {
    // Map intent → tool name
    const toolMap = {
      progress_query: 'getOverviewData',
      project_status: 'getTaskListData',
      warning_query:  'getWarningsData',
      drill_down:     'getStoreDetailData',
    };
    const toolName = toolMap[intentType];
    if (toolName) {
      try {
        toolResult = chatToolsService.executeByName(toolName, entities, regionScope);
      } catch (err) {
        console.warn('[chatAgentRunner] Tool execution error:', err.message);
        toolResult = null;
      }
    }
  }

  // LLM Call 2: format answer
  const replyContent = await chatAnswerService.format(userMessage, toolResult, history);
  // Attach intent metadata for logging
  replyContent._intentType = intentType;
  return replyContent;
}

// ─── FC upgrade mode: function calling ────────────────────────────────────────
// This branch is NOT active in MVP. Enabled by: CHAT_AGENT_MODE=function_calling
// Requires utils/ai.js to expose a chatWithTools() method (see Task 9).
async function runFunctionCalling(userMessage, history, regionScope) {
  // Import lazily so MVP doesn't require chatWithTools to exist
  const { chatWithTools } = require('../utils/ai');

  const messages = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  // First LLM call: may request tool calls
  const response = await chatWithTools({
    messages,
    tools: chatToolsService.TOOL_SCHEMAS,
  });

  if (!response.tool_calls || response.tool_calls.length === 0) {
    // LLM answered directly without tools
    try {
      return JSON.parse(response.content);
    } catch {
      return { overview: response.content, keyNumbers: [], attentionPoints: [], followUpSuggestions: [] };
    }
  }

  // Execute all requested tools (synchronous, serial)
  const toolResults = response.tool_calls.map((tc) =>
    chatToolsService.executeByName(
      tc.function.name,
      JSON.parse(tc.function.arguments),
      regionScope  // regionScope injected here — LLM never sees permission boundaries
    )
  );

  // Second LLM call: provide tool results, get final answer
  const finalMessages = [
    ...messages,
    { role: 'assistant', content: null, tool_calls: response.tool_calls },
    ...toolResults.map((result, i) => ({
      role: 'tool',
      tool_call_id: response.tool_calls[i].id,
      content: JSON.stringify(result),
    })),
  ];

  const finalResponse = await chatWithTools({
    messages: finalMessages,
    tools: chatToolsService.TOOL_SCHEMAS,
    tool_choice: 'none',
  });

  try {
    return JSON.parse(finalResponse.content);
  } catch {
    return { overview: finalResponse.content, keyNumbers: [], attentionPoints: [], followUpSuggestions: [] };
  }
}

module.exports = { run };
