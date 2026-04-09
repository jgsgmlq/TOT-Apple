# Spec 类文档

此目录存放「接口 / 数据 / 集成 / 架构约定」等可被后端、前端直接落地的规格说明。

**产品需求口径**见 [`../product/PRODUCT_REQUIREMENTS.md`](../product/PRODUCT_REQUIREMENTS.md)（版本与日期以该文件头部为准）。

> **最新规格**请优先阅读 **00–09** 系列文档（含 P1：`09-EXECUTIVE-CHAT.md`）。

---

## 核心规格文档

| 文档 | 内容 | 首次阅读顺序 |
|------|------|------------|
| [00-OVERVIEW.md](./00-OVERVIEW.md) | 总览、技术栈、角色、核心对象、功能范围 | 1 |
| [01-DATA-MODEL.md](./01-DATA-MODEL.md) | 数据库全部表结构与字段定义 | 2 |
| [02-STATE-MACHINES.md](./02-STATE-MACHINES.md) | Task & Assignment 状态机 | 3 |
| [03-PLATFORM-COMPLETION.md](./03-PLATFORM-COMPLETION.md) | 四平台完成规则与进度计算 | 4 |
| [04-API-SPEC.md](./04-API-SPEC.md) | 完整 REST API + WebSocket 规格 | 5 |
| [05-NOTIFICATION-NUDGE.md](./05-NOTIFICATION-NUDGE.md) | 通知系统与催办系统 | 6 |
| [06-DASHBOARD-KPI.md](./06-DASHBOARD-KPI.md) | 看板指标口径与计算规则（含 SQL）| 7 |
| [07-RTM-FILTER.md](./07-RTM-FILTER.md) | RTM 下发筛选逻辑与 SQL 实现 | 8 |
| [08-PERMISSION-MODEL.md](./08-PERMISSION-MODEL.md) | 角色权限矩阵与后端实现代码 | 9 |
| [09-EXECUTIVE-CHAT.md](./09-EXECUTIVE-CHAT.md) | Executive Chat P1 规格（自然语言查询）| 10 |
