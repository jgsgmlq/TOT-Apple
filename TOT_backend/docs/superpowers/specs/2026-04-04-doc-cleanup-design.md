# 文档整理设计方案

**日期:** 2026-04-04
**状态:** 已批准
**范围:** TOT_backend/docs/ 目录

---

## 背景

随着项目从旧版架构（2026-03-18）演进到当前版本（store_manager 角色移除、API 路径统一为 `/api/v1/`、字段名更新、Mac Studio 服务器化），多个文档已过时或包含错误信息。

---

## 1. 删除操作（3 个文件）

| 文件 | 原因 |
|------|------|
| `docs/backend/ARCHITECTURE.md` | 2026-03-18 旧版，字段名（`name/deadline`）、角色（store_manager）、API 路径（`/api/`）全部过时；文件自身已标注 ⚠️ 历史 |
| `docs/backend/BACKEND_IMPLEMENTATION_REPORT.md` | 同期旧版实现报告，文件自身已标注 ⚠️ 历史 |
| `docs/frontend/FRONTEND_SYSTEM_BEHAVIOR.md` | 旧版前端行为分析；`docs/frontend/index.md` 已将其标记为历史文档 |

---

## 2. 更新操作（4 个文件）

### 2.1 `docs/tests/QUICK_START.md`
修复 3 处明确错误：
- 路径：`/Users/skyler/Desktop/MVP/server` → `TOT_backend/server`（相对仓库根目录）
- 端口：`8080` → `3000`
- 启动命令：`npm start` → `npm run dev`

### 2.2 `docs/README.md`
修复 2 处错误：
- 移除 "50 门店 × 5 名员工 = 250 名员工 + 50 名店长" 的 store_manager 描述
- 前端文档导航中移除对 `02-STORE.md` 的活跃引用（store_manager 角色已移除）

### 2.3 `docs/frontend/index.md`
- 将 `02-STORE.md` 从活跃文档列表移入"历史文档"分区
- 加注 ⚠️ 说明（store_manager 角色已移除）

### 2.4 `docs/backend/index.md`
- 从"历史文档"分区移除对 `ARCHITECTURE.md` 和 `BACKEND_IMPLEMENTATION_REPORT.md` 的引用（这两个文件将被删除）

---

## 3. 不变范围

以下文档确认为当前有效基线，不做��改：
- `docs/backend/01-ROUTES.md` — 当前路由实现与 Gap 清单，内容准确
- `docs/backend/02-SERVICES.md`、`03-DATABASE.md`、`04-WEBSOCKET.md` — 当前规格
- `docs/backend/06-MYPAL-INTEGRATION.md` — MyPal 对接文档
- `docs/specs/00-08` — 产品规格
- `docs/internal/CONTRACT.md`、`FRONTEND-HANDOFF.md` — 内部接口契约
- `docs/frontend/01-CENTRAL.md`、`03-EMPLOYEE.md`、`04-SHARED.md` — 当前前端文档

---

## 成功标准

- 不存在已知包含错误路径/端口/命令的文档
- 已移除的 store_manager 角色不再出现在活跃文档导航中
- 已明确��注为历史的文档从文件系统中删除
