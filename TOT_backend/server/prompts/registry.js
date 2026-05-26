'use strict';

/**
 * Prompt 注册表 — Executive Chat 所有 LLM prompt 的单一入口。
 *
 * 所有 prompt 存储在 prompts/src/*.md 中，通过 loader.js 加载。
 * 支持 ${var} 模板变量替换。
 *
 * 用法：
 *   const registry = require('./prompts/registry');
 *   const prompt = registry.get('router');             // 静态 prompt
 *   const prompt = registry.get('fc_agent', ctx);      // 带变量替换
 *   const version = registry.version('fc_agent');      // "fc/v3"
 *
 * 直接编辑 .md 文件即可修改 prompt，无需改 JS。
 */

const { loadPrompt, loadAndRender } = require('./loader');

const PROMPTS = {
  router:            { version: 'router/v3',               get: () => loadPrompt('router_v3') },
  fc_agent:          { version: 'fc/v5',                   get: (ctx) => loadAndRender('fc_agent_v5', ctx) },
  fc_agent_v5:       { version: 'fc/v5',                   get: (ctx) => loadAndRender('fc_agent_v5', ctx) },
  chat_reply:        { version: 'chat/v1',                 get: () => loadPrompt('chat_reply_v1') },
  safety_gateway:    { version: 'safety_gateway/v1',       get: () => loadPrompt('safety_gateway_v1') },
  safety_gateway_v2: { version: 'safety_gateway/v2',       get: (ctx) => loadAndRender('safety_gateway_v2', ctx || {}) },
  final_response_planner: { version: 'final_response_planner/v1', get: () => loadPrompt('final_response_planner_v1') },
  final_response:    { version: 'final_response/v3',       get: (ctx) => loadAndRender('final_response_v3', ctx || {}) },
  title_generator:   { version: 'title/v1',                get: () => loadPrompt('title_generator_v1') },
};

/**
 * @param {string} name
 * @param {object} [ctx] — 模板变量
 * @returns {string}
 */
function get(name, ctx) {
  const entry = PROMPTS[name];
  if (!entry) throw new Error(`[prompts/registry] unknown prompt: ${name}`);
  return entry.get(ctx);
}

/**
 * @param {string} name
 * @returns {string}
 */
function version(name) {
  const entry = PROMPTS[name];
  if (!entry) throw new Error(`[prompts/registry] unknown prompt: ${name}`);
  return entry.version;
}

module.exports = { get, version, loadPrompt, loadAndRender };
