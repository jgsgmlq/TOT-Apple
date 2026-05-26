# Executive Chat 技术债

记录已知问题、根因尚未定位但暂时搁置的项。新增条目按时间倒序。

> 配置参数、数据链路图表、设计决策等业务资产见 [`docs/task/`](../task/)：
> - [config-reference.md](../task/config-reference.md) — 环境变量、模型参数、Prompt 版本
> - [data-pipeline.md](../task/data-pipeline.md) — Tool↔SQL表映射、JOIN 关系
> - [open-questions.md](../task/open-questions.md) — 待澄清问题、设计决策

---

## 2026-05-22 — platform_scope 存储格式不一致

**症状**
- Agent 返回任务列表时，部分任务显示平台（如 "MyPal"），部分显示为空
- 用户问"有的任务有平台标注，有的没有"

**根因**
- MySQL `task_publish.platform_scope` 列存储格式不统一：
  - `'["MyPal"]'` — JSON 数组字符串（可被 `JSON.parse` 正常解析）
  - `'mypal'` — 纯字符串（`JSON.parse` 抛异常，被 catch 吞掉返回 null）
- 涉及文件：`tool_list_task_progress.js:47`、`tool_search_task.js:44`

**未修原因**
- 优先处理更紧急的 issue，暂不修
- 修复方向：工具层加兼容（解析失败时用原始字符串）+ 数据层统一格式

---

## 2026-05-22 — Agent Code Review 发现并修复的问题汇总

**CRITICAL（已全部修复）**

- ~~**C1 `tool_fetch_incomplete_persons.js` LEFT JOIN 退化**~~：`WHERE mps.passed_time IS NULL` 语义正确，但 LEFT JOIN → INNER JOIN 更清晰。
- ~~**C2 `tool_query_metric.js` 响应结构 Breaking Change**~~：恢复 `task_name`/`platform`/`priority` 向后兼容字段。
- ~~**C3 `schema.sql` 表名 `user_memories` vs `user_memory`**~~：对齐到 MySQL 实际表名 `user_memory`。
- ~~**C4 `active` → `dispatched` 状态映射**~~：确认 `publish_status` CHECK 约束只有 `draft`/`dispatched`，旧代码用 `active` 才是 bug。

**HIGH（已全部修复）**

- ~~**H1 tool SQL 样板重复**~~：提取 `chat_tools/shared/pagination.js` 分页辅助函数。
- ~~**H2 COL_NAME_MAP 缺少维护说明**~~：添加注释 + `rawRows[0]` 空值防护。
- ~~**H3 llm.js 配置重复**~~：提取 `baseConfig`，工厂函数改为单例。
- ~~**H4 MysqlSaver 每次请求执行 DDL**~~：静态 `ensureTables()` 在 app.js 启动时执行一次。
- ~~**H5 chatCrud.getMessages() 无 SQL LIMIT**~~：SQL 层添加 LIMIT 参数。

**遗留（未修）**

- **`tool_fetch_alert_persons.js` `LOWER(ltr.reminder_level)` 使索引失效**：数据入库时统一小写存储可解，暂不改。
- **`tool_search_task.js` platform 过滤在 JS 层而非 SQL 层**：分页可能不满，排序被破坏。涉及前后端联动，暂缓。
- **`MysqlSaver._getRow` 子查询换 JOIN**：`list()` 大量调用时性能差，当前数据量小无影响。

---

## 2026-05-22 — 旧 Dashboard Agent 系统已清理

**删除内容**
- `agent/dashboard/` — 旧 PoC Agent 框架（641 行）
- `services/dashboardAgentService.js` + `modules/dashboard/services/dashboardAgentService.js` — 重复服务
- `modules/dashboard/services/analyzers/` + `services/dashboardSubAgents/` — 旧分析器（重复 2 套）
- `modules/dashboard/routes/agentRoutes.js` + `routes/dashboardAgent.js` — 路由
- `jobs/dashboardAgentScheduler.js` — 定时调度器
- 根目录散落文件：`append_funnel_modal.js`、`update_funnel.js`、`old_index.vue` 等 10+ 个
- `scripts/test-*` 损坏脚本 2 个（引用了已删除的 `chatAgentRunner`）

**影响**
- `GET /api/v1/dashboard/agent/diagnose` 接口已移除
- Chat 对话（`/api/v1/chat/`）不受影响，eChat Agent 完整保留

---

## 2026-05-01 — Regenerate 请求被神秘 abort

**症状**
- 用户点 AI 回复内的"重新生成"按钮
- POST `/api/v1/chat/executive/sessions/:sid/messages/:mid/regenerate` 发出
- 后端在收到请求后 4-6ms 内 `req.on('close')` 触发，整条请求被识别为 client abort
- 前端 UI 卡住（按钮转圈不停），最终用户感知"重新生成无效"

**已确认**
- 不是 LangGraph 问题：abort 发生在进入 graph 之前
- 不是 vite proxy 配置问题：同一个 proxy 下 `handleSend` 普通 chat 工作正常
- 不是 server 端 thread_id 复用：那个问题已修
- **handleStop 曾是元凶之一**：上一轮 stack trace 抓到 `handleStop → naive-ui handleClick2 → HTMLButtonElement invoker`，意味着 stop 按钮被同一个 click 事件触发。已通过让 `handleRegenerate` 不暴露 controller 给全局 ref `abortController.value` 来修
- **修后仍复现**：handler 已彻底隔离，但后端依然在 4-6ms 内收到 close
- 后端兜底已就位：abort 路径会调 `restoreOldMessage` 恢复被删的 assistant 消息（日志 `regenerate_old_message_restored`），且打 `_sseResponseSent` 标记避免 errorHandler 二次写响应。所以**数据不会丢**，只是 UI 不刷新

**未确认（需要下次定位）**
- 前端 `regenAbort` 是否仍被某段 JS 触发（用户 console 一直没贴出 `[regen]` 输出，无法判别）
- 还是浏览器 fetch / vite dev proxy 在某种 race 下主动关 socket
- 三个分支决定后续动作完全不同：

  | Console 输出 | 含义 | 下一步 |
  |---|---|---|
  | `regenAbort.abort() called` + stack | 前端某段 JS 主动 abort，stack 能定位 | 看 stack 修源头 |
  | 只有 `AbortSignal fired` | 不是主动 abort，是 fetch 内部触发 | 怀疑 vue reactivity proxy 包了 signal，或 Alova 拦截器 |
  | 完全没 `[regen]` 输出 | 前端 controller 没动，server close 是网络层 | 绕开 vite proxy 直连后端测；hook fetch 本身 |

**当前缓解**
- 后端 `restoreOldMessage` 兜底，旧消息不丢
- abort 路径现在会发 `event: error` 再 `res.end()`（之前是空 200），前端 `streamSsePostJson.onError` 能触发，`handleRegenerate.catch` 会 toast 失败 + 解锁 `isRegenerating`，UI 不再卡转圈
- `handleStop` 加守卫：任何消息处于 `isRegenerating` 状态时 stop 是 no-op，杜绝 v-else 切换瞬间事件冒泡误触发 abort
- `handleRegenerate.finally` 用 messageId 重新定位消息（不靠原始 index），中间被 buildClarifyMessage 替换也能正确清 `isRegenerating`
- 用户体验：点"重新生成"如果 abort 还出现，至少会 toast + 解锁，能再次重试，不再永久卡死

**复测最小步骤**
1. 硬刷页面（cmd+shift+R）
2. 在 [executive/index.vue handleRegenerate](../../TOT_frontend/src/views/executive/index.vue) 顶部加诊断（参考 git history 这个 session 的诊断日志改动）：
   - `console.warn('[regen] handler entered')`
   - `regenAbort.signal.addEventListener('abort', () => console.warn(... stack))`
   - wrap `regenAbort.abort = (r) => { console.warn(... stack); orig(r) }`
3. 复现 → 把 Console 输出完整收集起来再决定方向

**相关代码**
- [TOT_backend/server/services/chatService.js#L826-L841](../../TOT_backend/server/services/chatService.js) — abort 路径打标记 throw
- [TOT_backend/server/services/chatService.js#L1020-L1067](../../TOT_backend/server/services/chatService.js) — restoreOldMessage 实现
- [TOT_backend/server/middleware/errorHandler.js#L8-L18](../../TOT_backend/server/middleware/errorHandler.js) — `_sseResponseSent` 静默
- [TOT_frontend/src/views/executive/index.vue#L1255-L1330](../../TOT_frontend/src/views/executive/index.vue) — handleRegenerate

---

## 2026-05-24 — `org_slang_mappings` 黑话映射表待创建

**背景**
- Entity Resolution System (`docs/superpowers/specs/2026-05-24-entity-resolution-system-design.md`) 设计了 `searchOrg()` 的四层匹配算法
- Layer 1（黑话映射）代码已写好，表不存在时静默跳过，降级到 Layer 2（reseller_store 直接搜索）

**待创建的表**
```sql
CREATE TABLE IF NOT EXISTS org_slang_mappings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  org_type VARCHAR(20) NOT NULL,        -- 'dealer' | 'store' | 'region' | 'l3' | 'l4'
  alias VARCHAR(200) NOT NULL,          -- 用户可能说的黑话/简称
  canonical_name VARCHAR(200) NOT NULL, -- 正式名称
  priority INT DEFAULT 0,
  created_by VARCHAR(100) DEFAULT 'system',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_alias_type (org_type, alias)
);
```

**未建原因**
- CLAUDE.md 禁止 CREATE TABLE
- 当前无已知黑话匹配问题，Layer 2（直接搜索 reseller_store）已够用
- 由运维在有实际需求时手动执行 DDL

**触发条件**
- 用户/运营反馈："搜 XX 经销商搜不到" → INSERT 一条 alias 即可，不改代码不重启

---

## 已知噪音 / 不致命

- ~~**Redis 未启动**~~：BullMQ producer/worker 已改为 lazy connect + 静默失败，不再每次请求吐三段 stack。本机可继续不开 Redis 工作（异步记忆任务被丢弃）
- ~~**user_memories INSERT 字段错误**~~：`bullMqWorker.js` 已修正为正确的 `(id, user_id, memory_hash, memory_type, content, confidence_score)` + `ON CONFLICT(user_id, memory_hash) DO UPDATE` 走稳健 Upsert
- ~~**DSML 流式闪现**~~：`fc_LlmToolCallStep` 已加 sliding-window 过滤，OPEN 标签出现就 hold 缓冲不 emit，CLOSE 后整段删除，前端不再看到乱码闪现
- ~~**dashboard-agent scheduler 报错**~~：已整体删除旧的 Dashboard Agent 系统（`agent/dashboard/`、scheduler、analyzers 等）
- **Langfuse LangGraph 节点内 callback 降级**：`getLangfuseCallback = () => null`，子调用 trace 不上报到 langfuse（顶层 trace 由 tracer.js 接管）。是已知 trade-off，要修需先解决 langfuse-langchain 版本兼容
- **L2 `max_super_steps = 3` 是救场值**：如果 warning_query 这种意图频繁触发 step 3 才完成，说明它本质是 L3，应该改 complexity_score 或 intent → tier 映射，而不是把 L2 越调越大

## 长期记忆表结构适配 (2026-05-23)

`user_memory` 表目前只有一个 `memory_type VARCHAR` 字段，三种记忆类型（user/feedback/project）共用此字段。后续需要：
1. 评估是否需要独立的类型枚举或关联表
2. 记忆去重策略优化（当前 SHA256(content) 对相似语义不敏感）
3. 记忆过期/衰减策略

---

## getOverviewBoardData onTimeCompletionRate / avgCompletionTimeHours 临时填 0 (2026-05-23)

SQL 聚合路径 (`getTaskOverviewStats`) 无法精确计算 `onTimeCompletionRate` 和 `avgCompletionTimeHours`（MPS 是 task_week 级别，不是 task 级别，子查询内无法 JOIN task_publish 取 start_date/due_date）。后续可加针对性 SQL 只对 completed 学员算耗时。

- 影响：`/dashboard/overview` API 返回这两个字段为 0
- 不影响：`list_task_progress` 等工具输出（不使用这两个字段）

---

## 2026-05-23 — 远端 Redis 版本过低，BullMQ Worker 无法启动

**症状**
- `app.js` 启动 MemoryWorker 时报错：`Redis version needs to be greater or equal than 5.0.0 Current: 3.2.12`
- Worker 启动失败（非致命降级），`publishMemoryIngestion` 中事件被静默丢弃
- 日志：`[Queue Producer] publish failed`

**影响范围**
- **不影响**：短期对话上下文（conversation 走 MySQL chat_message）
- **不影响**：长期记忆检索（getMemories 走 MySQL user_memory）
- **不影响**：safetyGateway / finalResponse 的上下文注入
- **影响**：长期记忆 LLM 提取完全不可用（事件无法入队，Worker 不消费）

**未修原因**
- Redis 为远端服务器（通过 dotenvx 加密 .env 中的 REDIS_URL 指向），需运维配合升级
- 短期上下文功能不受影响，长期记忆提取可降级运行

**修复方向**
1. 升级远端 Redis 至 5.0+
2. 备选：部署本地 Redis 5.0+ 替代远端实例
3. 紧急情况可回退到旧 `chatMemoryService.extract()` 作为 fallback（已从 chatService 中移除，模块仍保留）
