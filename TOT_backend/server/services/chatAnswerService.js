'use strict';

const { generateTextDeepSeek, generateTextDeepSeekStream } = require('../utils/ai');
const { compressAssistantContent } = require('../utils/chatHistoryCompress');
const logger = require('../utils/logger');

const SYSTEM_PROMPT = `你是一个培训数据分析助手，请根据以下查询结果，用中文回答用户问题。
输出严格符合以下 JSON 格式（不加代码块标记，不加任何说明文字）:
{
  "overview": "...",
  "keyNumbers": [{"label": "...", "value": "...", "unit": "..."}],
  "attentionPoints": ["...", "..."],
  "followUpSuggestions": ["...", "..."],
  "visualizationSummary": "...",
  "visualizations": [
    {
      "type": "bar|line|pie|scatter",
      "title": "...",
      "xAxis": ["...", "..."],
      "series": [{"name": "...", "data": [1, 2, ...]}],
      "highlights": [0, ...],
      "customOptions": {}
    }
  ],
  "forecastDisclaimer": "...",
  "statisticsProvenance": {}
}

要求：
- overview：不超过 60 字，简明总结数据情况
- keyNumbers：最多 4 项，数字必须来自查询结果，不得捏造；无数据时返回 []
- attentionPoints：最多 3 项，聚焦问题与风险；无问题时返回 []
- followUpSuggestions：最多 3 项，以"可追问："开头。**[核心规则]** 若查询结果包含分布、趋势、相关性或排名数据且当前未生成图表，第一条建议必须是：'可追问：[绘图] 生成对应的可视化图表'。
- visualizationSummary: [必填若有图] 面向下一轮对话模型的简短图表记忆（不展示给用户），含轴含义、关键趋势/异常点等
- visualizations: [可选] 仅在回答包含分布、趋势、相关性或排名时生成；data 数组长度须与 xAxis 对齐。**[注意]** 如果用户追问"生成图表"或点击绘图气泡，请结合上下文中的可视化摘要（visualizationSummary）信息，在当前回答中正式组装此字段。
- 如果查询结果为空或 null，overview 说明"暂无相关数据"，其余字段返回空数组`;
function buildFormatPrompt(userMessage, toolResult, history) {
  const isForcePlot = userMessage.includes('[绘图]');
  const forcePlotInstruction = isForcePlot 
    ? '【最高优先级指令】用户要求绘图。你必须根据下方的查询结果数据生成具体的 visualizations 字段（包含 type, xAxis, series 等），不得仅返回文字总结！'
    : '';

  const dataSection = toolResult != null
    ? `查询结果数据：\n${JSON.stringify(toolResult, null, 2)}`
    : '查询结果数据：无（用户问题不涉及系统数据，请自由回答或说明暂无相关数据）';

  const historyText = history
    .slice(-6)
    .map((m) => {
      if (m.role === 'assistant') {
        return `Assistant: ${compressAssistantContent(m.content ?? '')}`;
      }
      return `User: ${m.content ?? ''}`;
    })
    .join('\n');

  return `${forcePlotInstruction}

历史对话:
${historyText}

当前提问:
${userMessage}

${dataSection}`;
}
function parseReplyFromRaw(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    logger.warn('answer_llm_empty_response');
    throw Object.assign(new Error('LLM returned empty response'), { status: 503, code: 'CHAT_001' });
  }
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    logger.warn('answer_llm_parse_error', { error: e.message, raw: raw.slice(0, 200) });
    throw Object.assign(new Error('LLM returned non-JSON response'), { status: 503, code: 'CHAT_001' });
  }
  return {
    overview:            String(parsed.overview || ''),
    keyNumbers:          Array.isArray(parsed.keyNumbers) ? parsed.keyNumbers : [],
    attentionPoints:     Array.isArray(parsed.attentionPoints) ? parsed.attentionPoints : [],
    followUpSuggestions: Array.isArray(parsed.followUpSuggestions) ? parsed.followUpSuggestions : [],
    visualizationSummary: parsed.visualizationSummary ? String(parsed.visualizationSummary) : undefined,
    visualizations:      Array.isArray(parsed.visualizations) ? parsed.visualizations : undefined,
    forecastDisclaimer:  parsed.forecastDisclaimer ? String(parsed.forecastDisclaimer) : undefined,
    statisticsProvenance: parsed.statisticsProvenance && typeof parsed.statisticsProvenance === 'object' ? parsed.statisticsProvenance : undefined,
  };
}

/**
 * [防偷懒] 可视化补偿逻辑：如果用户要求绘图且有工具结果，但 AI 没生成图表 JSON，则由代码强制补全。
 */
function compensateVisualization(reply, toolResult, userMessage) {
  if (!userMessage.includes('[绘图]')) return reply;
  if (reply.visualizations && reply.visualizations.length > 0) return reply;
  if (!toolResult) return reply;

  // 1. 补偿分布图 (Bar)
  if (toolResult.analysisType === 'completion_time_distribution' && Array.isArray(toolResult.buckets)) {
    reply.visualizations = [{
      type: 'bar',
      title: '任务完成时间分布',
      xAxis: toolResult.buckets.map(b => b.label),
      series: [{ name: '完成人数', data: toolResult.buckets.map(b => b.count) }]
    }];
  }
  // 2. 补偿趋势图 (Line)
  else if (toolResult.analysisType === 'completion_rate_forecast' && Array.isArray(toolResult.trends)) {
    reply.visualizations = [{
      type: 'line',
      title: '达成率趋势与预测',
      xAxis: toolResult.trends.map(t => t.time),
      series: [{ name: '达成率', data: toolResult.trends.map(t => t.ratio) }]
    }];
  }
  // 3. 补偿相关性图 (Scatter)
  else if (toolResult.analysisType === 'metric_correlation' && Array.isArray(toolResult.points)) {
    reply.visualizations = [{
      type: 'scatter',
      title: '指标相关性分析',
      series: [{ name: '数据点', data: toolResult.points.map(p => [p.x, p.y]) }]
    }];
  }
  // 4. 补偿矩阵查询图 (Bar/Line)
  else if (toolResult.dataSource === 'aggregated_matrix' && Array.isArray(toolResult.data)) {
    const dimKeys = toolResult.summary.dimensions;
    const metricKeys = toolResult.summary.metrics;
    
    if (dimKeys.length > 0 && metricKeys.length > 0) {
      const mainDim = dimKeys[0];
      const mainMetric = metricKeys[0];
      
      reply.visualizations = [{
        type: 'bar',
        title: `按${mainDim}维度的${mainMetric}对比`,
        xAxis: toolResult.data.map(row => row.dimensions[mainDim]),
        series: metricKeys.map(m => ({
          name: m,
          data: toolResult.data.map(row => row[m])
        }))
      }];
    }
  }

  if (reply.visualizations) {
    logger.info('visualization_compensated', { type: toolResult.analysisType });
  }
  return reply;
}

/**
 * Format tool results into a structured ReplyContent object.
 * Throws { status: 503, code: 'CHAT_001' } on LLM failure -- caller (route) returns HTTP 503.
 * @param {string} userMessage
 * @param {any} toolResult
 * @param {Array<{role:string, content:string}>} history
 * @param {{ onDelta?: (chunk: string, meta?: { phase?: string }) => void } | null} [streamCallbacks] 若提供 onDelta，则走 DeepSeek 流式，与看板智能洞察一致
 * @returns {Promise<ReplyContent>}
 */
async function format(userMessage, toolResult, history, streamCallbacks = null) {
  const prompt = buildFormatPrompt(userMessage, toolResult, history);

  if (streamCallbacks && typeof streamCallbacks.onDelta === 'function') {
    let full;
    try {
      full = await generateTextDeepSeekStream(
        prompt,
        {
          system: SYSTEM_PROMPT,
          temperature: 0.3,
          maxTokens: 1024,
        },
        (chunk, meta) => streamCallbacks.onDelta(chunk, meta)
      );
    } catch (err) {
      logger.error('answer_llm_stream_failed', { error: err.message });
      throw Object.assign(new Error('LLM inference failed'), { status: 503, code: 'CHAT_001' });
    }
    const reply = parseReplyFromRaw(full);
    return compensateVisualization(reply, toolResult, userMessage);
  }

  let raw;
  try {
    raw = await generateTextDeepSeek(prompt, {
      system: SYSTEM_PROMPT,
      temperature: 0.3,
      maxTokens: 1024,
    });
  } catch (err) {
    logger.error('answer_llm_failed', { error: err.message });
    throw Object.assign(new Error('LLM inference failed'), { status: 503, code: 'CHAT_001' });
  }

  const reply = parseReplyFromRaw(raw);
  return compensateVisualization(reply, toolResult, userMessage);
}

module.exports = { format, buildFormatPrompt };
