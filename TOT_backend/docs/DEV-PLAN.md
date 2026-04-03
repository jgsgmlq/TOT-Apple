# 后端并发开发计划

**版本:** 1.2.0 | **日期:** 2026-03-28 | **适用范围:** MVP P0（任务管理闭环）

---

## 概览

两名后端开发借助 AI 工具，在 **1 周**内完成 MVP P0 后端。采用**按层切分**策略：Dev1 负责基础层（DB + CRUD），Dev2 负责业务逻辑层（状态机 + 聚合 + 实时）。通过**内部契约文档**解耦两人依赖，Dev2 从 Day 2 起并行启动，不等 Dev1 代码完成。

### 执行状态快照（2026-03-28）

| Day | Dev1 | Dev2 | 备注 |
|-----|------|------|------|
| Day 1 | ✅ 已完成 | ✅ 规格侧已解锁 | Dev1 已交付 `docs/internal/CONTRACT.md`，Auth + Tasks 基础端点已写入 `04-API-SPEC.md` |
| Day 2 | ✅ 已完成 | ✅ 已完成（核心项） | Dev2 已完成权限可见性中间件 + dispatch（RTM 筛选 + 批量写 assignments + notification_events）；`05` / `06` specs 已完成 Day2 同步 |
| Day 3 | ✅ 已完成（Dev1范围） | ✅ 已完成（核心项） | Dev2 已完成 Assignment 状态机（start / complete platform / progress / auto-complete），并同步 `04-API-SPEC` §3.3 |
| Day 4 | ✅ 已完成（联调支持）| ✅ 已完成（核心项） | Dev2 已完成通知系统 + WebSocket + 催办；`04-API-SPEC` §15 WebSocket 事件已补充 |
| Day 5 | — | ✅ 已完成（核心项） | Dev2 已完成看板聚合（overview / heatmap / store-rank / warnings / store-detail）；`task_updated` 通知缺口已修复 |
| Day 6 | ✅ 已完成 | ✅ 已完成（本批） | **Dev1**：`GET /assignments` 分页与 §3.1/§3.2/§3.4 对齐、`POST /assignments/batch-create`、`server/services/assignmentBatch.js`、`test-day6-dev1.sh`、`test-day4.sh` 支持 `PORT`、`CONTRACT.md` v1.2。**Dev2/规格**：`04-API-SPEC` 补充 §5.6、Assignments 错误码与实现说明；`06-DASHBOARD-KPI.md` v1.2.1 与 §5.1–§5.6 交叉引用 |

### Day 6 收尾说明（2026-03-28）

| 项 | 状态 |
|----|------|
| P0 后端与 `04-API-SPEC` 对齐（含 §3.x Assignment、§5 看板含 §5.6、§15 WS） | ✅ |
| `docs/internal/CONTRACT.md` 与列表/详情/batch-create 契约 | ✅ |
| 集成冒烟：`test-day6-dev1.sh`；Day4 回归：`test-day4.sh`（`PORT` 与监听端口一致） | ✅ |
| Day 7 缓冲 / 前端对接 | ⏳ 待前端仓库或联调排期 |

### Day 4 完成进度复核（2026-03-27）

| 维度 | 结论 | 证据 |
|------|------|------|
| Dev2：通知事件 API | ✅ 100% | `GET/POST /events`、`POST /events/:id/read`、`GET /events/unread-count` 已落地；含 isActive/resolvedAt/readStatus 计算 |
| Dev2：任务详情已读 | ✅ 100% | `POST /assignments/:id/viewed` 已落地；原子写入 `received_at` + `read_receipts`（source=task_detail_open） |
| Dev2：催办 API | ✅ 100% | `POST /nudges` 事务内原子写 nudge_records + notification_events + nudge_count；`GET /nudges` 审计列表 |
| Dev2：WebSocket | ✅ 100% | `ws/manager.js` 实现连接管理；task_assigned / nudge_sent / assignment_completed 三路广播 |
| Day 4 文档要求：补充 WebSocket 事件 | ✅ 100% | `04-API-SPEC.md` §15 已补充完整（连接方式 + 3 类事件 + 断线重连策略） |

**Day 4 整体完成度：100%（4/4 开发项 + 1/1 文档项）**

### Day 3 完成进度复核（2026-03-27）

| 维度 | 结论 | 证据 |
|------|------|------|
| Day 3 Dev1：CRUD 收尾 + Auth 联调 | ✅ 100% | `GET /api/v1/auth/me` 已落地；`CONTRACT.md` 已标注 Day3 滚动更新 |
| Day 3 Dev2：状态机 + 平台完成 + 进度计算 | ✅ 100% | `PUT /api/v1/assignments/:id/status` 已落地；覆盖 `start_task` / `complete_platform`、进度重算、auto-complete、冲突错误码 |
| Day 3 文档要求：补充状态机端点 | ✅ 100% | `04-API-SPEC.md` 已补充状态机端点总览与 §3.3 细化（含错误码与平台映射） |

**Day 3 整体完成度：100%（2/2 开发项 + 1/1 文档项）**

**不在本计划范围：**
- Executive Chat（P1）— 留文档，不排期
- 前端实现
- 报表导出、多语言、跨域访问

---

## 确认基础

| 文档 | 状态 | 说明 |
|------|------|------|
| `docs/product/PRODUCT_REQUIREMENTS.md` | ✅ 核心功能已确认 | PRD v3.2.9，细节仍可能微调 |
| `docs/specs/01-DATA-MODEL.md` | ✅ 完全确认 | v2.4.1，唯一可信结构基础 |
| `docs/specs/02-STATE-MACHINES.md` | ✅ 已同步更新 | 与数据模型对齐 |
| `docs/specs/03-PLATFORM-COMPLETION.md` | ✅ 已同步更新 | 与数据模型对齐 |
| `docs/specs/04-API-SPEC.md` | ✅ P0 已与实现对齐（截至 Day6） | 含 §3 Assignment、§5 看板（§5.6 门店下钻）、§15 WebSocket；详见文内「实现说明」 |
| `docs/specs/05–08`（除 04） | ✅ 与 P0 实现同步 | `06-DASHBOARD-KPI.md` 已引用 §5.6；其余随变更滚动 |
| 前端设计 | ⚠️ 未确认 | 不阻塞后端，API 文档滚动输出供前端参考 |

---

## 角色职责

### Dev1 — 基础层

| 模块 | 具体内容 |
|------|---------|
| DB 初始化 | 建表脚本（`01-DATA-MODEL.md`）+ seed 数据（50 店 / 300 员工 / 测试账号）|
| Auth | JWT 签发/验证中间件；`POST /api/auth/login` |
| Tasks CRUD | 创建、列表、详情、字段更新（不含 dispatch 状态机）|
| Stores / Employees | 只读接口（seed 数据来源）|
| Assignments CRUD | 列表分页/筛选（§3.1）、详情（§3.2）、`POST /batch-create`（§3.4）；不含状态机写路径 |
| 错误中间件 | 统一错误响应格式 |
| **契约文档** | Day 1 EOD 输出 `docs/internal/CONTRACT.md` |
| **API 文档（基础段）** | Day 1 输出 Auth + Tasks 基础端点到 `04-API-SPEC.md` |

### Dev2 — 业务逻辑层

| 模块 | 具体内容 |
|------|---------|
| 权限中间件 | 数据可见性 scoping：central 全量 / 店长本店 / 店员本人 |
| dispatch | RTM 筛选 + 批量生成 Assignments + notification_events |
| Assignment 状态机 | start（pending→in_progress）、平台完成标记、进度计算、auto-complete |
| 通知 + WebSocket | notification_events 写入、铃铛未读数、已读回执、WebSocket 广播 |
| 催办 | nudge API + nudge_records 写入 |
| 看板聚合 | KPI 总览、热力图、门店排行、预警列表、**门店下钻 store-detail** |
| **API 文档（业务段）** | 每完成一个模块追加至 `04-API-SPEC.md` |
| **API 文档最终整理** | Day 6 已滚动：§3.x/§5/§15 与实现对齐；示例与错误码见 `04-API-SPEC` |

---

## 每日节奏

```
Day 1
  Dev1 : DB 脚本 + Auth + Tasks CRUD 脚手架
  两人  : AI 辅助重写 07-RTM-FILTER.md + 08-PERMISSION-MODEL.md
  两人  : 创建 04-API-SPEC.md，填入 Auth + Tasks 基础端点
  Dev1  : EOD 交付 docs/internal/CONTRACT.md

Day 2
  Dev1 : Stores / Employees / Assignments CRUD
  Dev2 : 凭 CONTRACT.md 启动 — dispatch + RTM 筛选 + 权限中间件
  AI   : 辅助更新 05-NOTIFICATION-NUDGE.md + 06-DASHBOARD-KPI.md
  追加  : 04-API-SPEC.md 补充 Assignment 基础端点

Day 3
  Dev1 : CRUD 收尾 + Auth 联调
  Dev2 : Assignment 状态机 + 平台完成标记 + 进度计算
  追加  : 04-API-SPEC.md 补充状态机端点

Day 4
  Dev1 : 支持 Dev2 联调 + bugfix
  Dev2 : 通知系统 + WebSocket + 催办
  追加  : 04-API-SPEC.md 补充通知 / 催办 / WebSocket 事件

Day 5
  Dev2 : 看板聚合查询 + 预警列表
  追加  : 04-API-SPEC.md 补充看板端点

Day 6
  集成测试 + bugfix（`test-day6-dev1.sh` / `test-day4.sh` + `PORT`）
  Dev1 + Dev2 : 04-API-SPEC.md 滚动对齐（§3.1/§3.2/§3.4、§5.6、§15 等）；`06-DASHBOARD-KPI.md` 引用 §5.x
  Dev1 : `docs/internal/CONTRACT.md` 更新

Day 7
  缓冲 / Review / 前端交付
```

---

## Specs 更新计划

| Spec 文件 | 负责方 | 时机 | 目的 |
|-----------|--------|------|------|
| `07-RTM-FILTER.md` | AI（两人确认）| Day 1 | 解锁 Dev2 的 dispatch 逻辑 |
| `08-PERMISSION-MODEL.md` | AI（两人确认）| Day 1 | 解锁 Dev2 的权限中间件 |
| `05-NOTIFICATION-NUDGE.md` | AI（Dev2 确认）| Day 2 | 解锁通知 / 催办实现 |
| `06-DASHBOARD-KPI.md` | AI（Dev2 确认）| Day 2；**Day6 已加 §5.6 引用** | 看板指标 + 与 `04-API-SPEC` §5.x 对照 |
| `04-API-SPEC.md` | Dev1 + Dev2 滚动 | Day 1–6（**P0 段落 Day6 已对齐**） | 前端最终交付物 |
| `02-STATE-MACHINES.md` | ✅ 已更新 | — | 无需重写 |
| `03-PLATFORM-COMPLETION.md` | ✅ 已更新 | — | 无需重写 |
| `09-EXECUTIVE-CHAT.md` | 不动 | — | P1，不纳入本期 |

---

## 交接文档规范

### Dev1 → Dev2：`docs/internal/CONTRACT.md`

Dev1 在 **Day 1 EOD** 交付，内容包括：

```
1. req.user 结构
   { id: number, role: string, storeId: string|null, employeeId: string|null }

2. DB helper 签名
   db.get(sql, params) → Promise<row|null>
   db.all(sql, params) → Promise<row[]>
   db.run(sql, params) → Promise<{ lastID, changes }>

3. 基础返回结构
   - Task 对象字段列表（含类型）
   - Assignment 对象字段列表（含类型）

4. 统一错误响应格式
   { error: string, errorCode: string }
   HTTP 状态码约定

5. 已完成端点列表（供 Dev2 直接调用）
```

### Dev2 → 前端：`docs/specs/04-API-SPEC.md`

滚动输出，每个模块完成后追加，Day 6 最终整理。最终文档包含：

- 所有端点（方法 + 路径 + 权限）
- 完整请求 / 响应 JSON 示例
- 所有错误码及触发条件
- WebSocket 事件列表（事件名 + payload 结构）
- 角色权限说明（哪个角色能调哪个接口）

---

## 技术栈约定

| 层 | 技术 |
|----|------|
| 运行时 | Node.js + Express 4.x |
| 数据库 | SQLite 3，WAL 模式，`better-sqlite3` 或 `sqlite3` |
| 认证 | JWT，HS256，7 天有效，Header: `Authorization: Bearer <token>` |
| 实时 | WebSocket（主）+ REST 轮询（降级）|
| ID 生成 | nanoid（tasks / assignments / events 等）|
| 密码 | bcrypt，10 rounds |

---

## Decision Log

| 决策 | 选择 | 备选 | 原因 |
|------|------|------|------|
| P1 范围 | 不纳入 | 同步并行 | 1 周窗口不够；P1 独立排期 |
| 工作切分 | 按层（CRUD vs 业务逻辑）| 按域 / 按角色 | 最小化两人跨依赖，Dev1 可独立推进 |
| Dev2 启动时机 | Day 2，凭契约文档 | 等 Dev1 代码完成 | 节省 3 天，最大化并行 |
| API 文档输出 | 滚动输出 Day 1–6 | Day 6 一次性输出 | 前端更早拿到部分文档 |
| Specs 编写策略 | 按需即时，Day 1–2 | 全部提前写完 | 避免 Day 1–2 全力写文档损失开发时间 |
| Specs 内容来源 | PRD 核心功能 + 01-DATA-MODEL | 其他过时 specs | 唯一可信基础 |
| `GET /assignments` 响应形态 | `{ list, pagination }`（§3.1） | 顶层数组 | Day6 已与实现对齐，前端须读 `data.list` |
