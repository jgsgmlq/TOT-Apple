# Executive Chat 技术债

记录已知问题、根因尚未定位但暂时搁置的项。新增条目按时间倒序。

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
3. 复现 → 把 Console 完整输出收集起来再决定方向

**相关代码**
- [TOT_backend/server/services/chatService.js#L826-L841](../../TOT_backend/server/services/chatService.js) — abort 路径打标记 throw
- [TOT_backend/server/services/chatService.js#L1020-L1067](../../TOT_backend/server/services/chatService.js) — restoreOldMessage 实现
- [TOT_backend/server/middleware/errorHandler.js#L8-L18](../../TOT_backend/server/middleware/errorHandler.js) — `_sseResponseSent` 静默
- [TOT_frontend/src/views/executive/index.vue#L1255-L1330](../../TOT_frontend/src/views/executive/index.vue) — handleRegenerate

---

## 已知噪音 / 不致命

- ~~**Redis 未启动**~~：BullMQ producer/worker 已改为 lazy connect + 静默失败，不再每次请求吐三段 stack。本机可继续不开 Redis 工作（异步记忆任务被丢弃）
- ~~**user_memories INSERT 字段错误**~~：`bullMqWorker.js` 已修正为正确的 `(id, user_id, memory_hash, memory_type, content, confidence_score)` + `ON CONFLICT(user_id, memory_hash) DO UPDATE` 走稳健 Upsert
- ~~**DSML 流式闪现**~~：`fc_LlmToolCallStep` 已加 sliding-window 过滤，OPEN 标签出现就 hold 缓冲不 emit，CLOSE 后整段删除，前端不再看到乱码闪现
- **dashboard-agent scheduler 报错**：`generateDashboardAgentInsight is not a function`，每小时刷一次。实现没跟上重构。**不在 executive chat scope，未修**
- **Langfuse LangGraph 节点内 callback 降级**：`getLangfuseCallback = () => null`，子调用 trace 不上报到 langfuse（顶层 trace 由 tracer.js 接管）。是已知 trade-off，要修需先解决 langfuse-langchain 版本兼容
- **L2 `max_super_steps = 3` 是救场值**：如果 warning_query 这种意图频繁触发 step 3 才完成，说明它本质是 L3，应该改 complexity_score 或 intent → tier 映射，而不是把 L2 越调越大
