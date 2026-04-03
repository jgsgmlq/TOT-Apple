'use strict';

/**
 * seed.js — 初始化 MVP mock 数据
 * 运行：node db/seed.js
 *
 * 数据规模：50 家门店，300 名员工，测试账号
 */

const bcrypt = require('bcrypt');
const { db } = require('./index');

const SALT_ROUNDS = 10;
const DEFAULT_PASSWORD = 'Train2026!';
const ADMIN_PASSWORD = 'Admin2026!';

// ─── 区域 / 城市 / RTM 枚举 ──────────────────────────────────────────────────

const REGIONS = ['华东', '华南', '华北', '华西', '东北'];
const CITIES = {
  华东: ['上海', '南京', '杭州', '苏州'],
  华南: ['广州', '深圳', '厦门', '佛山'],
  华北: ['北京', '天津', '石家庄', '济南'],
  华西: ['成都', '重庆', '西安', '昆明'],
  东北: ['沈阳', '长春', '哈尔滨', '大连'],
};
const RTMS = ['Monobrand', 'Multibrand', 'Carrier', 'Education', 'Enterprise'];
const FORMATS = ['MONO', 'Lifestyle', 'Mass Merchant', 'Operator', 'Campus'];
const DEALERS = ['鼎盛科技', '华联商贸', '新时代电子', '盛达通讯', null];
const ROLES_JOB = ['销售顾问', '高级销售顾问', '体验顾问', '产品专员'];

// ─── MyPal Mock（与 employees.email 对齐的 SEED ID）─────────────────────────────

const MYPAL_PRODUCTS = [
  'AirPods Max 2',
  'AirPods Pro 2',
  'Apple Watch Series 10',
  'iPad 11 英寸',
];

const MY_PAL_WEEK_PRIMARY = 'FY26Q2W1';
const MY_PAL_WEEK_SECONDARY = 'FY26Q2W2';

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatUTCDateTime(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ${pad2(date.getUTCHours())}:${pad2(
    date.getUTCMinutes()
  )}:${pad2(date.getUTCSeconds())}`;
}

function generateMypalLearningMockRows(employees) {
  // 统一使用 UTC 时间字符串，避免本地时区导致的格式漂移。
  const base = new Date('2026-04-01T00:00:00Z');

  const rows = [];

  employees.forEach((e, idx) => {
    const seedId = e.email.trim().toLowerCase();

    // 大部分数据落在主周次，少量在次周次，便于前端按 queryDate/taskWeek 拉取做对比。
    const taskWeek = idx % 20 === 0 ? MY_PAL_WEEK_SECONDARY : MY_PAL_WEEK_PRIMARY;

    // 通过 idx 命中不同场景桶，保证联调覆盖冷启动、进行中、通关态、必学/选学。
    const bucket = idx % 10;
    const required = idx % 3 === 0 ? 0 : 1; // 0=选学，1=必学

    let firstUseTime = null;
    let weekStartTime = null;
    let progress = 0;
    let passedWeek = null;
    let passedTime = null;

    if (bucket === 0) {
      // 从未登录系统
      progress = 0;
    } else if (bucket === 4) {
      // 已通关
      progress = 100;
      passedWeek = taskWeek;
      const passedAt = new Date(base.getTime() + idx * 3600 * 1000);
      passedTime = formatUTCDateTime(passedAt);
      const weekStartAt = new Date(passedAt.getTime() - 12 * 3600 * 1000);
      weekStartTime = formatUTCDateTime(weekStartAt);
      firstUseTime = formatUTCDateTime(new Date(weekStartAt.getTime() - 2 * 24 * 3600 * 1000));
    } else {
      // 已登录但未完成/进行中
      const startedAt = new Date(base.getTime() + idx * 3600 * 1000);
      const weekStartAt = new Date(startedAt.getTime() - 6 * 3600 * 1000);
      weekStartTime = formatUTCDateTime(weekStartAt);
      firstUseTime = formatUTCDateTime(new Date(weekStartAt.getTime() - 2 * 24 * 3600 * 1000));

      // 让 progress 在 [1,99] 内变化，避免全部落同一进度区间。
      const baseProgress = 10 + ((idx * 7) % 85); // 10-94
      progress = Math.min(99, baseProgress);
    }

    // 单人单产品：每位员工至少一条。
    const product1 = MYPAL_PRODUCTS[idx % MYPAL_PRODUCTS.length];
    rows.push({
      seed_id: seedId,
      product_name: product1,
      first_use_time: firstUseTime,
      task_week: taskWeek,
      progress,
      passed_week: passedWeek,
      passed_time: passedTime,
      required,
      week_start_time: weekStartTime,
    });

    // 少量人增加第二产品，覆盖“同人多产品”场景。
    if (idx % 7 === 0) {
      const product2 = MYPAL_PRODUCTS[(idx + 1) % MYPAL_PRODUCTS.length];
      const progress2 = progress === 100 ? 100 : Math.max(0, Math.min(99, progress - 10));

      rows.push({
        seed_id: seedId,
        product_name: product2,
        first_use_time: firstUseTime,
        task_week: taskWeek,
        progress: progress2,
        passed_week: progress2 === 100 ? taskWeek : null,
        passed_time: progress2 === 100 ? passedTime : null,
        required: required === 1 ? 1 : 0,
        week_start_time: progress2 === 0 ? null : weekStartTime,
      });
    }
  });

  return rows;
}

// ─── 生成 stores ─────────────────────────────────────────────────────────────

function generateStores() {
  const stores = [];
  for (let i = 1; i <= 50; i++) {
    const id = `S${String(i).padStart(3, '0')}`;
    const region = REGIONS[(i - 1) % REGIONS.length];
    const cities = CITIES[region];
    const city = cities[(i - 1) % cities.length];
    const rtm = RTMS[(i - 1) % RTMS.length];
    const format = FORMATS[(i - 1) % FORMATS.length];
    const dealer = DEALERS[(i - 1) % DEALERS.length];
    stores.push({
      id,
      name: `${city}${rtm}门店${String(i).padStart(2, '0')}`,
      region,
      city,
      rtm,
      format,
      dealer_name: dealer,
    });
  }
  return stores;
}

// ─── 生成 employees（每店 6 人）────────────────────────────

function generateEmployees(stores) {
  const employees = [];
  let empIdx = 1;
  for (const store of stores) {
    for (let j = 0; j < 6; j++) {
      const id = `E${String(empIdx).padStart(3, '0')}`;
      employees.push({
        id,
        store_id: store.id,
        name: `员工_${store.id}_${j + 1}`,
        role: ROLES_JOB[j % ROLES_JOB.length],
        // 与 MyPal 对齐用邮箱：种子环境固定域，生产由导入/API 写入真实邮箱
        email: `${id.toLowerCase()}@mypal.seed.local`,
      });
      empIdx++;
    }
  }
  return employees; // 50*6 = 300
}

// ─── 生成 users ───────────────────────────────────────────────────────────────

async function generateUsers(employees) {
  const defaultHash = await bcrypt.hash(DEFAULT_PASSWORD, SALT_ROUNDS);
  const adminHash = await bcrypt.hash(ADMIN_PASSWORD, SALT_ROUNDS);

  const users = [];

  // 系统账号
  users.push({ username: 'central',   password_hash: defaultHash, role: 'central',   store_id: null, employee_id: null });
  users.push({ username: 'executive', password_hash: defaultHash, role: 'executive', store_id: null, employee_id: null });
  users.push({ username: 'admin',     password_hash: adminHash,   role: 'admin',     store_id: null, employee_id: null });

  // 员工账号
  for (const emp of employees) {
    const role = 'employee';
    const username = `emp_${emp.id}`;
    users.push({
      username,
      password_hash: defaultHash,
      role,
      store_id: emp.store_id,
      employee_id: emp.id,
    });
  }

  return users;
}

// ─── 主函数 ──────────────────────────────────────────────────────────────────

async function seed() {
  console.log('🌱 开始写入 seed 数据...');

  const stores = generateStores();
  const employees = generateEmployees(stores);
  const users = await generateUsers(employees);
  const mypalRows = generateMypalLearningMockRows(employees);

  db.transaction(() => {
    // stores
    for (const s of stores) {
      db.run(
        'INSERT OR IGNORE INTO stores (id, name, region, city, rtm, format, dealer_name) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [s.id, s.name, s.region, s.city, s.rtm, s.format, s.dealer_name]
      );
    }
    console.log(`  ✓ stores: ${stores.length} 条`);

    // employees（INSERT OR IGNORE 后 UPDATE email，兼容已存在行补全邮箱）
    for (const e of employees) {
      db.run(
        'INSERT OR IGNORE INTO employees (id, store_id, name, role) VALUES (?, ?, ?, ?)',
        [e.id, e.store_id, e.name, e.role]
      );
      db.run('UPDATE employees SET email = ? WHERE id = ?', [e.email, e.id]);
    }
    console.log(`  ✓ employees: ${employees.length} 条`);

    // mypal_learning_mock（开发联调表）
    for (const r of mypalRows) {
      db.run(
        `INSERT OR REPLACE INTO mypal_learning_mock (
          seed_id,
          product_name,
          first_use_time,
          task_week,
          progress,
          passed_week,
          passed_time,
          required,
          week_start_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          r.seed_id,
          r.product_name,
          r.first_use_time,
          r.task_week,
          r.progress,
          r.passed_week,
          r.passed_time,
          r.required,
          r.week_start_time,
        ]
      );
    }
    console.log(`  ✓ mypal_learning_mock: ${mypalRows.length} 条`);
  });

  // users（含 bcrypt，不在事务内避免阻塞）
  for (const u of users) {
    db.run(
      'INSERT OR IGNORE INTO users (username, password_hash, role, store_id, employee_id) VALUES (?, ?, ?, ?, ?)',
      [u.username, u.password_hash, u.role, u.store_id, u.employee_id]
    );
  }
  console.log(`  ✓ users: ${users.length} 条`);

  console.log('✅ Seed 完成');
  console.log('\n测试账号：');
  console.log('  central     / Train2026!  (总部)');
  console.log('  emp_E001    / Train2026!  (S001 店员)');
  console.log('  executive   / Train2026!  (Executive)');
  console.log('  admin       / Admin2026!  (Admin)');
}

seed().catch((err) => {
  console.error('❌ Seed 失败:', err);
  process.exit(1);
});
