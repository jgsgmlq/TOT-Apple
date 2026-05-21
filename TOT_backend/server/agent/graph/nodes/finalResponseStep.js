'use strict';

const { AIMessage, HumanMessage, SystemMessage } = require("@langchain/core/messages");
const { startNodeSpan } = require('../shared/spanHelper');
const { renderMemoryBlock } = require('../shared/memoryBlock');
const { getClient, endGeneration, endSpan, maskPII, preview, NOOP_TRACE } = require('../../../utils/tracer');
const promptRegistry = require('../../../prompts/registry');
const { renderToolResultsMarkdown } = require('../renderers');
const { extractPlottableData } = require('../shared/extractPlottableData');
const { fcModel } = require('../llm');
const { ChatOpenAI } = require("@langchain/openai");

// 结构化输出用 streaming 模型 (json_mode)
const getStructuredModel = () => {
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
  const baseURL = process.env.DEEPSEEK_API_BASE_URL || "https://api.deepseek.com/v1";
  return new ChatOpenAI({
    modelName: "deepseek-chat",
    apiKey,
    configuration: { baseURL },
    temperature: 0.1,
    maxTokens: 2048,
    streaming: true,
    modelKwargs: { response_format: { type: "json_object" } },
  });
};

const { z } = require("zod");

const FinalResponseOutput = z.object({
  overview: z.string(),
  keyNumbers: z.array(z.object({
    label: z.string(),
    value: z.union([z.string(), z.number()]),
    unit: z.string().optional(),
  })),
  attentionPoints: z.array(z.object({
    level: z.enum(["warning", "info", "positive"]),
    text: z.string().default(""),
  }).catchall(z.any())).default([]),
  followUpSuggestions: z.array(z.string()).default([]),
  selectedCharts: z.array(z.object({
    datasetId: z.string(),
    chartType: z.enum(["bar","line","pie","scatter","funnel","radar"]),
    title: z.string(),
  })).default([]),
  statisticsProvenance: z.object({
    "统计口径": z.string(),
    "数据截止": z.string(),
  }).passthrough(),
  forecastDisclaimer: z.string().nullable().default(null),
  table: z.object({
    title: z.string(),
    columns: z.array(z.string()),
    rows: z.array(z.array(z.union([z.string(), z.number()]))),
  }).nullable().default(null),
});

function prepareToolData(toolResults) {
  const items = [];
  for (const [, entry] of Object.entries(toolResults || {})) {
    if (!entry) continue;
    let parsed = entry.data;
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed); } catch (_) { /* keep raw */ }
    }
    items.push({
      toolName: entry.toolName || null,
      data: parsed,
      error: entry.error || (parsed && parsed.error) || null,
    });
  }
  return items;
}

const sanitizeUserFacingMarkdown = (content) => {
  const text = typeof content === 'string' ? content : '';
  if (!text) return text;

  if (text.startsWith('SYSTEM_ERROR:') || text.includes('SYSTEM_ERROR')) {
    const reason = text.replace(/^SYSTEM_ERROR:\s*/i, '').replace(/工具参数校验失败[。.]?\s*/g, '');
    if (reason.includes('区域范围限定') || reason.includes('regions') || reason.includes('rtm')) {
      return '抱歉，当前无法查询该范围的数据。请检查您的访问权限范围，或尝试指定更具体的查询条件。';
    }
    if (reason.includes('必填') || reason.includes('MISSING') || reason.includes('storeId') || reason.includes('taskName')) {
      return '我需要更多信息才能完成查询。请告诉我具体的任务名称、门店名称或产品名称，我会立即为您查询。';
    }
    return '抱歉，查询过程中遇到了问题。请尝试缩小查询范围，或换个方式重新描述您的问题。';
  }

  return text;
};

const getFcModel = () => fcModel;

const finalResponseStep = async (state, config) => {
  const span = startNodeSpan(state, 'FinalResponseStep', { mode: state.mode, intent: state.intent });
  // 工具模式有结果时，忽略 FC LLM 的内联回复，强制走结构化输出
  let response = "";
  const hasToolResults = Object.keys(state.toolResults || {}).length > 0;
  if (state.mode !== "tool" || !hasToolResults) {
    response = state.reply_markdown || state.finalResponse || "";
  }

  if (!response) {
    if (state.mode === "deny") {
      response = "### ⚠️ 请求被拒绝\n\n抱歉，Executive Chat 目前仅支持**只读查询**。我无法帮您执行修改数据、发送催办通知或直接处理业务流等操作。\n\n💡 *建议您可以在系统中手动处理，或询问我当前的数据完成情况。*";
    } else if ((state.mode === "chat" || state.mode === "chat_only" || state.intent === "chat_only") && Object.keys(state.toolResults || {}).length === 0) {
      console.log(`[FinalResponseStep] 检测到纯聊天意图，调用大模型进行回复...`);
      const emitter = config?.configurable?.sseEmitter;
      const llm = getFcModel();

      const traceId = config?.configurable?.traceId;
      const client = getClient();
      const chatGen = client && traceId
        ? client.generation({ traceId, name: 'FinalResponse_ChatReply', model: 'deepseek-chat', input: maskPII(state.userMessage), metadata: { intent: 'chat_only' } })
        : NOOP_TRACE.generation({ name: 'FinalResponse_ChatReply' });

      const chatContext = (state.messages || []).filter(m => {
        const t = m._getType ? m._getType() : '';
        return t === 'human' || t === 'ai';
      }).slice(-7, -1);
      const contextBlock = chatContext.length > 0
        ? `\n\nRecent conversation context:\n${chatContext.map(m => `${m._getType() === 'human' ? 'User' : 'Assistant'}: ${typeof m.content === 'string' ? m.content.slice(0, 300) : ''}`).join('\n')}`
        : '';

      const chatPrompt = promptRegistry.get('chat_reply') + contextBlock;

      try {
        const stream = await llm.stream([
          new SystemMessage(chatPrompt),
          new HumanMessage(state.userMessage)
        ]);

        response = "";
        for await (const chunk of stream) {
          const deltaText = typeof chunk.content === 'string' ? chunk.content : '';
          if (deltaText) {
            response += deltaText;
            if (emitter && typeof emitter.handleLLMNewToken === 'function') {
              emitter.handleLLMNewToken(deltaText, { isReasoning: false });
            }
          }
        }
        endGeneration(chatGen, { output: maskPII(preview(response)), model: 'deepseek-chat', metadata: { intent: 'chat_only' } });
      } catch (err) {
        console.error('[FinalResponseStep] 闲聊回复生成失败:', err);
        endGeneration(chatGen, { output: maskPII(preview(err.message)), level: 'ERROR', statusMessage: err.message, model: 'deepseek-chat', metadata: { intent: 'chat_only' } });
        response = "你好！我是您的 Executive Chat 智能助理。我能帮您查询门店表现、任务完成率、下钻区域数据等。";
      }
    } else {
      // tool mode: FC loop 结束，有工具查询结果。调用 LLM 生成结构化输出
      const toolResultKeys = Object.keys(state.toolResults || {});
      if (toolResultKeys.length > 0) {
        console.log('[FinalResponseStep] 工具查询完成，调用 FinalResponse LLM (structured)...');
        const emitter = config?.configurable?.sseEmitter;
        const llm = getStructuredModel();
        const traceId = config?.configurable?.traceId;
        const client = getClient();
        const gen = client && traceId
          ? client.generation({ traceId, name: 'FinalResponse_Structured', model: 'deepseek-chat', input: maskPII(state.userMessage), metadata: { mode: 'tool' } })
          : NOOP_TRACE.generation({ name: 'FinalResponse_Structured' });

        const toolItems = prepareToolData(state.toolResults);
        const resultsText = JSON.stringify(toolItems, null, 2).slice(0, 4000);

        // 代码提取所有可画图的数据集，LLM 只选不编
        const plottableDatasets = extractPlottableData(state.toolResults || {});
        let datasetsBlock = '';
        if (plottableDatasets.length > 0) {
          const summary = plottableDatasets.map(ds => ({
            id: ds.id,
            kind: ds.kind,
            title: ds.title,
            suggest: ds.preferChartType,  // 建议的 chartType，可覆盖
            labelCount: ds.xAxis?.length || 0,
          }));
          datasetsBlock = '\n\nAVAILABLE CHART DATASETS (引用 datasetId，默认使用 suggest 的 chartType 即可，chartType 可选 bar|line|pie|scatter|funnel|radar，do not fabricate data):\n' + JSON.stringify(summary, null, 2);
        }

        const prompt = promptRegistry.get('final_response');
        const fullPrompt = prompt + `\n\n用户问题: ${state.userMessage}\n\n工具查询结果:\n${resultsText}${datasetsBlock}`;

        try {
          // 静默生成结构化 JSON，不在流中逐字推送
          // 解析后通过 replyContent 在 done 事件中传给前端一次性渲染
          let rawText = '';
          const stream = await llm.stream([
            new SystemMessage(fullPrompt),
            new HumanMessage('输出严格的 JSON 对象。')
          ], { signal: config?.signal });
          for await (const chunk of stream) {
            const delta = typeof chunk.content === 'string' ? chunk.content : '';
            if (delta) rawText += delta;
          }
          let rawJson;
          try { rawJson = JSON.parse(rawText); } catch (_) {
            try { rawJson = JSON.parse(rawText.replace(/,\s*}/g, '}').replace(/,\s*\]/g, ']')); } catch (__) { rawJson = {}; }
          }

          // 预处理：修复常见 LLM 输出偏差
          if (rawJson.keyNumbers) {
            rawJson.keyNumbers.forEach(k => { if (k.unit === null) delete k.unit; });
          }
          if (rawJson.attentionPoints) {
            rawJson.attentionPoints = rawJson.attentionPoints.map(p => {
              if (typeof p === 'string') return { level: 'info', text: p };
              const text = p.text || p.message || p.content || '';
              return { level: p.level || 'info', text };
            });
          }
          if (typeof rawJson.statisticsProvenance === 'string') {
            rawJson.statisticsProvenance = { "统计口径": rawJson.statisticsProvenance, "数据截止": "" };
          }
          if (rawJson.table && rawJson.table.rows) {
            rawJson.table.rows = rawJson.table.rows.map(row =>
              row.map(cell => String(cell ?? ''))
            );
          }

          const parsed = FinalResponseOutput.parse(rawJson);

          // 代码解析 LLM 选中的图表：按 datasetId 匹配实际数据，LLM 不能伪造数据
          const datasetMap = new Map();
          for (const ds of plottableDatasets) datasetMap.set(ds.id, ds);
          const resolvedCharts = (parsed.selectedCharts || [])
            .filter(sc => datasetMap.has(sc.datasetId))
            .map(sc => {
              const ds = datasetMap.get(sc.datasetId);
              return {
                type: sc.chartType,
                title: sc.title || ds.title,
                xAxis: ds.xAxis,
                series: ds.series,
              };
            });

          // 最终输出：LLM 文字 + 代码生成的 chart
          response = JSON.stringify({
            overview: parsed.overview,
            keyNumbers: parsed.keyNumbers,
            attentionPoints: parsed.attentionPoints,
            followUpSuggestions: parsed.followUpSuggestions,
            visualizations: resolvedCharts.length > 0 ? resolvedCharts : null,
            statisticsProvenance: parsed.statisticsProvenance,
            forecastDisclaimer: parsed.forecastDisclaimer,
            table: parsed.table,
          });

          endGeneration(gen, { output: maskPII(preview(response)), model: 'deepseek-chat' });
        } catch (err) {
          console.error('[FinalResponseStep] 结构化输出失败，降级到渲染器:', err.message);
          endGeneration(gen, { output: maskPII(preview(err.message)), level: 'WARNING', statusMessage: err.message, model: 'deepseek-chat' });
          response = renderToolResultsMarkdown(state.toolResults || {}, state.intent) || '抱歉，查询过程中遇到了问题。';
        }
      } else {
        response = renderToolResultsMarkdown(state.toolResults || {}, state.intent) || "抱歉，我暂时无法回答这个问题，或者执行过程中遇到了错误。请稍后重试或尝试缩小查询范围。";
      }
    }
  }

  response = sanitizeUserFacingMarkdown(response);
  endSpan(span, { output: preview(response), metadata: { responseBytes: response.length } });

  return {
    finalResponse: response,
    reply_markdown: response,
    messages: [new AIMessage({ content: response })]
  };
};

module.exports = { finalResponseStep, sanitizeUserFacingMarkdown };
