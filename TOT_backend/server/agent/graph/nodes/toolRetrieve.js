'use strict';

const { startNodeSpan } = require('../shared/spanHelper');
const { endSpan } = require('../../../utils/tracer');
const chatToolsService = require('../../../services/chatToolsService');
const RoutingPolicy = require('../routingPolicy');

// ─── 工具候选映射（intent → 工具名列表） ─────────────────────────────────────
// 这是 ToolRetrieve 节点和 getLlmWithTools 的唯一权威来源。
// 任何对工具集合的修改都应该改这里，并由下方启动校验保证名字真实存在。
const INTENT_TOOL_MAP = Object.freeze({
  query_metrics:   ["queryExecutiveMetrics", "getOverviewData", "getRegionDetailData", "searchEntities"],
  progress_query:  ["getOverviewData", "queryExecutiveMetrics", "searchEntities"],
  project_status:  ["getTaskListData", "getOverviewData", "queryExecutiveMetrics", "searchEntities"],
  warning_query:   ["getWarningsData", "queryExecutiveMetrics", "getStoreDetailData", "searchEntities"],
  drill_down:      ["getRegionDetailData", "getStoreDetailData", "queryExecutiveMetrics", "searchEntities"],
  analytics_query: ["runAnalytics", "queryExecutiveMetrics", "fetchRawDataset", "searchEntities"],
});

// Router LLM 偶尔会输出 spec 文档里的别名（task_status/store_warning/...）或常见错别字，
// 不要让它们落到 fallback 走错工具。INTENT_ALIAS_MAP / normalizeIntent 已抽到
// `./intents.js`（避免与 renderers.js 形成循环依赖），这里直接 require。
// 新增 alias 在 intents.js 添加，不要在这里复制一份。
const { INTENT_ALIAS_MAP, normalizeIntent } = require('../intents');

// intent 未命中时的兜底候选；同时也是 getLlmWithTools 的最终 fallback。
const FALLBACK_TOOL_NAMES = Object.freeze(["queryExecutiveMetrics", "getOverviewData", "getTaskListData", "searchEntities"]);

// ─── BM25 工具索引 ──────────────────────────────────────────────────────
// 在模块加载时为所有注册工具的 description 建立 BM25 索引；
// ToolRetrieve 使用 「intent_map (prior) + bm25(userMessage) (likelihood)」 的混合排序。
const { BM25Index } = require('../toolRetriever');
const TOOL_INDEX = (() => {
  const names = chatToolsService.getRegisteredToolNames();
  const docs = names.map(name => {
    const schema = chatToolsService.getToolSchemasByNames([name])[0];
    const desc = schema?.function?.description || '';
    return { id: name, text: `${name} ${desc}` };
  });
  return new BM25Index(docs);
})();

// 启动校验：若 intentMap / fallback 引用了未注册的工具名，立即崩溃 — 强制开发者修复。
(() => {
  const registered = new Set(chatToolsService.getRegisteredToolNames());
  if (registered.size === 0) {
    console.warn("[graph/nodes] tools registry is empty at module load; skipping intent-map validation");
    return;
  }
  const allMentioned = new Set([
    ...Object.values(INTENT_TOOL_MAP).flat(),
    ...FALLBACK_TOOL_NAMES,
  ]);
  const missing = [...allMentioned].filter(n => !registered.has(n));
  if (missing.length > 0) {
    throw new Error(
      `[graph/nodes] INTENT_TOOL_MAP references tools that are not registered: ${missing.join(", ")}. ` +
      `Registered tools: ${[...registered].join(", ")}`
    );
  }

  // 同样校验 INTENT_ALIAS_MAP：每个 alias 的 value 都必须是 INTENT_TOOL_MAP 的 key 或 'chat_only'。
  // 防止以后加 alias 时拼错 canonical 名。
  const validCanonical = new Set([...Object.keys(INTENT_TOOL_MAP), 'chat_only']);
  const badAliases = Object.entries(INTENT_ALIAS_MAP)
    .filter(([, target]) => !validCanonical.has(target))
    .map(([k, v]) => `${k}->${v}`);
  if (badAliases.length > 0) {
    throw new Error(
      `[graph/nodes] INTENT_ALIAS_MAP has invalid canonical targets: ${badAliases.join(", ")}. ` +
      `Valid targets: ${[...validCanonical].join(", ")}`
    );
  }
})();

// 内部 inline normalizeIntent 已迁移到顶层（line ~85），保留这一行注释提示修改史。
// 注意：原版本把 progress_query 当 alias 映射到 query_metrics；现在 progress_query 已升为
// INTENT_TOOL_MAP 独立 key，候选工具更精准（[getOverviewData, queryExecutiveMetrics]），
// 不要再恢复 alias 映射。

const toolRetrieve = async (state) => {
  const span = startNodeSpan(state, 'ToolRetrieve', { intent: state.intent, userMessage: (state.userMessage || '').slice(0, 200) });

  const intent = normalizeIntent(state.intent);
  const msg = state.userMessage || '';

  // 多意图启发式（不用 LLM，零成本）：
  //   连接词 → 几乎肯定是多个独立问题
  //   多个问号 → 口语化多问题
  //   长句 + 逗号/分号/换行 → 多个子句，可能包含多个问题
  const MULTI_CONJUNCTIONS = ['另外', '还有', '以及', '同时', '此外', '再加上', '顺便'];
  const hasConjunction = MULTI_CONJUNCTIONS.some(c => msg.includes(c));
  const multiQuestionMarks = (msg.match(/[？?]/g) || []).length >= 2;
  const hasClauses = (msg.includes('，') || msg.includes('；') || msg.includes('\n')) && msg.length > 50;
  const looksMultiQuestion = hasConjunction || multiQuestionMarks || hasClauses;

  const topK = looksMultiQuestion
    ? 5  // 多意图放宽，确保覆盖所有子问题的工具
    : (RoutingPolicy.tiers[state.selected_tier]?.tool_top_k || 3);

  // ── Prior：intent map 给出的候选（按列表顺序赋递减分数） ────────────
  const intentSeed = INTENT_TOOL_MAP[intent];
  if (!intentSeed) {
    console.warn(`[ToolRetrieve] 意图 '${intent}' 未在 INTENT_TOOL_MAP 中注册`);
  }
  // 多问题时 → 全工具 + 平坦 prior，让 FC LLM 自己挑工具回答所有子问题
  const seedList = (looksMultiQuestion || !intentSeed)
    ? chatToolsService.getRegisteredToolNames()
    : intentSeed;
  const PRIOR_BASE = 5;
  const PRIOR_DECAY = 0.5;

  // chat_only / 兜底 / 多问题时 prior 平坦 —— 工具排名完全由 BM25 + 上下文决定
  const isFlatPrior = intent === 'chat_only' || !intentSeed || looksMultiQuestion;

  const scoreById = new Map();
  seedList.forEach((id, i) => {
    const prior = isFlatPrior ? PRIOR_BASE : (PRIOR_BASE - i * PRIOR_DECAY);
    scoreById.set(id, (scoreById.get(id) || 0) + prior);
  });

  // ── Likelihood：BM25(用户消息 + 最近对话上下文) ──────────────────
  // 当用户消息极短（如"可以""需要"）时，BM25 需要对话历史中的关键词来评分
  // 限制 BM25 只对 seedList 内的工具评分，防止非意图工具通过高分挤入 Top-K
  const seedSet = new Set(seedList);
  const recentAssistantText = (state.messages || [])
    .filter(m => m._getType && m._getType() === 'ai')
    .slice(-2)
    .map(m => typeof m.content === 'string' ? m.content.slice(0, 500) : '')
    .join(' ');
  const bm25Query = recentAssistantText
    ? `${state.userMessage || ''} ${recentAssistantText}`
    : (state.userMessage || '');
  const bm25Ranked = TOOL_INDEX.score(bm25Query);
  for (const { id, score } of bm25Ranked) {
    if (score <= 0) continue;
    if (!seedSet.has(id)) continue;
    scoreById.set(id, (scoreById.get(id) || 0) + score);
  }

  // ── 排序、Top-K、与真实注册表二次过滤 ──────────────────────────────
  const ranked = [...scoreById.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);

  const candidates = chatToolsService.getToolSchemasByNames(ranked)
    .map(schema => schema.function.name)
    .slice(0, topK);

  console.log(`[ToolRetrieve] 意图: ${intent}, 候选工具(混合排序): ${candidates.join(', ')}`);

  endSpan(span, { output: candidates.join(', '), metadata: { intent, topK, isMultiQuestion: looksMultiQuestion, isFlatPrior } });

  return {
    candidateTools: candidates
  };
};

module.exports = { toolRetrieve, INTENT_TOOL_MAP, FALLBACK_TOOL_NAMES };
