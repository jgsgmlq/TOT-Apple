# 数据库现状对比与迁移指南

**版本:** 1.0.0 | **基于:** `docs/specs/01-DATA-MODEL.md`
**图例:** ✅ 符合 | ⚠️ 有差异 | ❌ 缺失

---

## 总结

| 表 | 当前状态 | 主要差异 |
|----|---------|---------|
| `tasks` | ✅ | 含 `mypal_task_week` / `mypal_product_name`（MyPal HTTP 同步映射，见 `06-MYPAL-INTEGRATION.md`） |
| `task_assignments` | ✅ | 已包含平台完成字段、`nudge_count`、`user_id/user_role` |
| `notification_events` | ✅ | 已存在（由 `server/schema/tasks.sql` 初始化） |
| `read_receipts` | ✅ | 已存在（由 `server/schema/tasks.sql` 初始化） |
| `nudge_records` | ✅ | 已存在（由 `server/schema/tasks.sql` 初始化） |
| `stores` | ✅ | 已包含 `format`、`sub_rtm`、`dealer_name` |
| `employees` | ⚠️ | 有旧版字段（sc_modules 等），缺少 Spec 新字段 |
| `users` | ✅ | 基本符合 |

---

## 1. tasks 表

### 当前 DDL（server/schema/tasks.sql）

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  platforms   TEXT NOT NULL DEFAULT '[]',
  status      TEXT NOT NULL DEFAULT 'draft',
  target_role TEXT NOT NULL DEFAULT 'both',
  rtm_filter  TEXT,
  store_scope TEXT,
  ddl_at      TEXT NOT NULL DEFAULT '',
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT
);
```

### 目标 DDL（01-DATA-MODEL.md）

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  platforms   TEXT NOT NULL,        -- JSON 数组，如 '["mypal","smartsell"]'
  status      TEXT NOT NULL DEFAULT 'draft', -- draft | dispatched
  target_role TEXT NOT NULL,        -- employee | store_manager | both
  rtm_filter  TEXT,                 -- JSON 数组，见 07-RTM-FILTER.md
  store_scope TEXT DEFAULT 'all',
  ddl_at      TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
```

### 迁移动作

```sql
-- 已完成：tasks 表迁移到 Spec 字段（见 server/schema/tasks.sql）
-- 如需回补历史库，仅对旧库执行一次性迁移脚本
```

### MyPal 对接列（`server/db/schema.sql`）

| 列 | 类型 | 说明 |
|----|------|------|
| `mypal_task_week` | TEXT NULL | 对应 MyPal 请求参数 `queryDate`（任务周，如 `FY26Q2W1`）。`has_mypal=1` 时创建/更新任务建议必填。 |
| `mypal_product_name` | TEXT NULL | 与 MyPal 响应字段 `productName` 精确匹配；未填时同步仅在该学员该周**唯一一条**记录时回写，否则可能歧义。 |

已有 SQLite 库在启动时由 `server/db/index.js` 的 `migrateTasksMypalColumns` 自动 `ALTER TABLE` 补列。

**说明：历史库重建方式（仅旧库需要）**

```sql
-- 步骤：CREATE new → INSERT SELECT → DROP old → RENAME
CREATE TABLE tasks_new (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  platforms TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  target_role TEXT NOT NULL DEFAULT 'both',
  rtm_filter TEXT,
  store_scope TEXT DEFAULT 'all',
  ddl_at TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO tasks_new (id, title, description, platforms, status, target_role,
                       rtm_filter, store_scope, ddl_at, created_by, created_at, updated_at)
SELECT id,
       COALESCE(name, ''),
       description,
       COALESCE(config_json, '[]'),
       -- 历史 status 映射：pending→draft（未下发），dispatched 保持，其余原值
       CASE WHEN status = 'pending' THEN 'draft'
            WHEN status = 'dispatched' THEN 'dispatched'
            ELSE 'draft' END,
       COALESCE(target_role, 'both'),
       NULL,  -- rtm_filter：历史任务无此字段，置 NULL 表示"全部门店"
       COALESCE(store_scope, 'all'),
       COALESCE(deadline, ''),
       COALESCE(created_by, 'system'),
       created_at,
       COALESCE(updated_at, created_at)
FROM tasks;

DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;
```

---

## 2. task_assignments 表

### 当前 DDL

```sql
CREATE TABLE IF NOT EXISTS task_assignments (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  user_role    TEXT NOT NULL,
  store_id     TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  mypal_completed INTEGER NOT NULL DEFAULT 0,
  smartsell_completed INTEGER NOT NULL DEFAULT 0,
  ai_demo_completed INTEGER NOT NULL DEFAULT 0,
  live_broadcast_completed INTEGER NOT NULL DEFAULT 0,
  progress     INTEGER NOT NULL DEFAULT 0,
  nudge_count  INTEGER NOT NULL DEFAULT 0,
  received_at  TEXT,
  started_at   TEXT,
  completed_at TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE(task_id, user_id)
);
```

### 目标 DDL

```sql
CREATE TABLE IF NOT EXISTS task_assignments (
  id                      TEXT PRIMARY KEY,
  task_id                 TEXT NOT NULL,
  user_id                 TEXT NOT NULL,
  user_role               TEXT NOT NULL,   -- employee | store_manager
  store_id                TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'pending', -- pending|in_progress|completed
  mypal_completed         INTEGER NOT NULL DEFAULT 0,
  smartsell_completed     INTEGER NOT NULL DEFAULT 0,
  ai_demo_completed       INTEGER NOT NULL DEFAULT 0,
  live_broadcast_completed INTEGER NOT NULL DEFAULT 0,
  progress                INTEGER NOT NULL DEFAULT 0,  -- 计算字段，0-100
  nudge_count             INTEGER NOT NULL DEFAULT 0,
  received_at             TEXT,
  started_at              TEXT,
  completed_at            TEXT,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id),
  UNIQUE(task_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ta_task_id   ON task_assignments(task_id);
CREATE INDEX IF NOT EXISTS idx_ta_user_id   ON task_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_ta_store_id  ON task_assignments(store_id);
CREATE INDEX IF NOT EXISTS idx_ta_status    ON task_assignments(status);
```

### 迁移动作

```sql
-- 已完成：task_assignments 表迁移到 Spec 字段（见 server/schema/tasks.sql）
-- 仅旧库需要执行重建迁移
```

---

## 3. notification_events 表（新增）

```sql
CREATE TABLE IF NOT EXISTS notification_events (
  id              TEXT PRIMARY KEY,
  task_id         TEXT NOT NULL,
  assignment_id   TEXT,
  target_user_id  TEXT NOT NULL,
  target_role     TEXT NOT NULL,   -- employee | store_manager
  event_type      TEXT NOT NULL,   -- task_assigned|nudge_yellow|nudge_red|task_updated
  severity        TEXT,            -- yellow | red | NULL
  dedupe_key      TEXT UNIQUE,     -- 去重用，如 task_assigned:{taskId}:{userId}
  initiator_id    INTEGER,
  initiator_role  TEXT,
  created_at      TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE INDEX IF NOT EXISTS idx_ne_target_user ON notification_events(target_user_id);
CREATE INDEX IF NOT EXISTS idx_ne_task_id     ON notification_events(task_id);
```

---

## 4. read_receipts 表（新增）

```sql
CREATE TABLE IF NOT EXISTS read_receipts (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  read_at    TEXT NOT NULL,
  source     TEXT NOT NULL,   -- notification_click | task_detail_open
  FOREIGN KEY (event_id) REFERENCES notification_events(id),
  UNIQUE(event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_rr_event_id ON read_receipts(event_id);
CREATE INDEX IF NOT EXISTS idx_rr_user_id  ON read_receipts(user_id);
```

---

## 5. nudge_records 表（新增）

```sql
CREATE TABLE IF NOT EXISTS nudge_records (
  id                      TEXT PRIMARY KEY,
  task_id                 TEXT NOT NULL,
  target_type             TEXT NOT NULL,   -- employee | store | region
  target_id               TEXT NOT NULL,
  initiator_id            INTEGER NOT NULL,
  initiator_role          TEXT NOT NULL,
  severity                TEXT NOT NULL,   -- yellow | red
  notification_event_ids  TEXT NOT NULL,   -- JSON 数组
  created_at              TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE INDEX IF NOT EXISTS idx_nr_task_id ON nudge_records(task_id);
```

---

## 6. stores 表

### 当前字段

当前已包含：`id, name, region, rtm, sub_rtm, format, dealer_name, city, rank, risk_level`

### 缺失字段

无（与 Spec 关键字段对齐）

> **注意：** RTM 筛选依赖 `stores.format` 和 `stores.rtm`，务必在 seed 数据中填充。

---

## 7. employees 表

### 当前字段（旧版）

`id, store_id, name, role, is_manager, sc_modules, sc_test, live_watched, mypal_days, ai_coach, risk_level, last_active`

### Spec 目标字段

新版 employees 表不包含学习进度字段（进度改由 `task_assignments` 平台字段管理），精简如下：

```sql
CREATE TABLE IF NOT EXISTS employees (
  id          TEXT PRIMARY KEY,
  store_id    TEXT NOT NULL,
  name        TEXT NOT NULL,
  role        TEXT,               -- 岗位名称，如"销售顾问"
  is_manager  INTEGER DEFAULT 0,
  risk_level  TEXT DEFAULT 'normal',
  last_active TEXT,
  created_at  TEXT NOT NULL,
  FOREIGN KEY (store_id) REFERENCES stores(id)
);
```

> **兼容策略：** 旧版 `sc_modules` 等字段可保留（不影响新逻辑），不必删除。

---

## 8. 废弃表（可清理）

| 表 | 说明 |
|----|------|
| `push_logs` | 旧版推送日志，被 `notification_events` 替代 |
| `events` | 旧版事件总线，整体废弃 |

---

## 迁移执行顺序

```
1. 备份 server/database.db
2. 执行 tasks 表重建
3. 执行 task_assignments 表重建
4. 新增 notification_events 表
5. 新增 read_receipts 表
6. 新增 nudge_records 表
7. ALTER stores 加字段
8. 更新 seed.js 填充新字段
9. 重跑 node seed.js
```
