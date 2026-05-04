/**
 * Prompt Registry — 集中管理所有 LLM 提示词
 *
 * 每个 Agent 的提示词独立文件（router.js / fc_agent.js / final_response.js 等），
 * 此文件负责加载、版本校验、模板变量填充。
 *
 * 用法:
 *   const registry = require('./prompts/registry');
 *   const filled = registry.fill('router', { userMessage: '...' });
 *
 * 调优流程:
 *   1. 改对应的 prompt 文件
 *   2. bump version
 *   3. 重启后端
 */

const routerPrompt = require('./router');
const fcAgentPrompt = require('./fc_agent');
const finalResponsePrompt = require('./final_response');

// ─── 模板填充 ──────────────────────────────────────────────────────────────────
function fill(template, vars = {}) {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), value ?? '');
  }
  return result;
}

// ─── 注册表 ────────────────────────────────────────────────────────────────────
const prompts = {
  router: {
    version: routerPrompt.version,
    systemPrompt: routerPrompt.systemPrompt,
  },
  fc_agent: {
    version: fcAgentPrompt.version,
    systemPrompt: fcAgentPrompt.systemPrompt,
    domainKnowledge: fcAgentPrompt.domainKnowledge,
    toolReference: fcAgentPrompt.toolReference,
    callOrderRules: fcAgentPrompt.callOrderRules,
    dataVolumeControl: fcAgentPrompt.dataVolumeControl,
    constraints: fcAgentPrompt.constraints,
  },
  final_response: {
    version: finalResponsePrompt.version,
    systemPrompt: finalResponsePrompt.systemPrompt,
    modifierFormats: finalResponsePrompt.modifierFormats,
    formatOrder: finalResponsePrompt.formatOrder,
    fewShot: finalResponsePrompt.fewShot,
    formattingRules: finalResponsePrompt.formattingRules,
  },
  // intent_classify 复用 router 提示词（同一功能，不同调用路径）
  intent_classify: {
    version: routerPrompt.version,
    systemPrompt: routerPrompt.systemPrompt,
  },
};

// ─── 便捷方法 ──────────────────────────────────────────────────────────────────

/** 获取完整 FC Agent system prompt（拼接所有段落） */
function getFcAgentFullPrompt() {
  const p = prompts.fc_agent;
  return [
    p.domainKnowledge,
    p.toolReference,
    p.callOrderRules,
    p.dataVolumeControl,
    p.constraints,
  ].join('\n\n');
}

/** 获取按 modifier 匹配的格式指令 */
function getModifierFormat(modifiers) {
  const p = prompts.final_response;
  const effective = { ...modifiers };
  // needs_lookup 拿到数据后应清除（不影响格式选择）
  if (effective.needs_lookup) delete effective.needs_lookup;

  const order = p.formatOrder;
  for (const key of order) {
    if (effective[key] && p.modifierFormats[key]) {
      return p.modifierFormats[key];
    }
  }
  return p.modifierFormats.default;
}

/** 生成 FinalResponseAgent 完整 system prompt */
function getFinalResponseFullPrompt(vars = {}) {
  const p = prompts.final_response;
  return fill(p.systemPrompt, vars);
}

module.exports = {
  prompts,
  fill,
  getFcAgentFullPrompt,
  getModifierFormat,
  getFinalResponseFullPrompt,
};
