# MyPal 学习进度 HTTP 对接（服务端）

**版本:** 1.0.0 | **依据:** MyPal 方《TOT-MyPAL 学员产品学习进度技术对接方案》

---

## 0. 内部联调阶段（当前推荐）

**团队内部前后端联调、不接 MyPal 真实环境时：**

- 保持 **`MYPAL_MOCK=1`**，使用 **`GET /api/v1/mypal/mock/learning`** 与表 **`mypal_learning_mock`**（`seed.js` 写入与 `employees.email` 对齐的示例数据）。
- **不要**配置 **`MYPAL_ENABLED=1`** 或真实 `MYPAL_API_BASE` / 密钥；`POST /api/v1/mypal/sync` 仅在与 MyPal 开通 HTTP 联调后使用。

下文 **§1 起**描述的是 **真实 HTTP 对接**（与 Mock 并行存在，互斥启用）。

---

## 1. 数据方向与运行时

- **方向：** TOT 后端作为 **HTTP 客户端**，主动 POST 到 MyPal 提供的接口（非回调 TOT）。
- **运行环境：** Node.js **18+**（使用内置 `fetch` 与 `AbortSignal` 超时）。
- **与本地 Mock：** `MYPAL_MOCK=1` 时 `GET /api/v1/mypal/mock/learning` 仍可用；**拉取真实进度**依赖本文档 **`MYPAL_ENABLED` 等**变量，与 Mock 表无耦合。

---

## 2. 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `MYPAL_ENABLED` | 是 | 设为 `1` 才允许调用 MyPal 与 `POST /api/v1/mypal/sync`。 |
| `MYPAL_API_BASE` | 是 | 如 `https://{domain}`，**无**尾部 `/`。客户端会拼接路径 `/air2/api/sync/tot/...`。 |
| `MYPAL_APP_ID` | 是 | MyPal 分配的 `appId`。 |
| `MYPAL_APP_SECRET` | 是 | 仅用于服务端 HMAC，**禁止**提交到仓库或前端。 |
| `MYPAL_REQUEST_TIMEOUT_MS` | 否 | 默认 `3000`（与 `docs/specs/03-PLATFORM-COMPLETION.md` 建议一致）。 |

---

## 3. 签名（HMAC-SHA256）

与对接文档一致：

1. 参与签名的参数为 **除 `sign` 外** 全部请求参数（含 `appId`、`timestamp`、`nonce` 及业务参数）。
2. 按 **key 字母升序** 排列，拼成 `key=value`，以 `&` 连接；**空值不参与**。
3. 使用 `appSecret` 做 HMAC-SHA256，结果为 **小写十六进制**。

实现：`server/services/mypalSign.js`（`signParams`）。

**说明：** 对接 PDF 中的示例 `sign` 十六进制串为示意；用同一待签名字符串与 `openssl dgst -sha256 -hmac` 校验时，应与 `mypalSign.js` 输出一致。

---

## 4. MyPal 接口（客户端封装）

| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/air2/api/sync/tot/getUserWeeklyStatus` | 单学员、单任务周，适合 **weekly** 模式（注意频率）。 |
| POST | `/air2/api/sync/tot/getUserDatas` | 分页批量，适合 **batch** 模式（建议凌晨后大批量）。 |

请求体：`application/x-www-form-urlencoded;charset=UTF-8`。

实现：`server/services/mypalClient.js`。

---

## 5. 任务与数据映射

| 数据库 / API | MyPal | 说明 |
|--------------|-------|------|
| `tasks.mypal_task_week` | `queryDate` | 任务周，如 `FY26Q2W1`。**启用 MyPal 平台时创建/编辑草稿必填**；下发前会再次校验。 |
| `tasks.mypal_product_name` | `productName` | 与响应 **精确匹配**；未填时，仅当该学员在该周批量结果中 **恰好一条** 记录时才回写，否则跳过（避免歧义）。 |
| `employees.email` | `seedId` | 均为学员邮箱；比较前 **trim + lower**（`mypalLink.normalizeEmail`）。 |

同步将 `progress === 100` 映射为 `task_assignments.mypal_completed = 1`，并按 `server/services/assignmentProgress.js` 与手动「平台完成」一致地重算 `progress` / `status` / `completed_at`，任务全部完成时通过 WebSocket 广播 `assignment_completed`（与 `routes/assignments.js` 行为对齐）。

---

## 6. TOT API：`POST /api/v1/mypal/sync`

- **鉴权：** JWT；角色 `central` / `admin`。
- **前置：** `MYPAL_ENABLED=1` 且 `MYPAL_API_BASE`、`MYPAL_APP_ID`、`MYPAL_APP_SECRET` 已配置；否则 **503** / `errorCode: MYPAL_DISABLED`。

**请求体（JSON）：**

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `mode` | string | `batch` | `batch`：调用 `getUserDatas` 拉全量再按学员匹配；`weekly`：每学员调用 `getUserWeeklyStatus`（内置约 1.1s 间隔以降低触达 60 次/分钟上限的风险）。 |
| `taskId` | string | 无 | 若传则只处理该任务；不传则处理 **已下发** 且 `has_mypal = 1` 的全部任务。 |
| `queryDate` | string | 无 | 覆盖任务上的 `mypal_task_week`；不传则使用各任务的 `mypal_task_week`。 |

**响应 `data`：** 含 `assignmentsExamined`、`assignmentsUpdated`、跳过原因计数及 `errors[]`（逐条错误信息，不含密钥）。

---

## 7. 安全与运维（与 MyPal 文档）

- 请求时间戳与服务器时间差建议 **≤ 5 分钟**（由 MyPal 侧校验）。
- `nonce` **10 分钟内不可重复**（客户端每次请求生成随机串）。
- 单 `appId` **每分钟最多约 60 次**；`weekly` 模式学员数大时请分批或改用 `batch`。
- 批量接口建议在 **每日凌晨 3:00 后** 调用（对方数据统计完成后）。

---

## 8. 常见错误码（MyPal 响应 `code`）

| code | 含义 | 排查 |
|------|------|------|
| 1004 | `queryDate` 格式错误 | 使用 `FY26Q2W1` 形式。 |
| 2002 | 请求已过期 | 校时或使用当前毫秒时间戳。 |
| 2004 | 签名失败 | 检查 key 排序、空值排除、`appSecret`、小写 hex。 |
| 3001 | 频率限制 | 降低 QPS 或改用 batch。 |

---

## 9. 相关代码路径

| 路径 | 职责 |
|------|------|
| `server/services/mypalSign.js` | 签名 |
| `server/services/mypalClient.js` | HTTP POST、超时、业务 `code` 校验 |
| `server/services/mypalSyncService.js` | batch / weekly 同步与写库、WS |
| `server/services/mypalLink.js` | 邮箱规范化 |
| `server/services/assignmentProgress.js` | 进度与状态重算（与 assignments 共用） |
| `server/routes/mypal.js` | `POST /sync` |
| `server/routes/tasks.js` | `mypalTaskWeek` / `mypalProductName` 读写与下发校验 |

---

## 10. 测试环境联调基线（2026-04）

### 10.1 已确认的 MyPal 测试参数

> 以下信息用于 **测试环境** 联调，生产环境请使用独立凭证。

- `MYPAL_API_BASE`: `https://test.mymax.cn`
- 周次（`queryDate`）: `FY26Q3W3`
- 产品（`productName`）: `iPad Air`
- 联调样例 `seedId`: `xg1`（已完成）、`xg10`（未完成）

`appId` / `appSecret` 属于敏感配置，不写入仓库文档正文；请仅通过环境变量注入（见 §2）。

### 10.2 直连接口验证（不经过业务路由）

目的：先验证网络连通、签名、参数格式是否正确，再进入 `POST /api/v1/mypal/sync`。

在 `TOT_backend/server` 目录运行：

```bash
MYPAL_ENABLED=1 \
MYPAL_API_BASE="https://test.mymax.cn" \
MYPAL_APP_ID="<your_app_id>" \
MYPAL_APP_SECRET="<your_app_secret>" \
node -e "
const { getUserWeeklyStatus } = require('./services/mypalClient');
(async () => {
  for (const seed of ['xg1', 'xg10']) {
    try {
      const r = await getUserWeeklyStatus(seed, 'FY26Q3W3');
      console.log('OK', seed, r.data?.productName, r.data?.progress);
    } catch (e) {
      console.log('ERR', seed, e.code, e.mypalCode, e.mypalMessage || e.message);
    }
  }
})();
"
```

预期结果：

- `xg1` 返回 `progress=100`
- `xg10` 返回 `progress=0`

### 10.3 进入业务同步前的必要检查

调用 `POST /api/v1/mypal/sync` 前，至少确认：

1. `employees.email` 能与 MyPal `seedId` 对齐（当前同步按邮箱精确匹配）。
2. 目标任务已下发（`status='dispatched'`）且 `has_mypal=1`。
3. 任务已配置 `mypal_task_week`（如 `FY26Q3W3`）与建议配置 `mypal_product_name='iPad Air'`。
4. 优先用 `taskId + mode=batch` 做小范围验证，再放大全量同步。
