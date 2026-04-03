# 平台完成规则规格

**版本:** 1.2.0 | **PRD §6.3, §7**

---

## 四平台定义

| 平台 key | 展示名 | 完成方式 | DB 字段 |
|---------|--------|--------|---------|
| `mypal` | MyPAL | API 对接优先，不可用降级手动 | `mypal_completed` |
| `smartsell` | SmartSell | 手动标记 | `smartsell_completed` |
| `ai_demo` | AI Demo | 手动标记 | `ai_demo_completed` |
| `live_broadcast` | Live Broadcast | 手动标记 | `live_broadcast_completed` |

---

## MyPAL 完成规则

### 写入边界说明（PRD §3.2.1 changelog）

**MyPAL 服务端后台同步（API 对接路径）写入 `mypal_completed=1` 不依赖 Assignment 状态**——即使 assignment.status 仍为 `pending`，后台同步也可直接写入完成标记。

这与手动标记路径不同：
- **后台 API 同步（系统写入）:** 不检查 assignment.status，直接写入 `mypal_completed=1`
- **手动标记（用户操作）:** 需要 assignment.status === 'in_progress'（同其他手动平台）

### 优先路径（API 对接）

```
1. 服务端调用 MyPAL 外部接口查询用户学习完成状态
2. 查询超时阈值：3 秒
3. 查询成功且返回已完成 → 服务端写入 mypal_completed = 1
4. 前端：不显示手动标记按钮，展示"MyPAL 已完成（系统同步）"
```

### 降级路径（API 不可用）

```
1. MyPAL 接口调用失败或超时（>3s）
2. 系统自动降级：服务端标记本次请求使用手动路径
3. 前端：展示"标记 MyPAL 完成"手动按钮
4. 用户点击 → 服务端写入 mypal_completed = 1
5. 降级行为与其他手动平台完全一致
```

### MVP 实现建议

> MyPAL 外部 API 对接为 POC 阶段，**MVP 可直接以降级路径实现**（所有平台均手动标记），
> 后续替换 MyPAL 对接逻辑时，只需修改服务端此处判断，前端无需改动。

---

## 手动平台完成规则（SmartSell / AI Demo / Live Broadcast）

**完整业务流程:**

```
1. 用户点击"标记完成"
2. 前端调用 POST /api/assignments/:id/platforms/:platform/complete
3. 服务端校验：
   a. assignment.status === 'in_progress'
      → 否则 HTTP 400，errorCode: ASSIGN_002
   b. task.has_{platform} === 1（该平台已在任务中配置）
      → 否则 HTTP 400，errorCode: ASSIGN_003
   c. 幂等检查：该平台已完成（*_completed === 1）
      → 直接返回 200，不重复计算
4. 写入 assignment.*_completed = 1
5. 重算 progress（见下方公式）
6. 检查所有平台是否均已完成 → 若是，触发 in_progress → completed（见 02）
7. 返回更新后的 assignment
```

---

## 进度计算公式

```javascript
/**
 * 计算 assignment 的进度百分比
 * @param {object} assignment - task_assignments 记录
 * @param {object} task - tasks 记录（含 has_mypal / has_smartsell / has_ai_demo / has_live_broadcast）
 * @returns {number} 0-100 的整数
 */
function calculateProgress(assignment, task) {
  const platforms = ['mypal', 'smartsell', 'ai_demo', 'live_broadcast'];
  const platformHasMap = {
    'mypal':           task.has_mypal,
    'smartsell':       task.has_smartsell,
    'ai_demo':         task.has_ai_demo,
    'live_broadcast':  task.has_live_broadcast
  };
  const platformMap = {
    'mypal':           assignment.mypal_completed,
    'smartsell':       assignment.smartsell_completed,
    'ai_demo':         assignment.ai_demo_completed,
    'live_broadcast':  assignment.live_broadcast_completed
  };

  const configured = platforms.filter(p => platformHasMap[p] === 1);
  const total = configured.length;
  if (total === 0) return 0;

  const completedCount = configured.filter(p => platformMap[p] === 1).length;
  return Math.round((completedCount / total) * 100);
}
```

**示例:**

| task 配置列 | 已完成平台 | progress |
|------------|---------|---------|
| has_mypal=1, has_smartsell=1 | mypal=1, smartsell=0 | 50 |
| has_mypal=1, has_smartsell=1 | mypal=1, smartsell=1 | 100 |
| has_mypal=1, has_smartsell=1, has_ai_demo=1, has_live_broadcast=1 | mypal=1 | 25 |
| has_smartsell=1 | smartsell=1 | 100 |

---

## 平台完成 API

**端点:** `POST /api/assignments/:id/platforms/:platform/complete`

**路径参数:**
- `:id` — assignment.id
- `:platform` — `mypal` | `smartsell` | `ai_demo` | `live_broadcast`

**权限:** Assignment 归属用户（employee 本人）

**请求体:** 空 `{}`

**响应 200:**

```json
{
  "assignmentId": "assign_001",
  "platform": "smartsell",
  "mypalCompleted": false,
  "smartsellCompleted": true,
  "aiDemoCompleted": false,
  "liveBroadcastCompleted": false,
  "progress": 50,
  "status": "in_progress",
  "completedAt": null
}
```

**响应（所有平台完成时）:**

```json
{
  "assignmentId": "assign_001",
  "platform": "mypal",
  "mypalCompleted": true,
  "smartsellCompleted": true,
  "aiDemoCompleted": false,
  "liveBroadcastCompleted": false,
  "progress": 100,
  "status": "completed",
  "completedAt": "2026-03-24T15:00:00Z"
}
```

---

## 前端展示规则

**平台按钮状态:**

| 条件 | 展示 |
|------|------|
| assignment.status === 'pending' | 所有平台按钮禁用，提示"请先点击开始任务" |
| assignment.status === 'in_progress' && *_completed === 0 | 显示"标记完成"按钮（激活）|
| assignment.status === 'in_progress' && *_completed === 1 | 显示"✓ 已完成"（禁用）|
| assignment.status === 'completed' | 所有平台显示"✓ 已完成" |
| MyPAL 使用 API 对接且成功 | 不显示手动按钮，显示"已同步" |
| MyPAL 降级为手动 | 同其他手动平台 |

**进度条更新:** 每次标记平台完成后，前端即时更新进度条（用接口返回的 progress 值）。

---

## 任务完成判定规则

```javascript
// 服务端：检查 assignment 是否满足完成条件
function checkAllPlatformsDone(assignment, task) {
  const platforms = ['mypal', 'smartsell', 'ai_demo', 'live_broadcast'];
  const platformHasMap = {
    'mypal':           task.has_mypal,
    'smartsell':       task.has_smartsell,
    'ai_demo':         task.has_ai_demo,
    'live_broadcast':  task.has_live_broadcast
  };
  const platformMap = {
    'mypal':           assignment.mypal_completed,
    'smartsell':       assignment.smartsell_completed,
    'ai_demo':         assignment.ai_demo_completed,
    'live_broadcast':  assignment.live_broadcast_completed
  };
  return platforms
    .filter(p => platformHasMap[p] === 1)
    .every(p => platformMap[p] === 1);
}
```
