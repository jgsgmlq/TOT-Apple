/**
 * decisionRules.js — 集中管理所有硬编码的业务规则
 *
 * 每个规则都是纯函数，输入 state/args，输出 boolean/{...}。
 * 规则散落在 nodes.js 各处之前，现在统一收拢到此文件，
 * 便于查找、测试、修改。
 */

// ═══════════════════════════════════════════════════════════════════════════════
// §1. 澄清反问检测（Clarification Detection）
// ═══════════════════════════════════════════════════════════════════════════════

/** 判断 FC Agent 的输出是否为反问（非数据答案） */
function isClarification(fullContent) {
  return /[？?]/.test(fullContent) && !/\|/.test(fullContent);
}

/**
 * 从 FC Agent 的反问文本中提取纯问句。
 * 规则：找最后一个？，向前取到句号/换行或文本开头，向后截断只保留到？
 * 例： "用户想查渠道。L3还是L4？L3是RTM。" → "L3还是L4？"
 */
function extractQuestionText(content) {
  const qEnd = Math.max(content.lastIndexOf('？'), content.lastIndexOf('?'));
  if (qEnd < 0) return content.trim();
  const qStart = Math.max(
    content.lastIndexOf('。', qEnd - 1),
    content.lastIndexOf('\n', qEnd - 1),
    0
  );
  return content.slice(qStart > 0 ? qStart + 1 : 0, qEnd + 1).trim();
}

// ═══════════════════════════════════════════════════════════════════════════════
// §2. 歧义判断（Ambiguity Detection）
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 用户是否表达了紧急信号（有时间压力或行动意图）。
 * 只有用户措辞包含这些词时，系统才自动选任务；
 * 否则弹 HITL 或反问。
 */
const URGENCY_WORDS = /关注|临期|紧急|催办|挽回/;
function userHasUrgency(userMessage) {
  return URGENCY_WORDS.test(userMessage || '');
}

/** 用户是否只要单一答案（"哪个"）而非排名列表（"哪些"） */
const PICK_ONE_WORDS = /哪个|哪一个|哪一家|哪家/;
function userWantsPickOne(userMessage) {
  return PICK_ONE_WORDS.test(userMessage || '');
}

/**
 * 用户是否指定了具体维度。
 * 有维度 → rank(维度)；无维度 → 全局概览（不调工具，分析 listTasks）
 */
function userSpecifiedDimension(userMessage) {
  const msg = userMessage || '';
  if (/门店|店$|哪个店|哪些店/.test(msg)) return 'store';
  if (/渠道|业态|RTM|L3|L4/i.test(msg)) return 'channel';
  if (/员工|人员/.test(msg)) return 'employee';
  if (/经销商/.test(msg)) return 'dealer';
  if (/区域|华东|华南|华北|地区/.test(msg)) return 'region';
  return null; // 无具体维度 → 全局概览
}

/**
 * 检测渠道层级歧义：工具调用带了 channel_l3/channel_l4，
 * 但用户消息里没有指定具体层级。
 */
const CHANNEL_LEVEL_SPECIFIC = /l3|l4|rtm|业态|format|monobrand|multibrand|carrier|mono|lifestyle|mass.?merchant/i;
function hasChannelLevelAmbiguity(args, userMessage) {
  const dims = [];
  if (Array.isArray(args.dimensions)) dims.push(...args.dimensions);
  if (typeof args.dimension === 'string') dims.push(args.dimension);
  const hasChannel = dims.some(d => d === 'channel_l3' || d === 'channel_l4');
  return hasChannel && !CHANNEL_LEVEL_SPECIFIC.test(userMessage || '');
}

/** channel 层级反问模板 */
function channelLevelClarificationText() {
  return '你想查哪个层级的渠道？\n- **L3 渠道（RTM）**：Monobrand、Multibrand、Carrier\n- **L4 渠道（业态）**：MONO、Lifestyle、Campus、Mass Merchant';
}

// ═══════════════════════════════════════════════════════════════════════════════
// §3. HITL 触发策略（Human-in-the-Loop）
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * listTasks 被调用时，判断应该 auto-select、HITL、还是放行。
 *
 * 返回：'auto_select' | 'hitl' | 'pass'
 */
function listTasksAction(hasRankingSignal, hasDetailSignal, userMessage) {
  if (hasRankingSignal && userHasUrgency(userMessage)) return 'auto_select';
  if (hasRankingSignal && !userHasUrgency(userMessage)) return 'hitl';
  if (hasDetailSignal) return 'pass';
  return 'hitl'; // 无信号 → 不知道用户要什么 → 问用户
}

// ═══════════════════════════════════════════════════════════════════════════════
// §4. 工具调用控制（Tool Call Control）
// ═══════════════════════════════════════════════════════════════════════════════

/** HITL resume 后应禁用的工具列表（已选任务，不需要再列） */
const TOOLS_BLOCKED_AFTER_RESUME = ['listTasks'];

/**
 * 过滤 resume 后不应出现的工具调用。
 * DeepSeek 可能从对话历史中记住被移除的工具，强行调用。
 */
function filterDisallowedToolCalls(toolCalls, availableSchemas) {
  const allowed = new Set((availableSchemas || []).map(s => s.function?.name).filter(Boolean));
  return (toolCalls || []).filter(tc => allowed.has(tc.function?.name));
}

/** 构建 resume 后的候选工具列表 */
function candidateToolsAfterResume(candidateTools) {
  return (candidateTools || []).filter(t => !TOOLS_BLOCKED_AFTER_RESUME.includes(t));
}

/** neverDrawModifiers：这些 modifier 自己不产生图表数据 */
const NEVER_DRAW_MODIFIERS = ['needs_funnel', 'needs_analytics', 'needs_detail', 'needs_lookup'];

function shouldNeverDrawChart(modifiers) {
  // 只有在没有图表类 modifier 时，neverDraw 才生效
  const hasChartModifier = modifiers.needs_timeseries ||
    modifiers.needs_ranking ||
    modifiers.needs_comparison ||
    modifiers.needs_distribution;
  if (hasChartModifier) return false;
  return NEVER_DRAW_MODIFIERS.some(m => modifiers[m]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// §5. 图表决策（Chart Decision）
// ═══════════════════════════════════════════════════════════════════════════════

/** modifier → 图表类型 + 数据上限 */
function getChartConfig(modifiers) {
  if (modifiers.needs_timeseries)   return { type: 'line', maxRows: 30, maxMetrics: 5 };
  if (modifiers.needs_ranking)      return { type: 'bar',  maxRows: 10, maxMetrics: 3 };
  if (modifiers.needs_comparison)   return { type: 'bar',  maxRows: 5,  maxMetrics: 5 };
  if (modifiers.needs_distribution) return { type: 'bar',  maxRows: 12, maxMetrics: 1 };
  return null; // 无 modifier → 默认逻辑
}

/** 生成图表标题 */
function makeChartTitle(metricSeriesName, modifier, chartType, labelKey) {
  const metric = (metricSeriesName || '').replace(/\([^)]*\)$/, '').trim();
  if (chartType === 'big_number') return metric;

  if (modifier.needs_ranking) {
    const dim = (labelKey || '').includes('store') || (labelKey || '').includes('门店') ? '门店' : '各维度';
    return `${dim}${metric}排名`;
  }
  if (modifier.needs_comparison)   return `各组${metric}对比`;
  if (modifier.needs_distribution) return `${metric}分布`;
  if (modifier.needs_timeseries)   return `${metric}趋势`;
  return `${metric}对比`;
}

/** big_number 场景下是否需要表格兜底 */
function needsTableForBigNumber(metricCount) {
  return metricCount > 1;
}

/** 图表系列数 < 指标数时是否需要表格 */
function needsTableForSeries(metricCount, seriesCount) {
  return metricCount > seriesCount;
}

// ═══════════════════════════════════════════════════════════════════════════════
// §6. 指标元数据（Metric Labels）
// ═══════════════════════════════════════════════════════════════════════════════

const METRIC_META = {
  totalTasks:             { label: '任务数',    unit: '个',   chartLabel: '任务数(个)' },
  totalAssignments:       { label: '总人次',    unit: '人次', chartLabel: '总人次' },
  total_assignments:      { label: '总人次',    unit: '人次', chartLabel: '总人次' },
  total_count:            { label: '总人次',    unit: '人次', chartLabel: '总人次' },
  totalCount:             { label: '总人次',    unit: '人次', chartLabel: '总人次' },
  completedCount:         { label: '已完成',    unit: '人',   chartLabel: '已完成(人)' },
  completed_count:        { label: '已完成',    unit: '人',   chartLabel: '已完成(人)' },
  complete_count:         { label: '已完成',    unit: '人',   chartLabel: '已完成(人)' },
  completeCount:          { label: '已完成',    unit: '人',   chartLabel: '已完成(人)' },
  incomplete_count:       { label: '未完成',    unit: '人',   chartLabel: '未完成(人)' },
  incompleteCount:        { label: '未完成',    unit: '人',   chartLabel: '未完成(人)' },
  inProgressCount:        { label: '进行中',    unit: '人',   chartLabel: '进行中(人)' },
  in_progress_count:      { label: '进行中',    unit: '人',   chartLabel: '进行中(人)' },
  pendingCount:           { label: '待开始',    unit: '人',   chartLabel: '待开始(人)' },
  completionRate:         { label: '完成率',    unit: '%',    chartLabel: '完成率(%)' },
  completion_rate:        { label: '完成率',    unit: '%',    chartLabel: '完成率(%)' },
  complete_rate:          { label: '完成率',    unit: '%',    chartLabel: '完成率(%)' },
  onTimeCompletionRate:   { label: '按时完成率', unit: '%',   chartLabel: '按时完成率(%)' },
  avgCompletionTimeHours: { label: '平均耗时',  unit: '小时', chartLabel: '平均耗时(h)' },
  avg_duration_sec:       { label: '平均耗时',  unit: '秒',   chartLabel: '平均耗时(秒)' },
  crisisP0Rate:           { label: 'P0预警率',  unit: '%',    chartLabel: 'P0预警率(%)' },
  crisisP1Rate:           { label: 'P1预警率',  unit: '%',    chartLabel: 'P1预警率(%)' },
  p0_warning_rate:        { label: 'P0预警率',  unit: '%',    chartLabel: 'P0预警率(%)' },
  p1_warning_rate:        { label: 'P1预警率',  unit: '%',    chartLabel: 'P1预警率(%)' },
  p2_warning_rate:        { label: 'P2预警率',  unit: '%',    chartLabel: 'P2预警率(%)' },
  p0_warning_count:       { label: 'P0预警',    unit: '人',   chartLabel: 'P0预警(人)' },
  p2_warning_count:       { label: 'P2预警',    unit: '人',   chartLabel: 'P2预警(人)' },
  reach_rate:             { label: '触达率',    unit: '%',    chartLabel: '触达率(%)' },
  reach_count:            { label: '已触达',    unit: '人',   chartLabel: '已触达(人)' },
};

function normalizeMetricKey(key) {
  if (METRIC_META[key]) return key;
  const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  return METRIC_META[camel] ? camel : key;
}
function metricLabel(key)  { return METRIC_META[normalizeMetricKey(key)]?.label || key; }
function metricUnit(key)   { return METRIC_META[normalizeMetricKey(key)]?.unit  || ''; }
function metricChartLabel(key) { return METRIC_META[normalizeMetricKey(key)]?.chartLabel || key; }

// ═══════════════════════════════════════════════════════════════════════════════
// §7. chat_only 硬编码模板
// ═══════════════════════════════════════════════════════════════════════════════

const DENY_RESPONSE = "抱歉，Executive Chat 仅支持**只读查询**，无法执行修改数据、发送催办等操作。您可以问我当前的数据完成情况。";
const GREETING_RESPONSE = "你好！我是 **Executive Chat 智能助理**，可以帮您查询培训任务的完成率、门店表现、预警情况等数据。\n\n您可以这样问我：\n- MacBook 销售技巧起步异常 完成率是多少？\n- 哪些门店需要重点关注？\n- 现在有哪些进行中的培训任务？";
const CHAT_ONLY_RESPONSE = "我是 **Executive Chat 智能助理**，可以帮您查询培训数据。\n\n您可以这样问我：\n- MacBook 销售技巧起步异常 完成率是多少？\n- 哪些门店需要重点关注？\n- 现在有哪些进行中的培训任务？";
const CHAT_ONLY_GREETING_RE = /^(你好|您好|hi|hello|谢谢|thanks|你是谁|你能做什么|help)([!！,.。?？\s]|$)/i;

function isGreetingLike(message) {
  return typeof message === 'string' && CHAT_ONLY_GREETING_RE.test(message.trim());
}

// ═══════════════════════════════════════════════════════════════════════════════
// §8. 搜索增强（Search Enhancement）
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 为 Latin-CJK 混合词分词（如 "MacBook培训" → "MacBook 培训"）。
 * 用于 searchEntities 的二次匹配。
 */
function tokenizeMixedScript(keyword) {
  return keyword
    .replace(/([a-zA-Z0-9])([一-龥])/g, '$1 $2')
    .replace(/([一-龥])([a-zA-Z0-9])/g, '$1 $2')
    .replace(/[^一-龥a-zA-Z0-9]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2);
}

module.exports = {
  // §1
  isClarification,
  extractQuestionText,
  // §2
  userHasUrgency,
  userWantsPickOne,
  userSpecifiedDimension,
  hasChannelLevelAmbiguity,
  channelLevelClarificationText,
  // §3
  listTasksAction,
  // §4
  filterDisallowedToolCalls,
  candidateToolsAfterResume,
  shouldNeverDrawChart,
  NEVER_DRAW_MODIFIERS,
  // §5
  getChartConfig,
  makeChartTitle,
  needsTableForBigNumber,
  needsTableForSeries,
  // §6
  METRIC_META,
  normalizeMetricKey,
  metricLabel,
  metricUnit,
  metricChartLabel,
  // §7
  DENY_RESPONSE,
  GREETING_RESPONSE,
  CHAT_ONLY_RESPONSE,
  isGreetingLike,
  // §8
  tokenizeMixedScript,
};
