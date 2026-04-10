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
 *   - 区域层：华东 > 华南 > 华北 > 华西 > 东北 梯度完成率
 *   - 门店层：优秀 / 良好 / 待改进 / 预警 四档
 *   - 个人层：10 种员工画像，体现完成速度 / 平台进度 / 催办次数差异
 *   - 任务层：Task A（已过期）/ Task B（临近截止）/ Task C（刚下发）三时段
 */

const bcrypt    = require('bcrypt');
const { nanoid } = require('nanoid');
const { db }    = require('./index');

const SALT_ROUNDS    = 10;
const DEFAULT_PASSWORD = 'Train2026!';
const ADMIN_PASSWORD   = 'Admin2026!';

// ─── 10 家门店定义 ─────────────────────────────────────────────────────────────
// archetype: excellent(优秀) | good(良好) | moderate(待改进) | warning(预警)
const STORE_DEFS = [
  // 华东 — 整体最优，1 优秀 + 1 良好
  { id: 'S001', name: '上海环球港旗舰店', region: '华东', city: '上海',   rtm: 'Monobrand',  format: 'MONO',         dealer_name: null,      archetype: 'excellent' },
  { id: 'S002', name: '南京新街口体验店', region: '华东', city: '南京',   rtm: 'Multibrand', format: 'Lifestyle',    dealer_name: '鼎盛科技',  archetype: 'good'      },
  // 华南 — 较优，2 良好
  { id: 'S003', name: '广州天河城旗舰店', region: '华南', city: '广州',   rtm: 'Monobrand',  format: 'MONO',         dealer_name: null,      archetype: 'good'      },
  { id: 'S004', name: '深圳万象城体验店', region: '华南', city: '深圳',   rtm: 'Multibrand', format: 'Lifestyle',    dealer_name: '华联商贸',  archetype: 'good'      },
  // 华北 — 中等，1 良好 + 1 待改进
  { id: 'S005', name: '北京三里屯旗舰店', region: '华北', city: '北京',   rtm: 'Monobrand',  format: 'MONO',         dealer_name: null,      archetype: 'good'      },
  { id: 'S006', name: '天津滨江道体验店', region: '华北', city: '天津',   rtm: 'Carrier',    format: 'Mass Merchant',dealer_name: '新时代电子', archetype: 'moderate'  },
  // 华西 — 偏低，1 待改进 + 1 预警
  { id: 'S007', name: '成都太古里旗舰店', region: '华西', city: '成都',   rtm: 'Monobrand',  format: 'MONO',         dealer_name: null,      archetype: 'moderate'  },
  { id: 'S008', name: '重庆观音桥体验店', region: '华西', city: '重庆',   rtm: 'Multibrand', format: 'Lifestyle',    dealer_name: '盛达通讯',  archetype: 'warning'   },
  // 东北 — 最低，1 待改进 + 1 预警
  { id: 'S009', name: '沈阳中街体验店',   region: '东北', city: '沈阳',   rtm: 'Carrier',    format: 'Mass Merchant',dealer_name: '新时代电子', archetype: 'moderate'  },
  { id: 'S010', name: '哈尔滨中央大街店', region: '东北', city: '哈尔滨', rtm: 'Education',  format: 'Campus',       dealer_name: null,      archetype: 'warning'   },
];

// ─── 3 个任务定义 ──────────────────────────────────────────────────────────────
// 基准日期：2026-04-11
//   Task A：ddl 已过（-21天），历史任务
//   Task B：ddl 临近（+7天），进行中有预警
//   Task C：ddl 宽裕（+30天），刚下发
const TASKS = [
  {
    id:          'TASK_A',
    title:       'iPhone 17 新品培训',
    description: 'iPhone 17 系列产品知识、卖点提炼与销售话术。截止日已过，提供历史对比数据。',
    has_mypal: 1, has_smartsell: 1, has_ai_demo: 1, has_live_broadcast: 0,
    status:    'dispatched',
    start_at:  '2026-03-01 09:00:00',
    ddl_at:    '2026-03-21 23:59:59',
    created_at:'2026-03-01 08:00:00',
    pass_score: 80,
    created_by: 'central',
  },
  {
    id:          'TASK_B',
    title:       'AirPods 新品培训',
    description: 'AirPods 4 全系产品知识，重点 ANC 卖点与 H2 芯片差异化话术。截止日临近。',
    has_mypal: 1, has_smartsell: 1, has_ai_demo: 0, has_live_broadcast: 1,
    status:    'dispatched',
    start_at:  '2026-03-20 09:00:00',
    ddl_at:    '2026-04-18 23:59:59',
    created_at:'2026-03-20 08:00:00',
    pass_score: 80,
    created_by: 'central',
  },
  {
    id:          'TASK_C',
    title:       'Mono 新春系列产品学习',
    description: 'Mono 新春限定系列配件产品知识培训，含礼盒搭配推荐与陈列规范。刚下发。',
    has_mypal: 1, has_smartsell: 0, has_ai_demo: 1, has_live_broadcast: 1,
    status:    'dispatched',
    start_at:  '2026-04-08 09:00:00',
    ddl_at:    '2026-05-11 23:59:59',
    created_at:'2026-04-08 08:00:00',
    pass_score: 80,
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
  ],
  good: [
    /* Task A */ ['completed','completed','completed','completed','completed','completed','completed','in_progress','in_progress','pending'   ],
    /* Task B */ ['completed','completed','completed','completed','completed','in_progress','in_progress','in_progress','pending',    'pending'   ],
    /* Task C */ ['completed','in_progress','in_progress','in_progress','pending',    'pending',    'pending',    'pending',    'pending',    'pending'   ],
  ],
  moderate: [
    /* Task A */ ['completed','completed','completed','completed','completed','in_progress','in_progress','in_progress','pending',    'pending'   ],
    /* Task B */ ['completed','completed','completed','in_progress','in_progress','in_progress','in_progress','pending',    'pending',    'pending'   ],
    /* Task C */ ['in_progress','in_progress','in_progress','pending',    'pending',    'pending',    'pending',    'pending',    'pending',    'pending'   ],
  ],
  warning: [
    /* Task A */ ['completed','completed','in_progress','in_progress','in_progress','pending',    'pending',    'pending',    'pending',    'pending'   ],
    /* Task B */ ['completed','in_progress','in_progress','in_progress','pending',    'pending',    'pending',    'pending',    'pending',    'pending'   ],
    /* Task C */ ['in_progress','in_progress','pending',    'pending',    'pending',    'pending',    'pending',    'pending',    'pending',    'pending'   ],
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
  return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

// 完成时距 ddl 的天数（按员工位次，越靠前完成越早）
const DAYS_BEFORE_DDL = [9, 7, 5, 4, 3, 2.5, 1.5, 1, 0.5, 0.2];

function getTimestamps(task, status, empIndex) {
  const startAtMs  = new Date(task.start_at.replace(' ', 'T') + 'Z').getTime();
  const ddlAtMs    = new Date(task.ddl_at.replace(' ', 'T') + 'Z').getTime();

  // received_at：任务下发后 0.5–2 天（按员工位次错开）
  const receivedMs = startAtMs + daysMs(0.5 + (empIndex % 4) * 0.4);

  if (status === 'pending') {
    return { received_at: toDbStr(receivedMs), started_at: null, completed_at: null };
  }

  // started_at：收到后 1–4 天
  const startedMs = receivedMs + daysMs(1 + (empIndex % 4));

  if (status === 'in_progress') {
    return { received_at: toDbStr(receivedMs), started_at: toDbStr(startedMs), completed_at: null };
  }

  // completed_at：ddl 前若干天（不得早于 started_at）
  const targetCompletedMs = ddlAtMs - daysMs(DAYS_BEFORE_DDL[empIndex] ?? 1);
  const completedMs = Math.max(startedMs + daysMs(0.5), targetCompletedMs);

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

      // nudge_count：滞后/未启动员工有催办记录；预警门店更多
      let nudge_count = 0;
      if (status === 'pending' && emp._empIndex >= 7) {
        nudge_count = emp._archetype === 'warning' ? 2 : 1;
      }
      if (status === 'in_progress' && emp._empIndex >= 6) {
        nudge_count = 1;
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

// ─── 生成 notification_events（task_assigned）────────────────────────────────
function generateNotifications(assignments) {
  return assignments.map(a => ({
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
}

// ─── 生成 MyPal learning mock（与原逻辑保持兼容）────────────────────────────
const MYPAL_PRODUCTS      = ['AirPods Max 2', 'AirPods Pro 2', 'Apple Watch Series 10', 'iPad 11 英寸'];
const MY_PAL_WEEK_PRIMARY = 'FY26Q2W1';
const MY_PAL_WEEK_SECONDARY = 'FY26Q2W2';

function pad2(n) { return String(n).padStart(2, '0'); }
function fmtUTC(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth()+1)}-${pad2(date.getUTCDate())} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`;
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
      passedTime        = fmtUTC(passedAt);
      const weekStartAt = new Date(passedAt.getTime() - 12 * 3600 * 1000);
      weekStartTime     = fmtUTC(weekStartAt);
      firstUseTime      = fmtUTC(new Date(weekStartAt.getTime() - 2 * 24 * 3600 * 1000));
    } else {
      const startedAt   = new Date(base.getTime() + idx * 3600 * 1000);
      const weekStartAt = new Date(startedAt.getTime() - 6 * 3600 * 1000);
      weekStartTime     = fmtUTC(weekStartAt);
      firstUseTime      = fmtUTC(new Date(weekStartAt.getTime() - 2 * 24 * 3600 * 1000));
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
    { username: 'central',   password_hash: defaultHash, role: 'central',   store_id: null, employee_id: null },
    { username: 'executive', password_hash: defaultHash, role: 'executive', store_id: null, employee_id: null },
    { username: 'admin',     password_hash: adminHash,   role: 'admin',     store_id: null, employee_id: null },
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
      'INSERT OR IGNORE INTO users (username, password_hash, role, store_id, employee_id) VALUES (?, ?, ?, ?, ?)',
      [u.username, u.password_hash, u.role, u.store_id, u.employee_id]
    );
  }
  console.log(`  ✓ users: ${users.length} 条`);

  console.log('\n✅ Seed 完成');
  console.log('\n── 测试账号 ──────────────────────────────────────');
  console.log('  central     / Train2026!  (总部看板)');
  console.log('  executive   / Train2026!  (Executive Chat)');
  console.log('  emp_E001    / Train2026!  (上海环球港，优秀门店，画像0：早鸟完成者)');
  console.log('  emp_E010    / Train2026!  (上海环球港，优秀门店，画像9：高风险待催办)');
  console.log('  emp_E091    / Train2026!  (哈尔滨中央大街店，预警门店)');
  console.log('  admin       / Admin2026!  (Admin)');
  console.log('\n── 门店档位 ──────────────────────────────────────');
  console.log('  S001 上海环球港旗舰店     → 优秀 (华东)  完成率 ~90%/80%');
  console.log('  S002 南京新街口体验店     → 良好 (华东)  完成率 ~70%/50%');
  console.log('  S003 广州天河城旗舰店     → 良好 (华南)  完成率 ~70%/50%');
  console.log('  S004 深圳万象城体验店     → 良好 (华南)  完成率 ~70%/50%');
  console.log('  S005 北京三里屯旗舰店     → 良好 (华北)  完成率 ~70%/50%');
  console.log('  S006 天津滨江道体验店     → 待改进 (华北) 完成率 ~50%/30%');
  console.log('  S007 成都太古里旗舰店     → 待改进 (华西) 完成率 ~50%/30%');
  console.log('  S008 重庆观音桥体验店     → 预警 (华西)  完成率 ~20%/10%');
  console.log('  S009 沈阳中街体验店       → 待改进 (东北) 完成率 ~50%/30%');
  console.log('  S010 哈尔滨中央大街门店   → 预警 (东北)  完成率 ~20%/10%');
}

seed().catch((err) => {
  console.error('❌ Seed 失败:', err);
  process.exit(1);
});
