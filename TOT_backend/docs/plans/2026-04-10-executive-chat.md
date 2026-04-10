# Executive Chat (EChat) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an AI-powered natural language chat interface for the `executive` role that queries training task data using a dual-stage LLM pipeline, with a clean upgrade path to Function Calling.

**Architecture:** A `chatAgentRunner.js` switching layer routes between two modes: MVP `intent_routing` (LLM classifies intent → sync DB tool → LLM formats answer) and future `function_calling` (FC Loop). All DB tool functions live in `chatToolsService.js` which never changes between modes. Session and message history are persisted in SQLite.

**Tech Stack:** Node.js/Express, better-sqlite3 (sync), nanoid v3, DeepSeek Chat API (`utils/ai.generateTextDeepSeek`), JWT auth middleware

**Design document:** `docs/superpowers/specs/2026-04-10-executive-chat-design.md`

---

## Prerequisites: Read Before Starting

- **DB pattern:** `const { db } = require('../db')` — all calls synchronous (`db.get`, `db.all`, `db.run`, `db.transaction`). Never use `await` on db calls.
- **Raw DB access:** `const { getDb } = require('../db')` — returns the better-sqlite3 instance, needed for migrations and PRAGMA.
- **LLM:** `const { generateTextDeepSeek } = require('../utils/ai')` — async, must `await`. Accepts `(prompt, { system, temperature, maxTokens })`.
- **ID generation:** `const { nanoid } = require('nanoid')` — v3 CommonJS.
- **Auth middleware:** `authenticate` (sets `req.user.id`), `requireRole(['executive'])` — imported from `../middleware/auth`.
- **Error helper:** `throw createError(404, 'Not found', 'CHAT_001')` — imported from `../middleware/errorHandler`.
- **Response format:** `res.json({ code: 200, message: 'success', data: {...}, requestId: req.requestId })`.
- **Test approach:** curl + Python inline assertions in bash scripts (see `server/test-day6-dev1.sh` for pattern).

---

## Task 1: DB Migrations

**Files:**
- Modify: `server/db/schema.sql`
- Modify: `server/db/index.js`

### Step 1: Add `chat_sessions` and `chat_messages` to schema.sql

Open `server/db/schema.sql` and append at the end (after `mypal_learning_mock`):

```sql
CREATE TABLE IF NOT EXISTS chat_sessions (
  id          TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  role_scope  TEXT NOT NULL CHECK (role_scope IN ('national', 'regional', 'rtm')),
  regions     TEXT,
  rtm         TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  last_active TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES chat_sessions(id),
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content     TEXT NOT NULL,
  intent_type TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cm_session_id ON chat_messages(session_id);
```

### Step 2: Add migration functions to `server/db/index.js`

In `server/db/index.js`, add these two functions after `migrateNotificationEventsContent`:

```javascript
/** 已有库补列：users.executive_regions / executive_rtm（EChat 辖区绑定） */
function migrateUsersExecutiveScope(database) {
  const cols = database.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!cols.includes('executive_regions')) {
    database.exec('ALTER TABLE users ADD COLUMN executive_regions TEXT');
  }
  if (!cols.includes('executive_rtm')) {
    database.exec('ALTER TABLE users ADD COLUMN executive_rtm TEXT');
  }
}

/** 创建 chat_sessions / chat_messages 表（新库由 schema.sql 建，旧库由本函数兜底） */
function ensureChatTables(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id          TEXT PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      role_scope  TEXT NOT NULL CHECK (role_scope IN ('national', 'regional', 'rtm')),
      regions     TEXT,
      rtm         TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      last_active TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id          TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL REFERENCES chat_sessions(id),
      role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content     TEXT NOT NULL,
      intent_type TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  database.exec(
    'CREATE INDEX IF NOT EXISTS idx_cm_session_id ON chat_messages(session_id)'
  );
}
```

### Step 3: Register migrations in `getDb()`

In the `getDb()` function in `server/db/index.js`, add the two new migration calls right after `migrateNotificationEventsContent(_db)`:

```javascript
migrateUsersExecutiveScope(_db);
ensureChatTables(_db);
```

Also add both function names to the `module.exports` at the bottom:

```javascript
module.exports = { db, getDb };
// (no change needed — these are internal helpers called inside getDb)
```

### Step 4: Verify migrations run without error

Start the server and check tables exist:

```bash
cd server
node -e "
const { getDb } = require('./db');
const db = getDb();
const tables = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all().map(r=>r.name);
console.log('Tables:', tables);
console.log('Has chat_sessions:', tables.includes('chat_sessions'));
console.log('Has chat_messages:', tables.includes('chat_messages'));
const cols = db.prepare('PRAGMA table_info(users)').all().map(c=>c.name);
console.log('users.executive_regions:', cols.includes('executive_regions'));
console.log('users.executive_rtm:', cols.includes('executive_rtm'));
"
```

Expected output: all four values `true`.

### Step 5: Commit

```bash
git add server/db/schema.sql server/db/index.js
git commit -m "feat(chat): add DB migrations for executive scope + chat tables"
```

---

## Task 2: chatToolsService.js

Create the data layer for the chat agent. This file is intentionally designed to never change between MVP and FC modes.

**Files:**
- Create: `server/services/chatToolsService.js`

### Step 1: Write the failing smoke test

Create `server/test-chat-tools.sh`:

```bash
#!/usr/bin/env bash
# Smoke test for chatToolsService (import + stub data round-trip)
set -e
node -e "
const svc = require('./services/chatToolsService');
// TOOL_SCHEMAS shape check
const s = svc.TOOL_SCHEMAS;
if (!Array.isArray(s) || s.length !== 4) throw new Error('Expected 4 TOOL_SCHEMAS, got ' + s.length);
const names = s.map(t => t.function.name);
['getOverviewData','getTaskListData','getWarningsData','getStoreDetailData'].forEach(n => {
  if (!names.includes(n)) throw new Error('Missing tool: ' + n);
});
console.log('TOOL_SCHEMAS OK');

// executeByName dispatch check (with stub taskId that likely has no data)
const scope = { type: 'national', regions: null, rtm: null };
const result = svc.executeByName('getTaskListData', {}, scope);
if (!Array.isArray(result)) throw new Error('getTaskListData should return array');
console.log('executeByName dispatch OK');
console.log('ALL PASS');
"
```

Run: `cd server && bash test-chat-tools.sh`
Expected: fails with "Cannot find module"

### Step 2: Create `server/services/chatToolsService.js`

```javascript
'use strict';

const { db } = require('../db');

// ─── TOOL_SCHEMAS ─────────────────────────────────────────────────────────────
// MVP: written here but NOT passed to LLM (intent_routing mode).
// FC upgrade: pass directly as `tools` param to openai.chat.completions.create().
const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'getOverviewData',
      description: '查询培训任务整体完成率、进度统计、预警率等汇总数据',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: '任务ID，不传则汇总所有已下发任务' },
          region: { type: 'string', description: '大区名称过滤，如"华东"' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'getTaskListData',
      description: '查询当前所有已下发培训任务的列表、截止时间与完成情况',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'getWarningsData',
      description: '查询存在风险的门店列表（完成率低或临近截止），即预警数据',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: '任务ID，不传则扫描所有任务' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'getStoreDetailData',
      description: '查询某一具体门店内所有员工的培训进度明细',
      parameters: {
        type: 'object',
        required: ['storeId'],
        properties: {
          storeId: { type: 'string', description: '门店ID' },
          taskId:  { type: 'string', description: '任务ID，不传则取最近一个任务' }
        }
      }
    }
  }
];

// ─── Region filter builder ─────────────────────────────────────────────────────
/**
 * Builds a SQL fragment + params array for region-scoped queries.
 * @param {object} regionScope  { type: 'national'|'regional'|'rtm', regions: string[]|null, rtm: string|null }
 * @returns {{ sql: string, params: any[] }}
 */
function buildRegionFilter(regionScope) {
  if (!regionScope || regionScope.type === 'national') {
    return { sql: '', params: [] };
  }
  if (regionScope.type === 'regional') {
    const placeholders = regionScope.regions.map(() => '?').join(',');
    return { sql: `AND s.region IN (${placeholders})`, params: regionScope.regions };
  }
  if (regionScope.type === 'rtm') {
    return { sql: 'AND s.rtm = ?', params: [regionScope.rtm] };
  }
  return { sql: '', params: [] };
}

// ─── Store name → ID resolver ───────��─────────────────────────────────────────
/**
 * Resolves a storeName string to stores.id using LIKE matching.
 * Returns the matched storeId or null if ambiguous/not found.
 * @param {string} storeName
 * @returns {string|null}
 */
function resolveStoreId(storeName) {
  if (!storeName) return null;
  const rows = db.all(
    'SELECT id FROM stores WHERE name LIKE ?',
    [`%${storeName}%`]
  );
  if (rows.length === 1) return rows[0].id;
  return null; // ambiguous or not found
}

// ─── Tool functions ────────────────────────────────────────────────────────────

/**
 * getOverviewData — 汇总完成率/进度/预警率
 * Mirrors the core aggregation logic from routes/dashboard.js overview.
 */
function getOverviewData(taskId, regionScope) {
  const filter = buildRegionFilter(regionScope);
  const taConditions = ['1=1'];
  const params = [];

  if (taskId) {
    taConditions.push('ta.task_id = ?');
    params.push(taskId);
  }

  // Need JOIN stores when region filter is active
  const joinStore = filter.sql ? 'JOIN stores s ON s.id = ta.store_id' : '';
  const whereClause = taConditions.join(' AND ') + (filter.sql ? ' ' + filter.sql : '');
  const allParams = [...params, ...filter.params];

  const row = db.get(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN ta.status = 'completed'   THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN ta.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
       SUM(CASE WHEN ta.status = 'pending'     THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN ta.status = 'completed' AND ta.completed_at <= t.ddl_at THEN 1 ELSE 0 END) AS on_time,
       AVG(CASE WHEN ta.status = 'completed' AND ta.completed_at IS NOT NULL AND t.created_at IS NOT NULL
           THEN (julianday(ta.completed_at) - julianday(t.created_at)) * 24 END) AS avg_hours,
       MAX(ta.updated_at) AS last_updated
     FROM task_assignments ta
     JOIN tasks t ON t.id = ta.task_id
     ${joinStore}
     WHERE ${whereClause}`,
    allParams
  );

  const total = row ? row.total : 0;
  return {
    totalAssignments: total,
    completedCount: row ? row.completed : 0,
    inProgressCount: row ? row.in_progress : 0,
    pendingCount: row ? row.pending : 0,
    completionRate: total > 0 ? parseFloat(((row.completed / total) * 100).toFixed(1)) : 0,
    onTimeCompletionRate: total > 0 ? parseFloat(((row.on_time / total) * 100).toFixed(1)) : 0,
    avgCompletionTimeHours: row && row.avg_hours ? parseFloat(row.avg_hours.toFixed(1)) : null,
    updatedAt: row ? row.last_updated : null,
  };
}

/**
 * getTaskListData — 已下发任务列表
 */
function getTaskListData(regionScope) {
  const filter = buildRegionFilter(regionScope);
  const joinStore = filter.sql
    ? 'JOIN task_assignments ta2 ON ta2.task_id = t.id JOIN stores s ON s.id = ta2.store_id'
    : '';
  const whereExtra = filter.sql ? filter.sql : '';

  // Get distinct dispatched tasks with completion stats
  const rows = db.all(
    `SELECT
       t.id,
       t.title,
       t.ddl_at,
       COUNT(ta.id) AS total,
       SUM(CASE WHEN ta.status = 'completed' THEN 1 ELSE 0 END) AS completed
     FROM tasks t
     LEFT JOIN task_assignments ta ON ta.task_id = t.id
     ${filter.sql ? 'LEFT JOIN stores s ON s.id = ta.store_id' : ''}
     WHERE t.status = 'dispatched'
     ${whereExtra}
     GROUP BY t.id
     ORDER BY t.ddl_at ASC`,
    filter.params
  );

  return rows.map(r => ({
    taskId: r.id,
    title: r.title,
    ddlAt: r.ddl_at,
    totalAssignments: r.total || 0,
    completedCount: r.completed || 0,
    completionRate: r.total > 0 ? parseFloat(((r.completed / r.total) * 100).toFixed(1)) : 0,
  }));
}

/**
 * getWarningsData — 风险门店列表（完成率 < 80%）
 * Bypasses routes/dashboard.js (which requires 'central') by querying SQLite directly.
 */
function getWarningsData(taskId, regionScope) {
  const filter = buildRegionFilter(regionScope);
  const taskFilter = taskId ? 'AND ta.task_id = ?' : "AND t.status = 'dispatched'";
  const taskParams = taskId ? [taskId] : [];

  const rows = db.all(
    `SELECT
       ta.task_id,
       s.id    AS store_id,
       s.name  AS store_name,
       s.region,
       t.ddl_at,
       COUNT(*) AS total,
       SUM(CASE WHEN ta.status = 'completed' THEN 1 ELSE 0 END) AS completed
     FROM task_assignments ta
     JOIN stores s ON s.id = ta.store_id
     JOIN tasks  t ON t.id = ta.task_id
     WHERE 1=1 ${taskFilter} ${filter.sql}
     GROUP BY ta.task_id, ta.store_id
     HAVING CAST(completed AS FLOAT) / total < 0.8
     ORDER BY CAST(completed AS FLOAT) / total ASC
     LIMIT 20`,
    [...taskParams, ...filter.params]
  );

  return rows.map(r => ({
    taskId: r.task_id,
    storeId: r.store_id,
    storeName: r.store_name,
    region: r.region,
    ddlAt: r.ddl_at,
    totalCount: r.total,
    completedCount: r.completed,
    completionRate: parseFloat(((r.completed / r.total) * 100).toFixed(1)),
  }));
}

/**
 * getStoreDetailData — 具体门店员工进度明细
 * If storeId not found, tries to resolve from storeName (passed via params).
 */
function getStoreDetailData(storeId, taskId) {
  // Fallback: if storeId looks like a name (no S prefix), try resolving
  let resolvedId = storeId;
  if (storeId && !storeId.match(/^S\d+$/i)) {
    resolvedId = resolveStoreId(storeId) || storeId;
  }

  // If no taskId, use the most recently created dispatched task for this store
  let resolvedTaskId = taskId;
  if (!resolvedTaskId) {
    const taskRow = db.get(
      `SELECT ta.task_id FROM task_assignments ta
       JOIN tasks t ON t.id = ta.task_id
       WHERE ta.store_id = ? AND t.status = 'dispatched'
       ORDER BY t.created_at DESC LIMIT 1`,
      [resolvedId]
    );
    resolvedTaskId = taskRow ? taskRow.task_id : null;
  }
  if (!resolvedTaskId) return { storeId: resolvedId, employees: [], summary: null };

  const storeRow = db.get('SELECT id, name, region, rtm, format FROM stores WHERE id = ?', [resolvedId]);
  const employees = db.all(
    `SELECT
       e.id AS employee_id,
       e.name AS employee_name,
       ta.status,
       ta.progress,
       ta.mypal_completed,
       ta.smartsell_completed,
       ta.ai_demo_completed,
       ta.live_broadcast_completed,
       ta.nudge_count,
       ta.received_at,
       ta.started_at,
       ta.completed_at
     FROM task_assignments ta
     JOIN employees e ON e.id = ta.user_id
     WHERE ta.task_id = ? AND ta.store_id = ?
     ORDER BY ta.progress DESC`,
    [resolvedTaskId, resolvedId]
  );

  const total = employees.length;
  const completed = employees.filter(e => e.status === 'completed').length;

  return {
    taskId: resolvedTaskId,
    store: storeRow || { id: resolvedId },
    summary: {
      totalCount: total,
      completedCount: completed,
      completionRate: total > 0 ? parseFloat(((completed / total) * 100).toFixed(1)) : 0,
      inProgressCount: employees.filter(e => e.status === 'in_progress').length,
      pendingCount: employees.filter(e => e.status === 'pending').length,
    },
    employees: employees.map(e => ({
      employeeId: e.employee_id,
      employeeName: e.employee_name,
      status: e.status,
      progress: e.progress,
      platformStatus: {
        mypalCompleted:          !!e.mypal_completed,
        smartsellCompleted:      !!e.smartsell_completed,
        aiDemoCompleted:         !!e.ai_demo_completed,
        liveBroadcastCompleted:  !!e.live_broadcast_completed,
      },
      nudgeCount: e.nudge_count,
      receivedAt: e.received_at,
      startedAt:  e.started_at,
      completedAt: e.completed_at,
    })),
  };
}

// ─── FC-ready unified dispatch entry point ────────────────────────────────────
/**
 * executeByName — single entry for both intent_routing and FC Loop.
 * MVP: chatAgentRunner calls this after intent classification.
 * FC upgrade: FC Loop calls this directly with parsed tool_call arguments.
 */
function executeByName(toolName, params, regionScope) {
  switch (toolName) {
    case 'getOverviewData':
      return getOverviewData(params.taskId || null, regionScope);
    case 'getTaskListData':
      return getTaskListData(regionScope);
    case 'getWarningsData':
      return getWarningsData(params.taskId || null, regionScope);
    case 'getStoreDetailData':
      if (!params.storeId) throw new Error('getStoreDetailData requires storeId');
      return getStoreDetailData(params.storeId, params.taskId || null);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

module.exports = {
  TOOL_SCHEMAS,
  executeByName,
  buildRegionFilter,
  resolveStoreId,
  // Individual functions exported for direct testing
  getOverviewData,
  getTaskListData,
  getWarningsData,
  getStoreDetailData,
};
```

### Step 3: Run the smoke test

```bash
cd server && bash test-chat-tools.sh
```

Expected: `TOOL_SCHEMAS OK`, `executeByName dispatch OK`, `ALL PASS`.

### Step 4: Commit

```bash
git add server/services/chatToolsService.js server/test-chat-tools.sh
git commit -m "feat(chat): add chatToolsService with TOOL_SCHEMAS + executeByName + 4 tool functions"
```

---

## Task 3: chatIntentService.js

Classifies user messages into one of 5 intent types using DeepSeek (LLM Call 1, temp=0).

**Files:**
- Create: `server/services/chatIntentService.js`

### Step 1: Write the module

```javascript
'use strict';

const { generateTextDeepSeek } = require('../utils/ai');

const VALID_INTENTS = new Set([
  'progress_query',
  'project_status',
  'warning_query',
  'drill_down',
  'unknown',
]);

const SYSTEM_PROMPT = `你是一个培训管理系统的意图分类助手。
根据用户提问，输出以下 JSON（不加代码块标记，不加任何说明文字）：
{
  "intentType": "<类型>",
  "entities": {
    "taskId": null,
    "storeId": null,
    "storeName": null,
    "region": null,
    "rtm": null,
    "topN": null
  }
}

合法 intentType:
- progress_query   查完成率/进度数据（如"Q1培训完成率是多少？"）
- project_status   查任务列表/状态概览（如"现在有哪些进行中的任务？"）
- warning_query    查预警/风险门店（如"有哪些门店需要关注？"）
- drill_down       查具体门店员工进度（如"上海环球港店具体情况怎么样？"）
- unknown          闲聊/打招呼，或系统无对应数据的业务问题

unknown 的判断标准：
- 闲聊/打招呼（如"你好"、"谢谢"）→ unknown
- 业务问题但系统无对应数据（如"员工学习偏好"、"心理状态分析"）→ unknown

示例：
用户: "Q1培训完成率？" → { "intentType": "progress_query", "entities": { "taskId": null, "storeId": null, "storeName": null, "region": null, "rtm": null, "topN": null } }
用户: "上海环球港店怎么样？" → { "intentType": "drill_down", "entities": { "taskId": null, "storeId": null, "storeName": "上海环球港", "region": null, "rtm": null, "topN": null } }
用户: "你好！" → { "intentType": "unknown", "entities": { "taskId": null, "storeId": null, "storeName": null, "region": null, "rtm": null, "topN": null } }`;

/**
 * Classify a user message into an intent + entities.
 * @param {string} userMessage
 * @param {Array<{role:string, content:string}>} history  — last 6 DB messages as [{role,content}]
 * @returns {Promise<{ intentType: string, entities: object }>}
 */
async function classify(userMessage, history) {
  // Build history context (last 3 rounds = 6 messages)
  const historyText = history
    .slice(-6)
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');

  const prompt = historyText
    ? `历史对话:\n${historyText}\n\n当前提问:\n${userMessage}`
    : userMessage;

  let raw;
  try {
    raw = await generateTextDeepSeek(prompt, {
      system: SYSTEM_PROMPT,
      temperature: 0,
      maxTokens: 256,
    });
  } catch (err) {
    console.error('[chatIntentService] LLM call failed:', err.message);
    // Fallback: treat as progress_query with empty entities
    return { intentType: 'progress_query', entities: {} };
  }

  try {
    const parsed = JSON.parse(raw.trim());
    const intentType = VALID_INTENTS.has(parsed.intentType)
      ? parsed.intentType
      : 'progress_query';
    return {
      intentType,
      entities: parsed.entities || {},
    };
  } catch {
    console.warn('[chatIntentService] Failed to parse LLM response, falling back to progress_query. Raw:', raw);
    return { intentType: 'progress_query', entities: {} };
  }
}

module.exports = { classify };
```

### Step 2: Manual integration test (requires `DEEPSEEK_API_KEY` in `.env`)

```bash
cd server
node -e "
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { classify } = require('./services/chatIntentService');
(async () => {
  const r1 = await classify('Q1培训完成率是多少？', []);
  console.log('Test 1:', r1.intentType, '(expect: progress_query)');
  const r2 = await classify('你好！', []);
  console.log('Test 2:', r2.intentType, '(expect: unknown)');
  const r3 = await classify('上海环球港店怎么样', []);
  console.log('Test 3:', r3.intentType, '(expect: drill_down)', 'storeName:', r3.entities.storeName);
  console.log('PASS');
})().catch(e => { console.error(e); process.exit(1); });
"
```

### Step 3: Commit

```bash
git add server/services/chatIntentService.js
git commit -m "feat(chat): add chatIntentService (LLM Call 1 intent classification)"
```

---

## Task 4: chatAnswerService.js

Formats tool query results into structured `ReplyContent` responses using DeepSeek (LLM Call 2, temp=0.3).

**Files:**
- Create: `server/services/chatAnswerService.js`

### Step 1: Write the module

```javascript
'use strict';

const { generateTextDeepSeek } = require('../utils/ai');

const SYSTEM_PROMPT = `你是一个培训数据分析助手，请根据以下查询结果，用中文回答用户问题。
输出严格符合以下 JSON 格式（不加代码块标记，不加任何说明文字）:
{
  "overview": "...",
  "keyNumbers": [{"label": "...", "value": "...", "unit": "..."}],
  "attentionPoints": ["...", "..."],
  "followUpSuggestions": ["...", "..."]
}

要求：
- overview：不超过 60 字，简明总结数据情况
- keyNumbers：最多 4 项，数字必须来自查询结果，不得捏造；无数据时返回 []
- attentionPoints：最多 3 项，聚焦问题与风险；无问题时返回 []
- followUpSuggestions：最多 3 项，以"可追问："开头；无建议时返回 []
- 如果查询结果为空或 null，overview 说明"暂无相关数据"，其余字段返回空数组`;

const FALLBACK_REPLY = {
  overview: '抱歉，回复生成时遇到了问题，请稍后重试。',
  keyNumbers: [],
  attentionPoints: [],
  followUpSuggestions: [],
};

/**
 * Format tool results into a structured ReplyContent object.
 * @param {string} userMessage
 * @param {any} toolResult  — result from chatToolsService.executeByName (or null for unknown intent)
 * @param {Array<{role:string, content:string}>} history
 * @returns {Promise<ReplyContent>}
 */
async function format(userMessage, toolResult, history) {
  const dataSection = toolResult != null
    ? `查询结果数据：\n${JSON.stringify(toolResult, null, 2)}`
    : '查询结果数据：无（用户问题不涉及系统数据，请自由回答或说明暂无相关数据）';

  const historyText = history
    .slice(-6)
    .map(m => {
      // assistant messages in DB are JSON-stringified ReplyContent; extract overview for brevity
      if (m.role === 'assistant') {
        try {
          const rc = JSON.parse(m.content);
          return `Assistant: ${rc.overview || m.content}`;
        } catch {
          return `Assistant: ${m.content}`;
        }
      }
      return `User: ${m.content}`;
    })
    .join('\n');

  const prompt = [
    historyText ? `历史对话:\n${historyText}\n` : '',
    `用户问题：${userMessage}\n`,
    dataSection,
  ].join('\n');

  let raw;
  try {
    raw = await generateTextDeepSeek(prompt, {
      system: SYSTEM_PROMPT,
      temperature: 0.3,
      maxTokens: 1024,
    });
  } catch (err) {
    console.error('[chatAnswerService] LLM call failed:', err.message);
    return FALLBACK_REPLY;
  }

  try {
    const parsed = JSON.parse(raw.trim());
    return {
      overview:             String(parsed.overview || ''),
      keyNumbers:           Array.isArray(parsed.keyNumbers) ? parsed.keyNumbers : [],
      attentionPoints:      Array.isArray(parsed.attentionPoints) ? parsed.attentionPoints : [],
      followUpSuggestions:  Array.isArray(parsed.followUpSuggestions) ? parsed.followUpSuggestions : [],
    };
  } catch {
    console.warn('[chatAnswerService] Failed to parse LLM response. Raw:', raw);
    return FALLBACK_REPLY;
  }
}

module.exports = { format };
```

### Step 2: Manual test

```bash
cd server
node -e "
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { format } = require('./services/chatAnswerService');
(async () => {
  // Test 1: with data
  const mockData = { totalAssignments: 300, completedCount: 216, completionRate: 72.0 };
  const r1 = await format('Q1培训完成率是多少？', mockData, []);
  console.log('overview:', r1.overview);
  console.log('keyNumbers count:', r1.keyNumbers.length);
  if (!r1.overview) throw new Error('overview is empty');
  // Test 2: unknown intent (no data)
  const r2 = await format('你好！', null, []);
  console.log('unknown overview:', r2.overview);
  console.log('ALL PASS');
})().catch(e => { console.error(e); process.exit(1); });
"
```

### Step 3: Commit

```bash
git add server/services/chatAnswerService.js
git commit -m "feat(chat): add chatAnswerService (LLM Call 2 answer formatting)"
```

---

## Task 5: chatAgentRunner.js

The **single switching layer** between intent_routing (MVP) and function_calling (FC upgrade). `chatService.js` calls only `run()` and never knows which mode is active.

**Files:**
- Create: `server/services/chatAgentRunner.js`

### Step 1: Write the module

```javascript
'use strict';

const chatIntentService = require('./chatIntentService');
const chatToolsService  = require('./chatToolsService');
const chatAnswerService = require('./chatAnswerService');

// Toggle via .env: CHAT_AGENT_MODE=function_calling activates FC mode after upgrade.
// Default is intent_routing (MVP).
const CHAT_AGENT_MODE = process.env.CHAT_AGENT_MODE || 'intent_routing';

/**
 * Main entry point for the chat agent.
 * chatService.js calls this and does NOT know which mode is active.
 *
 * @param {string} userMessage
 * @param {Array<{role:string, content:string}>} history  — last 6 DB messages
 * @param {{ type: string, regions: string[]|null, rtm: string|null }} regionScope
 * @returns {Promise<ReplyContent>}
 */
async function run(userMessage, history, regionScope) {
  if (CHAT_AGENT_MODE === 'function_calling') {
    return runFunctionCalling(userMessage, history, regionScope);
  }
  return runIntentRouting(userMessage, history, regionScope);
}

// ─── MVP mode: intent routing ─────────────────────────────────────────────────
async function runIntentRouting(userMessage, history, regionScope) {
  // LLM Call 1: classify intent
  const { intentType, entities } = await chatIntentService.classify(userMessage, history);

  // Dispatch to tool (or skip for unknown intent)
  let toolResult = null;
  if (intentType !== 'unknown') {
    // Map intent → tool name
    const toolMap = {
      progress_query: 'getOverviewData',
      project_status: 'getTaskListData',
      warning_query:  'getWarningsData',
      drill_down:     'getStoreDetailData',
    };
    const toolName = toolMap[intentType];
    if (toolName) {
      try {
        toolResult = chatToolsService.executeByName(toolName, entities, regionScope);
      } catch (err) {
        console.warn('[chatAgentRunner] Tool execution error:', err.message);
        toolResult = null;
      }
    }
  }

  // LLM Call 2: format answer
  const replyContent = await chatAnswerService.format(userMessage, toolResult, history);
  // Attach intent metadata for logging
  replyContent._intentType = intentType;
  return replyContent;
}

// ─── FC upgrade mode: function calling ────────────────────────────────────────
// This branch is NOT active in MVP. Enabled by: CHAT_AGENT_MODE=function_calling
// Requires utils/ai.js to expose a chatWithTools() method (see Task 9).
async function runFunctionCalling(userMessage, history, regionScope) {
  // Import lazily so MVP doesn't require chatWithTools to exist
  const { chatWithTools } = require('../utils/ai');

  const messages = [
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  // First LLM call: may request tool calls
  const response = await chatWithTools({
    messages,
    tools: chatToolsService.TOOL_SCHEMAS,
  });

  if (!response.tool_calls || response.tool_calls.length === 0) {
    // LLM answered directly without tools
    try {
      return JSON.parse(response.content);
    } catch {
      return { overview: response.content, keyNumbers: [], attentionPoints: [], followUpSuggestions: [] };
    }
  }

  // Execute all requested tools (synchronous, serial)
  const toolResults = response.tool_calls.map(tc =>
    chatToolsService.executeByName(
      tc.function.name,
      JSON.parse(tc.function.arguments),
      regionScope  // regionScope injected here — LLM never sees permission boundaries
    )
  );

  // Second LLM call: provide tool results, get final answer
  const finalMessages = [
    ...messages,
    { role: 'assistant', content: null, tool_calls: response.tool_calls },
    ...toolResults.map((result, i) => ({
      role: 'tool',
      tool_call_id: response.tool_calls[i].id,
      content: JSON.stringify(result),
    })),
  ];

  const finalResponse = await chatWithTools({
    messages: finalMessages,
    tools: chatToolsService.TOOL_SCHEMAS,
    tool_choice: 'none',
  });

  try {
    return JSON.parse(finalResponse.content);
  } catch {
    return { overview: finalResponse.content, keyNumbers: [], attentionPoints: [], followUpSuggestions: [] };
  }
}

module.exports = { run };
```

### Step 2: Verify the module loads

```bash
cd server && node -e "const r = require('./services/chatAgentRunner'); console.log('chatAgentRunner loaded, mode:', process.env.CHAT_AGENT_MODE || 'intent_routing'); console.log('OK');"
```

### Step 3: Commit

```bash
git add server/services/chatAgentRunner.js
git commit -m "feat(chat): add chatAgentRunner switching layer (intent_routing + FC-ready stub)"
```

---

## Task 6: chatService.js

Session lifecycle management: `createSession`, `sendMessage`, `getHistory`. This layer never changes between MVP and FC modes — it only calls `chatAgentRunner.run()`.

**Files:**
- Create: `server/services/chatService.js`

### Step 1: Write the module

```javascript
'use strict';

const { nanoid }       = require('nanoid');
const { db }           = require('../db');
const chatAgentRunner  = require('./chatAgentRunner');

// ─── Region scope resolver ────────────────────────────────────────────────────
/**
 * Read users.executive_regions / executive_rtm and resolve to a regionScope object.
 * NULL columns → national (MVP default: single account with full access).
 */
function resolveRegionScope(user) {
  if (user.executive_rtm) {
    return { type: 'rtm', rtm: user.executive_rtm, regions: null };
  }
  if (user.executive_regions) {
    try {
      const regions = JSON.parse(user.executive_regions);
      return { type: 'regional', regions, rtm: null };
    } catch {
      // Malformed JSON — fall through to national
    }
  }
  return { type: 'national', regions: null, rtm: null };
}

// ─── Dynamic example questions ────────────────────────────────────────────────
function buildExampleQuestions() {
  // Try to find the most recently created dispatched task for a contextual question
  const task = db.get(
    "SELECT title FROM tasks WHERE status = 'dispatched' ORDER BY created_at DESC LIMIT 1"
  );
  const taskRef = task ? `"${task.title}"` : '最近的';
  return [
    `${taskRef}培训完成率是多少？`,
    '有哪些门店需要重点关注？',
    '现在有哪些进行中的培训任务？',
  ];
}

// ─── createSession ────────────────────────────────────────────────────────────
/**
 * @param {number} userId  — req.user.id (JWT, integer)
 * @returns {{ sessionId: string, contextId: string, exampleQuestions: string[] }}
 */
function createSession(userId) {
  // Load user's executive scope columns
  const user = db.get(
    'SELECT id, executive_regions, executive_rtm FROM users WHERE id = ?',
    [userId]
  );
  if (!user) throw Object.assign(new Error('User not found'), { status: 404, code: 'CHAT_002' });

  const regionScope = resolveRegionScope(user);
  const sessionId = nanoid();
  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

  db.run(
    `INSERT INTO chat_sessions (id, user_id, role_scope, regions, rtm, created_at, last_active)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
      userId,
      regionScope.type,
      regionScope.regions ? JSON.stringify(regionScope.regions) : null,
      regionScope.rtm || null,
      now,
      now,
    ]
  );

  return {
    sessionId,
    contextId: sessionId,
    exampleQuestions: buildExampleQuestions(),
  };
}

// ─── sendMessage ──────────────────────────────────────────────────────────────
/**
 * @param {string} sessionId
 * @param {string} userMessage
 * @param {number} userId  — for ownership check
 * @returns {Promise<{ messageId, replyContent, responseTime, contextId, timestamp }>}
 */
async function sendMessage(sessionId, userMessage, userId) {
  // Ownership verified at route layer — double-check here for safety
  const session = db.get('SELECT * FROM chat_sessions WHERE id = ?', [sessionId]);
  if (!session) throw Object.assign(new Error('Session not found'), { status: 404, code: 'CHAT_003' });
  if (session.user_id !== userId) throw Object.assign(new Error('Forbidden'), { status: 403, code: 'CHAT_004' });

  // Restore regionScope from session row
  const regionScope = {
    type: session.role_scope,
    regions: session.regions ? JSON.parse(session.regions) : null,
    rtm: session.rtm || null,
  };

  // Load last 6 messages (3 rounds) for context
  const historyRows = db.all(
    `SELECT role, content FROM chat_messages
     WHERE session_id = ?
     ORDER BY created_at DESC LIMIT 6`,
    [sessionId]
  ).reverse(); // oldest first for LLM

  const history = historyRows.map(r => ({ role: r.role, content: r.content }));

  const startMs = Date.now();

  // Call agent (async LLM calls happen inside)
  const replyContent = await chatAgentRunner.run(userMessage, history, regionScope);
  const responseTime = Date.now() - startMs;

  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  const userMsgId  = nanoid();
  const assistMsgId = nanoid();
  const intentType = replyContent._intentType || null;
  delete replyContent._intentType; // don't leak internal field

  // Persist both messages (synchronous)
  db.run(
    'INSERT INTO chat_messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
    [userMsgId, sessionId, 'user', userMessage, now]
  );
  db.run(
    'INSERT INTO chat_messages (id, session_id, role, content, intent_type, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [assistMsgId, sessionId, 'assistant', JSON.stringify(replyContent), intentType, now]
  );

  // Touch last_active
  db.run('UPDATE chat_sessions SET last_active = ? WHERE id = ?', [now, sessionId]);

  return {
    messageId:    assistMsgId,
    replyContent,
    responseTime,
    contextId:    sessionId,
    timestamp:    now,
  };
}

// ─── getHistory ───────────────────────────────────────────────────────────────
/**
 * @param {string} sessionId
 * @param {number} pageNum   1-indexed
 * @param {number} pageSize
 * @returns {{ historyList, pagination }}
 */
function getHistory(sessionId, pageNum, pageSize) {
  const offset = (pageNum - 1) * pageSize;
  const totalRow = db.get(
    'SELECT COUNT(*) AS total FROM chat_messages WHERE session_id = ?',
    [sessionId]
  );
  const total = totalRow ? totalRow.total : 0;

  const rows = db.all(
    `SELECT id, role, content, intent_type, created_at
     FROM chat_messages
     WHERE session_id = ?
     ORDER BY created_at ASC
     LIMIT ? OFFSET ?`,
    [sessionId, pageSize, offset]
  );

  const historyList = rows.map(r => {
    const item = {
      messageId:  r.id,
      role:       r.role,
      content:    r.role === 'user' ? r.content : undefined,
      replyContent: r.role === 'assistant' ? (() => { try { return JSON.parse(r.content); } catch { return null; } })() : undefined,
      intentType: r.intent_type,
      timestamp:  r.created_at,
    };
    return item;
  });

  return {
    historyList,
    pagination: {
      pageNum,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

module.exports = { createSession, sendMessage, getHistory };
```

### Step 2: Verify module loads

```bash
cd server && node -e "const s = require('./services/chatService'); console.log(typeof s.createSession, typeof s.sendMessage, typeof s.getHistory); console.log('OK');"
```

### Step 3: Commit

```bash
git add server/services/chatService.js
git commit -m "feat(chat): add chatService (createSession, sendMessage, getHistory)"
```

---

## Task 7: routes/chat.js + app.js Registration

Wire up the HTTP routes and register them in the Express app.

**Files:**
- Create: `server/routes/chat.js`
- Modify: `server/app.js`

### Step 1: Create `server/routes/chat.js`

```javascript
'use strict';

const express      = require('express');
const { db }       = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { createError } = require('../middleware/errorHandler');
const chatService  = require('../services/chatService');

const router = express.Router();

// POST /api/v1/chat/executive/sessions
// Creates a new chat session for the authenticated executive.
router.post(
  '/executive/sessions',
  authenticate,
  requireRole(['executive']),
  (req, res, next) => {
    try {
      const result = chatService.createSession(req.user.id);
      res.json({ code: 200, message: '会话创建成功', data: result, requestId: req.requestId });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/chat/executive/sessions/:sessionId/messages
// Sends a message and returns the agent's structured reply.
router.post(
  '/executive/sessions/:sessionId/messages',
  authenticate,
  requireRole(['executive']),
  async (req, res, next) => {
    try {
      const { sessionId } = req.params;
      const { content } = req.body;

      if (!content || !content.trim()) {
        throw createError(400, 'content 不能为空', 'CHAT_005');
      }

      // Ownership check: ensure session belongs to this user
      const session = db.get('SELECT user_id FROM chat_sessions WHERE id = ?', [sessionId]);
      if (!session) throw createError(404, '会话不存在', 'CHAT_003');
      if (session.user_id !== req.user.id) throw createError(403, '无权访问此会话', 'CHAT_004');

      const result = await chatService.sendMessage(sessionId, content.trim(), req.user.id);
      res.json({ code: 200, message: 'success', data: result, requestId: req.requestId });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/chat/executive/sessions/:sessionId/history
// Returns paginated chat message history.
router.get(
  '/executive/sessions/:sessionId/history',
  authenticate,
  requireRole(['executive']),
  (req, res, next) => {
    try {
      const { sessionId } = req.params;
      const pageNum  = Math.max(1, parseInt(req.query.pageNum, 10) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));

      // Ownership check
      const session = db.get('SELECT user_id FROM chat_sessions WHERE id = ?', [sessionId]);
      if (!session) throw createError(404, '会话不存在', 'CHAT_003');
      if (session.user_id !== req.user.id) throw createError(403, '无权访问此会话', 'CHAT_004');

      const data = chatService.getHistory(sessionId, pageNum, pageSize);
      res.json({
        code: 200, message: 'success',
        data: { sessionId, ...data },
        requestId: req.requestId,
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
```

### Step 2: Register in `server/app.js`

Add the import near the other route imports (after `mypalRoutes`):

```javascript
const chatRoutes = require('./routes/chat');
```

Add the route registration after `app.use('/api/v1/mypal', mypalRoutes)`:

```javascript
app.use('/api/v1/chat', chatRoutes);
```

### Step 3: Smoke test the full HTTP flow

Start the server: `cd server && node app.js`

Run the integration test:

```bash
#!/usr/bin/env bash
# Test EChat HTTP flow
set -e
BASE="http://localhost:${PORT:-3000}/api/v1"

# Login as executive
R=$(curl -s -X POST "$BASE/auth/login" -H "Content-Type: application/json" \
  -d '{"username":"executive","password":"Train2026!"}')
TOKEN=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['token'])")
echo "Login OK"

# Create session
R=$(curl -s -X POST "$BASE/chat/executive/sessions" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")
echo "$R" | python3 -c "
import json,sys
d=json.load(sys.stdin)
assert d.get('code')==200, d
assert 'sessionId' in d['data'], d
assert 'exampleQuestions' in d['data'], d
print('createSession OK, sessionId:', d['data']['sessionId'])
"
SESSION_ID=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['sessionId'])")

# Send a message
R=$(curl -s -X POST "$BASE/chat/executive/sessions/$SESSION_ID/messages" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"content":"现在有哪些进行中的培训任务？"}')
echo "$R" | python3 -c "
import json,sys
d=json.load(sys.stdin)
assert d.get('code')==200, d
rc=d['data']['replyContent']
assert 'overview' in rc, rc
assert isinstance(rc['keyNumbers'], list), rc
assert isinstance(rc['followUpSuggestions'], list), rc
print('sendMessage OK, overview:', rc['overview'][:50])
"

# Get history
R=$(curl -s "$BASE/chat/executive/sessions/$SESSION_ID/history?pageNum=1&pageSize=10" \
  -H "Authorization: Bearer $TOKEN")
echo "$R" | python3 -c "
import json,sys
d=json.load(sys.stdin)
assert d.get('code')==200, d
assert d['data']['pagination']['total'] >= 2, d['data']['pagination']
print('getHistory OK, total messages:', d['data']['pagination']['total'])
"

echo "ALL EChat HTTP tests PASSED"
```

Save to `server/test-echat.sh` and run: `cd server && bash test-echat.sh`

### Step 4: Test error cases

```bash
# 401 without token
R=$(curl -s -X POST "$BASE/chat/executive/sessions" -H "Content-Type: application/json")
[ "$(echo $R | python3 -c "import sys,json; print(json.load(sys.stdin)['code'])")" = "401" ] && echo "401 OK"

# 403 with central token (wrong role)
R2=$(curl -s -X POST "$BASE/auth/login" -H "Content-Type: application/json" \
  -d '{"username":"central","password":"Train2026!"}')
CENTRAL_TOKEN=$(echo "$R2" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")
R=$(curl -s -X POST "$BASE/chat/executive/sessions" \
  -H "Authorization: Bearer $CENTRAL_TOKEN" -H "Content-Type: application/json")
[ "$(echo $R | python3 -c "import sys,json; print(json.load(sys.stdin)['code'])")" = "403" ] && echo "403 role guard OK"
```

### Step 5: Commit

```bash
git add server/routes/chat.js server/app.js server/test-echat.sh
git commit -m "feat(chat): add chat routes + register in app.js, add integration test"
```

---

## Task 8: Documentation Updates

**Files:**
- Modify: `TOT_backend/docs/specs/04-API-SPEC.md` (§6 status)
- Modify: `TOT_backend/docs/backend/03-DATABASE.md` (add chat tables)
- Modify: `TOT_backend/docs/specs/01-DATA-MODEL.md` (§10 new section)

### Step 1: Update `04-API-SPEC.md` §6 header

Find the line in §6:
```
> **与实现对齐**：当前仓库 **`server/app.js` 未挂载** `/api/v1/chat/*`
```

Update it to reflect the implementation status:
```
> **与实现对齐**：`/api/v1/chat/*` 已挂载于 `server/app.js`。当前实现模式为 `intent_routing`（MVP），通过环境变量 `CHAT_AGENT_MODE=function_calling` 可切换至 FC 模式（需完成 Task 9 升级步骤）。`/api/v1/ai/*` 与 `/api/v1/permissions/check` 仍为 P1（未挂载）。
```

### Step 2: Update `03-DATABASE.md` table summary

In the summary table at the top of `03-DATABASE.md`, add two rows after `mypal_learning_mock`:

```markdown
| `chat_sessions` | EChat 会话表，含 `user_id`、`role_scope`、`regions`、`rtm` |
| `chat_messages` | EChat 消息表，含 `role`、`content`（JSON）、`intent_type` |
```

Then add two new sections at the end of the file:

```markdown
## 10. chat_sessions 表

```sql
CREATE TABLE IF NOT EXISTS chat_sessions (
  id          TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  role_scope  TEXT NOT NULL CHECK (role_scope IN ('national', 'regional', 'rtm')),
  regions     TEXT,
  rtm         TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  last_active TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**迁移说明：** `server/db/index.js` 的 `ensureChatTables` 自动建表（新库由 `schema.sql` 建）。

---

## 11. chat_messages 表

```sql
CREATE TABLE IF NOT EXISTS chat_messages (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES chat_sessions(id),
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content     TEXT NOT NULL,
  intent_type TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cm_session_id ON chat_messages(session_id);
```

**字段说明：** `role='user'` 时 content 为原始提问文本；`role='assistant'` 时 content 为 JSON 序列化的 `ReplyContent` 对象。`intent_type` 仅 assistant 行填写。
```

### Step 3: Add §10 to `01-DATA-MODEL.md`

Append after the `## 数据量预估（MVP Mock）` section:

```markdown
## 10. chat_sessions / chat_messages（Executive Chat）

见 `docs/backend/03-DATABASE.md §10-11`。
迁移函数：`migrateUsersExecutiveScope`（补 `users.executive_regions` / `executive_rtm`）、`ensureChatTables`。
```

### Step 4: Commit

```bash
git add TOT_backend/docs/specs/04-API-SPEC.md \
        TOT_backend/docs/backend/03-DATABASE.md \
        TOT_backend/docs/specs/01-DATA-MODEL.md
git commit -m "docs: update API spec, DB docs, data model for EChat implementation"
```

---

## Task 9: FC Upgrade — chatWithTools + chatAgentRunner FC Branch

This task completes the MVP terminal state. Enable via `CHAT_AGENT_MODE=function_calling` in `.env`.

**Files:**
- Modify: `server/utils/ai.js`
- (No changes to `server/services/chatAgentRunner.js` — the `runFunctionCalling` branch was already written in Task 5)

### Step 1: Add `chatWithTools` to `server/utils/ai.js`

Add the following function after `generateTextDeepSeek` and before `module.exports`:

```javascript
/**
 * OpenAI-compatible chat completions with optional tool/function calling.
 * Used by chatAgentRunner.js in function_calling mode.
 *
 * @param {{
 *   messages: Array<{role:string, content:string|null, tool_calls?: any, tool_call_id?: string}>,
 *   tools?: object[],
 *   tool_choice?: 'auto'|'none'|object,
 *   model?: string,
 *   temperature?: number,
 *   maxTokens?: number
 * }} options
 * @returns {Promise<{ content: string|null, tool_calls: any[]|null }>}
 */
async function chatWithTools(options) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || String(apiKey).trim() === '') {
    throw new Error('DEEPSEEK_API_KEY is not set');
  }

  const body = {
    model: options.model || 'deepseek-chat',
    messages: options.messages,
    temperature: options.temperature ?? 0.1,
    max_tokens: options.maxTokens ?? 2048,
    stream: false,
  };

  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
    body.tool_choice = options.tool_choice || 'auto';
  }

  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'User-Agent': 'TOT-Apple-Backend/1.0',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepSeek chatWithTools failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];
  if (!choice) throw new Error('DeepSeek returned no choices');

  return {
    content:    choice.message?.content ?? null,
    tool_calls: choice.message?.tool_calls ?? null,
  };
}
```

Update `module.exports` at the bottom:

```javascript
module.exports = {
  generateText,
  generateTextDeepSeek,
  chatWithTools,
};
```

### Step 2: Test FC mode end-to-end

```bash
cd server
CHAT_AGENT_MODE=function_calling node -e "
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const runner = require('./services/chatAgentRunner');
const scope = { type: 'national', regions: null, rtm: null };
(async () => {
  const r = await runner.run('现在有哪些培训任务？', [], scope);
  console.log('FC mode overview:', r.overview);
  if (!r.overview) throw new Error('empty overview');
  console.log('FC mode OK');
})().catch(e => { console.error(e); process.exit(1); });
"
```

### Step 3: Verify intent_routing mode still works

```bash
cd server
node -e "
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const runner = require('./services/chatAgentRunner');
const scope = { type: 'national', regions: null, rtm: null };
(async () => {
  const r = await runner.run('现在有哪些培训任务？', [], scope);
  console.log('intent_routing overview:', r.overview);
  console.log('intent_routing mode OK');
})().catch(e => { console.error(e); process.exit(1); });
"
```

### Step 4: Commit

```bash
git add server/utils/ai.js
git commit -m "feat(chat): add chatWithTools to utils/ai.js — enables FC upgrade via CHAT_AGENT_MODE=function_calling"
```

---

## Final Verification

Run the full integration test after all tasks are complete:

```bash
cd server && bash test-echat.sh
```

Expected: `ALL EChat HTTP tests PASSED`

Verify DB tables:
```bash
cd server && node -e "
const { getDb } = require('./db');
const db = getDb();
const tables = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all().map(r=>r.name);
['chat_sessions','chat_messages'].forEach(t => {
  if (!tables.includes(t)) throw new Error('Missing table: ' + t);
});
console.log('DB tables OK');
const cols = db.prepare('PRAGMA table_info(users)').all().map(c=>c.name);
['executive_regions','executive_rtm'].forEach(c => {
  if (!cols.includes(c)) throw new Error('Missing column: users.' + c);
});
console.log('users columns OK');
"
```

---

## New Files Summary

| File | Purpose |
|------|---------|
| `server/services/chatToolsService.js` | TOOL_SCHEMAS + executeByName + 4 DB query functions |
| `server/services/chatIntentService.js` | LLM Call 1: intent classification (DeepSeek, temp=0) |
| `server/services/chatAnswerService.js` | LLM Call 2: answer formatting (DeepSeek, temp=0.3) |
| `server/services/chatAgentRunner.js` | Switching layer: intent_routing (MVP) + FC stub |
| `server/services/chatService.js` | Session CRUD + sendMessage orchestration |
| `server/routes/chat.js` | HTTP routes for 3 EChat endpoints |
| `server/test-echat.sh` | Integration test script |

## Modified Files Summary

| File | Change |
|------|--------|
| `server/db/schema.sql` | Add `chat_sessions`, `chat_messages` DDL |
| `server/db/index.js` | Add `migrateUsersExecutiveScope` + `ensureChatTables` |
| `server/app.js` | Register `/api/v1/chat` route |
| `server/utils/ai.js` | Add `chatWithTools` (Task 9) |
| `docs/specs/04-API-SPEC.md` | Update §6 implementation status |
| `docs/backend/03-DATABASE.md` | Add chat table sections |
| `docs/specs/01-DATA-MODEL.md` | Add §10 reference |
