PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- 1. stores
CREATE TABLE IF NOT EXISTS stores (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  region      TEXT NOT NULL,
  city        TEXT NOT NULL,
  rtm         TEXT NOT NULL,
  format      TEXT,
  dealer_name TEXT
);

-- 2. employees
CREATE TABLE IF NOT EXISTS employees (
  id         TEXT PRIMARY KEY,
  store_id   TEXT NOT NULL REFERENCES stores(id),
  name       TEXT NOT NULL,
  role       TEXT NOT NULL,
  email      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_emp_store_id ON employees(store_id);

-- 3. users
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL,
  store_id      TEXT REFERENCES stores(id),
  employee_id   TEXT UNIQUE REFERENCES employees(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 4. tasks
CREATE TABLE IF NOT EXISTS tasks (
  id                 TEXT PRIMARY KEY,
  title              TEXT NOT NULL,
  description        TEXT,
  has_mypal          INTEGER NOT NULL DEFAULT 0,
  has_smartsell      INTEGER NOT NULL DEFAULT 0,
  has_ai_demo        INTEGER NOT NULL DEFAULT 0,
  has_live_broadcast INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'dispatched')),
  rtm_filter         TEXT,
  store_scope        TEXT NOT NULL DEFAULT 'all',
  auto_nudge_rules   TEXT,                          -- 自动催办规则 (JSON)
  mypal_task_week    TEXT,                          -- MyPal queryDate，如 FY26Q2W1（has_mypal 时建议必填）
  mypal_product_name TEXT,                          -- 与 MyPal 响应 productName 精确匹配（可空，见对接文档）
  ddl_at             TEXT NOT NULL,
  created_by         TEXT NOT NULL,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (has_mypal + has_smartsell + has_ai_demo + has_live_broadcast >= 1),
  CHECK (rtm_filter IS NULL OR (json_valid(rtm_filter) AND json_type(rtm_filter) = 'array')),
  CHECK (store_scope = 'all' OR (json_valid(store_scope) AND json_type(store_scope) = 'array')),
  CHECK (auto_nudge_rules IS NULL OR json_valid(auto_nudge_rules))
);

-- 5. task_assignments
CREATE TABLE IF NOT EXISTS task_assignments (
  id                       TEXT PRIMARY KEY,
  task_id                  TEXT NOT NULL REFERENCES tasks(id),
  user_id                  TEXT NOT NULL REFERENCES employees(id),
  store_id                 TEXT NOT NULL REFERENCES stores(id),
  status                   TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'in_progress', 'completed')),
  mypal_completed          INTEGER NOT NULL DEFAULT 0,
  smartsell_completed      INTEGER NOT NULL DEFAULT 0,
  ai_demo_completed        INTEGER NOT NULL DEFAULT 0,
  live_broadcast_completed INTEGER NOT NULL DEFAULT 0,
  progress                 INTEGER NOT NULL DEFAULT 0
                           CHECK (progress BETWEEN 0 AND 100),
  nudge_count              INTEGER NOT NULL DEFAULT 0,
  received_at              TEXT,
  started_at               TEXT,
  completed_at             TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(task_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_ta_task_store_status ON task_assignments(task_id, store_id, status);
CREATE INDEX IF NOT EXISTS idx_ta_user_id           ON task_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_ta_status            ON task_assignments(status);

-- 6. notification_events
CREATE TABLE IF NOT EXISTS notification_events (
  id             TEXT PRIMARY KEY,
  task_id        TEXT NOT NULL REFERENCES tasks(id),
  assignment_id  TEXT REFERENCES task_assignments(id),
  target_user_id TEXT NOT NULL REFERENCES employees(id),
  store_id       TEXT NOT NULL REFERENCES stores(id),
  event_type     TEXT NOT NULL CHECK (event_type IN ('task_assigned', 'nudge_yellow', 'nudge_red', 'task_updated')),
  severity       TEXT CHECK (severity IS NULL OR severity IN ('yellow', 'red')),
  dedupe_key     TEXT,
  initiator_id   INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (event_type = 'task_assigned' AND dedupe_key IS NOT NULL AND assignment_id IS NOT NULL)
    OR (event_type IN ('nudge_yellow', 'nudge_red') AND severity IS NOT NULL AND assignment_id IS NOT NULL)
    OR (event_type = 'task_updated')
  )
);
CREATE INDEX IF NOT EXISTS idx_ne_target_user_id ON notification_events(target_user_id);
CREATE INDEX IF NOT EXISTS idx_ne_store_id       ON notification_events(store_id);
CREATE INDEX IF NOT EXISTS idx_ne_task_id        ON notification_events(task_id);
CREATE INDEX IF NOT EXISTS idx_ne_event_type     ON notification_events(event_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ne_dedupe  ON notification_events(dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- 7. read_receipts
CREATE TABLE IF NOT EXISTS read_receipts (
  id       TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES notification_events(id),
  user_id  TEXT NOT NULL REFERENCES employees(id),
  read_at  TEXT NOT NULL DEFAULT (datetime('now')),
  source   TEXT NOT NULL CHECK (source IN ('notification_click', 'task_detail_open'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rr_event_user ON read_receipts(event_id, user_id);
CREATE INDEX        IF NOT EXISTS idx_rr_user_id    ON read_receipts(user_id);

-- 8. nudge_records
CREATE TABLE IF NOT EXISTS nudge_records (
  id                     TEXT PRIMARY KEY,
  task_id                TEXT NOT NULL REFERENCES tasks(id),
  target_type            TEXT NOT NULL CHECK (target_type IN ('employee', 'store', 'region')),
  target_id              TEXT NOT NULL,
  initiator_id           INTEGER NOT NULL REFERENCES users(id),
  severity               TEXT NOT NULL CHECK (severity IN ('yellow', 'red')),
  notification_event_ids TEXT NOT NULL,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (json_valid(notification_event_ids) AND json_type(notification_event_ids) = 'array')
);
CREATE INDEX IF NOT EXISTS idx_nr_task_id      ON nudge_records(task_id);
CREATE INDEX IF NOT EXISTS idx_nr_initiator_id ON nudge_records(initiator_id);

-- 9. MyPal 学习进度 Mock（开发环境用，仅用于联调）
-- 该表不代表生产 MyPal 真实数据落库方式；生产接入时需替换为真实 MyPal 同步/查询层。
CREATE TABLE IF NOT EXISTS mypal_learning_mock (
  seed_id           TEXT NOT NULL,
  product_name     TEXT NOT NULL,
  first_use_time   TEXT,
  task_week         TEXT NOT NULL,
  progress          INTEGER NOT NULL CHECK (progress BETWEEN 0 AND 100),
  passed_week      TEXT,
  passed_time      TEXT,
  required         INTEGER NOT NULL CHECK (required IN (0, 1)),
  week_start_time  TEXT,
  PRIMARY KEY (seed_id, product_name, task_week)
);
CREATE INDEX IF NOT EXISTS idx_mypal_mock_seed_id   ON mypal_learning_mock(seed_id);
CREATE INDEX IF NOT EXISTS idx_mypal_mock_task_week  ON mypal_learning_mock(task_week);
