'use strict';

const { AIMessage, HumanMessage, SystemMessage } = require("@langchain/core/messages");
const { startNodeSpan } = require('../shared/spanHelper');
const { getClient, endGeneration, endSpan, maskPII, preview, NOOP_TRACE } = require('../../../utils/tracer');
const promptRegistry = require('../../../prompts/registry');
const { extractPlottableData } = require('../shared/extractPlottableData');
const { BlocksOutput, PlannerOutput } = require('../shared/blocksSchema');
const { fcModel, getStructuredModel } = require('../llm');
const { renderConversation, renderLongTerm } = require('../shared/memoryBlock');
const { buildEntityContext } = require('./resolveEntities');
const trace = require('../shared/runTrace');

const MAX_REPAIR_ATTEMPTS = 2;

// ─── 表格构建 ──────────────────────────────────────────────────────────────

function buildTableFromRows(rawRows) {
  if (!rawRows || rawRows.length === 0) return { columns: [], rows: [] };

  const sample = rawRows[0];
  if (!sample || typeof sample !== 'object') return { columns: [], rows: [] };

  let dimKeys = [];
  if (sample.dimensions && typeof sample.dimensions === 'object') {
    dimKeys = Object.keys(sample.dimensions);
  }

  const skipKeys = new Set(['task_id', 'dimension', 'dimensions', '_total', 'error', 'success', 'signature']);
  const metricKeys = Object.keys(sample).filter(k => !k.startsWith('_') && !skipKeys.has(k) && typeof sample[k] !== 'object');
  const colKeys = [...dimKeys, ...metricKeys];
  if (colKeys.length === 0) return { columns: [], rows: [] };

  const COL_NAME_MAP = {
    completion_rate: '完成率%', completed_count: '已完成', total_count: '总计',
    crisis_p0_rate: 'P0预警%', crisis_p1_rate: 'P1预警%', crisis_p2_rate: 'P2预警%', crisis_p3_rate: 'P3预警%',
    learning_rate: '学习率%', avg_completion_time_hours: '平均耗时h', read_rate: '阅读率%', read_count: '已阅读', start_delay_rate: '延时率%',
    store: '门店', store_name: '门店', region: '区域', rtm: 'RTM',
    channel_l3: '大区', channel_l4: '业态', dealer_name: '经销商',
    task_name: '任务名称', priority: '优先级', platform: '平台', deadline: '截止日期', learning_count: '学习人数',
    task_title: '任务名称', due_date: '截止日期', urgency_level: '优先级',
    in_progress_count: '进行中', pending_count: '待开始',
    stage: '阶段', label: '阶段', name: '名称', count: '人数',
    sharePercent: '占比%', dropPercent: '流失率%', dropWidth: '流失宽度',
    user_id: '用户ID', email: '邮箱', name: '姓名', completion_status: '状态',
    dealer: '经销商', l3: '大区', l4: '业态',
    alert_level: '预警级别', alert_result: '催办结果', alerted_at: '催办时间',
  };

  function formatCellValue(k, v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return v;
    const s = String(v);
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s)) return s.slice(0, 10);
    return s;
  }

  const colNames = colKeys.map(k => COL_NAME_MAP[k] || k);
  const rows = rawRows.slice(0, 20).map(row => {
    const dims = row.dimensions && typeof row.dimensions === 'object' ? row.dimensions : {};
    return colKeys.map(k => {
      if (dimKeys.includes(k)) return formatCellValue(k, dims[k]);
      return formatCellValue(k, row[k]);
    });
  });

  return { columns: colNames, rows };
}

// ─── 工具数据准备 ──────────────────────────────────────────────────────────

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

// ─── Blocks 解析与组装 ─────────────────────────────────────────────────────

function resolveChart(block, datasetMap) {
  const ds = datasetMap.get(block.datasetId);
  if (!ds) return null;
  return {
    type: block.chartType || 'bar',
    title: block.title || ds.title,
    xAxis: ds.xAxis,
    series: ds.series,
  };
}

function resolveTable(block, datasetMap) {
  const ds = datasetMap.get(block.datasetId);
  if (!ds) return null;
  const { columns, rows } = buildTableFromRows(ds.rawRows || []);
  if (columns.length === 0 && rows.length === 0) return null;
  return { title: block.title || ds.title, columns, rows };
}

function extractContentText(blocks) {
  const parts = [];
  for (const block of blocks) {
    if (block.type === 'markdown') {
      parts.push(block.content);
    } else if (block.type === 'keyNumbers') {
      for (const item of block.items) {
        parts.push(`${item.label}: ${item.value}${item.unit || ''}`);
      }
    } else if (block.type === 'insights') {
      for (const item of block.items) {
        parts.push(`[${item.level}] ${item.text}`);
      }
    }
  }
  return parts.join('\n');
}

function getLatestToolExecuteAt(toolResults) {
  let latest = null;
  for (const [, entry] of Object.entries(toolResults || {})) {
    const ts = entry?.executedAt;
    if (ts && (!latest || ts > latest)) latest = ts;
  }
  return latest;
}

// ─── 两轮 LLM 调用辅助函数 ──────────────────────────────────────────────────

function buildDataBlock(state, toolItems, plottableDatasets) {
  const resultsText = JSON.stringify(toolItems, null, 2).slice(0, 4000);

  let datasetsBlock = '';
  if (plottableDatasets.length > 0) {
    const summary = plottableDatasets.map(ds => ({
      id: ds.id,
      title: ds.title,
      labelCount: ds.xAxis?.length || 0,
      sampleRows: ds.sampleRows || [],
    }));
    datasetsBlock = '\n\nAVAILABLE DATASETS (通过 chart/table block 的 datasetId 引用，不要编造):\n' + JSON.stringify(summary, null, 2);
  }

  const dataTimestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const timestampBlock = '\n\n当前时间: ' + dataTimestamp;
  const entityCtx = buildEntityContext(state);

  return '\n\n' + renderConversation(state.conversation || [])
    + '\n\n' + renderLongTerm(state.long_term_memories || '')
    + entityCtx
    + '\n\n用户问题: ' + state.userMessage
    + '\n\n工具查询结果:\n' + resultsText + datasetsBlock
    + timestampBlock;
}

async function runStructuredRound(llm, systemPrompt, humanInstruction, schema, maxAttempts, signal) {
  let parsed = null;
  let lastError = '';

  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    let rawText = '';
    const repairSuffix = attempt > 0
      ? '\n\n上次输出校验失败，错误如下:\n' + lastError + '\n请修正后重新输出。'
      : '';

    const stream = await llm.stream([
      new SystemMessage(systemPrompt + repairSuffix),
      new HumanMessage(humanInstruction)
    ], { signal });

    for await (const chunk of stream) {
      const delta = typeof chunk.content === 'string' ? chunk.content : '';
      if (delta) rawText += delta;
    }

    let rawJson;
    try { rawJson = JSON.parse(rawText); } catch (_) {
      try { rawJson = JSON.parse(rawText.replace(/,\s*}/g, '}').replace(/,\s*\]/g, ']')); } catch (__) { rawJson = {}; }
    }

    parsed = schema.safeParse(rawJson);
    console.log('[runStructuredRound] attempt=' + attempt + ' success=' + parsed.success + ' rawLen=' + rawText.length);
    if (!parsed.success) {
      const issues = parsed.error?.issues || parsed.error?.message;
      console.log('[runStructuredRound] Zod error:', JSON.stringify(issues).substring(0, 300));
    }

    if (parsed.success) break;

    lastError = JSON.stringify(parsed.error?.issues || parsed.error?.message || '');
  }

  return { parsed, lastError };
}

// ─── 主节点 ────────────────────────────────────────────────────────────────

const finalResponseStep = async (state, config) => {
  const emitter = config?.configurable?.sseEmitter;
  const span = startNodeSpan(state, 'FinalResponseStep', { mode: state.mode, intent: state.intent });
  trace.nodeEnter(emitter, state, 'FinalResponseStep', { mode: state.mode, hasToolResults: Object.keys(state.toolResults || {}).length > 0 });

  let response = '';
  const hasToolResults = Object.keys(state.toolResults || {}).length > 0;

  if (!hasToolResults && state.mode !== 'tool') {
    response = state.reply_markdown || state.finalResponse || '';
  }

  if (!response) {
    if (state.mode === 'deny') {
      response = "### ⚠️ 请求被拒绝\n\n抱歉，Executive Chat 目前仅支持**只读查询**。我无法帮您执行修改数据、发送催办通知或直接处理业务流等操作。\n\n💡 *建议您可以在系统中手动处理，或询问我当前的数据完成情况。*";
    } else if (state.mode === 'chat' || state.mode === 'chat_only' || state.intent === 'chat_only') {
      console.log('[FinalResponseStep] 检测到纯聊天意图，调用大模型进行回复...');
      const chatEmitter = config?.configurable?.sseEmitter;
      const llm = fcModel;

      const traceId = config?.configurable?.traceId;
      const client = getClient();
      const chatGen = client && traceId
        ? client.generation({ traceId, name: 'FinalResponse_ChatReply', model: 'deepseek-chat', input: maskPII(state.userMessage), metadata: { intent: 'chat_only' } })
        : NOOP_TRACE.generation({ name: 'FinalResponse_ChatReply' });

      const conversationBlock = renderConversation(state.conversation || []);
      const longTermBlock = renderLongTerm(state.long_term_memories || '');

      const contextParts = [conversationBlock, longTermBlock].filter(Boolean);
      const contextBlock = contextParts.length > 0
        ? '\n\n' + contextParts.join('\n\n')
        : '';

      const chatPrompt = promptRegistry.get('chat_reply') + contextBlock;

      try {
        const stream = await llm.stream([
          new SystemMessage(chatPrompt),
          new HumanMessage(state.userMessage)
        ]);
        response = '';
        for await (const chunk of stream) {
          const deltaText = typeof chunk.content === 'string' ? chunk.content : '';
          if (deltaText) {
            response += deltaText;
            if (chatEmitter && typeof chatEmitter.handleLLMNewToken === 'function') {
              chatEmitter.handleLLMNewToken(deltaText, { isReasoning: false });
            }
          }
        }
        endGeneration(chatGen, { output: maskPII(preview(response)), model: 'deepseek-chat', metadata: { intent: 'chat_only' } });
      } catch (err) {
        console.error('[FinalResponseStep] 闲聊回复生成失败:', err);
        endGeneration(chatGen, { output: maskPII(preview(err.message)), level: 'ERROR', statusMessage: err.message, model: 'deepseek-chat', metadata: { intent: 'chat_only' } });
        response = '你好！我是您的 Executive Chat 智能助理。我能帮您查询门店表现、任务完成率、下钻区域数据等。';
      }
    } else {
      // ── tool mode: 两轮 LLM 调用 —— Plan → Execute ────────────────────
      const llm = getStructuredModel();
      const traceId = config?.configurable?.traceId;
      const client = getClient();
      const plnGen = client && traceId
        ? client.generation({ traceId, name: 'FinalResponse_Planner', model: 'deepseek-chat', input: maskPII(state.userMessage), metadata: { mode: 'tool' } })
        : NOOP_TRACE.generation({ name: 'FinalResponse_Planner' });
      const execGen = client && traceId
        ? client.generation({ traceId, name: 'FinalResponse_Execute', model: 'deepseek-chat', input: maskPII(state.userMessage), metadata: { mode: 'tool' } })
        : NOOP_TRACE.generation({ name: 'FinalResponse_Execute' });

      const toolItems = prepareToolData(state.toolResults);
      const plottableDatasets = extractPlottableData(state.toolResults || {});
      const dataBlock = buildDataBlock(state, toolItems, plottableDatasets);

      // 发送 SSE trace 告知用户正在分析
      if (emitter && typeof emitter.handleTrace === 'function') {
        emitter.handleTrace({
          ts: Date.now(),
          type: 'status',
          node: 'FinalResponseStep',
          data: { message: '正在分析问题...' },
        });
      }

      // ═══ 第一轮：规划 ═══
      const plannerPrompt = promptRegistry.get('final_response_planner') + dataBlock;

      const plannerResult = await runStructuredRound(
        llm,
        plannerPrompt,
        '分析用户问题，输出严格的 JSON 对象。',
        PlannerOutput,
        MAX_REPAIR_ATTEMPTS,
        config?.signal
      );

      let plannerData = null;
      if (plannerResult.parsed?.success) {
        plannerData = plannerResult.parsed.data;
        // 空 selectedDatasets 触发一次额外 retry
        if (!plannerData.selectedDatasets || plannerData.selectedDatasets.length === 0) {
          console.log('[FinalResponseStep] Planner returned empty selectedDatasets, retrying...');
          const retryResult = await runStructuredRound(
            llm,
            plannerPrompt + '\n\n你必须选择至少一个数据集。请重新分析。',
            '分析用户问题，输出严格的 JSON 对象。必须选择至少一个 datasetId。',
            PlannerOutput,
            1,
            config?.signal
          );
          if (retryResult.parsed?.success) {
            plannerData = retryResult.parsed.data;
          }
        }
        endGeneration(plnGen, { output: maskPII(preview(JSON.stringify(plannerData))), model: 'deepseek-chat' });
      } else {
        endGeneration(plnGen, { output: maskPII(preview(plannerResult.lastError)), level: 'WARNING', statusMessage: plannerResult.lastError, model: 'deepseek-chat' });
      }

      // 构建 planner 分析段落
      const plannerSection = plannerData
        ? '\n\n[问题分析]\n' + plannerData.analysis + '\n\n建议呈现方式: ' + plannerData.suggestedApproach
        : '\n\n[问题分析]\n（规划阶段未完成，请根据数据和用户问题自行判断最佳回答方式）';

      // ═══ 第二轮：执行 ═══
      const execPrompt = promptRegistry.get('final_response', { plannerAnalysis: plannerSection.trim() }) + dataBlock;

      const MAX_EXEC_ATTEMPTS = MAX_REPAIR_ATTEMPTS;
      let execParsed = null;
      let execLastError = '';

      for (let attempt = 0; attempt <= MAX_EXEC_ATTEMPTS; attempt++) {
        const result = await runStructuredRound(
          llm,
          execPrompt + (attempt > 0 ? '' : ''),
          '输出严格的 JSON 对象，包含 "blocks" 数组和 "_provenance" 对象（统计口径字段必填）。',
          BlocksOutput,
          0,  // 单次，repair 由外层 handle
          config?.signal
        );

        execParsed = result.parsed;
        execLastError = result.lastError;
        console.log('[FinalResponseStep] exec attempt=' + attempt + ' success=' + (execParsed?.success || false));

        if (execParsed?.success && execParsed.data.blocks.length > 0) {
          const datasetIds = new Set(plottableDatasets.map(d => d.id));
          const orphanIds = execParsed.data.blocks
            .filter(b => (b.type === 'chart' || b.type === 'table') && !datasetIds.has(b.datasetId))
            .map(b => b.datasetId);
          if (orphanIds.length > 0) {
            execLastError = '以下 datasetId 不在 AVAILABLE DATASETS 中: ' + orphanIds.join(', ') + '。可用的: ' + [...datasetIds].join(', ');
            console.log('[FinalResponseStep] orphan datasetIds on attempt=' + attempt + ': ' + orphanIds.join(', '));
            continue;
          }
          break;
        } else {
          execLastError = execParsed?.success
            ? 'blocks 数组为空'
            : JSON.stringify(execParsed?.error?.issues || execParsed?.error?.message || '');
        }
      }

      const parsed = execParsed;
      const lastError = execLastError;

      if (parsed && parsed.success && parsed.data.blocks.length > 0) {
        const datasetMap = new Map();
        for (const ds of plottableDatasets) datasetMap.set(ds.id, ds);

        const resolvedCharts = [];
        const resolvedTables = [];
        const cleanBlocks = [];

        for (const block of parsed.data.blocks) {
          if (block.type === 'chart') {
            const resolved = resolveChart(block, datasetMap);
            if (resolved) { resolvedCharts.push(resolved); cleanBlocks.push(block); }
          } else if (block.type === 'table') {
            const resolved = resolveTable(block, datasetMap);
            if (resolved) { resolvedTables.push(resolved); cleanBlocks.push(block); }
          } else {
            cleanBlocks.push(block);
          }
        }

        const dataTimestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
        const provenance = parsed.data._provenance || {};
        const toolCutoff = getLatestToolExecuteAt(state.toolResults);
        const dataCutoff = toolCutoff
          ? new Date(toolCutoff).toISOString().replace('T', ' ').slice(0, 19)
          : dataTimestamp;
        const _provenance = {
          '统计口径': provenance.scope || provenance['统计口径'] || '',
          '数据截止': dataCutoff,
        };

        const _datasets = {};
        for (const ds of plottableDatasets) {
          _datasets[ds.id] = {
            chart: { type: 'bar', title: ds.title, xAxis: ds.xAxis, series: ds.series },
            table: { columns: [], rows: [] },
          };
          const t = buildTableFromRows(ds.rawRows || []);
          if (t.columns.length > 0) _datasets[ds.id].table = t;
        }

        const contentText = extractContentText(cleanBlocks);

        response = JSON.stringify({
          blocks: cleanBlocks,
          visualizations: resolvedCharts.length > 0 ? resolvedCharts : null,
          tables: resolvedTables.length > 0 ? resolvedTables : null,
          _provenance,
          _datasets,
          _contentText: contentText,
        });

        endGeneration(execGen, { output: maskPII(preview(response)), model: 'deepseek-chat' });
      } else {
        response = '抱歉，查询过程中遇到了问题，请稍后重试或尝试缩小查询范围。';
        endGeneration(execGen, { output: maskPII(preview(response)), level: 'WARNING', statusMessage: lastError, model: 'deepseek-chat' });
      }
    }
  }

  response = sanitizeUserFacingMarkdown(response);

  let exitMeta = { bytes: response.length };
  try {
    const rj = JSON.parse(response);
    if (rj.blocks) exitMeta.blocks = rj.blocks.length;
    if (rj.tables) exitMeta.tables = rj.tables.length;
    if (rj.visualizations) exitMeta.charts = rj.visualizations.length;
  } catch (_) { /* plain text */ }

  trace.nodeExit(emitter, state, 'FinalResponseStep', exitMeta);
  endSpan(span, { output: preview(response), metadata: { responseBytes: response.length } });

  return {
    finalResponse: response,
    reply_markdown: response,
    messages: [new AIMessage({ content: response })]
  };
};

module.exports = { finalResponseStep, sanitizeUserFacingMarkdown, buildTableFromRows, prepareToolData };
