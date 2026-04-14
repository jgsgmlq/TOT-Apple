'use strict';

const { execSync, exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');
const execAsync = util.promisify(exec);

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

let cachedToken = null;
let tokenExpiry = 0;

/**
 * 获取 AppleConnect Token
 * 缓存 50 分钟，以减少重复调用 shell
 */
function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }
  try {
    const cmd = `appleconnect getToken -t oauth -G pkce -C hvys3fcwcteqrvw3qzkvtk86viuoqv -o openid,dsid,accountname,email,groups --interactivity-type none | grep id-token | cut -d ' ' -f 2`;
    const token = execSync(cmd, { encoding: 'utf8' }).trim();
    if (!token) {
      throw new Error("Token output is empty");
    }
    cachedToken = token;
    tokenExpiry = Date.now() + 50 * 60 * 1000; // 50 mins caching
    return token;
  } catch (err) {
    console.error("Failed to get AppleConnect token:", err);
    throw new Error("AI Authentication Failed: Please check your appleconnect configuration.");
  }
}

/**
 * 调用 Gemini 2.5 Pro 生成文案
 * @param {string} prompt 给大模型的提示词
 * @returns {Promise<string>} 生成的文本内容
 */
async function generateText(prompt) {
  const token = getToken();
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
    console.error(`DeepSeek API Error: ${response.status} ${response.statusText}`, errorText);
    throw new Error(`DeepSeek API Failed: ${response.statusText}`);
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
    throw new Error(`DeepSeek chatWithTools failed: ${response.status} ${errorText}`);
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
}

module.exports = {
  generateText,
  generateTextDeepSeek,
  chatWithTools,
};