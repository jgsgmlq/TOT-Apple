'use strict';

/**
 * Prompt 注册表 — Executive Chat 所有 LLM prompt 的单一入口。
 *
 * 用法：
 *   const registry = require('./prompts/registry');
 *   const prompt = registry.get('router');             // 字符串
 *   const prompt = registry.get('fc_agent', ctx);      // ctx 填充模板
 *   const version = registry.version('fc_agent');      // "fc/v2"
 *
 * 新增 prompt：
 *   1. 在 prompts/ 下新建文件，导出 { XXX_PROMPT_VERSION, ... }
 *   2. 在此文件的 register() 中添加
 *   3. nodes.js 中用 registry.get('xxx') 替代内联字符串
 */

const { ROUTER_PROMPT_VERSION, ROUTER_SYSTEM_PROMPT } = require('./router');
const { FC_PROMPT_VERSION, buildFcPrompt, FC_PROMPT_V4_VERSION, buildFcPromptV4 } = require('./fc_agent');
const { CHAT_REPLY_PROMPT_VERSION, CHAT_REPLY_PROMPT } = require('./chat_reply');
const { SAFETY_GATEWAY_VERSION, SAFETY_GATEWAY_PROMPT, SAFETY_GATEWAY_V2_VERSION, SAFETY_GATEWAY_V2_PROMPT } = require('./safetyGateway');
const { FINAL_RESPONSE_VERSION, FINAL_RESPONSE_PROMPT } = require('./final_response');

const PROMPTS = {
  router:         { version: ROUTER_PROMPT_VERSION,       get: () => ROUTER_SYSTEM_PROMPT },
  fc_agent:       { version: FC_PROMPT_VERSION,           get: (ctx) => buildFcPrompt(ctx) },
  fc_agent_v4:    { version: FC_PROMPT_V4_VERSION,        get: (ctx) => buildFcPromptV4(ctx) },
  chat_reply:     { version: CHAT_REPLY_PROMPT_VERSION,   get: () => CHAT_REPLY_PROMPT },
  safety_gateway: { version: SAFETY_GATEWAY_VERSION,      get: () => SAFETY_GATEWAY_PROMPT },
  safety_gateway_v2: { version: SAFETY_GATEWAY_V2_VERSION, get: () => SAFETY_GATEWAY_V2_PROMPT },
  final_response: { version: FINAL_RESPONSE_VERSION,      get: () => FINAL_RESPONSE_PROMPT },
};

/**
 * 获取 prompt 字符串。
 * @param {string} name — 'router' | 'fc_agent' | 'chat_reply'
 * @param {object} [ctx] — 模板上下文（仅 fc_agent 需要）
 * @returns {string}
 */
function get(name, ctx) {
  const entry = PROMPTS[name];
  if (!entry) throw new Error(`[prompts/registry] unknown prompt: ${name}`);
  return entry.get(ctx);
}

/**
 * 获取 prompt 版本号。
 * @param {string} name
 * @returns {string}
 */
function version(name) {
  const entry = PROMPTS[name];
  if (!entry) throw new Error(`[prompts/registry] unknown prompt: ${name}`);
  return entry.version;
}

module.exports = { get, version };
