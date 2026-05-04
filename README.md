# TOT-Apple Executive Chat

> Apple Retail 大中华区培训任务智能查数 Agent — 自然语言一句话完成管理层数据查询。

**v7.0** | 3 Agent × 11 Tool × 19 Metrics × 5 Dimensions | DeepSeek-Chat + LangGraph.js + Vue 3

---

## 项目简介

TOT (Training On Track) 是一个基于多 Agent 协作的 AI 数据查询助手。VP/Regional Director 通过自然语言提问（如「哪些门店需要关注」「Mono 渠道的完成率怎么样」），系统自动完成意图分类、实体消歧、11 个工具编排、数据查询，最终输出 headline + narrative 二层结构回答 + ECharts 图表。

**核心能力**：3 Agent (Router/FC Agent/FinalResponseAgent) × 11 Tool × 19 指标 × 5 维度。

**核心约束**：以任务为基本查询单位 · 严格只读 · 歧义不猜（HITL 弹窗 / 代码反问）

---

## 快速启动

```bash
# 1. 配置 DeepSeek API Key
echo "DEEPSEEK_API_KEY=sk-xxx" > TOT_backend/.env

# 2. 初始化种子数据 (10 门店 / 100 员工 / 6 任务 / 600 分配)
cd TOT_backend/server && node db/seed.js

# 3. 启动后端 (port 3000)
npm start

# 4. 启动前端 (port 8001)
cd TOT_frontend && pnpm dev
```

## 测试账号

| 角色 | 用户名 | 密码 | 前端路由 |
|------|--------|------|---------|
| Executive | `executive` | `Train2026!` | `/executive/login` → `/executive` |
| Central | `central` | `Train2026!` | `/hq` |
| Admin | `admin` | `Admin2026!` | — |
| 店员 | `emp_E001` ~ `emp_E100` | `Train2026!` | `/employee/login` |
| 华东辖区 | `executive_huadong` | `Train2026!` | `/executive/login` |

店员也可用邮箱登录：`e001@mypal.seed.local` ~ `e100@mypal.seed.local`

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Node.js v18+ / Express 4.x |
| AI | DeepSeek-Chat ×3 (Router t=0.1 / FC Tool Calling t=0.1 / FRA JSON t=0.3) |
| Agent 框架 | LangGraph.js (StateGraph + Checkpoint + Interrupt) |
| 数据库 | SQLite 3 + WAL 模式 (better-sqlite3) |
| 认证 | JWT · HS256 · 7 天有效 |
| 前端 | Vue 3 + Naive UI + Vite + ECharts |
| 通信 | SSE 流式 + REST API |
| 包管理 | 后端 npm · 前端 pnpm |

---

## Agent 架构

```
User Message
  │
  ▼
Router Agent ──→ deny/chat_only ──→ FinalResponseAgent (快速拒绝/问候)
  │
  └── data_query
        │
        ▼
      ToolRetrieve (modifier → 工具列表)
        │
        ▼
      FC Loop ──────────────────────────┐
        │                               │
        ├─ FC Agent (LLM 编排决策)       │
        ├─ CheckDuplicate (去重)         │
        ├─ ValidateParams (校验/HITL/拦截)│
        ├─ ExecuteTool → 11 Tools       │
        └─ MergeToolResults             │
        │                               │
        ◄───────────────────────────────┘
        │
        ▼
      FinalResponseAgent (headline + narrative + 图表)
        │
        ▼
      SSE → 前端渲染
```

### 三个 Agent

| Agent | 模型 | 职责 |
|-------|------|------|
| **Router** (`contextAnalyzerRouter`) | DeepSeek-Chat, t=0.1, 512 tokens | 3 主意图 + 8 布尔修饰标签，不提取实体 |
| **FC Agent** (`fc_LlmToolCallStep`) | DeepSeek-Chat Tool Calling, t=0.1, 2048 tokens | 根据 modifiers 自动编排 11 个工具 |
| **FinalResponseAgent** | DeepSeek-Chat JSON, t=0.3, 2000 tokens | headline(≤30字) + narrative 二层回复 |

### 8 个修饰标签

Router 输出 8 个布尔标签，每个精确激活一个工具。优先级：`comparison > timeseries > ranking > distribution > funnel > analytics > detail`，`lookup` 是基础设施（拿到数据后自动清除）。

| Modifier | 激活工具 | 用户问法 |
|----------|---------|---------|
| `needs_lookup` | searchEntities | "那个 Watch 任务" |
| `needs_ranking` | rank | "Top 5""最差 3 家""哪些门店需要关注" |
| `needs_comparison` | compare | "vs""Monobrand 和 Multibrand 对比" |
| `needs_distribution` | distribution | "分布""区间" |
| `needs_timeseries` | timeseries | "近 7 天""趋势""按周" |
| `needs_funnel` | funnel | "催办""漏斗""P 级转化" |
| `needs_analytics` | analyze | "P90""相关性""分位数" |
| `needs_detail` | listRecords | "有哪些任务""逾期员工""门店明细" |

无修饰标签时默认走 `queryMetrics`。步数预算：base(2) + comparison?(+1) + analytics?(+1) + buffer(1) = **3 / 4 / 5 步**。

### HITL 与歧义处理

| 触发条件 | 行为 | 示例 |
|---------|------|------|
| listTasks + ranking + 紧急信号 (关注/临期/紧急/催办/挽回) | 自动选任务 (pickUrgentTaskId) | "哪些门店需要关注" |
| listTasks + ranking + 无紧急 | HITL 弹窗选任务 | "完成率最高的渠道" |
| listTasks + detail 信号 | 全量返回 | "有哪些进行中的任务" |
| listTasks + 无信号 | HITL 弹窗 | 意图模糊 |
| 渠道维度 + 未指定 L3/L4 | 代码反问 | "完成率最高的渠道" |

---

## 11 个数据工具

| 工具 | 必填参数 | 用途 |
|------|---------|------|
| `searchEntities` | entityType | 名称→ID 消歧，支持 task/channel_l3/channel_l4/dealer/store |
| `queryMetrics` | task_id, metrics | 19 指标聚合查询，支持 5 维度 × 时间过滤 × 排序 |
| `rank` | task_id, metric, n | TopN(+)/BottomN(-) 排名 |
| `distribution` | task_id, metric, bins | 指标值区间分布统计 |
| `compare` | task_id, metrics, mode | 两组对比 (horizontal=不同维度, vertical=不同时段) |
| `timeseries` | task_id, metric, days | 时间趋势 (按天/周聚合) |
| `funnel` | task_id | 催办漏斗 (P2→P1→P0 转化) |
| `analyze` | task_id, analysis_type | 高阶统计 (P90/相关性/预测) |
| `listRecords` | task_id, entity_type | 员工/任务明细，支持门店/状态/预警筛选 |
| `listTasks` | 无 | 所有已下发任务及完成率 |
| `fetchData` | task_id | CSV 导出 + 可选 Python 沙箱分析 |

### 维度映射 (重要)

```
channel_l3 = s.rtm     (Monobrand, Multibrand, Carrier)  — RTM L3
channel_l4 = s.format  (MONO, Lifestyle, Mass Merchant)   — 业态 L4
dealer     = s.dealer_name
store      = s.id
```

> ⚠️ 地理大区 (华东/华南/华北) 是 `s.region`，不是 `channel_l3`。

### 19 个指标

**基础**: total_count, reach_count/rate, complete_count/rate, incomplete_count/rate, avg_duration_sec  
**预警**: p0/p1/p2_warning_count/rate  
**转化**: p0/p1/p2_conversion_count/rate

---

## 输出格式

回答采用 **headline + narrative** 二层结构，图表由 `decideChart` 代码根据 modifiers + 数据形状自动生成：

```markdown
headline: "iPad Pro P1 临期预警仅剩 1 天，重庆观音桥和哈尔滨中央大街完成率最低"

narrative:
iPad Pro P1 临期预警任务明天截止，整体完成率仅 **24.0%**...

**各门店完成率排名（倒数 5 名）：**
| 门店 | 完成率(%) | 已完成(人) | 总人次 | 截止时间 |
|------|:--------:|:--------:|:----:|---------|
| 重庆观音桥体验店 | **10.0%** | 5 | 50 | 2026-05-05 |
```

> narrative 无第三段——不在末尾加 "关键发现""小结""💡" 等。headline 本身就是结论。

---

## 仓库结构

```
TOT-Apple/
├── README.md
├── CLAUDE.md                    # 开发指南
├── PRD5.0.md                    # 完整产品需求 (12 章)
├── TOT_frontend/                # Vue 3 + Vite 前端
│   └── src/views/executive/     # Executive Chat 主页面 + 组件
└── TOT_backend/
    └── server/
        ├── agent/graph/          # LangGraph 状态机
        │   ├── nodes.js              # 3 Agent + 10 Node
        │   ├── decisionRules.js      # 业务规则集中管理
        │   ├── state.js              # 40+ 状态字段
        │   ├── graph.js              # 工作流骨架 + 路由
        │   └── routingPolicy.js      # 意图→工具映射 + 步数计算
        ├── prompts/              # Prompt Registry
        │   ├── registry.js / router.js / fc_agent.js / final_response.js
        ├── chat_tools/           # 11 个活跃工具 + 12 个已禁用旧工具
        ├── services/             # 业务服务 (chat, metrics, intent, memory)
        ├── db/                   # SQLite + seed 数据
        └── routes/               # Express API 路由
```

---

## 环境变量

后端配置文件：`TOT_backend/.env`（从 `TOT_backend/.env.example` 复制）。

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `JWT_SECRET` | 生产必填 | 代码内默认值 | JWT 签名密钥 |
| `PORT` | 否 | `3000` | 后端监听端口 |
| `DEEPSEEK_API_KEY` | AI 功能必填 | — | DeepSeek API Key |
| `AUTO_NUDGE_SCHEDULER` | 否 | `1` | 设为 `0` 禁用定时催办 |
| `AUTO_NUDGE_INTERVAL_MS` | 否 | `3600000` (1h) | 催办调度间隔 |
| `MYPAL_MOCK` | 否 | `0` | 设为 `1` 启用 MyPal Mock |
| `MYPAL_ENABLED` | 否 | `0` | 设为 `1` 启用真实 MyPal 对接 |

前端：`TOT_frontend/.env.development`

| 变量 | 说明 |
|------|------|
| `VITE_GLOB_API_URL` | 后端 API 地址，留空则走 Vite 代理到 `:3000` |
| `VITE_PORT` | Vite 开发端口，默认 `8001` |

---

## Prompt 调优

所有提示词集中在 `TOT_backend/server/prompts/`，每个文件独立版本号。调优流程：编辑对应文件 → bump version → 重启后端 → 测试。

| 文件 | Agent | 版本 |
|------|-------|------|
| `prompts/router.js` | Router | router/v7.0 |
| `prompts/fc_agent.js` | FC Agent (五段拼接) | fc_agent/v7.0 |
| `prompts/final_response.js` | FinalResponseAgent + MODIFIER_FORMATS + FewShot | final_response/v7.0 |

---

## 已知问题

- **前端 build/ 目录**：gitignored，需通过 `git checkout 87e9771 -- TOT_frontend/build/` 恢复
- **pnpm only**：前端必须用 pnpm，不能 npm / yarn
- **Resume 后禁 listTasks**：防止 FC Agent 浪费步数，但 DeepSeek 可能从对话历史中记住该工具强行调用 (由 `filterDisallowedToolCalls` 兜底)
- **searchEntities OR 匹配**：Latin-CJK 混合词 (如 "MacBook 培训") 由 `tokenizeMixedScript` 分词后用 OR 匹配

---

## 用户角色与入口

| 角色 | 说明 | 前端路由 | 典型账号 |
|------|------|---------|---------|
| `executive` | 高管，Executive Chat 自然语言查数 | `/executive/login` → `/executive` | executive / Train2026! |
| `central` | 总部运营，全量权限 | `/hq` | central / Train2026! |
| `employee` | 店员，仅本人数据 | `/employee/login` | emp_E002 / Train2026! |
| `admin` | 系统管理员 | — | admin / Admin2026! |

店员也可用邮箱登录：`e001@mypal.seed.local` ~ `e100@mypal.seed.local`。终端形态：总部 PC，店员 iPhone。

---

## 核心业务流程（TOT 平台全景）

```
总部（Central）
  → 配置任务（标题、平台、RTM 覆盖、截止时间、预警规则）
  → AI 润色描述文案（DeepSeek）
  → 下发任务 → 为范围内员工生成 TaskAssignment（status: pending）
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
总部看板 + Executive Chat
  → 完成率、按时完成率、RTM L4/L3、区域热力图、预警列表
  → Executive Chat: 自然语言一句话查所有数据
```

**Assignment 状态机**：`pending` → `in_progress` → `completed`（不可回退）  
**学习平台**：MyPAL · SmartSell · AI Coach · 直播（进度 = 已完成平台数 / 配置平台总数 × 100%）

---

## 数据库

### 表依赖

```
stores → employees → users → tasks → task_assignments
                                   → notification_events → read_receipts
                                   → nudge_records
                                   → chat_messages / chat_sessions (Executive Chat)
```

### 核心表

| 表 | 说明 |
|----|------|
| `stores` | 10 家门店，含 RTM/区域/城市 |
| `employees` | 100 名员工，归属门店 |
| `users` | 登录账号，关联 employees |
| `tasks` | 6 个培训任务（TASK_A/B/C + TASK_WARN_START/P0/P1），含平台列表/RTM/DDL/预警规则 |
| `task_assignments` | 600 条分配记录（100人 × 6任务），状态机执行单元 |
| `notification_events` | 预警通知事件，支持已读回执 |
| `nudge_records` | 催办审计记录 |
| `chat_messages` | Executive Chat 对话历史 (含 chart_payload) |
| `chat_sessions` | Executive Chat 会话 |

### Seed 写入内容

执行 `cd TOT_backend/server && npm run seed` 写入：

- `stores`：10 家门店（华东/华南/华北/华西/东北，含 Monobrand/Multibrand/Carrier 等 RTM）
- `employees`：100 名（每店 10 人，`email` 为 `e001@mypal.seed.local`～`e100@mypal.seed.local`）
- `tasks`：6 条（TASK_A iPhone 17 / TASK_B AirPods / TASK_C Mono / TASK_WARN_START MacBook / TASK_WARN_P0 Apple Watch / TASK_WARN_P1 iPad Pro）
- `task_assignments`：600 条（100人 × 6任务，差异化完成状态）
- `notification_events`：对应分配的 `task_assigned` 初始事件
- `mypal_learning_mock`：联调学习进度 Mock
- `users`：central / executive / executive_huadong / admin / emp_E001～emp_E100

> ⚠️ 重复执行 `npm run seed` 会**先清空再对齐**——自建任务、分配、通知会被清掉。

### 整库重置

```bash
cd TOT_backend/server
rm -f database.db database.db-shm database.db-wal
npm run seed     # 创建新库 + schema + 种子
npm start
```

### 日常浏览

```bash
sqlite3 TOT_backend/server/database.db   # CLI
# 或用 DB Browser for SQLite (GUI)
```

---

## API 概览

**基础路径**：`/api/v1` · **认证**：`Authorization: Bearer <JWT>` · **响应**：`{code, message, data, requestId}`

### 主要路由

| 模块 | 路径 | 说明 |
|------|------|------|
| 认证 | `POST /auth/login` | 登录，返回 JWT (7天) |
| 认证 | `GET /auth/me` | 当前用户信息 |
| 任务 | `POST /tasks` | 创建任务 |
| 任务 | `GET /tasks` | 任务列表 |
| 任务 | `POST /tasks/:id/dispatch` | 下发任务 |
| 任务 | `POST /tasks/ai-generate-description` | AI 润色描述 |
| Assignment | `GET /assignments` | 分配记录 |
| Assignment | `PUT /assignments/:id/status` | 更新状态 |
| 通知 | `GET /events` | 通知列表 |
| 通知 | `GET /events/unread-count` | 未读数 |
| 通知 | `POST /events/:id/read` | 标记已读 |
| 催办 | `POST /nudges` | 发起催办 |
| 看板 | `GET /dashboard/overview` | 大盘 KPI |
| 看板 | `GET /dashboard/heatmap` | 区域热力图 |
| 看板 | `GET /dashboard/store-rank` | 门店排行 |
| 看板 | `GET /dashboard/warnings` | 预警列表 |
| Chat | `POST /chat/executive/sessions` | 创建会话 |
| Chat | `POST /chat/executive/sessions/:id/messages/stream` | SSE 流式对话 |
| Chat | `POST /chat/executive/sessions/:id/resume` | HITL 恢复 |
| Chat | `GET /chat/executive/sessions/:id/history` | 历史记录 |
| 基础 | `GET /stores` | 门店列表 |
| 基础 | `GET /employees/:id` | 员工详情 |
| 健康 | `GET /api/health` | 服务心跳 |

### curl 快速测试

```bash
# 登录
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"executive","password":"Train2026!"}' \
  | grep -o '"token":"[^"]*' | cut -d'"' -f4)

# 创建会话
SESSION=$(curl -s -X POST http://localhost:3000/api/v1/chat/executive/sessions \
  -H "Authorization: Bearer $TOKEN" | grep -o '"sessionId":"[^"]*' | cut -d'"' -f4)

# SSE 流式提问
curl -N -X POST "http://localhost:3000/api/v1/chat/executive/sessions/$SESSION/messages/stream" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"message":"MacBook 完成率是多少"}'
```

---

## WebSocket 实时推送

**连接**：`ws://localhost:3000/ws?token=<JWT>`

事件类型：`task_assigned` / `assignment_updated` / `nudge_sent` / `task_updated` / `task_deleted`  
角色裁剪：按 `user.role` / `storeId` / `employeeId` 过滤。`central`/`admin` 无 `employeeId`，不建立 WS 连接。

---

## MyPal 集成（当前 Mock）

```bash
# TOT_backend/.env
MYPAL_MOCK=1        # 启用 Mock
# MYPAL_ENABLED=1   # 真实对接就绪后再开
```

Mock 接口：`GET /api/v1/mypal/mock/learning`（需登录），数据来源：`mypal_learning_mock` 表。

---

## 系统架构

### 数据库表依赖

```
stores → employees → users → tasks → task_assignments
                                   → notification_events → read_receipts
                                   → nudge_records
                                   → chat_messages / chat_sessions (Executive Chat)
```

### 角色权限矩阵

| 接口类型 | central | employee | admin | executive |
|---------|---------|----------|-------|-----------|
| 创建/下发任务 | ✓ | ✗ | ✓ | ✗ |
| 查看所有任务 | ✓ | ✗ | ✓ | ✗ |
| 更新 Assignment | ✓ | ✓ 本人 | ✓ | ✗ |
| 查看通知/标记已读 | ✗ | ✓ 本人 | ✓ | ✗ |
| 发起催办 | ✓ | ✗ | ✓ | ✗ |
| 看板数据 | ✓ 全量 | ✗ | ✓ | ✓ (executive 仅辖区) |
| Executive Chat | ✗ | ✗ | ✗ | ✓ |

---

## 文档导航

| 文档 | 说明 |
|------|------|
| [CLAUDE.md](CLAUDE.md) | 开发指南 (目录结构/架构/HITL/State/已知问题) |
| [PRD5.0.md](PRD5.0.md) | 完整产品需求 (12 章) — **不上传 GitHub** |
| [DESIGN.md](DESIGN.md) | Apple 设计语言参考 |
| `TOT_backend/docs/README.md` | 后端文档索引 |
| `TOT_backend/docs/specs/01-DATA-MODEL.md` | 数据库全量表结构 |
| `TOT_backend/docs/specs/04-API-SPEC.md` | REST API + WebSocket 完整规格 |
| `TOT_backend/docs/backend/03-DATABASE.md` | 数据库现状与迁移 |
| `TOT_backend/docs/backend/04-WEBSOCKET.md` | WebSocket 事件规格 |
| `TOT_backend/docs/backend/06-MYPAL-INTEGRATION.md` | MyPal HTTP 签名与同步 |
| `TOT_backend/docs/team-onboarding.md` | 新成员 Tailscale 接入指南 |

---

## 联调进度

### 已完成

| 模块 | 状态 | 说明 |
|------|------|------|
| 核心架构 | ✅ | SQLite + JWT + 全局路由 |
| AI Agent 系统 | ✅ | **Executive Chat v7.0** — 3 Agent + 11 Tool + HITL + 澄清往返 |
| AI 文案生成 | ✅ | 任务描述 DeepSeek 润色 |
| 任务创建与下发 | ✅ | 表单 → 存储 → RTM 筛选 → 生成 Assignments |
| 预警规则引擎 | ✅ | 进度掉队 / 起步异常 / 24h+48h 临期危机 |
| 店员端首页 + 预警 | ✅ | Banner / 倒计时 / 预警瀑布流 |
| 总部看板 | ✅ | KPI / 热力图 / 门店排行 / 预警列表 / AI 洞察 |

---

## 部署与运维

### PM2

```bash
pm2 status tot-api                   # 进程状态
pm2 reload ecosystem.config.js       # 热重载
pm2 restart tot-api                  # 硬重启
pm2 logs tot-api                     # 实时日志
```

### 一键部署

```bash
bash scripts/deploy.sh               # 拉代码 + 装依赖 + PM2 重载
bash scripts/deploy.sh <分支名>      # 指定分支
```

### 管理员基线检查

```bash
tailscale status                     # Tailscale 在线
tailscale ip -4                      # 确认 IP
pm2 status tot-api                   # 确认 online
curl http://100.65.95.128:3000/api/health
```

---

## 故障排查

| 问题 | 解决 |
|------|------|
| 端口占用 | `lsof -i :3000` → `kill -9 <PID>` |
| 数据库异常 | `rm -f database.db* && npm run seed` |
| JWT 过期 | 重新登录，7 天有效 |
| 数据库权限 | `chmod 644 database.db` |
| MyPal Mock 无数据 | 确认 `.env` 中 `MYPAL_MOCK=1` + 已执行 seed |
| Vite 代理未生效 | 检查 `.env.development` 中 `VITE_GLOB_API_URL` 留空 |
| 前端报错 `chrome-error://` | 确认 Vite 已监听 8001，在外部浏览器新标签打开 |
