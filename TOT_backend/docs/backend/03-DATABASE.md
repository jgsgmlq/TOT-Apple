# 数据库现状文档

**版本:** 2.0.1 | **更新:** 2026-04-13 | **与代码同步:** `server/db/schema.sql`、`server/db/index.js`

---

## 总结

| 表 | 说明 |
|----|------|
| `stores` | `id, name, region, city, rtm, format, dealer_name` |
| `employees` | `id, store_id, name, role, email, created_at`；`email` 由迁移脚本补列 |
| `users` | 含 `employee_id` 关联员工表，`role` 区分权限 |
| `tasks` | 使用 `has_*` 布尔列表示平台；含 `auto_nudge_rules`/`start_at`/`pass_score`/`mypal_*` |
| `task_assignments` | 含各平台完成字段、`nudge_count`、进度字段；无 `user_role` 列 |
| `notification_events` | 含 `store_id`/`content`；无 `target_role`/`initiator_role` |
| `read_receipts` | 记录通知已读状态 |
| `nudge_records` | 记录催办操作；无 `initiator_role` 列 |
| `mypal_learning_mock` | 开发联调表，生产环境需替换为真实 MyPal 同步层 |
| `chat_sessions` | EChat 会话表，含 `user_id`、`role_scope`、`regions`、`rtm` |
| `chat_messages` | EChat 消息表，含 `role`、`content`（JSON）、`intent_type` |
| `dashboard_insights` | 看板智能洞察：模块类型、`task_id`、下钻筛选、`content`、`context_json`、**`up_count`/`down_count`（赞/踩次数，不记投票人）**、创建人 |

---

## Schema 文件位置

- **主 Schema：** `server/db/schema.sql`
- **DB 入口 / 迁移逻辑：** `server/db/index.js`

---

## 1. stores 表

```sql
CREATE TABLE IF NOT EXISTS stores (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  region      TEXT NOT NULL,
  city        TEXT NOT NULL,
  rtm         TEXT NOT NULL,
  format      TEXT,
  dealer_name TEXT
);
```

> RTM 筛选依赖 `stores.format` 和 `stores.rtm`，务必在 seed 数据中填充。

---

## 2. employees 表

```sql
CREATE TABLE IF NOT EXISTS employees (
  id         TEXT PRIMARY KEY,
  store_id   TEXT NOT NULL REFERENCES stores(id),
  name       TEXT NOT NULL,
  role       TEXT NOT NULL,
  email      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX        IF NOT EXISTS idx_emp_store_id    ON employees(store_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_email ON employees(email) WHERE email IS NOT NULL;
```

**迁移说明：** `email` 列及其唯一索引由 `server/db/index.js` 的 `migrateEmployeesEmail` / `ensureEmployeesEmailIndex` 自动补齐（旧库适配）。

---

## 3. users 表

```sql
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL,
  store_id      TEXT REFERENCES stores(id),
  employee_id   TEXT UNIQUE REFERENCES employees(id),
  last_login_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## 4. tasks 表

```sql
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
  start_at           TEXT NOT NULL DEFAULT (datetime('now')),
  pass_score         INTEGER NOT NULL DEFAULT 100,
  mypal_task_week    TEXT,                          -- MyPal queryDate，如 FY26Q2W1（has_mypal 时建议必填）
  mypal_product_name TEXT,                          -- 与 MyPal 响应 productName 精确匹配（可空）
  ddl_at             TEXT NOT NULL,
  created_by         TEXT NOT NULL,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (has_mypal + has_smartsell + has_ai_demo + has_live_broadcast >= 1),
  CHECK (rtm_filter IS NULL OR (json_valid(rtm_filter) AND json_type(rtm_filter) = 'array')),
  CHECK (store_scope = 'all' OR (json_valid(store_scope) AND json_type(store_scope) = 'array')),
  CHECK (auto_nudge_rules IS NULL OR json_valid(auto_nudge_rules))
);
```

### MyPal 对接列

| 列 | 类型 | 说明 |
|----|------|------|
| `mypal_task_week` | TEXT NULL | 对应 MyPal 请求参数 `queryDate`（任务周，如 `FY26Q2W1`）。`has_mypal=1` 时建议必填。 |
| `mypal_product_name` | TEXT NULL | 与 MyPal 响应字段 `productName` 精确匹配；未填时同步仅在该学员该周**唯一一条**记录时回写，否则可能歧义。 |

旧库在启动时由 `server/db/index.js` 的 `migrateTasksMypalColumns` 自动 `ALTER TABLE` 补列。

> **注意：** 旧版设计中的 `platforms TEXT` 和 `target_role TEXT` 字段已废弃，实际代码改用 `has_mypal / has_smartsell / has_ai_demo / has_live_broadcast` 四个独立布尔列。

---

## 5. task_assignments 表

```sql
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
```

> **注意：** 旧版设计中的 `user_role` 列实际代码中不存在。

---

## 6. notification_events 表

```sql
CREATE TABLE IF NOT EXISTS notification_events (
  id             TEXT PRIMARY KEY,
  task_id        TEXT NOT NULL REFERENCES tasks(id),
  assignment_id  TEXT REFERENCES task_assignments(id),
  target_user_id TEXT NOT NULL REFERENCES employees(id),
  store_id       TEXT NOT NULL REFERENCES stores(id),
  event_type     TEXT NOT NULL
                 CHECK (event_type IN ('task_assigned', 'nudge_yellow', 'nudge_red', 'task_updated')),
  severity       TEXT CHECK (severity IS NULL OR severity IN ('yellow', 'red')),
  dedupe_key     TEXT,
  content        TEXT,                          -- 催办类展示文案（nudge_*）；任务类可为空，由前端关联 task 或后续扩展
  initiator_id   INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (event_type = 'task_assigned' AND dedupe_key IS NOT NULL AND assignment_id IS NOT NULL)
    OR (event_type IN ('nudge_yellow', 'nudge_red') AND severity IS NOT NULL AND assignment_id IS NOT NULL)
    OR (event_type = 'task_updated')
  )
);
CREATE INDEX        IF NOT EXISTS idx_ne_target_user_id ON notification_events(target_user_id);
CREATE INDEX        IF NOT EXISTS idx_ne_store_id       ON notification_events(store_id);
CREATE INDEX        IF NOT EXISTS idx_ne_task_id        ON notification_events(task_id);
CREATE INDEX        IF NOT EXISTS idx_ne_event_type     ON notification_events(event_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ne_dedupe         ON notification_events(dedupe_key)
  WHERE dedupe_key IS NOT NULL;
```

**迁移说明：** `content` 列由 `server/db/index.js` 的 `migrateNotificationEventsContent` 自动补列。

> **注意：** 旧版设计中的 `target_role` 和 `initiator_role` 列实际代码中不存在。

---

## 7. read_receipts 表

```sql
CREATE TABLE IF NOT EXISTS read_receipts (
  id       TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES notification_events(id),
  user_id  TEXT NOT NULL REFERENCES employees(id),
  read_at  TEXT NOT NULL DEFAULT (datetime('now')),
  source   TEXT NOT NULL CHECK (source IN ('notification_click', 'task_detail_open'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rr_event_user ON read_receipts(event_id, user_id);
CREATE INDEX        IF NOT EXISTS idx_rr_user_id    ON read_receipts(user_id);
```

---

## 8. nudge_records 表

```sql
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
```

**迁移说明：** `server/db/index.js` 的 `migrateNudgeRecordsConstraints` 会检测旧库约束，必要时重建该表以补齐 CHECK 约束。

> **注意：** 旧版设计中的 `initiator_role` 列实际代码中不存在。

---

## 9. mypal_learning_mock 表（开发联调）

```sql
CREATE TABLE IF NOT EXISTS mypal_learning_mock (
  seed_id          TEXT NOT NULL,
  product_name     TEXT NOT NULL,
  first_use_time   TEXT,
  task_week        TEXT NOT NULL,
  progress         INTEGER NOT NULL CHECK (progress BETWEEN 0 AND 100),
  passed_week      TEXT,
  passed_time      TEXT,
  required         INTEGER NOT NULL CHECK (required IN (0, 1)),
  week_start_time  TEXT,
  PRIMARY KEY (seed_id, product_name, task_week)
);
CREATE INDEX IF NOT EXISTS idx_mypal_mock_seed_id   ON mypal_learning_mock(seed_id);
CREATE INDEX IF NOT EXISTS idx_mypal_mock_task_week ON mypal_learning_mock(task_week);
```

> **仅用于开发联调**，不代表生产 MyPal 真实数据落库方式；生产接入时需替换为真实 MyPal 同步/查询层。索引由 `ensureMypalLearningMockIndexes` 在启动时补齐。

---

## 迁移函数汇总（server/db/index.js）

| 函数 | 作用 |
|------|------|
| `migrateEmployeesEmail` | 旧库补 `employees.email` 列 |
| `ensureEmployeesEmailIndex` | 补 `employees.email` 条件唯一索引 |
| `migrateTasksMypalColumns` | 旧库补 `tasks.mypal_task_week` / `mypal_product_name` 列 |
| `migrateNotificationEventsContent` | 旧库补 `notification_events.content` 列 |
| `migrateNudgeRecordsConstraints` | 旧库重建 `nudge_records` 以补齐 CHECK 约束 |
| `ensureMypalLearningMockIndexes` | 补齐 `mypal_learning_mock` 索引 |
| `migrateDashboardInsightCounts` | 旧库补 `dashboard_insights.up_count` / `down_count` 列 |

---

## 废弃字段记录

以下字段/表出现在旧版文档或早期设计中，**实际代码中均不存在**：

| 字段 / 表 | 曾属于 | 原因 |
|-----------|--------|------|
| `tasks.platforms` | tasks | 已替换为 `has_mypal / has_smartsell / has_ai_demo / has_live_broadcast` |
| `tasks.target_role` | tasks | 已删除，下发逻辑不再依赖此列 |
| `task_assignments.user_role` | task_assignments | 实际代码未实现此列 |
| `notification_events.target_role` | notification_events | 实际代码未实现此列 |
| `notification_events.initiator_role` | notification_events | 实际代码未实现此列 |
| `nudge_records.initiator_role` | nudge_records | 实际代码未实现此列 |
| `stores.sub_rtm / rank / risk_level` | stores | 实际代码中无这些列 |
| `employees.sc_modules` 等旧版字段 | employees | 实际代码中无旧版学习进度字段 |
| `push_logs` 表 | — | 已被 `notification_events` 替代 |
| `events` 表 | — | 旧版事件总线，整体废弃 |

---

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

**删除（MVP 硬删除）：** `DELETE /api/v1/chat/executive/sessions/{sessionId}`（`routes/chat.js`）在校验 `user_id` 后调用 `services/chatService.deleteSessionById`：在**同一事务**内先 `DELETE FROM chat_messages WHERE session_id = ?`，再 `DELETE FROM chat_sessions WHERE id = ?`，数据从 `server/database.db` 中物理移除。若侧栏已删但库里仍有行，请确认后端已重启且前端请求命中该 API（非仅清 `localStorage`）。

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

---

## 12. dashboard_insights（看板智能洞察）

```sql
CREATE TABLE IF NOT EXISTS dashboard_insights (
  id                  TEXT PRIMARY KEY,
  module_type         TEXT NOT NULL
                        CHECK (module_type IN ('trend', 'heatmap_rank', 'funnel', 'warning_stats')),
  task_id             TEXT REFERENCES tasks(id),
  filter_rtm          TEXT,
  filter_format       TEXT,
  filter_dealer_name  TEXT,
  filter_store_id     TEXT REFERENCES stores(id),
  extra_params_json   TEXT,
  content             TEXT NOT NULL,
  context_json        TEXT,
  up_count            INTEGER NOT NULL DEFAULT 0
                        CHECK (up_count >= 0),
  down_count          INTEGER NOT NULL DEFAULT 0
                        CHECK (down_count >= 0),
  created_by          INTEGER NOT NULL REFERENCES users(id),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (extra_params_json IS NULL OR (json_valid(extra_params_json) AND json_type(extra_params_json) = 'object')),
  CHECK (context_json IS NULL OR (json_valid(context_json) AND json_type(context_json) = 'object'))
);
CREATE INDEX IF NOT EXISTS idx_di_module_task ON dashboard_insights(module_type, task_id);
CREATE INDEX IF NOT EXISTS idx_di_created_at ON dashboard_insights(created_at);
```

**字段说明：** `module_type` 枚举：`trend`、`heatmap_rank`、`funnel`、`warning_stats`。`context_json` 存生成洞察时使用的聚合事实（便于审计）；`extra_params_json` 存 `trendType`、`date`、`rtmLevel` 等。**`up_count` / `down_count`** 为赞、踩累计次数，不存投票人。

**迁移说明：** 旧库若缺 `up_count` / `down_count` 列，由 `server/db/index.js` 的 `migrateDashboardInsightCounts` 自动补列。
