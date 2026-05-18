'use strict';

const { AIMessage, HumanMessage, SystemMessage } = require("@langchain/core/messages");
const { ChatOpenAI } = require("@langchain/openai");
const { startNodeSpan } = require('../shared/spanHelper');
const { renderMemoryBlock } = require('../shared/memoryBlock');
const { getClient, endGeneration, maskPII, preview, NOOP_TRACE } = require('../../../utils/tracer');
const promptRegistry = require('../../../prompts/registry');
const { renderToolResultsMarkdown } = require('../renderers');

const sanitizeUserFacingMarkdown = (content) => {
  const text = typeof content === 'string' ? content : '';
  if (!text) return text;

  if (text.startsWith('SYSTEM_ERROR:') || text.includes('SYSTEM_ERROR')) {
    const reason = text.replace(/^SYSTEM_ERROR:\s*/i, '').replace(/工具参数校验失败[。.]?\s*/g, '');
    if (reason.includes('区域范围限定') || reason.includes('regions') || reason.includes('rtm')) {
      return '抱歉，当前无法查询该范围的数据。请检查您的访问权限范围，或尝试指定更具体的查询条件。';
    }
    if (reason.includes('必填') || reason.includes('MISSING') || reason.includes('storeId') || reason.includes('taskName')) {
      return '我需要更多信息才能完成查询。请告诉我具体的任务名称、门店名称或产品名称，我会立即为您查询。';
    }
    return '抱歉，查询过程中遇到了问题。请尝试缩小查询范围，或换个方式重新描述您的问题。';
  }

  const hasInternalMarkers =
    text.includes('执行已达到复杂度上限') ||
    text.includes('工具查询片段');
  if (!hasInternalMarkers) return text;
  return '我已完成查询并提取了核心数据。若需更精确结果，可指定时间范围、大区或门店，我会继续为您细化。';
};

const getFcModel = () => new ChatOpenAI({
  modelName: "deepseek-chat",
  apiKey: process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY,
  configuration: { baseURL: process.env.DEEPSEEK_API_BASE_URL || "https://api.deepseek.com/v1" },
  temperature: 0.1,
  maxTokens: 2048,
  streaming: true
});

const finalResponseStep = async (state, config) => {
  let response = state.reply_markdown || state.finalResponse || "";

  if (!response) {
    if (state.mode === "deny") {
      response = "### ⚠️ 请求被拒绝\n\n抱歉，Executive Chat 目前仅支持**只读查询**。我无法帮您执行修改数据、发送催办通知或直接处理业务流等操作。\n\n💡 *建议您可以在系统中手动处理，或询问我当前的数据完成情况。*";
    } else if ((state.mode === "chat_only" || state.intent === "chat_only") && Object.keys(state.toolResults || {}).length === 0) {
      console.log(`[FinalResponseStep] 检测到纯聊天意图，调用大模型进行回复...`);
      const emitter = config?.configurable?.sseEmitter;
      const llm = getFcModel();

      const traceId = config?.configurable?.traceId;
      const client = getClient();
      const chatGen = client && traceId
        ? client.generation({ traceId, name: 'FinalResponse_ChatReply', model: 'deepseek-chat', input: maskPII(state.userMessage), metadata: { intent: 'chat_only' } })
        : NOOP_TRACE.generation({ name: 'FinalResponse_ChatReply' });

      const chatContext = (state.messages || []).filter(m => {
        const t = m._getType ? m._getType() : '';
        return t === 'human' || t === 'ai';
      }).slice(-7, -1);
      const contextBlock = chatContext.length > 0
        ? `\n\nRecent conversation context:\n${chatContext.map(m => `${m._getType() === 'human' ? 'User' : 'Assistant'}: ${typeof m.content === 'string' ? m.content.slice(0, 300) : ''}`).join('\n')}`
        : '';

      const chatPrompt = promptRegistry.get('chat_reply') + contextBlock;

      try {
        const stream = await llm.stream([
          new SystemMessage(chatPrompt),
          new HumanMessage(state.userMessage)
        ]);

        response = "";
        for await (const chunk of stream) {
          const deltaText = typeof chunk.content === 'string' ? chunk.content : '';
          if (deltaText) {
            response += deltaText;
            if (emitter && typeof emitter.handleLLMNewToken === 'function') {
              emitter.handleLLMNewToken(deltaText, { isReasoning: false });
            }
          }
        }
        endGeneration(chatGen, { output: maskPII(preview(response)), model: 'deepseek-chat', metadata: { intent: 'chat_only' } });
      } catch (err) {
        console.error('[FinalResponseStep] 闲聊回复生成失败:', err);
        endGeneration(chatGen, { output: maskPII(preview(err.message)), level: 'ERROR', statusMessage: err.message, model: 'deepseek-chat', metadata: { intent: 'chat_only' } });
        response = "你好！我是您的 Executive Chat 智能助理。我能帮您查询门店表现、任务完成率、下钻区域数据等。";
      }
    } else {
      response = renderToolResultsMarkdown(state.toolResults || {}, state.intent) || "抱歉，我暂时无法回答这个问题，或者执行过程中遇到了错误。请稍后重试或尝试缩小查询范围。";
    }
  }

  response = sanitizeUserFacingMarkdown(response);
  return { finalResponse: response, reply_markdown: response, messages: [new AIMessage({ content: response })] };
};

module.exports = { finalResponseStep, sanitizeUserFacingMarkdown };
