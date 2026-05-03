'use strict';

const logger = require('../utils/logger');

const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_MODEL = 'qwen3-asr-flash';

function getApiKey() {
  const raw = process.env.ASR_API_KEY || process.env.DASHSCOPE_API_KEY || '';
  return String(raw).trim();
}

function getBaseUrl() {
  const raw = process.env.ASR_BASE_URL || DEFAULT_BASE_URL;
  return String(raw).replace(/\/+$/, '');
}

/**
 * 将音频转为文字（阿里云百炼 OpenAI 兼容 Chat Completions，模型 qwen3-asr-flash）
 * @param {{ audioData: string, language?: string, enableItn?: boolean }} input
 * @returns {Promise<{ text: string, model: string, raw?: object }>}
 */
async function transcribe({ audioData, language, enableItn }) {
  const apiKey = getApiKey();
  if (!apiKey) {
    const err = new Error('ASR_API_KEY 未配置');
    err.status = 503;
    err.errorCode = 'ASR_001';
    throw err;
  }

  const baseUrl = getBaseUrl();
  const asrOptions = {};
  if (language !== undefined && language !== null && String(language).trim() !== '') {
    asrOptions.language = String(language).trim();
  }
  if (enableItn === true || enableItn === false) {
    asrOptions.enable_itn = enableItn;
  }

  const body = {
    model: process.env.ASR_MODEL || DEFAULT_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'input_audio',
            input_audio: { data: audioData },
          },
        ],
      },
    ],
    stream: false,
    asr_options: asrOptions,
  };

  const url = `${baseUrl}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'User-Agent': 'TOT-Apple-Backend/1.0',
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    logger.error('asr_upstream_non_json', { status: res.status, snippet: text.slice(0, 200) });
    const err = new Error('ASR 上游返回非 JSON');
    err.status = 502;
    err.errorCode = 'ASR_002';
    throw err;
  }

  if (!res.ok || json.error) {
    const upstreamMsg =
      json.error?.message ||
      json.message ||
      (typeof json === 'string' ? json : null) ||
      res.statusText;
    logger.error('asr_upstream_error', { status: res.status, error: json.error || json });
    const err = new Error(`ASR 调用失败：${upstreamMsg}`);
    err.status = res.status >= 400 && res.status < 600 ? res.status : 502;
    err.errorCode = 'ASR_003';
    throw err;
  }

  const content = json.choices?.[0]?.message?.content;
  const outText = typeof content === 'string' ? content : content != null ? String(content) : '';

  return {
    text: outText,
    model: json.model || body.model,
    raw: process.env.DEBUG_AI_LOG === 'true' ? json : undefined,
  };
}

module.exports = { transcribe, getApiKey, getBaseUrl };
