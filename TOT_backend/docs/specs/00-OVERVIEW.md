# Specs Overview — MVP 培训管理系统

**PRD 来源:** `docs/product/PRODUCT_REQUIREMENTS.md` v3.2.9（2026-03-23）
**Spec 版本:** 1.2.0（2026-03-31）
**状态:** Spec-ready，可直接驱动前后端开发

---

## 文档索引

| 文档 | 内容 | 首次阅读顺序 |
|------|------|------------|
| [01-DATA-MODEL.md](./01-DATA-MODEL.md) | 数据库全部表结构与字段定义 | 1 |
| [02-STATE-MACHINES.md](./02-STATE-MACHINES.md) | Task & Assignment 状态机与转换规则 | 2 |
| [03-PLATFORM-COMPLETION.md](./03-PLATFORM-COMPLETION.md) | 四平台完成规则与进度计算公式 | 3 |
| [04-API-SPEC.md](./04-API-SPEC.md) | 完整 REST API + WebSocket 规格 | 4 |
| [05-NOTIFICATION-NUDGE.md](./05-NOTIFICATION-NUDGE.md) | 通知系统与催办系统规格 | 5 |
| [06-DASHBOARD-KPI.md](./06-DASHBOARD-KPI.md) | 看板指标口径与计算规则 | 6 |
| [07-RTM-FILTER.md](./07-RTM-FILTER.md) | RTM 下发筛选逻辑与 SQL 实现 | 7 |
| [08-PERMISSION-MODEL.md](./08-PERMISSION-MODEL.md) | 角色权限矩阵与数据可见性规则 | 8 |
| [09-EXECUTIVE-CHAT.md](./09-EXECUTIVE-CHAT.md) | Executive Chat P1 规格（自然语言查询）| 9 |

---

## 技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| 前端 | HTML5 + CSS3 + Vanilla JS | 无框架，无构建工具，3 个独立 H5 页面 |
| 后端 | Node.js + Express 4.x | REST API + WebSocket |
| 数据库 | SQLite 3 + WAL 模式 | 文件路径：`server/database.db` |
| 认证 | JWT，HS256，7 天有效 | Header: `Authorization: Bearer <token>` |
| 实时 | WebSocket（主）+ REST 轮询（降级）| ws://host:8080/ws |
| 部署 | 局域网，HTTP，端口 8080 | 无需安装，浏览器直接访问 |

---

## 用户角色与入口

| 角色 | 数量（Mock） | 前端入口 | 典型账号 |
|------|------------|---------|---------|
| 总部（central） | 1 | `central.html` | central / Train2026! |
| 店员（employee） | 300 | `employee.html` | emp_E002 / Train2026! |
| Executive（P1） | 若干 | `executive.html` | — |
| Admin | 1 | `admin.html` | admin / Admin2026! |

> **账号说明:** 员工 username 格式为 `emp_E{employeeId}`（如 `emp_E002`）。

**终端形态：** 总部使用 PC，店员使用手机（iPhone 为主）

---

## 核心对象关系

```
Task (1:N)
  └─▶ TaskAssignment  ← 每个目标用户一条，执行与判定的最小单位
         │
         ├─▶ NotificationEvent (1:N)  ← 通知/催办事件
         │     └─▶ ReadReceipt (1:N)  ← 已读回执
         │
         └─▶ NudgeRecord              ← 催办事实记录（完整审计）
```

---

## MVP 功能范围（P0，本次开发重点）

- [x] 任务创建（title, description, platforms, targetRole, rtmFilter, ddlAt）
- [x] RTM 筛选 + 一键下发（生成 Assignments）
- [x] Assignment 状态机（pending → in_progress → completed）
- [x] 四平台完成标记（MyPAL 降级手动，其余手动）
- [x] 总部实时看板（完成率、区域热力图、Top/Bottom 5 门店、预警列表）
- [x] 催办系统（总部催全网/门店/地区）
- [x] 催办通知（铃铛显示未读数，任务完成后自动消失）
- [x] 角色权限隔离（central/employee 数据可见性）

## P1 功能（本期设计框架，不要求实现）

- [ ] Executive Chat（自然语言查询，≤5s 响应，3 轮追问，VP/区域总监权限隔离）— 见 09-EXECUTIVE-CHAT.md
- [ ] 下发预览与历史
- [ ] 完整消息中心

---

## 关键业务规则速查

| 规则 | 口径 | 详见 |
|------|------|------|
| Task 终态 | dispatched 是终态，MVP 无撤回 | 02-STATE-MACHINES |
| Assignment 终态 | completed 不可回退 | 02-STATE-MACHINES |
| pending 下禁止 | 不能标记平台完成 | 02-STATE-MACHINES |
| 进度计算 | 已完成平台数 / 配置平台总数 × 100 | 03-PLATFORM-COMPLETION |
| MyPAL | 优先 API 对接，不可用降级手动 | 03-PLATFORM-COMPLETION |
| 幂等下发 | 同一任务同一用户只生成一条 Assignment | 01-DATA-MODEL |
| 催办终止 | 任务完成后前端自动隐藏催办通知 | 05-NOTIFICATION-NUDGE |
| RTM 筛选 | 条件内 AND，条件间 OR，大小写不敏感 | 07-RTM-FILTER |
| 落队等级 | ≥80% 快完成，50-79% 中等，<50% 严重落队 | 06-DASHBOARD-KPI |
