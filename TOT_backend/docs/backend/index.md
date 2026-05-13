# 后端类文档

此目录存放"后端实现指南/服务层设计/数据库对比/WebSocket 规格"等说明。

**图例：** ✅ 符合 Spec | ⚠️ 部分实现 / 需修改 | ❌ 未实现

> **当前唯一有效基线（请优先遵循）**
> - 模块化架构文档：`08-MODULE-ARCHITECTURE.md`（模块架构规范）、`09-MODULE-SERVICES.md`（Service 层清单）
> - 后端实施文档：`01-ROUTES.md`、`02-SERVICES.md`、`03-DATABASE.md`、`04-WEBSOCKET.md`、`06-MYPAL-INTEGRATION.md`（MyPal 对接）
> - 产品与规格基线：`docs/product/PRODUCT_REQUIREMENTS.md` + `docs/specs/00-09`
>
> 历史文档仅用于追溯背景，**不可直接作为当前改造或验收依据**。

## 文档列表

| 文档 | 内容 | 首次阅读顺序 | 状态 |
|------|------|------------|------|
| [01-ROUTES.md](./01-ROUTES.md) | 全部路由现状 vs 目标 + Gap 清单 | 1 | Current |
| [02-SERVICES.md](./02-SERVICES.md) | 服务层现状 vs 目标实现代码 | 2 | Current |
| [03-DATABASE.md](./03-DATABASE.md) | 数据库表结构现状对比 + 迁移脚本 | 3 | Current |
| [04-WEBSOCKET.md](./04-WEBSOCKET.md) | WebSocket 连接、事件类型、角色裁剪 | 4 | Current |
| [05-AGENT-FRAMEWORK.md](./05-AGENT-FRAMEWORK.md) | AI Agent 基础调度框架与 Skill 定义（运行时） | 5 | Reference |
| [06-MYPAL-INTEGRATION.md](./06-MYPAL-INTEGRATION.md) | MyPal HTTP 签名、同步任务与 `POST /mypal/sync` | 6 | Current |
| [07-DASHBOARD-MODULE.md](./07-DASHBOARD-MODULE.md) | Dashboard 模块代码质量审计报告 | 7 | Current |
| [08-MODULE-ARCHITECTURE.md](./08-MODULE-ARCHITECTURE.md) | 模块架构规范：三层契约、模块拓扑、基础设施、跨模块通信 | 8 | Current |
| [09-MODULE-SERVICES.md](./09-MODULE-SERVICES.md) | 新模块结构下的 Service 层完整清单 | 9 | Current |
| [10-TASK-PUBLISH-MODULE.md](./10-TASK-PUBLISH-MODULE.md) | Task Publish 模块代码质量审计 | 10 | Current |
| [11-ADMIN-MODULE.md](./11-ADMIN-MODULE.md) | Admin + MyPal 模块代码质量审计 | 11 | Current |
| [MYPAL-REQUEST-TO-PARTNER.md](../MYPAL-REQUEST-TO-PARTNER.md) | 致 MyPal 方：需对方提供的凭证与配合项（可对外转发） | — | Current |

## 历史文档

> 2026-03-18 版本的旧版架构设计（ARCHITECTURE.md）与实现报告（BACKEND_IMPLEMENTATION_REPORT.md）已于 2026-04-04 从仓库中删除，可通过 git history 查阅。

以上内容与已删除文件**仅用于追溯**，不作为当前实现和验收依据。
