'use strict';

/**
 * seed.js — 场景驱动的 MVP mock 数据
 * 运行：node server/db/seed.js                    （使用当前时间作为锚点）
 *       SEED_DATE="2026-06-15" node db/seed.js    （指定模拟日期）
 *       npm run seed                               （同第一种）
 *
 * 数据规模：10 家门店 / 100 名员工 / 8 个任务 / 800 条任务分配
 *
 * 核心设计：
 *   - 可配置时间锚点（SEED_DATE），任何时候运行都生成等效的测试数据
 *   - 8 种用户旅程场景，完整覆盖 P2→P1→P0 催办漏斗和转化率计算
 *   - 场景跨门店 / 渠道均匀分布，保证所有下钻维度有数据
 */

const bcrypt    = require('bcrypt');
const { nanoid } = require('nanoid');
const { db }    = require('./index');
const { parseDateToSqliteLocal } = require('../utils/ddlAt');

const SALT_ROUNDS    = 10;
const DEFAULT_PASSWORD = 'Train2026!';
const ADMIN_PASSWORD   = 'Admin2026!';

// ─── 可配置时间锚点 ───────────────────────────────────────────────────────
const ANCHOR = process.env.SEED_DATE ? new Date(process.env.SEED_DATE) : new Date();
const daysMs = (d) => d * 24 * 3600 * 1000;
const hoursMs = (h) => h * 3600 * 1000;
const toDbStr = (ms) => parseDateToSqliteLocal(new Date(ms));

console.log(`⏱  时间锚点: ${toDbStr(ANCHOR.getTime())}${process.env.SEED_DATE ? ' (SEED_DATE)' : ' (当前时间)'}`);

// ─── 10 家门店定义 ───────────────────────────────────────────────────────
const STORE_DEFS = [
  { id: 'S001', name: '上海环球港旗舰店', region: '华东', city: '上海',   rtm: 'Monobrand',  format: 'MONO',         dealer_name: '恒大通讯'  },
  { id: 'S002', name: '南京新街口体验店', region: '华东', city: '南京',   rtm: 'Multibrand', format: 'Lifestyle',    dealer_name: '鼎盛科技'  },
  { id: 'S003', name: '广州天河城旗舰店', region: '华南', city: '广州',   rtm: 'Monobrand',  format: 'MONO',         dealer_name: '远方科技'  },
  { id: 'S004', name: '深圳万象城体验店', region: '华南', city: '深圳',   rtm: 'Multibrand', format: 'Lifestyle',    dealer_name: '华联商贸'  },
  { id: 'S005', name: '北京三里屯旗舰店', region: '华北', city: '北京',   rtm: 'Monobrand',  format: 'MONO',         dealer_name: '创世商贸'  },
  { id: 'S006', name: '天津滨江道体验店', region: '华北', city: '天津',   rtm: 'Carrier',    format: 'Mass Merchant',dealer_name: '新时代电子' },
  { id: 'S007', name: '成都太古里旗舰店', region: '西南', city: '成都',   rtm: 'Monobrand',  format: 'MONO',         dealer_name: '蓝天数码'  },
  { id: 'S008', name: '重庆观音桥体验店', region: '西南', city: '重庆',   rtm: 'Multibrand', format: 'Lifestyle',    dealer_name: '盛达通讯'  },
  { id: 'S009', name: '沈阳中街体验店',   region: '东北', city: '沈阳',   rtm: 'Carrier',    format: 'Mass Merchant',dealer_name: '新时代电子' },
  { id: 'S010', name: '哈尔滨中央大街店', region: '东北', city: '哈尔滨', rtm: 'Education',  format: 'Campus',       dealer_name: '飞跃科技'  },
];

// ─── 8 个任务定义 ──────────────────────────────────────────────────────────
// 时间分布保证：任务 A/B 已过期，C/D 进行中，E 刚下发，WARN 系列覆盖各预警等级
const TASKS = [
  {
    id: 'TASK_A', title: 'iPhone 17 新品培训',
    description: 'iPhone 17 系列产品知识、卖点提炼与销售话术。已逾期。',
    has_mypal: 1, has_smartsell: 1, has_ai_demo: 1, has_live_broadcast: 0,
    status: 'dispatched', rtm_filter: JSON.stringify(['Monobrand']),
    ddl_offset_days: -3,   // 3 天前过期
    duration_days: 18,     // 任务总时长
    mypal_task_week: 'FY26Q2W1', pass_score: 80, created_by: 'central',
  },
  {
    id: 'TASK_B', title: 'AirPods 新品培训',
    description: 'AirPods 4 全系产品知识，重点 ANC 卖点与 H2 芯片差异化话术。已逾期。',
    has_mypal: 1, has_smartsell: 1, has_ai_demo: 0, has_live_broadcast: 1,
    status: 'dispatched',
    ddl_offset_days: -1, duration_days: 14,
    mypal_task_week: 'FY26Q2W1', pass_score: 80, created_by: 'central',
  },
  {
    id: 'TASK_C', title: 'Mono 新春系列产品学习',
    description: 'Mono 新春限定系列配件产品知识培训。正常进行中，ddl 在 7 天后。',
    has_mypal: 1, has_smartsell: 0, has_ai_demo: 1, has_live_broadcast: 1,
    status: 'dispatched', rtm_filter: JSON.stringify(['Monobrand']),
    ddl_offset_days: 7, duration_days: 21,
    mypal_task_week: 'FY26Q2W2', pass_score: 80, created_by: 'central',
  },
  {
    id: 'TASK_D', title: 'MacBook 销售技巧培训',
    description: 'MacBook Pro/Air 全系产品知识与销售场景。正常进行中。',
    has_mypal: 1, has_smartsell: 0, has_ai_demo: 1, has_live_broadcast: 0,
    status: 'dispatched', rtm_filter: JSON.stringify(['Multibrand', 'Carrier']),
    ddl_offset_days: 10, duration_days: 14,
    mypal_task_week: 'FY26Q2W1', pass_score: 80, created_by: 'central',
  },
  {
    id: 'TASK_E', title: 'iPad Pro 销售技巧培训',
    description: 'iPad Pro M4 芯片性能、Apple Pencil Pro 联动卖点。刚下发。',
    has_mypal: 1, has_smartsell: 1, has_ai_demo: 0, has_live_broadcast: 0,
    status: 'dispatched',
    ddl_offset_days: 25, duration_days: 30,
    mypal_task_week: 'FY26Q2W2', pass_score: 80, created_by: 'central',
  },
  {
    id: 'TASK_P0', title: 'Apple Watch 销售话术培训',
    description: 'Apple Watch Series 10 健康功能卖点。P0 临期，剩余 <24h。',
    has_mypal: 1, has_smartsell: 0, has_ai_demo: 0, has_live_broadcast: 1,
    status: 'dispatched',
    ddl_offset_days: 0.5, duration_days: 12,
    mypal_task_week: 'FY26Q2W1', pass_score: 80, created_by: 'central',
  },
  {
    id: 'TASK_P1', title: 'MAC Studio 产品销售教学',
    description: 'MAC Studio 性能优势与目标客群画像。P1 临期，剩余 <48h。',
    has_mypal: 1, has_smartsell: 0, has_ai_demo: 0, has_live_broadcast: 0,
    status: 'dispatched', rtm_filter: JSON.stringify(['Monobrand', 'Education']),
    ddl_offset_days: 1.5, duration_days: 14,
    mypal_task_week: 'FY26Q2W2', mypal_product_name: 'MAC Studio', pass_score: 80, created_by: 'central',
  },
  {
    id: 'TASK_VISION', title: 'Vision Pro 介绍',
    description: '深入了解 Apple Vision Pro，涵盖空间计算与核心应用场景。进行中。',
    has_mypal: 1, has_smartsell: 1, has_ai_demo: 1, has_live_broadcast: 0,
    status: 'dispatched',
    ddl_offset_days: 14, duration_days: 21,
    mypal_task_week: 'FY26Q2W2', mypal_product_name: 'Vision Pro', pass_score: 90, created_by: 'central',
    sub_tasks_config: '{"MyPAL":{"description":"Vision Pro 基础硬件参数与卖点学习。","deadline":"2026-05-05 20:32:30"},"SmartSell":{"description":"空间计算设备销售场景与话术演练。","deadline":"2026-04-29 20:32:30"},"AI Demo":{"description":"基于模拟顾客场景的 AI 角色对练考核。","deadline":"2026-05-03 20:32:30"}}',
  },
];

// ─── 为每个 task 计算实际时间戳 ──────────────────────────────────────────────
const TASKS_RESOLVED = TASKS.map(t => {
  const ddlMs = ANCHOR.getTime() + daysMs(t.ddl_offset_days);
  const startMs = ddlMs - daysMs(t.duration_days);
  return {
    ...t,
    start_at: toDbStr(startMs),
    ddl_at: toDbStr(ddlMs),
    created_at: toDbStr(startMs - daysMs(2)),
    _ddlMs: ddlMs,
    _startMs: startMs,
    _durationMs: daysMs(t.duration_days),
  };
});

// ─── 员工定义 ─────────────────────────────────────────────────────────────
const EMP_SURNAMES = ['陈','张','王','李','赵','孙','周','吴','郑','林'];
const EMP_GIVEN    = ['伟','丽','强','明','佳','磊','萍','浩','敏','超'];
const ROLES_JOB    = ['高级销售顾问','销售顾问','体验顾问','产品专员','销售顾问','高级销售顾问','销售顾问','体验顾问','产品专员','销售顾问'];

function generateEmployees() {
  const employees = [];
  let seq = 1;
  for (const store of STORE_DEFS) {
    for (let j = 0; j < 10; j++) {
      const id = `E${String(seq).padStart(3, '0')}`;
      employees.push({
        id, store_id: store.id,
        name: `${store.city[0]}${EMP_SURNAMES[j]}${EMP_GIVEN[j]}`,
        role: ROLES_JOB[j],
        email: `${id.toLowerCase()}@mypal.seed.local`,
        _empIndex: j,
        _store: store,
      });
      seq++;
    }
  }
  return employees;
}

// ─── 用户旅程场景（核心）────────────────────────────────────────────────────
//
// 每个场景定义一个用户从收到任务到 ANCHOR 时刻的完整时间线。
// 所有偏移量相对于任务 ddl（负数 = ddl 之前，正数 = 之后）。
// 场景跨门店和任务均匀分配，保证所有下钻维度有数据。
//
// ┌──────────────────────┬──────────┬──────────────────────────────────────┐
// │ 场景                  │ 占比     │ 覆盖的指标                            │
// ├──────────────────────┼──────────┼──────────────────────────────────────┤
// │ early_completer       │ 15%      │ 触达率、完成率、平均耗时                │
// │ p2_rescued            │ 15%      │ P2预警人数/率、P2催办转化率            │
// │ p1_rescued            │ 12%      │ P1预警人数/率、P1催办转化率            │
// │ p0_rescued            │ 8%       │ P0预警人数/率、P0催办转化率            │
// │ p0_stuck              │ 10%      │ 未完成率、P0预警→未完成漏斗             │
// │ p1_stuck              │ 8%       │ P1预警→卡住                           │
// │ p2_stuck              │ 7%       │ P2预警→卡住                           │
// │ never_started         │ 10%      │ 触达但未开始                          │
// │ not_received          │ 10%      │ 未触达人数/率                         │
// │ in_progress_clean     │ 5%       │ 进行中（无预警）                       │
// └──────────────────────┴──────────┴──────────────────────────────────────┘
//
// 每个场景的 nudges 数组精确控制触发时间，保证：
//   - P2 在任务进度 50% 时触发
//   - P1 在 ddl 前 48h 触发
//   - P0 在 ddl 前 24h 触发
//
const JOURNEYS = [
  {
    id: 'early_completer', pct: 15,
    // 早早完成，ddl 前 7 天搞定，没收到任何催办
    status: 'completed',
    completed_offset: -7,
    nudges: [],
  },
  {
    id: 'p2_rescued', pct: 15,
    // 收到 P2 催办后完成（P2→完成，没到 P1）
    status: 'completed',
    completed_offset: -1.5,
    nudges: [
      { type: 'nudge_yellow', severity: 'yellow', rule: 'deadlineCrisisP2', offset: -5, content: '任务时间过半，请尽快开始学习' },
    ],
  },
  {
    id: 'p1_rescued', pct: 12,
    // P2→P1→完成（P2 催办转化到 P1，P1 催办后完成）
    status: 'completed',
    completed_offset: -0.3,
    nudges: [
      { type: 'nudge_yellow', severity: 'yellow', rule: 'deadlineCrisisP2', offset: -6, content: '任务时间过半，请尽快开始学习' },
      { type: 'nudge_orange', severity: 'orange', rule: 'deadlineCrisisP1', offset: -1.8, content: '距离截止仅剩48小时' },
    ],
  },
  {
    id: 'p0_rescued', pct: 8,
    // P2→P1→P0→最后一刻完成（P0 催办后赶在 ddl 前完成）
    status: 'completed',
    completed_offset: -0.1,
    nudges: [
      { type: 'nudge_yellow', severity: 'yellow', rule: 'deadlineCrisisP2', offset: -7, content: '任务时间过半' },
      { type: 'nudge_orange', severity: 'orange', rule: 'deadlineCrisisP1', offset: -1.9, content: '距离截止仅剩48小时' },
      { type: 'nudge_red',    severity: 'red',    rule: 'deadlineCrisisP0', offset: -0.8, content: '距离截止仅剩24小时！' },
    ],
  },
  {
    id: 'p0_stuck', pct: 10,
    // P2→P1→P0→仍未完成（ddl 已过，催办漏斗末端）
    status: 'in_progress',
    completed_offset: null,
    nudges: [
      { type: 'nudge_yellow', severity: 'yellow', rule: 'deadlineCrisisP2', offset: -7, content: '任务时间过半' },
      { type: 'nudge_orange', severity: 'orange', rule: 'deadlineCrisisP1', offset: -2, content: '距离截止仅剩48小时' },
      { type: 'nudge_red',    severity: 'red',    rule: 'deadlineCrisisP0', offset: -0.8, content: '距离截止仅剩24小时！' },
    ],
    // ANCHOR 时仍在 in_progress（对于过期任务：ddl 过了还没完成）
  },
  {
    id: 'p1_stuck', pct: 8,
    // P2→P1→卡住（还没到 P0，仍在 in_progress）
    status: 'in_progress',
    completed_offset: null,
    nudges: [
      { type: 'nudge_yellow', severity: 'yellow', rule: 'deadlineCrisisP2', offset: -5, content: '任务时间过半' },
      { type: 'nudge_orange', severity: 'orange', rule: 'deadlineCrisisP1', offset: -1.5, content: '距离截止仅剩48小时' },
    ],
  },
  {
    id: 'p2_stuck', pct: 7,
    // 收到 P2 后卡住
    status: 'in_progress',
    completed_offset: null,
    nudges: [
      { type: 'nudge_yellow', severity: 'yellow', rule: 'deadlineCrisisP2', offset: -4, content: '任务时间过半' },
    ],
  },
  {
    id: 'never_started', pct: 10,
    // 收到了但从未开始（received 但没 started）
    status: 'pending',
    completed_offset: null,
    nudges: [],
  },
  {
    id: 'not_received', pct: 10,
    // 根本没收到（received_at = null）
    status: 'pending',
    completed_offset: null,
    nudges: [],
    no_received: true,
  },
  {
    id: 'in_progress_clean', pct: 5,
    // 进行中，无预警（ddl 还没到，时间未过半）
    status: 'in_progress',
    completed_offset: null,
    nudges: [],
  },
];

// ─── 平台完成度 ──────────────────────────────────────────────────────────
function getPlatformCompletion(task, status, empIndex) {
  if (status === 'completed') {
    return {
      mypal_completed: task.has_mypal,
      smartsell_completed: task.has_smartsell,
      ai_demo_completed: task.has_ai_demo,
      live_broadcast_completed: task.has_live_broadcast,
      progress: 100,
    };
  }
  if (status === 'pending') {
    return { mypal_completed: 0, smartsell_completed: 0, ai_demo_completed: 0, live_broadcast_completed: 0, progress: 0 };
  }
  const enabled = [
    { key: 'mypal_completed', on: task.has_mypal },
    { key: 'smartsell_completed', on: task.has_smartsell },
    { key: 'ai_demo_completed', on: task.has_ai_demo },
    { key: 'live_broadcast_completed', on: task.has_live_broadcast },
  ].filter(p => p.on);
  const total = enabled.length;
  const done = Math.min(total - 1, Math.max(1, Math.ceil(total * (1 - empIndex / 10))));
  const result = { mypal_completed: 0, smartsell_completed: 0, ai_demo_completed: 0, live_broadcast_completed: 0, progress: 0 };
  for (let i = 0; i < done; i++) result[enabled[i].key] = 1;
  result.progress = Math.round((done / total) * 100);
  return result;
}

// ─── 场景分配 ─────────────────────────────────────────────────────────────
// 将 100 个员工 × 8 个任务的 800 个 assignment 分配到各场景
// 保证各门店/渠道都有覆盖
function assignJourneys(employees, tasks) {
  const total = employees.length * tasks.length;
  // 展平 journeys 为加权列表
  const weighted = [];
  for (const j of JOURNEYS) {
    const n = Math.round(total * j.pct / 100);
    for (let i = 0; i < n; i++) weighted.push(j);
  }
  // 补齐到 total（舍入误差）
  while (weighted.length < total) weighted.push(JOURNEYS[0]);
  // 打乱
  for (let i = weighted.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [weighted[i], weighted[j]] = [weighted[j], weighted[i]];
  }
  // 分配：每个 (emp, task) 对赋一个场景
  const map = new Map(); // key: "empId|taskId"
  let idx = 0;
  for (const emp of employees) {
    for (const task of tasks) {
      map.set(`${emp.id}|${task.id}`, weighted[idx++]);
    }
  }
  return map;
}

// ─── 生成 assignments ─────────────────────────────────────────────────────
function generateAssignments(employees, tasks, journeyMap) {
  const assignments = [];
  for (const task of tasks) {
    for (const emp of employees) {
      const journey = journeyMap.get(`${emp.id}|${task.id}`);
      const t = task; // TASKS_RESOLVED, has _ddlMs, _startMs, _durationMs

      // --- 计算时间戳 ---
      const receivedOffsetDays = journey.no_received ? null : (-t.duration_days * 0.2 - Math.random() * 2);
      const receivedMs = receivedOffsetDays != null
        ? t._startMs + daysMs(Math.abs(receivedOffsetDays))
        : null;

      let startedMs = null;
      if (journey.status !== 'pending' && receivedMs != null) {
        startedMs = receivedMs + daysMs(1 + Math.random() * 3);
      }

      let completedMs = null;
      if (journey.completed_offset != null) {
        completedMs = t._ddlMs + daysMs(journey.completed_offset);
        // 保证在 started 之后
        if (startedMs != null && completedMs <= startedMs) {
          completedMs = startedMs + daysMs(0.5);
        }
      }

      // 确保所有时间戳不超过 ANCHOR（除了未来的 ddl）
      const clamp = (ms, max) => (ms != null && ms > max ? max - daysMs(0.01) : ms);
      const anchorMs = ANCHOR.getTime();
      const rcvClamped = clamp(receivedMs, anchorMs);
      const startClamped = clamp(startedMs, anchorMs);
      const compClamped = clamp(completedMs, anchorMs);

      const platforms = getPlatformCompletion(task, journey.status, emp._empIndex);

      assignments.push({
        id: nanoid(),
        task_id: task.id,
        user_id: emp.id,
        store_id: emp.store_id,
        status: journey.status,
        ...platforms,
        nudge_count: journey.nudges.length,
        received_at: rcvClamped ? toDbStr(rcvClamped) : null,
        started_at: startClamped ? toDbStr(startClamped) : null,
        completed_at: compClamped ? toDbStr(compClamped) : null,
        created_at: task.start_at,
        updated_at: compClamped ? toDbStr(compClamped) : (startClamped ? toDbStr(startClamped) : (rcvClamped ? toDbStr(rcvClamped) : task.start_at)),
        // 挂载 journey 用于 notification 生成
        _journey: journey,
        _rcvMs: rcvClamped,
        _startMs: startClamped,
        _compMs: compClamped,
        _ddlMs: t._ddlMs,
        _startTaskMs: t._startMs,
      });
    }
  }
  return assignments;
}

// ─── 生成 notification_events（场景驱动）───────────────────────────────────
function generateNotifications(assignments) {
  const events = [];

  // 1. task_assigned 事件
  for (const a of assignments) {
    events.push({
      id: nanoid(),
      task_id: a.task_id,
      assignment_id: a.id,
      target_user_id: a.user_id,
      store_id: a.store_id,
      event_type: 'task_assigned',
      severity: null,
      dedupe_key: `assign_${a.task_id}_${a.user_id}`,
      content: null,
      initiator_id: null,
      created_at: a.received_at || a.created_at,
    });
  }

  // 2. 场景驱动的催办事件
  const anchorMs = ANCHOR.getTime();
  for (const a of assignments) {
    const journey = a._journey;
    if (!journey || !journey.nudges.length) continue;

    for (const nudge of journey.nudges) {
      const nudgeMs = a._ddlMs + daysMs(nudge.offset);
      // 催办时间必须在任务下发之后、ANCHOR 之前
      if (nudgeMs <= a._startTaskMs) continue;
      if (nudgeMs > anchorMs) continue;
      // 如果该用户已完成，催办必须在完成之前
      if (a._compMs != null && nudgeMs >= a._compMs) continue;
      // 如果该用户未触达(received=null)，催办必须在收到之后
      if (a._rcvMs != null && nudgeMs <= a._rcvMs) continue;

      events.push({
        id: nanoid(),
        task_id: a.task_id,
        assignment_id: a.id,
        target_user_id: a.user_id,
        store_id: a.store_id,
        event_type: nudge.type,
        severity: nudge.severity,
        dedupe_key: `autonudge:${nudge.rule}:${a.id}`,
        content: nudge.content,
        initiator_id: null,
        created_at: toDbStr(nudgeMs),
      });
    }
  }
  return events;
}

// ─── 生成 read_receipts ──────────────────────────────────────────────────
function generateReadReceipts(notifications, assignments) {
  const receipts = [];
  for (const n of notifications) {
    if (n.event_type === 'task_assigned' && n.task_id) {
      const a = assignments.find(x => x.task_id === n.task_id && x.user_id === n.target_user_id);
      if (a && a.received_at) {
        receipts.push({
          id: nanoid(), event_id: n.id, user_id: n.target_user_id,
          source: 'task_detail_open', read_at: a.received_at,
        });
      }
    }
  }
  return receipts;
}

// ─── MyPal learning mock ─────────────────────────────────────────────────
const MYPAL_PRODUCTS = ['AirPods Max 2', 'AirPods Pro 2', 'Apple Watch Series 10', 'iPad 11 英寸'];
const MY_PAL_WEEK_PRIMARY = 'FY26Q2W1';
const MY_PAL_WEEK_SECONDARY = 'FY26Q2W2';

function generateMypalRows(employees) {
  const base = new Date('2026-04-01T00:00:00Z');
  const rows = [];
  employees.forEach((e, idx) => {
    const seedId = e.email.trim().toLowerCase();
    const taskWeek = idx % 20 === 0 ? MY_PAL_WEEK_SECONDARY : MY_PAL_WEEK_PRIMARY;
    const bucket = idx % 10;
    const required = idx % 3 === 0 ? 0 : 1;
    let firstUseTime = null, weekStartTime = null, progress = 0, passedWeek = null, passedTime = null;
    if (bucket === 0) {
      progress = 0;
    } else if (bucket === 4) {
      progress = 100; passedWeek = taskWeek;
      const passedAt = new Date(base.getTime() + idx * 3600 * 1000);
      passedTime = toDbStr(passedAt);
      weekStartTime = toDbStr(new Date(passedAt.getTime() - 12 * 3600 * 1000));
      firstUseTime = toDbStr(new Date(passedAt.getTime() - 2 * 24 * 3600 * 1000));
    } else {
      const startedAt = new Date(base.getTime() + idx * 3600 * 1000);
      weekStartTime = toDbStr(new Date(startedAt.getTime() - 6 * 3600 * 1000));
      firstUseTime = toDbStr(new Date(startedAt.getTime() - 2 * 24 * 3600 * 1000));
      progress = Math.min(99, 10 + (idx * 7) % 85);
    }
    const product1 = MYPAL_PRODUCTS[idx % MYPAL_PRODUCTS.length];
    rows.push({ seed_id: seedId, product_name: product1, first_use_time: firstUseTime, task_week: taskWeek, progress, passed_week: passedWeek, passed_time: passedTime, required, week_start_time: weekStartTime });
    if (idx % 7 === 0) {
      const product2 = MYPAL_PRODUCTS[(idx + 1) % MYPAL_PRODUCTS.length];
      const progress2 = progress === 100 ? 100 : Math.max(0, Math.min(99, progress - 10));
      rows.push({ seed_id: seedId, product_name: product2, first_use_time: firstUseTime, task_week: taskWeek, progress: progress2, passed_week: progress2 === 100 ? taskWeek : null, passed_time: progress2 === 100 ? passedTime : null, required: required === 1 ? 1 : 0, week_start_time: progress2 === 0 ? null : weekStartTime });
    }
  });
  return rows;
}

// ─── 生成 users ──────────────────────────────────────────────────────────
async function generateUsers(employees) {
  const defaultHash = await bcrypt.hash(DEFAULT_PASSWORD, SALT_ROUNDS);
  const adminHash   = await bcrypt.hash(ADMIN_PASSWORD, SALT_ROUNDS);
  const users = [
    { username: 'central',          password_hash: defaultHash, role: 'central',   store_id: null, employee_id: null, executive_regions: null,                          executive_rtm: null },
    { username: 'executive',        password_hash: defaultHash, role: 'executive', store_id: null, employee_id: null, executive_regions: null,                          executive_rtm: null },
    { username: 'executive_east',   password_hash: defaultHash, role: 'executive', store_id: null, employee_id: null, executive_regions: JSON.stringify(['华东']),       executive_rtm: null },
    { username: 'executive_mono',   password_hash: defaultHash, role: 'executive', store_id: null, employee_id: null, executive_regions: null,                          executive_rtm: 'Monobrand' },
    { username: 'executive_north',  password_hash: defaultHash, role: 'executive', store_id: null, employee_id: null, executive_regions: JSON.stringify(['华北','东北']), executive_rtm: null },
    { username: 'admin',            password_hash: adminHash,   role: 'admin',     store_id: null, employee_id: null, executive_regions: null,                          executive_rtm: null },
  ];
  for (const emp of employees) {
    users.push({ username: `emp_${emp.id}`, password_hash: defaultHash, role: 'employee', store_id: emp.store_id, employee_id: emp.id });
  }
  return users;
}

// ─── 主函数 ──────────────────────────────────────────────────────────────
async function seed() {
  console.log('🌱 开始写入 seed 数据 (场景驱动)...');

  const employees     = generateEmployees();
  const tasks         = TASKS_RESOLVED;
  const journeyMap    = assignJourneys(employees, tasks);
  const users         = await generateUsers(employees);
  const assignments   = generateAssignments(employees, tasks, journeyMap);
  const notifications = generateNotifications(assignments);
  const readReceipts  = generateReadReceipts(notifications, assignments);
  const mypalRows     = generateMypalRows(employees);

  db.transaction(() => {
    const seedStoreIds = STORE_DEFS.map(s => s.id);
    const seedTaskIds  = tasks.map(t => t.id);
    const phStores     = seedStoreIds.map(() => '?').join(',');
    const phTasks      = seedTaskIds.map(() => '?').join(',');

    db.run('DELETE FROM read_receipts');
    db.run('DELETE FROM notification_events');
    db.run('DELETE FROM nudge_records');
    db.run('DELETE FROM task_assignments');
    db.run('DELETE FROM chat_message_feedback');
    db.run('DELETE FROM chat_messages');
    db.run('DELETE FROM chat_sessions');
    db.run('DELETE FROM mypal_learning_mock');
    db.run('DELETE FROM dashboard_insights');
    db.run(`DELETE FROM tasks WHERE id NOT IN (${phTasks})`, seedTaskIds);
    db.run('DELETE FROM users WHERE employee_id IS NOT NULL');
    db.run('DELETE FROM employees');
    db.run(`UPDATE users SET store_id = NULL WHERE store_id IS NOT NULL AND store_id NOT IN (${phStores})`, seedStoreIds);
    db.run(`DELETE FROM stores WHERE id NOT IN (${phStores})`, seedStoreIds);

    for (const { _store: _s, ...s } of STORE_DEFS) {
      db.run(
        `INSERT INTO stores (id, name, region, city, rtm, format, dealer_name)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name, region=excluded.region, city=excluded.city,
           rtm=excluded.rtm, format=excluded.format, dealer_name=excluded.dealer_name`,
        [s.id, s.name, s.region, s.city, s.rtm, s.format, s.dealer_name]
      );
    }
    console.log(`  ✓ stores: ${STORE_DEFS.length} 条`);

    for (const e of employees) {
      db.run('INSERT OR IGNORE INTO employees (id, store_id, name, role) VALUES (?, ?, ?, ?)', [e.id, e.store_id, e.name, e.role]);
      db.run('UPDATE employees SET email = ? WHERE id = ?', [e.email, e.id]);
    }
    console.log(`  ✓ employees: ${employees.length} 条`);

    for (const t of tasks) {
      db.run(
        `INSERT OR REPLACE INTO tasks
           (id, title, description, has_mypal, has_smartsell, has_ai_demo, has_live_broadcast,
            status, rtm_filter, store_scope, start_at, pass_score,
            mypal_task_week, mypal_product_name, sub_tasks_config,
            ddl_at, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [t.id, t.title, t.description, t.has_mypal, t.has_smartsell, t.has_ai_demo, t.has_live_broadcast,
         t.status, t.rtm_filter || null, 'all', t.start_at, t.pass_score,
         t.mypal_task_week || null, t.mypal_product_name || null, t.sub_tasks_config || null,
         t.ddl_at, t.created_by, t.created_at, t.created_at]
      );
    }
    console.log(`  ✓ tasks: ${tasks.length} 条`);

    const defaultAutoNudgeRules = JSON.stringify({
      progressLag: { lifestyle: 3, mono: 1 },
      deadlineCrisis: { p0: 24, p1: 48, p2: 50 },
    });
    for (const t of tasks) {
      db.run('UPDATE tasks SET auto_nudge_rules = ? WHERE id = ?', [defaultAutoNudgeRules, t.id]);
    }

    for (const a of assignments) {
      db.run(
        `INSERT INTO task_assignments
           (id, task_id, user_id, store_id, status,
            mypal_completed, smartsell_completed, ai_demo_completed, live_broadcast_completed,
            progress, nudge_count, received_at, started_at, completed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [a.id, a.task_id, a.user_id, a.store_id, a.status,
         a.mypal_completed, a.smartsell_completed, a.ai_demo_completed, a.live_broadcast_completed,
         a.progress, a.nudge_count, a.received_at, a.started_at, a.completed_at, a.created_at, a.updated_at]
      );
    }
    console.log(`  ✓ task_assignments: ${assignments.length} 条`);

    for (const e of notifications) {
      db.run(
        `INSERT OR IGNORE INTO notification_events
           (id, task_id, assignment_id, target_user_id, store_id, event_type, severity, dedupe_key, content, initiator_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [e.id, e.task_id, e.assignment_id, e.target_user_id, e.store_id,
         e.event_type, e.severity, e.dedupe_key, e.content, e.initiator_id, e.created_at]
      );
    }
    console.log(`  ✓ notification_events: ${notifications.length} 条`);

    for (const r of readReceipts) {
      db.run(`INSERT INTO read_receipts (id, event_id, user_id, source, read_at) VALUES (?, ?, ?, ?, ?)`,
        [r.id, r.event_id, r.user_id, r.source, r.read_at]);
    }
    console.log(`  ✓ read_receipts: ${readReceipts.length} 条`);

    for (const r of mypalRows) {
      db.run(
        `INSERT OR REPLACE INTO mypal_learning_mock
           (seed_id, product_name, first_use_time, task_week, progress, passed_week, passed_time, required, week_start_time)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.seed_id, r.product_name, r.first_use_time, r.task_week, r.progress, r.passed_week, r.passed_time, r.required, r.week_start_time]
      );
    }
    console.log(`  ✓ mypal_learning_mock: ${mypalRows.length} 条`);
  });

  // ── users（bcrypt 在事务外）
  for (const u of users) {
    db.run(
      'INSERT OR IGNORE INTO users (username, password_hash, role, store_id, employee_id, executive_regions, executive_rtm) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [u.username, u.password_hash, u.role, u.store_id, u.employee_id, u.executive_regions ?? null, u.executive_rtm ?? null]
    );
    db.run(
      'UPDATE users SET executive_regions = ?, executive_rtm = ? WHERE username = ?',
      [u.executive_regions ?? null, u.executive_rtm ?? null, u.username]
    );
  }
  console.log(`  ✓ users: ${users.length} 条`);

  // ── 场景分布统计 ──────────────────────────────────────────────────────
  const journeyStats = {};
  for (const j of assignments) {
    const id = j._journey?.id || 'unknown';
    journeyStats[id] = (journeyStats[id] || 0) + 1;
  }
  console.log('\n── 场景分布 ────────────────────────────────────────');
  for (const [id, count] of Object.entries(journeyStats).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / assignments.length) * 100).toFixed(1);
    const desc = JOURNEYS.find(j => j.id === id);
    const statusLabel = desc ? `status=${desc.status}, nudges=${desc.nudges.length}` : '';
    console.log(`  ${id}: ${count} (${pct}%)  ${statusLabel}`);
  }

  console.log('\n── 测试账号 ──────────────────────────────────────');
  console.log('  central              / Train2026!  (总部看板)');
  console.log('  executive            / Train2026!  (Executive Chat — 全国)');
  console.log('  executive_east       / Train2026!  (Executive Chat — 华东大区)');
  console.log('  executive_north      / Train2026!  (Executive Chat — 华北+东北)');
  console.log('  executive_mono       / Train2026!  (Executive Chat — Monobrand渠道总监)');
  console.log('  admin                / Admin2026!  (Admin)');
  console.log('  emp_E001    / Train2026!  (上海环球港)');
  console.log('  emp_E091    / Train2026!  (哈尔滨中央大街店)');

  console.log('\n── 任务时间分布 ──────────────────────────────────');
  for (const t of tasks) {
    const ddlLabel = t.ddl_offset_days > 0 ? `${t.ddl_offset_days.toFixed(0)}天后到期` : `已过期${Math.abs(t.ddl_offset_days).toFixed(0)}天`;
    console.log(`  ${t.id}  ${t.title.padEnd(20, ' ')}  ${ddlLabel}  (时长${t.duration_days}天)`);
  }

  console.log('\n✅ Seed 完成');
  console.log(`💡 下次运行 SEED_DATE="YYYY-MM-DD" node db/seed.js 可指定任意时间锚点`);
}

seed().catch((err) => {
  console.error('❌ Seed 失败:', err);
  process.exit(1);
});
