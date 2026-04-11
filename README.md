# TOT / Apple 零售培训任务管理系统

> **MVP P0 — 前后端分离 · 局域网 H5 Web App**
>
> 产品需求口径：以 [`TOT_backend/docs/product/PRODUCT_REQUIREMENTS.md`](TOT_backend/docs/product/PRODUCT_REQUIREMENTS.md) 为准。
> 完整文档索引见 [`TOT_backend/docs/README.md`](TOT_backend/docs/README.md)。

**更新日期：** 2026-04-11

---

## 目录

- [项目简介](#项目简介)
- [技术栈](#技术栈)
- [用户角色与入口](#用户角色与入口)
- [仓库结构](#仓库结构)
- [快速启动](#快速启动)
  - [共享开发服务器（推荐）](#共享开发服务器推荐)
  - [演示模式（Build + Funnel）](#演示模式build--funnel)
  - [本地独立开发](#本地独立开发)
- [环境变量](#环境变量)
- [Seed 数据库与本地 SQLite 操作](#seed-数据库与本地-sqlite-操作)
- [测试账号](#测试账号)
- [核心业务流程](#核心业务流程)
- [系统架构](#系统架构)
- [API 概览](#api-概览)
- [WebSocket 实时推送](#websocket-实时推送)
- [MyPal 集成（当前为 Mock）](#mypal-集成当前为-mock)
- [联调进度](#联调进度)
- [部署与运维](#部署与运维)
- [故障排查](#故障排查)
- [文档导航](#文档导航)

---

## 项目简介

**TOT（Training On Track）** 是面向 Apple 零售体系的培训任务管理平台；产品愿景约 **50 家门店 × 300 名学习对象**（见 PRD）。**当前开发用 seed** 为 **10 店 × 100 人**，并预置 **3 个任务**与对应分配，用于看板梯度、预警与 MyPal Mock 联调（详见下文「Seed 数据库」）。

**P0 双主线：**
1. **任务管理闭环** — 总部下发培训任务 → 学习对象（店员）执行 → 规则引擎自动预警提醒
2. **总部数据看板** — 完成率、按时完成率、RTM L4、区域热力图、预警列表等核心指标

**P1（设计框架，本期不要求全部实现）：** Executive Chat 自然语言查询、AI 辅助润色/洞察、下发预览历史等。

---

## 技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| **后端** | Node.js v18+ · Express 4.x | REST API + WebSocket |
| **数据库** | SQLite 3 + WAL 模式（`better-sqlite3`） | 同步读写，禁止对 `db.*` 使用 `await` |
| **认证** | JWT · HS256 · 7 天有效 | `Authorization: Bearer <token>` |
| **实时** | WebSocket（主）+ REST 轮询（降级） | `ws://host:3000/ws?token=<JWT>` |
| **前端** | Vue 3 + Vite · Alova（HTTP）| 总部 / 店员 / Executive 多入口 |
| **包管理** | 后端 npm · 前端 pnpm | |
| **进程管理** | PM2 | 共享服务器上的守护进程 |
| **网络隧道** | Tailscale + Tailscale Funnel | 内网 P2P VPN + 按需公网 HTTPS |

---

## 用户角色与入口

| 角色 | 说明 | 前端路由 | 典型账号 |
|------|------|----------|---------|
| `central` | 总部运营，全量权限 | `/hq` | central / Train2026! |
| `employee` | 店员，仅本人数据 | `/employee/login` | emp_E002 / Train2026! |
| `executive` | 高管，Executive Chat（自然语言查数） | `/executive/login` → `/executive` | executive / Train2026! |
| `admin` | 系统管理员 | — | admin / Admin2026! |

> 店员 username 格式：`emp_{员工表 id}`（如 `emp_E001`～`emp_E100`，对应 `employees.id`）。也可用 **员工邮箱**登录（与 MyPal `seedId` 对齐），形如 `e001@mypal.seed.local`～`e100@mypal.seed.local`。联调推荐账号见「测试账号」与执行 `npm run seed` 末尾打印。

**本地开发完整网址（Vite 默认端口 8001）：**

| 入口 | URL |
|------|-----|
| 总部 | `http://localhost:8001/hq` |
| 店员 | `http://localhost:8001/employee/login` |
| Executive Chat | `http://localhost:8001/executive/login`（登录后进入 `http://localhost:8001/executive`） |

接口规格见 [`TOT_backend/docs/specs/09-EXECUTIVE-CHAT.md`](TOT_backend/docs/specs/09-EXECUTIVE-CHAT.md)。

**终端形态：** 总部使用 PC，店员使用手机（iPhone 为主）。

---

## 仓库结构

```
TOT-Apple/                         # 仓库根目录
├── README.md                      # 本文档（联调进度与快速启动）
├── scripts/
│   └── deploy.sh                  # 一键拉代码 + 重载 PM2
├── TOT_frontend/                  # Vue 3 + Vite 前端
│   ├── src/
│   │   ├── views/
│   │   │   ├── central/           # 总部端页面
│   │   │   └── employee/          # 店员端页面
│   │   └── ...
│   ├── .env.development           # Vite 开发环境配置（VITE_GLOB_API_URL、VITE_PORT=8001）
│   └── package.json
└── TOT_backend/
    ├── server/                    # Node 后端主体
    │   ├── app.js                 # Express 入口，路由挂载
    │   ├── routes/                # tasks · assignments · events · nudges · dashboard · mypal 等
    │   ├── services/              # 业务逻辑层（autoNudge · stateSync 等）
    │   ├── db/
    │   │   ├── schema.js          # 建表 SQL
    │   │   └── seed.js            # 种子数据（10 店 × 100 人 + 预置任务/分配/MyPal Mock）
    │   ├── ws/
    │   │   └── manager.js         # WebSocket 广播与角色裁剪
    │   ├── jobs/
    │   │   └── autoNudgeScheduler.js  # 定时催办（默认每小时）
    │   ├── agent/                 # AI Agent 框架（DeepSeek / Gemini 上游）
    │   ├── ecosystem.config.js    # PM2 配置
    │   ├── .env.example           # 环境变量模板
    │   └── package.json
    └── docs/                      # 全部产品 / 规格 / 后端文档（见文档导航）
```

---

## 快速启动

### 共享开发服务器（推荐）

团队共用一台 **Mac Studio**（Tailscale IP `100.65.95.128`），后端由 **PM2** 守护，平时无需手动启动后端。

**前提：** 已完成 Tailscale 接入（见 [`TOT_backend/docs/team-onboarding.md`](TOT_backend/docs/team-onboarding.md)）。

```bash
# 1. 确认后端正在运行（在 Mac Studio 上）
pm2 status tot-api           # 预期：online

# 2. 前端本地开发（在本机执行）
cd TOT_frontend
pnpm install
pnpm run dev                 # 默认端口 8001
```

访问：
- **总部**：`http://localhost:8001/hq`
- **店员**：`http://localhost:8001/employee/login`
- **Executive Chat**：`http://localhost:8001/executive/login`（登录后为 `http://localhost:8001/executive`）

> `TOT_frontend/.env.development` 中 `VITE_GLOB_API_URL` 默认留空（Vite 代理到本机 `:3000`）。  
> 若需直连共享后端，在 `.env.development.local`（**不要提交**）中覆盖：
> ```
> VITE_GLOB_API_URL=http://100.65.95.128:3000
> ```

---

### 演示模式（Build + Funnel）

适合 iPhone 演示或公网访问，比直接暴露 `pnpm run dev` 更稳定。

```bash
# Terminal A — Mac Studio
pm2 status tot-api                           # 确认后端 online
cd /Users/skylerwang/Desktop/MVP/TOT_frontend
pnpm install
pnpm run build
pnpm run preview:dist --host 0.0.0.0 --port 4173

# Terminal B — Mac Studio（开启公网隧道）
tailscale funnel reset
tailscale funnel 4173
tailscale funnel status                      # 输出 https://<machine>.<tailnet>.ts.net
```

将 Funnel 地址发给演示设备：
- 总部：`https://<...>/hq`
- 店员：`https://<...>/employee/login`
- Executive Chat：`https://<...>/executive/login`（登录后为 `https://<...>/executive`）

演示结束后关闭隧道：
```bash
tailscale funnel reset
```

---

### 本地独立开发

适合仅需本机调试，不依赖共享服务器。

#### 环境要求

| 工具 | 版本 | 验证 |
|------|------|------|
| Node.js | v18+ | `node --version` |
| npm | v9+ | `npm --version` |
| pnpm | 最新稳定版 | `pnpm --version` |

#### 启动后端

```bash
cd TOT_backend/server

# 安装依赖
npm install

# 生成种子数据（首次启动或重置数据后）
npm run seed

# 启动开发服务器（node --watch，修改自动重启）
npm run dev
```

**预期输出：**
```
[auth] WARNING: JWT_SECRET not set, using default dev secret. DO NOT use in production.
MVP LAN server running at http://0.0.0.0:3000
  Local:   http://localhost:3000
  LAN:     http://192.168.x.x:3000
  WS:      ws://localhost:3000/ws
```

**健康检查：**
```bash
curl http://localhost:3000/api/health
# {"ok":true,"service":"mvp-lan-api"}
```

#### 启动前端

```bash
cd TOT_frontend

# 安装依赖
pnpm install

# 将后端地址指向本机（首次或切换后端时）
# 编辑 .env.development，确保：
# VITE_GLOB_API_URL=   （留空，由 Vite 代理到 localhost:3000）
# 或临时创建 .env.development.local：
# VITE_GLOB_API_URL=http://localhost:3000

pnpm run dev                  # 端口 8001
```

浏览器访问：总部 `http://localhost:8001/hq`，店员 `http://localhost:8001/employee/login`，Executive Chat `http://localhost:8001/executive/login`。

---

## 环境变量

后端配置文件：`TOT_backend/.env`（从 `TOT_backend/.env.example` 复制）。

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `JWT_SECRET` | 生产必填 | `mvp-dev-secret-change-in-prod` | JWT 签名密钥，开发可忽略警告 |
| `PORT` | 否 | `3000` | 后端监听端口 |
| `MYPAL_MOCK` | 否 | `0` | 设为 `1` 启用 MyPal 本地 Mock（内部联调阶段必须） |
| `MYPAL_ENABLED` | 否 | `0` | 设为 `1` 启用真实 MyPal HTTP 对接（凭证就绪后再开） |
| `AUTO_NUDGE_SCHEDULER` | 否 | `1` | 设为 `0` 禁用定时催办调度器 |
| `AUTO_NUDGE_INTERVAL_MS` | 否 | `3600000`（1h） | 催办调度间隔（毫秒） |
| `DEEPSEEK_API_KEY` | AI 功能必填 | — | DeepSeek API Key，**禁止硬编码** |

**前端（`TOT_frontend/.env.development`）：**

| 变量 | 说明 |
|------|------|
| `VITE_GLOB_API_URL` | 后端 API 地址，留空则走 Vite 代理到 `:3000` |
| `VITE_PORT` | Vite 开发端口，默认 `8001` |

---

## Seed 数据库与本地 SQLite 操作

### 文件与职责

| 路径 | 说明 |
|------|------|
| `TOT_backend/server/database.db` | 运行时 SQLite 主库（及同目录 `database.db-wal` / `database.db-shm`，WAL 模式时可能出现） |
| `TOT_backend/server/db/schema.sql` | 建表与索引的权威 SQL |
| `TOT_backend/server/db/index.js` | 启动时加载库、执行 `schema.sql`，并做列/表迁移（与 `schema.sql` 增量对齐） |
| `TOT_backend/server/db/seed.js` | 开发用种子数据脚本（**不**随 `npm run dev` 自动执行） |

更细的表说明见 [`TOT_backend/docs/backend/03-DATABASE.md`](TOT_backend/docs/backend/03-DATABASE.md)、[`TOT_backend/docs/specs/01-DATA-MODEL.md`](TOT_backend/docs/specs/01-DATA-MODEL.md)。

### 如何执行 Seed（更新 / 补全种子数据）

在 **`TOT_backend/server`** 目录执行：

```bash
cd TOT_backend/server
npm run seed
```

等价于 `node db/seed.js`。首次拉仓库、删库重建后、或需要与脚本定义对齐（含 MyPal Mock、预置任务）时，都应执行一次。

**Seed 会写入的内容（摘要，与 `TOT_backend/server/db/seed.js` 一致）：**

- `stores`：**10** 家门店（华东/华南/华北/华西/东北，含 Monobrand / Multibrand / Carrier / Education 等 RTM 与档位 archetype）  
- `employees`：**100** 名（每店 10 人，`email` 为 `e001@mypal.seed.local`～`e100@mypal.seed.local`，与 MyPal Mock 对齐）  
- `tasks`：**3** 条预置任务（`TASK_A` 已过期、`TASK_B` 临近截止、`TASK_C` 刚下发；脚本内 `INSERT OR REPLACE`）  
- `task_assignments`：**300** 条（100 人 × 3 任务，含差异化完成状态与平台进度）  
- `notification_events`：与上述分配对应的 `task_assigned` 初始事件  
- `mypal_learning_mock`：联调学习进度 Mock（`INSERT OR REPLACE`）  
- `users`：`central`、`executive`、`executive_huadong`（华东辖区）、`admin`，以及 `emp_E001`～`emp_E100`（事务外 `INSERT OR IGNORE` + 更新 executive 辖区字段）

**重复执行 `npm run seed` 会先清空再对齐（重要）：** 按外键顺序删除 `read_receipts`、`notification_events`、`nudge_records`、`task_assignments`、聊天相关表、`mypal_learning_mock`；删除 **不在**本脚本 `TASKS` 列表中的 `tasks`；删除全部店员 `users` 与全部 `employees`；删除 **不在** `STORE_DEFS` 中的 `stores`；再重新写入上述种子。**你在库里自建的任务、分配、通知等会被清掉**（除非任务 id 恰为脚本保留的 `TASK_A`/`TASK_B`/`TASK_C` 且你愿意接受分配被重建）。若只想「空库从零开始」，仍可用下文**整库重置**。

### 整库重置（从零开始）

适用于库损坏、迁移异常，或需要清空含任务在内的所有业务数据：

```bash
cd TOT_backend/server

# 先停掉占用数据库的 Node 进程（例如正在跑的 npm run dev）

rm -f database.db database.db-shm database.db-wal

npm run seed    # 会创建新库文件、应用 schema + 写入种子数据

npm run dev     # 再启动 API
```

说明：加载 `db/index.js` 时会自动执行 `schema.sql` 与迁移；**种子数据必须单独执行 `npm run seed`**，不会随 `npm run dev` 自动灌入。

### 日常如何查看或改数据

- **只读浏览 / 简单 SQL：** 使用 [DB Browser for SQLite](https://sqlitebrowser.org/) 打开 `TOT_backend/server/database.db`，或系统自带的 `sqlite3`：  
  `sqlite3 TOT_backend/server/database.db` → `.tables` / `SELECT ...`  
- **在 Cursor / VS Code 内：** 安装 SQLite 相关扩展后打开 `database.db`。  
- **注意：** 后端正在运行时写入库文件可能触发锁；重要修改前建议先停止 `npm run dev`，改完再启动。

---

## 测试账号

| 账号 | 密码 | 角色 | 说明 |
|------|------|------|------|
| `central` | `Train2026!` | 总部运营 | 创建/下发任务，查看全网看板 |
| `executive` | `Train2026!` | Executive（P1）| 自然语言查询看板（全国视角） |
| `executive_huadong` | `Train2026!` | Executive（P1）| `executive_regions` 预置为华东，用于辖区演示 |
| `admin` | `Admin2026!` | 系统管理员 | 数据维护 |
| `emp_E001` | `Train2026!` | 店员（S001 上海环球港）| Seed 标注：优秀门店、画像 0（早鸟完成者） |
| `emp_E002` | `Train2026!` | 店员（S001）| 通用店员端 smoke 测试 |
| `emp_E010` | `Train2026!` | 店员（S001）| Seed 标注：优秀门店、画像 9（高风险待催办） |
| `emp_E091` | `Train2026!` | 店员（S010 哈尔滨）| Seed 标注：预警门店 |

其余店员：`emp_E003`～`emp_E100` 等未在表中逐行列出；**所有**店员邮箱为 `e001@mypal.seed.local`～`e100@mypal.seed.local`，密码均为 `Train2026!`。更完整的画像与门店档位说明以 **`npm run seed` 控制台末尾输出** 为准。

---

## 核心业务流程

```
总部（Central）
  → 配置任务（标题、平台、覆盖范围、截止时间、预警规则）
  → AI 润色描述文案（DeepSeek）
  → 一键下发（RTM 筛选）
        ↓
为范围内全部员工生成 TaskAssignment（status: pending）
        ↓
店员（Employee）
  → Banner / 消息中心触达
  → 开始学习（pending → in_progress）
  → 各平台完成打卡 → 全部完成（in_progress → completed）
        ↓
规则引擎（定时调度）
  → 按配置计算预警（进度掉队 / 起步异常 / 临期危机 24h/48h）
  → 写入 notification_events → WS 实时推送店员
        ↓
总部看板
  → 完成率、按时完成率、RTM L4、区域热力图、预警列表
```

**Assignment 状态机：** `pending` → `in_progress` → `completed`（完成不可回退）

**四大学习平台：** MyPAL · SmartSell · AI Coach · 直播（各平台完成进度独立打卡，进度 = 已完成平台数 / 配置平台总数 × 100%）

---

## 系统架构

### 数据库表依赖

```
stores → employees → users → tasks → task_assignments
                                   → notification_events → read_receipts
                                   → nudge_records
                                   → mypal_learning_mock（Mock 表）
```

### 核心表说明

| 表 | 说明 |
|----|------|
| `stores` | **Seed：10 家**；含 RTM（Monobrand / Multibrand / Carrier / Education 等）、区域、城市（PRD 目标规模见产品文档） |
| `employees` | **Seed：100 名**；归属门店，含 MyPal `seedId` 对齐的 `email` |
| `users` | 登录账号，与 employees 关联（`role`: central / employee / admin） |
| `tasks` | 培训任务，含平台列表、RTM 筛选规则、截止时间、预警规则（JSON） |
| `task_assignments` | 任务 × 员工的分配记录，状态机最小执行单元 |
| `notification_events` | 预警 / 提醒通知事件，支持已读回执 |
| `nudge_records` | 催办事实记录（完整审计） |

### 角色权限矩阵（摘要）

| 接口类型 | central | employee | admin |
|---------|:-------:|:--------:|:-----:|
| 创建 / 下发任务 | ✓ | ✗ | ✓ |
| 查看任务列表 | ✓ 全部 | ✓ 本人相关 | ✓ |
| 更新 Assignment 状态 | ✓ | ✓ 本人 | ✓ |
| 查看通知 / 标记已读 | ✗ | ✓ 本人 | ✓ |
| 发起催办 | ✓ | ✗ | ✓ |
| 看板数据 | ✓ 全量 | ✗ | ✓ |

完整权限矩阵见 [`docs/specs/08-PERMISSION-MODEL.md`](TOT_backend/docs/specs/08-PERMISSION-MODEL.md)。

---

## API 概览

**基础路径：** `/api/v1`  
**认证：** `Authorization: Bearer <JWT>`  
**响应格式：**
```json
{
  "code": 200,
  "message": "success",
  "data": {},
  "requestId": "req-20260409120000-123456"
}
```

### 主要路由

| 模块 | 路径 | 说明 |
|------|------|------|
| 认证 | `POST /auth/login` | 登录，返回 JWT（有效期 7 天）|
| 认证 | `GET /auth/me` | 获取当前用户信息 |
| 任务 | `POST /tasks` | 创建任务（central / admin）|
| 任务 | `GET /tasks` | 任务列表（employee 仅见本人相关）|
| 任务 | `POST /tasks/:id/dispatch` | 下发任务，生成 Assignments |
| 任务 | `GET /tasks/:id/summary` | 任务完成率汇总 |
| 任务 | `POST /tasks/ai-generate-description` | AI 润色任务描述（DeepSeek）|
| Assignment | `GET /assignments` | 分配记录列表 |
| Assignment | `PUT /assignments/:id/status` | 更新状态（start / complete_platform / complete_task）|
| 通知 | `GET /events` | 通知事件列表（employee 本人）|
| 通知 | `GET /events/unread-count` | 未读数 |
| 通知 | `POST /events/:id/read` | 标记已读 |
| 催办 | `POST /nudges` | 发起催办（central）|
| 看板 | `GET /dashboard/overview` | 大盘概览 KPI |
| 看板 | `GET /dashboard/heatmap` | 区域热力图 |
| 看板 | `GET /dashboard/store-rank` | 门店排行 Top/Bottom |
| 看板 | `GET /dashboard/warnings` | 预警列表 |
| 基础数据 | `GET /stores` | 门店列表 |
| 基础数据 | `GET /employees/:id` | 员工详情 |
| 健康检查 | `GET /api/health` | 服务心跳 |

完整接口文档见 [`docs/specs/04-API-SPEC.md`](TOT_backend/docs/specs/04-API-SPEC.md)（v1.4.9）。

### curl 快速测试

```bash
# 1. 登录获取 Token
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"central","password":"Train2026!"}' \
  | grep -o '"token":"[^"]*' | cut -d'"' -f4)

# 2. 创建任务
curl -X POST http://localhost:3000/api/v1/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "title": "Q1 新品培训",
    "description": "新品上市全员培训",
    "platforms": ["mypal", "smartsell", "ai_demo", "live_broadcast"],
    "storeScope": "all",
    "ddlAt": "2026-05-01T18:00:00Z"
  }' | jq '.'

# 3. 下发任务（替换 <task-id>）
curl -X POST http://localhost:3000/api/v1/tasks/<task-id>/dispatch \
  -H "Authorization: Bearer $TOKEN" | jq '.'
```

---

## WebSocket 实时推送

**连接地址：** `ws://localhost:3000/ws?token=<JWT>`

```javascript
// 浏览器端接入示例
const ws = new WebSocket(`ws://localhost:3000/ws?token=${yourJWT}`);

ws.onopen = () => console.log('WS 连接成功');

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  // msg.type: 'init' | 'task_assigned' | 'nudge_sent' | 'assignment_updated' | ...
  console.log('收到事件:', msg.type, msg.payload);
};
```

**角色裁剪：** 服务端按 `user.role` / `storeId` / `employeeId` 过滤，员工只收本人相关推送。

完整事件类型见 [`docs/backend/04-WEBSOCKET.md`](TOT_backend/docs/backend/04-WEBSOCKET.md)。

---

## MyPal 集成（当前为 Mock）

**当前阶段：内部联调，使用本地 Mock，不接真实 MyPal 接口。**

```bash
# TOT_backend/.env
MYPAL_MOCK=1        # 启用 Mock（内部联调必须）
# MYPAL_ENABLED=1   # 注释掉，真实对接就绪后再开
```

Mock 接口：`GET /api/v1/mypal/mock/learning`（需登录）  
Mock 数据来源：`mypal_learning_mock` 表（由 `npm run seed` 生成）

真实对接文档：[`docs/backend/06-MYPAL-INTEGRATION.md`](TOT_backend/docs/backend/06-MYPAL-INTEGRATION.md)

---

## 联调进度

### 已完成

| 模块 | 状态 | 说明 |
|------|------|------|
| 核心架构 | ✅ | better-sqlite3 同步读写，JWT 鉴权，全局路由拦截 |
| AI 文案生成 | ✅ | DeepSeek 模型接入，任务描述智能润色 |
| 任务创建与下发 | ✅ | 表单 → 后端存储 → RTM 筛选 → 生成 Assignments |
| 预警规则配置 | ✅ | 进度掉队 / 起步异常 / 24h+48h 临期危机双重预警 |
| 任务编辑与回显 | ✅ | 草稿保存、编辑状态精准回显 |
| 店员端首页 | ✅ | 用户信息、紧急待办 Banner、倒计时 |
| 任务详情弹窗 | ✅ | AI 润色描述、平台标签展示 |

### 待联调

| 模块 | 优先级 | 说明 |
|------|--------|------|
| WebSocket 实时预警 | P0 | 店员登录后建立 WS 连接，监听 `nudge_sent` / `task_assigned` 并渲染预警瀑布流 |
| 自动催办 Cron | P0 | 确认 `autoNudgeScheduler.js` 定时触发（每小时）并写入 `notification_events` |
| 平台完成回调 | P0 | 接入真实 `/assignments/:id/platforms/:platform/complete`（非 MyPal 平台） |
| 总部看板真实数据 | P0 | 看板图表对接 `/dashboard/*` 聚合接口，替换静态 Mock |
| MyPal 真实对接 | P1 | 凭证就绪后启用 `MYPAL_ENABLED=1` + `POST /mypal/sync` |
| Executive Chat | P1 | 自然语言查询看板（`/chat/*`，预留接口，本期不要求实现）|

---

## 部署与运维

### 日常部署（合并到 dev_joint 后）

在 **Mac Studio** 上执行：
```bash
# 拉代码 + 安装依赖 + PM2 重载（一键）
bash scripts/deploy.sh

# 指定分支
bash scripts/deploy.sh <分支名>
```

### PM2 常用命令

```bash
pm2 status tot-api                                          # 查看进程状态
pm2 reload ecosystem.config.js --env development            # 热重载（短暂不可用）
pm2 restart tot-api                                         # 硬重启
pm2 logs tot-api                                            # 实时日志
```

### 管理员基线检查

```bash
tailscale status           # 确认 Tailscale 在线
tailscale ip -4            # 确认 IP 与 README 一致（100.65.95.128）
pm2 status tot-api         # 确认后端 online
curl http://100.65.95.128:3000/api/health   # API 心跳验证
```

---

## 故障排查

### 端口占用

```bash
lsof -i :3000
kill -9 <PID>
# 或改端口
PORT=3001 npm run dev
```

### 数据库异常 / 重置数据

```bash
cd TOT_backend/server
# 先停止正在使用该库的进程
rm -f database.db database.db-shm database.db-wal
npm run seed       # 新建库、表结构 + 种子数据（详见上文「Seed 数据库与本地 SQLite 操作」）
npm run dev
```

### JWT Token 过期

```
{"error":"Unauthorized"}
```
重新登录获取新 Token，有效期 7 天。

### 数据库文件权限

```bash
ls -la server/database.db*
chmod 644 server/database.db
```

### MyPal Mock 未返回数据

确认 `.env` 中 `MYPAL_MOCK=1`，并已执行 `npm run seed` 生成 Mock 数据。

### WebSocket 连接失败

```javascript
// 浏览器控制台调试
const ws = new WebSocket('ws://localhost:3000/ws?token=<你的JWT>');
ws.onopen  = () => console.log('连接成功');
ws.onerror = (e) => console.error('连接失败', e);
```

注意：`central` / `admin` 账号无 `employeeId`，不会建立 WS 连接（服务端设计如此）。

### Vite 代理未生效

检查 `TOT_frontend/.env.development` 中 `VITE_GLOB_API_URL` 是否留空（代理模式）；若填了远端地址，API 请求会绕过代理直接发往远端。

---

## 文档导航

| 文档 | 说明 |
|------|------|
| [`TOT_backend/docs/README.md`](TOT_backend/docs/README.md) | 文档中心总索引（新人入口）|
| [`docs/product/PROJECT_OVERVIEW.md`](TOT_backend/docs/product/PROJECT_OVERVIEW.md) | 项目概览，业务背景 |
| [`docs/product/PRODUCT_REQUIREMENTS.md`](TOT_backend/docs/product/PRODUCT_REQUIREMENTS.md) | 产品需求全文（权威口径）|
| [`docs/specs/00-OVERVIEW.md`](TOT_backend/docs/specs/00-OVERVIEW.md) | Spec 总览，功能范围 |
| [`docs/specs/01-DATA-MODEL.md`](TOT_backend/docs/specs/01-DATA-MODEL.md) | 数据库全部表结构 |
| [`docs/backend/03-DATABASE.md`](TOT_backend/docs/backend/03-DATABASE.md) | 数据库现状、表说明与迁移入口 |
| [`docs/specs/04-API-SPEC.md`](TOT_backend/docs/specs/04-API-SPEC.md) | REST API + WebSocket 完整规格（v1.4.9）|
| [`docs/backend/index.md`](TOT_backend/docs/backend/index.md) | 后端文档入口 |
| [`docs/backend/01-ROUTES.md`](TOT_backend/docs/backend/01-ROUTES.md) | 路由现状 vs 目标 + Gap 清单 |
| [`docs/backend/04-WEBSOCKET.md`](TOT_backend/docs/backend/04-WEBSOCKET.md) | WebSocket 连接与事件规格 |
| [`docs/backend/06-MYPAL-INTEGRATION.md`](TOT_backend/docs/backend/06-MYPAL-INTEGRATION.md) | MyPal HTTP 签名与同步任务 |
| [`docs/tests/QUICK_START.md`](TOT_backend/docs/tests/QUICK_START.md) | 快速启动、账号、性能基准 |
| [`docs/team-onboarding.md`](TOT_backend/docs/team-onboarding.md) | 新成员 Tailscale 接入指南 |

---

**维护：** Backend & AI Team  
**主开发分支：** `dev_joint` | **当前分支：** `skyler`
