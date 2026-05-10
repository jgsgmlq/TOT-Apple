# Executive Chat — P0 修复方案

> 与 `EXECUTIVE-CHAT-AGENT-ENGINEERING-BRIEF.md` 并排存放。后者描述当前架构事实，本文聚焦**上线前必须修掉的三件事**。

---

## Context（为什么要做这件事）

近期对 Executive Chat（LangGraph 路径）做了一轮代码核查，发现三处影响**生产可用性**的缺陷：

1. **HITL resume 端到端是坏的**——`sendMessageStreamLangGraph` 与 `resumeMessageStreamLangGraph` 使用**不同形态的 `thread_id`**，且前端拿不到 `thread_id`，因此 LangGraph Checkpointer 在 resume 时一定查不到 send 时写入的 checkpoint。
2. **节点级可观测性缺失**——`getLangfuseCallback` 恒为 `null`，Router/FC LLM 两个最重要节点没有 generation 级 trace。生产事故只能靠日志 grep 定位。
3. **`regionScope` 护栏不强制**——`chatToolsService.loadTools` 把 `scopePolicy` 默认成 `'any'`，意味着新增工具忘记声明就**静默放行 = 越权返全量**。

修完后达到的状态：

- HITL clarify → resume 真正闭环。
- Router 与 FC LLM 调用在 Langfuse 上有完整 generation span。
- 任何新增 tool 必须显式声明 `scopePolicy`，否则进程启动直接抛错。

> 同时核查中确认 `fc_ValidateParams` 已是从 schema 反射的完整实现（之前评估"部分"是误判），本次不动；Postgres Checkpointer / 上下文 trim / cache TTL 等列入 P1，**不在本次范围**。

---

## 范围与优先级

| 修复 | 优先级 | 估时 | 关联文件 |
|---|---|---|---|
| F1 `thread_id` 一致性 | P0 必须 | 0.5 天 | `chatService.js`、`routes/chat.js`、前端 SSE handler |
| F2 Router / FC LLM generation 打点 | P0 必须 | 0.5 天 | `nodes.js`、`utils/tracer.js`（已有 helper） |
| F3 `scopePolicy` 强制声明 | P0 必须 | 0.5 天 | `chatToolsService.js`、`server/chat_tools/*.js` |
| F4 Session dedup 缓存新鲜度 | P0 必须 | 0.25 天 | `chatSessionStateService.js`、`toolCallUtils.js` |
| 端到端验证脚本 | 必含 | 0.5 天 | `scripts/evaluate_langgraph.js` 或新增 |

---

## F1 — `thread_id` 一致性（最关键）

### 现状

| 路径 | 文件:行 | `thread_id` |
|---|---|---|
| send | [`server/services/chatService.js:737-749`](../../server/services/chatService.js#L737-L749) | `${sessionId}:${nanoid()}` |
| resume | [`server/services/chatService.js:551-558`](../../server/services/chatService.js#L551-L558) | `sessionId`（裸） |

`chat_sessions` / `chat_messages` 表都不存 `thread_id`；前端通过 `buildClarifySsePayload` 收到的 `data.resumeToken` 是 `interrupt_payload.resume_token`（业务 token，不是 thread_id）。Resume 请求体只有 `{ resumePayload, stream }`，没有 thread_id。

→ Checkpointer 必查不到。

### 决策

**方案 A：把 thread_id 塞进 SSE clarify payload，前端 resume 时回传 body。** 不动表结构，最小改动。

### 改动

**1）`chatService.sendMessageStreamLangGraph`**（`server/services/chatService.js:737`）

把 `thread_id` 提到 `app.invoke()` 之前生成，并在拦截到 interrupt 时把它放进给前端的 SSE 中：

```js
// 改前
const thread = {
  configurable: {
    thread_id: `${sessionId}:${nanoid()}`,
    sseEmitter,
    traceId: trace ? trace.id : undefined
  },
  signal: abortController.signal
};
const finalState = await app.invoke(inputState, thread);

const interruptPayload = extractLangGraphInterrupt(finalState);
if (interruptPayload) {
  // ...
  wrappedSend('clarify', buildClarifySsePayload(interruptPayload, req.requestId));
  // ...
}

// 改后
const threadId = `${sessionId}:${nanoid()}`;
const thread = {
  configurable: { thread_id: threadId, sseEmitter, traceId: trace ? trace.id : undefined },
  signal: abortController.signal
};
const finalState = await app.invoke(inputState, thread);

const interruptPayload = extractLangGraphInterrupt(finalState);
if (interruptPayload) {
  wrappedSend('clarify', buildClarifySsePayload(interruptPayload, req.requestId, { threadId }));
  wrappedSend('done', buildInterruptedDonePayload(interruptPayload, sessionId, req.requestId, responseTime, timestamp, { threadId }));
  // ...
}
```

**2）`buildClarifySsePayload` / `buildInterruptedDonePayload`**

在两个 helper 的签名末尾加一个可选 `extra = {}`，把 `threadId` 平铺到 `data`：

```js
function buildClarifySsePayload(interruptPayload, requestId, extra = {}) {
  // ...原逻辑...
  return {
    code: 202,
    message: prompt,
    data: {
      ...payload,
      prompt,
      resumeToken: payload.resume_token || payload.resumeToken || null,
      threadId: extra.threadId || null,   // ← 新增
      payload,
    },
    requestId,
  };
}
```

`buildInterruptedDonePayload` 同步加 `data.threadId`。

**3）`server/routes/chat.js` resume 路由**

接收 `threadId`：

```js
const { resumePayload, stream, threadId } = req.body;
if (!threadId) {
  throw createError(400, 'threadId 不能为空（HITL 续接必需）', 'CHAT_010');
}
await chatService.resumeMessageStreamLangGraph(sessionId, resumePayload, threadId, req.user.id, req, res);
```

**4）`chatService.resumeMessageStreamLangGraph`**（`server/services/chatService.js:551`）

签名加 `threadId`，把第 553 行的 `thread_id: sessionId` 替换为传入的 `threadId`：

```js
// 改前
async function resumeMessageStreamLangGraph(sessionId, resumePayload, userId, req, res) {
  // ...
  const thread = { configurable: { thread_id: sessionId, sseEmitter, traceId: ... } };

// 改后
async function resumeMessageStreamLangGraph(sessionId, resumePayload, threadId, userId, req, res) {
  // ...
  if (!threadId || !threadId.startsWith(`${sessionId}:`)) {
    throw createError(400, 'threadId 与 sessionId 不匹配', 'CHAT_011');
  }
  const thread = { configurable: { thread_id: threadId, sseEmitter, traceId: ... } };
```

> **不变量校验**　`threadId.startsWith(${sessionId}:)` 防止跨会话 resume，等同最低限度的会话归属校验。

**5）前端**　`stream: true` 收到 `event: clarify` 后保留 `data.threadId`，调 `/resume` 时塞进 body。

### 兼容性

- 老前端不传 `threadId` 直接 400 失败——这是**预期行为**：HITL 现在就是坏的，没有"老链路要兼容"一说。
- 普通发消息路径（不撞 HITL）零影响。
- 若 LangGraph 某天换 thread 命名策略，只需改 `chatService` 一处。

---

## F2 — Router / FC LLM 的 generation 打点

### 现状

- [`server/agent/graph/nodes.js:9-11`](../../server/agent/graph/nodes.js#L9-L11) 的 `getLangfuseCallback = () => null` 是**死代码**（grep 全项目无调用方）。
- [`server/utils/tracer.js`](../../server/utils/tracer.js) 里已经有现成的 `endGeneration(gen, opts)` helper，且 `createAgentTrace` 返回的 trace 对象支持 `.generation({...})`。
- 根 trace 已建立，缺的只是两处 LLM 调用周边的 span。

### 决策

**Path C — 不重新引入 `langfuse-langchain`，直接在两个节点手动调 `trace.generation` + `endGeneration`。**

### 改动

**1）`contextAnalyzerRouter`**（`server/agent/graph/nodes.js:174`）

`config.configurable.traceId` 已经被 send 路径注入。需要拿到 trace 对象：

- 由 `chatService` 透传 `trace` 实例进 configurable（推荐，一行：`configurable: { ..., trace }`），
- 或在节点里通过 `getClient()` + `traceId` 重建 generation handle（取决于 langfuse SDK 是否支持，需在落地时验）。

打点位置（伪代码）：

```js
const gen = trace?.generation?.({
  name: 'Router_Intent_Classification',
  model: 'deepseek-chat',
  input: maskPII(state.userMessage),
  metadata: { promptHash: promptHash(schemaDefinition) }
});
const res = await getRouterModel().invoke(messages, invokeConfig);
endGeneration(gen, {
  output: rawJson,
  usage: res.usage_metadata || res.usage,
  model: 'deepseek-chat'
});
```

**2）`fc_LlmToolCallStep`**（`server/agent/graph/nodes.js:328` 附近）

由于是 `.stream()`，要在 stream 结束后聚合 token / tool_calls 再 `endGeneration`：

```js
const gen = trace?.generation?.({
  name: 'FC_LLM_Tool_Decision',
  model: 'deepseek-chat',
  input: preview(systemPrompt + userTail),
  metadata: { step: state.fc_super_step_count, tier: state.selected_tier }
});

let fullContent = '';
let aggregatedToolCalls = [];
for await (const chunk of llm.stream(messagesToSend, { signal: mergedSignal })) {
  // 原有 SSE 逻辑
  fullContent += chunk.content || '';
  if (chunk.tool_call_chunks) aggregatedToolCalls = mergeToolCallChunks(aggregatedToolCalls, chunk.tool_call_chunks);
}

endGeneration(gen, {
  output: preview(fullContent),
  usage: aggregateUsage,
  model: 'deepseek-chat',
  metadata: { toolCallCount: aggregatedToolCalls.length }
});
```

> 注意只在 stream 自然结束时调 `endGeneration`，**不要**在 abort/error 路径漏掉——`tracer.endGeneration` 已经有异常吞掉的兜底，但要传 `level: 'WARNING' | 'ERROR'` 才能在 Langfuse 上区分。

**3）删除 dead code**

`nodes.js:9-11` 的 `getLangfuseCallback = () => null` 直接删掉，避���未来误用。

### 影响面

- 节点输入/输出会写入 Langfuse，需确保 `tracer.maskPII` 已开启。
- `chatService` 注入 `trace` 进 configurable 的改动会在所有 LangGraph 调用点（send / resume / regenerate）都需要做一次。

---

## F3 — `scopePolicy` 强制声明

### 现状

[`server/services/chatToolsService.js:48`](../../server/services/chatToolsService.js#L48)：

```js
scopePolicy: meta.scopePolicy || 'any',  // 'any', 'national_only'
```

→ 新增 tool 不写 `scopePolicy` 默认 `'any'`，`authorizeToolCall` 不会拦它，handler 自己决定要不要 filter `regionScope`。新人写 tool 容易越权。

### 决策

**去掉 `'any'` 默认值；module load 阶段缺失即抛错。同时新增 `'regional_scoped'` 档位，由 `executeByName` 入口校验 `regionScope` 结构。**

### 改动

**1）`chatToolsService.loadTools`**

```js
// 改前
scopePolicy: meta.scopePolicy || 'any',

// 改后
const VALID_SCOPE_POLICIES = ['national_only', 'regional_scoped', 'public'];
if (!meta.scopePolicy || !VALID_SCOPE_POLICIES.includes(meta.scopePolicy)) {
  throw new Error(
    `[chatToolsService] tool '${toolName}' (${file}) must declare meta.scopePolicy ` +
    `as one of: ${VALID_SCOPE_POLICIES.join(', ')}. Got: ${meta.scopePolicy}`
  );
}
```

**2）`authorizeToolCall`**

补 `regional_scoped` 分支：必须有 `regionScope.regions` 或 `regionScope.rtm` 非空���否则拒绝。`public` 不校验，仅供少量"全局元信息"工具用。

**3）逐个 `server/chat_tools/tool_*.js` 补 `meta.scopePolicy`**

按当前各 tool 的语义分类（语义层映射，落地前请人工确认每行）：

| tool | 建议 scopePolicy | 理由 |
|---|---|---|
| `tool_queryExecutiveMetrics.js` | `regional_scoped` | 必须在 regions 内查询 |
| `tool_getProgressMetrics.js` (`getOverviewData`) | `regional_scoped` | 同上 |
| `tool_getProjectStatus.js` (`getTaskListData`) | `regional_scoped` | 同上 |
| `tool_getWarnings.js` (`getWarningsData`) | `regional_scoped` | 同上 |
| `tool_getRegionDetailData.js` | `regional_scoped` | 必填大区 |
| `tool_getDrillDownMetrics.js` (`getStoreDetailData`) | `regional_scoped` | 门店粒度 |
| `tool_runAnalytics.js` | `regional_scoped` | 走业务表 |
| `tool_fetchRawDataset.js` | `regional_scoped` | 拉底层数据集，最敏感 |
| `tool_executeCode.js` | `national_only` 或 `regional_scoped`（看产品） | 代码解释器，建议先收紧 |

**4）handler 层校验仍保留**　硬护栏在 service 入口加，但 handler 内部依然自行 filter——双层保险。

### 兼容性

- 改动是破坏性的：现有所有 `tool_*.js` 必须补 `scopePolicy`，否则**进程启动失败**。这就是想要的效果。
- 启动失败 = CI 红灯 = 部署回退，不会有"线上跑着跑着越权"。

---

## F4 — Session dedup 缓存新鲜度

### 现状

[`server/services/chatSessionStateService.js:6`](../../server/services/chatSessionStateService.js#L6)：

```js
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes
```

- `getLatestBySignature` 在读取前会调 `cleanupExpiredForSession`（见 [L182-L199](../../server/services/chatSessionStateService.js#L182-L199)），超过 TTL 的记录会被清掉——所以"永久脏数据"不会出现。
- `ensureSession` 会按 `buildScopeFingerprint` 对比 scope 指纹，跨 scope 污染已经被防住。
- 签名 [`buildToolSignature(name, args, scopeFingerprint)`](../../server/agent/graph/toolCallUtils.js) 不含时间维度。
- TTL 默认 30 分钟，可通过 `CHAT_SESSION_STATE_TTL_MS` 环境变量覆盖。

**现在实际的 bug 只���一句话**：30 分钟对高管看实时指标**太长**，"上午 9 点问完成率、9 点 20 再问一遍"会命中同一条缓存——用户看到的数据已经晚了 20 分钟。**关键在于这段时间里没有任何新鲜度信号**。

> 判断 P0 vs P1 的分界线：如果产品可接受"同 session、同问题、30 分钟内返回同答案"，F4 可延后；如果**不能**接受，则必修。本轮按「不能接受」处理。

### 决策

双保险：**默认 TTL 从 30 分钟下调到 60 秒**（环境变量继续支持覆盖），同时**签名加自然分钟时间桶**，让跨 1 分钟的同问题自动失效。

两招叠加的好处：
- TTL 控制兜底（超过 60s 自动清理）；
- 签名时间桶控制"意图粒度"（1 分钟内还是去重，避免短时间内 LLM 反复打 DB）。

### 改动

**1）TTL 默认值下调**　[`chatSessionStateService.js:6`](../../server/services/chatSessionStateService.js#L6)：

```js
// 改前
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

// 改后
const DEFAULT_TTL_MS = 60 * 1000; // 60 seconds
// 保留 CHAT_SESSION_STATE_TTL_MS 环境变量覆盖能力（constructor 已支持）。
// 若产品侧对某些 intent 希望更长缓存（静态数据），在 tool meta 里声明 freshness，
// 进一步由 signature 时间桶粒度控制（见改动 2）。
```

**2）签名加时间桶**　改 [`server/agent/graph/toolCallUtils.js` 的 `buildToolSignature`](../../server/agent/graph/toolCallUtils.js#L59-L67)：

```js
// 改前
function buildToolSignature(toolName, args, scopeFingerprint) {
  const parsed = typeof args === 'string' ? (safeParseJson(args) ?? args) : args;
  const canonical = canonicalizeArgs(parsed);
  const argsStr = typeof canonical === 'object' ? JSON.stringify(canonical) : String(canonical);
  return crypto
    .createHash('md5')
    .update(`${toolName}|${argsStr}|${scopeFingerprint || ''}`)
    .digest('hex');
}

// 改后
const DEDUP_BUCKET_MS = Number(process.env.CHAT_DEDUP_BUCKET_MS || 60_000);
function buildToolSignature(toolName, args, scopeFingerprint, nowMs = Date.now()) {
  const parsed = typeof args === 'string' ? (safeParseJson(args) ?? args) : args;
  const canonical = canonicalizeArgs(parsed);
  const argsStr = typeof canonical === 'object' ? JSON.stringify(canonical) : String(canonical);
  const bucket = Math.floor(nowMs / DEDUP_BUCKET_MS);
  return crypto
    .createHash('md5')
    .update(`${toolName}|${argsStr}|${scopeFingerprint || ''}|${bucket}`)
    .digest('hex');
}
```

> `nowMs` 参数可选，方便单测注入；默认用 `Date.now()`。

**3）调用位置确认**　`fc_CheckDuplicate` 只需正常调用即可（签名改了自动生效）；不用动 `nodes.js`。

### 可调性

两个环境变量合力决定行为，部署方可按产品诉求调整：

| 变量 | 默认 | 语义 |
|---|---|---|
| `CHAT_SESSION_STATE_TTL_MS` | `60000` | 缓存条目硬过期时间；超过后 `cleanupExpiredForSession` 清理 |
| `CHAT_DEDUP_BUCKET_MS` | `60000` | 签名时间桶宽度；跨桶的同问题不复用缓存 |

默认二者一致（60s），产品如果想"同分钟完全不打 DB"把 bucket 调大（如 300000 = 5 分钟）即可；想"绝对不缓存"把两者都调 0（签名里 `Math.floor(..../0)` 会变 `Infinity`，需加兜底：`if (DEDUP_BUCKET_MS <= 0) { bucket = nowMs; }`——**落地时加这行**）。

### 兼容性与影响

- FC 成本：失去分钟级以上的去重后，同 session 跨分钟的重复提问会额外走一遍 DB。按 P95 用户一次 session 2-3 个问题计算，增量有限。
- Langfuse 观测：`tool_start`/`tool_end` 事件会增加，trace 会更"满"——这是想要的副作用。
- 单测：`buildToolSignature` 本身要加一个单测（同 args 不同时间桶 → 不同签名）。

---

## 验证（端到端）

### V1 — HITL 闭环

1. `npm run dev`，前端发一条会触发 clarify 的消息（例如缺 `region` 的下钻问题）。
2. 抓 SSE：确认 `event: clarify` 的 `data.threadId` 形如 `<sessionId>:<nanoid>`，与 send 阶段日志一致。
3. 用同一 `threadId` 调 `POST /sessions/:id/resume`，body 带 `threadId` 与 `resumePayload`。
4. 期望：图从 `HumanInTheLoopGate` 续行，`fc_super_step_count` 沿用 pause 前的值（不归零），最终 `done` 返回业务结果。
5. 反向用例：故意把 body 里的 `threadId` 改成另一个 sessionId 的，期望 400 `CHAT_011`。

### V2 — Langfuse generation

1. 设置 `LANGFUSE_ENABLED=true` + 三件套 key，发任意走 FC 的消息。
2. 在 Langfuse Web 上找到根 Trace，期望树状结构包含：
   - `Router_Intent_Classification`（generation）
   - `FC_LLM_Tool_Decision`（generation，可能多次循环）
   - 已有的 `Persist_User_Message` / `Persist_Assistant_Message`（span）
3. 检查 `usage.total_tokens` 非空、`output` 有内容。

### V3 — `scopePolicy` 强制

1. 临时把任一 `tool_*.js` 的 `meta.scopePolicy` 注释掉，`npm run dev`。
2. 期望：进程**启动��败**，错误信息明确指向缺失 `scopePolicy` 的 tool 文件名。
3. 恢复后，跑 `scripts/evaluate_langgraph.js`（或现有 e2e）确认所有意图工具都能正常调用。
4. 越权回归：以 `roleScope === 'regional'` + `regions: ['北京']` 的会话调一个不属于这片 region 的 store 的 drill_down，期望返回业务护栏错误，不返回外区数据。

### V4 — Session dedup 新鲜度

1. 单测 `buildToolSignature`：
   - 同 args、同 scopeFp、`nowMs` 差 30 秒 → 签名应相同；
   - 同 args、同 scopeFp、`nowMs` 差 90 秒 → 签名应不同（默认 bucket 60s）。
2. 集成测试：同 session 先调 `getOverviewData`，sleep 70 秒后再调同参数，断言第二次 `fc_CheckDuplicate` **不**命中缓存（观察日志"命中 Session 缓存"不应出现）。
3. 压力场景：同 session 10 秒内连续调同问题 5 次，断言后 4 次命中缓存，**只**有 1 次真正打 DB（保护 FC 成本）。

### V5 — 性能与回归

- TTFT 不应劣化超过 100 ms（多了 generation handle 的初始化）。
- `evaluate_langgraph.js` 全量过一遍，回归通过率 ≥ 上一轮基线。

---

## 关键文件清单

**修改**

- `server/services/chatService.js`（F1 + F2）
- `server/routes/chat.js`（F1 resume 路由解构）
- `server/agent/graph/nodes.js`（F2 两处 generation；删除 dead `getLangfuseCallback`）
- `server/services/chatToolsService.js`（F3 强制声明 + 新增 `regional_scoped`）
- `server/chat_tools/*.js`（F3 每个文件补 `meta.scopePolicy`，约 9 个文件）
- `server/services/chatSessionStateService.js`（F4 TTL 默认值下调）
- `server/agent/graph/toolCallUtils.js`（F4 签名加时间桶）

**只读参考**

- `server/utils/tracer.js`（用其 `endGeneration` / `maskPII` / `preview` / `promptHash`）
- `server/agent/graph/state.js`（不需要改）

**前端**

- 收 `event: clarify` 的 SSE handler 持久化 `data.threadId`，调 `/resume` 时回传。

---

## 不做的事（明确范围）

- **Postgres Checkpointer**——P1，需要先解决多实例部署形态。
- **按 tool 粒度的 `freshness` 声明**（`realtime` / `daily` / `static`）——本轮 F4 用全局时间桶，粒度够用；按 tool 定制留到 P1。
- **`messages` 上下文 trim / 摘要**——P1，长会话才必现。
- **重新引入 `langfuse-langchain`**——已用 Path C 替代，避免依赖冲突。
- **`fc_ValidateParams` 重写**——核查后已是从 schema 反射的完整实现，不改。

---

## 风险与回滚

| 风险 | 缓解 |
|---|---|
| F1 改动落地，旧前端先上 → 所有 HITL 失效 | 保留兼容窗口：`threadId` 缺失时回退到旧的 `sessionId` 行为，并打一条告警日志，灰度期短（1–2 天）后改成强制 |
| F2 trace 注入引发 `chatService` 与 `nodes` 的接口抖动 | 仅多传一个可选字段，节点端使用 `trace?.generation?.()` 兜底，不影响主路径 |
| F3 `scopePolicy` 强制 = CI 红灯 | 一次 PR 内同时改 service + 9 个 tool；提供回退开关 `TOOLS_REQUIRE_SCOPE_POLICY=false`（仅本地调试用，禁止生产开启） |
| F4 TTL 下调后 FC 调用频率上升 | 观测 `Langfuse` 上的 tool call count 与 DB 查询耗时；若压力过大，调大 `CHAT_DEDUP_BUCKET_MS` 而不动 TTL（保留正确性，放宽去重） |

每个修复都做成独立 PR，便于按需回滚。
