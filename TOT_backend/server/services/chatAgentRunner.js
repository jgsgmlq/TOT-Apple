'use strict';

const logger = require('../utils/logger');
const chatIntentService = require('./chatIntentService');
const chatToolsService  = require('./chatToolsService');
const chatAnswerService = require('./chatAnswerService');
const chatSessionStateService = require('./chatSessionStateService');

// Toggle via .env: CHAT_AGENT_MODE=function_calling activates FC mode after upgrade.
// Default is intent_routing (MVP).
const CHAT_AGENT_MODE = process.env.CHAT_AGENT_MODE || 'intent_routing';
const CHAT_SESSION_STATE_ENABLED = process.env.CHAT_SESSION_STATE_ENABLED !== '0';

// _intentType on reply objects is internal metadata; chatService strips it before HTTP.
// TODO(P3): return { replyContent, intentType } for a cleaner boundary.

const OUT_OF_SCOPE_ACTION_RE = /(催办|发邮件|邮件草稿|nudge|send\s+email|auto\s*send)/i;
const CHIT_CHAT_RE = /^(你好|您好|hi|hello|谢谢|thanks|你是谁|你能做什么|help)([!！,.。?？\s]|$)/i;
const ANALYTICS_HINT_RE = /(p90|分位|分布|相关性|方差|预测|截尾均值|analytics)/i;

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

/** FC：有 tool 调用则 intent 来自工具名，否则来自 inferIntentFromMessage（regex） */
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

/** First balanced `{...}` slice; does not handle `{` inside JSON string values (see spec). */
function extractFirstJson(text) {
  if (!text) return null;
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
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
 * chatService.js calls this and does NOT know which mode is active.
 *
 * @param {string} userMessage
 * @param {Array<{role:string, content:string}>} history  — last 6 DB messages
 * @param {{ type: string, regions: string[]|null, rtm: string|null }} regionScope
 * @param {{ sessionId?: string }} options
 * @returns {Promise<ReplyContent>}
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

// ─── MVP mode: intent routing ─────────────────────────────────────────────────
async function runIntentRouting(userMessage, history, regionScope, options = {}) {
  // LLM Call 1: classify intent
  const { intentType, entities } = await chatIntentService.classify(userMessage, history);
  if (intentType === 'analytics_query' && !entities?.analysisType) {
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

  let routeToolMeta = { toolName: null, cacheHit: null, skipped: false };
  let toolResult = null;
  if (intentType !== 'unknown') {
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
            const added = chatSessionStateService.addRecord(options.sessionId, {
              signature: cacheSignature,
              source: 'intent_routing',
              result: toolResult,
            }, regionScope, expectedVersion);
            if (added === false) {
              logger.warn('session_cache_version_conflict', {
                sessionId: options.sessionId,
                toolName,
                signature: cacheSignature,
              });
            }
          }
        } catch (err) {
          logger.warn('tool_execution_failed', { toolName, error: err.message });
          toolResult = null;
          routeToolMeta = { toolName, cacheHit: false, skipped: false };
        }
      }
    }
  }

  if (routeToolMeta.toolName) {
    logger.debug('tool_called', {
      toolName: routeToolMeta.toolName,
      cacheHit: routeToolMeta.cacheHit === true,
      intentType,
      region: entities?.region || null,
      storeId: entities?.storeId || null,
    });
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

// ─── FC mode: function calling ───────────────────────────────────────────────
// Active when CHAT_AGENT_MODE=function_calling. Requires utils/ai.js chatWithTools().
async function runFunctionCalling(userMessage, history, regionScope, options = {}) {
  const fallbackIntent = inferIntentFromMessage(userMessage);

  // Import lazily so MVP doesn't require chatWithTools to exist
  const { chatWithTools, chatWithToolsStream } = require('../utils/ai');

  /** FC 与 POST messages 流式 SSE 对齐：有 streamFormatCallbacks 时走 DeepSeek 流式 completion */
  function callChatWithTools(opts) {
    const sc = options.streamFormatCallbacks;
    if (sc && typeof sc.onDelta === 'function') {
      return chatWithToolsStream({
        ...opts,
        onDelta: (chunk, meta) => sc.onDelta(chunk, meta),
      });
    }
    return chatWithTools(opts);
  }

  const SYSTEM_PROMPT = `你是一个培训数据分析助手，专门回答关于门店培训进度的问题。

【能力范围】
- 查询培训完成率、项目状态、预警门店
- 按区域或门店下钻查看详情
- 执行分位数、分布、相关性等统计分析

【回答规则】
当你调用工具查询数据后，可先简短说明分析思路或工具结果（自然语言），然后**必须**将最终结构化答案放在单独一段 Markdown 代码块中，格式为：
\`\`\`json
{ "overview": "...", "keyNumbers": [], "attentionPoints": [], "followUpSuggestions": [] }
\`\`\`
JSON 对象须包含以下四个字段（**建议严格按此顺序书写**，便于流式界面先出摘要再出指标）：
- overview: 不超过 60 字的数据总结
- keyNumbers: 最多 4 项数字，每项含 label/value/unit，数字必须来自工具返回（value 可为数字或字符串）
- attentionPoints: 最多 3 项风险或问题（无风险时为空数组）
- followUpSuggestions: 最多 3 条建议追问，以"可追问："开头`;

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  let iterations = 0;
  const MAX_ITERATIONS = 3;
  let finalContent = null;
  const calledToolNames = new Set();

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    if (CHAT_SESSION_STATE_ENABLED && options.sessionId) {
      await chatSessionStateService.hydrateIfNeeded(options.sessionId, regionScope);
    }

    const response = await callChatWithTools({
      messages,
      tools: chatToolsService.TOOL_SCHEMAS,
      tool_choice: 'auto',
    });

    if (!response.tool_calls || response.tool_calls.length === 0) {
      finalContent = response.content;
      break;
    }

    // Per-tool sequential execution with individual try/catch.
    // Each tool resolves independently; errors become { _toolError: true } and never reject.
    const toolResults = [];
    for (const tc of response.tool_calls) {
      let args;
      try {
        args = JSON.parse(tc.function.arguments || '{}');
      } catch {
        logger.warn('tool_arguments_parse_failed', { raw: String(tc.function.arguments).slice(0, 200) });
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
            result = {
              _toolError: true,
              toolName: tc.function.name,
              message: result.error.message,
              code: result.error.code,
            };
          }
        }
        if (!result?._toolError && !cached && CHAT_SESSION_STATE_ENABLED && options.sessionId) {
          const added = chatSessionStateService.addRecord(options.sessionId, {
            signature: cacheSignature,
            source: 'function_calling',
            result,
          }, regionScope, expectedVersion);
          if (added === false) {
            logger.warn('session_cache_version_conflict', {
              sessionId: options.sessionId,
              toolName: tc.function.name,
              signature: cacheSignature,
            });
          }
        }
      } catch (err) {
        result = {
          _toolError: true,
          toolName: tc.function.name,
          message: err.message,
          code: err.code,
        };
      }
      calledToolNames.add(tc.function.name);
      toolResults.push({ id: tc.id, result });
    }

    const disambiguationToolResult = toolResults.find((tr) => tr.result && tr.result.needDisambiguation);
    if (disambiguationToolResult) {
      const reply = {
        ...buildDisambiguationReply(disambiguationToolResult.result),
        _intentType: deriveIntentType(calledToolNames, fallbackIntent),
      };
      return attachToolMeta(reply, fcToolMetaFromSet(calledToolNames, iterations), intentResolvedByForFc(calledToolNames));
    }

    // Append assistant tool_calls request and tool responses
    messages.push({ role: 'assistant', content: response.content ?? null, tool_calls: response.tool_calls });
    for (const tr of toolResults) {
      messages.push({
        role: 'tool',
        tool_call_id: tr.id,
        content: JSON.stringify(tr.result)
      });
    }
  }

  // If we maxed out iterations and still have tools pending, force answer
  if (!finalContent && iterations >= MAX_ITERATIONS) {
    const response = await callChatWithTools({
      messages,
      tools: chatToolsService.TOOL_SCHEMAS,
      tool_choice: 'none',
      response_format: { type: 'json_object' },
    });
    finalContent = response.content;
  }

  try {
    const jsonStr = extractFirstJson(finalContent);
    if (jsonStr) {
      const parsed = JSON.parse(jsonStr);
      // If it looks like a dashboard payload (has keyNumbers or attentionPoints), return as is
      if (parsed.keyNumbers || parsed.attentionPoints || parsed.overview) {
        // remove messageType if present
        delete parsed.messageType;
        const reply = {
          ...normalizeReplyContent(parsed),
          _intentType: deriveIntentType(calledToolNames, fallbackIntent),
        };
        return attachToolMeta(reply, fcToolMetaFromSet(calledToolNames, iterations), intentResolvedByForFc(calledToolNames));
      }
    }
    // Fallback: If no valid dashboard JSON found, treat as conversational text
    const replyText = {
      ...normalizeReplyContent({ overview: finalContent }),
      _intentType: deriveIntentType(calledToolNames, fallbackIntent),
    };
    return attachToolMeta(replyText, fcToolMetaFromSet(calledToolNames, iterations), intentResolvedByForFc(calledToolNames));
  } catch {
    const replyErr = {
      ...normalizeReplyContent({ overview: finalContent || '系统无法理解并格式化该数据，请换一种问法。' }),
      _intentType: deriveIntentType(calledToolNames, fallbackIntent),
    };
    return attachToolMeta(replyErr, fcToolMetaFromSet(calledToolNames, iterations), intentResolvedByForFc(calledToolNames));
  }
}

module.exports = { run, AGENT_MODE: CHAT_AGENT_MODE };
