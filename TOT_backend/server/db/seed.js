'use strict';

/**
 * seed.js — 初始化 MVP mock 数据
 * 运行：node server/db/seed.js  （从仓库根目录执行）
 *       或 cd server && node db/seed.js
 *
 * 数据规模：10 家门店 / 100 名员工 / 3 个任务 / 300 条任务分配
 *
 * 重复执行 seed：会先按外键顺序清空任务/通知/聊天等依赖数据，再删除「不在本脚本
 * STORE_DEFS / generateEmployees() 里」的门店与员工，避免旧版 seed（如 50 店 300 人）残留。
 *
 * 差异化设计目标：
 *   - 渠道层：Monobrand > Multibrand > Carrier > Education 梯度完成率
 *   - 门店层：优秀 / 良好 / 待改进 / 预警 四档
 *   - 个人层：10 种员工画像，体现完成速度 / 平台进度 / 催办次数差异
 *   - 任务层：Task A（已过期）/ Task B（临近截止）/ Task C（刚下发）三时段
 */

const bcrypt    = require('bcrypt');
const { nanoid } = require('nanoid');
const { db }    = require('./index');
const { parseDateToSqliteLocal } = require('../utils/ddlAt');

const SALT_ROUNDS    = 10;
const DEFAULT_PASSWORD = 'Train2026!';
const ADMIN_PASSWORD   = 'Admin2026!';

// ─── 10 家门店定义 ─────────────────────────────────────────────────────────────
// archetype: excellent(优秀) | good(良好) | moderate(待改进) | warning(预警)
const STORE_DEFS = [
  // Monobrand — 整体最优，1 优秀 + 1 良好
  { id: 'S001', name: '上海环球港旗舰店', region: '', city: '上海',   rtm: 'Monobrand',  format: 'MONO',         dealer_name: '恒大通讯',  archetype: 'excellent' },
  { id: 'S002', name: '南京新街口体验店', region: '', city: '南京',   rtm: 'Multibrand', format: 'Lifestyle',    dealer_name: '鼎盛科技',  archetype: 'good'      },
  // Multibrand — 较优，2 良好
  { id: 'S003', name: '广州天河城旗舰店', region: '', city: '广州',   rtm: 'Monobrand',  format: 'MONO',         dealer_name: '远方科技',  archetype: 'good'      },
  { id: 'S004', name: '深圳万象城体验店', region: '', city: '深圳',   rtm: 'Multibrand', format: 'Lifestyle',    dealer_name: '华联商贸',  archetype: 'good'      },
  // Carrier & Education — 中等/待改进
  { id: 'S005', name: '北京三里屯旗舰店', region: '', city: '北京',   rtm: 'Monobrand',  format: 'MONO',         dealer_name: '创世商贸',  archetype: 'good'      },
  { id: 'S006', name: '天津滨江道体验店', region: '', city: '天津',   rtm: 'Carrier',    format: 'Mass Merchant',dealer_name: '新时代电子', archetype: 'moderate'  },
  { id: 'S007', name: '成都太古里旗舰店', region: '', city: '成都',   rtm: 'Monobrand',  format: 'MONO',         dealer_name: '蓝天数码',  archetype: 'moderate'  },
  { id: 'S008', name: '重庆观音桥体验店', region: '', city: '重庆',   rtm: 'Multibrand', format: 'Lifestyle',    dealer_name: '盛达通讯',  archetype: 'warning'   },
  { id: 'S009', name: '沈阳中街体验店',   region: '', city: '沈阳',   rtm: 'Carrier',    format: 'Mass Merchant',dealer_name: '新时代电子', archetype: 'moderate'  },
  { id: 'S010', name: '哈尔滨中央大街店', region: '', city: '哈尔滨', rtm: 'Education',  format: 'Campus',       dealer_name: '飞跃科技',  archetype: 'warning'   },
];

// ─── 3 个任务定义 ──────────────────────────────────────────────────────────────
// 基准日期：动态生成
//   Task A：ddl 较近（+1~3天），提供相对完整的进度数据
//   Task B：ddl 适中（+7~14天），进行中
//   Task C：ddl 宽裕（+20~30天），刚下发
const now = Date.now();
const daysToMs = (d) => d * 24 * 3600 * 1000;
const randomDays = (min, max) => min + Math.random() * (max - min);

const TASKS = [
  {
    id:          'TASK_A',
    title:       'iPhone 17 新品培训',
    description: 'iPhone 17 系列产品知识、卖点提炼与销售话术。前期下发任务，已逾期。',
    has_mypal: 1, has_smartsell: 1, has_ai_demo: 1, has_live_broadcast: 0,
    status:    'dispatched',
    start_at:  parseDateToSqliteLocal(new Date(now - daysToMs(randomDays(15, 20)))),
    ddl_at:    parseDateToSqliteLocal(new Date(now - daysToMs(randomDays(1, 3)))),
    created_at:parseDateToSqliteLocal(new Date(now - daysToMs(20))),
    pass_score: 80,
    created_by: 'central',
  },
  {
    id:          'TASK_B',
    title:       'AirPods 新品培训',
    description: 'AirPods 4 全系产品知识，重点 ANC 卖点与 H2 芯片差异化话术。正常进行中。',
    has_mypal: 1, has_smartsell: 1, has_ai_demo: 0, has_live_broadcast: 1,
    status:    'dispatched',
    start_at:  parseDateToSqliteLocal(new Date(now - daysToMs(randomDays(5, 10)))),
    ddl_at:    parseDateToSqliteLocal(new Date(now + daysToMs(randomDays(7, 14)))),
    created_at:parseDateToSqliteLocal(new Date(now - daysToMs(10))),
    pass_score: 80,
    created_by: 'central',
  },
  {
    id:          'TASK_C',
    title:       'Mono 新春系列产品学习',
    description: 'Mono 新春限定系列配件产品知识培训，含礼盒搭配推荐与陈列规范。刚下发，时间宽裕。',
    has_mypal: 1, has_smartsell: 0, has_ai_demo: 1, has_live_broadcast: 1,
    status:    'dispatched',
    start_at:  parseDateToSqliteLocal(new Date(now - daysToMs(randomDays(0, 2)))),
    ddl_at:    parseDateToSqliteLocal(new Date(now + daysToMs(randomDays(20, 30)))),
    created_at:parseDateToSqliteLocal(new Date(now - daysToMs(2))),
    pass_score: 80,
    created_by: 'central',
  },
  {
    id:          'TASK_WARN_START',
    title:       'MacBook 销售技巧培训',
    description: '测试起步异常预警，时间已过半。',
    has_mypal: 1, has_smartsell: 0, has_ai_demo: 1, has_live_broadcast: 0,
    status:    'dispatched',
    start_at:  parseDateToSqliteLocal(new Date(now - daysToMs(randomDays(4, 6)))),
    ddl_at:    parseDateToSqliteLocal(new Date(now + daysToMs(randomDays(3, 5)))),
    created_at:parseDateToSqliteLocal(new Date(now - daysToMs(6))),
    pass_score: 80,
    created_by: 'central',
  },
  {
    id:          'TASK_WARN_P1',
    title:       'iPad Pro 销售技巧培训',
    description: '测试P1临期预警，剩余时间小于48小时。',
    has_mypal: 1, has_smartsell: 1, has_ai_demo: 0, has_live_broadcast: 0,
    status:    'dispatched',
    start_at:  parseDateToSqliteLocal(new Date(now - daysToMs(randomDays(8, 12)))),
    ddl_at:    parseDateToSqliteLocal(new Date(now + daysToMs(randomDays(1.1, 1.9)))),
    created_at:parseDateToSqliteLocal(new Date(now - daysToMs(12))),
    pass_score: 80,
    created_by: 'central',
  },
  {
    id:          'TASK_WARN_P0',
    title:       'Apple Watch销售话术培训',
    description: '测试P0临期预警，剩余时间小于24小时。',
    has_mypal: 1, has_smartsell: 0, has_ai_demo: 0, has_live_broadcast: 1,
    status:    'dispatched',
    start_at:  parseDateToSqliteLocal(new Date(now - daysToMs(randomDays(8, 12)))),
    ddl_at:    parseDateToSqliteLocal(new Date(now + daysToMs(randomDays(0.1, 0.9)))),
    created_at:parseDateToSqliteLocal(new Date(now - daysToMs(12))),
    pass_score: 80,
    created_by: 'central',
  },
  {
    id:          'TASK_MYPAL_MAC_STUDIO',
    title:       'MAC Studio产品销售教学',
    description: 'MAC Studio 性能优势、目标客群画像与对比销售策略教学。单 MyPAL 平台任务。',
    has_mypal: 1, has_smartsell: 0, has_ai_demo: 0, has_live_broadcast: 0,
    status:    'dispatched',
    start_at:  parseDateToSqliteLocal(new Date(now - daysToMs(randomDays(5, 7)))),
    ddl_at:    parseDateToSqliteLocal(new Date(now + daysToMs(randomDays(5, 10)))),
    created_at:parseDateToSqliteLocal(new Date(now - daysToMs(7))),
    pass_score: 80,
    created_by: 'central',
  },
  {
    id:          'TASK_BUNDLE_VISION_PRO',
    title:       'Vision Pro介绍',
    description: '深入了解 Apple Vision Pro，涵盖空间计算、佩戴体验与核心应用。',
    has_mypal: 1, has_smartsell: 1, has_ai_demo: 1, has_live_broadcast: 0,
    status:    'dispatched',
    start_at:  parseDateToSqliteLocal(new Date(now - daysToMs(7))),
    ddl_at:    parseDateToSqliteLocal(new Date(now + daysToMs(7))),
    sub_tasks_config: '{"MyPAL":{"description":"Vision Pro 基础硬件参数与卖点学习。","deadline":"2026-05-05 20:32:30"},"SmartSell":{"description":"空间计算设备销售场景与话术演练。","deadline":"2026-04-29 20:32:30"},"AI Demo":{"description":"基于模拟顾客场景的 AI 角色对练考核。","deadline":"2026-05-03 20:32:30"}}',
    created_at:parseDateToSqliteLocal(new Date(now - daysToMs(8))),
    pass_score: 90,
    created_by: 'central',
  },
];

// ─── 员工姓名与职位池 ───────────────────────────────────────────────────────────
const EMP_SURNAMES = ['陈','张','王','李','赵','孙','周','吴','郑','林'];
const EMP_GIVEN    = ['伟','丽','强','明','佳','磊','萍','浩','敏','超'];
const ROLES_JOB    = [
  '高级销售顾问', '销售顾问',    '体验顾问',   '产品专员',
  '销售顾问',    '高级销售顾问', '销售顾问',   '体验顾问',
  '产品专员',    '销售顾问',
];

// ─── 档位 × 任务时段 × 员工位次 → 状态矩阵 ──────────────────────────────���──────
//
// 10 名员工 (emp 0-9)，在不同档位和任务时段下的完成状态
//
// 完成率目标（Task A / B / C）：
//   excellent → 90% / 80% / 20%
//   good      → 70% / 50% / 10%
//   moderate  → 50% / 30% /  0%
//   warning   → 20% / 10% /  0%
//
const ARCHETYPE_STATUS = {
  //                   emp:  0           1           2           3           4           5           6           7           8           9
  excellent: [
    /* Task A */ ['completed','completed','completed','completed','completed','completed','completed','completed','completed','in_progress'],
    /* Task B */ ['completed','completed','completed','completed','completed','completed','completed','completed','in_progress','in_progress'],
    /* Task C */ ['completed','completed','in_progress','in_progress','in_progress','in_progress','pending',    'pending',    'pending',    'pending'   ],
    /* Task Start */ ['completed','completed','in_progress','in_progress','pending',    'pending',    'pending',    'pending',    'pending',    'pending'   ],
    /* Task P1 */    ['completed','completed','completed','completed','in_progress','in_progress','pending',    'pending',    'pending',    'pending'   ],
    /* Task P0 */    ['completed','completed','completed','completed','completed','in_progress','in_progress','pending',    'pending',    'pending'   ],
    /* Task MacStudio */ ['completed','completed','completed','completed','completed','in_progress','in_progress','pending',    'pending',    'pending'   ],
    /* Task VisionPro */ ['completed','completed','completed','completed','completed','in_progress','in_progress','pending',    'pending',    'pending'   ],
  ],
  good: [
    /* Task A */ ['completed','completed','completed','completed','completed','completed','completed','in_progress','in_progress','pending'   ],
    /* Task B */ ['completed','completed','completed','completed','completed','in_progress','in_progress','in_progress','pending',    'pending'   ],
    /* Task C */ ['completed','in_progress','in_progress','in_progress','pending',    'pending',    'pending',    'pending',    'pending',    'pending'   ],
    /* Task Start */ ['completed','in_progress','pending',    'pending',    'pending',    'pending',    'pending',    'pending',    'pending',    'pending'   ],
    /* Task P1 */    ['completed','completed','completed','in_progress','in_progress','pending',    'pending',    'pending',    'pending',    'pending'   ],
    /* Task P0 */    ['completed','completed','completed','completed','in_progress','in_progress','pending',    'pending',    'pending',    'pending'   ],
    /* Task MacStudio */ ['completed','completed','completed','completed','in_progress','in_progress','pending',    'pending',    'pending',    'pending'   ],
    /* Task VisionPro */ ['completed','completed','completed','completed','in_progress','in_progress','pending',    'pending',    'pending',    'pending'   ],
  ],
  moderate: [
    /* Task A */ ['completed','completed','completed','completed','completed','in_progress','in_progress','in_progress','pending',    'pending'   ],
    /* Task B */ ['completed','completed','completed','in_progress','in_progress','in_progress','in_progress','pending',    'pending',    'pending'   ],
    /* Task C */ ['in_progress','in_progress','in_progress','pending',    'pending',    'pending',    'pending',    'pending',    'pending',    'pending'   ],
    /* Task Start */ ['in_progress','pending',    'pending',    'pending',    'pending',    'pending',    'pending',    'pending',    'pending',    'pending'   ],
    /* Task P1 */    ['completed','completed','in_progress','in_progress','pending',    'pending',    'pending',    'pending',    'pending',    'pending'   ],
    /* Task P0 */    ['completed','completed','completed','in_progress','in_progress','pending',    'pending',    'pending',    'pending',    'pending'   ],
    /* Task MacStudio */ ['completed','completed','completed','in_progress','in_progress','pending',    'pending',    'pending',    'pending',    'pending'   ],
    /* Task VisionPro */ ['completed','completed','completed','in_progress','in_progress','pending',    'pending',    'pending',    'pending',    'pending'   ],
  ],
  warning: [
    /* Task A */ ['completed','completed','in_progress','in_progress','in_progress','pending',    'pending',    'pending',    'pending',    'pending'   ],
    /* Task B */ ['completed','in_progress','in_progress','in_progress','pending',    'pending',    'pending',    'pending',    'pending',    'pending'   ],
    /* Task C */ ['in_progress','in_progress','pending',    'pending',    'pending',    'pending',    'pending',    'pending',    'pending',    'pending'   ],
    /* Task Start */ ['pending',    'pending',    'pending',    'pending',    'pending',    'pending',    'pending',    'pending',    'pending',    'pending'   ],
    /* Task P1 */    ['completed','in_progress','pending',    'pending',    'pending',    'pending',    'pending',    'pending',    'pending',    'pending'   ],
    /* Task P0 */    ['completed','completed','in_progress','pending',    'pending',    'pending',    'pending',    'pending',    'pending',    'pending'   ],
    /* Task MacStudio */ ['completed','completed','in_progress','pending',    'pending',    'pending',    'pending',    'pending',    'pending',    'pending'   ],
    /* Task VisionPro */ ['completed','completed','in_progress','pending',    'pending',    'pending',    'pending',    'pending',    'pending',    'pending'   ],
  ],
};

// ─── 平台完成情况 ──────────────────────────────────────────────────────────────
// in_progress 员工：empIndex 越小完成平台越多（刚进 in_progress 区间的更积极）
function getPlatformCompletion(task, status, empIndex) {
  if (status === 'completed') {
    return {
      mypal_completed:          task.has_mypal,
      smartsell_completed:      task.has_smartsell,
      ai_demo_completed:        task.has_ai_demo,
      live_broadcast_completed: task.has_live_broadcast,
      progress: 100,
    };
  }
  if (status === 'pending') {
    return { mypal_completed: 0, smartsell_completed: 0, ai_demo_completed: 0, live_broadcast_completed: 0, progress: 0 };
  }

  // in_progress：计算已启用平台列表
  const enabledPlatforms = [
    { key: 'mypal_completed',          enabled: task.has_mypal },
    { key: 'smartsell_completed',      enabled: task.has_smartsell },
    { key: 'ai_demo_completed',        enabled: task.has_ai_demo },
    { key: 'live_broadcast_completed', enabled: task.has_live_broadcast },
  ].filter(p => p.enabled);

  const total = enabledPlatforms.length;

  // empIndex 低（刚进 in_progress）→ 更多平台完成；empIndex 高 → 更少
  // 用 ceil(total * (1 - empIndex/10)) 估算完成平台数，至少 1 个，最多 total-1
  const donePlatforms = Math.min(total - 1, Math.max(1, Math.ceil(total * (1 - empIndex / 10))));

  const result = { mypal_completed: 0, smartsell_completed: 0, ai_demo_completed: 0, live_broadcast_completed: 0, progress: 0 };
  for (let i = 0; i < donePlatforms; i++) {
    result[enabledPlatforms[i].key] = 1;
  }
  result.progress = Math.round((donePlatforms / total) * 100);
  return result;
}

// ─── 时间戳生成 ────────────────────────────────────────────────────────────────
function daysMs(d) { return d * 24 * 3600 * 1000; }

function toDbStr(ms) {
  return parseDateToSqliteLocal(new Date(ms));
}

// 完成时距 ddl 的天数（按员工位次，越靠前完成越早）
const DAYS_BEFORE_DDL = [9, 7, 5, 4, 3, 2.5, 1.5, 1, 0.5, 0.2];

function getTimestamps(task, status, empIndex) {
  const startAtMs  = new Date(task.start_at).getTime();
  const ddlAtMs    = new Date(task.ddl_at).getTime();
  const now = Date.now();

  // received_at：任务下发后 0.5–2 天（按员工位次错开），不能超过当前时间
  const receivedMs = Math.min(startAtMs + daysMs(0.5 + (empIndex % 4) * 0.4), now - daysMs(1));

  if (status === 'pending') {
    // pending 状态下，有 30% 概率压根没点开阅读过（收到但没读）
    const actuallyReceived = Math.random() > 0.3 ? toDbStr(receivedMs) : null;
    return { received_at: actuallyReceived, started_at: null, completed_at: null };
  }

  // started_at：收到后 1–4 天，不能超过当前时间
  const startedMs = Math.min(receivedMs + daysMs(1 + (empIndex % 4)), now - daysMs(0.5));

  if (status === 'in_progress') {
    return { received_at: toDbStr(receivedMs), started_at: toDbStr(startedMs), completed_at: null };
  }

  // completed_at：合理分布在 startedMs 到 now 之间
  // 确保昨天和今天都有数据，这样 dashboard 的“较昨天”才会算出差值
  let completedMs;
  const timeSpan = now - startedMs;
  
  if (timeSpan < daysMs(1)) {
    completedMs = now - Math.random() * timeSpan;
  } else {
    // 按位次有规律分布：20%今天完成，30%昨天完成，其他更早完成
    if (empIndex % 5 === 0) {
      // 今天内完成
      completedMs = now - Math.random() * daysMs(0.8);
    } else if (empIndex % 5 === 1 || empIndex % 5 === 2) {
      // 昨天内完成
      completedMs = now - daysMs(1) - Math.random() * daysMs(0.8);
    } else {
      // 更早完成
      completedMs = startedMs + Math.random() * (timeSpan - daysMs(2));
      // 确保至少在 startedMs 之后
      if (completedMs < startedMs) completedMs = startedMs + daysMs(0.1);
    }
  }

  // 最终兜底：不能超过当前时间，且至少在开始之后
  completedMs = Math.min(completedMs, now);
  completedMs = Math.max(completedMs, startedMs + daysMs(0.1));

  return {
    received_at:  toDbStr(receivedMs),
    started_at:   toDbStr(startedMs),
    completed_at: toDbStr(completedMs),
  };
}

// ─── 生成 employees ───────────────────────────────────────────────────────────
function generateEmployees() {
  const employees = [];
  let seq = 1;
  for (const store of STORE_DEFS) {
    for (let j = 0; j < 10; j++) {
      const id = `E${String(seq).padStart(3, '0')}`;
      employees.push({
        id,
        store_id:   store.id,
        name:       `${store.city[0]}${EMP_SURNAMES[j]}${EMP_GIVEN[j]}`,
        role:       ROLES_JOB[j],
        email:      `${id.toLowerCase()}@mypal.seed.local`,
        _empIndex:  j,
        _archetype: store.archetype,
      });
      seq++;
    }
  }
  return employees;
}

// ─── 生成 task_assignments ────────────────────────────────────────────────────
function generateAssignments(employees) {
  const assignments = [];
  for (const task of TASKS) {
    const taskSlotIndex = TASKS.indexOf(task); // 0=A 1=B 2=C
    for (const emp of employees) {
      const status = ARCHETYPE_STATUS[emp._archetype][taskSlotIndex][emp._empIndex];
      const platforms   = getPlatformCompletion(task, status, emp._empIndex);
      const timestamps  = getTimestamps(task, status, emp._empIndex);

      // nudge_count：由后续真实的 autoNudge 引擎自动计算和累加，这里不再凭空捏造历史催办次数，保证数据一致性
      let nudge_count = 0;

      if (task.id === 'TASK_BUNDLE_VISION_PRO' && emp.id === 'emp_E001') {
        platforms.mypal_completed = 1;
        platforms.smartsell_completed = 0;
        platforms.ai_demo_completed = 0;
        platforms.progress = 33;
        status = 'in_progress';
      }
      assignments.push({
        id:          nanoid(),
        task_id:     task.id,
        user_id:     emp.id,
        store_id:    emp.store_id,
        status,
        ...platforms,
        nudge_count,
        ...timestamps,
        created_at:  task.start_at,
        updated_at:  timestamps.completed_at || timestamps.started_at || timestamps.received_at || task.start_at,
      });
    }
  }
  return assignments;
}

// ─── 生成 notification_events ────────────────────────────────
function generateNotifications(assignments) {
  const events = assignments.map(a => ({
    id:             nanoid(),
    task_id:        a.task_id,
    assignment_id:  a.id,
    target_user_id: a.user_id,
    store_id:       a.store_id,
    event_type:    'task_assigned',
    severity:       null,
    dedupe_key:    `assign_${a.task_id}_${a.user_id}`,
    content:        null,
    initiator_id:   null,
    created_at:     a.received_at || a.created_at,
  }));

  // 为了让预警漏斗符合绝对的物理时间逻辑，我们根据任务真实的 ddl_at 倒推他们经历过的预警。
  // 坚决杜绝“明明距离截止还有3天，却收到了48小时临期预警”的穿越 Bug。
  const now = Date.now();
  const minuteMs = 60 * 1000;

  for (const a of assignments) {
    const t = TASKS.find(t => t.id === a.task_id);
    const ddlMs = new Date(t.ddl_at).getTime();
    const createdMs = new Date(t.created_at).getTime();
    const receivedMs = a.received_at ? new Date(a.received_at).getTime() : null;
    const completedMs = a.completed_at ? new Date(a.completed_at).getTime() : null;
    const hoursLeft = (ddlMs - now) / 3600000;
    const passedPct = (now - createdMs) / (ddlMs - createdMs) * 100;
    const p2BaseMs = createdMs + (ddlMs - createdMs) * 0.5;
    const p1BaseMs = ddlMs - 48 * 3600000;

    const pushHistoricalNudge = (eventType, severity, dedupeRule, content, rawAtMs) => {
      if (!Number.isFinite(rawAtMs)) return null;
      let nudgeAtMs = rawAtMs;

      // 不能早于用户真正收到任务；否则会出现“未触达先预警”的伪数据。
      if (Number.isFinite(receivedMs)) {
        nudgeAtMs = Math.max(nudgeAtMs, receivedMs + minuteMs);
      }
      // 历史事件不能发生在未来。
      nudgeAtMs = Math.min(nudgeAtMs, now - minuteMs);
      // 已完成用户必须满足“先催后完”。
      if (Number.isFinite(completedMs)) {
        nudgeAtMs = Math.min(nudgeAtMs, completedMs - minuteMs);
      }

      // 最终仍无法满足时间顺序则放弃造这条事件。
      if (!Number.isFinite(nudgeAtMs)) return null;
      if (Number.isFinite(receivedMs) && nudgeAtMs <= receivedMs) return null;
      if (Number.isFinite(completedMs) && nudgeAtMs >= completedMs) return null;
      if (nudgeAtMs <= createdMs) return null;

      events.push({
        id: nanoid(),
        task_id: a.task_id,
        assignment_id: a.id,
        target_user_id: a.user_id,
        store_id: a.store_id,
        event_type: eventType,
        severity,
        dedupe_key: `autonudge:${dedupeRule}:${a.id}`,
        content,
        initiator_id: null,
        created_at: toDbStr(nudgeAtMs),
      });
      a.nudge_count += 1;
      return nudgeAtMs;
    };

    if (a.status === 'completed') {
      // 已完成的人仅补“可证明发生在完成之前”的历史 P2，避免先完成后催办。
      if (passedPct >= 50 && Math.random() < 0.3) {
        pushHistoricalNudge('nudge_yellow', 'yellow', 'deadlineCrisisP2', '历史P2催办', p2BaseMs);
      }
    } else {
      // 未完成的人，必定处于现阶段的某个状态。
      // 对于他们“已经经历过”的时间节点，我们补齐历史记录，支撑漏斗图显示。
      // 当前的最高状态，我们留给后面的 autoNudge 引擎去真实触发，不在这里预写。

      // 如果现在距离截止不足 48 小时（意味着目前处于 P1 或 P0），那他历史必然触发过 P2（时间过半）。
      let p2CreatedAtMs = null;
      if (hoursLeft <= 48) {
        p2CreatedAtMs = pushHistoricalNudge('nudge_yellow', 'yellow', 'deadlineCrisisP2', '历史P2催办', p2BaseMs);
      }

      // 如果现在距离截止不足 24 小时（意味着目前处于 P0），那他历史必然触发过 P1（48小时预警）。
      if (hoursLeft <= 24) {
        // P1 时间不得早于已生成的 P2，保证预警等级时序单调递进。
        const p1AtMs = Number.isFinite(p2CreatedAtMs) ? Math.max(p1BaseMs, p2CreatedAtMs + minuteMs) : p1BaseMs;
        pushHistoricalNudge('nudge_orange', 'orange', 'deadlineCrisisP1', '历史P1催办', p1AtMs);
      }
    }
  }

  return events;
}

// ─── 生成 read_receipts ──────────────────────────────────────
function generateReadReceipts(notifications, assignments) {
  const receipts = [];
  notifications.forEach(n => {
    // 只有推送类通知且具有 task_id 的才生成回执
    if (n.event_type === 'task_assigned' && n.task_id) {
      // 找到这个人对应的 task_assignment
      const a = assignments.find(x => x.task_id === n.task_id && x.user_id === n.target_user_id);
      // 如果分配记录里有 received_at (或者是 in_progress/completed 状态必然有)，说明他确实点开了任务
      if (a && a.received_at) {
        receipts.push({
          id:         nanoid(),
          event_id:   n.id,
          user_id:    n.target_user_id,
          source:     'task_detail_open',
          read_at:    a.received_at // 保持时间戳绝对对齐
        });
      }
    }
  });
  return receipts;
}

// ─── 生成 MyPal learning mock（与原逻辑保持兼容）────────────────────────────
const MYPAL_PRODUCTS      = ['AirPods Max 2', 'AirPods Pro 2', 'Apple Watch Series 10', 'iPad 11 英寸'];
const MY_PAL_WEEK_PRIMARY = 'FY26Q2W1';
const MY_PAL_WEEK_SECONDARY = 'FY26Q2W2';

function pad2(n) { return String(n).padStart(2, '0'); }
function fmtLocal(date) {
  return parseDateToSqliteLocal(date);
}

function generateMypalRows(employees) {
  const base = new Date('2026-04-01T00:00:00Z');
  const rows = [];
  employees.forEach((e, idx) => {
    const seedId   = e.email.trim().toLowerCase();
    const taskWeek = idx % 20 === 0 ? MY_PAL_WEEK_SECONDARY : MY_PAL_WEEK_PRIMARY;
    const bucket   = idx % 10;
    const required = idx % 3 === 0 ? 0 : 1;

    let firstUseTime = null, weekStartTime = null, progress = 0, passedWeek = null, passedTime = null;

    if (bucket === 0) {
      progress = 0;
    } else if (bucket === 4) {
      progress    = 100;
      passedWeek  = taskWeek;
      const passedAt    = new Date(base.getTime() + idx * 3600 * 1000);
      passedTime        = fmtLocal(passedAt);
      const weekStartAt = new Date(passedAt.getTime() - 12 * 3600 * 1000);
      weekStartTime     = fmtLocal(weekStartAt);
      firstUseTime      = fmtLocal(new Date(weekStartAt.getTime() - 2 * 24 * 3600 * 1000));
    } else {
      const startedAt   = new Date(base.getTime() + idx * 3600 * 1000);
      const weekStartAt = new Date(startedAt.getTime() - 6 * 3600 * 1000);
      weekStartTime     = fmtLocal(weekStartAt);
      firstUseTime      = fmtLocal(new Date(weekStartAt.getTime() - 2 * 24 * 3600 * 1000));
      progress          = Math.min(99, 10 + (idx * 7) % 85);
    }

    const product1 = MYPAL_PRODUCTS[idx % MYPAL_PRODUCTS.length];
    rows.push({ seed_id: seedId, product_name: product1, first_use_time: firstUseTime, task_week: taskWeek, progress, passed_week: passedWeek, passed_time: passedTime, required, week_start_time: weekStartTime });

    if (idx % 7 === 0) {
      const product2   = MYPAL_PRODUCTS[(idx + 1) % MYPAL_PRODUCTS.length];
      const progress2  = progress === 100 ? 100 : Math.max(0, Math.min(99, progress - 10));
      rows.push({ seed_id: seedId, product_name: product2, first_use_time: firstUseTime, task_week: taskWeek, progress: progress2, passed_week: progress2 === 100 ? taskWeek : null, passed_time: progress2 === 100 ? passedTime : null, required: required === 1 ? 1 : 0, week_start_time: progress2 === 0 ? null : weekStartTime });
    }
  });
  return rows;
}

// ─── 生成 users ───────────────────────────────────────────────────────────────
async function generateUsers(employees) {
  const defaultHash = await bcrypt.hash(DEFAULT_PASSWORD, SALT_ROUNDS);
  const adminHash   = await bcrypt.hash(ADMIN_PASSWORD, SALT_ROUNDS);
  const users = [
    { username: 'central',            password_hash: defaultHash, role: 'central',   store_id: null, employee_id: null, executive_regions: null,          executive_rtm: null },
    { username: 'executive',          password_hash: defaultHash, role: 'executive', store_id: null, employee_id: null, executive_regions: null,          executive_rtm: null },
    { username: 'executive_mono',     password_hash: defaultHash, role: 'executive', store_id: null, employee_id: null, executive_regions: null,          executive_rtm: 'Monobrand' },
    { username: 'admin',              password_hash: adminHash,   role: 'admin',     store_id: null, employee_id: null, executive_regions: null,          executive_rtm: null },
  ];
  for (const emp of employees) {
    users.push({ username: `emp_${emp.id}`, password_hash: defaultHash, role: 'employee', store_id: emp.store_id, employee_id: emp.id });
  }
  return users;
}

// ─── 主函数 ───────────────────────────────────────────────────────────────────
async function seed() {
  console.log('🌱 开始写入 seed 数据...');

  const employees     = generateEmployees();
  const users         = await generateUsers(employees);
  const assignments   = generateAssignments(employees);
  const notifications = generateNotifications(assignments);
  const readReceipts  = generateReadReceipts(notifications, assignments);
  const mypalRows     = generateMypalRows(employees);

  db.transaction(() => {
    const seedStoreIds = STORE_DEFS.map((s) => s.id);
    const seedTaskIds  = TASKS.map((t) => t.id);
    const phStores     = seedStoreIds.map(() => '?').join(',');
    const phTasks      = seedTaskIds.map(() => '?').join(',');

    // ── 开发环境：与当前 seed 定义对齐（去掉历史多出来的门店/员工/任务）
    // 子表 → 非本批 users → employees → stores → 非本批 tasks
    db.run('DELETE FROM read_receipts');
    db.run('DELETE FROM notification_events');
    db.run('DELETE FROM nudge_records');
    db.run('DELETE FROM task_assignments');
    db.run('DELETE FROM chat_message_feedback');
    db.run('DELETE FROM chat_messages');
    db.run('DELETE FROM chat_sessions');
    db.run('DELETE FROM mypal_learning_mock');
    db.run(`DELETE FROM tasks WHERE id NOT IN (${phTasks})`, seedTaskIds);
    // 先删所有店员账号再删 employees，否则 users.employee_id 会阻止 DELETE employees
    db.run('DELETE FROM users WHERE employee_id IS NOT NULL');
    db.run('DELETE FROM employees');
    db.run(
      `UPDATE users SET store_id = NULL WHERE store_id IS NOT NULL AND store_id NOT IN (${phStores})`,
      seedStoreIds
    );
    db.run(`DELETE FROM stores WHERE id NOT IN (${phStores})`, seedStoreIds);

    // ── stores（ON CONFLICT DO UPDATE）
    for (const { archetype: _a, ...s } of STORE_DEFS) {
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

    // ── employees
    for (const e of employees) {
      db.run('INSERT OR IGNORE INTO employees (id, store_id, name, role) VALUES (?, ?, ?, ?)', [e.id, e.store_id, e.name, e.role]);
      db.run('UPDATE employees SET email = ? WHERE id = ?', [e.email, e.id]);
    }
    console.log(`  ✓ employees: ${employees.length} 条`);

    // ── tasks（上已清空 assignments / notifications，可安全 REPLACE）
    for (const t of TASKS) {
      db.run(
        `INSERT OR REPLACE INTO tasks
           (id, title, description, has_mypal, has_smartsell, has_ai_demo, has_live_broadcast,
            status, rtm_filter, store_scope, start_at, pass_score, ddl_at, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [t.id, t.title, t.description, t.has_mypal, t.has_smartsell, t.has_ai_demo, t.has_live_broadcast,
         t.status, null, 'all', t.start_at, t.pass_score, t.ddl_at, t.created_by, t.created_at, t.created_at]
      );
    }
    console.log(`  ✓ tasks: ${TASKS.length} 条`);

    // 与 API 示例一致：下发任务默认带 auto_nudge_rules（含 deadlineCrisis），便于看板 / 自动预警联调
    const defaultAutoNudgeRules = JSON.stringify({
      progressLag: { lifestyle: 3, mono: 1 },
      deadlineCrisis: { p0: 24, p1: 48, p2: 50 },
      deadlineCrisis: { p0: 24, p1: 48 },
    });
    for (const t of TASKS) {
      db.run('UPDATE tasks SET auto_nudge_rules = ? WHERE id = ?', [defaultAutoNudgeRules, t.id]);
    }

    // ── task_assignments
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

    // ── notification_events
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

    // ── read_receipts
    for (const r of readReceipts) {
      db.run(
        `INSERT INTO read_receipts (id, event_id, user_id, source, read_at)
         VALUES (?, ?, ?, ?, ?)`,
        [r.id, r.event_id, r.user_id, r.source, r.read_at]
      );
    }
    console.log(`  ✓ read_receipts: ${readReceipts.length} 条`);

    // ── mypal_learning_mock
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

  console.log('⏳ 正在触发自动预警 (Auto Nudges)...');
  const { evaluateAndTriggerAutoNudges } = require('../services/autoNudge');
  for (const t of TASKS) {
    if (t.status === 'dispatched') {
      await evaluateAndTriggerAutoNudges(t.id);
    }
  }
  // 等待异步自动催办落地
  await new Promise(resolve => setTimeout(resolve, 2000));
  console.log('  ✓ 自动预警数据已生成');

  console.log('\n✅ Seed 完成');
  console.log('\n── 测试账号 ──────────────────────────────────────');
  console.log('  central              / Train2026!  (总部看板)');
  console.log('  executive            / Train2026!  (Executive Chat — 全国)');
  console.log('  executive_mono       / Train2026!  (Executive Chat — Monobrand渠道总监)');
  console.log('  emp_E001    / Train2026!  (上海环球港，优秀门店，画像0：早鸟完成者)');
  console.log('  emp_E010    / Train2026!  (上海环球港，优秀门店，画像9：高风险待催办)');
  console.log('  emp_E091    / Train2026!  (哈尔滨中央大街店，预警门店)');
  console.log('  admin       / Admin2026!  (Admin)');
  console.log('\n── 门店档位 ──────────────────────────────────────');
  console.log('  S001 上海环球港旗舰店     → 优秀 (Monobrand)  完成率 ~90%/80%');
  console.log('  S002 南京新街口体验店     → 良好 (Multibrand) 完成率 ~70%/50%');
  console.log('  S003 广州天河城旗舰店     → 良好 (Monobrand)  完成率 ~70%/50%');
  console.log('  S004 深圳万象城体验店     → 良好 (Multibrand) 完成率 ~70%/50%');
  console.log('  S005 北京三里屯旗舰店     → 良好 (Monobrand)  完成率 ~70%/50%');
  console.log('  S006 天津滨江道体验店     → 待改进 (Carrier)   完成率 ~50%/30%');
  console.log('  S007 成都太古里旗舰店     → 待改进 (Monobrand) 完成率 ~50%/30%');
  console.log('  S008 重庆观音桥体验店     → 预警 (Multibrand) 完成率 ~20%/10%');
  console.log('  S009 沈阳中街体验店       → 待改进 (Carrier)   完成率 ~50%/30%');
  console.log('  S010 哈尔滨中央大街门店   → 预警 (Education)  完成率 ~20%/10%');
}

seed().catch((err) => {
  console.error('❌ Seed 失败:', err);
  process.exit(1);
});
