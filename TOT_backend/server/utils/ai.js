'use strict';

const { execSync, exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');
const execAsync = util.promisify(exec);
const logger = require('./logger');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'ai_debug.log');

/**
 * Ensures the logs directory exists.
 */
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * Appends a debug log entry to the log file.
 */
function appendDebugLog(logObject) {
  try {
    ensureLogDir();
    fs.appendFileSync(LOG_FILE, JSON.stringify(logObject) + '\n');
  } catch (err) {
    console.error('[AI Debug Log Error]', err.message);
  }
}

function isRetriableError(err) {
  if (!err) return false;
  const msg = String(err.message || '');
  if (msg.includes('DEEPSEEK_API_KEY')) return false;
  const st = err.status;
  if (typeof st === 'number') {
    if (st === 400 || st === 401 || st === 403 || st === 404) return false;
    if (st === 429 || st >= 500) return true;
  }
  if (err.name === 'TypeError' || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND') {
    return true;
  }
  return false;
}

/**
 * @param {() => Promise<any>} fn
 * @param {number} [maxRetries=2] max retries after first attempt (default 3 total attempts)
 */
async function withRetry(fn, maxRetries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxRetries || !isRetriableError(err)) throw err;
      const delayMs = 300 * 2 ** attempt + Math.floor(Math.random() * 100);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

let cachedToken = null;
let tokenExpiry = 0;
let tokenPromise = null;

/**
 * 获取 AppleConnect Token
 * 缓存 50 分钟，以减少重复调用 shell
 */
async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }
  if (tokenPromise) {
    return tokenPromise;
  }
  tokenPromise = (async () => {
    try {
      const cmd = `appleconnect getToken -t oauth -G pkce -C hvys3fcwcteqrvw3qzkvtk86viuoqv -o openid,dsid,accountname,email,groups --interactivity-type none | grep id-token | cut -d ' ' -f 2`;
      const { stdout } = await execAsync(cmd, { encoding: 'utf8' });
      const token = stdout.trim();
      if (!token) {
        throw new Error("Token output is empty");
      }
      cachedToken = token;
      tokenExpiry = Date.now() + 50 * 60 * 1000; // 50 mins caching
      return token;
    } catch (err) {
      console.error("Failed to get AppleConnect token:", err);
      throw new Error("AI Authentication Failed: Please check your appleconnect configuration.");
    } finally {
      tokenPromise = null;
    }
  })();
  return tokenPromise;
}

/**
 * 调用 Gemini 2.5 Pro 生成文案
 * @param {string} prompt 给大模型的提示词
 * @returns {Promise<string>} 生成的文本内容
 */
async function generateText(prompt) {
  const token = await getToken();
  const url = "https://floodgate.g.apple.com/api/gemini/v1/publishers/google/models/gemini-2.5-pro:generateContent";
  const body = {
    contents: [{
      role: "user",
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2048
    }
  };

  // 使用系统 curl 绕过 Node.js 原生 fetch 在某些代理环境下的限制
  try {
    const cmd = `curl -s -X POST "${url}" \\
      -H "Content-Type: application/json" \\
      -H "Authorization: Bearer ${token}" \\
      -H "User-Agent: TOT-Apple-Backend/1.0" \\
      -d '${JSON.stringify(body).replace(/'/g, "'\\''")}'`;

    // 将 execSync 改为异步的 execAsync，防止阻塞 Node.js 主线程
    const { stdout } = await execAsync(cmd, { encoding: 'utf8' });
    const data = JSON.parse(stdout);
    
    if (data.error) {
      throw new Error(`AI API Error: ${data.error.message}`);
    }

    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  } catch (err) {
    console.error("Floodgate Curl API Error:", err);
    throw new Error("AI API Failed: 网络请求或解析错误");
  }
}

/**
 * 调用 DeepSeek Chat（OpenAI 兼容 HTTP API），密钥仅来自环境变量 DEEPSEEK_API_KEY，禁止硬编码
 * @param {string} prompt 用户提示词
 * @param {{ system?: string, model?: string, temperature?: number, maxTokens?: number }} [options]
 * @returns {Promise<string>} 助手回复正文
 */
async function generateTextDeepSeek(prompt, options = {}) {
  return withRetry(async () => {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey || String(apiKey).trim() === "") {
      throw new Error("DEEPSEEK_API_KEY is not set");
    }

    const messages = [];
    if (options.system) {
      messages.push({ role: "system", content: options.system });
    }
    messages.push({ role: "user", content: prompt });

    const body = {
      model: options.model || "deepseek-chat",
      messages,
      temperature: options.temperature ?? 0.1,
      max_tokens: options.maxTokens ?? 2048,
      stream: false
    };

    if (options.responseFormat) {
      body.response_format = options.responseFormat;
    }

    const isDebugEnabled = String(process.env.DEBUG_AI_LOG).toLowerCase() === 'true';
    const startTime = isDebugEnabled ? Date.now() : 0;

    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "User-Agent": "TOT-Apple-Backend/1.0"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (isDebugEnabled) {
        appendDebugLog({
          timestamp: new Date().toISOString(),
          action: 'generateTextDeepSeek',
          request: body,
          error: { status: response.status, text: errorText },
          latencyMs: Date.now() - startTime
        });
      }
      logger.error('deepseek_api_error', { status: response.status, statusText: response.statusText });
      throw Object.assign(new Error(`DeepSeek API Failed: ${response.statusText}`), { status: response.status });
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content || "";

    if (isDebugEnabled) {
      appendDebugLog({
        timestamp: new Date().toISOString(),
        action: 'generateTextDeepSeek',
        request: body,
        response: {
          rawContent,
          latencyMs: Date.now() - startTime
        }
      });
    }

    return rawContent;
  });
}

/**
 * 解析 DeepSeek 流式 chunk：`deepseek-chat` 仅有 `delta.content`；
 * `deepseek-reasoner` 可能同时出现 `delta.reasoning_content`（思维链）与 `delta.content`（最终答复）。
 * @param {object} json choices[0] 所在 JSON
 * @param {(chunk: string, meta?: { phase: 'reasoning' | 'content' }) => void} [onChunk]
 * @returns {string} 仅累加 **content**（用于落库正文；不含思维链）
 */
function accumulateDeepSeekStreamDelta(json, onChunk) {
  const d = json.choices?.[0]?.delta;
  if (!d) return '';
  if (d.reasoning_content && typeof onChunk === 'function') {
    onChunk(d.reasoning_content, { phase: 'reasoning' });
  }
  let contentAcc = '';
  if (d.content) {
    contentAcc = d.content;
    if (typeof onChunk === 'function') onChunk(d.content, { phase: 'content' });
  }
  return contentAcc;
}

/**
 * DeepSeek 流式输出（OpenAI 兼容 SSE）。仅当上游支持 stream 时使用。
 * @param {string} userPrompt
 * @param {{ system?: string, model?: string, temperature?: number, maxTokens?: number }} [options]
 * @param {(chunk: string, meta?: { phase: 'reasoning' | 'content' }) => void} [onChunk] 每个文本增量；reasoner 时 `phase` 区分思维链与正文
 * @returns {Promise<string>} 拼接后的 **content** 全文（不含 reasoning_content）
 */
async function generateTextDeepSeekStream(userPrompt, options = {}, onChunk) {
  return withRetry(async () => {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey || String(apiKey).trim() === '') {
      throw new Error('DEEPSEEK_API_KEY is not set');
    }

    const messages = [];
    if (options.system) {
      messages.push({ role: 'system', content: options.system });
    }
    messages.push({ role: 'user', content: userPrompt });

    const body = {
      model: options.model || 'deepseek-chat',
      messages,
      temperature: options.temperature ?? 0.1,
      max_tokens: options.maxTokens ?? 2048,
      stream: true,
    };

    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': 'TOT-Apple-Backend/1.0',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`DeepSeek stream API Error: ${response.status}`, errorText);
      throw Object.assign(new Error(`DeepSeek stream failed: ${response.statusText}`), { status: response.status });
    }

    if (!response.body) {
      throw new Error('DeepSeek stream: empty body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n');
      buffer = parts.pop() || '';
      for (const line of parts) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (!trimmed.startsWith('data: ')) continue;
        const payload = trimmed.slice(6).trim();
        if (payload === '[DONE]') continue;
        try {
          const json = JSON.parse(payload);
          full += accumulateDeepSeekStreamDelta(json, onChunk);
        } catch {
          /* 忽略不完整 JSON 行 */
        }
      }
    }

    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith('data: ')) {
        const payload = trimmed.slice(6).trim();
        if (payload && payload !== '[DONE]') {
          try {
            const json = JSON.parse(payload);
            full += accumulateDeepSeekStreamDelta(json, onChunk);
          } catch {
            /* ignore */
          }
        }
      }
    }

    return full;
  });
}

/**
 * OpenAI-compatible chat completions with optional tool/function calling.
 * Used by chatAgentRunner.js in function_calling mode.
 *
 * @param {{
 *   messages: Array<{role:string, content:string|null, tool_calls?: any, tool_call_id?: string}>,
 *   tools?: object[],
 *   tool_choice?: 'auto'|'none'|object,
 *   model?: string,
 *   temperature?: number,
 *   maxTokens?: number
 * }} options
 * @returns {Promise<{ content: string|null, tool_calls: any[]|null }>}
 */
async function chatWithTools(options) {
  return withRetry(async () => {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey || String(apiKey).trim() === '') {
      throw new Error('DEEPSEEK_API_KEY is not set');
    }

    const body = {
      model: options.model || 'deepseek-chat',
      messages: options.messages,
      temperature: options.temperature ?? 0.1,
      max_tokens: options.maxTokens ?? 2048,
      stream: false,
    };

    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools;
      body.tool_choice = options.tool_choice || 'auto';
    }

    if (options.response_format) {
      body.response_format = options.response_format;
    }

    const isDebugEnabled = String(process.env.DEBUG_AI_LOG).toLowerCase() === 'true';
    const startTime = isDebugEnabled ? Date.now() : 0;

    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'User-Agent': 'TOT-Apple-Backend/1.0',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (isDebugEnabled) {
        appendDebugLog({
          timestamp: new Date().toISOString(),
          action: 'chatWithTools',
          request: body,
          error: { status: response.status, text: errorText },
          latencyMs: Date.now() - startTime
        });
      }
      throw Object.assign(
        new Error(`DeepSeek chatWithTools failed: ${response.status} ${String(errorText).slice(0, 300)}`),
        { status: response.status }
      );
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    if (!choice) throw new Error('DeepSeek returned no choices');

    if (isDebugEnabled) {
      appendDebugLog({
        timestamp: new Date().toISOString(),
        action: 'chatWithTools',
        request: body,
        response: {
          content: choice.message?.content,
          tool_calls: choice.message?.tool_calls,
          latencyMs: Date.now() - startTime
        }
      });
    }

    return {
      content:    choice.message?.content ?? null,
      tool_calls: choice.message?.tool_calls ?? null,
    };
  });
}

/**
 * 与 {@link chatWithTools} 相同请求体，但 `stream: true`；对每个增量调用 `onDelta`（含 reasoning / content），
 * 用于 Executive Chat SSE；FC 模式下工具轮次与最终 JSON 均可流式输出 token。
 * @param {object} options 同 chatWithTools，另需 `onDelta: (chunk: string, meta?: { phase: 'reasoning'|'content' }) => void`
 * @returns {Promise<{ content: string|null, tool_calls: any[]|null }>}
 */
async function chatWithToolsStream(options) {
  const onDelta = options.onDelta;
  if (typeof onDelta !== 'function') {
    throw new Error('chatWithToolsStream requires options.onDelta');
  }

  return withRetry(async () => {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey || String(apiKey).trim() === '') {
      throw new Error('DEEPSEEK_API_KEY is not set');
    }

    const body = {
      model: options.model || 'deepseek-chat',
      messages: options.messages,
      temperature: options.temperature ?? 0.1,
      max_tokens: options.maxTokens ?? 2048,
      stream: true,
    };

    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools;
      body.tool_choice = options.tool_choice || 'auto';
    }

    if (options.response_format) {
      body.response_format = options.response_format;
    }

    const isDebugEnabled = String(process.env.DEBUG_AI_LOG).toLowerCase() === 'true';
    const startTime = isDebugEnabled ? Date.now() : 0;

    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': 'TOT-Apple-Backend/1.0',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (isDebugEnabled) {
        appendDebugLog({
          timestamp: new Date().toISOString(),
          action: 'chatWithToolsStream',
          request: body,
          error: { status: response.status, text: errorText },
          latencyMs: Date.now() - startTime,
        });
      }
      throw Object.assign(
        new Error(`DeepSeek chatWithToolsStream failed: ${response.status} ${String(errorText).slice(0, 300)}`),
        { status: response.status }
      );
    }

    if (!response.body) {
      throw new Error('DeepSeek chatWithToolsStream: empty body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let messageContent = '';
    /** @type {Array<{ id: string, type: string, function: { name: string, arguments: string } }>} */
    const toolCallSlots = [];

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n');
      buffer = parts.pop() || '';
      for (const line of parts) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (!trimmed.startsWith('data: ')) continue;
        const payload = trimmed.slice(6).trim();
        if (payload === '[DONE]') continue;
        try {
          const json = JSON.parse(payload);
          const d = json.choices?.[0]?.delta;
          if (!d) continue;
          if (d.reasoning_content) {
            onDelta(d.reasoning_content, { phase: 'reasoning' });
          }
          if (d.content) {
            messageContent += d.content;
            onDelta(d.content, { phase: 'content' });
          }
          if (d.tool_calls && Array.isArray(d.tool_calls)) {
            for (const p of d.tool_calls) {
              const idx = typeof p.index === 'number' ? p.index : 0;
              if (!toolCallSlots[idx]) {
                toolCallSlots[idx] = {
                  id: '',
                  type: 'function',
                  function: { name: '', arguments: '' },
                };
              }
              if (p.id) toolCallSlots[idx].id = p.id;
              if (p.type) toolCallSlots[idx].type = p.type;
              if (p.function?.name) toolCallSlots[idx].function.name += p.function.name;
              if (p.function?.arguments) toolCallSlots[idx].function.arguments += p.function.arguments;
            }
          }
        } catch {
          /* 忽略不完整 JSON */
        }
      }
    }

    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith('data: ')) {
        const payload = trimmed.slice(6).trim();
        if (payload && payload !== '[DONE]') {
          try {
            const json = JSON.parse(payload);
            const d = json.choices?.[0]?.delta;
            if (d) {
              if (d.reasoning_content) onDelta(d.reasoning_content, { phase: 'reasoning' });
              if (d.content) {
                messageContent += d.content;
                onDelta(d.content, { phase: 'content' });
              }
              if (d.tool_calls && Array.isArray(d.tool_calls)) {
                for (const p of d.tool_calls) {
                  const idx = typeof p.index === 'number' ? p.index : 0;
                  if (!toolCallSlots[idx]) {
                    toolCallSlots[idx] = {
                      id: '',
                      type: 'function',
                      function: { name: '', arguments: '' },
                    };
                  }
                  if (p.id) toolCallSlots[idx].id = p.id;
                  if (p.type) toolCallSlots[idx].type = p.type;
                  if (p.function?.name) toolCallSlots[idx].function.name += p.function.name;
                  if (p.function?.arguments) toolCallSlots[idx].function.arguments += p.function.arguments;
                }
              }
            }
          } catch {
            /* ignore */
          }
        }
      }
    }

    const tool_calls = toolCallSlots.length ? toolCallSlots.filter(Boolean) : null;

    if (isDebugEnabled) {
      appendDebugLog({
        timestamp: new Date().toISOString(),
        action: 'chatWithToolsStream',
        request: body,
        response: {
          contentLen: messageContent?.length ?? 0,
          toolCallCount: tool_calls?.length ?? 0,
          latencyMs: Date.now() - startTime,
        },
      });
    }

    return {
      content: messageContent || null,
      tool_calls: tool_calls && tool_calls.length ? tool_calls : null,
    };
  });
}

module.exports = {
  generateText,
  generateTextDeepSeek,
  generateTextDeepSeekStream,
  chatWithTools,
  chatWithToolsStream,
  withRetry,
};