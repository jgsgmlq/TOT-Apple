# 数据模型规格

**版本:** 2.6.8 | **PRD §4.6, §6, §7** | **更新日期:** 2026-04-02

---

## 设计约定

- 数据库：SQLite 3，WAL 模式
- 所有时间字段：**统一为文本存储**（格式 `YYYY-MM-DD HH:MM:SS`）；SQLite `datetime('now')` 为**服务器本地时区**，若生产要求严格 UTC，应在应用层写入 UTC 或改用 `strftime` 等显式 UTC 表达式
- 对外 API 返回时间：统一转换为 ISO 8601（`YYYY-MM-DDTHH:MM:SSZ`）
- ID：TEXT，使用业务编号（stores/employees）或 nanoid（tasks/assignments/events 等）
- 布尔值：INTEGER（0=false，1=true）
- JSON 数组/对象：TEXT（序列化存储，仅用于 rtm_filter / store_scope / notification_event_ids）
- 外键约束：`PRAGMA foreign_keys = ON`
- 枚举语义字段：优先使用 `CHECK (...)` 在 DB 层约束合法值

---

## MVP 快速落地与后续扩展原则

1. **MVP 优先：** 采用 SQLite + 明确主外键 + 少量冗余（如 `task_assignments.store_id`）以降低查询复杂度和实现成本。
2. **一致性底线：** 所有关键状态/角色/事件类型字段在 DB 层加 CHECK，避免应用层漏校验导致脏数据。
3. **可扩展性：** 可变结构（RTM 规则、催办事件列表）先以 JSON TEXT 落地，但要求 `json_valid`，为后续拆分子表保留空间。
4. **查询优先级：** 索引围绕 MVP 高频路径设计（任务看板聚合、我的任务、通知未读），后续按慢查询日志迭代补索引。
5. **演进策略：** 文档始终描述“当前目标结构”，不绑定迁移步骤；迁移由独立执行文档管理。

---

## 表依赖顺序（建表顺序）

```
stores → employees → users → tasks → task_assignments
                                   → notification_events → read_receipts
                                   → nudge_records
```

---

## 1. stores（门店表）

**业务含义：** 品牌线下零售门店的基本信息档案。是整个系统的地理与渠道基础——员工归属于门店，培训任务通过门店渠道属性（RTM）筛选下发目标，看板数据也按门店/区域/经销商三个维度聚合。MVP 共 50 家门店，数据由运营导入，不由前端创建。

```sql
CREATE TABLE IF NOT EXISTS stores (
  id          TEXT PRIMARY KEY,   -- 业务编号，如 S001
  name        TEXT NOT NULL,
  region      TEXT NOT NULL,      -- 区域，如 华东；看板地区维度聚合用
  city        TEXT NOT NULL,
  rtm         TEXT NOT NULL,      -- Monobrand | Multibrand | Carrier | Education | Enterprise
  format      TEXT,               -- 业态值，如 MONO / Lifestyle / Mass Merchant；RTM 筛选叶子节点匹配用，大小写不敏感
  dealer_name TEXT                -- 经销商名称；看板经销商维度聚合用
);
```

**字段说明:**

| 字段 | 必填 | 说明 |
|------|------|------|
| id | Y | 业务编号，如 S001，全系统唯一，用作其他表的外键 |
| name | Y | 门店显示名称，如"上海环球港旗舰店" |
| region | Y | 所属大区，如"华东"；看板地区维度聚合 |
| city | Y | 所在城市，如"上海"；支持按城市过滤 |
| rtm | Y | Route-to-Market 渠道类型，RTM 筛选一级路径（见 07-RTM-FILTER.md）|
| format | N | 渠道业态细分，如 MONO / Lifestyle / Mass Merchant；RTM 筛选叶子节点匹配，大小写不敏感 |
| dealer_name | N | 运营该门店的经销商名称；直营门店为 NULL；看板经销商维度聚合用 |

> **v2.1.0 变更:** 删除 `sub_rtm`——经确认，stores 表中 `sub_rtm` 始终等于 `rtm`，完全冗余；RTM 筛选 SQL 也从未使用该字段（见 07-RTM-FILTER.md）。

---

## 2. employees（员工表）

**业务含义：** 门店一线人员档案，是培训任务的最终执行主体。每位员工属于一家门店，注意：这里的 `role` 是**岗位名称**（如"销售顾问"），与 `users.role`（系统权限角色）是两个不同概念。

```sql
CREATE TABLE IF NOT EXISTS employees (
  id         TEXT PRIMARY KEY,             -- 业务编号，如 E001
  store_id   TEXT NOT NULL REFERENCES stores(id),
  name       TEXT NOT NULL,
  role       TEXT NOT NULL,                -- 岗位名称，如"销售顾问"
  email      TEXT,                          -- 与 MyPal seedId（用户邮箱）对齐（小写），可空；非空时全局唯一
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_emp_store_id ON employees(store_id);
CREATE UNIQUE INDEX idx_employees_email ON employees(email) WHERE email IS NOT NULL;
```

**字段说明:**

| 字段 | 必填 | 说明 |
|------|------|------|
| id | Y | 业务编号，如 E001；全系统唯一，是 task_assignments / notification_events / read_receipts 的用户标识 |
| store_id | Y | 所属门店；决定该员工接收哪些门店范围的任务 |
| name | Y | 员工真实姓名，用于前端展示和催办通知 |
| role | Y | 岗位名称（业务含义），如"销售顾问"、"店员"；与 users.role（系统权限）无关 |
| email | N | **MyPal 对接键**：与 MyPal **`seedId`** 一致（均为用户邮箱；入库前规范化为 trim + 小写）；非空时全表唯一。未接入 MyPal 前可为 NULL |
| created_at | Y | 创建时间 |

> **重要:** `task_assignments`、`notification_events`、`read_receipts` 的用户 ID 字段**统一引用 `employees.id`**。与 MyPal 行关联时，**`employees.email` ↔ MyPal `seedId`**（见 §9），再映射到 `id`。历史别名 `unique_code` / `user_uid` 与 `seedId` 同义，均为邮箱。

---

## 3. users（账户表）

**业务含义：** 系统登录账号表，管理认证信息与权限角色。`employees` 表存的是"这个人是谁"，`users` 表存的是"这个人怎么登录系统、有什么权限"。店员有一个对应的 user 账号（通过 `employee_id` 关联）；总部（central）、Executive、Admin 没有对应的 employee 记录，`employee_id` 为 NULL。

```sql
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,             -- bcrypt，10 rounds
  role          TEXT NOT NULL,             -- central | employee | executive | admin
  store_id      TEXT REFERENCES stores(id),
  employee_id   TEXT UNIQUE REFERENCES employees(id),  -- ★ UNIQUE：一个 employee 只能对应一个 user
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**字段说明:**

| 字段 | 必填 | 说明 |
|------|------|------|
| id | Y | 自增整数主键；`notification_events.initiator_id` 和 `nudge_records.initiator_id` 引用此字段 |
| username | Y | 登录用户名，全局唯一；格式见下表 |
| password_hash | Y | bcrypt 哈希，10 rounds；明文密码不入库 |
| role | Y | 系统权限角色，决定前端入口和数据可见范围（见 08-PERMISSION-MODEL.md）|
| store_id | N | 店员必填，指向所属门店；central / executive / admin 为 NULL |
| employee_id | N | 店员必填，指向 employees 表中对应记录；UNIQUE 保证一对一；其他角色为 NULL |

**角色与 username 规范:**

| role | username 格式 | 示例 | store_id | employee_id |
|------|-------------|------|----------|-------------|
| central | `central` | central | NULL | NULL |
| employee | `emp_E{employeeId}` | emp_E002 | S001 | E002 |
| executive | `executive` 或自定义 | executive | NULL | NULL |
| admin | `admin` | admin | NULL | NULL |

> **v2.1.0 变更:** `employee_id` 加了 `UNIQUE` 约束——防止同一个 employee 被创建两个 user 账号（一对一关系）。

**测试账号:**

| username | password | role |
|----------|----------|------|
| central | Train2026! | central |
| emp_E002 | Train2026! | employee |
| executive | Train2026! | executive |
| admin | Admin2026! | admin |

---

## 4. tasks（任务表）

**业务含义：** 总部创建的培训任务，是下发给员工的"学习指令"。一个 task 定义了"要学什么（平台配置）、谁要学（RTM 筛选）、截止日期是什么时候"。任务本身不直接面向员工——下发（dispatch）后系统为每个目标员工生成一条 `task_assignments` 记录，任务才真正到达员工手中。创建后处于 `draft` 状态可以编辑；一旦 dispatch 就进入终态 `dispatched`，下发范围不可再改。

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id                 TEXT PRIMARY KEY,              -- nanoid
  title              TEXT NOT NULL,
  description        TEXT,
  -- 平台配置（固定 4 个平台，各自独立布尔列）
  has_mypal          INTEGER NOT NULL DEFAULT 0,    -- 0/1
  has_smartsell      INTEGER NOT NULL DEFAULT 0,    -- 0/1
  has_ai_demo        INTEGER NOT NULL DEFAULT 0,    -- 0/1
  has_live_broadcast INTEGER NOT NULL DEFAULT 0,    -- 0/1
  status             TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'dispatched')),  -- ★ 枚举约束
  rtm_filter         TEXT,                          -- JSON 数组或 null（见 07-RTM-FILTER.md）
  store_scope        TEXT NOT NULL DEFAULT 'all',   -- "all" | JSON 数组 store IDs
  auto_nudge_rules   TEXT,                          -- 自动催办预警规则（JSON 对象）
  ddl_at             TEXT NOT NULL,                 -- 截止时间，ISO 8601
  created_by         TEXT NOT NULL,                 -- 创建者 username
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (has_mypal + has_smartsell + has_ai_demo + has_live_broadcast >= 1),
  CHECK (rtm_filter IS NULL OR (json_valid(rtm_filter) AND json_type(rtm_filter) = 'array')),
  CHECK (store_scope = 'all' OR (json_valid(store_scope) AND json_type(store_scope) = 'array')),
  CHECK (auto_nudge_rules IS NULL OR json_valid(auto_nudge_rules))
);
```

**字段说明:**

| 字段 | 必填 | 枚举/约束 | 说明 |
|------|------|---------|------|
| id | Y | nanoid | 任务唯一标识，系统生成 |
| title | Y | — | 任务标题，如"Q1 新品培训" |
| description | N | — | 任务详细说明，可为空 |
| has_mypal | Y | 0/1 | 是否要求完成 MyPAL 平台学习 |
| has_smartsell | Y | 0/1 | 是否要求完成 SmartSell 平台学习 |
| has_ai_demo | Y | 0/1 | 是否要求完成 AI Demo 平台学习 |
| has_live_broadcast | Y | 0/1 | 是否要求完成 Live Broadcast 平台学习 |
| status | Y | draft \| dispatched | draft=草稿可编辑；dispatched=已下发终态，仅 ddl_at 可修改 |
| rtm_filter | N | JSON 数组或 null | 按渠道属性动态筛选目标门店，优先级高于 store_scope；条件内 AND，条件间 OR（见 07-RTM-FILTER.md）|
| store_scope | Y（有默认） | "all" 或 JSON 数组 | **NOT NULL，默认 `'all'`**；rtm_filter 为空时使用；"all"=全部门店，JSON 数组=指定门店列表；DB 约束保证值为 all 或合法 JSON 数组 |
| auto_nudge_rules | N | JSON 对象或 null | **自动催办规则**，支持配置 `progressLag`, `startDelay`, `deadlineCrisis` 等自动扫描规则 |
| ddl_at | Y | ISO 8601 | 任务截止时间；dispatched 后仍可修改 |
| created_by | Y | — | 创建者 username（软引用，不设外键），用于审计 |
| CHECK（平台）| — | 至少 1 个平台为 1 | 任务必须包含至少一个学习平台 |
| CHECK（状态）| — | IN ('draft','dispatched') | DB 层拦截非法状态写入 |

> **v2.1.0 变更:** `status` 加了 `CHECK (status IN ('draft', 'dispatched'))`，DB 层强制枚举。
>
> **v2.4.0 补充:** `rtm_filter`、`store_scope` 增加 DB 约束，降低应用层漏校验风险。

**平台枚举:**

| 列名 | 展示名 | 完成方式 | task_assignments 对应字段 |
|------|--------|--------|--------------------------|
| `has_mypal` | MyPAL | API 对接优先，不可用降级手动 | `mypal_completed` |
| `has_smartsell` | SmartSell | 手动标记 | `smartsell_completed` |
| `has_ai_demo` | AI Demo | 手动标记 | `ai_demo_completed` |
| `has_live_broadcast` | Live Broadcast | 手动标记 | `live_broadcast_completed` |

**状态机:** 见 `02-STATE-MACHINES.md`

---

## 5. task_assignments（分配表 ★ 核心表）

**业务含义：** 任务下发后为每个目标员工生成的**个人执行记录**，是整个系统最核心的表。一条 assignment 代表"某员工需要完成某个培训任务"，记录了他的完成进度、各平台完成状态、收到催办次数等全部执行过程。看板数据、催办逻辑、完成率统计都从此表读取。`UNIQUE(task_id, user_id)` 保证同一任务对同一用户只有一条记录（幂等下发）。

```sql
CREATE TABLE IF NOT EXISTS task_assignments (
  id                       TEXT PRIMARY KEY,           -- nanoid
  task_id                  TEXT NOT NULL REFERENCES tasks(id),
  user_id                  TEXT NOT NULL REFERENCES employees(id),
  store_id                 TEXT NOT NULL REFERENCES stores(id),
  status                   TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'in_progress', 'completed')),  -- ★ 枚举约束
  -- 四平台完成标记（与 tasks.has_* 列对应）
  mypal_completed          INTEGER NOT NULL DEFAULT 0,
  smartsell_completed      INTEGER NOT NULL DEFAULT 0,
  ai_demo_completed        INTEGER NOT NULL DEFAULT 0,
  live_broadcast_completed INTEGER NOT NULL DEFAULT 0,
  -- 进度（系统写入：已完成平台数 / 该任务配置平台总数 × 100）
  progress                 INTEGER NOT NULL DEFAULT 0
                           CHECK (progress BETWEEN 0 AND 100),  -- ★ 范围约束
  -- 催办计数
  nudge_count              INTEGER NOT NULL DEFAULT 0,
  -- 时间戳
  received_at              TEXT,   -- 首次打开任务详情时写入
  started_at               TEXT,   -- pending → in_progress 时写入
  completed_at             TEXT,   -- in_progress → completed 时写入
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now')),
  -- 幂等约束：同一任务同一用户只有一条记录
  UNIQUE(task_id, user_id)
);

-- ★ 复合索引（替代原 idx_ta_task_id + idx_ta_store_id 两个单列索引）
-- 覆盖看板最高频查询：WHERE task_id = ? GROUP BY store_id（含 status 聚合）
CREATE INDEX idx_ta_task_store_status ON task_assignments(task_id, store_id, status);
-- 覆盖用户视角：WHERE user_id = ?（店员拉取自己的任务）
CREATE INDEX idx_ta_user_id ON task_assignments(user_id);
-- 覆盖状态视角：WHERE status = ?（催办过滤未完成、预警扫描等）
CREATE INDEX idx_ta_status ON task_assignments(status);
```

**字段说明:**

| 字段 | 说明 |
|------|------|
| id | nanoid，assignment 唯一标识 |
| task_id | 关联的培训任务 |
| user_id | 被分配到的员工（引用 `employees.id`）|
| store_id | 该员工所属门店，冗余存储便于看板按门店聚合，避免 JOIN employees |
| status | 执行状态：pending=待开始 / in_progress=进行中 / completed=已完成（终态）|
| *_completed | 各平台完成标记（0/1）；只有 tasks.has_*=1 的平台才能被标记，应用层校验 |
| progress | 系统自动计算：`已完成平台数 / 该任务配置平台总数 × 100`（0–100 整数）；每次标记平台后更新 |
| nudge_count | 累计收到催办次数，每次被催办 +1；用于统计和展示 |
| received_at | 用户首次打开任务详情页时写入；反映"员工知不知道这个任务"；与 read_receipts 同步写入 |
| started_at | 员工点击"开始任务"时写入（pending → in_progress 时）|
| completed_at | 所有平台均完成时系统写入（in_progress → completed 时）|

> **冗余字段语义:** `store_id` 作为**下发时快照**使用，不回填历史 assignment。员工后续转店/转岗不影响已下发任务统计口径。

> **v2.1.0 变更:**
> - `status` 加 CHECK 枚举约束
> - `progress` 加 CHECK BETWEEN 0 AND 100
> - 索引从 (task_id), (store_id) 两个单列改为复合索引 (task_id, store_id, status)，覆盖看板聚合查询

**进度计算示例:**

| 任务配置（has_*=1 的列） | 已完成平台 | progress |
|------------------------|---------|---------|
| mypal + smartsell（共 2 个）| mypal=1, smartsell=0 | 50 |
| mypal + smartsell（共 2 个）| mypal=1, smartsell=1 | 100 |
| 全部 4 个 | mypal=1, 其余=0 | 25 |
| smartsell 单平台 | smartsell=1 | 100 |

**状态转换规则:** 见 `02-STATE-MACHINES.md`
**进度计算规则:** 见 `03-PLATFORM-COMPLETION.md`

---

## 6. notification_events（通知事件表）

**业务含义：** 系统向员工发送的每一条通知消息记录。有两类来源：①任务下发时系统自动生成（`task_assigned`）；②总部手动催办时生成（`nudge_yellow` / `nudge_red`）。前端铃铛图标的未读数、通知列表都从此表读取。`dedupe_key` + PARTIAL UNIQUE INDEX 保证 task_assigned 事件不会重复生成（幂等）。

```sql
CREATE TABLE IF NOT EXISTS notification_events (
  id             TEXT PRIMARY KEY,
  task_id        TEXT NOT NULL REFERENCES tasks(id),
  assignment_id  TEXT REFERENCES task_assignments(id),   -- task_assigned 和催办事件必填；task_updated 可空
  target_user_id TEXT NOT NULL REFERENCES employees(id),
  store_id       TEXT NOT NULL REFERENCES stores(id),    -- 冗余存储，便于按门店快速查询通知
  event_type     TEXT NOT NULL CHECK (event_type IN ('task_assigned', 'nudge_yellow', 'nudge_red', 'task_updated')),
  severity       TEXT CHECK (severity IS NULL OR severity IN ('yellow', 'red')),  -- yellow | red（仅催办事件必填）
  dedupe_key     TEXT,             -- 幂等键（task_assigned 类型必填）
  initiator_id   INTEGER REFERENCES users(id),  -- ★ 改为 INTEGER REFERENCES users(id)（催办发起人；系统触发时 null）
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (event_type = 'task_assigned' AND dedupe_key IS NOT NULL AND assignment_id IS NOT NULL)
    OR
    (event_type IN ('nudge_yellow', 'nudge_red') AND severity IS NOT NULL AND assignment_id IS NOT NULL)
    OR
    (event_type = 'task_updated')
  )
);

CREATE INDEX idx_ne_target_user_id ON notification_events(target_user_id);
CREATE INDEX idx_ne_store_id       ON notification_events(store_id);
CREATE INDEX idx_ne_task_id        ON notification_events(task_id);
CREATE INDEX idx_ne_event_type     ON notification_events(event_type);
-- ★ PARTIAL UNIQUE INDEX：对有 dedupe_key 的行强制唯一，DB 层保证幂等
CREATE UNIQUE INDEX idx_ne_dedupe ON notification_events(dedupe_key)
  WHERE dedupe_key IS NOT NULL;
```

**字段说明:**

| 字段 | 必填 | 说明 |
|------|------|------|
| id | Y | nanoid，通知事件唯一标识 |
| task_id | Y | 关联的任务；用于任务完成后前端过滤隐藏已完成任务的通知 |
| assignment_id | N | 关联的个人 assignment；task_assigned 和催办事件必填，task_updated 可空 |
| target_user_id | Y | 通知接收人（引用 employees.id）|
| store_id | Y | 接收人所属门店（引用 stores.id）；冗余存储便于按门店快速过滤与聚合 |
| event_type | Y | 事件类型，决定通知的展示样式和行为（见 event_type 枚举表）|
| severity | N | 催办紧急程度：yellow=提醒，red=紧急；仅催办事件填写 |
| dedupe_key | N | 幂等键；task_assigned 必填（格式 `task:{id}:user:{id}`），PARTIAL UNIQUE INDEX 在 DB 层防重 |
| initiator_id | N | 催办发起人的 users.id；系统自动触发（如 task_assigned）时为 NULL |

| 值 | 触发时机 | severity | assignment_id |
|----|---------|---------|--------------|
| `task_assigned` | 任务下发，为每个 Assignment 创建一条 | — | 填 |
| `nudge_yellow` | 黄色催办 | yellow | 填 |
| `nudge_red` | 红色催办 | red | 填 |
| `task_updated` | 任务信息更新（如 ddl 变更）| — | 可空 |

**dedupe_key 规则:**

| event_type | dedupe_key 格式 | 幂等逻辑 |
|-----------|----------------|---------|
| task_assigned | `task:{task_id}:user:{user_id}` | UNIQUE INDEX 在 DB 层拦截重复插入 |
| nudge_* | `nudge:{task_id}:user:{user_id}:{timestamp}` | 每次催办独立创建，不去重 |

> **v2.1.0 变更:**
> - `initiator_id` 从 `TEXT`（注释为 employees.id）改为 `INTEGER REFERENCES users(id)`——central 角色无 employee.id，统一用 users.id，与 nudge_records 保持一致
> - 新增 `CREATE UNIQUE INDEX idx_ne_dedupe WHERE dedupe_key IS NOT NULL`——DB 层真正保证 task_assigned 幂等，而不只依赖应用层 INSERT OR IGNORE

---

## 7. read_receipts（已读回执表）

**业务含义：** 记录员工何时、以何种方式"看到了"某条通知。一条 notification_event 只有被记录到此表才算已读，铃铛未读数随之减少。`UNIQUE(event_id, user_id)` 保证同一通知对同一用户只记录一次已读（幂等）。

```sql
CREATE TABLE IF NOT EXISTS read_receipts (
  id       TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES notification_events(id),
  user_id  TEXT NOT NULL REFERENCES employees(id),
  read_at  TEXT NOT NULL DEFAULT (datetime('now')),
  source   TEXT NOT NULL CHECK (source IN ('notification_click', 'task_detail_open'))
);

CREATE UNIQUE INDEX idx_rr_event_user ON read_receipts(event_id, user_id);
CREATE INDEX        idx_rr_user_id    ON read_receipts(user_id);
```

**字段说明:**

| 字段 | 必填 | 说明 |
|------|------|------|
| id | Y | nanoid，回执唯一标识 |
| event_id | Y | 关联的通知事件；UNIQUE(event_id, user_id) 防止重复已读 |
| user_id | Y | 已读的员工（引用 employees.id）|
| read_at | Y | 已读时间，DEFAULT 当前时间 |
| source | Y | 已读来源：notification_click=点击铃铛通知，task_detail_open=直接打开任务详情（后者同时写入 assignment.received_at）|

**source 说明:**

| 值 | 含义 |
|----|------|
| `notification_click` | 用户点击铃铛通知列表中的通知 |
| `task_detail_open` | 用户直接打开任务详情页（同时写入 assignment.received_at）|

---

## 8. nudge_records（催办事实记录表）

**业务含义：** 每次催办动作的审计日志。与 `notification_events` 的区别是：notification_events 是"给每个人的通知消息"（一次催办可产生多条），nudge_records 是"这次催办这个动作本身"（一次催办一条）。记录了谁发起、催的是谁（个人/门店/区域）、严重程度，以及本次产生了哪些 notification_events（`notification_event_ids`，JSON 数组，PRD 要求完整审计）。

```sql
CREATE TABLE IF NOT EXISTS nudge_records (
  id                     TEXT PRIMARY KEY,
  task_id                TEXT NOT NULL REFERENCES tasks(id),
  target_type            TEXT NOT NULL CHECK (target_type IN ('employee', 'store', 'region')),
  target_id              TEXT NOT NULL,    -- employees.id / stores.id / region 名称
  initiator_id           INTEGER NOT NULL REFERENCES users(id),
  severity               TEXT NOT NULL CHECK (severity IN ('yellow', 'red')),
  notification_event_ids TEXT NOT NULL,    -- ★ NOT NULL：PRD 要求完整审计记录；JSON 数组，本次催办创建的 event ID 列表
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (json_valid(notification_event_ids) AND json_type(notification_event_ids) = 'array')
);

CREATE INDEX idx_nr_task_id      ON nudge_records(task_id);
CREATE INDEX idx_nr_initiator_id ON nudge_records(initiator_id);
```

> **实现对齐：** 目标结构含上表 `CHECK`；若仓库中 `server/db/schema.sql` 暂未写入同等约束，合法值与 JSON 形态以路由/服务层校验为准，后续可通过迁移补全 DB 层约束。

**字段说明:**

| 字段 | 必填 | 说明 |
|------|------|------|
| id | Y | nanoid，催办记录唯一标识 |
| task_id | Y | 催办针对的任务 |
| target_type | Y | 催办范围：employee=催单个员工，store=催整家门店所有未完成员工，region=催整个区域（仅 central 可用）|
| target_id | Y | 催办对象 ID：employee 时为 employees.id，store 时为 stores.id，region 时为区域名称字符串（如"华东"）|
| initiator_id | Y | 催办发起人的 users.id（INTEGER），NOT NULL；central 无 employee.id，统一用 users 表 |
| severity | Y | 催办紧急程度：yellow=提醒（正常催办），red=紧急（截止临近或严重落队）|
| notification_event_ids | Y | 本次催办创建的所有 notification_events 的 ID 列表（JSON 数组），NOT NULL；PRD §5.5 要求完整事实记录 |

> **v2.1.0 变更:** `notification_event_ids` 从可空改为 `NOT NULL`——催办流程必生成 notification events，PRD 要求完整审计。

---

## 9. MyPal 外部数据（集成）

**定位：** 以下结构来自 **MyPal 端**导出/接口数据；**生产接入情况下不写入本系统 SQLite**。在本地无法接通 MyPal 时，开发联调可使用开发专用表 `mypal_learning_mock` 承载同形态数据，用于 **店员任务查询、催办策略、AI 辅助分析** 等能力。

**对接原则：**

- **用户标识（一一对应）：** MyPal **`seedId`** = **`employees.email`**（同一用户邮箱字符串）。`seedId` 在 MyPal 文档中称 SEED ID；与历史导出中的 `unique_code`、`user_uid` **同义**。集成比对、去重、关联店员时：**`seedId` ↔ `employees.email`**，再 **`employees.id`**。
- 与本系统店员对齐：库内 **`employees.email` 可空**；**对接 MyPal 时**应对目标店员写入与 MyPal 一致的邮箱（非空），此时在唯一索引下全局唯一，即可映射到 `employees.id`。集成层可调用 `getEmployeeIdByMypalEmail`（见 `server/services/mypalLink.js`）或等价 SQL。
- 时间语义：下列时间类字段在 MyPal 侧格式为 **`yyyy-MM-dd HH:mm:ss`** 字符串；若 MyPal 为本地时区展示，集成层需统一为 UTC 或与 `设计约定` 中 API 输出规范对齐后再写入缓存/派生表。
- **查询周次：** `taskWeek` 返回 **与请求中的 `queryDate` 所对应的任务周** 的数据（示例周次格式：`FY26Q2W1`）。

### 9.1 本地库与 MyPal：集成边界（非「数据库连接」）

- **双库关系：** MyPal 为**外部系统**（自有库或 API，本规格不假设其引擎）。生产接入情况下，本系统 **仅 SQLite 一套库**，**不在本地建 MyPal 表、不设跨库外键**；但在开发联调时会使用本地开发专用表 `mypal_learning_mock`（同库）承载 mock 数据。「连接」指 **业务键对齐**：集成/同步代码用 **`seedId` ↔ `employees.email`** 在应用层解析为 **`employees.id`**（如 `getEmployeeIdByMypalEmail`）。
- **与 `task_assignments.mypal_completed`：** 表中 **0/1** 表示本任务维度 MyPAL 平台是否完成；MyPal 行 **`progress`** 为 **产品 × 任务周** 粒度。二者 **不可直接等同**；若将来用 MyPal 数据**自动回写** `mypal_completed`，须单独约定 **任务/产品与 `productName`、`taskWeek` 的映射规则**（本规格不替代该业务规则）。
- **比对前规范化：** `seedId` 与 `employees.email` 比较须 **trim + 小写**，与入库规则一致，避免大小写/空格导致「同一人对不上」。
- **未匹配场景：** `employees.email` 为 **NULL** 时无法关联任何 MyPal 行；MyPal 出现 **本地无此邮箱** 的 `seedId` 时无对应 `employees` 行，同步/报表需定义策略（跳过、告警、待补员工主数据等）。

### 9.2 MyPal 数据行字段（官方表项）

以下为 MyPal 数据集成对应的 **字段名、类型、可空性与含义**（与产品学习进度 / 任务周维度合一的一条记录；具体物理表名或 API 路径以 MyPal 交付为准）。

| 字段名 | 数据类型 | 可空 | 说明 |
|--------|----------|------|------|
| `seedId` | String | 否 | SEED ID，即 **用户邮箱**；**与 `employees.email` 一一对应**，用于标识店员 |
| `productName` | String | 否 | 产品名称 |
| `firstUseTime` | String | 是 | 账号 **首次使用时间**，格式 `yyyy-MM-dd HH:mm:ss`；**从未登录系统时为 `null`** |
| `taskWeek` | String | 否 | **任务周**（示例：`FY26Q2W1`）；返回与 `queryDate` 对应的周次数据 |
| `progress` | Integer | 否 | **完成进度**，取值范围 **0–100** |
| `passedWeek` | String | 是 | **实际通关所在任务周**（示例：`FY26Q2W2`）；**尚未通关时为 `null`** |
| `passedTime` | String | 是 | **实际通关时间**，格式 `yyyy-MM-dd HH:mm:ss`；**尚未通关时为 `null`** |
| `required` | Boolean | 否 | 是否 **必学**：`true` = 必学人员，`false` = 选学人员 |
| `weekStartTime` | String | 是 | 该任务周 **开始学习的时间**，格式 `yyyy-MM-dd HH:mm:ss`；**尚未开始学时为 `null`** |

### 9.2.1 本地开发表字段映射（`mypal_learning_mock`）

开发联调使用 SQLite 的开发专用表 `mypal_learning_mock` 存储同形态字段；其物理列名与 MyPal 输出字段名存在命名差异，映射关系如下：

- `seed_id` → `seedId`
- `product_name` → `productName`
- `first_use_time` → `firstUseTime`
- `task_week` → `taskWeek`
- `passed_week` → `passedWeek`
- `passed_time` → `passedTime`
- `required`（0/1）→ `required`（mock API 返回 true/false）
- `week_start_time` → `weekStartTime`

### 9.3 典型用途与与本系统字段的关系

- **催办 / 报表：** 结合 `required`、`progress`、`passedWeek` / `passedTime` 筛「必学且未完成或低进度」、按周统计通关情况；`taskWeek` 与财年周次（如 `FY26Q2W1`）对齐运营口径。
- **与 `task_assignments`：** MyPal 行是 **产品 × 任务周** 维度的学习事实；`task_assignments.progress` 是 **本系统单条培训任务** 的完成度。**粒度不同**，交叉分析需业务约定「任务 ↔ 产品 / 任务周」映射，不可直接等同。

> **命名说明：** 若集成层或 ETL 仍使用历史逻辑名（如 `unique_code`、`user_uid`、`product_name`），请在集成设计文档中维护 **「MyPal 官方字段名 ↔ 内部逻辑名」** 对照；上表以 MyPal 当前对外字段名为准。

---

## 表关系总览

```
（外部）MyPal 数据行.seedId  ──逻辑键──▶  employees.email  （非外键、非 SQL 连接）

users (INTEGER PK)
  ├─ store_id    → stores.id
  └─ employee_id → employees.id  [UNIQUE：一对一]

employees (TEXT PK: E001)
  └─ store_id    → stores.id

tasks (TEXT PK: nanoid)
  └─ (1:N) ───────────────────────────────────────────▶ task_assignments
                                                            ├─ task_id  → tasks.id
                                                            ├─ user_id  → employees.id
                                                            └─ store_id → stores.id

notification_events (TEXT PK: nanoid)
  ├─ task_id        → tasks.id
  ├─ assignment_id  → task_assignments.id
  ├─ target_user_id → employees.id
  ├─ store_id       → stores.id
  └─ initiator_id   → users.id（INTEGER，可空）

read_receipts (TEXT PK: nanoid)
  ├─ event_id → notification_events.id
  └─ user_id  → employees.id

nudge_records (TEXT PK: nanoid)
  ├─ task_id      → tasks.id
  └─ initiator_id → users.id（INTEGER）
```

---

## 变更记录

### v2.6.8（2026-04-02）

| 范围 | 变更 | 理由 |
|------|------|------|
| §9.2.1 | 新增 `mypal_learning_mock`（本地）字段 → MyPal 字段（seedId/productName/...）映射说明 | 避免命名差异导致前端联调误读 |

### v2.6.7（2026-04-02）

| 范围 | 变更 | 理由 |
|------|------|------|
| §9 | 澄清：生产接入情况下不写入本地 SQLite；开发联调可用开发专用表 `mypal_learning_mock` 承载同形态 MyPal 数据 | 避免与当前 mock 表实现口径冲突 |

### v2.6.6（2026-04-02）

| 范围 | 变更 | 理由 |
|------|------|------|
| §9 | 新增 **§9.1**：明确本地 SQLite 与 MyPal **非数据库连接**、仅 **`seedId`↔`email` 应用层对齐**；补充与 `mypal_completed` 粒度差异、未匹配策略、规范化 | 避免误理解为双库 FK 或可直接 JOIN |
| 表关系总览 | 增加 MyPal→`employees.email` 逻辑键示意 | 与 §9 一致 |
| 文档元信息 | 版本号与更新日期对齐变更记录 | 一致性 |

### v2.6.5（2026-04-02）

| 范围 | 变更 | 理由 |
|------|------|------|
| employees / §9 | 明确 **`seedId` ↔ `employees.email`** 一一对应；§2 重要说明与 `seedId` 字段行同步 | 与 MyPal 集成口径一致 |

### v2.6.4（2026-04-02）

| 范围 | 变更 | 理由 |
|------|------|------|
| §9 MyPal | 按官方数据集成表项更新：字段 `seedId`、`productName`、`firstUseTime`、`taskWeek`、`progress`、`passedWeek`、`passedTime`、`required`、`weekStartTime` 及可空性与含义 | 与 MyPal 对外字段一致 |

### v2.6.3（2026-04-01）

| 范围 | 变更 | 理由 |
|------|------|------|
| 设计约定 | 时间字段不再笼统写「UTC」；说明 `datetime('now')` 为服务器本地时区 | 避免与 SQLite 实际行为矛盾 |
| tasks | `store_scope` 字段表改为「必填（有默认）」 | 与 `NOT NULL DEFAULT 'all'` 一致 |
| §9 | `employees.email` 与「非空、唯一」表述改为：库可空，对接 MyPal 时须填邮箱 | 与 §2 可空字段一致 |
| §9.1 | 补充与 `task_assignments.progress` 粒度差异说明 | 避免误将产品学习进度与单任务进度直接等同 |
| §8 | 增加与 `schema.sql` 可能不一致时的实现说明 | 文档目标结构 vs 当前迁移状态 |

### v2.6.2（2026-04-01）

| 范围 | 变更 | 理由 |
|------|------|------|
| employees | 新增 `email`（可空，非空时唯一）及 `idx_employees_email` | 与 MyPal 邮箱对齐，最小改动打通 `employees.id` ↔ MyPal 行 |

### v2.6.1（2026-04-01）

| 范围 | 变更 | 理由 |
|------|------|------|
| §9 MyPal | 明确 `unique_code` 与 `user_uid` 同义（均为用户邮箱）；两表通过邮箱串联 | 与 MyPal 侧 UID 口径一致，避免集成时误当作不同键 |

### v2.6.0（2026-04-01）

| 范围 | 变更 | 理由 |
|------|------|------|
| §9 MyPal | 新增 `mypal_product_learning_progress`、`mypal_weekly_task_clearance` 逻辑表说明 | MyPal 端可提供学习进度与任务周通关数据，供店员任务查询、催办、AI 等能力对接 |

### v2.5.0（2026-03-31）

| 范围 | 变更 | 理由 |
|------|------|------|
| 全局 | 移除 `store_manager` 角色 | 业务需求变更，砍掉店长端，统一保留店员。 |
| employees | 删除 `is_manager` 字段 | 同上 |
| users | `role` 删除 `store_manager` 枚举 | 同上 |
| tasks | 删除 `target_role` 字段 | 任务目标只针对店员，不再需要区分角色 |
| task_assignments | 删除 `user_role` 字段 | 冗余角色区分字段不再需要 |
| notification_events | 删除 `target_role` 字段；删除 `initiator_role` 字段 | 同上 |
| nudge_records | 删除 `initiator_role` 字段 | 同上 |

### v2.4.1（2026-03-31）

| 范围 | 变更 | 理由 |
|------|------|------|
| notification_events | 新增 `store_id TEXT NOT NULL REFERENCES stores(id)` | 支持按门店快速查询通知事件，减少跨表 JOIN 成本 |
| notification_events | 新增索引 `idx_ne_store_id` | 优化门店维度过滤与聚合性能 |

### v2.4.0（2026-03-31）

| 范围 | 变更 | 理由 |
|------|------|------|
| 设计约定 | 时间规范明确为 SQLite UTC 文本 + API 层 ISO 输出 | 消除“文档格式”和 `datetime('now')` 默认值的口径冲突 |
| 全局策略 | 新增“MVP 快速落地与后续扩展原则” | 明确当前设计的取舍边界与演进方向 |
| tasks | `rtm_filter/store_scope` 增加 JSON 合法性约束 | 降低应用层漏校验导致脏数据风险 |
| task_assignments | 明确 `user_role/store_id` 为“下发时快照语义” | 保证统计口径稳定，避免历史数据回写争议 |
| notification_events | 增加 event_type/severity CHECK；补充事件类型与字段必填关系约束 | 强化事件审计数据一致性 |
| read_receipts | `source` 加 CHECK | 防止非法来源值写入 |
| nudge_records | `target_type/initiator_role/severity` 加 CHECK；`notification_event_ids` 增加 JSON 数组约束 | 强化催办审计完整性 |

### v2.0.0（2026-03-31）

| 表 | 变更 | 理由 |
|----|------|------|
| stores | 删除 `rank`、`risk_level` | PRD 无此概念，预警/排名动态计算不入库 |
| employees | 删除 `risk_level`、`last_active` | PRD 无此概念 |
| users | `role` 枚举新增 `executive` | PRD §2.2 定义四角色 |
| tasks | `platforms TEXT` → 4 个独立布尔列 + CHECK 约束 | 平台固定，布尔列查询性能更好，约束更严格 |
| task_assignments | `user_id` 改为 `REFERENCES employees(id)` | 统一外键来源 |
| notification_events | `target_user_id` 改为 `REFERENCES employees(id)` | 与 task_assignments 保持一致 |
| read_receipts | `user_id` 改为 `REFERENCES employees(id)` | 全表统一 |
| nudge_records | `initiator_id` 改为 `INTEGER REFERENCES users(id)` | central 无 employee.id，发起人身份属认证层 |

### v2.3.0（2026-03-31）

每张表新增**业务含义说明段落**，字段描述表补全所有字段（原版部分表仅列了关键字段，name/city/title 等基础字段缺少解释）。无结构性变更。

### v2.2.0（2026-03-31）

| 表 | 变更 | 理由 |
|----|------|------|
| tasks | `created_at` / `updated_at` 加 `DEFAULT (datetime('now'))` | 与 employees/users 保持一致，防止应用层漏传 |
| task_assignments | `created_at` / `updated_at` 加 `DEFAULT (datetime('now'))` | 同上 |
| notification_events | `created_at` 加 `DEFAULT (datetime('now'))` | 同上 |
| notification_events | `assignment_id` 注释修正：task_assigned 也必填，只有 task_updated 可空 | 注释与 event_type 表格不一致 |
| nudge_records | `created_at` 加 `DEFAULT (datetime('now'))` | 同上 |
| read_receipts | `read_at` 加 `DEFAULT (datetime('now'))` | 同上 |
| 表关系图 | 修正 read_receipts 层级：从 initiator_id 下移至 notification_events 同级 | 图示归属错误 |
| 数据量预估 | users 行补充 executive 用户 | 遗漏角色 |

### v2.1.0（2026-03-31）

| 表 | 变更 | 理由 |
|----|------|------|
| stores | 删除 `sub_rtm` | 始终等于 rtm，冗余；RTM 筛选 SQL 从未使用 |
| users | `employee_id` 加 `UNIQUE` 约束 | 一对一关系，防止同一 employee 被创建两个账号 |
| tasks | `status` 加 CHECK 枚举约束 | DB 层拦截非法状态写入 |
| task_assignments | `status` 加 CHECK 枚举约束 | DB 层拦截非法状态写入 |
| task_assignments | `progress` 加 CHECK BETWEEN 0 AND 100 | DB 层拦截超出范围的进度值 |
| task_assignments | `user_role` 加 CHECK 枚举约束 | 与 status 保持一致策略 |
| task_assignments | 索引从单列改为复合索引 (task_id, store_id, status) | 覆盖看板门店聚合查询，避免回表 |
| notification_events | `initiator_id` 从 TEXT 改为 INTEGER REFERENCES users(id) | central 无 employee.id；与 nudge_records 对齐 |
| notification_events | 新增 PARTIAL UNIQUE INDEX on dedupe_key | DB 层真正保证 task_assigned 幂等 |
| nudge_records | `notification_event_ids` 改为 NOT NULL | PRD §5.5 要求完整催办审计记录 |

---

## 数据量预估（MVP Mock）

| 表 | 预计行数 |
|----|---------|
| stores | 50 |
| employees | 300|
| users | ~303+（1 central + 300 employee + 1 admin + executive 若干）|
| tasks | 3–10 |
| task_assignments | 任务数 × ~300 |
| notification_events | 任务数 × ~300 + 催办次数 |
| read_receipts | ≤ notification_events 数 |
| nudge_records | < 200 |
