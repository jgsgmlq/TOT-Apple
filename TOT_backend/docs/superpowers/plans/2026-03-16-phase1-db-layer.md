# Phase 1: DB Layer Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 SQLite 替换 `state.json`，建立完整数据库 Schema 并 seed 捏造数据（50店/300人/352账号），同时保持现有 `/api/state`、`/api/events`、WebSocket 行为完全不变。

**Architecture:** 新增 `server/db.js` 初始化 SQLite 数据库并建表；新增 `server/seed.js` 写入捏造数据；修改 `server/index.js` 将 events 读写从 state.json 迁移到 SQLite。所有改动仅在后端，前端零改动。

**Tech Stack:** Node.js, Express（现有）, better-sqlite3, bcryptjs

---

## Chunk 1: 环境准备与数据库初始化

### Task 1: 安装依赖

**Files:**
- Modify: `server/package.json`

- [ ] **Step 1: 安装新依赖**

```bash
cd /Users/skyler/Desktop/MVP/server
npm install better-sqlite3 bcryptjs
```

Expected output: 包含 `added N packages` 的成功信息，无报错。

- [ ] **Step 2: 确认 package.json 已更新**

```bash
cat package.json
```

Expected: `dependencies` 中包含 `better-sqlite3` 和 `bcryptjs`。

- [ ] **Step 3: 将 database.db 加入 .gitignore**

在 `server/` 目录下创建或追加 `.gitignore`：

```bash
echo "database.db" >> /Users/skyler/Desktop/MVP/server/.gitignore
echo "node_modules/" >> /Users/skyler/Desktop/MVP/server/.gitignore
```

- [ ] **Step 4: Commit**

```bash
cd /Users/skyler/Desktop/MVP
git add server/package.json server/package-lock.json server/.gitignore
git commit -m "chore: add better-sqlite3 and bcryptjs dependencies"
```

---

### Task 2: 创建 db.js — 数据库初始化与建表

**Files:**
- Create: `server/db.js`

- [ ] **Step 1: 创建 db.js**

```javascript
// server/db.js
// 职责：初始化 SQLite 数据库，建表，导出 db 实例供其他模块使用
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'database.db');
const db = new Database(DB_PATH);

// 开启 WAL 模式提升并发读性能
db.pragma('journal_mode = WAL');
// 注意：SQLite 默认不强制检查外键约束。Phase 1 可接受此行为。
// 如需强制开启，可在此处加 db.pragma('foreign_keys = ON')，但需确保数据 seed 顺序一致。

db.exec(`
  CREATE TABLE IF NOT EXISTS stores (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    region     TEXT NOT NULL,
    rtm        TEXT NOT NULL,
    city       TEXT NOT NULL,
    rank       INTEGER,
    risk_level TEXT DEFAULT 'low'
  );
  CREATE INDEX IF NOT EXISTS idx_stores_region ON stores(region);
  CREATE INDEX IF NOT EXISTS idx_stores_rtm ON stores(rtm);

  CREATE TABLE IF NOT EXISTS employees (
    id           TEXT PRIMARY KEY,
    store_id     TEXT NOT NULL REFERENCES stores(id),
    name         TEXT NOT NULL,
    role         TEXT NOT NULL,
    is_manager   INTEGER DEFAULT 0,
    sc_modules   INTEGER DEFAULT 0,
    sc_test      INTEGER DEFAULT 0,
    live_watched INTEGER DEFAULT 0,
    mypal_days   INTEGER DEFAULT 0,
    ai_coach     INTEGER DEFAULT 0,
    risk_level   TEXT DEFAULT 'normal',
    last_active  TEXT,
    created_at   TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_employees_store_id ON employees(store_id);
  CREATE INDEX IF NOT EXISTS idx_employees_risk_level ON employees(risk_level);

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL,
    store_id      TEXT REFERENCES stores(id),
    employee_id   TEXT REFERENCES employees(id),
    created_at    TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS events (
    id      TEXT PRIMARY KEY,
    type    TEXT NOT NULL,
    "from"  TEXT NOT NULL,
    payload TEXT DEFAULT '{}',
    at      TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    status      TEXT DEFAULT 'active',
    deadline    TEXT,
    target_role TEXT DEFAULT 'all',
    store_scope TEXT DEFAULT 'all',
    created_by  TEXT,
    config_json TEXT DEFAULT '{}',
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id                TEXT PRIMARY KEY,
    level             TEXT NOT NULL,
    store_id          TEXT NOT NULL REFERENCES stores(id),
    employee_id       TEXT REFERENCES employees(id),
    trigger_desc      TEXT,
    root_cause        TEXT,
    suggestions_json  TEXT DEFAULT '[]',
    status            TEXT DEFAULT 'pending',
    acknowledged_by   TEXT,
    acknowledged_at   TEXT,
    intervention_json TEXT DEFAULT '{}',
    created_at        TEXT DEFAULT (datetime('now')),
    CHECK (store_id IS NOT NULL)
  );
  CREATE INDEX IF NOT EXISTS idx_alerts_store_id ON alerts(store_id);
  CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);

  CREATE TABLE IF NOT EXISTS intel_submissions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    type         TEXT NOT NULL,
    task_id      TEXT,
    employee_id  TEXT REFERENCES employees(id),
    store_id     TEXT REFERENCES stores(id),
    content      TEXT,
    urgent       INTEGER DEFAULT 0,
    submitted_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_intel_store_id ON intel_submissions(store_id);
  CREATE INDEX IF NOT EXISTS idx_intel_type ON intel_submissions(type);
`);

module.exports = db;
```

- [ ] **Step 2: 验证建表成功**

```bash
cd /Users/skyler/Desktop/MVP/server && node -e "const db = require('./db'); console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all())"
```

Expected output（顺序无关）:
```
[
  { name: 'stores' },
  { name: 'employees' },
  { name: 'users' },
  { name: 'events' },
  { name: 'tasks' },
  { name: 'alerts' },
  { name: 'intel_submissions' }
]
```

- [ ] **Step 3: Commit**

```bash
cd /Users/skyler/Desktop/MVP
git add server/db.js
git commit -m "feat: add SQLite schema with all tables and indexes"
```

---

## Chunk 2: Seed 数据

### Task 3: 创建 seed.js — 生成捏造数据

**Files:**
- Create: `server/seed.js`

> **注意：** seed 数据为固定捏造数据，不使用 `Math.random()`，每次运行结果相同，保证演示稳定性。员工进度数据按门店风险等级（low/medium/high）分层预设。

- [ ] **Step 1: 创建 seed.js**

```javascript
// server/seed.js
// 职责：清空并重新填充所有演示数据（50店/300员工/352账号）
// 运行：node seed.js
// 注意：每次运行会清空现有数据

const db = require('./db');
const bcrypt = require('bcryptjs');

// ── 常量 ──────────────────────────────────────────────────────
const DEFAULT_PASSWORD_HASH = bcrypt.hashSync('Train2026!', 10);
const ADMIN_PASSWORD_HASH   = bcrypt.hashSync('Admin2026!', 10);

const STORES = [
  { id:'S001', name:'朝阳大悦城店',     region:'华北区', rtm:'CS', city:'北京',    rank:1,  risk_level:'low' },
  { id:'S002', name:'西单大悦城店',     region:'华北区', rtm:'CS', city:'北京',    rank:3,  risk_level:'low' },
  { id:'S003', name:'天津滨海万象城店', region:'华北区', rtm:'MS', city:'天津',    rank:12, risk_level:'medium' },
  { id:'S004', name:'石家庄北国商城店', region:'华北区', rtm:'DS', city:'石家庄',  rank:28, risk_level:'high' },
  { id:'S005', name:'北京国贸商城店',   region:'华北区', rtm:'CS', city:'北京',    rank:5,  risk_level:'low' },
  { id:'S006', name:'王府井百货店',     region:'华北区', rtm:'CS', city:'北京',    rank:8,  risk_level:'medium' },
  { id:'S007', name:'天津万达广场店',   region:'华北区', rtm:'MS', city:'天津',    rank:15, risk_level:'medium' },
  { id:'S008', name:'保定万博广场店',   region:'华北区', rtm:'DS', city:'保定',    rank:35, risk_level:'high' },
  { id:'S009', name:'唐山吾悦广场店',   region:'华北区', rtm:'DS', city:'唐山',    rank:42, risk_level:'high' },
  { id:'S010', name:'北京中关村店',     region:'华北区', rtm:'CS', city:'北京',    rank:2,  risk_level:'low' },
  { id:'S011', name:'上海南京东路旗舰店', region:'华东区', rtm:'CS', city:'上海',  rank:4,  risk_level:'low' },
  { id:'S012', name:'上海徐家汇店',     region:'华东区', rtm:'CS', city:'上海',    rank:6,  risk_level:'low' },
  { id:'S013', name:'杭州西湖银泰店',   region:'华东区', rtm:'CS', city:'杭州',    rank:9,  risk_level:'low' },
  { id:'S014', name:'南京德基广场店',   region:'华东区', rtm:'CS', city:'南京',    rank:11, risk_level:'medium' },
  { id:'S015', name:'苏州圆融广场店',   region:'华东区', rtm:'MS', city:'苏州',    rank:18, risk_level:'medium' },
  { id:'S016', name:'无锡恒隆广场店',   region:'华东区', rtm:'MS', city:'无锡',    rank:22, risk_level:'medium' },
  { id:'S017', name:'宁波天一广场店',   region:'华东区', rtm:'MS', city:'宁波',    rank:25, risk_level:'high' },
  { id:'S018', name:'温州万象城店',     region:'华东区', rtm:'DS', city:'温州',    rank:38, risk_level:'high' },
  { id:'S019', name:'合肥万达广场店',   region:'华东区', rtm:'DS', city:'合肥',    rank:40, risk_level:'high' },
  { id:'S020', name:'济南泉城路店',     region:'华东区', rtm:'DS', city:'济南',    rank:44, risk_level:'high' },
  { id:'S021', name:'广州天河城旗舰店', region:'华南区', rtm:'CS', city:'广州',    rank:7,  risk_level:'low' },
  { id:'S022', name:'深圳万象城店',     region:'华南区', rtm:'CS', city:'深圳',    rank:10, risk_level:'low' },
  { id:'S023', name:'广州正佳广场店',   region:'华南区', rtm:'CS', city:'广州',    rank:14, risk_level:'medium' },
  { id:'S024', name:'深圳益田假日广场', region:'华南区', rtm:'MS', city:'深圳',    rank:17, risk_level:'medium' },
  { id:'S025', name:'珠海华发商都店',   region:'华南区', rtm:'MS', city:'珠海',    rank:20, risk_level:'medium' },
  { id:'S026', name:'佛山万达广场店',   region:'华南区', rtm:'MS', city:'佛山',    rank:26, risk_level:'high' },
  { id:'S027', name:'东莞华南Mall店',   region:'华南区', rtm:'DS', city:'东莞',    rank:33, risk_level:'high' },
  { id:'S028', name:'汕头中骏广场店',   region:'华南区', rtm:'DS', city:'汕头',    rank:41, risk_level:'high' },
  { id:'S029', name:'惠州华贸中心店',   region:'华南区', rtm:'DS', city:'惠州',    rank:45, risk_level:'high' },
  { id:'S030', name:'厦门中华城店',     region:'华南区', rtm:'MS', city:'厦门',    rank:16, risk_level:'medium' },
  { id:'S031', name:'武汉武广店',       region:'华中区', rtm:'CS', city:'武汉',    rank:13, risk_level:'medium' },
  { id:'S032', name:'郑州大卫城店',     region:'华中区', rtm:'CS', city:'郑州',    rank:19, risk_level:'medium' },
  { id:'S033', name:'长沙国金中心店',   region:'华中区', rtm:'CS', city:'长沙',    rank:21, risk_level:'medium' },
  { id:'S034', name:'武汉楚河汉街店',   region:'华中区', rtm:'MS', city:'武汉',    rank:24, risk_level:'medium' },
  { id:'S035', name:'郑州花园路店',     region:'华中区', rtm:'MS', city:'郑州',    rank:29, risk_level:'high' },
  { id:'S036', name:'长沙步步高广场店', region:'华中区', rtm:'MS', city:'长沙',    rank:30, risk_level:'high' },
  { id:'S037', name:'南昌万达广场店',   region:'华中区', rtm:'DS', city:'南昌',    rank:36, risk_level:'high' },
  { id:'S038', name:'合肥庐阳万达店',   region:'华中区', rtm:'DS', city:'合肥',    rank:39, risk_level:'high' },
  { id:'S039', name:'太原晋阳街店',     region:'华中区', rtm:'DS', city:'太原',    rank:46, risk_level:'high' },
  { id:'S040', name:'洛阳王城广场店',   region:'华中区', rtm:'DS', city:'洛阳',    rank:48, risk_level:'high' },
  { id:'S041', name:'成都IFS旗舰店',    region:'西南区', rtm:'CS', city:'成都',    rank:23, risk_level:'medium' },
  { id:'S042', name:'重庆万象城店',     region:'西南区', rtm:'CS', city:'重庆',    rank:27, risk_level:'high' },
  { id:'S043', name:'成都太古里店',     region:'西南区', rtm:'CS', city:'成都',    rank:31, risk_level:'high' },
  { id:'S044', name:'重庆解放碑店',     region:'西南区', rtm:'MS', city:'重庆',    rank:32, risk_level:'high' },
  { id:'S045', name:'昆明东风广场店',   region:'西南区', rtm:'MS', city:'昆明',    rank:34, risk_level:'high' },
  { id:'S046', name:'贵阳花果园店',     region:'西南区', rtm:'MS', city:'贵阳',    rank:37, risk_level:'high' },
  { id:'S047', name:'西安大悦城店',     region:'西南区', rtm:'DS', city:'西安',    rank:43, risk_level:'high' },
  { id:'S048', name:'兰州金城购物中心', region:'西南区', rtm:'DS', city:'兰州',    rank:47, risk_level:'high' },
  { id:'S049', name:'乌鲁木齐汇嘉时代', region:'西南区', rtm:'DS', city:'乌鲁木齐', rank:49, risk_level:'high' },
  { id:'S050', name:'拉萨柳梧新区店',   region:'西南区', rtm:'DS', city:'拉萨',    rank:50, risk_level:'high' },
];

// 按风险等级预设进度（固定值，不随机）
// low: 高完成度；medium: 中等；high: 低完成度
const PROGRESS_BY_RISK = {
  low:    { sc:26, test:89, live:1, mypal:2, ai:6 },
  medium: { sc:18, test:76, live:1, mypal:1, ai:4 },
  high:   { sc:7,  test:58, live:0, mypal:0, ai:1 },
};

// 朝阳大悦城 S001 精细样本数据（覆盖自动生成值）
const SAMPLE_S001 = [
  { id:'E001', name:'小李', role:'店长',       is_manager:1, sc_modules:28, sc_test:92, live_watched:1, mypal_days:2, ai_coach:6, risk_level:'normal', last_active:'2026-03-10T09:45:00.000Z' },
  { id:'E002', name:'小张', role:'副店长',     is_manager:0, sc_modules:24, sc_test:85, live_watched:1, mypal_days:2, ai_coach:5, risk_level:'normal', last_active:'2026-03-10T08:45:00.000Z' },
  { id:'E003', name:'小陈', role:'资深销售顾问', is_manager:0, sc_modules:20, sc_test:78, live_watched:1, mypal_days:1, ai_coach:4, risk_level:'p2',     last_active:'2026-03-10T05:45:00.000Z' },
  { id:'E004', name:'小刘', role:'资深销售顾问', is_manager:0, sc_modules:28, sc_test:88, live_watched:1, mypal_days:2, ai_coach:6, risk_level:'normal', last_active:'2026-03-10T10:15:00.000Z' },
  { id:'E005', name:'小王', role:'销售顾问',   is_manager:0, sc_modules:8,  sc_test:62, live_watched:0, mypal_days:0, ai_coach:1, risk_level:'p1',     last_active:'2026-03-09T10:45:00.000Z' },
  { id:'E006', name:'小赵', role:'销售顾问',   is_manager:0, sc_modules:16, sc_test:74, live_watched:1, mypal_days:1, ai_coach:3, risk_level:'p2',     last_active:'2026-03-10T04:45:00.000Z' },
];

const NAMES_POOL = ['小李','小王','小张','小陈','小刘','小赵','小孙','小周','小吴','小郑',
                    '小冯','小蒋','小韩','小杨','小朱','小秦','小许','小何','小邓','小曹'];
const ROLES = ['店长','副店长','资深销售顾问','资深销售顾问','销售顾问','销售顾问'];

function riskLevel(store_risk, scModules, scTest) {
  if (scModules < 8 && scTest < 60) return 'p1';
  if (scModules < 16) return 'p2';
  return 'normal';
}

// ── 主函数（全部在一个事务中执行，保证原子性）──────────────────────
const runSeed = db.transaction(() => {
  // 清空所有表（保留 schema）
  db.exec(`
    DELETE FROM intel_submissions;
    DELETE FROM alerts;
    DELETE FROM events;
    DELETE FROM tasks;
    DELETE FROM users;
    DELETE FROM employees;
    DELETE FROM stores;
  `);

  // 插入门店
  const insertStore = db.prepare(`
    INSERT INTO stores (id, name, region, rtm, city, rank, risk_level)
    VALUES (@id, @name, @region, @rtm, @city, @rank, @risk_level)
  `);
  for (const s of STORES) insertStore.run(s);

  // 插入员工（50店 × 6人 = 300）
  const insertEmployee = db.prepare(`
    INSERT INTO employees (id, store_id, name, role, is_manager,
      sc_modules, sc_test, live_watched, mypal_days, ai_coach,
      risk_level, last_active)
    VALUES (@id, @store_id, @name, @role, @is_manager,
      @sc_modules, @sc_test, @live_watched, @mypal_days, @ai_coach,
      @risk_level, @last_active)
  `);

  let empSeq = 1;
  for (const store of STORES) {
    const prog = PROGRESS_BY_RISK[store.risk_level];
    for (let i = 0; i < 6; i++) {
      const empId = 'E' + String(empSeq).padStart(3, '0');

      // S001 使用精细样本数据
      if (store.id === 'S001') {
        const sample = SAMPLE_S001[i];
        insertEmployee.run({ ...sample, store_id: store.id });
      } else {
        const nameIdx = (empSeq - 1) % NAMES_POOL.length;
        const nameSuffix = Math.floor((empSeq - 1) / NAMES_POOL.length) > 0
          ? String(Math.floor((empSeq - 1) / NAMES_POOL.length) + 1) : '';
        const is_manager = i === 0 ? 1 : 0;
        const sc  = i === 0 ? Math.min(28, prog.sc + 2)  : prog.sc;
        const tst = i === 0 ? Math.min(99, prog.test + 5) : prog.test;
        insertEmployee.run({
          id: empId,
          store_id: store.id,
          name: NAMES_POOL[nameIdx] + nameSuffix,
          role: ROLES[i],
          is_manager,
          sc_modules:   sc,
          sc_test:      tst,
          live_watched: prog.live,
          mypal_days:   prog.mypal,
          ai_coach:     prog.ai,
          risk_level:   riskLevel(store.risk_level, sc, tst),
          last_active:  '2026-03-10T10:45:00.000Z',
        });
      }
      empSeq++;
    }
  }

  // 插入 seed 告警数据（与 data.js 中 ALERTS 一致）
  const insertAlert = db.prepare(`
    INSERT INTO alerts (id, level, store_id, employee_id, trigger_desc, root_cause, suggestions_json, status)
    VALUES (@id, @level, @store_id, @employee_id, @trigger_desc, @root_cause, @suggestions_json, @status)
  `);
  const seedAlerts = [
    { id:'AL001', level:'p1', store_id:'S004', employee_id:null,  trigger_desc:'72小时无学习行动',    root_cause:'全店员工72小时内Sales Coach零进度，AI Coach未开启',                              suggestions_json:JSON.stringify([{id:'AS001',action:'推送店长专属督促通知',type:'notify'},{id:'AS002',action:'为全员分配AI Coach辅导',type:'assign_mentor'},{id:'AS003',action:'调整提醒频率至每4小时',type:'adjust_reminder'}]), status:'pending' },
    { id:'AL002', level:'p1', store_id:'S001', employee_id:'E005', trigger_desc:'72小时无行动+测验62分', root_cause:'小王Sales Coach仅完成8/28模块，AI Coach仅1次，测验62分低于80分标准',                suggestions_json:JSON.stringify([{id:'AS004',action:'发送个性化学习提醒',type:'notify'},{id:'AS005',action:'亲自担任小王专属辅导员，每日10分钟跟进',type:'assign_mentor'},{id:'AS006',action:'推送薄弱知识点强化包',type:'push_content'}]), status:'pending' },
    { id:'AL003', level:'p2', store_id:'S008', employee_id:null,  trigger_desc:'整体完成率<35%',      root_cause:'MyPAL平均学习天数仅0.4天，AI Coach平均仅1.2次',                                 suggestions_json:JSON.stringify([{id:'AS007',action:'推送工具使用指引视频',type:'push_content'},{id:'AS008',action:'通知店长组织线下学习',type:'notify'}]),                                  status:'in_progress' },
    { id:'AL004', level:'p2', store_id:'S039', employee_id:null,  trigger_desc:'直播未观看率>60%',    root_cause:'3名员工未观看今日10:30直播，且无补看记录',                                         suggestions_json:JSON.stringify([{id:'AS009',action:'推送直播回放链接',type:'push_content'},{id:'AS010',action:'设置今日22:00前完成提醒',type:'adjust_reminder'}]),                          status:'pending' },
    { id:'AL005', level:'p1', store_id:'S049', employee_id:null,  trigger_desc:'无任何系统登录记录',  root_cause:'全员未登录任何学习平台，可能存在设备或账号问题',                                    suggestions_json:JSON.stringify([{id:'AS011',action:'紧急联系店长核实情况',type:'notify'},{id:'AS012',action:'派遣IT支持检查账号',type:'escalate'}]),                                      status:'pending' },
  ];
  for (const a of seedAlerts) insertAlert.run(a);

  // 插入种子任务
  db.prepare(`
    INSERT INTO tasks (id, name, status, deadline, target_role, store_scope, created_by, config_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'T001', '2026年Q1新品发布训练营', 'active', '2026-03-17T14:00:00',
    'all', 'all', '总部培训团队',
    JSON.stringify({
      platforms:[
        {id:'sc',   name:'Sales Coach', modules:28, desc:'28个模块 CN版'},
        {id:'live', name:'直播培训',    modules:1,  desc:'3月10日 10:30-11:30'},
        {id:'mypal',name:'MyPAL',       modules:0,  desc:'个性化学习路径'},
        {id:'ai',   name:'AI Coach',    modules:6,  desc:'6个对话脚本'},
      ],
      milestones:[
        {date:'2026-03-10T23:59:00', target:'Sales Coach 第1-10模块完成', targetRate:60},
        {date:'2026-03-13T23:59:00', target:'Sales Coach 全部完成+AI Coach 3个', targetRate:80},
        {date:'2026-03-17T14:00:00', target:'全部达标', targetRate:100},
      ],
    }),
    '2026-03-08T18:00:00'
  );

  // 插入用户账号
  const insertUser = db.prepare(`
    INSERT INTO users (username, password_hash, role, store_id, employee_id)
    VALUES (@username, @password_hash, @role, @store_id, @employee_id)
  `);

  // admin
  insertUser.run({ username:'admin', password_hash: ADMIN_PASSWORD_HASH, role:'admin', store_id:null, employee_id:null });
  // central
  insertUser.run({ username:'central', password_hash: DEFAULT_PASSWORD_HASH, role:'central', store_id:null, employee_id:null });
  // store（每店店长账号，store_id 关联门店，employee_id 关联店长员工）
  for (const s of STORES) {
    // 找该店店长 employee id（store index * 6 + 1, 从 E001 开始）
    const storeIdx = STORES.indexOf(s);
    const managerEmpId = 'E' + String(storeIdx * 6 + 1).padStart(3, '0');
    insertUser.run({
      username: `store_${s.id}`,
      password_hash: DEFAULT_PASSWORD_HASH,
      role: 'store',
      store_id: s.id,
      employee_id: managerEmpId,
    });
  }
  // employee（每人一个账号）
  for (let i = 1; i <= 300; i++) {
    const empId = 'E' + String(i).padStart(3, '0');
    // 找 store_id
    const storeIdx = Math.floor((i - 1) / 6);
    const store = STORES[storeIdx];
    insertUser.run({
      username: `emp_${empId}`,
      password_hash: DEFAULT_PASSWORD_HASH,
      role: 'employee',
      store_id: store.id,
      employee_id: empId,
    });
  }

  const counts = {
    stores:    db.prepare('SELECT COUNT(*) as n FROM stores').get().n,
    employees: db.prepare('SELECT COUNT(*) as n FROM employees').get().n,
    users:     db.prepare('SELECT COUNT(*) as n FROM users').get().n,
    alerts:    db.prepare('SELECT COUNT(*) as n FROM alerts').get().n,
    tasks:     db.prepare('SELECT COUNT(*) as n FROM tasks').get().n,
  };
  console.log('✅ Seed complete:', counts);
  return counts;
});

runSeed();
```

- [ ] **Step 2: 运行 seed 并验证**

```bash
cd /Users/skyler/Desktop/MVP/server
node seed.js
```

Expected output:
```
✅ Seed complete: { stores: 50, employees: 300, users: 352, alerts: 5, tasks: 1 }
```

- [ ] **Step 3: 抽查数据库数据**

```bash
cd /Users/skyler/Desktop/MVP/server && node -e "
const db = require('./db');
console.log('S001 employees:', db.prepare('SELECT id,name,role,sc_modules,risk_level FROM employees WHERE store_id=?').all('S001'));
console.log('admin user:', db.prepare('SELECT username,role FROM users WHERE role=?').get('admin'));
"
```

Expected: S001 有 6 名员工，小王 sc_modules=8，risk_level='p1'；admin 用户存在。

- [ ] **Step 4: Commit**

```bash
cd /Users/skyler/Desktop/MVP
git add server/seed.js
git commit -m "feat: add seed script with 50 stores, 300 employees, 352 users"
```

---

## Chunk 3: 迁移 index.js 事件总线到 SQLite

### Task 4: 修改 index.js — events 读写迁移

**Files:**
- Modify: `server/index.js`

> 目标：用 SQLite 替换 state.json 中的 events，同时保持 `/api/state`、`/api/events`、`POST /api/events`、WebSocket 行为完全不变（字段名 `id`、`type`、`from`、`payload`、`at` 保持一致）。

- [ ] **Step 1: 修改 index.js**

将 `server/index.js` 中 state.json 相关的 `loadState`、`saveState`、`nextId` 逻辑替换为 SQLite 操作：

```javascript
// server/index.js（完整替换版）
const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 8080;
const FRONTEND = path.join(__dirname, '..', 'front-end');

// ── 预编译 SQL 语句 ───────────────────────────────────────────
const stmtAllEvents = db.prepare('SELECT id, type, "from", payload, at FROM events ORDER BY rowid');
const stmtInsertEvent = db.prepare(
  'INSERT INTO events (id, type, "from", payload, at) VALUES (@id, @type, @from, @payload, @at)'
);
const stmtMaxEventId = db.prepare("SELECT MAX(CAST(REPLACE(id,'evt_','') AS INTEGER)) as maxN FROM events WHERE id LIKE 'evt_%'");

function nextEventId() {
  const row = stmtMaxEventId.get();
  const maxN = row && row.maxN ? row.maxN : 0;
  return 'evt_' + (maxN + 1);
}

function getAllEvents() {
  return stmtAllEvents.all().map(e => ({
    id: e.id, type: e.type, from: e.from,
    payload: JSON.parse(e.payload || '{}'), at: e.at,
  }));
}

// ── Express 设置 ──────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(FRONTEND));

// GET /api/health
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'mvp-lan-api' });
});

// GET /api/state
app.get('/api/state', (req, res) => {
  res.json({ events: getAllEvents(), tasks: [] });
});

// GET /api/events
app.get('/api/events', (req, res) => {
  res.json({ events: getAllEvents() });
});

// POST /api/events
app.post('/api/events', (req, res) => {
  const { type, from, payload } = req.body || {};
  if (!type || !from) {
    return res.status(400).json({ error: 'Missing type or from' });
  }
  const evt = {
    id: nextEventId(),
    type,
    from,
    payload: JSON.stringify(payload || {}),
    at: new Date().toISOString(),
  };
  stmtInsertEvent.run(evt);
  const outEvt = { ...evt, payload: payload || {} };
  res.status(201).json(outEvt);
  broadcastState();
});

// ── WebSocket ─────────────────────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcastState() {
  const payload = JSON.stringify({ type: 'state', events: getAllEvents(), tasks: [] });
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(payload);
  });
}

wss.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'state', events: getAllEvents(), tasks: [] }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('MVP LAN server running at http://0.0.0.0:' + PORT);
  console.log('  Local:   http://localhost:' + PORT);
  console.log('  LAN:     http://<your-lan-ip>:' + PORT);
  console.log('  WS:      ws://localhost:' + PORT + '/ws');
});
```

- [ ] **Step 2: 启动服务器并验证健康检查**

```bash
cd /Users/skyler/Desktop/MVP/server && node index.js &
sleep 2
curl -s http://localhost:8080/api/health
```

Expected: `{"ok":true,"service":"mvp-lan-api"}`

- [ ] **Step 3: 验证 GET /api/state 返回正确结构**

```bash
curl -s http://localhost:8080/api/state | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('events:', d.events.length, 'tasks:', d.tasks.length)"
```

Expected: `events: 0 tasks: 0`（初始无事件）

> **注意：** `/api/state` 的 `tasks` 字段在 Phase 1 始终返回 `[]`，即使数据库 tasks 表已有数据（T001）。这是有意设计：完整的 `/api/tasks` 路由将在 Phase 3 实现。

- [ ] **Step 4: 验证 POST /api/events 写入并广播**

```bash
curl -s -X POST http://localhost:8080/api/events \
  -H "Content-Type: application/json" \
  -d '{"type":"task_published","from":"central","payload":{"title":"测试任务"}}'
```

Expected 响应包含: `"id":"evt_1"`, `"type":"task_published"`, `"from":"central"`, `"at":"..."`

```bash
curl -s http://localhost:8080/api/state | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('events count:', d.events.length, 'first id:', d.events[0]?.id)"
```

Expected: `events count: 1 first id: evt_1`

- [ ] **Step 5: 停止服务器并验证事件重启后持久化**

```bash
pkill -f "node index.js" 2>/dev/null; sleep 1
cd /Users/skyler/Desktop/MVP/server && node index.js &
sleep 2
curl -s http://localhost:8080/api/state | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('events after restart:', d.events.length)"
pkill -f "node index.js" 2>/dev/null
```

Expected: `events after restart: 1`（数据持久化，重启不丢失）

- [ ] **Step 6: 验证前端页面仍可正常访问**

```bash
cd /Users/skyler/Desktop/MVP/server && node index.js &
sleep 2
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/central.html
pkill -f "node index.js" 2>/dev/null
```

Expected: `200`

- [ ] **Step 7: Commit**

```bash
cd /Users/skyler/Desktop/MVP
git add server/index.js
git commit -m "feat: migrate event bus from state.json to SQLite, preserve all API contracts"
```

---

## Chunk 4: 清理与收尾

### Task 5: 将 state.json 废弃

**Files:**
- Modify: `server/.gitignore`

- [ ] **Step 1: 确认服务正常运行后，将 state.json 加入 gitignore**

```bash
echo "state.json" >> /Users/skyler/Desktop/MVP/server/.gitignore
```

- [ ] **Step 2: Phase 1 验收检查清单**

```bash
cd /Users/skyler/Desktop/MVP/server && node -e "
const db = require('./db');
const counts = {
  stores:    db.prepare('SELECT COUNT(*) as n FROM stores').get().n,
  employees: db.prepare('SELECT COUNT(*) as n FROM employees').get().n,
  users:     db.prepare('SELECT COUNT(*) as n FROM users').get().n,
  alerts:    db.prepare('SELECT COUNT(*) as n FROM alerts').get().n,
  tasks:     db.prepare('SELECT COUNT(*) as n FROM tasks').get().n,
};
console.log('DB counts:', counts);
const fail = [];
if (counts.stores !== 50) fail.push('stores should be 50');
if (counts.employees !== 300) fail.push('employees should be 300');
if (counts.users !== 352) fail.push('users should be 352');
if (fail.length) { console.error('FAIL:', fail); process.exit(1); }
console.log('✅ All counts correct');
"
```

Expected: `✅ All counts correct`

- [ ] **Step 3: 最终 Commit**

```bash
cd /Users/skyler/Desktop/MVP
git add server/.gitignore
git commit -m "chore: deprecate state.json, add to gitignore"
```

---

## 执行顺序说明

**必须按以下顺序操作：**
1. `cd server && npm install`（安装依赖）
2. `node seed.js`（初始化数据库并写入捏造数据）
3. `node index.js`（启动服务器）

跳过步骤 2 直接启动服务器，数据库表会被创建但无数据，看板将显示空内容。

## Phase 1 完成验收标准

- [ ] `node seed.js` 输出 `stores: 50, employees: 300, users: 352`
- [ ] `node index.js` 服务正常启动
- [ ] `GET /api/health` 返回 `{"ok":true}`
- [ ] `GET /api/state` 返回 `{ events: [...], tasks: [] }`（字段名与原 state.json 一致）
- [ ] `POST /api/events` 写入 SQLite，响应含正确 id/type/from/payload/at
- [ ] 重启服务器后事件数据不丢失
- [ ] `GET /central.html` 返回 200，前端页面正常显示
- [ ] 数据库文件 `database.db` 已加入 `.gitignore`
