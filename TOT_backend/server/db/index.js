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
  }
  return _db;
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
