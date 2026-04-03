# 后端类文档

此目录存放"后端实现指南/服务层设计/数据库对比/WebSocket 规格"等说明。

**图例：** ✅ 符合 Spec | ⚠️ 部分实现 / 需修改 | ❌ 未实现

> **当前唯一有效基线（请优先遵循）**
> - 后端实施文档：`01-ROUTES.md`、`02-SERVICES.md`、`03-DATABASE.md`、`04-WEBSOCKET.md`
> - 产品与规格基线：`docs/product/PRODUCT_REQUIREMENTS.md` + `docs/specs/00-08`
>
> 历史文档仅用于追溯背景，不作为当前实现和验收依据。

## 文档列表

| 文档 | 内容 | 首次阅读顺序 |
|------|------|------------|
| [01-ROUTES.md](./01-ROUTES.md) | 全部路由现状 vs 目标 + Gap 清单 | 1 |
| [02-SERVICES.md](./02-SERVICES.md) | 服务层现状 vs 目标实现代码 | 2 |
| [03-DATABASE.md](./03-DATABASE.md) | 数据库表结构现状对比 + 迁移脚本 | 3 |
| [04-WEBSOCKET.md](./04-WEBSOCKET.md) | WebSocket 连接、事件类型、角色裁剪 | 4 |
| [05-AGENT-FRAMEWORK.md](./05-AGENT-FRAMEWORK.md) | AI Agent 基础调度框架与 Skill 定义 | 5 |

## 历史文档（已过时）

- [ARCHITECTURE.md](./ARCHITECTURE.md) — 旧版架构设计（基于 2026-03-18，仅供参考）
- [BACKEND_IMPLEMENTATION_REPORT.md](./BACKEND_IMPLEMENTATION_REPORT.md) — 旧版实现报告
