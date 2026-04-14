# TOT/Apple 培训任务管理系统 — 后端 MVP P0

零售门店培训任务管理平台。总部创建培训任务并按 RTM 渠道/区域下发给门店，店员在 MyPAL、SmartSell、AI Demo、Live Broadcast 四个平台完成学习后逐项打卡，系统实时聚合完成率并向总部和店长推送预警与催办。

---

## 目录

- [功能概览](#features)
- [技术栈](#tech-stack)
- [运行前准备](#prerequisites)
- [快速启动](#quick-start)
- [环境变量](#env)
- [测试账号](#test-accounts)
- [项目结构](#project-structure)
- [数据模型](#data-model)
- [角色权限](#roles)
- [API 概览](#api-overview)
- [WebSocket 事件](#websocket)
- [状态机](#state-machine)
- [开发规范](#dev-guide)
- [文档索引](#docs)

---

<a name="features"></a>
## 功能概览

| 模块 | 说明 |
|------|------|
| **任务管理** | 总部创建/编辑草稿任务，按 RTM 渠道筛选目标门店后一键下发 |
| **Assignment 状态机** | 店员接收任务 → 开始学习 → 逐平台打卡 → 自动计算进度 → 全部完成时自动结束 |
| **通知系统** | 任务下发/更新/催办产生通知事件，铃铛未读数实时更新 |
| **催办** | 总部/店长按员工/门店/区域维度发起黄色/红色催办 |
| **实时推送** | WebSocket 向员工和店长推送任务变更、催办、完成事件 |
| **看板聚合** | 总部概览 KPI、RTM 热力图、门店排行、预警列表、门店下钻 |
| **自动预警调度** | 服务端按间隔扫描已配置 `auto_nudge_rules` 的下发中任务；可调 `AUTO_NUDGE_INTERVAL_MS`，`AUTO_NUDGE_SCHEDULER=0` 关闭；详见 `docs/specs/04-API-SPEC.md` §2.9 |

---

<a name="tech-stack"></a>
## 技术栈

| 层 | 技术 |
|----|------|
| 运行时 | Node.js + Express 4.x |
| 数据库 | SQLite 3，WAL 模式，`better-sqlite3`（**同步 API**，无需 await） |
| 认证 | JWT HS256，7 天有效期，`Authorization: Bearer <token>` |
| 实时 | WebSocket（`ws` 库）主推送 + REST 轮询降级 |
| ID 生成 | nanoid |
| 密码 | bcrypt，10 rounds |
| 外部集成 | MyPal（Mock/真实 HTTP 二选一） |
| 可选 AI 能力 | DeepSeek（OpenAI 兼容 API） |

---

<a name="prerequisites"></a>
## 运行前准备

- Node.js `>= 18`（推荐 LTS 版本）
- npm（随 Node.js 安装）
- 可写本地磁盘（SQLite 会创建 `server/database.db`）

可选能力：
- MyPal 本地 Mock：`MYPAL_MOCK=1`
- MyPal 真实联调：`MYPAL_ENABLED=1` + 一组 MyPal 凭证
- Agent AI 能力：`DEEPSEEK_API_KEY`

---

<a name="quick-start"></a>
## 快速启动

```bash
# 1. 从仓库根目录进入后端目录
cd server
npm install

# 2. 初始化数据库（10 店 / 100 员工；3 个预置任务 + 300 条分配 + MyPal Mock；详见 db/seed.js）
npm run seed

# 3. 配置环境变量（在仓库根目录）
# cp .env.example .env
#
# 4. 开启 MyPal Mock（开发联调用）
#    根目录 `.env` 里设置 `MYPAL_MOCK=1`
#    不开启时，`GET /api/v1/mypal/mock/learning` 将返回 404
#
# 5. 自动预警定时调度（可选，见根目录 .env.example）
#    AUTO_NUDGE_SCHEDULER=0 关闭；AUTO_NUDGE_INTERVAL_MS 调整间隔（毫秒），默认 1 小时
#
# 6. 启动服务（默认 PORT=3000）
npm start

# 开发模式（文件变更自动重启）
npm run dev
```

服务启动后：

| 端点 | 地址 |
|------|------|
| REST API | `http://localhost:3000/api/v1` |
| WebSocket | `ws://localhost:3000/ws?token=<JWT>` |

> **重置数据库：** 删除 `server/database.db`（及同名 `-shm`、`-wal` 文件）后重新执行 `npm run seed`（或 `node db/seed.js`）。  
> **重复执行 seed：** 会清空任务分配、通知、MyPal Mock 等并删除非脚本内的门店/员工/任务，再写入当前种子；详见仓库根目录 `README.md`「Seed 数据库」。

---

<a name="env"></a>
## 环境变量

后端会在 `server/app.js` 中从仓库根目录加载 `.env`：

```js
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
```

建议初始化：

```bash
cp .env.example .env
```

关键变量：

| 变量 | 必填 | 说明 |
|------|------|------|
| `PORT` | 否 | 服务端口，默认 `3000` |
| `JWT_SECRET` | 建议 | JWT 签名密钥；生产环境必须设置高强度随机值 |
| `MYPAL_MOCK` | 否 | `1` 启用 `GET /api/v1/mypal/mock/learning` |
| `MYPAL_ENABLED` | 否 | `1` 启用真实 MyPal HTTP 集成 |
| `MYPAL_API_BASE` | 真实联调时必填 | MyPal 基础地址 |
| `MYPAL_APP_ID` / `MYPAL_APP_SECRET` | 真实联调时必填 | MyPal 认证凭证 |
| `MYPAL_REQUEST_TIMEOUT_MS` | 否 | MyPal 请求超时，默认 `3000` |
| `AUTO_NUDGE_SCHEDULER` | 否 | `0` 关闭自动预警定时任务 |
| `AUTO_NUDGE_INTERVAL_MS` | 否 | 自动预警扫描间隔（毫秒），默认 `3600000` |
| `DEEPSEEK_API_KEY` | 否 | Agent 技能调用 DeepSeek 时需要 |

---

<a name="test-accounts"></a>
## 测试账号

| 用户名 | 密码 | 角色 | 说明 |
|--------|------|------|------|
| `central` | `Train2026!` | central | 总部，全量读写权限 |
| `executive` | `Train2026!` | executive | 只读看板（全国视角） |
| `executive_huadong` | `Train2026!` | executive | 只读看板，`executive_regions` 预置华东 |
| `admin` | `Admin2026!` | admin | 管理员 |
| `emp_E001` | `Train2026!` | employee | S001 店员（示例；共 E001–E100） |

Seed 生成所有店员登录：`emp_E001`～`emp_E100`（对应 `employees.id`），密码均为 `Train2026!`。亦可用邮箱登录：`e001@mypal.seed.local`～`e100@mypal.seed.local`（与 MyPal `seedId` 对齐）。推荐联调画像见 `npm run seed` 控制台末尾说明（如 `emp_E010`、`emp_E091`）。

---

<a name="project-structure"></a>
## 项目结构

```
TOT_backend/
├── server/                      # 后端（唯一交付物）
│   ├── app.js                   # 入口：Express + HTTP + WebSocket
│   ├── package.json
│   ├── database.db              # SQLite 数据库文件（.gitignore）
│   ├── db/
│   │   ├── schema.sql           # 建表脚本（8 张表）
│   │   ├── seed.js              # 测试数据生成
│   │   └── index.js             # db helper（同步封装）
│   ├── middleware/
│   │   ├── auth.js              # JWT 验证，注入 req.user
│   │   ├── errorHandler.js      # 统一错误响应
│   │   ├── permissions.js       # 任务可见性校验（requireTaskAccess）
│   │   └── requestId.js         # 请求链路追踪 ID
│   ├── routes/
│   │   ├── auth.js              # POST /login, GET /me
│   │   ├── tasks.js             # Tasks CRUD + dispatch
│   │   ├── assignments.js       # Assignments 全流程（读写 + 状态机）
│   │   ├── stores.js            # Stores CRUD
│   │   ├── employees.js         # Employees CRUD
│   │   ├── notifications.js     # 通知事件 + 已读回执
│   │   ├── nudge.js             # 催办
│   │   └── dashboard.js         # 看板聚合
│   ├── services/
│   │   └── assignmentBatch.js   # batch-create 服务（不含通知）
│   └── ws/
│       └── manager.js           # WebSocket 连接管理 + 广播
└── docs/
    ├── DEV-PLAN.md              # 开发计划与进度
    ├── specs/
    │   ├── 04-API-SPEC.md       # ★ 接口文档（前端主交付物，v1.3）
    │   ├── 01-DATA-MODEL.md     # 数据模型
    │   ├── 02-STATE-MACHINES.md # 状态机定义
    │   ├── 05-NOTIFICATION-NUDGE.md
    │   ├── 06-DASHBOARD-KPI.md
    │   └── ...
    └── internal/
        ├── CONTRACT.md          # Dev1→Dev2 内部契约（v1.2.0）
        └── FRONTEND-HANDOFF.md  # 前端对接交付说明
```

---

<a name="data-model"></a>
## 数据模型

共 8 张表，详见 `docs/specs/01-DATA-MODEL.md` 和 `server/db/schema.sql`。

```
stores              门店（region / rtm / format）
employees           员工（门店一线人员）
users               登录账号（与 employees 1:1 关联）
tasks               培训任务（draft → dispatched）
task_assignments    任务分配记录（pending → in_progress → completed）
notification_events 通知事件（task_assigned / nudge_yellow / nudge_red / task_updated）
read_receipts       已读回执
nudge_records       催办记录（审计用）
```

---

<a name="roles"></a>
## 角色权限

| 角色 | 说明 | 数据可见范围 |
|------|------|-------------|
| `central` | 总部运营 | 全量 |
| `admin` | 系统管理员 | 全量（等同 central + 维护权限）|
| `executive` | 高管 | 只读看板 |
| `employee` | 门店员工 | 本人 assignment |

---

<a name="api-overview"></a>
## API 概览

基础路径：`/api/v1`，完整文档见 `docs/specs/04-API-SPEC.md`。

### 认证
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/auth/login` | 登录，返回 JWT |
| GET | `/auth/me` | 当前登录用户信息 |

### 任务
| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/tasks` | 全角色 | 按角色过滤的任务列表 |
| POST | `/tasks` | central | 创建草稿任务 |
| GET | `/tasks/:id` | 全角色 | 任务详情 |
| PATCH | `/tasks/:id` | central | 更新任务（dispatched 后仅可改 ddlAt）|
| POST | `/tasks/:id/dispatch` | central/admin | RTM 筛选 + 批量下发 |
| POST | `/tasks/:id/auto-nudge` | central/admin | 手动执行自动预警评估 |

### Assignments
| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/assignments` | 全角色 | 分页列表（§3.1）|
| GET | `/assignments/:id` | 全角色 | 详情（§3.2）|
| POST | `/assignments/batch-create` | central/admin | 批量创建（§3.4，不含通知）|
| PUT | `/assignments/:id/status` | 员工 | 状态机：start_task / complete_platform |
| POST | `/assignments/:id/viewed` | 员工 | 记录首次打开（已读）|
| DELETE | `/assignments/:id` | central/admin | 删除（仅 pending）|

### 通知
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/events` | 通知列表（分页 + 过滤）|
| GET | `/events/unread-count` | 未读事件数（角标等）|

### 催办
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/nudges` | 发起催办（写 nudge_records + notification_events）|
| GET | `/nudges` | 催办审计列表 |

### 看板
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/dashboard/overview` | 总部概览 KPI |
| GET | `/dashboard/heatmap` | RTM/区域/业态热力图 |
| GET | `/dashboard/store-rank` | Top/Bottom N 门店排行 |
| GET | `/dashboard/warnings` | 预警列表（完成率 < 80% 门店）|
| GET | `/dashboard/store-detail` | 门店下钻（员工进度明细）|

### MyPal（开发环境 Mock）
- `GET /api/v1/mypal/mock/learning`（P1）
- 仅当根目录 `.env` 配置 `MYPAL_MOCK=1` 时生效；否则会返回 `404`
- 请求参数（Query）：`taskWeek`（优先）或 `queryDate`；可选 `storeId` / `employeeId`
- 返回字段（camelCase）：`seedId`, `productName`, `firstUseTime`, `taskWeek`, `progress`, `passedWeek`, `passedTime`, `required`, `weekStartTime`

### MyPal（真实接口）
- `POST /api/v1/mypal/sync`
- 权限：`central` / `admin`
- 启用条件：`MYPAL_ENABLED=1` 且 MyPal 凭证配置完整
- 请求体：`mode`（`batch` 或 `weekly`）、可选 `taskId`、`queryDate`

---

<a name="websocket"></a>
## WebSocket 事件

连接方式：`ws://localhost:3000/ws?token=<JWT>`（仅 `employee` 角色支持；JWT 内需带 `employeeId`）

| 事件名 | 触发时机 | 接收方 |
|--------|----------|--------|
| `task_assigned` | 任务下发 | 所有 target 用户 |
| `task_updated` | 已下发任务修改 ddlAt | 所有有 assignment 的用户 |
| `nudge_sent` | 催办发起 | 被催办员工 |
| `assignment_completed` | assignment 自动完成 | 本人 + 本店所有员工 |

> central / executive / admin 无 WebSocket 连接，需轮询 REST API。

---

<a name="state-machine"></a>
## 状态机

### 任务状态

```
draft ──(dispatch)──► dispatched
```

### Assignment 状态

```
pending ──(start_task)──► in_progress ──(all platforms done)──► completed
```

平台完成标记（`complete_platform`）：
- 只能在 `in_progress` 状态下操作
- 每个平台标记不可撤销
- 所有已配置平台均完成时，自动切换为 `completed`，并广播 WebSocket

---

<a name="dev-guide"></a>
## 开发规范

### DB 操作（重要）

`better-sqlite3` 是**同步**库，所有 `db.*` 调用直接返回值，**不是 Promise**：

```js
// ✅ 正确
const task = db.get('SELECT * FROM tasks WHERE id = ?', [id]);

// ❌ 错误
const task = await db.get('SELECT * FROM tasks WHERE id = ?', [id]);
```

### 统一响应格式

```json
// 成功
{ "code": 200, "message": "success", "data": {}, "requestId": "req-20260329120000-123456" }

// 失败
{ "code": 403, "message": "权限不足", "data": null, "requestId": "...", "errorCode": "AUTH_003" }
```

### 错误码前缀

| 前缀 | 模块 |
|------|------|
| `AUTH_` | 认证/权限 |
| `TASK_` | 任务 |
| `ASSIGN_` | Assignment |
| `NUDGE_` | 催办 |
| `RTM_` | RTM 筛选 |
| `DASH_` | 看板 |
| `EVENT_` | 通知事件 |

---

<a name="docs"></a>
## 文档索引

| 文档 | 说明 |
|------|------|
| `docs/specs/04-API-SPEC.md` | **前端接口文档**（v1.3，完整版）|
| `docs/specs/01-DATA-MODEL.md` | 数据模型与字段说明 |
| `docs/specs/02-STATE-MACHINES.md` | 状态机定义 |
| `docs/specs/06-DASHBOARD-KPI.md` | 看板 KPI 指标定义 |
| `docs/DEV-PLAN.md` | 开发计划与每日进度 |
| `docs/internal/CONTRACT.md` | Dev1→Dev2 内部契约 |
| `docs/internal/FRONTEND-HANDOFF.md` | 前端对接交付说明 |
