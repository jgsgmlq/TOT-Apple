'use strict';

const logger = require('../utils/logger');
const chatIntentService = require('./chatIntentService');
const chatToolsService  = require('./chatToolsService');
const chatAnswerService = require('./chatAnswerService');
const chatSessionStateService = require('./chatSessionStateService');

// 2026-04-18 重构：FC 模式成为默认，开启流式 Markdown + 状态指示器
const CHAT_AGENT_MODE = process.env.CHAT_AGENT_MODE || 'function_calling';
const CHAT_SESSION_STATE_ENABLED = process.env.CHAT_SESSION_STATE_ENABLED !== '0';

const OUT_OF_SCOPE_ACTION_RE = /(催办|发邮件|邮件草稿|nudge|send\s+email|auto\s*send)/i;
const CHIT_CHAT_RE = /^(你好|您好|hi|hello|谢谢|thanks|你是谁|你能做什么|help)([!！,.。?？\s]|$)/i;
const ANALYTICS_HINT_RE = /(p90|分位|分布|相关性|方差|预测|截尾均值|analytics|绘图|图表)/i;

function classifyExecutionMode(message) {
  if (!message || typeof message !== 'string') return 'tool_action';
  const trimmed = message.trim();
  if (!trimmed) return 'chat_only';
  if (OUT_OF_SCOPE_ACTION_RE.test(trimmed)) return 'deny';
  if (CHIT_CHAT_RE.test(trimmed)) return 'chat_only';
  return 'tool_action';
}

function inferIntentFromMessage(message) {
  if (!message || typeof message !== 'string') return 'unknown';
  if (ANALYTICS_HINT_RE.test(message)) return 'analytics_query';
  if (/(预警|风险|关注)/.test(message)) return 'warning_query';
  if (/(门店|最差|下钻|店|区域|大区|华东|华南|华北|西南|东北|西北)/.test(message)) return 'drill_down';
  if (/(任务|项目|进行中|状态)/.test(message)) return 'project_status';
  if (/(完成率|进度|达成)/.test(message)) return 'progress_query';
  return 'unknown';
}

function deriveIntentType(calledToolNames, fallbackIntent) {
  if (calledToolNames.has('runAnalytics')) return 'analytics_query';
  if (calledToolNames.has('getWarningsData')) return 'warning_query';
  if (calledToolNames.has('getRegionDetailData')) return 'drill_down';
  if (calledToolNames.has('getStoreDetailData')) return 'drill_down';
  if (calledToolNames.has('getTaskListData')) return 'project_status';
  if (calledToolNames.has('getOverviewData')) return 'progress_query';
  return fallbackIntent || 'unknown';
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
 * Main entry point for the chat agent.
 */
async function run(userMessage, history, regionScope, options = {}) {
  const mode = classifyExecutionMode(userMessage);
  if (mode === 'deny') {
    return {
      overview: '当前 Executive Chat 仅支持培训数据查询与分析，不支持催办文案或邮件生成。',
      keyNumbers: [],
      attentionPoints: [],
      followUpSuggestions: ['可改问：当前有哪些风险门店？', '可改问：华东区完成率是多少？'],
      _intentType: 'deny',
      _intentResolvedBy: 'execution_mode',
    };
  }
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

  if (CHAT_AGENT_MODE === 'function_calling') {
    return runFunctionCalling(userMessage, history, regionScope, options);
  }
  return runIntentRouting(userMessage, history, regionScope, options);
}

// ─── Intent Routing mode (Fallback) ───────────────────────────────────────────
async function runIntentRouting(userMessage, history, regionScope, options = {}) {
  let { intentType, entities } = await chatIntentService.classify(userMessage, history);
  let routeToolMeta = { toolName: null, cacheHit: null, skipped: false };
  let toolResult = null;

  if (userMessage.includes('[绘图]') && intentType === 'analytics_query') {
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

  if (intentType === 'analytics_query' && !entities?.analysisType && !toolResult) {
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

  if (intentType === 'drill_down' && !entities?.region && !entities?.storeId && !entities?.storeName) {
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
      _intentType: 'drill_down',
    };
    return attachToolMeta(reply, { toolName: null, cacheHit: null, skipped: true }, 'intent_llm');
  }

  if (intentType !== 'unknown' && !toolResult) {
    const toolMap = {
      progress_query: 'getOverviewData',
      project_status: 'getTaskListData',
      warning_query:  'getWarningsData',
      drill_down: (entities?.region && !entities?.storeId && !entities?.storeName)
        ? 'getRegionDetailData'
        : 'getStoreDetailData',
      analytics_query: 'runAnalytics',
    };
    const toolName = toolMap[intentType];
    if (toolName) {
      if (CHAT_SESSION_STATE_ENABLED && options.sessionId) {
        await chatSessionStateService.hydrateIfNeeded(options.sessionId, regionScope);
      }
      const cacheSignature = buildToolCacheSignature(toolName, entities, regionScope);
      const expectedVersion = (CHAT_SESSION_STATE_ENABLED && options.sessionId)
        ? chatSessionStateService.getSessionVersion(options.sessionId, regionScope)
        : null;
      const cached = (CHAT_SESSION_STATE_ENABLED && options.sessionId)
        ? chatSessionStateService.getLatestBySignature(options.sessionId, cacheSignature, regionScope)
        : null;
      if (cached) {
        toolResult = cached.result;
        routeToolMeta = { toolName, cacheHit: true, skipped: false };
      } else {
        try {
          toolResult = await chatToolsService.executeByName(toolName, entities, regionScope);
          routeToolMeta = { toolName, cacheHit: false, skipped: false };
          if (!toolResult?.error && CHAT_SESSION_STATE_ENABLED && options.sessionId) {
            chatSessionStateService.addRecord(options.sessionId, {
              signature: cacheSignature,
              source: 'intent_routing',
              result: toolResult,
            }, regionScope, expectedVersion);
          }
        } catch (err) {
          logger.warn('tool_execution_failed', { toolName, error: err.message });
          toolResult = null;
          routeToolMeta = { toolName, cacheHit: false, skipped: false };
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
      options.streamFormatCallbacks || null
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
async function runFunctionCalling(userMessage, history, regionScope, options = {}) {
  const fallbackIntent = inferIntentFromMessage(userMessage);
  const { chatWithToolsStream } = require('../utils/ai');

  const SYSTEM_PROMPT = `【角色定义】
你是苹果零售培训系统的高管数据分析助手。服务对象是 VP 和区域总监。
你的能力范围：培训完成率查询、项目状态、预警门店、区域/门店下钻、统计分析（分位数/分布/相关性/预测）。
你没有能力：发送邮件、催办、修改数据。

【多轮对话规则】
1. 实体继承：若用户问题中缺少区域/门店/任务信息，但历史对话中有，必须自动继承。
2. 主动澄清：若问题模糊且无法从历史推断，先用自然语言问一个澄清问题，不要猜测调用工具。
3. 直接行动：若已有足够信息，不要先征求用户同意，直接调用工具。

【输出格式规则】
1. 所有回答用流式 Markdown 输出，先给一句结论，再展开数据。
2. 数字数据用 Markdown 表格呈现，不要用 JSON 对象。
3. 有图表时，把图表配置放在文末的 \`\`\`echarts 代码块中。
4. 有追问建议时，把建议列表放在文末的 \`\`\`suggestions 代码块中。
   - \`\`\`suggestions 围栏内必须是一个合法的 JSON 字符串数组，如：["可追问：问题1", "可追问：问题2"]。
5. 严禁向用户输出任何裸 JSON 对象。

echarts 代码块格式：
\`\`\`echarts
{"type":"bar|line|scatter|pie","title":"标题","xAxis":["A","B"],"series":[{"name":"例","data":[1,2]}]}
\`\`\`
`;

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  let iterations = 0;
  const MAX_ITERATIONS = 3;
  let finalContent = null;
  const calledToolNames = new Set();
  const sc = options.streamFormatCallbacks;

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    if (CHAT_SESSION_STATE_ENABLED && options.sessionId) {
      await chatSessionStateService.hydrateIfNeeded(options.sessionId, regionScope);
    }

    const response = await chatWithToolsStream({
      messages,
      tools: chatToolsService.TOOL_SCHEMAS,
      tool_choice: 'auto',
      onDelta: sc ? createFcStreamDeltaSplitter((c, m) => sc.onDelta(c, m)) : null,
      signal: options.signal,
    });

    if (!response.tool_calls || response.tool_calls.length === 0) {
      finalContent = response.content;
      break;
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

      let result;
      try {
        if (cached) {
          result = cached.result;
        } else {
          result = await chatToolsService.executeByName(tc.function.name, args, regionScope);
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
      } catch (err) {
        result = { _toolError: true, toolName: tc.function.name, message: err.message };
      }
      calledToolNames.add(tc.function.name);
      toolResults.push({ id: tc.id, result });
      
      if (sc) sc.onDelta('', { phase: 'tool_end', text: tc.function.name });
    }

    const disambiguation = toolResults.find(tr => tr.result && tr.result.needDisambiguation);
    if (disambiguation) {
      const reply = buildDisambiguationReply(disambiguation.result);
      // Legacy JSON fallback for disambiguation
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
  return {
    markdownContent: finalContent,
    _intentType: deriveIntentType(calledToolNames, fallbackIntent),
    _intentResolvedBy: intentResolvedByForFc(calledToolNames),
    _toolMeta: fcToolMetaFromSet(calledToolNames, iterations),
  };
}

module.exports = { run, AGENT_MODE: CHAT_AGENT_MODE };
