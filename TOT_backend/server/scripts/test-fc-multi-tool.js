'use strict';

/**
 * 单元测试：fc_ExecuteTool / fc_MergeToolResults 的多工具语义
 *
 * Case A：两个工具 LLM 一次发起，第一个成功、第二个抛 EXECUTION_ERROR
 *         → toolResults 含两条独立结果；calledTools 含两个；merge 输出两条 ToolMessage；
 *           错误结果不会被写进 session 缓存。
 *
 * Case B：第一个工具命中 PERMISSION_DENIED，第二个工具应被 skip
 *         → 第二个工具结果是 SKIPPED_AFTER_DENY；不进入缓存；calledTools 仍记录第一个。
 *
 * Case C：fc_MergeToolResults 找不到对应结果时，meta_fallback_count 应递增
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const logger = require('../utils/logger');
logger.info = () => {};
logger.warn = () => {};
logger.error = () => {};

const { AIMessage } = require('@langchain/core/messages');

// stub chatToolsService.executeByName 以便不依赖真实工具数据
const chatToolsService = require('../services/chatToolsService');
const realExecute = chatToolsService.executeByName;
const stubScript = new Map();
chatToolsService.executeByName = async (toolName /*, params, regionScope */) => {
  const next = stubScript.get(toolName);
  if (!next) return { ok: true, source: 'stub_default', toolName };
  if (typeof next === 'function') return next();
  return next;
};

// stub session cache writer to verify caching behavior
const chatSessionStateService = require('../services/chatSessionStateService');
const realAddRecord = chatSessionStateService.addRecord;
const cacheWrites = [];
chatSessionStateService.addRecord = (sessionId, record /*, scope */) => {
  cacheWrites.push({ sessionId, record });
};

const { fc_ExecuteTool, fc_MergeToolResults } = require('../agent/graph/nodes/fcExecute');

let passed = 0;
let failed = 0;
const assert = (cond, msg) => {
  if (cond) {
    console.log(`  ✅ ${msg}`);
    passed++;
  } else {
    console.error(`  ❌ ${msg}`);
    failed++;
  }
};

const baseState = (overrides = {}) => ({
  sessionId: 'unit-multi',
  userId: 999,
  userMessage: '一次发两个工具',
  regionScope: { type: 'national' },
  tool_namespace: 'executive_chat',
  selected_tier: 'L3_fc_guarded',
  intent: 'analytics_query',
  entities: {},
  entities_confidence: {},
  candidateTools: ['queryExecutiveMetrics', 'getOverviewData'],
  toolResults: {},
  pending_tool_calls: [],
  fc_super_step_count: 1,
  fc_repair_attempts: 0,
  meta_fallback_count: 0,
  hitl_status: 'idle',
  hitl_resume_payload: null,
  interrupt_payload: null,
  messages: [],
  ...overrides
});

const buildToolCall = (id, name, args = {}) => ({ id, name, args });

const collectedSseEvents = [];
const sseEmitter = {
  handleLLMNewToken: () => {},
  handleToolStart: (info) => collectedSseEvents.push({ kind: 'start', ...info }),
  handleToolEnd: (data, meta) => collectedSseEvents.push({ kind: 'end', meta }),
  handleError: () => {}
};

const main = async () => {
  console.log('\n=== Case A：成功 + EXECUTION_ERROR 两工具独立结果 ===');
  {
    cacheWrites.length = 0;
    collectedSseEvents.length = 0;
    stubScript.clear();
    stubScript.set('queryExecutiveMetrics', { ok: true, completion_rate: 0.78 });
    // chatToolsService.executeByName 的真实实现失败时返回 { error: { code, ... } }，模拟之
    stubScript.set('getOverviewData', { error: { code: 'EXECUTION_ERROR', message: 'mocked tool failure' } });

    const tcA = buildToolCall('call_OK', 'queryExecutiveMetrics');
    const tcB = buildToolCall('call_FAIL', 'getOverviewData');
    const aiMsg = new AIMessage({ content: '', tool_calls: [tcA, tcB] });

    const state = baseState({
      pending_tool_calls: [tcA, tcB],
      messages: [aiMsg]
    });

    const exec = await fc_ExecuteTool(state, { configurable: { sseEmitter } });

    assert(exec.fc_next_action === 'merge', 'execute 后回到 merge');
    assert(Object.keys(exec.toolResults).length === 2, '两个 tool_call 各自有结果（实际 keys 数=' + Object.keys(exec.toolResults).length + '）');
    assert(exec.toolResults.call_OK?.error === false, 'call_OK 标记非错误（实际 error=' + exec.toolResults.call_OK?.error + '）');
    assert(exec.toolResults.call_FAIL?.error === true, 'call_FAIL 标记为错误');
    assert(exec.toolResults.call_FAIL?.errorCode === 'EXECUTION_ERROR', 'call_FAIL errorCode = EXECUTION_ERROR');
    assert(Array.isArray(exec.calledTools) && exec.calledTools.length === 2, 'calledTools 含两个工具');

    // SSE：成功的 tool_end 应带 status=success；失败的应带 status=error
    const ends = collectedSseEvents.filter(e => e.kind === 'end');
    assert(ends.length === 2, 'tool_end 触发两次');
    assert(ends[0].meta?.status === 'success', '第一个 tool_end status=success');
    assert(ends[1].meta?.status === 'error' && ends[1].meta?.errorCode === 'EXECUTION_ERROR',
      '第二个 tool_end status=error 且带 errorCode（实际=' + JSON.stringify(ends[1].meta) + '）');

    // merge 阶段：写两条 ToolMessage；错误结果不写缓存
    const merged = await fc_MergeToolResults({ ...state, ...exec });
    assert(Array.isArray(merged.messages) && merged.messages.length === 2, 'merge 输出两条 ToolMessage');
    const cachedNames = cacheWrites.map(w => w.record);
    assert(cacheWrites.length === 1, '只写入一次 session 缓存（实际=' + cacheWrites.length + '）');
    assert(!JSON.stringify(cachedNames).includes('EXECUTION_ERROR'), '错误结果不会进入缓存');
  }

  console.log('\n=== Case B：PERMISSION_DENIED 短路后续工具 ===');
  {
    cacheWrites.length = 0;
    collectedSseEvents.length = 0;
    stubScript.clear();
    stubScript.set('queryExecutiveMetrics', { error: { code: 'PERMISSION_DENIED', message: 'role denied' } });
    let secondCalled = false;
    stubScript.set('getOverviewData', () => {
      secondCalled = true;
      return { ok: true };
    });

    const tcA = buildToolCall('call_DENY', 'queryExecutiveMetrics');
    const tcB = buildToolCall('call_AFTER', 'getOverviewData');
    const aiMsg = new AIMessage({ content: '', tool_calls: [tcA, tcB] });

    const state = baseState({
      pending_tool_calls: [tcA, tcB],
      messages: [aiMsg]
    });

    const exec = await fc_ExecuteTool(state, { configurable: { sseEmitter } });

    assert(secondCalled === false, '权限拒绝后第二个工具未被实际调用');
    assert(exec.toolResults.call_DENY?.errorCode === 'PERMISSION_DENIED', 'call_DENY errorCode 正确');
    assert(exec.toolResults.call_AFTER?.error === true, 'call_AFTER 被标记 error');
    const skipPayload = JSON.parse(exec.toolResults.call_AFTER.data);
    assert(skipPayload.error?.code === 'SKIPPED_AFTER_DENY',
      `call_AFTER 数据 code=SKIPPED_AFTER_DENY（实际=${skipPayload.error?.code}）`);
    assert(skipPayload.error?.blockedBy === 'call_DENY', 'skip 标注是被 call_DENY 阻断');
    // calledTools 只记录真正调用过的（被拒绝那个也算"已尝试"，只跳过后续）
    assert(exec.calledTools.includes('queryExecutiveMetrics') && !exec.calledTools.includes('getOverviewData'),
      `calledTools 应只含被拒绝那个，不含被 skip 的（实际=${exec.calledTools.join(',')}）`);

    const merged = await fc_MergeToolResults({ ...state, ...exec });
    assert(merged.messages.length === 2, 'merge 仍为每个 tool_call 输出一条 ToolMessage');
    assert(cacheWrites.length === 0, '权限错误与 skip 都不进入缓存');
  }

  console.log('\n=== Case C：toolResults 缺失 → meta_fallback_count 自增 ===');
  {
    cacheWrites.length = 0;
    const tcA = buildToolCall('call_X', 'queryExecutiveMetrics');
    const aiMsg = new AIMessage({ content: '', tool_calls: [tcA] });
    const state = baseState({
      pending_tool_calls: [],
      messages: [aiMsg],
      toolResults: {} // 故意没有结果
    });

    const merged = await fc_MergeToolResults(state);
    assert(merged.messages.length === 1, '没有结果时仍为 anchor 的 tool_call 写一条 ToolMessage');
    const content = JSON.parse(merged.messages[0].content);
    assert(content.error?.code === 'NO_TOOL_RESULT', 'ToolMessage 写结构化 NO_TOOL_RESULT');
    assert(merged.meta_fallback_count === 1,
      `meta_fallback_count 自增到 1（实际=${merged.meta_fallback_count}）`);
    assert(cacheWrites.length === 0, 'NO_TOOL_RESULT 不进入缓存');
  }

  // 还原 stub
  chatToolsService.executeByName = realExecute;
  chatSessionStateService.addRecord = realAddRecord;

  console.log(`\n--- ${passed} passed, ${failed} failed ---\n`);
  process.exit(failed > 0 ? 1 : 0);
};

main().catch((err) => {
  console.error('Test crashed:', err);
  process.exit(1);
});
