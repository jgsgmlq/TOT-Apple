# MVP 项目文档中心

**最后更新:** 2026-04-14  
**文档版本:** 1.2  
**适用于:** AI、开发者、测试、产品

**产品需求口径：** 以 [`product/PRODUCT_REQUIREMENTS.md`](product/PRODUCT_REQUIREMENTS.md) 为准（版本与日期以该文件头部为准）。

---

## 文档状态说明

| 标签 | 含义 |
|------|------|
| **Current** | 当前实现与验收基线，开发时优先遵循 |
| **Reference** | 可参考的补充说明，非唯一技术口径 |
| **Historical** | 历史背景或已过时上下文，**不作为**当前改造与验收依据 |
| **Archived** | 已迁入 [`archive/`](archive/index.md)，仅作追溯 |

各子目录的 [`specs/index.md`](specs/index.md)、[`backend/index.md`](backend/index.md)、[`frontend/index.md`](frontend/index.md) 等索引中，对单篇文档使用 **Current / Reference / Historical** 标注；[`frontend/index.md`](frontend/index.md) 同时保留 ✅、⚠️、❌ 图例列，可与上表对照。

---

## AI 快速阅读路径（只读）

用于快速建立上下文，**不改变**各角色在下方「按用途查找文档」中的推荐顺序。

1. [`product/PROJECT_OVERVIEW.md`](product/PROJECT_OVERVIEW.md) — 项目与仓库入口  
2. [`specs/00-OVERVIEW.md`](specs/00-OVERVIEW.md) — Spec 总览  
3. [`specs/01-DATA-MODEL.md`](specs/01-DATA-MODEL.md) — 数据模型  
4. [`specs/04-API-SPEC.md`](specs/04-API-SPEC.md) — REST / WebSocket 约定  
5. [`backend/03-DATABASE.md`](backend/03-DATABASE.md) — 库表实现与迁移对照  
6. [`backend/02-SERVICES.md`](backend/02-SERVICES.md) — 服务层与实现对照  
7. [`tests/QUICK_START.md`](tests/QUICK_START.md) — 启动与验证  

---

## 归档入口

- [`archive/index.md`](archive/index.md) — 历史计划与迁出文档索引（随 Batch 2 逐步充实）

---

## 文档导航地图

### 新人快速上手（约 15 分钟）

1. **[product/PROJECT_OVERVIEW.md](product/PROJECT_OVERVIEW.md)** — 项目是什么、与 PRD 对齐的摘要、仓库目录与文档入口  
2. **[tests/QUICK_START.md](tests/QUICK_START.md)** — 本地启动、联调、常见问题  
3. **[specs/00-OVERVIEW.md](specs/00-OVERVIEW.md)** — Spec 总览；**[backend/index.md](backend/index.md)** — 后端路由/服务/DB 与实现对照（旧版 `ARCHITECTURE.md` 已移除，见 `backend/index.md`「历史文档」说明）

---

## 分类入口

- 产品：[`product/index.md`](product/index.md)  
- Spec：[`specs/index.md`](specs/index.md)  
- 前端：[`frontend/index.md`](frontend/index.md)  
- 后端：[`backend/index.md`](backend/index.md)  
- 测试：[`tests/index.md`](tests/index.md)  
- 内部契约 / 前端交付：[`internal/CONTRACT.md`](internal/CONTRACT.md)、[`internal/FRONTEND-HANDOFF.md`](internal/FRONTEND-HANDOFF.md)  
- 归档：[`archive/index.md`](archive/index.md)

---

## 文档维护规则

1. **新增/变更 API** → 更新 `specs/04-API-SPEC.md`  
2. **变更数据库** → 更新 `specs/01-DATA-MODEL.md` 与 `backend/03-DATABASE.md`  
3. **架构或服务层重大调整** → 更新 `backend/02-SERVICES.md`、`backend/index.md` 等  
4. **启动或部署流程变化** → 更新 `tests/QUICK_START.md`、根目录 `README.md`  
5. **产品口径变化** → 更新 `product/PRODUCT_REQUIREMENTS.md`（由 Product Team 维护），并同步本索引中引用说明  

建议在文档头部维护「最后更新」日期（不必强求统一版本号）。

---

## 按用途查找文档

### 前端开发者

**推荐阅读顺序：**

1. [specs/04-API-SPEC.md](specs/04-API-SPEC.md) — API 与 WebSocket  
2. [frontend/04-SHARED.md](frontend/04-SHARED.md) — 公共模块（若与当前 Vue 工程不一致，以 `TOT_frontend` 代码为准）  
3. [tests/QUICK_START.md](tests/QUICK_START.md) — 本地测试  

**常见问题：**

- **需要调哪些 API？** → `specs/04-API-SPEC.md` 任务与 Assignment 章节  
- **实时更新？** → [backend/04-WEBSOCKET.md](backend/04-WEBSOCKET.md)  
- **各端页面与路由？** → 根目录 [`README.md`](../README.md)、`TOT_frontend` 源码  

### 后端开发者

**推荐阅读顺序：**

1. [backend/index.md](backend/index.md) — 后端文档索引与基线说明  
2. [specs/01-DATA-MODEL.md](specs/01-DATA-MODEL.md) — 数据库  
3. [specs/04-API-SPEC.md](specs/04-API-SPEC.md) — API 约定  

**常见问题：**

- **任务与 Assignment 关系？** → `specs/01-DATA-MODEL.md`  
- **新增或修改路由？** → `backend/01-ROUTES.md` + `specs/04-API-SPEC.md`  

### 产品经理或测试人员

**推荐阅读顺序：**

1. [product/PRODUCT_REQUIREMENTS.md](product/PRODUCT_REQUIREMENTS.md) — 需求与验收  
2. [product/PROJECT_OVERVIEW.md](product/PROJECT_OVERVIEW.md) — 概览  
3. [tests/QUICK_START.md](tests/QUICK_START.md) — 如何跑通场景  

**角色（与 PRD 一致，摘要）：** 总部 `central`、学习对象 `employee`、店长作为学习对象时与店员同端、Executive `executive`（P1 能力见 PRD）、`admin`。  

### 系统架构师

**推荐阅读顺序：**

1. [specs/00-OVERVIEW.md](specs/00-OVERVIEW.md)  
2. [specs/01-DATA-MODEL.md](specs/01-DATA-MODEL.md)  
3. [backend/02-SERVICES.md](backend/02-SERVICES.md)、[backend/04-WEBSOCKET.md](backend/04-WEBSOCKET.md)  

> 已删除的 `backend/ARCHITECTURE.md`、`BACKEND_IMPLEMENTATION_REPORT.md` 仅可通过 git history 查阅（见 `backend/index.md`）。

---

## 核心文档一览

| 文档 | 说明 |
|------|------|
| [product/PROJECT_OVERVIEW.md](product/PROJECT_OVERVIEW.md) | 项目概览与导航 |
| [backend/index.md](backend/index.md) | 后端实现文档入口 |
| [specs/04-API-SPEC.md](specs/04-API-SPEC.md) | API / WS 规格 |
| [specs/01-DATA-MODEL.md](specs/01-DATA-MODEL.md) | 数据模型 |
| [tests/QUICK_START.md](tests/QUICK_START.md) | 快速启动与测试 |

---

## 常见查询速解

| 问题 | 指向 |
|------|------|
| 从哪开始？ | [product/PROJECT_OVERVIEW.md](product/PROJECT_OVERVIEW.md) |
| 如何启动后端？ | [tests/QUICK_START.md](tests/QUICK_START.md)、根目录 [README.md](../README.md) |
| API 怎么调？ | [specs/04-API-SPEC.md](specs/04-API-SPEC.md) |
| 表结构？ | [specs/01-DATA-MODEL.md](specs/01-DATA-MODEL.md) |
| 后端路由与 Gap？ | [backend/01-ROUTES.md](backend/01-ROUTES.md) |
| 产品范围与验收？ | [product/PRODUCT_REQUIREMENTS.md](product/PRODUCT_REQUIREMENTS.md) |

---

## 获取帮助

1. 在 `TOT_backend/docs` 内全文搜索  
2. [tests/QUICK_START.md](tests/QUICK_START.md) 中的故障排查章节  
3. 代码与 `requestId` 日志联调  

---

**文档中心维护者:** Backend & AI Team  
