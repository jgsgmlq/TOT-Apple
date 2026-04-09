# 平台完成规则规格

**版本:** 1.3.0 | **PRD §6.3, §7** | **更新日期:** 2026-04-09

> **与实现对齐：** 进度与状态计算以 `TOT_backend/server/services/assignmentProgress.js` 为准；HTTP 以 `routes/assignments.js` 中 **`PUT /api/v1/assignments/:id/status`** 为准。状态迁移见 [`02-STATE-MACHINES.md`](./02-STATE-MACHINES.md)。

---

## 四平台定义

| 平台 key（请求体 `platform` 常用写法） | 展示名 | 完成方式 | DB 列（`task_assignments`） |
|----------------------------------------|--------|----------|----------------------------|
| `mypal` | MyPAL | API 对接优先，不可用降级手动 | `mypal_completed` |
| `smartsell` | SmartSell | 手动标记 | `smartsell_completed` |
| `ai_demo` / `ai demo` / `aidemo` | AI Demo | 手动标记 | `ai_demo_completed` |
| `live_broadcast` / `live broadcast` / `livebroadcast` | Live Broadcast | 手动标记 | `live_broadcast_completed` |

服务端将 `platform` 字符串规范化后映射到上表列（见 `mapPlatformToColumn`）；**任务是否包含某平台**由 `tasks.has_mypal` / `has_smartsell` / `has_ai_demo` / `has_live_broadcast` 决定。

---

## MyPAL 完成规则

### 写入边界说明（PRD §3.2.1 changelog）

**MyPAL 服务端后台同步（API 对接路径）写入 `mypal_completed=1` 可不依赖 Assignment 是否已 `in_progress`**——与 PRD「优先对接写入边界」一致。

与 **`PUT .../status` + `complete_platform`** 路径的区别：

- **后台同步 / MyPAL 专用接口写入：** 可按对接逻辑直接更新 `mypal_completed`（实现位置见 `mypalSyncService` 等），不必先 `start_task`。
- **学习端手动标记：** 通过 `complete_platform` 且 `platform` 指向 MyPAL 时，**当前路由实现**要求 `assignment.status === 'in_progress'`，否则 **409 `ASSIGN_013`**（与「先开始任务再逐平台完成」一致）。

### 优先路径（API 对接）

```
1. 服务端调用 MyPAL 外部接口查询用户学习完成状态
2. 查询超时阈值：3 秒（以实际配置为准）
3. 查询成功且返回已完成 → 服务端写入 mypal_completed = 1
4. 前端：不显示手动标记按钮，展示「MyPAL 已完成（系统同步）」
```

### 降级路径（API 不可用）

```
1. MyPAL 接口调用失败或超时（>3s）
2. 系统自动降级：服务端标记本次请求使用手动路径
3. 前端：展示「标记 MyPAL 完成」手动按钮
4. 用户点击 → 调用 PUT .../status，operationType=complete_platform，platform=mypal（须已 in_progress）
5. 降级行为与其他手动平台一致
```

### MVP 实现建议

> MyPAL 外部 API 对接为 POC 阶段，**MVP 可直接以降级路径实现**（各平台均走 `complete_platform` / `complete_task`），  
> 后续替换 MyPAL 对接逻辑时，只需修改服务端同步模块，**契约仍通过同一套 `*_completed` 列与进度函数**。

---

## 手动平台完成（SmartSell / AI Demo / Live Broadcast / 降级 MyPAL）

**接口：** `PUT /api/v1/assignments/:id/status`

**请求体（逐平台）：**

```json
{
  "operationType": "complete_platform",
  "platform": "smartsell"
}
```

`platform` 取值须能被映射到本节开头表中某一列；非法值 → **400 `ASSIGN_012`**。

**服务端校验（与 `assignments.js` 一致）：**

```
a. operationType === 'complete_platform' 且 platform 合法
b. assignment.status === 'in_progress'
   → 否则 HTTP 409，errorCode: ASSIGN_013（pending 下不可标记平台）
c. 该平台在任务中已配置（has_* === 1）
   → 否则 HTTP 400，errorCode: ASSIGN_015
d. 该平台当前未完成（*_completed === 0）
   → 若已为 1 → HTTP 409，errorCode: ASSIGN_016
e. 写入 assignment.*_completed = 1，调用 computeAssignmentProgressStatus 重算 progress、status、completed_at
```

**一键完成（可选路径）：** `operationType: "complete_task"` 一次性将所有已配置平台标为完成并将 `status` 置为 `completed`（详见 `02-STATE-MACHINES.md`）。

---

## 进度与状态计算（权威实现）

逻辑来自 `computeAssignmentProgressStatus(assignmentRow, task, nowIso)`：

1. **configuredColumns：** 按 `task.has_*` 为 1 收集 `mypal_completed` / `smartsell_completed` / `ai_demo_completed` / `live_broadcast_completed`。
2. **progress：** `Math.round((completedCount / totalConfigured) * 100)`；无配置平台时为 0。
3. **nextStatus：**
   - `completedCount === totalConfigured` → `completed`，并置 `completed_at = nowIso`；
   - `completedCount > 0` 且未完成全部 → `in_progress`；
   - `completedCount === 0` → **保持原 `assignment.status`**（避免未点「开始」却变成 `in_progress` 的跳跃；但若从路由上在 `pending` 调用 `complete_platform` 会先被 ASSIGN_013 拒绝）。

```javascript
// 语义摘要（以仓库源码为准）
function computeAssignmentProgressStatus(assignmentRow, task, nowIso) {
  const configuredColumns = getConfiguredPlatformColumns(task);
  const totalConfigured = configuredColumns.length;
  const completedCount = configuredColumns.reduce(
    (acc, col) => acc + (assignmentRow[col] === 1 ? 1 : 0),
    0
  );
  const progress =
    totalConfigured === 0 ? 0 : Math.round((completedCount / totalConfigured) * 100);

  let nextStatus;
  if (completedCount === totalConfigured) {
    nextStatus = 'completed';
  } else if (completedCount > 0) {
    nextStatus = 'in_progress';
  } else {
    nextStatus = assignmentRow.status;
  }

  const completedAt = nextStatus === 'completed' ? nowIso : null;
  return { progress, nextStatus, completedAt, completedCount, totalConfigured };
}
```

**示例:**

| task 配置 | 已完成列 | progress | nextStatus（在写入后） |
|-----------|----------|----------|-------------------------|
| has_mypal=1, has_smartsell=1 | mypal=1, smartsell=0 | 50 | in_progress |
| has_mypal=1, has_smartsell=1 | 全 1 | 100 | completed |
| has_mypal=1, has_smartsell=1, has_ai_demo=1, has_live_broadcast=1 | 仅 mypal=1 | 25 | in_progress |

---

## HTTP 契约摘要（详见 `04-API-SPEC.md`）

| 项目 | 说明 |
|------|------|
| 端点 | `PUT /api/v1/assignments/:id/status` |
| 权限 | 归属学习端用户；`central`/`admin` 在实现中也可操作（见路由 `requireAssignmentActor`） |
| 成功响应 | `data` 含 `assignmentId`、`status`、`progress`、`platformStatus`（各 `*Completed` 布尔）、`completedAt` 等 |

完整字段与错误码见 **`04-API-SPEC.md`** 中 Assignment 状态机一节。

---

## 前端展示规则（建议）

**平台按钮状态:**

| 条件 | 展示 |
|------|------|
| assignment.status === 'pending' | 应先引导「开始任务」；直接调 `complete_platform` 会得到 **409 ASSIGN_013** |
| assignment.status === 'in_progress' && 某平台 *_completed === 0 | 显示「标记完成」（触发 `complete_platform`） |
| assignment.status === 'in_progress' && 某平台已完成 | 显示「✓ 已完成」 |
| assignment.status === 'completed' | 各平台均已完成 |
| MyPAL 使用 API 对接且成功 | 不显示手动按钮，显示「已同步」 |
| MyPAL 降级为手动 | 同其他手动平台 |

**进度条：** 以接口返回的 `progress`（0–100）为准。

---

## 任务完成判定（逻辑等价）

当且仅当「任务配置中出现的每个平台」在 Assignment 上对应 `*_completed === 1` 时，`computeAssignmentProgressStatus` 给出 `nextStatus === 'completed'`。

```javascript
function checkAllPlatformsDone(assignment, task) {
  const platforms = ['mypal', 'smartsell', 'ai_demo', 'live_broadcast'];
  const platformHasMap = {
    mypal: task.has_mypal,
    smartsell: task.has_smartsell,
    ai_demo: task.has_ai_demo,
    live_broadcast: task.has_live_broadcast,
  };
  const platformMap = {
    mypal: assignment.mypal_completed,
    smartsell: assignment.smartsell_completed,
    ai_demo: assignment.ai_demo_completed,
    live_broadcast: assignment.live_broadcast_completed,
  };
  return platforms
    .filter((p) => platformHasMap[p] === 1)
    .every((p) => platformMap[p] === 1);
}
```

（实现中直接使用列名数组与 `=== 1` 判断，与此等价。）
