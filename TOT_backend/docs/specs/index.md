# Spec 类文档

此目录存放「接口 / 数据 / 集成 / 架构约定」等可被后端、前端直接落地的规格说明。

**产品需求口径**见 [`../product/PRODUCT_REQUIREMENTS.md`](../product/PRODUCT_REQUIREMENTS.md)（版本与日期以该文件头部为准）。

> **最新规格**请优先阅读 **00–09** 系列文档（含 P1：`09-EXECUTIVE-CHAT.md`）。

**冲突处理：** 当实现或文档之间出现分歧时，以 **PRD（`product/PRODUCT_REQUIREMENTS.md`）的产品口径** 与本目录下标记为 **Current** 的规格为准；先对齐需求再修订规格或代码。

**历史规格：** 被新文档替代、不再代表当前基线的规格，不删除，后续迁入 [`../archive/`](../archive/index.md) 并在本索引中改为指向归档路径。

---

## 核心规格文档

| 文档 | 内容 | 首次阅读顺序 | 状态 |
|------|------|------------|------|
| [00-OVERVIEW.md](./00-OVERVIEW.md) | 总览、技术栈、角色、核心对象、功能范围 | 1 | Current |
| [01-DATA-MODEL.md](./01-DATA-MODEL.md) | 数据库全部表结构与字段定义 | 2 | Current |
| [02-STATE-MACHINES.md](./02-STATE-MACHINES.md) | Task & Assignment 状态机 | 3 | Current |
| [03-PLATFORM-COMPLETION.md](./03-PLATFORM-COMPLETION.md) | 四平台完成规则与进度计算 | 4 | Current |
| [04-API-SPEC.md](./04-API-SPEC.md) | 完整 REST API + WebSocket 规格 | 5 | Current |
| [05-NOTIFICATION-NUDGE.md](./05-NOTIFICATION-NUDGE.md) | 通知系统与催办系统 | 6 | Current |
| [06-DASHBOARD-KPI.md](./06-DASHBOARD-KPI.md) | 看板指标口径与计算规则（含 SQL）| 7 | Current |
| [07-RTM-FILTER.md](./07-RTM-FILTER.md) | RTM 下发筛选逻辑与 SQL 实现 | 8 | Current |
| [08-PERMISSION-MODEL.md](./08-PERMISSION-MODEL.md) | 角色权限矩阵与后端实现代码 | 9 | Current |
| [09-EXECUTIVE-CHAT.md](./09-EXECUTIVE-CHAT.md) | Executive Chat P1 规格（自然语言查询）| 10 | Current |
| [10-EXECUTIVE-CHAT-INTENTS-TOOLS.md](./10-EXECUTIVE-CHAT-INTENTS-TOOLS.md) | Executive Chat 当前意图/工具清单与新增流程 | 11 | Current |
