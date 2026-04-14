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
        toolResult = await chatToolsService.executeByName(toolName, entities, regionScope);
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

  const SYSTEM_PROMPT = `你是一个培训数据分析助手。你可以调用函数查询数据库。
如果你需要多个数据，请分步调用相关函数。如果查询结果为空或无相关数据，请在 overview 中说明。
【重要指导】：
1. 如果用户的问题需要查询数据，无论调用了多少次函数，你的【最终回答】必须是一个严格的 JSON 对象（不要使用 markdown 标记，不要包含其他解释性文字），格式如下：
{
  "overview": "不超过 60 字，简明总结数据情况（如果数据不全，请说明缺失内容）",
  "keyNumbers": [{"label": "...", "value": "...", "unit": "..."}],
  "attentionPoints": ["...", "..."],
  "followUpSuggestions": ["...", "..."]
}
2. 如果你的函数调用次数受限，未能一次性收集完所有数据，请在 overview 说明缺失部分，并在 followUpSuggestions 给出明确的追问建议（如："查询华东区最差门店"）。
3. 如果用户只是和你闲聊、打招呼、询问你的能力（如"你能做什么"），你不需要查数据库，直接用【纯文本】回答即可，不要输出 JSON！不要输出 JSON！`;

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  let iterations = 0;
  const MAX_ITERATIONS = 3;
  let finalContent = null;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await chatWithTools({
      messages,
      tools: chatToolsService.TOOL_SCHEMAS,
    });

    if (!response.tool_calls || response.tool_calls.length === 0) {
      finalContent = response.content;
      break;
    }

    // Execute requested tools
    const toolResults = await Promise.all(response.tool_calls.map(async (tc) => {
      let args;
      try {
        args = JSON.parse(tc.function.arguments || '{}');
      } catch {
        console.warn('[chatAgentRunner] Failed to parse tool arguments:', tc.function.arguments);
        args = {};
      }
      const result = await chatToolsService.executeByName(tc.function.name, args, regionScope);
      return {
        id: tc.id,
        result
      };
    }));

    // Append assistant tool_calls request and tool responses
    messages.push({ role: 'assistant', content: response.content || null, tool_calls: response.tool_calls });
    for (const tr of toolResults) {
      messages.push({
        role: 'tool',
        tool_call_id: tr.id,
        content: JSON.stringify(tr.result)
      });
    }
  }

  // If we maxed out iterations and still have tools pending, force answer
  if (!finalContent && iterations >= MAX_ITERATIONS) {
      const response = await chatWithTools({
        messages,
        tools: chatToolsService.TOOL_SCHEMAS,
        tool_choice: 'none'
      });
      finalContent = response.content;
  }

  try {
    const jsonMatch = finalContent ? finalContent.match(/\{[\s\S]*\}/) : null;
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      // If it looks like a dashboard payload (has keyNumbers or attentionPoints), return as is
      if (parsed.keyNumbers || parsed.attentionPoints || parsed.overview) {
         // remove messageType if present
         delete parsed.messageType;
         return parsed;
      }
    }
    // Fallback: If no valid dashboard JSON found, treat as conversational text
    return { overview: finalContent, keyNumbers: [], attentionPoints: [], followUpSuggestions: [] };
  } catch {
    return { overview: finalContent || '系统无法理解并格式化该数据，请换一种问法。', keyNumbers: [], attentionPoints: [], followUpSuggestions: [] };
  }
}

module.exports = { run };
