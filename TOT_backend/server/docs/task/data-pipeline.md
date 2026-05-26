# Agent 数据管道

> Tool → 数据源 → 联查表 → 输出字段的完整链路。新增 tool 时请同步更新。

---

## 涉及的数据表

### 核心业务表（MySQL）

| 表名 | 说明 | 关键字段 |
|------|------|----------|
| `task_publish` | 已发布任务 | `task_publish_id`, `task_title`, `publish_status`, `due_date`, `platform_scope`, `urgency_level` |
| `task_publish_learner` | 任务-学员关联 | `task_publish_id`, `learner_id` |
| `learner_account` | 学员档案 | `learner_id`, `email_id`, `sales_name`, `store_apple_id`, `rtm_level_3_name`, `rtm_level_4_name`, `reseller_localized_name`, `hq_reseller_localized_name` |
| `learner_task_reminder` | 催办/预警记录 | `task_publish_id`, `email_id`, `reminder_level`, `reminder_at`, `reminder_result` |
| `mypal_learning_progress_sync` | MyPal 学习进度同步 | `email_id`, `required_flag`, `passed_time` |
| `chat_session` | Chat 会话 | `id`, `user_id`, `title`, `last_active_at` |
| `chat_message` | Chat 消息 | `id`, `session_id`, `role`, `content_text`, `content_json` |
| `chat_message_feedback` | 消息反馈 | `message_id`, `user_id`, `feedback_type` |
| `user_memory` | 长期记忆（注意单数） | `id`, `user_id`, `memory_hash`, `content` |
| `account` | 后台账户 | `account_id`, `email_id`, `account_role`, `enabled_flag` |

### Agent Checkpoint 表

| 表名 | 说明 |
|------|------|
| `checkpoints` | LangGraph 状态快照（`thread_id`, `checkpoint_id`, `checkpoint` LONGBLOB） |
| `writes` | 待处理写入队列（`thread_id`, `task_id`, `channel`, `value`） |

---

## Tool 数据链路

### 1. `list_task_progress` — 批量任务进度

```
task_publish (publish_status = 'dispatched')
  └─→ queryEngine.getOverviewBoardData({ taskId })  ← 查 completion/learning 指标
      └─→ 返回 rows[]
```

- **platform 提取**: `JSON.parse(platform_scope \|\| '[]')[0]` — ⚠️ 字段存储格式不统一（JSON 数组 vs 纯字符串），部分任务 platform 为空
- **默认过滤**: 自动排除 `due_date < now` 的过期任务；传 `status: 'all'` 可解除
- **排序**: 默认 `created_at DESC`；支持 `deadline`/`completion_rate`/`priority`

### 2. `search_task` — 任务搜索

```
task_publish
  WHERE publish_status IN (...)
  ORDER BY created_at DESC LIMIT ? OFFSET ?
  └─→ JS 层 Array.filter 按 platform 过滤  ← ⚠️ 在 SQL 分页之后过滤，可能不满页
```

- 状态映射：`'active'` → `['dispatched']`, `'ended'` → `['ended']`, 默认 → `['dispatched', 'ended']`

### 3. `get_task_dashboard` — 单任务看板

```
task_publish (按 task_publish_id 或 task_title 模糊匹配)
  └─→ queryEngine.getOverviewBoardData({ taskId })
```

### 4. `query_metric` — 按维度查指标

```
executiveMetricsService.query(params, regionScope)
  └─→ 内部联查 learner_account + mypal_learning_progress_sync
  └─→ 输出 dimensions + metrics + rows
  └─→ 向后兼容: task_name / platform / priority (来自 result 字段)
```

### 5. `funnel_analysis` — 漏斗分析

```
queryEngine 漏斗计算 → 返回 stage 分布 + dropPercent/dropWidth
```

### 6. `query_trend` — 趋势查询

```
queryEngine 时间序列 → 按时间粒度返回指标变化
```

### 7. `fetch_alert_persons` — 预警人员名单

```
learner_task_reminder ltr
  JOIN learner_account la ON ltr.email_id = la.email_id
  WHERE ltr.task_publish_id = ? AND LOWER(ltr.reminder_level) = ?
  ORDER BY ltr.reminder_at DESC
  LIMIT ? OFFSET ?
```

- 使用 `chat_tools/shared/pagination.js` 分页辅助函数
- ⚠️ `LOWER(ltr.reminder_level)` 使该列索引失效

### 8. `fetch_incomplete_persons` — 未完成人员名单

```
task_publish_learner tpl
  JOIN learner_account la ON tpl.learner_id = la.learner_id
  INNER JOIN mypal_learning_progress_sync mps
    ON la.email_id = mps.email_id AND mps.required_flag = 1
  WHERE tpl.task_publish_id = ? AND mps.passed_time IS NULL
  ORDER BY la.sales_name
  LIMIT ? OFFSET ?
```

- 使用 `chat_tools/shared/pagination.js` 分页辅助函数
- **INNER JOIN 语义**: 只查 `required_flag=1` 且未通过的学员，mypal 无记录的学员不在此范围

### 9. `tool_ask_user` — HITL 澄清

不查数据库，通过 LangGraph `interrupt()` 挂起等待用户回复。

---

## Chat 历史链路

### 消息加载

```
chatService.loadFormattedHistory(sessionId)
  └─→ chatCrud.getMessages(sessionId, limit)  ← SQL LIMIT（默认 100）
      └─→ chat_message WHERE session_id = ? ORDER BY created_at ASC
      └─→ assistant 消息: compressAssistantContent() 截断
      └─→ historyToLangChainMessages() → LangChain 消息对象
```

### 记忆提取（异步）

```
persistAndEmit → BullMQ publish → bullMqWorker
  └─→ getMemoryModel() 提取 fact → INSERT INTO user_memory
```

---

## Session/Checkpoint 链路

```
sendMessageStreamLangGraph()
  └─→ inputState = { userMessage, sessionId, messages(历史), regionScope }
  └─→ app.invoke(inputState, { thread_id, sseEmitter, traceId })
      └─→ 每个节点执行后 MysqlSaver.put() 写 checkpoints 表
  └─→ finalState → persistAndEmit 写 chat_message 表
```
