'use strict';

/**
 * 单元测试：fc_ParamRepair + fc_ValidateParams 的修参/HITL 升级闭环
 *
 * 构造场景：LLM 故意"漏"了 `getRegionDetailData` 的 region 参数，
 * 不依赖真实 LLM 与 SSE，直接驱动两个节点函数。
 *
 *   Case A：state.entities.region.canonical = "华东"
 *           → validate 报 MISSING_PARAM → repair 从 entities 推断 → validate 通过 → execute
 *
 *   Case B：state.entities 为空且 fc_repair_attempts 已达上限
 *           → validate 升级到 HITL，发 reason="missing_required_param" 的 InterruptPayload
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const logger = require('../utils/logger');
logger.info = () => {};
logger.warn = () => {};
logger.error = () => {};

const { fc_ValidateParams, fc_ParamRepair } = require('../agent/graph/nodes');
const RoutingPolicy = require('../agent/graph/routingPolicy');

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
  sessionId: 'unit-test',
  userId: 999,
  userMessage: '查一下华东区的详细数据',
  regionScope: { type: 'national' },
  tool_namespace: 'executive_chat',
  selected_tier: 'L3_fc_guarded',
  intent: 'drill_down',
  entities: {},
  entities_confidence: {},
  candidateTools: ['getRegionDetailData'],
  toolResults: {},
  pending_tool_calls: [],
  fc_super_step_count: 1,
  fc_repair_attempts: 0,
  hitl_status: 'idle',
  hitl_resume_payload: null,
  interrupt_payload: null,
  messages: [],
  ...overrides
});

const buildToolCall = (id = 'call_test_1', args = {}) => ({
  id,
  name: 'getRegionDetailData',
  args
});

const main = async () => {
  console.log('\n=== Case A：MISSING_PARAM 通过 entities 推断自动修复 ===');
  {
    const toolCall = buildToolCall('call_A_1', {}); // 故意漏 region
    let state = baseState({
      pending_tool_calls: [toolCall],
      entities: { region: { raw: '华东', canonical: '华东', confidence: 0.95 } },
      entities_confidence: { region: 0.95 }
    });

    // 1) 第一次校验：应报 MISSING_PARAM 并指向 repair
    let r1 = await fc_ValidateParams(state);
    assert(r1.fc_next_action === 'repair', 'validate 第一次应进入 repair');
    assert(r1.fc_repair_attempts === 1, 'fc_repair_attempts 自增到 1');
    assert(typeof r1.repair_error_reason === 'string' && r1.repair_error_reason.includes('MISSING_PARAM'),
      'repair_error_reason 含 MISSING_PARAM');

    // 2) repair：根据 entities.region.canonical 把 region 填上
    state = { ...state, ...r1 };
    const r2 = await fc_ParamRepair(state);
    assert(r2.fc_next_action === 'validate', 'repair 完成后回到 validate');
    assert(Array.isArray(r2.pending_tool_calls) && r2.pending_tool_calls.length === 1,
      'pending_tool_calls 仍是 1 个');
    assert(r2.pending_tool_calls[0].args.region === '华东',
      `region 已从 entities 推断填入（实际值=${r2.pending_tool_calls[0].args.region}）`);
    assert(!Array.isArray(r2.messages) || r2.messages.length === 0,
      'repair 不应再写入假 ToolMessage 污染历史');

    // 3) 第二次校验：region 已经填好，应直接 execute
    state = { ...state, ...r2 };
    const r3 = await fc_ValidateParams(state);
    assert(r3.fc_next_action === 'execute', '修参后应直接进入 execute');
    assert(Array.isArray(r3.pending_tool_calls) && r3.pending_tool_calls[0].args.region === '华东',
      'execute 时 region 已存在');
  }

  console.log('\n=== Case B：entities 推不出 + 达到 max_repair_attempts → 升级到 HITL ===');
  {
    const maxAttempts = RoutingPolicy.tiers.L3_fc_guarded?.max_repair_attempts ?? 2;
    const toolCall = buildToolCall('call_B_1', {});
    const state = baseState({
      pending_tool_calls: [toolCall],
      entities: {},                    // 没有可推断来源
      entities_confidence: {},
      fc_repair_attempts: maxAttempts  // 已用尽 repair 次数
    });

    const r = await fc_ValidateParams(state);
    assert(r.fc_next_action === 'hitl', '应升级到 HITL（实际=' + r.fc_next_action + '）');
    assert(r.hitl_status === 'pending_interrupt', 'hitl_status = pending_interrupt');
    assert(r.interrupt_payload && r.interrupt_payload.reason === 'missing_required_param',
      `interrupt_payload.reason = missing_required_param（实际=${r.interrupt_payload?.reason}）`);
    assert(r.interrupt_payload?.type === 'input', 'payload type=input');
    assert(Array.isArray(r.interrupt_payload?.context?.missingFields) &&
           r.interrupt_payload.context.missingFields.includes('region'),
      `payload.context.missingFields 含 region（实际=${JSON.stringify(r.interrupt_payload?.context?.missingFields)}）`);
    assert(r.interrupt_payload?.resume_token === 'call_B_1',
      `resume_token 指向触发的 tool_call_id（实际=${r.interrupt_payload?.resume_token}）`);
  }

  console.log('\n=== Case C：低置信实体 → 也应该走 HITL（不会被 missing_required_param 抢路） ===');
  {
    const state = baseState({
      pending_tool_calls: [buildToolCall('call_C_1', { region: '华东' })],
      entities: { region: { raw: '华东', canonical: '华东', confidence: 0.5 } },
      entities_confidence: { region: 0.5 }
    });

    const r = await fc_ValidateParams(state);
    assert(r.fc_next_action === 'hitl', '低置信也应进入 HITL');
    assert(r.interrupt_payload?.reason === 'low_confidence_entity',
      `reason = low_confidence_entity（实际=${r.interrupt_payload?.reason}）`);
    assert(Array.isArray(r.interrupt_payload?.options) && r.interrupt_payload.options.length > 0,
      '低置信 payload 应有真实 options（不再是 O1/O2 占位）');
    const labels = (r.interrupt_payload.options || []).map(o => o.label).join(' | ');
    assert(!/选项一|O1/.test(labels),
      `options.label 不再是 O1/选项一 占位（实际=${labels}）`);
  }

  console.log(`\n--- ${passed} passed, ${failed} failed ---\n`);
  process.exit(failed > 0 ? 1 : 0);
};

main().catch((err) => {
  console.error('Test crashed:', err);
  process.exit(1);
});
