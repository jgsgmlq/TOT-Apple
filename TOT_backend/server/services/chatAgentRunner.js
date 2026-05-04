'use strict';

const logger = require('../utils/logger');
const chatIntentService = require('./chatIntentService');
const chatToolsService  = require('./chatToolsService');
const chatAnswerService = require('./chatAnswerService');
const chatSessionStateService = require('./chatSessionStateService');
const chatMemoryService = require('./chatMemoryService');

const { chatWithToolsStream, simpleChat } = require('../utils/ai');
const {
  maskPII,
  preview,
  promptHash,
  argsHash,
  keyedFields,
  endSpan,
  endGeneration,
  NOOP_TRACE,
} = require('../utils/tracer');

// 2026-04-18 重构：FC 模式成为默认，开启流式 Markdown + 状态指示器
const CHAT_AGENT_MODE = process.env.CHAT_AGENT_MODE || 'function_calling';
const CHAT_SESSION_STATE_ENABLED = process.env.CHAT_SESSION_STATE_ENABLED !== '0';

// §5.10：升级 System Prompt 时同步 bump 版本号。
const SUPERVISOR_PROMPT_VERSION = 'executive-chat-supervisor/v4.0';
const FC_PROMPT_VERSION = 'executive-chat-fc/v5.0';

// 2026-04-21 v3.0 升级：弱化正则拦截，改为语义监工
const CHIT_CHAT_RE = /^(你好|您好|hi|hello|谢谢|thanks|你是谁|你能做什么|help)([!！,.。?？\s]|$)/i;
const ANALYTICS_HINT_RE = /(p90|分位|分布|相关性|方差|预测|截尾均值|analytics|绘图|图表)/i;

const SUPERVISOR_PROMPT = `你是一个安全合规监工。判断用户意图是否属于【危险操作】。
【危险操作定义】：
1. 要求系统自动发送邮件、发送通知、发起催办（nudge）。
2. 要求修改、删除、更新数据库中的数据。
【允许的操作】：
1. 询问数据、分析趋势、下钻查询。
2. 询问"如何"发邮件、询问邮件"文案模板"、询问系统功能。

如果是危险操作，请返回 "DENY"。如果是允许的操作，请返回 "ALLOW"。
只需返回单词本身，不要任何解释。`;

const SUPERVISOR_PROMPT_HASH = promptHash(SUPERVISOR_PROMPT);

/**
 * v3.0 语义监工：判断意图是否真正违规。
 * @param {string} message
 * @param {object} [trace] 父 trace（或 NOOP_TRACE），用于建 `Semantic_Supervisor` generation。
 */
async function checkIntentSafety(message, trace = NOOP_TRACE) {
  const gen = trace.generation({
    name: 'Semantic_Supervisor',
    model: 'deepseek-chat',
    input: maskPII(preview(message)),
    metadata: {
      promptVersion: SUPERVISOR_PROMPT_VERSION,
      promptHash: SUPERVISOR_PROMPT_HASH,
    },
  });

  const t0 = Date.now();
  try {
    const resp = await simpleChat(
      [
        { role: 'system', content: SUPERVISOR_PROMPT },
        { role: 'user', content: message },
      ],
      { returnUsage: true }
    );
    const text = (resp.content || '').trim().toUpperCase();
    const decision = text === 'DENY' ? 'deny' : 'allow';
    endGeneration(gen, {
      output: decision,
      usage: resp.usage || undefined,
      model: resp.model || undefined,
      metadata: { decision, durationMs: Date.now() - t0 },
    });
    return decision;
  } catch (e) {
    logger.warn('supervisor_check_failed', { error: e.message });
    endGeneration(gen, {
      output: 'allow',
      level: 'WARNING',
      statusMessage: e.message,
      metadata: { decision: 'allow', reason: 'llm_error', durationMs: Date.now() - t0 },
    });
    return 'allow'; // 报错时默认放行，由主 Agent 逻辑再次把关
  }
}

function classifyExecutionMode(message) {
  if (!message || typeof message !== 'string') return 'tool_action';
  const trimmed = message.trim();
  if (!trimmed) return 'chat_only';
  if (CHIT_CHAT_RE.test(trimmed)) return 'chat_only';
  return 'tool_action';
}

function inferIntentFromMessage(message) {
  if (!message || typeof message !== 'string') return 'chat_only';
  // v5.0：归并到 5 主意图
  if (/(漏斗|催办|挽回|转化|funnel|p[012]\s*转化)/i.test(message)) return 'funnel_query';
  if (ANALYTICS_HINT_RE.test(message)) return 'analytics_query';
  if (/(对比|排行|名次|表现|维度|指标|汇总|业态|经销商|完成率|预警|触达|风险|关注|门店|区域|大区|任务|进度|达成)/.test(message)) return 'metric_query';
  return 'chat_only';
}

function deriveIntentType(calledToolNames, fallbackIntent) {
  // v5.0: 工具 → 5 主意图（与 chatIntentService 保持一致）
  if (calledToolNames.has('queryConversionFunnel')) return 'funnel_query';
  if (calledToolNames.has('searchEntities')) return 'entity_search';
  if (calledToolNames.has('queryExecutiveMetrics')) return 'metric_query';
  if (calledToolNames.has('queryMetricsTimeseries')) return 'metric_query';
  if (calledToolNames.has('compareMetrics')) return 'metric_query';
  if (calledToolNames.has('runAnalytics')) return 'analytics_query';
  // 旧专用工具一律归并到 metric_query（v5.0 把它们视为 metric_query 的快捷形态）
  if (calledToolNames.has('getWarningsData')) return 'metric_query';
  if (calledToolNames.has('getRegionDetailData')) return 'metric_query';
  if (calledToolNames.has('getStoreDetailData')) return 'metric_query';
  if (calledToolNames.has('getTaskListData')) return 'metric_query';
  if (calledToolNames.has('getOverviewData')) return 'metric_query';
  return fallbackIntent || 'chat_only';
}

function normalizeReplyContent(content, fallbackOverview) {
  const safe = (content && typeof content === 'object') ? content : {};
  return {
    overview: typeof safe.overview === 'string'
      ? safe.overview
      : (fallbackOverview || '当前暂无可用数据，请稍后重试。'),
    keyNumbers: Array.isArray(safe.keyNumbers) ? safe.keyNumbers : [],
    attentionPoints: Array.isArray(safe.attentionPoints) ? safe.attentionPoints : [],
    followUpSuggestions: Array.isArray(safe.followUpSuggestions) ? safe.followUpSuggestions : [],
  };
}

function attachToolMeta(reply, toolMeta, intentResolvedBy = null) {
  reply._toolMeta = {
    toolName: toolMeta.toolName ?? null,
    cacheHit: toolMeta.cacheHit ?? null,
    skipped: toolMeta.skipped === true,
    iterations: toolMeta.iterations || 0,
  };
  if (intentResolvedBy != null) {
    reply._intentResolvedBy = intentResolvedBy;
  }
  return reply;
}

function intentResolvedByForFc(calledToolNames) {
  return calledToolNames && calledToolNames.size > 0 ? 'tools' : 'regex_fallback';
}

function fcToolMetaFromSet(calledToolNames, iterations = 0) {
  if (!calledToolNames || calledToolNames.size === 0) {
    return { toolName: null, cacheHit: null, skipped: false, iterations };
  }
  const names = [...calledToolNames];
  const toolName = names.length > 1 ? 'multi' : names[0];
  return { toolName, cacheHit: null, skipped: false, iterations };
}

function buildToolCacheSignature(toolName, args = {}, regionScope = null) {
  const taskId = args.taskId || null;
  const region = args.region || null;
  const storeId = args.storeId || null;
  const analysisType = args.analysisType || null;
  const scopeFp = regionScope
    ? chatSessionStateService.buildScopeFingerprint(regionScope)
    : '-';
  return `${toolName || 'unknown'}|${taskId || '-'}|${region || '-'}|${storeId || '-'}|${analysisType || '-'}|${scopeFp}`;
}

const { createFcStreamDeltaSplitter } = require('../utils/fcStreamDeltaSplit');

function buildDisambiguationReply(toolResult) {
  if (!toolResult || !toolResult.needDisambiguation) return null;
  const baseOverview = typeof toolResult.message === 'string' && toolResult.message.trim()
    ? toolResult.message
    : '该门店查询需要补充更明确的信息。';
  const candidates = Array.isArray(toolResult.candidates) ? toolResult.candidates : [];
  const keyNumbers = candidates.length
    ? [{ label: '候选门店数', value: String(candidates.length), unit: '家' }]
    : [];
  const attentionPoints = [];
  if (toolResult.reason === 'store_name_ambiguous' && candidates.length) {
    const sample = candidates
      .slice(0, 5)
      .map((item) => `${item.id}(${item.name})`)
      .join('、');
    attentionPoints.push(`命中多个门店：${sample}${candidates.length > 5 ? '…' : ''}`);
  } else if (toolResult.reason === 'store_not_found') {
    attentionPoints.push('当前名称在权限范围内无匹配门店。');
  }
  const followUpSuggestions = candidates.length
    ? candidates.slice(0, 3).map((item) => `可追问：查询门店 ${item.id} 的培训详情`)
    : ['可追问：请提供完整门店名称', '可追问：请直接提供门店ID（如 S001）'];
  return normalizeReplyContent({
    overview: baseOverview,
    keyNumbers,
    attentionPoints,
    followUpSuggestions,
  });
}

/**
 * `sendMessage` / `sendMessageStream` 在调用 `run` 前已通过 `handleIncomingMessage` 把本轮 user 写入 DB，
 * `loadFormattedHistory` 因此包含该条；下游又会单独拼 `userMessage`。仅在「尾部 user 与本轮问题一致」时去掉，
 * 避免重复投递；同时避免误删（例如并发下 DB 里已插入另一条 user，与当前请求的 userMessage 不一致）。
 */
function historyExcludingPendingUserTurn(history, userMessage) {
  if (!Array.isArray(history)) return [];
  if (history.length === 0) return history;
  const last = history[history.length - 1];
  if (last && last.role === 'user') {
    const a = String(last.content ?? '').trim();
    const b = String(userMessage ?? '').trim();
    if (b.length > 0 && a === b) {
      return history.slice(0, -1);
    }
  }
  return history;
}

/**
 * Main entry point for the chat agent.
 */
async function run(userMessage, history, regionScope, options = {}) {
  const trace = options.trace || NOOP_TRACE;

  // §4 Classify_Execution_Mode span：本身是纯正则判断，但 §2 时序里单列一步，埋 span 让瀑布图完整。
  const modeSpan = trace.span({
    name: 'Classify_Execution_Mode',
    input: maskPII(preview(userMessage)),
  });
  const chitChatMatched = CHIT_CHAT_RE.test(String(userMessage || '').trim());
  const mode = classifyExecutionMode(userMessage);
  endSpan(modeSpan, {
    output: mode,
    metadata: { mode, chitChatMatched },
  });

  if (mode === 'chat_only') {
    return {
      overview: '你好，我可以帮你查询培训进度、项目状态、预警信息，并做分位数/分布/相关性等分析。',
      keyNumbers: [],
      attentionPoints: [],
      followUpSuggestions: ['例如：Q1 新品培训完成率？', '例如：华东区最差的 5 家门店是哪些？'],
      _intentType: 'chat_only',
      _intentResolvedBy: 'execution_mode',
    };
  }

  // Phase 1.1: 语义监工异步检查
  if (mode === 'tool_action') {
    const safety = await checkIntentSafety(userMessage, trace);
    if (safety === 'deny') {
      return {
        overview: '抱歉，目前的 Executive Chat 助手仅作为只读的数据分析工具，我不具备发送邮件、发起催办（Nudge）或直接修改系统数据的权限。您可以向我询问相关文案建议。',
        keyNumbers: [],
        attentionPoints: ['AI 发起催办/修改数据已被拦截。'],
        followUpSuggestions: ['可改问：华东区有哪些预警门店？', '可改问：如何优化当前的催办模板？'],
        _intentType: 'deny',
        _intentResolvedBy: 'semantic_supervisor',
      };
    }
  }

  const historyForAgent = historyExcludingPendingUserTurn(history, userMessage);
  if (CHAT_AGENT_MODE === 'function_calling') {
    return runFunctionCalling(userMessage, historyForAgent, regionScope, options);
  }
  return runIntentRouting(userMessage, historyForAgent, regionScope, options);
}

// ─── Intent Routing mode (Fallback) ───────────────────────────────────────────
async function runIntentRouting(userMessage, history, regionScope, options = {}) {
  const trace = options.trace || NOOP_TRACE;
  // v5.0: classify 现在返回 { intentType, mainIntent, modifiers, entities, entitiesConfidence, riskFlags }
  const classifyResult = await chatIntentService.classify(userMessage, history, { trace });
  const { intentType, mainIntent = intentType, modifiers = {}, entities, riskFlags = false } = classifyResult;
  let routeToolMeta = { toolName: null, cacheHit: null, skipped: false };
  let toolResult = null;

  // 安全风险拦截（chatAgentRunner 入口已过 supervisor，这里是 defense-in-depth）
  if (riskFlags) {
    return attachToolMeta({
      overview: '此操作涉及对外发送或数据写入，Executive Chat 仅支持只读查询。',
      keyNumbers: [],
      attentionPoints: ['请改为查询类问题，例如"华东区完成率"或"P0 预警门店有哪些"。'],
      followUpSuggestions: [],
      _intentType: 'chat_only',
    }, { toolName: null, cacheHit: null, skipped: true }, 'intent_llm');
  }

  if (userMessage.includes('[绘图]') && mainIntent === 'analytics_query') {
    const lastValidMsg = [...history].reverse().find(m =>
      m.role === 'assistant' && m._intentType === 'analytics_query' && m.content
    );
    if (lastValidMsg) {
      if (CHAT_SESSION_STATE_ENABLED && options.sessionId) {
        await chatSessionStateService.hydrateIfNeeded(options.sessionId, regionScope);
        const lastRecord = chatSessionStateService.getLatestByIntent(options.sessionId, 'analytics_query', regionScope);
        if (lastRecord?.result?.analysisType) {
          entities.analysisType = lastRecord.result.analysisType;
        } else if (lastRecord?.result?.statisticsProvenance?.analysisType) {
          entities.analysisType = lastRecord.result.statisticsProvenance.analysisType;
        }
        if (lastRecord) {
          toolResult = lastRecord.result;
          routeToolMeta = { toolName: 'runAnalytics', cacheHit: true, skipped: false };
        }
      }
    }
  }

  if (mainIntent === 'analytics_query' && !entities?.analysisType && !toolResult) {
    return attachToolMeta({
      overview: '当前问题属于统计分析，但缺少 analysisType。请明确分析口径后重试。',
      keyNumbers: [],
      attentionPoints: ['analytics_query 需要明确的 analysisType 参数。'],
      followUpSuggestions: [
        '可追问：华东区完成耗时 P90 是多少？',
        '可追问：完成时间分布是什么样？',
        '可追问：催办次数与完成率相关吗？',
      ],
      _intentType: 'analytics_query',
    }, { toolName: null, cacheHit: null, skipped: false }, 'intent_llm');
  }

  // v5.0：metric_query + needs_drilldown 但实体缺失 → 引导补充
  if (
    mainIntent === 'metric_query' &&
    modifiers.needs_drilldown &&
    !entities?.region && !entities?.storeId && !entities?.storeName &&
    !entities?.dealerName && !entities?.format && !entities?.rtm
  ) {
    const reply = {
      ...normalizeReplyContent({
        overview: '请提供更具体的区域或门店信息，以便为您查询。',
        keyNumbers: [],
        attentionPoints: [],
        followUpSuggestions: [
          '可追问：华东区的培训完成率是多少？',
          '可追问：上海环球港店具体情况怎么样？',
          '可追问：哪个区域完成率最低？',
        ],
      }, '请提供区域或门店信息'),
      _intentType: 'metric_query',
    };
    return attachToolMeta(reply, { toolName: null, cacheHit: null, skipped: true }, 'intent_llm');
  }

  // v5.0：funnel_query / metric_query / entity_search 都强制要求 task 信息
  if (
    (mainIntent === 'metric_query' || mainIntent === 'funnel_query') &&
    !entities?.taskId && !entities?.taskName && !entities?.productName
  ) {
    const reply = {
      ...normalizeReplyContent({
        overview: '取数以「一个任务」为基本单位。请告诉我您要查询的任务名称或产品。',
        keyNumbers: [],
        attentionPoints: ['例如："iPhone 17 新品任务"、"Apple Watch 培训"。'],
        followUpSuggestions: [
          '可追问：iPhone 17 新品任务整体完成率',
          '可追问：Apple Watch 任务催办漏斗',
        ],
      }, '请提供任务名称或产品'),
      _intentType: mainIntent,
    };
    return attachToolMeta(reply, { toolName: null, cacheHit: null, skipped: true }, 'intent_llm');
  }

  if (mainIntent !== 'chat_only' && !toolResult) {
    // v5.0：主工具按 修饰标签 + 主意图 决定（与 routingPolicy.pickPrimaryTool 一致）
    let toolName;
    if (mainIntent === 'entity_search') {
      toolName = 'searchEntities';
    } else if (mainIntent === 'funnel_query') {
      toolName = 'queryConversionFunnel';
    } else if (mainIntent === 'analytics_query') {
      toolName = 'runAnalytics';
    } else if (mainIntent === 'metric_query') {
      if (modifiers.needs_compare) toolName = 'compareMetrics';
      else if (modifiers.needs_timeseries) toolName = 'queryMetricsTimeseries';
      else toolName = 'queryExecutiveMetrics';
    }

    if (toolName) {
      if (CHAT_SESSION_STATE_ENABLED && options.sessionId) {
        await chatSessionStateService.hydrateIfNeeded(options.sessionId, regionScope);
      }

      // v5.0：所有走 queryExecutiveMetrics / 衍生工具的请求统一转换 schema 形式
      let toolArgs = entities;
      if (toolName === 'queryExecutiveMetrics' || toolName === 'queryConversionFunnel'
          || toolName === 'queryMetricsTimeseries' || toolName === 'compareMetrics') {
        toolArgs = {
          taskId: entities.taskId,
          taskName: entities.taskName,
          productName: entities.productName,
          dimensions: entities.dimensions,
          metrics: entities.metrics,
          filters: {
            rtm: entities.rtm,
            format: entities.format,
            dealerName: entities.dealerName,
            storeId: entities.storeId,
            ...(entities.time ? { time: entities.time } : {}),
          },
          sort: entities.sort || (entities.topN ? { sortBy: entities.metrics?.[0], order: 'desc' } : null),
          ...(entities.topN ? { aggregation: { type: 'topn', n: entities.topN, target_metric: entities.metrics?.[0] } } : {}),
          ...(toolName === 'queryMetricsTimeseries' ? { granularity: entities.time?.granularity || 'day', time: entities.time } : {}),
          ...(toolName === 'compareMetrics' && Array.isArray(entities.compare_targets) ? {
            mode: 'horizontal',
            horizontal_dim: entities.dimensions?.[0] || 'channel_l3',
            horizontal_values: entities.compare_targets,
          } : {}),
        };
      }

      const cacheSignature = buildToolCacheSignature(toolName, toolArgs, regionScope);
      const expectedVersion = (CHAT_SESSION_STATE_ENABLED && options.sessionId)
        ? chatSessionStateService.getSessionVersion(options.sessionId, regionScope)
        : null;
      const cached = (CHAT_SESSION_STATE_ENABLED && options.sessionId)
        ? chatSessionStateService.getLatestBySignature(options.sessionId, cacheSignature, regionScope)
        : null;
      // §4 Tool_<name> span for intent_routing 路径
      const toolSpan = trace.span({
        name: `Tool_${toolName}`,
        input: { argsHash: argsHash(toolArgs), keyedFields: keyedFields(toolArgs) },
        metadata: {
          toolName,
          callSite: 'intent_routing',
          scopeType: regionScope?.type || null,
          intentType,
        },
      });
      const toolStart = Date.now();

      if (cached) {
        toolResult = cached.result;
        routeToolMeta = { toolName, cacheHit: true, skipped: false };
        endSpan(toolSpan, {
          output: 'cached',
          metadata: { cacheHit: true, errorCode: null, durationMs: Date.now() - toolStart },
        });
      } else {
        try {
          toolResult = await chatToolsService.executeByName(toolName, toolArgs, regionScope);
          routeToolMeta = { toolName, cacheHit: false, skipped: false };
          const errorCode = toolResult?.error?.code || null;
          const needDisambiguation = !!toolResult?.needDisambiguation;
          if (!toolResult?.error && CHAT_SESSION_STATE_ENABLED && options.sessionId) {
            chatSessionStateService.addRecord(options.sessionId, {
              signature: cacheSignature,
              source: 'intent_routing',
              result: toolResult,
            }, regionScope, expectedVersion);
          }
          endSpan(toolSpan, {
            output: errorCode ? `error:${errorCode}` : (needDisambiguation ? 'clarify' : 'ok'),
            level: errorCode ? 'WARNING' : undefined,
            metadata: {
              cacheHit: false,
              errorCode,
              needDisambiguation,
              durationMs: Date.now() - toolStart,
            },
          });
        } catch (err) {
          logger.warn('tool_execution_failed', { toolName, error: err.message });
          toolResult = null;
          routeToolMeta = { toolName, cacheHit: false, skipped: false };
          endSpan(toolSpan, {
            output: null,
            level: 'ERROR',
            statusMessage: err.message,
            metadata: {
              cacheHit: false,
              errorCode: 'EXECUTION_ERROR',
              durationMs: Date.now() - toolStart,
            },
          });
        }
      }
    }
  }

  const disambiguationReply = buildDisambiguationReply(toolResult);
  if (disambiguationReply) {
    disambiguationReply._intentType = intentType;
    return attachToolMeta(disambiguationReply, routeToolMeta, 'intent_llm');
  }

  let replyContent;
  try {
    replyContent = await chatAnswerService.format(
      userMessage,
      toolResult,
      history,
      options.streamFormatCallbacks || null,
      { trace }
    );
  } catch (err) {
    logger.warn('answer_format_failed', { error: err.message, intentType });
    replyContent = normalizeReplyContent(null, '当前请求已处理，但回答生成失败。请换个问法重试。');
  }
  replyContent = normalizeReplyContent(replyContent);
  replyContent._intentType = intentType;
  return attachToolMeta(replyContent, routeToolMeta, 'intent_llm');
}

// ─── Function Calling mode (Main) ─────────────────────────────────────────────
// FC System Prompt v5.0：5 主意图 + 13 工具 + 4 个新工具 few-shot。
// 静态模板：内嵌 ${memorySection} 占位，promptHash 对「空记忆版」求值一次即可稳定聚合。
function buildFcSystemPrompt(memorySection = '') {
  return `【角色定义】
你是苹果零售培训系统的高管数据分析助手 v5.0。服务对象是 CEO / VP / 区域总监。
你的能力范围：培训触达 / 完成 / 未完成 / 平均耗时 / P0-P1-P2 预警率 / 催办转化率 等指标查询，多维下钻（RTM channel_l3 / 业态 channel_l4 / 经销商 dealer / 门店 store）、时间序列趋势、横纵对比、催办漏斗、统计分析。
你没有能力：发送邮件、催办、修改数据。如用户提出此类需求，请明确拒绝。
${memorySection}
【硬约束】
- 取数以「**一个任务**」为基本单位。所有 metric/funnel/timeseries/compare 类工具调用，必须提供 taskName / productName / taskId 三选一，否则工具会返回 TASK_REQUIRED 错误。
- 任务名模糊（如"那个 Watch 任务"）→ **先调 searchEntities 拿候选 → 再用 taskId 精确查询**，不要靠猜。
- 维度命名：channel_l3=RTM L3(Monobrand/Multibrand/Carrier)，channel_l4=业态 L4(MONO/Lifestyle/Mass Merchant)，dealer=经销商，store=门店。

【工具选择决策树】
1. 闲聊/打招呼/询问能力 → 不调任何工具，直接答复。
2. 用户提到模糊实体（"那个 X 任务"、"上海有哪些门店"）→ searchEntities
3. 用户问"催办挽回了多少人 / P 级转化 / 漏斗" → queryConversionFunnel
4. 用户问"近 N 天 / 每日 / 趋势" → queryMetricsTimeseries
5. 用户问"vs / 对比 / 上周和本周 / Monobrand和Multibrand" → compareMetrics
6. 用户问 P90 / 分布 / 相关性 / 预测 → runAnalytics（必要时配 fetchRawDataset + executeCode）
7. 其余取数（完成率 / 预警率 / 排行 / TopN / 维度对比）→ queryExecutiveMetrics

【可用工具与参数要点（13 个）】
新工具（v5.0 增）：
- searchEntities         (entityType: task|channel_l3|channel_l4|dealer|store, keyword, limit)
- queryConversionFunnel  (taskName/taskId 必填, dimensions, filters, sort)
- queryMetricsTimeseries (taskName/taskId 必填, metrics[], granularity: hour|day|week|month, time, filters, group_by)
- compareMetrics         (taskName/taskId 必填, metrics[], mode: horizontal|vertical, horizontal_dim+horizontal_values 或 vertical_periods)

主力工具：
- queryExecutiveMetrics  (taskName/taskId 必填, metrics[], dimensions, filters{rtm,format,dealerName,storeId,time}, sort, aggregation{type:topn|bottomn|mean|distribution,n,bins,target_metric})

旧专用工具（仍可用，但优先用上面的统一工具）：
- getOverviewData / getRegionDetailData / getStoreDetailData / getTaskListData / getWarningsData
- runAnalytics / fetchRawDataset / executeCode

【可用指标编码（19 个）】
基础：reach_count / reach_rate / complete_count / complete_rate / incomplete_count / incomplete_rate / avg_duration_sec
预警：p0/p1/p2_warning_count / p0/p1/p2_warning_rate
转化：p0/p1/p2_conversion_count / p0/p1/p2_conversion_rate（分母 = 总人数）

【few-shot 示例 — 必须严格参考工具选择】

例 1：用户问"iPhone 17 任务各业态 P0 预警率排前 5"
→ 调用 queryExecutiveMetrics:
   { "taskName":"iPhone 17", "dimensions":["channel_l4"], "metrics":["p0_warning_rate"],
     "sort":{"sortBy":"p0_warning_rate","order":"desc"},
     "aggregation":{"type":"topn","n":5,"target_metric":"p0_warning_rate"} }

例 2：用户问"iPhone 17 催办挽回了多少人"
→ 调用 queryConversionFunnel:
   { "taskName":"iPhone 17" }

例 3：用户问"近 7 天 iPhone 17 每日完成数趋势"
→ 调用 queryMetricsTimeseries:
   { "taskName":"iPhone 17", "metrics":["complete_count"], "granularity":"day" }

例 4：用户问"Monobrand vs Multibrand iPhone 17 完成率对比"
→ 调用 compareMetrics:
   { "taskName":"iPhone 17", "metrics":["complete_rate"], "mode":"horizontal",
     "horizontal_dim":"channel_l3", "horizontal_values":["Monobrand","Multibrand"] }

例 5：用户问"那个 Watch 相关的任务"（任务名模糊）
→ 第一步调用 searchEntities: { "entityType":"task", "keyword":"Watch", "limit":5 }
→ 第二步用返回的 taskId 调对应工具

例 6：用户问"Apple Watch 任务催办漏斗按经销商看"
→ 调用 queryConversionFunnel:
   { "taskName":"Apple Watch", "dimensions":["dealer"], "sort":{"sortBy":"p0_conversion_rate","order":"asc"} }

例 7：用户问"iPhone 17 完成率最差 5 家门店"
→ 调用 queryExecutiveMetrics:
   { "taskName":"iPhone 17", "dimensions":["store"], "metrics":["complete_rate"],
     "aggregation":{"type":"bottomn","n":5,"target_metric":"complete_rate"} }

例 8：用户问"iPad Pro 任务完成耗时 P90"
→ 调用 runAnalytics: { "analysisType":"quantile_duration", "taskId":"<resolved>" }

【避坑要点】
- 千万不要给 queryExecutiveMetrics 不传 taskName/taskId（即使用户没说，也要先 searchEntities 找一个）。
- 时间字段 filters.time.field 取值仅限：received_at / completed_at / started_at / created_at。
- 转化率分母统一是「总人数」（task_assignments 全体），不是 P 级前一阶段人数。
- 实体继承：若用户上一轮问过 X 任务，本轮没说任务但提了维度过滤 → 自动继承 X 任务。
- 主动澄清：若不能从对话推断且 searchEntities 也找不到候选，用自然语言问一个具体问题，不要猜调工具。

【输出格式规则】
1. 所有回答用流式 Markdown 输出，先给一句结论，再展开数据。
2. 数字数据用 Markdown 表格呈现，不要用 JSON 对象。
3. 有图表时，把图表配置放在文末的 \`\`\`echarts 代码块中。
4. 有追问建议时，把建议列表放在文末的 \`\`\`suggestions 代码块中。
   - \`\`\`suggestions 围栏内必须是一个合法的 JSON 字符串数组，如：["可追问：问题1", "可追问：问题2"]。
5. 严禁向用户输出任何裸 JSON 对象。
6. 提到 P 级转化率时，必须明确是"占任务总人数比例"（避免 CEO 误读）。
`;
}

// 对「无记忆版」FC prompt 求 hash，避免每个用户因 memorySection 不同导致 hash 分叉、失去聚合意义。
const FC_PROMPT_HASH = promptHash(buildFcSystemPrompt(''));

async function runFunctionCalling(userMessage, history, regionScope, options = {}) {
  const fallbackIntent = inferIntentFromMessage(userMessage);
  const trace = options.trace || NOOP_TRACE;

  const userMemories = options.userId ? chatMemoryService.getMemories(options.userId) : '';
  const memorySection = userMemories ? `\n【个人偏好与记忆】\n${userMemories}\n` : '';

  const SYSTEM_PROMPT = buildFcSystemPrompt(memorySection);

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  let iterations = 0;
  const MAX_ITERATIONS = 5;
  let finalContent = null;
  const calledToolNames = new Set();
  const sc = options.streamFormatCallbacks;

  const fcLoopSpan = trace.span({
    name: 'FC_Loop',
    input: maskPII(preview(userMessage)),
    metadata: {
      maxIterations: MAX_ITERATIONS,
      historyLen: history.length,
      scopeType: regionScope?.type || null,
      hasMemories: Boolean(userMemories),
    },
  });

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    if (CHAT_SESSION_STATE_ENABLED && options.sessionId) {
      await chatSessionStateService.hydrateIfNeeded(options.sessionId, regionScope);
    }

    // 非 SSE 路径（sendMessage / regenerate）不传 streamFormatCallbacks；chatWithToolsStream 仍要求 onDelta 为函数
    const onDelta =
      sc && typeof sc.onDelta === 'function'
        ? (chunk, meta) => sc.onDelta(chunk, meta)
        : () => {};

    const stepGen = fcLoopSpan.generation({
      name: 'DeepSeek_FC_Step',
      model: 'deepseek-chat',
      input: { iteration: iterations, messageCount: messages.length },
      metadata: {
        iteration: iterations,
        promptVersion: FC_PROMPT_VERSION,
        promptHash: FC_PROMPT_HASH,
        hasMemories: Boolean(userMemories),
        toolsExposed: Array.isArray(chatToolsService.TOOL_SCHEMAS)
          ? chatToolsService.TOOL_SCHEMAS.length
          : null,
      },
    });

    const iterStart = Date.now();
    let response;
    try {
      response = await chatWithToolsStream({
        messages,
        tools: chatToolsService.TOOL_SCHEMAS,
        tool_choice: 'auto',
        onDelta,
        signal: options.signal,
      });
    } catch (err) {
      endGeneration(stepGen, {
        output: null,
        level: err?.name === 'AbortError' ? 'WARNING' : 'ERROR',
        statusMessage: err?.message,
        metadata: {
          iteration: iterations,
          status: err?.name === 'AbortError' ? 'aborted' : 'error',
          durationMs: Date.now() - iterStart,
        },
      });
      endSpan(fcLoopSpan, {
        output: null,
        level: err?.name === 'AbortError' ? 'WARNING' : 'ERROR',
        metadata: {
          iterations,
          reachedMax: false,
          calledTools: [...calledToolNames],
          status: err?.name === 'AbortError' ? 'aborted' : 'error',
        },
      });
      throw err;
    }

    endGeneration(stepGen, {
      output: preview(response.content || ''),
      usage: response.usage || undefined,
      model: response.model || undefined,
      metadata: {
        iteration: iterations,
        durationMs: Date.now() - iterStart,
        firstTokenLatencyMs: response.firstTokenLatencyMs ?? null,
        reasoningChunks: response.reasoningChunks ?? 0,
        contentChunks: response.contentChunks ?? 0,
        hasToolCalls: Boolean(response.tool_calls && response.tool_calls.length),
        toolCallCount: response.tool_calls ? response.tool_calls.length : 0,
        toolCallNames: response.tool_calls
          ? response.tool_calls.map((t) => t.function?.name).filter(Boolean)
          : [],
      },
    });

    if (!response.tool_calls || response.tool_calls.length === 0) {
      finalContent = response.content;
      break;
    }

    // Capture content even if tool calls are present, especially if we are about to hit max iterations
    if (iterations === MAX_ITERATIONS && response.content) {
      finalContent = response.content;
    }

    const toolResults = [];
    for (const tc of response.tool_calls) {
      if (sc) sc.onDelta('', { phase: 'tool_start', text: tc.function.name });

      let args;
      try {
        args = JSON.parse(tc.function.arguments || '{}');
      } catch {
        args = {};
      }
      const cacheSignature = buildToolCacheSignature(tc.function.name, args, regionScope);
      const expectedVersion = (CHAT_SESSION_STATE_ENABLED && options.sessionId)
        ? chatSessionStateService.getSessionVersion(options.sessionId, regionScope)
        : null;
      const cached = (CHAT_SESSION_STATE_ENABLED && options.sessionId)
        ? chatSessionStateService.getLatestBySignature(options.sessionId, cacheSignature, regionScope)
        : null;

      // §4 Tool_<name> span：挂在 FC_Loop 下，input 仅上 argsHash + keyedFields 防泄漏。
      const toolSpan = fcLoopSpan.span({
        name: `Tool_${tc.function.name}`,
        input: { argsHash: argsHash(args), keyedFields: keyedFields(args) },
        metadata: {
          toolName: tc.function.name,
          callSite: 'function_calling',
          scopeType: regionScope?.type || null,
          iteration: iterations,
        },
      });

      const toolStart = Date.now();
      let errorCode = null;
      let needDisambiguation = false;
      let cacheHit = false;

      let result;
      try {
        if (cached) {
          result = cached.result;
          cacheHit = true;
        } else {
          result = await chatToolsService.executeByName(tc.function.name, args, regionScope);
          if (result && result.error) {
            errorCode = result.error.code || 'EXECUTION_ERROR';
          }
          if (result && result.needDisambiguation) {
            needDisambiguation = true;
          }
          if (result && result.error && !result.needDisambiguation) {
            result = { _toolError: true, toolName: tc.function.name, message: result.error.message };
          }
        }
        if (!result?._toolError && !cached && CHAT_SESSION_STATE_ENABLED && options.sessionId) {
          chatSessionStateService.addRecord(options.sessionId, {
            signature: cacheSignature,
            source: 'function_calling',
            result,
          }, regionScope, expectedVersion);
        }
        endSpan(toolSpan, {
          output: cacheHit ? 'cached' : (errorCode ? `error:${errorCode}` : (needDisambiguation ? 'clarify' : 'ok')),
          level: errorCode ? 'WARNING' : undefined,
          metadata: {
            cacheHit,
            errorCode,
            needDisambiguation,
            durationMs: Date.now() - toolStart,
          },
        });
      } catch (err) {
        result = { _toolError: true, toolName: tc.function.name, message: err.message };
        endSpan(toolSpan, {
          output: null,
          level: 'ERROR',
          statusMessage: err.message,
          metadata: {
            cacheHit,
            errorCode: 'EXECUTION_ERROR',
            durationMs: Date.now() - toolStart,
          },
        });
      }
      calledToolNames.add(tc.function.name);
      toolResults.push({ id: tc.id, result });

      if (sc) sc.onDelta('', { phase: 'tool_end', text: tc.function.name });
    }

    // Phase 1.2: 拦截需要澄清的结果，发送特殊信号
    const disambiguation = toolResults.find(tr => tr.result && tr.result.needDisambiguation);
    if (disambiguation) {
      if (sc) {
        // 通过 SSE 发送结构化澄清请求，前端可据此弹出选择框
        sc.onDelta(JSON.stringify({
          type: 'clarify_request',
          toolCallId: disambiguation.id,
          toolName: disambiguation.result.toolName || 'getStoreDetailData',
          reason: disambiguation.result.reason,
          candidates: disambiguation.result.candidates || [],
          message: disambiguation.result.message
        }), { phase: 'clarify' });
      }

      const reply = buildDisambiguationReply(disambiguation.result);
      endSpan(fcLoopSpan, {
        output: 'clarify_request',
        metadata: {
          iterations,
          reachedMax: false,
          calledTools: [...calledToolNames],
          status: 'clarify',
          clarifyTool: disambiguation.result.toolName || 'unknown',
        },
      });
      // 同时返回一个降级回复，以防前端不支持该 SSE 事件
      return attachToolMeta({
        ...reply,
        _intentType: deriveIntentType(calledToolNames, fallbackIntent),
      }, fcToolMetaFromSet(calledToolNames, iterations), 'tools');
    }

    messages.push({ role: 'assistant', content: response.content ?? null, tool_calls: response.tool_calls });
    for (const tr of toolResults) {
      messages.push({ role: 'tool', tool_call_id: tr.id, content: JSON.stringify(tr.result) });
    }
  }

  // Final result returned to chatService (which stores it in DB content column)
  const reachedMax = iterations >= MAX_ITERATIONS && !(finalContent && calledToolNames.size === 0);
  if (!finalContent && calledToolNames.size > 0) {
    finalContent = '当前查询由于步骤过多而中断，我未能为您提供完整的结论。建议您简化问题或缩小查询范围（如指定大区或门店）。';
  } else if (!finalContent) {
    finalContent = '抱歉，暂时无法回答您的问题，请稍后再试。';
  }

  endSpan(fcLoopSpan, {
    output: preview(finalContent),
    metadata: {
      iterations,
      reachedMax,
      calledTools: [...calledToolNames],
      status: 'ok',
    },
  });

  return {
    markdownContent: finalContent,
    _intentType: deriveIntentType(calledToolNames, fallbackIntent),
    _intentResolvedBy: intentResolvedByForFc(calledToolNames),
    _toolMeta: fcToolMetaFromSet(calledToolNames, iterations),
  };
}

module.exports = { run, AGENT_MODE: CHAT_AGENT_MODE };
