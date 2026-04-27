'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'database.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let _db;

function ensureAgentGuidelinesTable(database) {
  // 如果旧表存在（本地测试残留），先 drop 掉，保持干净
  database.exec('DROP TABLE IF EXISTS dashboard_guidelines');
  
  database.exec(`
    CREATE TABLE IF NOT EXISTS agent_guidelines (
      id          TEXT PRIMARY KEY,
      agent_type  TEXT NOT NULL,
      rule_text   TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_ag_type ON agent_guidelines(agent_type)');
}

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
    migrateTasksSubTasksConfig(_db);
    migrateNudgeRecordsConstraints(_db);
    migrateNotificationEventsConstraints(_db);
    repairReadReceiptsNotificationForeignKey(_db);
    migrateNotificationEventsContent(_db);
    migrateUsersExecutiveScope(_db);
    migrateUsersLastLoginAt(_db);
    ensureChatTables(_db);
    migrateChatMessagesAgentSupport(_db);
    migrateChatMessagesIdempotency(_db);
    ensureChatFeedbackTable(_db);
    ensureUserMemoriesTable(_db);
    migrateDashboardInsightCounts(_db);
    migrateDashboardInsightModuleTypes(_db);
    ensureAgentGuidelinesTable(_db);
  }
  return _db;
}

/** 旧库补 `chat_messages.client_message_id` 列。 */
function migrateChatMessagesIdempotency(database) {
  const names = new Set(
    database.prepare('PRAGMA table_info(chat_messages)').all().map((c) => c.name)
  );
  if (!names.has('client_message_id')) {
    database.exec('ALTER TABLE chat_messages ADD COLUMN client_message_id TEXT');
    database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_cm_client_msg_id ON chat_messages(client_message_id)');
  }
}

/** 确保 `user_memories` 表存在。 */
function ensureUserMemoriesTable(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS user_memories (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      memory_hash TEXT NOT NULL,
      memory_type TEXT DEFAULT 'bias',
      content TEXT NOT NULL,
      confidence_score REAL DEFAULT 0.5,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      UNIQUE(user_id, memory_hash)
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_um_user_id ON user_memories(user_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_um_hash    ON user_memories(memory_hash)');
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
    "CHECK (module_type IN ('north_star', 'completion_weekly', 'completion_daily', 'channel_north_star', 'funnel_alerts', 'global_agent'))"
  );
  if (isNewEnum) return;

  database.exec('BEGIN');
  try {
    database.exec('ALTER TABLE dashboard_insights RENAME TO dashboard_insights_old');
    database.exec(`
      CREATE TABLE dashboard_insights (
        id                  TEXT PRIMARY KEY,
        module_type         TEXT NOT NULL
                              CHECK (module_type IN ('north_star', 'completion_weekly', 'completion_daily', 'channel_north_star', 'funnel_alerts', 'global_agent', 'conversion_funnel')),
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
        created_at          TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
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

/** 已有库补列：tasks.sub_tasks_config（子任务独立配置） */
function migrateTasksSubTasksConfig(database) {
  const cols = database.prepare('PRAGMA table_info(tasks)').all();
  if (cols.some((c) => c.name === 'sub_tasks_config')) return;
  database.exec('ALTER TABLE tasks ADD COLUMN sub_tasks_config TEXT');
}

/** 已有库补列：notification_events.content（催办文案等） */
function migrateNotificationEventsContent(database) {
  const cols = database.prepare('PRAGMA table_info(notification_events)').all();
  if (cols.some((c) => c.name === 'content')) return;
  database.exec('ALTER TABLE notification_events ADD COLUMN content TEXT');
}

/** 
 * 已有库补齐 notification_events 约束以支持 orange 预警级别
 */
function migrateNotificationEventsConstraints(database) {
  const ddlRow = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'notification_events'")
    .get();
  const ddl = (ddlRow && ddlRow.sql) || '';
  const hasEventOrange = ddl.includes("'nudge_orange'");
  const hasSeverityOrange = ddl.includes("'orange'");
  if (hasEventOrange && hasSeverityOrange) return;

  // sqlite要求禁用外键检查才能使用 DROP TABLE 并替换有外键引用的表
  // 注意：不要使用 *_old 命名，避免历史 SQLite 外键文本被错误固化到旧表名
  const tmpTable = 'notification_events_migration_tmp';
  database.pragma('foreign_keys = OFF');
  database.exec('BEGIN');
  try {
    database.exec(`DROP TABLE IF EXISTS ${tmpTable}`);
    database.exec(`ALTER TABLE notification_events RENAME TO ${tmpTable}`);
    database.exec(`
      CREATE TABLE notification_events (
        id             TEXT PRIMARY KEY,
        task_id        TEXT NOT NULL REFERENCES tasks(id),
        assignment_id  TEXT REFERENCES task_assignments(id),
        target_user_id TEXT NOT NULL REFERENCES employees(id),
        store_id       TEXT NOT NULL REFERENCES stores(id),
        event_type     TEXT NOT NULL CHECK (event_type IN ('task_assigned', 'nudge_yellow', 'nudge_orange', 'nudge_red', 'task_updated', 'task_deleted')),
        severity       TEXT CHECK (severity IS NULL OR severity IN ('yellow', 'orange', 'red')),
        dedupe_key     TEXT,
        content        TEXT,
        initiator_id   INTEGER REFERENCES users(id),
        created_at     TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        CHECK (
          (event_type = 'task_assigned' AND dedupe_key IS NOT NULL AND assignment_id IS NOT NULL)
          OR (event_type IN ('nudge_yellow', 'nudge_orange', 'nudge_red') AND severity IS NOT NULL AND assignment_id IS NOT NULL)
          OR (event_type IN ('task_updated', 'task_deleted'))
        )
      )
    `);
    
    // Check if content column existed in the old table
    const cols = database.prepare(`PRAGMA table_info(${tmpTable})`).all();
    const hasContent = cols.some((c) => c.name === 'content');
    
    if (hasContent) {
      database.exec(`
        INSERT INTO notification_events (
          id, task_id, assignment_id, target_user_id, store_id, event_type, severity, dedupe_key, content, initiator_id, created_at
        )
        SELECT
          id, task_id, assignment_id, target_user_id, store_id, event_type, severity, dedupe_key, content, initiator_id, created_at
        FROM ${tmpTable}
      `);
    } else {
      database.exec(`
        INSERT INTO notification_events (
          id, task_id, assignment_id, target_user_id, store_id, event_type, severity, dedupe_key, initiator_id, created_at
        )
        SELECT
          id, task_id, assignment_id, target_user_id, store_id, event_type, severity, dedupe_key, initiator_id, created_at
        FROM ${tmpTable}
      `);
    }
    
    database.exec(`DROP TABLE ${tmpTable}`);
    database.exec('CREATE INDEX IF NOT EXISTS idx_ne_target_user_id ON notification_events(target_user_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_ne_store_id       ON notification_events(store_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_ne_task_id        ON notification_events(task_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_ne_event_type     ON notification_events(event_type)');
    database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_ne_dedupe  ON notification_events(dedupe_key) WHERE dedupe_key IS NOT NULL');
    
    database.exec('COMMIT');
  } catch (err) {
    database.exec('ROLLBACK');
    console.error('Migration NotificationEventsConstraints failed:', err);
  } finally {
    database.pragma('foreign_keys = ON');
  }
}

/**
 * 修复历史迁移遗留：`read_receipts.event_id` 可能未正确指向 `notification_events`。
 * 通过外键元数据检测并重建 `read_receipts`，不依赖旧表命名字符串。
 */
function repairReadReceiptsNotificationForeignKey(database) {
  const fkRows = database.prepare('PRAGMA foreign_key_list(read_receipts)').all();
  const eventFk = fkRows.find((r) => r.from === 'event_id');
  if (eventFk && eventFk.table === 'notification_events') return;

  database.pragma('foreign_keys = OFF');
  database.exec('BEGIN');
  try {
    database.exec('ALTER TABLE read_receipts RENAME TO read_receipts_old');
    database.exec(`
      CREATE TABLE read_receipts (
        id       TEXT PRIMARY KEY,
        event_id TEXT NOT NULL REFERENCES notification_events(id),
        user_id  TEXT NOT NULL REFERENCES employees(id),
        read_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        source   TEXT NOT NULL CHECK (source IN ('notification_click', 'task_detail_open'))
      )
    `);
    database.exec(`
      INSERT INTO read_receipts (id, event_id, user_id, read_at, source)
      SELECT id, event_id, user_id, read_at, source
      FROM read_receipts_old
    `);
    database.exec('DROP TABLE read_receipts_old');
    database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_rr_event_user ON read_receipts(event_id, user_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_rr_user_id ON read_receipts(user_id)');
    database.exec('COMMIT');
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  } finally {
    database.pragma('foreign_keys = ON');
  }
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
      created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      last_active TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id          TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL REFERENCES chat_sessions(id),
      role        TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
      content     TEXT NOT NULL,
      intent_type TEXT,
      tool_calls  TEXT,
      tool_call_id TEXT,
      client_message_id TEXT UNIQUE,
      created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);
  database.exec(
    'CREATE INDEX IF NOT EXISTS idx_cm_session_id ON chat_messages(session_id)'
    );
}

/**
 * Executive Chat Agent：chatService 会写入 tool_calls / tool_call_id，且 role 可能为 tool。
 * 旧库仅有 user|assistant 且无上述列时，会导致保存消息 SQL 失败 → 前端 500。
 */
function migrateChatMessagesAgentSupport(database) {
  const exists = database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chat_messages'")
    .get();
  if (!exists) return;

  const cols = database.prepare('PRAGMA table_info(chat_messages)').all();
  const colNames = new Set(cols.map((c) => c.name));
  const ddlRow = database
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='chat_messages'")
    .get();
  const ddl = (ddlRow && ddlRow.sql) || '';

  const hasToolInCheck = ddl.includes("'tool'");
  const hasToolCallsCol = colNames.has('tool_calls');
  const hasToolCallIdCol = colNames.has('tool_call_id');

  if (hasToolInCheck && hasToolCallsCol && hasToolCallIdCol) return;

  if (hasToolInCheck) {
    if (!hasToolCallsCol) database.exec('ALTER TABLE chat_messages ADD COLUMN tool_calls TEXT');
    if (!hasToolCallIdCol) database.exec('ALTER TABLE chat_messages ADD COLUMN tool_call_id TEXT');
    return;
  }

  database.exec('PRAGMA foreign_keys = OFF');
  database.exec('BEGIN');
  try {
    database.exec(`
      CREATE TABLE chat_messages_migrated (
        id           TEXT PRIMARY KEY,
        session_id   TEXT NOT NULL REFERENCES chat_sessions(id),
        role         TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
        content      TEXT NOT NULL,
        intent_type  TEXT,
        tool_calls   TEXT,
        tool_call_id TEXT,
        client_message_id TEXT UNIQUE,
        created_at   TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
      )
    `);

    const selIntent = colNames.has('intent_type') ? 'intent_type' : 'NULL';
    const selTc = colNames.has('tool_calls') ? 'tool_calls' : 'NULL';
    const selTid = colNames.has('tool_call_id') ? 'tool_call_id' : 'NULL';
    const selCmid = colNames.has('client_message_id') ? 'client_message_id' : 'NULL';

    database.exec(`
      INSERT INTO chat_messages_migrated (id, session_id, role, content, intent_type, tool_calls, tool_call_id, client_message_id, created_at)
      SELECT id, session_id, role, content, ${selIntent}, ${selTc}, ${selTid}, ${selCmid}, created_at
      FROM chat_messages
    `);

    database.exec('DROP TABLE chat_messages');
    database.exec('ALTER TABLE chat_messages_migrated RENAME TO chat_messages');
    database.exec('CREATE INDEX IF NOT EXISTS idx_cm_session_id ON chat_messages(session_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_cm_client_msg_id ON chat_messages(client_message_id)');
    database.exec('COMMIT');
  } catch (err) {
    try {
      database.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    database.exec('PRAGMA foreign_keys = ON');
  }
}

/** 创建 chat_message_feedback 表 */
function ensureChatFeedbackTable(database) {
    database.exec(`
    CREATE TABLE IF NOT EXISTS chat_message_feedback (
      id            TEXT PRIMARY KEY,
      message_id    TEXT NOT NULL REFERENCES chat_messages(id),
      user_id       INTEGER NOT NULL REFERENCES users(id),
      feedback_type TEXT NOT NULL CHECK (feedback_type IN ('like', 'dislike')),
      created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      UNIQUE(message_id, user_id)
    )
    `);
    database.exec(
    'CREATE INDEX IF NOT EXISTS idx_cmf_message_id ON chat_message_feedback(message_id)'
    );
    database.exec(
    'CREATE INDEX IF NOT EXISTS idx_cmf_user_id ON chat_message_feedback(user_id)'
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
  const hasSeverityCheck = ddl.includes("CHECK (severity IN ('yellow', 'orange', 'red'))");
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
        severity               TEXT NOT NULL CHECK (severity IN ('yellow', 'orange', 'red')),
        notification_event_ids TEXT NOT NULL,
        created_at             TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
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
