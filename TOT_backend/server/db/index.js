'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'database.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let _db;

function getDb() {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');

    // 初始化表结构
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    _db.exec(schema);
    migrateEmployeesEmail(_db);
    ensureEmployeesEmailIndex(_db);
    ensureMypalLearningMockIndexes(_db);
    migrateTasksMypalColumns(_db);
    migrateNudgeRecordsConstraints(_db);
    migrateNotificationEventsContent(_db);
    migrateUsersExecutiveScope(_db);
    migrateUsersLastLoginAt(_db);
    ensureChatTables(_db);
    migrateDashboardInsightCounts(_db);
    migrateDashboardInsightModuleTypes(_db);
  }
  return _db;
}

/** 旧库补 `dashboard_insights.up_count` / `down_count` 列（与当前 schema 一致）。 */
function migrateDashboardInsightCounts(database) {
  const exists = database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='dashboard_insights'")
    .get();
  if (!exists) return;

  const names = new Set(
    database.prepare('PRAGMA table_info(dashboard_insights)').all().map((c) => c.name)
  );
  if (!names.has('up_count')) {
    database.exec('ALTER TABLE dashboard_insights ADD COLUMN up_count INTEGER NOT NULL DEFAULT 0');
  }
  if (!names.has('down_count')) {
    database.exec('ALTER TABLE dashboard_insights ADD COLUMN down_count INTEGER NOT NULL DEFAULT 0');
  }
}

/** 已有库将 dashboard_insights.module_type 口径迁移为新 insightType 枚举。 */
function migrateDashboardInsightModuleTypes(database) {
  const row = database
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='dashboard_insights'")
    .get();
  const ddl = (row && row.sql) || '';
  const isNewEnum = ddl.includes(
    "CHECK (module_type IN ('north_star', 'completion_weekly', 'completion_daily', 'channel_north_star', 'funnel_alerts'))"
  );
  if (isNewEnum) return;

  database.exec('BEGIN');
  try {
    database.exec('ALTER TABLE dashboard_insights RENAME TO dashboard_insights_old');
    database.exec(`
      CREATE TABLE dashboard_insights (
        id                  TEXT PRIMARY KEY,
        module_type         TEXT NOT NULL
                              CHECK (module_type IN ('north_star', 'completion_weekly', 'completion_daily', 'channel_north_star', 'funnel_alerts')),
        task_id             TEXT REFERENCES tasks(id),
        filter_rtm          TEXT,
        filter_format       TEXT,
        filter_dealer_name  TEXT,
        filter_store_id     TEXT REFERENCES stores(id),
        extra_params_json   TEXT,
        content             TEXT NOT NULL,
        context_json        TEXT,
        up_count            INTEGER NOT NULL DEFAULT 0 CHECK (up_count >= 0),
        down_count          INTEGER NOT NULL DEFAULT 0 CHECK (down_count >= 0),
        created_by          INTEGER NOT NULL REFERENCES users(id),
        created_at          TEXT NOT NULL DEFAULT (datetime('now')),
        CHECK (extra_params_json IS NULL OR (json_valid(extra_params_json) AND json_type(extra_params_json) = 'object')),
        CHECK (context_json IS NULL OR (json_valid(context_json) AND json_type(context_json) = 'object'))
      )
    `);
    database.exec(`
      INSERT INTO dashboard_insights (
        id, module_type, task_id, filter_rtm, filter_format, filter_dealer_name, filter_store_id,
        extra_params_json, content, context_json, up_count, down_count, created_by, created_at
      )
      SELECT
        id,
        CASE module_type
          WHEN 'funnel' THEN 'north_star'
          WHEN 'trend' THEN
            CASE
              WHEN json_extract(COALESCE(extra_params_json, '{}'), '$.trendType') = 'hourly'
                THEN 'completion_daily'
              ELSE 'completion_weekly'
            END
          WHEN 'heatmap_rank' THEN 'channel_north_star'
          WHEN 'warning_stats' THEN 'funnel_alerts'
          ELSE 'north_star'
        END AS module_type,
        task_id, filter_rtm, filter_format, filter_dealer_name, filter_store_id,
        extra_params_json, content, context_json,
        COALESCE(up_count, 0), COALESCE(down_count, 0), created_by, created_at
      FROM dashboard_insights_old
    `);
    database.exec('DROP TABLE dashboard_insights_old');
    database.exec('CREATE INDEX IF NOT EXISTS idx_di_module_task ON dashboard_insights(module_type, task_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_di_created_at ON dashboard_insights(created_at)');
    database.exec('COMMIT');
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}

/** 已有库补列：employees.email（MyPal 按邮箱对齐） */
function migrateEmployeesEmail(database) {
  const cols = database.prepare('PRAGMA table_info(employees)').all();
  if (cols.some((c) => c.name === 'email')) return;
  database.exec('ALTER TABLE employees ADD COLUMN email TEXT');
}

/** 在 email 列存在后创建唯一索引（新库与迁移后库共用） */
function ensureEmployeesEmailIndex(database) {
  const cols = database.prepare('PRAGMA table_info(employees)').all();
  if (!cols.some((c) => c.name === 'email')) return;
  database.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_email ON employees(email) WHERE email IS NOT NULL'
  );
}

/**
 * 已有库补齐：mypal_learning_mock 索引（开发联调表）。
 * schema.sql 使用 IF NOT EXISTS，这里做二次确保以覆盖旧库缺索引的情况。
 */
/** 已有库补列：tasks.mypal_task_week / mypal_product_name（MyPal 对接） */
function migrateTasksMypalColumns(database) {
  const cols = database.prepare('PRAGMA table_info(tasks)').all();
  const names = new Set(cols.map((c) => c.name));
  if (!names.has('mypal_task_week')) {
    database.exec('ALTER TABLE tasks ADD COLUMN mypal_task_week TEXT');
  }
  if (!names.has('mypal_product_name')) {
    database.exec('ALTER TABLE tasks ADD COLUMN mypal_product_name TEXT');
  }
}

/** 已有库补列：notification_events.content（催办文案等） */
function migrateNotificationEventsContent(database) {
  const cols = database.prepare('PRAGMA table_info(notification_events)').all();
  if (cols.some((c) => c.name === 'content')) return;
  database.exec('ALTER TABLE notification_events ADD COLUMN content TEXT');
}

/** 已有库补列：users.executive_regions / executive_rtm（EChat 辖区绑定） */
function migrateUsersExecutiveScope(database) {
  const cols = database.prepare('PRAGMA table_info(users)').all();
  const names = new Set(cols.map((c) => c.name));
  if (!names.has('executive_regions')) {
    database.exec('ALTER TABLE users ADD COLUMN executive_regions TEXT');
  }
  if (!names.has('executive_rtm')) {
    database.exec('ALTER TABLE users ADD COLUMN executive_rtm TEXT');
  }
}

/** 已有库补列：users.last_login_at（登录时间戳记录） */
function migrateUsersLastLoginAt(database) {
  const cols = database.prepare('PRAGMA table_info(users)').all();
  if (cols.some((c) => c.name === 'last_login_at')) return;
  database.exec('ALTER TABLE users ADD COLUMN last_login_at TEXT');
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

function ensureMypalLearningMockIndexes(database) {
  const row = database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='mypal_learning_mock'")
    .get();
  if (!row) return;

  database.exec(
    'CREATE INDEX IF NOT EXISTS idx_mypal_mock_seed_id ON mypal_learning_mock(seed_id)'
  );
  database.exec(
    'CREATE INDEX IF NOT EXISTS idx_mypal_mock_task_week ON mypal_learning_mock(task_week)'
  );
}

/**
 * 已有库补齐 nudge_records 约束：
 * - target_type 枚举
 * - severity 枚举
 * - notification_event_ids JSON array
 */
function migrateNudgeRecordsConstraints(database) {
  const ddlRow = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'nudge_records'")
    .get();
  const ddl = (ddlRow && ddlRow.sql) || '';
  const hasTargetTypeCheck = ddl.includes("CHECK (target_type IN ('employee', 'store', 'region'))");
  const hasSeverityCheck = ddl.includes("CHECK (severity IN ('yellow', 'red'))");
  const hasEventIdsJsonCheck = ddl.includes(
    "CHECK (json_valid(notification_event_ids) AND json_type(notification_event_ids) = 'array')"
  );
  if (hasTargetTypeCheck && hasSeverityCheck && hasEventIdsJsonCheck) return;

  database.exec('BEGIN');
  try {
    database.exec('ALTER TABLE nudge_records RENAME TO nudge_records_old');
    database.exec(`
      CREATE TABLE nudge_records (
        id                     TEXT PRIMARY KEY,
        task_id                TEXT NOT NULL REFERENCES tasks(id),
        target_type            TEXT NOT NULL CHECK (target_type IN ('employee', 'store', 'region')),
        target_id              TEXT NOT NULL,
        initiator_id           INTEGER NOT NULL REFERENCES users(id),
        severity               TEXT NOT NULL CHECK (severity IN ('yellow', 'red')),
        notification_event_ids TEXT NOT NULL,
        created_at             TEXT NOT NULL DEFAULT (datetime('now')),
        CHECK (json_valid(notification_event_ids) AND json_type(notification_event_ids) = 'array')
      )
    `);
    database.exec(`
      INSERT INTO nudge_records (
        id, task_id, target_type, target_id, initiator_id, severity, notification_event_ids, created_at
      )
      SELECT
        id, task_id, target_type, target_id, initiator_id, severity, notification_event_ids, created_at
      FROM nudge_records_old
    `);
    database.exec('DROP TABLE nudge_records_old');
    database.exec('CREATE INDEX IF NOT EXISTS idx_nr_task_id ON nudge_records(task_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_nr_initiator_id ON nudge_records(initiator_id)');
    database.exec('COMMIT');
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}

const db = {
  /** 查询单行，无结果返回 null */
  get(sql, params = []) {
    return getDb().prepare(sql).get(...params) ?? null;
  },

  /** 查询多行，无结果返回 [] */
  all(sql, params = []) {
    return getDb().prepare(sql).all(...params);
  },

  /** 执行写操作，返回 { lastInsertRowid, changes } */
  run(sql, params = []) {
    return getDb().prepare(sql).run(...params);
  },

  /** 事务包装：fn 无参数，fn 内抛出则自动回滚 */
  transaction(fn) {
    return getDb().transaction(fn)();
  },
};

module.exports = { db, getDb };
