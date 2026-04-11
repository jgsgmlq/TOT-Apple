# 前端对接交付文档

**版本:** 1.0.2 | **日期:** 2026-04-11 | **后端负责人:** Dev1 + Dev2

**产品口径：** 需求与角色定义见 `docs/product/PRODUCT_REQUIREMENTS.md`。PRD 下 **店长为学习对象时与店员共用同一学习端**，**无独立店长管理端**。接口仍可能返回 `store_manager` JWT 场景（规格/历史兼容）；**当前 `db/seed.js` 仅生成 `employee` 店员账号**，店长端联调请用 PRD 约定或自建用户。

---

## 1. 接口文档

主文档：`docs/specs/04-API-SPEC.md`（v1.3）

覆盖范围：
- 全部 P0 端点（方法 / 路径 / 权限 / 请求体 / 响应示例）
- 所有业务错误码及触发条件
- WebSocket 连接方式 + 事件列表（§15）
- 各角色权限边界说明（§1 / §8 权限模型）

---

## 2. 本地启动

```bash
cd server
npm install --registry https://registry.npmjs.org
npm run seed         # 初始化数据库：10 店 / 100 员工 / 3 预置任务 / 300 条分配 / MyPal Mock / 见 seed.js
npm start            # 默认监听 PORT=3000（可通过环境变量覆盖）
```

| 服务 | 地址 |
|------|------|
| REST API 基础路径 | `http://localhost:3000/api/v1` |
| WebSocket | `ws://localhost:3000/ws?token=<JWT>` |

> **重新初始化：** 删除 `server/database.db`（及 `-shm` / `-wal`）后重新执行 `npm run seed`。重复执行 seed 会清空分配/通知等并重建种子数据，详见仓库根目录 `README.md`「Seed 数据库」。

---

## 3. 测试账号

| 用户名 | 密码 | 角色 | 说明 |
|--------|------|------|------|
| `central` | `Train2026!` | central | 总部，全量读写权限 |
| `executive` | `Train2026!` | executive | 只读看板（全国），无写权限 |
| `executive_huadong` | `Train2026!` | executive | 只读看板，辖区预置华东 |
| `admin` | `Admin2026!` | admin | 管理员，等同 central + 额外维护权限 |
| `emp_E002` | `Train2026!` | employee | S001 店员（通用 smoke） |
| `emp_E010` | `Train2026!` | employee | 优秀门店滞后画像（催办联调） |
| `emp_E091` | `Train2026!` | employee | 预警门店（S010） |

其余店员：`emp_E001`～`emp_E100`；亦可使用邮箱 `e001@mypal.seed.local`～`e100@mypal.seed.local` 登录，密码均为 `Train2026!`。完整说明以 `npm run seed` 末尾打印为准。

所有账号通过 `POST /api/v1/auth/login` 获取 JWT，有效期 7 天。

---

## 4. 认证方式

所有受保护接口需在请求头携带：

```
Authorization: Bearer <token>
```

登录接口（`POST /auth/login`）无需 Token。

---

## 5. 已知限制（前端必读）

### 5.1 未读数计算

- `GET /events/unread-count` 返回全量准确未读数，用于铃铛角标。
- `GET /events` 响应中的 `unreadCount` 字段仅反映**当前页**结果集，不要用它累加计算总未读数。

### 5.2 batch-create 产生的 assignment

通过 `POST /assignments/batch-create` 创建的 assignment，不会产生 `task_assigned` 通知事件。此类 assignment 调用 `POST /assignments/:id/viewed` 时，响应中 `receiptId` 为 `null`，属正常行为，前端不可断言其非空。

### 5.3 WebSocket 覆盖范围

WebSocket 推送仅支持 **employee** 和 **store_manager** 角色（JWT 需带 `employeeId`）。`central` / `executive` / `admin` 不支持 WS 连接，需通过轮询 REST API 获取实时数据。当前 seed 仅含 `employee` 店员账号。

### 5.4 assignments 列表响应结构

`GET /assignments` 的 `data` 为嵌套对象，不是顶层数组：

```json
{
  "data": {
    "list": [...],
    "pagination": { "pageNum": 1, "pageSize": 20, "total": 100, "totalPages": 5 }
  }
}
```

请读 `response.data.list`，不要直接遍历 `response.data`。

### 5.5 任务详情接口双字段兼容

`GET /assignments/:id` 和 `GET /assignments` 列表项中同时存在 `id` 和 `assignmentId`，两者值相同。`assignmentId` 为新字段，`id` 保留作向后兼容，建议新代码统一使用 `assignmentId`。

---

## 6. 不在本期范围

以下功能 **未实现**，请勿在前端排期中依赖：

- Executive Chat（P1，独立排期）
- 报表导出 / CSV 下载
- 多语言 / i18n
- 跨域访问配置（本地开发阶段 CORS 已全放开）

---

## 7. 联调支持

如需后端配合，请优先提供：

1. 复现步骤（接口路径 + 请求体 + 响应体）
2. `requestId`（响应中 `requestId` 字段，用于后端日志定位）
