# 后端接入设计文档

**日期：** 2026-03-16
**项目：** MVP — 零售培训 AI Agent 系统
**目标：** 将现有纯 Mock 前端演示系统产品化，接入真实后端，支持持久化、多租户鉴权、真实写操作，并为后期 AI 能力预留接口。

---

## 1. 项目背景与目标

### 现状

- 前端三端（central.html / store.html / employee.html）所有数据来自 `data.js` 中的硬编码 Mock 数据（`window.AppData`）
- 已有一个轻量 Node.js 后端（`server/index.js`）提供事件总线（WebSocket + REST），负责跨设备实时同步
- 写操作（发布任务、确认告警、提交情报等）大量以 `showToast()` 占位，未落库
- 没有任何用户鉴权，三端均可匿名访问

### 目标

1. **演示更真实**：数据持久化，刷新不丢失，多设备一致
2. **多租户鉴权**：每人独立账号，按角色隔离数据
3. **写操作落库**：核心操作真实写入数据库
4. **AI 能力预留**：设计后端 AI 代理接口，MVP 先 Mock，后逐步接 Claude API
5. **快速迭代**：前端现有 HTML 最小改动，新增最少文件

---

## 2. 技术选型

| 层级 | 选型 | 理由 |
|------|------|------|
| 后端框架 | Node.js + Express（现有扩展） | 零迁移成本，已有可运行代码 |
| 数据库 | SQLite（via better-sqlite3） | 零配置，单文件，比 state.json 可靠，适合内网部署 |
| 鉴权 | JWT（jsonwebtoken + bcryptjs） | 无状态，轻量，适合小规模内网系统 |
| 部署 | 本地/内网，单机 | 与现有 LAN 模式一致 |
| AI 接入（后期） | Anthropic Claude API，后端代理 | API Key 不暴露前端，可 Mock，可限流 |

---

## 3. 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│  前端（/front-end）                                          │
│  central.html / store.html / employee.html  ← 最小改动      │
│  login.html（新增）  admin.html（新增）                      │
│  js/auth.js（新增）  js/data.js（改为 Async Adapter）        │
└────────────────┬────────────────────────────────────────────┘
                 │ HTTP REST + WebSocket
┌────────────────▼────────────────────────────────────────────┐
│  后端（/server）                                             │
│  index.js（扩展）  auth.js（新增）  db.js（新增）            │
│  seed.js（新增）   routes/（新增：各资源路由）               │
│  ai.js（新增，MVP 阶段 Mock，后期接 Claude）                 │
└────────────────┬────────────────────────────────────────────┘
                 │ SQLite
┌────────────────▼──────────────┐
│  database.db                  │
│  stores / users / employees   │
│  events / tasks / alerts      │
│  intel_submissions            │
└───────────────────────────────┘
```

---

## 4. 数据库 Schema

> **命名约定：** 所有数据库列名使用 `snake_case`，API 响应序列化时统一转为 `camelCase`，与现有前端 `data.js` 字段名完全一致。

```sql
-- 门店表
CREATE TABLE stores (
  id         TEXT PRIMARY KEY,           -- e.g. 'S001'
  name       TEXT NOT NULL,
  region     TEXT NOT NULL,
  rtm        TEXT NOT NULL,              -- CS / MS / DS
  city       TEXT NOT NULL,
  rank       INTEGER,
  risk_level TEXT DEFAULT 'low'          -- low / medium / high
);
CREATE INDEX idx_stores_region ON stores(region);
CREATE INDEX idx_stores_rtm ON stores(rtm);

-- 用户表（登录账号）
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL,           -- admin / central / store / employee
  store_id      TEXT REFERENCES stores(id),   -- store/admin 角色填写
  employee_id   TEXT REFERENCES employees(id), -- employee 角色填写
  created_at    TEXT DEFAULT (datetime('now'))
);

-- 员工表（含学习进度）
-- 布尔字段用 INTEGER 存储（0/1），API 序列化时转为 boolean
-- computed 字段（allDone, passTest, passed, reached）在 API 层计算后附在响应中
CREATE TABLE employees (
  id           TEXT PRIMARY KEY,         -- e.g. 'E001'
  store_id     TEXT NOT NULL REFERENCES stores(id),
  name         TEXT NOT NULL,
  role         TEXT NOT NULL,            -- 店长 / 副店长 / 资深销售顾问 / 销售顾问
  is_manager   INTEGER DEFAULT 0,        -- 0 / 1
  sc_modules   INTEGER DEFAULT 0,        -- Sales Coach 完成模块数 (0-28)
  sc_test      INTEGER DEFAULT 0,        -- 测验分数
  live_watched INTEGER DEFAULT 0,        -- 是否观看直播 0/1
  mypal_days   INTEGER DEFAULT 0,        -- MyPAL 学习天数
  ai_coach     INTEGER DEFAULT 0,        -- AI Coach 完成脚本数 (0-6)
  risk_level   TEXT DEFAULT 'normal',    -- normal / p2 / p1
  last_active  TEXT,
  created_at   TEXT DEFAULT (datetime('now'))
);
-- region / rtm 字段在 API 层从 stores 表 JOIN 后附加到响应，无需在 employees 表冗余
CREATE INDEX idx_employees_store_id ON employees(store_id);
CREATE INDEX idx_employees_risk_level ON employees(risk_level);

-- 事件流（字段名与现有 state.json 保持一致，API 输出不变）
CREATE TABLE events (
  id         TEXT PRIMARY KEY,            -- evt_1, evt_2, ...
  type       TEXT NOT NULL,
  "from"     TEXT NOT NULL,              -- central / store / employee（保留现有字段名）
  payload    TEXT DEFAULT '{}',           -- JSON 字符串（保留现有字段名）
  at         TEXT DEFAULT (datetime('now')) -- 保留现有字段名，格式 ISO 8601
);

-- 任务表
CREATE TABLE tasks (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  status      TEXT DEFAULT 'active',      -- active / completed / cancelled
  deadline    TEXT,
  target_role TEXT DEFAULT 'all',         -- all / manager / employee（可过滤）
  store_scope TEXT DEFAULT 'all',         -- all 或 JSON 数组 store id 列表
  created_by  TEXT,
  config_json TEXT DEFAULT '{}',          -- 平台配置、里程碑等扩展字段
  created_at  TEXT DEFAULT (datetime('now'))
);

-- 告警表
-- 业务约束：store_id 必须非空；employee_id 可为空（门店级告警）
CREATE TABLE alerts (
  id               TEXT PRIMARY KEY,
  level            TEXT NOT NULL,          -- p1 / p2
  store_id         TEXT NOT NULL REFERENCES stores(id),
  employee_id      TEXT REFERENCES employees(id), -- null = 全店告警
  trigger_desc     TEXT,
  root_cause       TEXT,
  suggestions_json TEXT DEFAULT '[]',      -- [{ id, action, type }, ...]
  status           TEXT DEFAULT 'pending', -- pending / in_progress / resolved
  acknowledged_by  TEXT,                   -- 执行人 user id
  acknowledged_at  TEXT,
  intervention_json TEXT DEFAULT '{}',     -- { actionId, executedAt, result }
  created_at       TEXT DEFAULT (datetime('now')),
  CHECK (store_id IS NOT NULL)
);
CREATE INDEX idx_alerts_store_id ON alerts(store_id);
CREATE INDEX idx_alerts_status ON alerts(status);

-- 情报/VOC/求助提交表（统一存储，用 type 区分）
CREATE TABLE intel_submissions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  type         TEXT NOT NULL,              -- intel / voc / help
  task_id      TEXT,
  employee_id  TEXT REFERENCES employees(id),
  store_id     TEXT REFERENCES stores(id),
  content      TEXT,
  urgent       INTEGER DEFAULT 0,          -- 仅 help 类型使用，0/1
  submitted_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_intel_store_id ON intel_submissions(store_id);
CREATE INDEX idx_intel_type ON intel_submissions(type);
```

### Trade-in 项目数据说明

Trade-in 项目（`TRADEIN_PROJECT`、`TRADEIN_PILOT_STORES`、`TRADEIN_STORE_TIMELINE`、`TRADEIN_EMPLOYEE_TIMELINE`、`isPilotStore()`）**MVP 阶段继续在 `data.js` 中硬编码**，不迁移到数据库。原因：这批数据在演示中属于固定场景脚本，暂无多端写操作需求。后期如需持久化，新增 `projects` 和 `project_stores` 表再迁移。

---

## 5. 鉴权设计

### JWT 配置

- **签名算法：** HS256
- **Secret：** 从环境变量 `JWT_SECRET` 读取；开发时若未设置，使用 fallback `'mvp-dev-secret-change-in-prod'` 并打印警告
- **Token 有效期：** 7 天（内网演示系统，无需频繁刷新）
- **存储位置：** 前端 `localStorage['mvp_token']`

### 登录流程

```
1. 用户打开任意页面（central / store / employee）
2. js/auth.js 检查 localStorage['mvp_token']
   - 无效 / 过期 / 无 token → 跳转 login.html
   - 有效 → 验证 role 是否匹配当前页面 → 继续加载
3. login.html
   - POST /api/login { username, password }
   - 返回 { token, user: { id, role, storeId, employeeId, name } }
   - 存入 localStorage，按 role 跳转：
       admin    → admin.html
       central  → central.html
       store    → store.html
       employee → employee.html
```

### 角色与数据隔离规则

| role | 可访问页面 | 数据范围 |
|------|-----------|----------|
| `admin` | admin.html + 所有页面 | 所有门店、所有员工 |
| `central` | central.html | 所有门店只读数据 |
| `store` | store.html | 仅自己 storeId 的数据 |
| `employee` | employee.html | 仅自己 employeeId 的数据 |

### Auth.requireRole() 实现要求

`front-end/js/auth.js` 中的 `Auth.requireRole(role)` 必须：
1. 仅执行同步的 `localStorage` 读取（无网络请求）
2. 若 token 不存在或 role 不匹配，立即调用 `window.location.replace('login.html')` 并 `return`，阻止后续脚本执行
3. 不依赖 `DOMContentLoaded`，在 `<script>` 标签解析时立即执行
4. token 过期判断：解码 JWT payload（Base64），比对 `exp` 字段与 `Date.now()/1000`

### HTTP 错误响应规范

| 场景 | 状态码 |
|------|--------|
| 无 token / token 无效 | 401 `{ "error": "Unauthorized" }` |
| token 有效但 role 不足 | 403 `{ "error": "Forbidden" }` |
| 资源不存在 | 404 `{ "error": "Not found" }` |
| 请求体缺少必填字段 | 400 `{ "error": "..." }` |

### JWT 中间件作用范围

- **需要 JWT：** 所有 `/api/*` 接口（除下列白名单）
- **白名单（无需 Token）：**
  - `GET /api/health`
  - `POST /api/login`
  - `GET /api/state`（保持向后兼容，供 api.js 轮询使用）
  - `GET /api/events`（保持向后兼容）
  - `POST /api/events`（保持向后兼容，事件总线）
  - `GET /ws`（WebSocket 升级）

> **说明：** 现有 `api.js` 中 `getState()`、`postEvent()` 均不携带 Authorization header，为保持事件总线功能不中断，这些接口在白名单内。Phase 3 后新增的受保护接口全部需要 Bearer token。

---

## 6. API 接口清单与数据结构

### 现有（白名单，保持不变）

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/health` | GET | 健康检查 |
| `/api/state` | GET | 完整状态（轮询） |
| `/api/events` | GET | 事件列表 |
| `/api/events` | POST | 追加事件 |
| `/ws` | WS | WebSocket 实时推送 |

### Phase 2 新增（鉴权）

**POST /api/login**
```json
// 请求
{ "username": "central_admin", "password": "Train2026!" }

// 响应 200
{
  "token": "<jwt>",
  "user": { "id": 1, "role": "central", "storeId": null, "employeeId": null, "name": "总部运营" }
}

// 响应 401
{ "error": "用户名或密码错误" }
```

**GET /api/me**
```json
// 响应 200（从 JWT 解析）
{ "id": 1, "role": "store", "storeId": "S001", "employeeId": null, "name": "小李（店长）" }
```

### Phase 3 新增（读数据，均需 Bearer token）

**GET /api/employees**（Phase 3 新增，供 central/admin 拉取全量员工）
```json
// 支持查询参数：?storeId=S001&riskLevel=p1
// central/admin 可访问；store/employee 不可访问（返回 403）
// 返回结构同 GET /api/stores/:id/employees
[{ "id": "E001", "storeId": "S001", ... }]
```

**GET /api/stores**
```json
// central/admin 返回全量；store role 返回仅自己门店的数组（1条）
[
  {
    "id": "S001", "name": "朝阳大悦城店", "region": "华北区",
    "rtm": "CS", "city": "北京", "rank": 1, "riskLevel": "low"
  }
]
```

**GET /api/stores/:id/employees**
```json
// 返回该门店员工数组，computed 字段由 API 层计算后附加
[
  {
    "id": "E001", "storeId": "S001", "storeName": "朝阳大悦城店",
    "name": "小李", "role": "店长", "isManager": true,
    "region": "华北区", "rtm": "CS",
    "scModules": 28, "scTest": 92, "liveWatched": true,
    "mypalDays": 2, "aiCoach": 6,
    "allDone": true, "passTest": true, "reached": true, "passed": true,
    "riskLevel": "normal", "lastActive": "2026-03-10T09:45:00.000Z",
    "isSelf": false
  }
]
// isSelf 由后端根据 JWT 中的 employeeId 判断并注入
```

**GET /api/stats**
```json
// 与现有 calcStats() 返回结构完全一致
{
  "totalEmployees": 300, "totalStores": 50,
  "passRate": 42, "reachRate": 88, "overallCompletion": 61,
  "p1Count": 3, "p2Count": 8, "alertCount": 5,
  "scCompletion": 67, "liveCompletion": 72,
  "mypalCompletion": 58, "aiCoachCompletion": 55,
  "intelReturnRate": 68, "passed": 126, "reached": 264
}
```

**GET /api/alerts**
```json
// central 返回全量；store 仅返回自己门店的告警
[
  {
    "id": "AL001", "level": "p1", "storeId": "S004", "storeName": "石家庄北国商城店",
    "employeeId": null, "employeeName": "全员(5人)",
    "trigger": "72小时无学习行动", "rootCause": "...",
    "aiSuggestions": [{ "id": "AS001", "action": "推送店长专属督促通知", "type": "notify" }],
    "status": "pending", "createdAt": "2026-03-10T08:00:00.000Z",
    "acknowledgedBy": null, "acknowledgedAt": null, "intervention": {}
  }
]
```

**GET /api/tasks**
```json
[
  {
    "id": "T001", "name": "2026年Q1新品发布训练营",
    "status": "active", "deadline": "2026-03-17T14:00:00",
    "targetRole": "all", "storeScope": "all",
    "createdBy": "总部培训团队", "createdAt": "2026-03-08T18:00:00"
  }
]
```

### Phase 4 新增（写操作，均需 Bearer token）

**POST /api/tasks**（central/admin）
```json
// 请求
{
  "name": "Q1新品训练", "deadline": "2026-03-17T14:00:00",
  "targetRole": "all", "storeScope": "all",
  "config": { "platforms": [...], "milestones": [...] }
}
// config 对象在后端序列化为 config_json TEXT 存储，响应时反序列化为对象返回
// 响应 201
{
  "id": "T002", "name": "Q1新品训练", "status": "active",
  "deadline": "2026-03-17T14:00:00", "targetRole": "all", "storeScope": "all",
  "createdBy": "central", "createdAt": "2026-03-16T10:00:00.000Z",
  "config": { "platforms": [...], "milestones": [...] }
}
// GET /api/tasks 列表也包含 config 字段（不省略）
```

**POST /api/alerts/:id/ack**（store/admin）
```json
// 请求
{ "actionId": "AS001", "action": "推送店长专属督促通知" }
// 响应 200
{ "ok": true, "alert": { ...更新后的告警对象 } }
// 权限规则：store 角色只能 ack 其 JWT storeId 匹配的告警；
//           访问其他门店告警返回 403（即使 alertId 合法）
```

**POST /api/intel**（employee/admin）
```json
// 请求
{ "taskId": "IT001", "content": "顾客问以旧换新折价..." }
// 响应 201：{ "id": 1, "type": "intel", ... }
```

**POST /api/voc**（employee/admin）
```json
// 请求
{ "summary": "顾客关注续航和价格" }
// summary 字段映射到 intel_submissions.content 列存储
// 响应 201：{ "id": 2, "type": "voc", "content": "顾客关注续航和价格", ... }
```

**POST /api/help**（employee/admin）
```json
// 请求
{ "issueType": "系统故障", "description": "评估工具打不开", "urgent": true }
// 字段映射：content = JSON.stringify({ issueType, description })，urgent = 1/0
// 响应 201：{ "id": 3, "type": "help", "content": "{issueType:...}", "urgent": true, ... }
```

### Phase 4 新增（管理后台，需 role=admin）

**GET /api/admin/employees**
```json
// 支持查询参数：?storeId=S001&riskLevel=p1
// 返回员工数组（同 GET /api/stores/:id/employees 结构）
```

**PUT /api/admin/employees/:id**
```json
// 请求（所有字段可选，仅更新传入字段）
{
  "scModules": 20, "scTest": 85, "liveWatched": true,
  "mypalDays": 2, "aiCoach": 4, "riskLevel": "p2"
}
// 响应 200：更新后的员工对象
```

**POST /api/admin/employees**（新增员工）
```json
// 请求
{
  "storeId": "S001", "name": "小钱", "role": "销售顾问",
  "isManager": false
}
// 响应 201：新建员工对象（id 由后端生成）
// 同时自动创建对应的 users 账号：
//   username: "emp_<employeeId>", password: "Train2026!"
```

**DELETE /api/admin/employees/:id**
```json
// 响应 200：{ "ok": true }
// 同时删除关联 users 账号
```

**POST /api/admin/stores/:id/reset**
```json
// 将该门店所有员工进度重置为 seed 初始值（非全零，而是 seed 脚本中的捏造值）
// 响应 200：{ "ok": true, "resetCount": 6 }
```

**POST /api/admin/seed**
```json
// 请求（可选）
{ "confirm": true }
// 实现：在单个 SQLite 事务中执行 DELETE + INSERT，保证原子性，防止并发写入冲突
// 清空并重新 seed 全部门店/员工/用户数据
// 响应 200：{ "ok": true, "stores": 50, "employees": 300, "users": 352 }
```

### Phase 4 新增（AI 代理，MVP 先 Mock）

所有 AI 接口请求均携带 Bearer token，响应结构在 Mock 和真实 Claude 接入时保持一致。

**POST /api/ai/chat**
```json
// 请求
{
  "query": "小王的学习建议",
  "context": { "role": "store", "storeId": "S001", "employeeId": null }
}
// 响应（结构固定，Mock 和 Claude 版本一致）
{
  "answer": "...",
  "confidence": 0.92,
  "source": "RAG知识库"
}
```

**POST /api/ai/intervention**
```json
// 请求
{ "alertId": "AL002", "employeeData": { "scModules": 8, "scTest": 62, ... } }
// 响应
{ "suggestions": [{ "id": "AS_gen_1", "action": "...", "type": "notify" }] }
```

**POST /api/ai/intel-summary**
```json
// 请求
{ "submissions": [{ "content": "..." }, ...], "taskId": "IT001" }
// 响应
{ "insights": ["竞品降价集中在华东...", ...], "talkPoints": ["..."] }
```

**POST /api/ai/script**
```json
// 请求
{ "scenario": "以旧换新价格异议", "context": "顾客问折价多少" }
// 响应
{ "script": "..." }
```

**POST /api/ai/study-plan**
```json
// 请求
{ "employeeId": "E005", "progress": { "scModules": 8, "scTest": 62, ... } }
// 响应
{ "plan": [{ "day": 1, "tasks": ["SC模块1-4", "AI Coach以旧换新"] }, ...] }
```

---

## 7. 前端改动清单

### 新增文件

| 文件 | 说明 |
|------|------|
| `front-end/login.html` | 统一登录页，按 role 跳转 |
| `front-end/admin.html` | 管理后台（见第 8 节） |
| `front-end/js/auth.js` | JWT 存取、auth 检查、登出工具函数 |

### 修改文件

**`front-end/js/data.js` — 改为异步 Adapter**

现有 `data.js` 是同步 IIFE，立即赋值 `window.AppData`。改造后：

1. `window.AppData` 仍然立即赋值（保持现有引用不报错）
2. 所有数据字段初始为空数组/空对象
3. 新增 `AppData.init()` 异步方法，调用 API 填充所有字段
4. `calcStats()`、`getStoreRanking()` 等计算函数继续在客户端运行（基于已拉取的 `ALL_EMPLOYEES`）
5. Trade-in 相关数据（`TRADEIN_PROJECT` 等）保持硬编码不变

**AppData 完整公开接口表（必须全部保留，行为不变）：**

| 属性/方法 | 改造后来源 | 说明 |
|-----------|-----------|------|
| `NOW`, `TRAIN_START`, `TRAIN_END` | 继续硬编码（演示时间固定） | 时间常量，供 formatTimeAgo 等使用 |
| `REGIONS`, `RTM_TYPES` | 继续硬编码 | 枚举值 |
| `STORES` | API 拉取 | 门店数组 |
| `ALL_EMPLOYEES` | API 拉取 | 员工数组（含 computed 字段） |
| `TRAINING_TASK` | API 拉取（tasks[0]） | 当前训练任务 |
| `INTEL_TASKS` | 继续硬编码 | 情报任务列表（MVP 不入库） |
| `INTEL_AGGREGATED` | 继续硬编码 | 聚合情报（MVP 不入库） |
| `ALERTS` | API 拉取 | 告警列表 |
| `STORE_TIMELINE_S001` | 继续硬编码 | 时间流卡片脚本 |
| `EMPLOYEE_TIMELINE_E005` | 继续硬编码 | 时间流卡片脚本 |
| `TRADEIN_PROJECT` 等所有 Trade-in 数据 | 继续硬编码 | MVP 不入库 |
| `CHATBOT_KB` | 继续硬编码（Phase 4 前） | 关键词匹配知识库 |
| `Q1_SCOPE`, `TRADEIN_SCOPE` | 继续硬编码 | 口径常量 |
| `TOTAL_LEARNERS` 等数字常量 | 继续硬编码 | 向后兼容 |
| `calcStats()` | 客户端计算（基于 ALL_EMPLOYEES） | 与现有逻辑一致 |
| `getStoreRanking()` | 客户端计算（基于 STORES + ALL_EMPLOYEES） | 与现有逻辑一致 |
| `getStore(id)` | 查找 STORES | 不变 |
| `getStoreEmployees(sid)` | 过滤 ALL_EMPLOYEES | 不变 |
| `getEmployee(id)` | 查找 ALL_EMPLOYEES | 不变 |
| `getStoreAlerts(sid)` | 过滤 ALERTS | 不变 |
| `getManagerByStore(sid)` | 过滤 ALL_EMPLOYEES | 不变 |
| `isPilotStore(sid)` | 查找 TRADEIN_PILOT_STORES | 不变 |
| `chatbotQuery(q)` | Phase 3 保留关键词匹配；Phase 4 改调 `/api/ai/chat` | 接口签名不变 |
| `formatTime(iso)` | 不变 | 时间格式化 |
| `formatTimeAgo(iso)` | 不变（依赖硬编码 NOW） | 相对时间 |
| `timeUntilDeadline()` | 不变（依赖硬编码 TRAIN_END） | 截止倒计时 |

```js
// data.js 改造后结构示意
window.AppData = (function() {
  // ── 始终硬编码的常量（保持 IIFE 闭包，NOW 依赖不变）──
  const NOW        = new Date('2026-03-10T10:45:00');
  const TRAIN_START = new Date('2026-03-09T00:00:00');
  const TRAIN_END   = new Date('2026-03-17T14:00:00');
  const REGIONS    = ['华北区','华东区','华南区','华中区','西南区'];
  const RTM_TYPES  = ['CS','MS','DS'];
  // ... 其余硬编码数据（INTEL_TASKS, INTEL_AGGREGATED, STORE_TIMELINE_S001,
  //     EMPLOYEE_TIMELINE_E005, 全部 Trade-in 数据, CHATBOT_KB, Q1_SCOPE 等）

  // ── 动态数据（init() 后填充）──
  let STORES = [], ALL_EMPLOYEES = [], ALERTS = [], TRAINING_TASK = {};

  async function init() {
    const token = localStorage.getItem('mvp_token');
    const me    = JSON.parse(localStorage.getItem('mvp_user') || '{}');
    const h     = { 'Authorization': 'Bearer ' + token };

    const [stores, stats, alerts, tasks] = await Promise.all([
      fetch('/api/stores', { headers: h }).then(r => r.json()),
      fetch('/api/stats',  { headers: h }).then(r => r.json()),
      fetch('/api/alerts', { headers: h }).then(r => r.json()),
      fetch('/api/tasks',  { headers: h }).then(r => r.json()),
    ]);
    STORES = stores;
    _stats = stats;
    ALERTS = alerts;
    TRAINING_TASK = tasks[0] || {};

    // store role：拉自己门店员工
    // central/admin role：拉全量（GET /api/employees，Phase 3 新增）
    const empUrl = me.storeId
      ? `/api/stores/${me.storeId}/employees`
      : '/api/employees';
    ALL_EMPLOYEES = await fetch(empUrl, { headers: h }).then(r => r.json());
  }

  let _stats = {};

  return {
    NOW, TRAIN_START, TRAIN_END, REGIONS, RTM_TYPES,
    get STORES() { return STORES; },
    get ALL_EMPLOYEES() { return ALL_EMPLOYEES; },
    get ALERTS() { return ALERTS; },
    get TRAINING_TASK() { return TRAINING_TASK; },
    // 硬编码数据直接暴露
    INTEL_TASKS, INTEL_AGGREGATED, STORE_TIMELINE_S001, EMPLOYEE_TIMELINE_E005,
    TRADEIN_PROJECT, TRADEIN_PILOT_STORES, TRADEIN_INTEL_TASKS,
    TRADEIN_STORE_TIMELINE, TRADEIN_EMPLOYEE_TIMELINE, CHATBOT_KB,
    Q1_SCOPE, TRADEIN_SCOPE, TOTAL_LEARNERS, TOTAL_STORES, LEARNERS_PER_STORE,
    TRADEIN_TOTAL_LEARNERS, TRADEIN_TOTAL_STORES,
    init,
    calcStats: () => _stats,
    getStoreRanking: () => { /* 基于 STORES + ALL_EMPLOYEES 客户端计算，逻辑与原 data.js 一致 */ },
    getStore: id => STORES.find(s => s.id === id),
    getStoreEmployees: sid => ALL_EMPLOYEES.filter(e => e.storeId === sid),
    getEmployee: id => ALL_EMPLOYEES.find(e => e.id === id),
    getStoreAlerts: sid => ALERTS.filter(a => a.storeId === sid),
    getManagerByStore: sid => ALL_EMPLOYEES.find(e => e.storeId === sid && e.isManager),
    isPilotStore: sid => TRADEIN_PILOT_STORES.includes(sid),
    chatbotQuery, formatTime, formatTimeAgo, timeUntilDeadline,
  };
})();
```

**`front-end/central.html`、`store.html`、`employee.html` — 顶部加 auth 检查 + 异步初始化**

在每个 HTML 的 `<body>` 顶部加：
```html
<script src="js/auth.js"></script>
<script>
  // 1. auth 检查（auth.js 提供）
  Auth.requireRole('central'); // 或 'store' / 'employee'

  // 2. 等 AppData 初始化完成后再渲染
  document.addEventListener('DOMContentLoaded', function() {
    window.AppData.init().then(function() {
      // 调用现有的页面初始化函数（各页面已有，名称不同）
      // central.html: renderDashboard()
      // store.html: renderTimeline()
      // employee.html: renderTimeline()
      initPage(); // 各页面需将现有初始化入口统一为 initPage()，或直接调用各自已有函数
    });
  });
</script>
```

> **注意：** 各 HTML 现有的渲染函数（如 `renderDashboard`）调用位置需从"脚本底部直接调用"改为"在 `AppData.init()` 的 `.then()` 内调用"。这是三个 HTML 页面唯一需要修改的逻辑，其余代码不变。

### 不动文件

- `front-end/js/api.js` — 事件总线保持不变（白名单接口无需 token）
- `front-end/js/crossTab.js` — 保持不变
- `front-end/index.html` — 保持不变
- 所有业务逻辑、UI 组件、样式 — 保持不变

---

## 8. 管理后台（admin.html）

### 功能模块

**Tab 1：员工进度管理**
- 按门店筛选（下拉选择 50 家门店）
- 表格展示该门店员工，每行可内联编辑以下字段：
  - `scModules`（数字输入，0-28）
  - `scTest`（数字输入，0-100）
  - `liveWatched`（勾选框）
  - `mypalDays`（数字输入，0-2）
  - `aiCoach`（数字输入，0-6）
- 编辑后点击"保存"调用 `PUT /api/admin/employees/:id`
- 批量操作：一键将当前门店所有员工进度重置为 seed 初始值（调用 `POST /api/admin/stores/:id/reset`）

**Tab 2：员工管理**
- 同样按门店筛选
- 支持新增员工（填写姓名、角色，自动分配 employeeId 和登录账号）
- 支持删除员工（同时删除登录账号）

**Tab 3：系统操作**
- "重新 Seed 全部数据"按钮（有二次确认弹窗，`POST /api/admin/seed`）
- 显示当前数据库统计：门店数、员工数、用户数、事件数

### 重置行为定义

- **门店重置（Post /api/admin/stores/:id/reset）**：将该门店所有员工的进度字段重置回 `seed.js` 中的初始捏造值（非清零，保持 seed 时的随机分布）
- **全量 Seed（POST /api/admin/seed）**：清空所有表并重新执行 seed 脚本，**用户账号也会重建**，需二次确认

---

## 9. Seed 账号规范与员工人数约定

### 员工人数（规范口径）

**标准口径：每店 6 人 × 50 店 = 300 名学员**（含店长）。`data.js` 旧注释中出现的 "280" 为早期估算，已废弃。`seed.js` 以 300 为准，所有统计分母均使用 300。

### Seed 账号

`seed.js` 执行时自动创建以下账号：

| 角色 | 数量 | 用户名规范 | 初始密码 | 备注 |
|------|------|-----------|----------|------|
| admin | 1 | `admin` | `Admin2026!` | 可访问所有页面 |
| central | 1 | `central` | `Train2026!` | 总部账号 |
| store | 50 | `store_S001`...`store_S050` | `Train2026!` | 对应各门店店长 |
| employee | 300 | `emp_E001`...`emp_E300` | `Train2026!` | 对应各员工 |

**`isSelf` 注入规则：** `GET /api/stores/:id/employees` 响应中，后端根据 JWT 中的 `employeeId` 字段，将匹配的员工对象的 `isSelf` 设为 `true`，其余为 `false`。`central` 和 `admin` 角色所有员工 `isSelf` 均为 `false`。

---

## 10. 后端文件结构（目标状态）

```
server/
├── index.js          # 入口：Express + WebSocket（扩展现有，添加路由注册）
├── db.js             # SQLite 初始化、建表、提供 db 实例
├── seed.js           # 数据初始化脚本（50店/300人捏造数据 + 352个账号）
├── auth.js           # JWT 中间件、登录逻辑
├── ai.js             # AI 代理接口（MVP Mock，后期换 Claude）
├── routes/
│   ├── login.js      # POST /api/login, GET /api/me
│   ├── stores.js     # GET /api/stores, GET /api/stores/:id/employees
│   ├── employees.js  # GET /api/employees/:id
│   ├── tasks.js      # GET/POST /api/tasks
│   ├── alerts.js     # GET /api/alerts, POST /api/alerts/:id/ack
│   ├── intel.js      # POST /api/intel, /api/voc, /api/help
│   ├── admin.js      # GET/PUT/POST/DELETE /api/admin/*
│   └── ai.js         # POST /api/ai/*
├── database.db       # SQLite 数据库文件（加入 .gitignore）
├── package.json      # 新增依赖：better-sqlite3, jsonwebtoken, bcryptjs
└── state.json        # Phase 1 完成后废弃
```

---

## 11. 实施阶段

### Phase 1：DB 层（无需前端改动）

- 新增 `db.js`：建表（含所有 schema 和 index）
- 新增 `seed.js`：50 家门店、300 名员工（捏造数据，固定不随机）+ 352 个账号
- `index.js` 改为从 SQLite 读取/写入 events，替代 state.json（字段名保持 `id`, `type`, `from`, `payload`, `at`）
- 验收：`node seed.js` 后数据库有数据，`npm start` 服务正常，`/api/state` 和 `/api/events` 行为不变

### Phase 2：鉴权层

- 新增 `auth.js`（后端）：JWT 签发与验证中间件、白名单配置
- 新增 `routes/login.js`：`/api/login`、`/api/me`
- 新增 `front-end/login.html`：用户名密码输入，按 role 跳转
- 新增 `front-end/js/auth.js`（前端）：`Auth.requireRole()`、token 读写、登出
- 三个 HTML 顶部加 auth 检查（不加 AppData.init，Phase 3 再改）
- 验收：未登录访问 central.html 跳转 login.html；用 `central` 账号登录后可正常进入

### Phase 3：读数据层（Adapter）

- 新增 routes/stores.js（`GET /api/stores`、`GET /api/stores/:id/employees`）
- 新增 routes/employees.js（`GET /api/employees`、`GET /api/employees/:id`）
- 新增 routes/tasks.js（`GET /api/tasks`）
- 新增 routes/alerts.js（`GET /api/alerts`）
- 新增 routes/stats.js（`GET /api/stats`）
- 改造 `data.js` 为异步 Adapter（`GET /api/employees` 供 central/admin 使用）
- 三个 HTML 初始化改为 `AppData.init().then(渲染函数)`
- 验收：三端数据来自 SQLite，刷新后数据稳定不随机，store 账号只见自己门店；central 账号可见全量员工数据

### Phase 4：写操作 + 管理后台 + AI 预留

- 实现 POST 接口：tasks、alerts/:id/ack、intel/voc/help
- 新增 `admin.html` 和 `routes/admin.js`
- 新增 `ai.js` 和 `routes/ai.js`（Mock 实现）
- 前端 `sendChat()` 改为调 `POST /api/ai/chat`
- 验收：管理后台可编辑员工进度并在三端实时反映；告警确认落库；聊天机器人走 API

---

## 12. 不在本期范围内

- 真实学习平台 API 对接（Sales Coach、MyPAL、AI Coach）
- 真实 Claude API 接入（AI 接口当前返回 Mock）
- HTTPS / SSL 证书（内网部署暂不需要）
- 邮件/短信通知
- 数据备份与恢复
- 多实例部署 / 负载均衡
- Trade-in 项目数据持久化（MVP 阶段继续硬编码）
