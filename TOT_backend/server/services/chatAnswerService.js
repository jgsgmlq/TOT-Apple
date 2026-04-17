'use strict';

const { generateTextDeepSeek, generateTextDeepSeekStream } = require('../utils/ai');
const { compressAssistantContent } = require('../utils/chatHistoryCompress');
const logger = require('../utils/logger');

const SYSTEM_PROMPT = `你是一个培训数据分析助手，请根据以下查询结果，用中文回答用户问题。
输出严格符合以下 JSON 格式（不加代码块标记，不加任何说明文字）:
{
  "overview": "...",
  "keyNumbers": [{"label": "...", "value": "...", "unit": "..."}],
  "attentionPoints": ["...", "..."],
  "followUpSuggestions": ["...", "..."]
}

要求：
- overview：不超过 60 字，简明总结数据情况
- keyNumbers：最多 4 项，数字必须来自查询结果，不得捏造；无数据时返回 []
- attentionPoints：最多 3 项，聚焦问题与风险；无问题时返回 []
- followUpSuggestions：最多 3 项，以"可追问："开头；无建议时返回 []
- 如果查询结果为空或 null，overview 说明"暂无相关数据"，其余字段返回空数组`;

function buildFormatPrompt(userMessage, toolResult, history) {
  const dataSection = toolResult != null
    ? `查询结果数据：\n${JSON.stringify(toolResult, null, 2)}`
    : '查询结果数据：无（用户问题不涉及系统数据，请自由回答或说明暂无相关数据）';

  const historyText = history
    .slice(-6)
    .map((m) => {
      if (m.role === 'assistant') {
        return `Assistant: ${compressAssistantContent(m.content ?? '')}`;
      }
      return `User: ${m.content ?? ''}`;
    })
    .join('\n');

  return [
    historyText ? `历史对话:\n${historyText}\n` : '',
    `用户问题：${userMessage}\n`,
    dataSection,
  ].join('\n');
}

function parseReplyFromRaw(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    logger.warn('answer_llm_empty_response');
    throw Object.assign(new Error('LLM returned empty response'), { status: 503, code: 'CHAT_001' });
  }
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    logger.warn('answer_llm_parse_error', { error: e.message, raw: raw.slice(0, 200) });
    throw Object.assign(new Error('LLM returned non-JSON response'), { status: 503, code: 'CHAT_001' });
  }
  return {
    overview:            String(parsed.overview || ''),
    keyNumbers:          Array.isArray(parsed.keyNumbers) ? parsed.keyNumbers : [],
    attentionPoints:     Array.isArray(parsed.attentionPoints) ? parsed.attentionPoints : [],
    followUpSuggestions: Array.isArray(parsed.followUpSuggestions) ? parsed.followUpSuggestions : [],
  };
}

/**
 * Format tool results into a structured ReplyContent object.
 * Throws { status: 503, code: 'CHAT_001' } on LLM failure -- caller (route) returns HTTP 503.
 * @param {string} userMessage
 * @param {any} toolResult
 * @param {Array<{role:string, content:string}>} history
 * @param {{ onDelta?: (chunk: string, meta?: { phase?: string }) => void } | null} [streamCallbacks] 若提供 onDelta，则走 DeepSeek 流式，与看板智能洞察一致
 * @returns {Promise<ReplyContent>}
 */
async function format(userMessage, toolResult, history, streamCallbacks = null) {
  const prompt = buildFormatPrompt(userMessage, toolResult, history);

  if (streamCallbacks && typeof streamCallbacks.onDelta === 'function') {
    let full;
    try {
      full = await generateTextDeepSeekStream(
        prompt,
        {
          system: SYSTEM_PROMPT,
          temperature: 0.3,
          maxTokens: 1024,
        },
        (chunk, meta) => streamCallbacks.onDelta(chunk, meta)
      );
    } catch (err) {
      logger.error('answer_llm_stream_failed', { error: err.message });
      throw Object.assign(new Error('LLM inference failed'), { status: 503, code: 'CHAT_001' });
    }
    return parseReplyFromRaw(full);
  }

  let raw;
  try {
    raw = await generateTextDeepSeek(prompt, {
      system: SYSTEM_PROMPT,
      temperature: 0.3,
      maxTokens: 1024,
    });
  } catch (err) {
    logger.error('answer_llm_failed', { error: err.message });
    throw Object.assign(new Error('LLM inference failed'), { status: 503, code: 'CHAT_001' });
  }

  return parseReplyFromRaw(raw);
}

module.exports = { format, buildFormatPrompt };
