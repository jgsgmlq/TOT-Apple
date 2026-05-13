# TOT Backend 文档导航

> 给 AI 的入口文件。从这里出发，一次阅读即可定位所有相关文档。
> 更新：2026-05-13 | 分支：modular-base

---

## 1. 当前进行中的工作计划

| 文档 | 说明 | 优先级 |
|------|------|--------|
| [2026-05-12-modularization-plan.md](./2026-05-12-modularization-plan.md) | **模块化重构总方案** — 三层架构、模块划分、三人分工、GitHub 协作规范 | P0 |
| [2026-05-13-modularization-progress.md](./2026-05-13-modularization-progress.md) | **进度追踪** — 三人完成度、Phase 2 待办、app.js 切换清单 | P0 |
| [2026-05-11-agent-refactor-plan.md](./2026-05-11-agent-refactor-plan.md) | **Agent 改进计划** — Eval 体系、Router 修复、Prompt 补全（Excluded from 模块化） | P1 |

---

## 2. 编码规范

| 文档 | 路径 | 说明 |
|------|------|------|
| 编码规范 | `../CODING-STANDARDS.md` | 三层架构、crud 命名签名、API 响应格式、错误码、跨模块引用规则 |
| 项目 AI 指令 | `../../CLAUDE.md` | 全局约定（DB 同步操作、requireRole 用法、修改后更新 progress 文件） |

---

## 3. 产品/系统规格（参考）

| 文档 | 路径 | 说明 |
|------|------|------|
| 规格总览 | `../specs/00-OVERVIEW.md` | 系统概览 |
| 数据模型 | `../specs/01-DATA-MODEL.md` | 旧表结构（重构中替换） |
| 状态机 | `../specs/02-STATE-MACHINES.md` | 任务/分配状态流转 |
| 平台完成度 | `../specs/03-PLATFORM-COMPLETION.md` | 多平台完成判定 |
| API 规范 | `../specs/04-API-SPEC.md` | 接口定义 |
| 通知/催办 | `../specs/05-NOTIFICATION-NUDGE.md` | 催办逻辑 |
| 看板 KPI | `../specs/06-DASHBOARD-KPI.md` | 指标口径 |
| RTM 筛选 | `../specs/07-RTM-FILTER.md` | 门店层级筛选 |
| 权限模型 | `../specs/08-PERMISSION-MODEL.md` | 角色权限 |
| Executive Chat | `../specs/09-EXECUTIVE-CHAT.md` | EChat 需求 |
| EChat Intent/Tools | `../specs/10-EXECUTIVE-CHAT-INTENTS-TOOLS.md` | 意图枚举 + 工具映射 |
| EChat 请求流程 | `../specs/11-EXECUTIVE-CHAT-REQUEST-FLOW.md` | LangGraph 流转 |
| Agent 架构 | `../specs/12-AGENT-ARCHITECTURE.md` | Agent 框架设计 |
| ER 图（新） | `../er-diagram-graphviz.svg` | 新数据库 schema |

---

## 4. 架构/技术文档

| 文档 | 路径 | 说明 |
|------|------|------|
| 后端路由 | `../backend/01-ROUTES.md` | 路由清单（部分已迁移到 modules/） |
| 后端服务 | `../backend/02-SERVICES.md` | 服务清单（部分已迁移） |
| 数据库 | `../backend/03-DATABASE.md` | 表文档（旧表名） |
| WebSocket | `../backend/04-WEBSOCKET.md` | WS 架构 |
| Agent 框架 | `../backend/05-AGENT-FRAMEWORK.md` | Agent 框架文档 |
| MyPal 集成 | `../backend/06-MYPAL-INTEGRATION.md` | MyPal 对接 |
| 看板模块审计 | `../backend/07-DASHBOARD-MODULE.md` | 当前 modules/dashboard/ 代码质量审计 |
| 前端-总部 | `../frontend/01-CENTRAL.md` | 总部看板前端 |
| EChat 代码地图 | `../internal/EXECUTIVE-CHAT-CODE-MAP.md` | Agent 源文件职责 |
| 技术债 | `../internal/TECH-DEBT.md` | 已知问题 |
| 新人上手 | `../team-onboarding.md` | 环境搭建 + 分支规范 |

---

## 5. 测试文档

| 文档 | 路径 | 说明 |
|------|------|------|
| EChat 测试查询 | `../tests/EXECUTIVE-CHAT-TEST-QUERIES.md` | 手动测试参考 |
| EChat 测试指南 | `../tests/EXECUTIVE-CHAT-TESTING.md` | 测试环境搭建 |

---

## 6. 如何使用这个索引

**给 AI 的指令**：读本文件 → 根据任务类型跳转到对应章节 → 读具体文档

| 任务类型 | 先读 | 再读 |
|----------|------|------|
| 写模块化代码（dashboard/task-publish/admin） | §1 方案 + §2 规范 | §3 对应规格 |
| 修改 Agent/Chat 代码 | §1 agent-refactor-plan | §3 EChat 规格 + §4 EChat 代码地图 |
| 修 bug / 补测试 | §5 测试文档 | §2 CLAUDE.md |
| 理解业务需求 | §3 产品规格 | — |
| 新建表 / 迁移 DB | §3 ER 图 + §4 数据库 | — |
| 更新文档 | §1 进度追踪 + §4 对应章节 | — |

---

## 7. 快速链接速查

```
方案：     docs/plans/2026-05-12-modularization-plan.md
进度：     docs/plans/2026-05-13-modularization-progress.md
Agent：    docs/plans/2026-05-11-agent-refactor-plan.md
规范：     docs/CODING-STANDARDS.md
CLAUDE：   CLAUDE.md
新人：     docs/team-onboarding.md
ER图：     docs/er-diagram-graphviz.svg
归档索引： docs/archive/index.md
```
