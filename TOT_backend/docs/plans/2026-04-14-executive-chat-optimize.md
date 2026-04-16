# Executive Chat 优化执行计划

> **技术规格**：`TOT_backend/docs/specs/09-EXECUTIVE-CHAT.md`  
> **决策基线**：结构化日志 → `console.log` 单行 JSON；LLM 重试 → `utils/ai.js`；验证 → `scripts/`；P2 仅 Redis 接入（可选 `ioredis`）。

| 维度 | 说明 |
|------|------|
| **Goal** | 系统性解决工程评审中的**核心问题**（见「范围与推迟项」），分三阶段交付，不引入破坏性变更。 |
| **Architecture** | **双模式**：`intent_routing`（默认可保留）与 **`function_calling`（MVP 必须交付可用）**；共用工具层、日志与 `utils/ai` 重试。 |
| **Tech Stack** | Node.js 18 / better-sqlite3 / DeepSeek API / nanoid；**P0–P1 不新增 npm**；P2 仅在启用 Redis 时可选 `ioredis`（`REDIS_URL` 开关）。 |

---

## MVP 交付定义（产品约束）

**MVP 关闭条件**包含：在 **`CHAT_AGENT_MODE=function_calling`** 下，端到端可用且可验收——**不是**「仅代码里有 FC 分支」。

| 必须纳入 MVP（Phase 0 + Phase 1） | 说明 |
|----------------------------------|------|
| **Task 0** | **Day 1 最先**：H1/H2/H3（`session.regions` 解析隔离、FC `?? null`、修正过时注释）；见 Phase 0 **Task 0**。 |
| Task 1–4 | 日志、重试、分类、下钻兜底；FC 与 Intent Routing **共用**同一套可观测与容错底座。 |
| **Task 5–6** | FC System Prompt + `response_format` 策略 + **`runAnalytics` 命名与 schema 一致**；避免 MVP 对外演示时工具名分裂。 |
| **Task 7–8** | 多轮上下文压缩 + **非最后一跳**模型输出的安全 JSON 提取；FC 多轮 tool loop 依赖这两项。 |
| Task 9 | 预警常量 + `_intentType` 注释；改动面小，一并进 MVP。 |
| **Task 5.5** | FC 模式 **per-tool 错误隔离**（见下文）：单工具 `executeByName` 失败不得导致整轮 `Promise.all` 拒绝。 |
| **Task 3 负例** | few-shot 增加 **≥5 组边界/负例**（尤其 `progress_query` vs `analytics_query`），降低分类漂移。 |
| **Task 4.6** | **工具缓存签名含 `rtm`**（与 `buildScopeFingerprint` 对齐）；**最迟在 Task 10（Redis）之前**合入，避免跨进程缓存串数据。 |
| **规格** | `09-EXECUTIVE-CHAT.md` 写明：**MVP 须验证 FC 路径**（含 `response_format` 兼容性说明）、默认/推荐 `CHAT_AGENT_MODE`、与 Intent Routing 并存时的切换方式；**双模式调用次数与延迟/成本量级**（见「外部专家评估摘要」）。 |

**明确不纳入 MVP（仍按 Phase 2）**：Task 10（Redis）、P3 项（多工具组合策略、**全链路** `entities` Zod、`_intentType` 结构化返回等）。**工具输出最小结构校验**（Zod）见 P1.5 可选项；**意图 Golden Set** 见下文 **闸门**（与 Zod 分离）。

**MVP 验收（FC，需真实 `DEEPSEEK_API_KEY`）**：至少一条路径「用户问业务问题 → 模型发起 `tool_calls` → 执行工具 → **最终** `tool_choice: 'none'` + 可解析的 ReplyContent JSON」；若厂商不支持同请求 `tools` + `response_format`，则文档与实现均为「**仅最后一跳** `json_object`」，并在规格中记录。

---

## 双模式演进（Intent Routing vs Function Calling）

**MVP 期间**：保留两套实现；**FC 端到端验收通过后**，将 **默认** `CHAT_AGENT_MODE` 设为 **`function_calling`**，`intent_routing` 保留为 **紧急回退**（如 DeepSeek FC / `tools`+`response_format` 兼容性出问题）。

**为何不能立刻删掉 Intent Routing**

- FC 依赖厂商能力，本计划已多次强调 **兼容性不确定**；在真实 Key 验收前，IR 是可用保险丝。
- **延迟特征不同**：IR 典型为 **2 次** LLM 调用（分类 + 答案）；FC 最坏约 **MAX_ITERATIONS + 最终回答**（例如多轮 tool 后仍要一跳），演示与容量规划需按 `chat_turn` / 分阶段耗时区分。

**IR 的架构天花板（为何长期要收敛到 FC）**

- IR 是 **一意图 → 一单工具** 管道，**无法表达跨工具组合**（除非产品改规格并扩路由）。例如：「华东区预警门店里，完成时间 P90 是多少？」需要先 **预警列表** 再 **统计**，IR 单步会漏约束或答非所问；**FC 多步 tool_calls** 是正确载体。

**维护税**：新工具、新参数、缓存语义往往要在 **IR + FC** 各适配一次；FC 稳定后应停止双轨扩张。

**建议废弃路径（约 6 个月内明确）**

| 阶段 | 动作 |
|------|------|
| MVP 发布日 | 默认 `function_calling`；IR 仅 `CHAT_AGENT_MODE=intent_routing` 回退。 |
| 发布后 2–4 周 | 用 `chat_turn` 的 `agentMode`、错误率、P95 `responseTimeMs`、`toolSkipped` 等确认 FC 稳定。 |
| 确认稳定后 | 立项删除 `runIntentRouting` 主路径；`chatIntentService` 可降级为调试/批处理或移除（以 ADR 为准）。Task 10 Redis 上线后，也可减少对 IR 单工具缓存语义的长期兼容负担。 |

**规格**：以上内容应写入 `09-EXECUTIVE-CHAT.md`「模式与演进」小节，避免口头约定。

---

## 范围与推迟项（相对评审清单）

**本计划明确覆盖**：结构化可观测性、DeepSeek 调用重试、意图分类 few-shot、`drill_down` 无实体兜底、FC 提示与 `response_format`、工具命名、历史上下文压缩、FC JSON 安全提取、预警阈值常量、会话状态 Redis 旁路（P2）。

**刻意推迟 / 不在本计划内**（可另立 issue 或 P3）：

- Intent Routing 下**多工具组合查询**的产品与实现策略（若与「单次单工具」并存，须在 `09-EXECUTIVE-CHAT.md` 定义，并可能默认走 FC）。**新增意图/工具（排名、趋势、DDL、平台维度等）**见文末 **附录：产品路线图建议**，**不纳入**当前 Phase 0–2 交付范围。
- **`entities` 出口统一 schema 校验**（如 Zod/Joi，与分类侧、工具侧衔接）。
- `chatSessionStateService.addRecord` **乐观锁版本冲突**时的结构化日志。
- `_intentType` 从 reply 对象 mutation 改为 `{ replyContent, intentType }` 整洁返回（P3；本计划 Task 9 仅注释 + TODO）。

**规格同步闸门**：Phase 0/1 发布前更新 `TOT_backend/docs/specs/09-EXECUTIVE-CHAT.md`（可观测性字段、重试策略、`drill_down` 兜底、`analysisType` 与 `tool_runAnalytics` / `runAnalytics` 枚举一致、FC 与 `response_format`）。HTTP 契约未变则不必改 `04-API-SPEC.md`。

**P1.5（可选，非闸门）**：对 **FC / 格式化前** 的工具返回做 **最小 Zod（或等价）校验**，失败时降级为结构化错误对象，避免污染下一轮 LLM。**维护性**：`tool_getWarnings.js` 等若 `handler: async` 且无 `await`（better-sqlite3 同步），建议去掉 `async` 或单行注释说明「工具签名统一 async」，避免后续误加 `await db.*`。

**意图 Golden Set（闸门，Task 3 / Task 5）**：分类边界与 FC System Prompt 的改动**最易引入隐性回归**。**必须先有**可重复基线，**改动后**对比通过率。

| 要求 | 说明 |
|------|------|
| 脚本 | 新增 `TOT_backend/server/scripts/test-intent-classify.js`，支持 `--golden`（或子命令），读取 **JSON 用例文件**（建议 `scripts/fixtures/intent-golden.json`：输入问法 → 期望 `intentType` / 关键 `entities`），打印通过率与失败列表。无需 Jest。 |
| 时机 | **Task 3 Step 1 / Task 5 Step 2 落笔前**：保存当前 `main`（或标签）上跑一遍，记为 baseline；PR 合并前再跑，**不得无理由下降**（允许有记录的 prompt 取舍）。 |
| 与 Task 5 | FC 的 `SYSTEM_PROMPT` 若影响模型对「业务 vs 闲聊」的边界，应用同一 golden set 或 **FC 专用**最小子集做 smoke（至少不破坏已有意图分布）。 |

---

## 外部专家评估摘要（第三方 AI Agent 评审，已采纳入本计划）

**总体判断**：工程顺序（先可观测性再容错再 Prompt）成熟；从 **Agent 架构** 看，原计划在 **FC 错误隔离、分类负例、缓存键与 scope 一致性、双模式成本** 等处存在缺口。下表为 **采纳结论**（与当前仓库 `chatAgentRunner.js` / `chatIntentService.js` 对照一致）。

| 评审点 | 结论 | 本计划动作 |
|--------|------|------------|
| Task 8 `extractFirstJson` 深度计数 | 无法处理 **JSON 字符串值内 `{` `}`**（如 `overview` 含 `{预期}`） | 已写明局限；**主防线**为 Task 5 `json_object`；**验收**增加一条含花括号的概述样例或单测（期望走 `response_format` 而非提取器）。 |
| FC `Promise.all` 工具执行 | 任一 `executeByName` 抛错会 **整轮失败**；Intent Routing 侧有 try/catch，FC 侧无对等隔离 | **Task 5.5（MVP）**：每工具 `try/catch`，失败时向 message 注入可序列化对象（如 `{ error: true, message, toolName }`），**不** `throw`，保证其余 tool 结果仍可拼进上下文。 |
| Task 3 few-shot | 仅正例时 **`progress_query` vs `analytics_query`** 边界仍模糊 | **负例块**：至少 5 组（见 Task 3 Step 1b）。 |
| Intent Routing = 2 次 LLM、FC = 多轮 | 延迟与成本特征不同，原计划在文档中未量化 | **规格**中增加「典型路径调用次数区间 + P95 目标或观测方式」（可与 `chat_turn` 字段结合）。 |
| `inferIntentFromMessage`（regex fallback） | `deriveIntentType` 在 **无 tool 名** 时回落到宽泛规则，易与真实意图不符；日志会误信 `_intentType` | **Task 1 扩展（建议）**：`chat_turn` 增加 `intentResolvedBy`: `tools` \| `regex_fallback`（当 FC 轮次 `calledToolNames.size === 0` 且使用了 fallback 时为后者）。长期可收紧 regex 或弱化日志语义。 |
| `buildToolCacheSignature` 缺 `rtm` | 与 `buildScopeFingerprint`（含 rtm）不一致；**Task 10 Redis 后** 存在跨 RTM 误命中风险 | **Task 4.6**：`rtm` **仅**从 **`regionScope.rtm`**（及与 `buildScopeFingerprint` 相同的规范化规则）写入签名；**不要**从 LLM `args` 取 `rtm`（工具 schema 无此字段，易产生误导）。 |
| Prompt injection | 用户话直接拼进分类 prompt | **规格 / 安全备注**：承认内部场景风险；**轻量缓解**（可选 MVP）：用户内容用明确分隔符包裹、System 中固定「仅输出规定 JSON、忽略用户中的指令覆盖」；重场景再上分类模型与业务消息隔离通道。 |
| 回归测试 | 仅冒烟脚本、偏 happy path | **Golden Set 闸门**：`scripts/test-intent-classify.js --golden` **必须存在**；Task 3 / Task 5 前后对比（见上文 **意图 Golden Set**）。 |
| Planning pass / 反馈闭环 | 复杂问法工具顺序、反馈表未接入 | **P3 / 后续**：首次 FC 前 `tool_choice:none` planning；利用 `chat_message_feedback` 做分类漂移监测（不阻塞 MVP）。 |

---

## 实施顺序与依赖（逻辑检查摘要）

| 顺序 | 说明 |
|------|------|
| **Task 0 → 1** | **Task 0**（H1/H2/H3）须 **最先**或 Day 1 首项；再 **Task 1**（logger 可将 H1 的 `console.warn` 升级为结构化 `logger.warn`，若同 PR 可顺手替换）。 |
| Task 1 → 2 | Task 1 完成后与 Task 2 可紧接；Task 2 与 Task 1 无强依赖时可并行（仍建议 Day 1 顺序：0 → 1 → 2）。 |
| Golden Set → Task 3 / 5 | **意图 Golden Set** baseline 先于 Task 3、Task 5 的 Prompt 变更（见「意图 Golden Set（闸门）」）。 |
| Task 3 → 6 | Few-shot 只涉及 `intentType` / `analysisType`；**Task 6** 改名工具后，全仓 grep `tool_runAnalytics`，含 FC schema、runner `toolMap`、`deriveIntentType`。 |
| Task 5 → 5.5 → 8 | Task 5 与 **Task 5.5**（FC 工具隔离）同属 `runFunctionCalling`，建议 **同一 PR 或连续合并**；Task 8 的 `extractFirstJson` 兜底非最后一跳输出。 |
| Task 4.6 → 10 | **缓存签名含 `rtm`** 须在 Redis（Task 10）上线前完成，否则多实例/跨 RTM 风险。 |
| Task 7 | 依赖 Task 1 已完成时 `chatService` 已引入 `logger` 更佳（非硬性）；可与 Task 2 并行。 |
| Task 9 | `tool_getWarnings` 常量与 runner 注释；**不**改 `chatService` 解包逻辑（与下文 Task 9 一致）。 |
| Task 10 | 需 ADR + 全仓 async 审计；仅 Redis 就绪后做。 |

**Task 2 实装要点**：`!response.ok` 分支必须 `throw Object.assign(new Error(msg), { status: response.status })`（或等价），否则 `withRetry` 无法按 HTTP 状态区分可重试与不可重试；文档中示例伪代码若仍写裸 `new Error`，实装时须替换。

**Task 10 验证**：`chatSessionStateService` 已具备 `hasRedisAdapter()`；验证前 `cd TOT_backend/server`。

---

## Vibe Code 专项审计（第四～五版评审）

**计划形态**：维持 **A**；第五版确认 **执行可行性**已达 vibe coding 场景下文档可交付标准。以下为 **代码现状审计**（约 6 文件 / 1.3k 行量级）及 **vibe coding 执行陷阱**，与上文 Task 互补。

**[HIGH] 修补的执行入口**：**必须**按 **「Task 0」**（见下节 Phase 0 之前）落进时间线；**勿**仅依赖本表——按 Day 1–5 推进的 AI 会话会优先看 **执行时间线**。

**演示 / MVP 前须合入的修补（[HIGH]，对应 Task 0）**

| ID | 位置 | 问题 | 修补 |
|----|------|------|------|
| **H1** | `chatService.js` **~100–105**、`regenerateLastAssistant` **~319–323** | `JSON.parse(session.regions)` 无隔离，脏数据可致 **整请求 500** | `try/catch` 解析，`catch` 时 `regions: null`（或与 `resolveRegionScope` 一致的安全回退），并 **`logger.warn('session_regions_parse_error', { sessionId })`**；未合并 Task 1 前可暂用 `console.warn` 单行 JSON |
| **H2** | `chatAgentRunner.js` **~302**（FC `messages.push`） | `content: response.content \|\| null` 把 **`""` 误变 `null`**；部分 API 对 `null` vs 缺省敏感 | 改为 **`content: response.content ?? null`**（保留空字符串，`undefined` → `null`） |
| **H3** | `chatAgentRunner.js` **~214** 注释 | 「NOT active in MVP」与当前 **MVP 须验收 FC** 矛盾，易误导后续 AI 会话 | **删除或改写**为：`FC 路径由 CHAT_AGENT_MODE=function_calling 启用` |

**与现有 Task 的挂钩**

| 审计项 | 动作 |
|--------|------|
| `addRecord` 返回 `false`（版本冲突）时静默 | **Task 1 / runner**：每次 `addRecord` 后若 `=== false`，`logger.warn('session_cache_version_conflict', { sessionId, toolName, signature })`（当前调用处均在 **`chatAgentRunner.js`**：`runIntentRouting` ~179、`runFunctionCalling` ~280） |
| Task 5.5 实现走 `Promise.allSettled` | **禁止**（见 Task 5.5 禁令与模板）；`rejected` 项无 `tc.id`，下游 `tool_call_id` 会对不齐 → API **400** |
| Task 7 只改一处 history | **两处** assistant 摘要逻辑：`sendMessage` 内 history 映射 **~115–127**、`regenerateLastAssistant` **~304–317**，须 **同时**改为 `compressAssistantContent` |
| `CHAT_AGENT_MODE` 双读法 | `chatAgentRunner` 顶部常量 vs `chatService` 埋点再读 `process.env` | 见 **Task 1 Step 2**：统一由 runner **导出** `AGENT_MODE`，`chatService` **只引用该导出** |
| `tool_getWarnings.js` `handler: async` 无 `await` | better-sqlite3 同步 API；**P1.5 维护**：去掉 `async` 或注释「工具接口统一 async，此处无 await」 |

**Vibe coding 上下文断层 — 防御表（粘贴给 AI 时用）**

| 任务 | 常见失误 | 防御 |
|------|----------|------|
| Task 5.5 | 用 `Promise.allSettled` 代替 try/catch | 计划内 **禁令 + 模板骨架** |
| Task 7 | 只改 `sendMessage`，漏 `regenerateLastAssistant` | 文档标明 **~115–127 与 ~304–317 两处** |
| Task 4.6 | 改了 `buildToolCacheSignature` 签名，漏一处调用 | **必须**更新 **`runIntentRouting` ~166** 与 **`runFunctionCalling` ~269** 两处调用 |
| Task 6 | grep 漏文档/测试 | 执行后 **全仓 rg 零残留** |

**可选：各 Task 增加一行** `⚠️ Vibe 禁止项：…` **（见 Task 5.5 / Task 7 / Task 4.6 已内嵌）**。

**生产就绪度（审计用）**：当前约 **68/100**（含未实现 Task 5.5 的 `Promise.all` 风险）；**Task 0（H1+H2+H3）** 合并后可进演示环境；Task 1–9 完成后预期约 **82**（量级供自评，非闸门）。

---

## Phase 0 — 立即修复（1–2 天）

### Task 0：快速修补 H1 / H2 / H3（&lt;1h，Day 1 **最先**）

**目标**：关闭 Vibe 审计三项 **[HIGH]**，避免 `session.regions` 脏 JSON 导致 **`sendMessage` / `regenerateLastAssistant` 全请求 500**、FC 轮次 **`content: ""` 被误转成 `null`** 引发厂商 API 异常、以及 **误导性「NOT active in MVP」注释**。

⚠️ **Vibe 执行顺序**：本 Task **排在 Task 1 之前**（或 Day 1 第一项）。仅看「执行时间线」的会话也必须命中本 Task。

**涉及文件**

- `TOT_backend/server/services/chatService.js`
- `TOT_backend/server/services/chatAgentRunner.js`

#### H1 — `JSON.parse(session.regions)` 错误隔离

在 **`sendMessage`** 构造 `regionScope` 处（约 **100–105**）与 **`regenerateLastAssistant`** 同名逻辑（约 **319–323**）：

- 若 `session.regions` 有值：`try { parsedRegions = JSON.parse(session.regions); } catch { … }`
- `catch`：`parsedRegions = null`（或与现有 `resolveRegionScope` / national 回退策略一致）
- 记录 **`session_regions_parse_error`**：已合并 **Task 1** 时用 `logger.warn`；**仅执行 Task 0** 时用 `console.warn(JSON.stringify({ event: 'session_regions_parse_error', sessionId }))` 单行即可

#### H2 — FC `assistant` 消息的 `content`

在 **`runFunctionCalling`** 内 `messages.push({ role: 'assistant', … })`（约 **302**）：

- 将 **`content: response.content || null`** 改为 **`content: response.content ?? null`**

#### H3 — 过时注释

- **`chatAgentRunner.js` ~214**：删除「NOT active in MVP」类表述，或改为事实：**FC 由 `CHAT_AGENT_MODE=function_calling` 启用、MVP 须验收该路径**。

#### 验证

```bash
cd TOT_backend/server
node --check services/chatService.js
node --check services/chatAgentRunner.js
```

#### Commit

```bash
git add TOT_backend/server/services/chatService.js \
        TOT_backend/server/services/chatAgentRunner.js
git commit -m "fix(chat): guard JSON.parse session.regions; use ?? null for FC assistant content"
```

---

### Task 1：结构化操作日志

**目标**：统一日志工具，替换散落 `console.warn/error`，为监控提供结构化数据源。

**涉及文件**

- 新建：`TOT_backend/server/utils/logger.js`
- 修改：`TOT_backend/server/services/chatService.js`
- 修改：`TOT_backend/server/services/chatAgentRunner.js`
- 修改：`TOT_backend/server/services/chatToolsService.js`

#### Step 1：新建 `utils/logger.js`

```javascript
// TOT_backend/server/utils/logger.js
'use strict';

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

function log(level, event, fields = {}) {
  if ((LEVELS[level] ?? 1) < (LEVELS[LOG_LEVEL] ?? 1)) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  };
  console.log(JSON.stringify(entry));
}

module.exports = {
  debug: (event, fields) => log('debug', event, fields),
  info:  (event, fields) => log('info',  event, fields),
  warn:  (event, fields) => log('warn',  event, fields),
  error: (event, fields) => log('error', event, fields),
};
```

#### Step 2：`chat_turn` 埋点（禁止引用不存在的 `toolResult`）

**问题修正**：`sendMessage` 内没有 `toolResult`；`toolCalled: toolResult !== null` 为错误示例。

**推荐做法**：`chatAgentRunner` 在返回的 `replyContent` 上附加 **`_toolMeta`（内部字段）**，由 `chatService` 在落库/返回 API 前 `delete`，仅用于日志。字段：

- `toolName`：`string | null`
- `cacheHit`：`boolean | null`（计划正文中 `chat_turn` 使用 `toolCacheHit` 与之一致）
- `skipped`：`boolean`（`drill_down` 无实体提前返回未调工具时为 `true`）

在 `chatService.js` 的 `sendMessage` 末尾（`return { messageId, ... }` 之前）：

```javascript
const logger = require('../utils/logger');
const { AGENT_MODE } = require('./chatAgentRunner');
const toolMeta = replyContent._toolMeta || {};
delete replyContent._toolMeta;

logger.info('chat_turn', {
  sessionId,
  userId,
  intentType,
  agentMode: AGENT_MODE,
  responseTimeMs: responseTime,
  toolName: toolMeta.toolName ?? null,
  toolCacheHit: toolMeta.cacheHit ?? null,
  toolSkipped: toolMeta.skipped === true,
  msgId: assistMsgId,
});
```

> **`AGENT_MODE`**：在 `chatAgentRunner.js` 与 `module.exports = { run }` 同级导出，例如 `module.exports = { run, AGENT_MODE: CHAT_AGENT_MODE };`，避免 `chatService` 再写一套 `process.env.CHAT_AGENT_MODE || …`（与 **Vibe 审计 MEDIUM #7** 一致）。

> `intentType` 仍从 `replyContent._intentType` 提取后 `delete`（与现有一致）。若某分支未设置 `_toolMeta`，日志里 tool 相关字段可为 `null`。

#### Step 2b：`addRecord` 冲突可观测（与 Vibe 审计 HIGH #4 对齐）

凡 `chatSessionStateService.addRecord(...)` 返回值 **`=== false`**（版本冲突，见 `chatSessionStateService.js`），须 **`logger.warn('session_cache_version_conflict', { sessionId, toolName, signature })`**（字段按现有变量裁剪）。当前仅 **`chatAgentRunner.js`** 两处成功路径写入；Task 5.5 后若新增写入点须同样检查。

#### Step 3：`chatAgentRunner.js` 的 `runIntentRouting`

- 工具执行成功后：`logger.debug('tool_called', { toolName, cacheHit: !!cached, intentType, region: entities?.region || null, storeId: entities?.storeId || null })`
- `catch`：`logger.warn('tool_execution_failed', { toolName, error: err.message })`

**与 Step 2 对齐**：在 `runIntentRouting` 每条 `return` 前为 `replyContent` 设置 `_toolMeta`（或组装后统一赋值一次）。示例：成功且非缓存 `{ toolName, cacheHit: false }`；命中缓存 `{ toolName, cacheHit: true }`；`drill_down` 无实体兜底 `{ toolName: null, cacheHit: null, skipped: true }`；`unknown` 未调工具 `{ toolName: null, cacheHit: null, skipped: false }`。FC 模式若需同样指标，可在最终返回前聚合本次工具名（或 `toolName: 'multi'` + debug 日志）。

#### Step 4：`chatToolsService.js`

```javascript
const logger = require('../utils/logger');
// catch 内将现有推导的 code 传入
logger.warn('tool_blocked', { toolName, error: err.message, code });
```

`loadTools` 的 `console.log` 可保留或改为 `logger.info('tools_loaded', { count, files })`。

#### Step 5：验证

```bash
cd "/Users/skyler/Desktop/MVP 3.0/TOT-Apple/TOT_backend/server"
LOG_LEVEL=debug node -e "
const logger = require('./utils/logger');
logger.info('test_event', { sessionId: 'abc', responseTimeMs: 120 });
logger.warn('tool_blocked', { toolName: 'getOverviewData', error: 'timeout' });
"
```

预期：两行单行 JSON。

#### Step 6：Commit

```bash
git add TOT_backend/server/utils/logger.js \
        TOT_backend/server/services/chatService.js \
        TOT_backend/server/services/chatAgentRunner.js \
        TOT_backend/server/services/chatToolsService.js
git commit -m "feat(chat): add structured JSON logger and operational event logging"
```

---

### Task 2：LLM 调用重试机制

**目标**：`generateTextDeepSeek` 与 `chatWithTools` 在 5xx / 429 / 网络超时等可恢复错误时自动重试最多 2 次（指数退避），不改变调用方接口。

**涉及文件**：`TOT_backend/server/utils/ai.js`；新建 `TOT_backend/server/scripts/test-retry.js`

#### Step 1：`withRetry`（禁止仅用 `message.includes('400')`）

- **可重试**：`fetch` 抛错（网络/DNS/连接重置）、HTTP **429**、HTTP **5xx**。
- **不可重试**：`DEEPSEEK_API_KEY` 未设置、HTTP **400/401/403/404**、明确业务错误。
- 默认 `maxRetries = 2`（最多 3 次尝试），退避如 `300 * 2^attempt ms + 小抖动`。
- **`!response.ok` 时必须** `throw Object.assign(new Error(msg), { status: response.status })`，供 `withRetry` 使用 `err.status` 判断。

#### Step 2–3：包裹 `generateTextDeepSeek` 与 `chatWithTools` 的 fetch 块

将整个 fetch → 解析 → return 包在 `return withRetry(async () => { ... })` 内；错误分支抛带 `status` 的 Error。

#### Step 4：`module.exports` 增加 `withRetry`（供脚本测试）。

#### Step 5：验证脚本 `scripts/test-retry.js`

```javascript
'use strict';
const { withRetry } = require('../utils/ai');

async function main() {
  let attempts = 0;
  try {
    await withRetry(async () => {
      attempts++;
      if (attempts < 3) throw Object.assign(new Error('DeepSeek API Failed: 503'), { status: 503 });
      return 'success';
    }, 2);
    console.log(`✅ 重试成功，共尝试 ${attempts} 次（预期 3）`);
  } catch (e) {
    console.error('❌ 意外失败:', e.message);
  }

  attempts = 0;
  try {
    await withRetry(async () => {
      attempts++;
      throw new Error('DEEPSEEK_API_KEY is not set');
    }, 2);
  } catch (e) {
    console.log(`✅ API Key 错误不重试，尝试 ${attempts} 次（预期 1）：${e.message}`);
  }
}

main().catch(console.error);
```

```bash
node "/Users/skyler/Desktop/MVP 3.0/TOT-Apple/TOT_backend/server/scripts/test-retry.js"
```

#### Step 6：Commit

```bash
git add TOT_backend/server/utils/ai.js \
        TOT_backend/server/scripts/test-retry.js
git commit -m "feat(ai): add exponential backoff retry wrapper for LLM calls"
```

---

### Task 3：`chatIntentService` Prompt 补全

**目标**：补充 `analytics_query` 与 `project_status` 的 few-shot，缩小分类盲区。

**涉及文件**：`TOT_backend/server/services/chatIntentService.js`；新建 `scripts/test-intent-classify.js` + golden JSON（若尚未存在）

#### Step 0：Golden Set 基线（闸门）

在修改 `SYSTEM_PROMPT` 前：实现或补齐 **`node scripts/test-intent-classify.js --golden`**（见「意图 Golden Set（闸门）」），对当前分支跑一次并保存输出或通过率；合并本 Task 前再跑，**对失败用例做 diff 审查**。

#### Step 1：在 `SYSTEM_PROMPT` 示例区（「你好！」示例之前）追加

```text
用户: "华东区 P90 完成耗时是多少？" → { "intentType": "analytics_query", "entities": { "taskId": null, "storeId": null, "storeName": null, "region": "华东", "rtm": null, "topN": null, "analysisType": "quantile_duration" } }
用户: "完成时间是怎么分布的？" → { "intentType": "analytics_query", "entities": { "taskId": null, "storeId": null, "storeName": null, "region": null, "rtm": null, "topN": null, "analysisType": "completion_time_distribution" } }
用户: "现在有哪些进行中的培训任务？" → { "intentType": "project_status", "entities": { "taskId": null, "storeId": null, "storeName": null, "region": null, "rtm": null, "topN": null, "analysisType": null } }
```

**约束**：`analysisType` 枚举须与 `chat_tools/tool_runAnalytics.js`（及 Task 6 改名后的 schema）一致；变更须同步 `09-EXECUTIVE-CHAT.md`。

#### Step 1b：负例与边界（MVP，≥5 组）

在示例区追加 **反例/边界**，减轻「汇总类完成率」与「统计分位数类」混淆。示例（可按产品用语再调）：

```text
用户: "各区域完成率汇总是多少？" → { "intentType": "progress_query", "entities": { ..., "analysisType": null } }
用户: "Q1 培训完成率多少？" → { "intentType": "progress_query", ... }
用户: "完成率的 P90 分位数是多少？" → { "intentType": "analytics_query", "entities": { ..., "analysisType": "quantile_duration" } }
用户: "完成率分布直方图" → { "intentType": "analytics_query", "entities": { ..., "analysisType": "completion_time_distribution" } }
用户: "华东区完成率" → { "intentType": "progress_query", ... }  // 有区域但无分位/分布等统计词 → 非 analytics_query
```

#### Step 2：验证（需 `DEEPSEEK_API_KEY`）

```bash
cd "/Users/skyler/Desktop/MVP 3.0/TOT-Apple/TOT_backend/server"
node -e "
require('dotenv').config();
const { classify } = require('./services/chatIntentService');
async function test() {
  const cases = [
    '华东区 P90 完成耗时是多少？',
    '完成时间分布是什么样的？',
    '现在有哪些进行中的任务？',
  ];
  for (const q of cases) {
    const r = await classify(q, []);
    console.log(q, '->', JSON.stringify(r));
  }
}
test().catch(console.error);
"
```

预期：`analytics_query` + `quantile_duration`，`analytics_query` + `completion_time_distribution`，`project_status` + `analysisType: null`。

#### Step 3：Commit

```bash
git add TOT_backend/server/services/chatIntentService.js
git commit -m "fix(chat): enrich intent classify prompt with analytics_query and project_status examples"
```

---

### Task 4：`drill_down` 路由无实体兜底

**目标**：`drill_down` 且 `region` / `storeId` / `storeName` 全空时，返回结构化歧义引导，避免进入 `getStoreDetailData` 触发参数错误。

**涉及文件**：`TOT_backend/server/services/chatAgentRunner.js`；新建 `scripts/test-drilldown-fallback.js`

#### Step 1：在 `toolMap` 赋值之后、`if (toolName) {` 之前

```javascript
if (intentType === 'drill_down' && !entities?.region && !entities?.storeId && !entities?.storeName) {
  return normalizeReplyContent({
    overview: '请提供更具体的区域或门店信息，以便为您查询。',
    keyNumbers: [],
    attentionPoints: [],
    followUpSuggestions: [
      '可追问：华东区的培训完成率是多少？',
      '可追问：上海环球港店具体情况怎么样？',
      '可追问：哪个区域完成率最低？',
    ],
  }, '请提供区域或门店信息');
}
```

> 返回前仍需按 Task 1 约定设置 `_toolMeta`（如 `skipped: true`）。

#### Step 2：验证脚本

见原 `test-drilldown-fallback.js` 逻辑：测试 1 使用「下钻看一下，整体情况怎么样？」避免被 classify 成 `warning_query`；测试 2「华东区完成情况怎么样？」应不走兜底。

```bash
node "/Users/skyler/Desktop/MVP 3.0/TOT-Apple/TOT_backend/server/scripts/test-drilldown-fallback.js"
```

#### Step 3：Commit

```bash
git add TOT_backend/server/services/chatAgentRunner.js \
        TOT_backend/server/scripts/test-drilldown-fallback.js
git commit -m "fix(chat): add drill_down entity guard to prevent silent tool failure"
```

---

## Phase 1 — 质量提升（3–5 天）

### Task 5：FC 模式 System Prompt 重构

**目标**：负面指令改为正面约束；最终一跳使用 `response_format: { type: 'json_object' }`；移除不必要的 DeepSeek 标签补丁。

**涉及文件**：`chatAgentRunner.js`；`utils/ai.js`（`chatWithTools` 支持 `response_format`）

#### Step 1：`ai.js` 中 `chatWithTools` 构建 body 后

```javascript
if (options.response_format) {
  body.response_format = options.response_format;
}
```

#### Step 2：`runFunctionCalling` 内 `SYSTEM_PROMPT`（示例）

```text
你是一个培训数据分析助手，专门回答关于门店培训进度的问题。

【能力范围】
- 查询培训完成率、项目状态、预警门店
- 按区域或门店下钻查看详情
- 执行分位数、分布、相关性等统计分析

【回答规则】
当你调用工具查询数据后，输出一个 JSON 对象，包含以下四个字段：
- overview: 不超过 60 字的数据总结
- keyNumbers: 最多 4 项数字，每项含 label/value/unit，数字必须来自工具返回
- attentionPoints: 最多 3 项风险或问题（无风险时为空数组）
- followUpSuggestions: 最多 3 条建议追问，以"可追问："开头
```

> **不要**在 FC 的 `SYSTEM_PROMPT` 里写「闲聊时用自然语言」：`run()` 在 `classifyExecutionMode()` 中已将 **闲聊 / chat_only** 拦在 **`runFunctionCalling` 之外**（见 `chatAgentRunner.js`），该句在此为 **死代码**，易误导维护者以为 FC 内还要处理打招呼。

#### Step 3：最终强制输出 `chatWithTools` 调用

```javascript
const response = await chatWithTools({
  messages,
  tools: chatToolsService.TOOL_SCHEMAS,
  tool_choice: 'none',
  response_format: { type: 'json_object' },
});
```

**验收**（须真实 Key）：`CHAT_AGENT_MODE=function_calling`，跑通多轮 `tool_calls` → 最终 `tool_choice: 'none'`。若 DeepSeek 对「同请求同时 tools + `response_format`」报错，则**仅最后一跳**带 `response_format`，并在 `09-EXECUTIVE-CHAT.md` 记兼容性说明。

#### Step 4：Golden Set 回归

跑 `node scripts/test-intent-classify.js --golden`（及如有的 FC smoke 子集）；与 Task 3 Step 0 同理，**不得无理由下降**。

#### Step 5：Commit

```bash
git add TOT_backend/server/services/chatAgentRunner.js \
        TOT_backend/server/utils/ai.js
git commit -m "refactor(chat): rewrite FC system prompt with positive instructions and json_object response_format"
```

---

### Task 5.5：FC 工具执行错误隔离（MVP）

**背景**：`runFunctionCalling` 内 `Promise.all(response.tool_calls.map(...))` 中，任一 `chatToolsService.executeByName` **抛错**会导致整轮拒绝，用户只看到失败；Intent Routing 路径对单工具有 try/catch，行为不一致。

**目标**：每个 tool call **独立** try/catch；失败时 **不 throw**，将结果设为可 JSON 序列化的错误载荷（例如 `{ _toolError: true, toolName, message: err.message, code: err.code }`），照常 `messages.push({ role: 'tool', ... })`，让模型在下一轮用 `overview` 说明部分数据不可用或改问法。

**涉及文件**：`TOT_backend/server/services/chatAgentRunner.js`（`runFunctionCalling` 工具循环）

⚠️ **Vibe 禁止项**：**不得**用 **`Promise.allSettled`** 替代手写 try/catch。`fulfilled/rejected` 形态下 **rejected 没有 `tc.id`**，后续拼 `tool_call_id` 会得到 `undefined` → 厂商 API **400**。

**注意**：与 **Task 2** 区分——Task 2 管 **HTTP 层**重试；本 Task 管 **业务工具执行**单点失败不拖垮整轮。

**缓存策略（硬性）**：工具结果为 **`_toolError: true`**（或本 Task 约定的错误载荷）时，**禁止**调用 `chatSessionStateService.addRecord` 写入会话工具缓存。把错误当成功缓存会导致后续相同签名 **永久命中失败**，把瞬时故障固化成数据问题。成功路径仍按现有 TTL / 版本策略写入；`addRecord === false` 时按 **Task 1 Step 2b** 打 `session_cache_version_conflict`。

**推荐实现骨架（须保留 `id: tc.id`）**：

```javascript
const toolResults = await Promise.all(response.tool_calls.map(async (tc) => {
  let args;
  try {
    args = JSON.parse(tc.function?.arguments || '{}');
  } catch {
    args = {};
  }
  const cacheSignature = buildToolCacheSignature(tc.function.name, args, regionScope);
  const expectedVersion = (CHAT_SESSION_STATE_ENABLED && options.sessionId)
    ? chatSessionStateService.getSessionVersion(options.sessionId, regionScope)
    : null;
  let result;
  try {
    const cached = (CHAT_SESSION_STATE_ENABLED && options.sessionId)
      ? chatSessionStateService.getLatestBySignature(options.sessionId, cacheSignature, regionScope)
      : null;
    result = cached ? cached.result : await chatToolsService.executeByName(tc.function.name, args, regionScope);
    if (!result?._toolError && !cached && CHAT_SESSION_STATE_ENABLED && options.sessionId) {
      const ok = chatSessionStateService.addRecord(options.sessionId, {
        signature: cacheSignature,
        source: 'function_calling',
        result,
      }, regionScope, expectedVersion);
      if (ok === false) {
        logger.warn('session_cache_version_conflict', { sessionId: options.sessionId, toolName: tc.function.name, cacheSignature });
      }
    }
  } catch (err) {
    result = { _toolError: true, toolName: tc.function.name, message: err.message, code: err.code };
  }
  calledToolNames.add(tc.function.name);
  return { id: tc.id, result };
}));
```

（`buildToolCacheSignature` 的第三参 `regionScope` 以 **Task 4.6** 为准；未合入 4.6 前可暂用两参签名。）

**验收**：构造单测或手工 mock：一轮 `tool_calls` 含两个工具，**一个抛错**，断言另一工具结果仍进入 `messages` 且本轮不整体 500。

**Commit**（可与 Task 5 同 PR 或紧随）：

```bash
git add TOT_backend/server/services/chatAgentRunner.js
git commit -m "fix(chat): isolate per-tool errors in FC mode to avoid Promise.all failure"
```

---

### Task 4.6：工具缓存签名纳入 `rtm`（Redis 前置）

**背景**：`buildToolCacheSignature` 当前为 `toolName|taskId|region|storeId|analysisType`，**不含 `rtm`**；`chatSessionStateService.buildScopeFingerprint` 含 `rtm`。在 **Task 10 Redis** 多进程共享缓存时，同一 `sessionId` 下不同 RTM 可能误命中。

**目标**：签名串增加与 **`buildScopeFingerprint` 一致**的 **`rtm` 维度**。

**实现约定（避免歧义）**：**`rtm` 只来自权限 scope**，即调用处传入的 **`regionScope`**（例如 `regionScope.rtm` 或与 `chatSessionStateService` 中 fingerprint 相同的规范化字段）。**不要**从 LLM 工具参数 `args` 读取 `rtm`——各工具 schema **无**该字段，模型也不会稳定传入；写「优先 `args.rtm`」会误导实现者。缺省使用与 fingerprint 相同的占位（如 `-`）。

**涉及文件**：`TOT_backend/server/services/chatAgentRunner.js`（`buildToolCacheSignature(toolName, args, regionScope)` 或等价签名，使 `regionScope` 参与签名）

⚠️ **Vibe 禁止项**：改签名后 **必须**更新 **全部**调用处——当前为 **`runIntentRouting` ~166**（`buildToolCacheSignature(toolName, entities)`）与 **`runFunctionCalling` ~269**（`buildToolCacheSignature(tc.function.name, args)`）；漏一处即 **rtm 仍不参与** 或运行时报错。

**验收**：单测或脚本：相同工具与区域、**不同 rtm**，签名应不同。

**Commit**：

```bash
git add TOT_backend/server/services/chatAgentRunner.js
git commit -m "fix(chat): include rtm in tool cache signature to align with scope fingerprint"
```

---

### Task 6：工具命名统一

**目标**：`tool_runAnalytics` → `runAnalytics`，统一 FC 命名风格。

**涉及文件**：`chat_tools/tool_runAnalytics.js`；`chatAgentRunner.js`（`toolMap`、`deriveIntentType`）

- Schema：`name: 'runAnalytics'`
- `toolMap`：`analytics_query: 'runAnalytics'`
- `deriveIntentType`：`calledToolNames.has('runAnalytics')`

**验证**

```bash
cd TOT_backend/server
node -e "
require('dotenv').config();
const { TOOL_SCHEMAS } = require('./services/chatToolsService');
console.log('已注册工具：', TOOL_SCHEMAS.map(t => t.function.name));
"
```

全仓检索 `tool_runAnalytics`（含文档、测试）。

**Commit**

```bash
git add TOT_backend/server/chat_tools/tool_runAnalytics.js \
        TOT_backend/server/services/chatAgentRunner.js
git commit -m "refactor(chat): rename tool_runAnalytics to runAnalytics for naming consistency"
```

> **顺序建议**：Task 6 紧接 Task 5 或在同一发布窗口，避免 FC 日志与 schema 名称不一致。

---

### Task 7：历史上下文质量提升

**目标**：`sendMessage` / `regenerateLastAssistant` 及 `chatAnswerService` 构造 history 时，对 assistant 内容使用 **overview + keyNumbers 摘要**（单一实现）。

⚠️ **Vibe 禁止项**：**必须同时**替换 **`chatService.js` 内两处** assistant 历史构造逻辑——**`sendMessage`** 中 `historyRows.map` **约 115–127 行**、**`regenerateLastAssistant`** 中 **`historyRows.map` 约 304–317 行**。只改一处会导致 **regenerate** 与正常发送 **上下文质量不一致**。

**涉及文件**

- 新建：`TOT_backend/server/utils/chatHistoryCompress.js`（`compressAssistantContent`）
- 修改：`chatService.js`、`chatAnswerService.js`

#### `chatHistoryCompress.js`

```javascript
'use strict';

/**
 * 将 assistant 消息的 replyContent 压缩为 LLM 上下文友好字符串。
 * 保留 overview + keyNumbers（约 100–150 token 量级）。
 */
function compressAssistantContent(rawContent) {
  try {
    const parsed = JSON.parse(rawContent);
    if (!parsed || typeof parsed.overview !== 'string') return rawContent;

    const numSummary = Array.isArray(parsed.keyNumbers) && parsed.keyNumbers.length > 0
      ? parsed.keyNumbers
          .slice(0, 4)
          .map(k => `${k.label}${k.value}${k.unit || ''}`)
          .join('、')
      : '';

    return numSummary
      ? `${parsed.overview}（${numSummary}）`
      : parsed.overview;
  } catch {
    return rawContent;
  }
}

module.exports = { compressAssistantContent };
```

#### `chatService.js`

将原 `if (parsed && parsed.overview) content = parsed.overview` 改为 `content = compressAssistantContent(r.content)`（`sendMessage` 与 `regenerateLastAssistant` 两处）。

#### `chatAnswerService.js`

历史中的 assistant 行改用同一 `compressAssistantContent`。

#### 验证：内联 `node -e` 测拼接结果（略，见原 plan 预期输出）。

#### Commit

```bash
git add TOT_backend/server/utils/chatHistoryCompress.js \
        TOT_backend/server/services/chatService.js \
        TOT_backend/server/services/chatAnswerService.js
git commit -m "fix(chat): enrich assistant history context with keyNumbers summary for better multi-turn reasoning"
```

---

### Task 8：FC 模式 JSON 提取修复

**目标**：将贪婪正则 `/\{[\s\S]*\}/` 换为括号深度计数，避免吞掉多个 JSON 块。

**涉及文件**：`chatAgentRunner.js`

#### `extractFirstJson(text)`

```javascript
function extractFirstJson(text) {
  if (!text) return null;
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}
```

**局限**：不处理 JSON 字符串值内的花括号（例：`{"overview": "完成率达{预期}的80%", ...}` 会误切分）。**主防线**仍是 Task 5 的 `json_object`；本提取器仅兜底「模型仍夹带说明文字」的非规范输出。

**验收（MVP 建议）**：在测试或手工清单中增加 **一条**含 `overview` 内字面量 `{` `}` 的用例：期望 **最终跳**走 `response_format` 且解析成功；若仅依赖本函数则应记录为 **已知失败**并依赖 Prompt 禁止此类字面量或使用转义。

#### 替换解析处

```javascript
const jsonStr = extractFirstJson(finalContent);
if (jsonStr) {
  const parsed = JSON.parse(jsonStr);
  // ...
}
```

#### Commit

```bash
git add TOT_backend/server/services/chatAgentRunner.js
git commit -m "fix(chat): replace greedy JSON regex with depth-counting extractor in FC mode"
```

---

### Task 9：预警阈值常量化 + `_intentType` 说明

**合并为一个 commit**。

**涉及文件**：`chat_tools/tool_getWarnings.js`；`chatAgentRunner.js`（**不**改 `chatService.js`）

#### Step 1：`tool_getWarnings.js`

```javascript
const WARNING_COMPLETION_THRESHOLD = 0.8;
// SQL 模板中 HAVING ... < ${WARNING_COMPLETION_THRESHOLD}（非用户输入，无注入风险）
```

#### Step 2：`_intentType`（**仅文档化，不重构接口**）

在设置 `replyContent._intentType = intentType` 处增加：

```javascript
// NOTE: _intentType is internal metadata; stripped by chatService before API response.
// TODO(P3): return { replyContent, intentType } for a cleaner boundary.
replyContent._intentType = intentType;
```

> 与「范围与推迟项」一致：**本 Task 不做** `return { replyContent, intentType }` 全链路改造。

#### Step 3：Commit

```bash
git add TOT_backend/server/chat_tools/tool_getWarnings.js \
        TOT_backend/server/services/chatAgentRunner.js
git commit -m "refactor(chat): extract warning threshold constant; add _intentType refactor TODO"
```

---

## Phase 2 — 可扩展性（按需，Redis 就绪后）

### Task 10：`chatSessionStateService` Redis Adapter

**前置**：**Task 4.6**（缓存签名含 `rtm`）应已合并；否则多租户/多 RTM 下 Redis 缓存**不得**上线。

**目标**：存在 `REDIS_URL` 且安装 `ioredis` 时，会话工具缓存可跨进程共享；无 Redis 时与现网内存行为一致。

**涉及文件**：新建 `utils/redisAdapter.js`；修改 `chatSessionStateService.js`、`app.js`（若需启动注入）

#### `redisAdapter.js`（要点）

- `getClient()`：`REDIS_URL` 缺失则 `null`；`lazyConnect`、`error` 日志。
- `TTL_SECONDS`：来自 `CHAT_SESSION_STATE_TTL_MS` 或默认 30min。
- `get` / `set`（`setex`）/ `del`；`isAvailable()`：`Boolean(REDIS_URL)`。

#### 单例注入

```javascript
const redisAdapter = require('../utils/redisAdapter');
module.exports = new ChatSessionStateService({
  redisAdapter: redisAdapter.isAvailable() ? redisAdapter : null,
});
module.exports.ChatSessionStateService = ChatSessionStateService;
```

#### `addRecord` / `getLatestBySignature`

- 写入内存成功后异步 `redisAdapter.set`。
- 内存 miss 时尝试 `redisAdapter.get` 回填再按 signature 查找。

> **必须**：凡将相关方法改为 `async`，全仓审计调用方并 `await`；实施前建议 ADR 明确多实例下 `version` 乐观锁与 Redis key 粒度（整 session blob vs 分 key）。

#### 验证

```bash
cd TOT_backend/server
REDIS_URL=redis://localhost:6379 node -e "
const svc = require('./services/chatSessionStateService');
console.log('Redis 可用：', svc.hasRedisAdapter());
"
```

#### Commit

```bash
git add TOT_backend/server/utils/redisAdapter.js \
        TOT_backend/server/services/chatSessionStateService.js
# 若改 app.js 一并加入
git commit -m "feat(chat): implement Redis adapter for session state cache with graceful fallback to memory"
```

---

## 执行时间线

| 时间 | 内容 |
|------|------|
| Day 1 | **Task 0**（H1/H2/H3，&lt;1h）→ Task 1 结构化日志 + Task 2 LLM 重试 |
| Day 2 | Task 3 Prompt + Task 4 `drill_down` 兜底 → **P0 里程碑**（Intent Routing 与共用底座稳定） |
| Day 3 | Task 5 + **Task 5.5** + Task 6（FC Prompt、工具隔离、命名）（**MVP–FC 关键路径**） |
| Day 4 | Task 7 + Task 8 + **Task 4.6**（历史、JSON 提取、**rtm 签名**） |
| Day 5 | Task 9 + **FC 端到端联调与验收** → **MVP 可发布**（含 FC；不含 Redis） |
| Day 6+ | Task 10 Redis（**非 MVP**，视多实例需求） |

---

## 快速验证命令汇总

```bash
# 启动服务
npm --prefix "/Users/skyler/Desktop/MVP 3.0/TOT-Apple/TOT_backend/server" start

# P0（Task 0 后）
cd TOT_backend/server
node --check services/chatService.js && node --check services/chatAgentRunner.js

node scripts/test-retry.js
node scripts/test-drilldown-fallback.js

# 意图分类（需 DEEPSEEK_API_KEY）：Task 3 Step 2 内联 node -e；**闸门**：node scripts/test-intent-classify.js --golden
# test-region-drilldown.js 侧重区域下钻工具，与 classify 冒烟不同

# 结构化日志（混排 stderr 时不要用 python -m json.tool 管整个流）
# LOG_LEVEL=debug npm start 2>&1 | grep 'chat_turn' | head -5

# MVP / FC 验收：启动前设置 CHAT_AGENT_MODE=function_calling，走通「tool_calls → 最终 JSON ReplyContent」
# （具体问法与脚本可另建 scripts/test-fc-e2e.js，与 Task 5 Step 3 验收一致）
```

---

## 附录：产品路线图建议（第三版评审，MVP 之后）

**评审结论（工程计划形态）**：在第二版（A-）基础上，**Task 4.6 / Task 5 注解 / Task 5.5 缓存 / Golden Set 闸门 / 双模式演进**等模糊点已关闭；**intentResolvedBy**、prompt injection 轻量缓解仍标为可选，无过度承诺——**第三版评审将本计划工程部分评为 A**。以下 **意图与工具扩展** 来自同一评审的**产品侧**建议，**独立于**上文 Task 1–10，供 MVP 发布后立项（需同步 `09-EXECUTIVE-CHAT.md`、Intent few-shot、`toolMap` / FC schema、**Golden Set 增例**）。

### 扩展优先级（执行场景）

| 优先级 | 意图（建议名） | 工具（建议名） | 要点与示例问法 |
|--------|----------------|----------------|----------------|
| **P1** | `ranking_query` | `getRankingData` | 排名/对比心智：谁最好、谁最差、差距。参数建议：`dimension`（region/store/rtm）、`order`（asc/desc）、`topN`、`taskId`。例：「各区域完成率从高到低排」「完成率最好的 5 家门店」。**实现提示**：`getWarningsData` 等已有按完成率排序的 SQL，可复用并扩展 `order`，不必从零写。与 `warning_query` 边界：「最差几家」可能落在 `warning_query` 或 `ranking_query`，产品需定一条默认规则。 |
| **P2** | `trend_query` | `getTrendData` | 时间序列：「这周有没有进步」。参数：`metric`、`granularity`（day/week）、`taskId`、`region`、`days`。依赖 DB 已有 `completed_at` / `started_at`；区别于仅作兜底的 `trend_fallback`。 |
| **P3** | `deadline_query`（或并入 `project_status` + `urgencyMode`） | 专用查询或扩展现有列表工具 | 「还剩几天、哪些任务快到期」。参数：`daysRemaining`、`region`、`taskId`。`getWarningsData` 已可能带 `ddl_at`；缺专门入口。与 **FC 多步**结合价值高：先 DDL 再完成率。 |
| **P4** | `platform_query` | `getPlatformBreakdown` | 平台维度聚合：单店 `platformStatus` 已有，缺全国/区域 `MyPal` 等汇总。参数：`platform`（mypal/smartsell/…）、`region`、`taskId`。例：「MyPal 整体完成率」。与 `ranking_query` 可组合（「哪个平台完成率最低」）。 |

### 建议暂不做（及原因）

| 想法 | 原因 |
|------|------|
| 员工维度跨门店 | 员工查询多经 `store_id`；跨店员工排名易全表扫描；对执行官价值相对门店层级偏低。 |
| 自然语言数值过滤（「低于 60%」直接进 SQL） | LLM 抽取阈值映射 SQL 容错成本高；FC 多步 + 模型侧过滤更安全。 |
| 任务间历史对比（本任务 vs 上任务） | 需历史快照或多任务汇总 schema；先 ADR。 |
| 主动推送每日简报 | 属 cron/notification，非 chat；更适合 webhook + 现有数据管道。 |

### 新增意图后的分类边界（须进 Golden Set）

意图变多后，few-shot 与 **golden** 须显式覆盖以下 **易混** 问法（示例）：

| 用户问法（示例） | 期望意图（建议） | 易误判为 |
|------------------|------------------|----------|
| 完成率最低的区域 | `ranking_query` | `warning_query`、`drill_down` |
| 华东区趋势 | `trend_query`（带 region） | `drill_down` |
| 快到期的门店 / 任务 | `deadline_query`（或 `project_status`+urgency） | `warning_query` |
| MyPal 完成率 | `platform_query` | `progress_query` |

每新增一条意图，**必须**在 `intent-golden.json`（或等价）中增加对应用例，否则分类漂移会随意图数量放大。

---

## 文档修订说明（本次）

- 统一标题层级、表格、引用块与围栏代码，去除行尾填充空格。
- 新增 **实施顺序与依赖**，并修正 Task 9 与 Task 2 中与实装不一致的表述（`withRetry` 依赖 `err.status`；Task 9 明确不重构 `chatService`）。
- Task 3 删去重复的整段 `SYSTEM_PROMPT` 粘贴，改为「追加片段 + 约束」以免与源码双源漂移。
- `test-retry.js` 示例对 503 使用 `Object.assign(..., { status: 503 })`，与重试策略一致。
- **MVP 约束**：补充 **「MVP 必须交付可用 FC」**（`CHAT_AGENT_MODE=function_calling` 端到端验收）、时间线 **MVP 可发布** 与 **P0 里程碑** 区分；Task 10 明确非 MVP。
- **外部专家评估**：纳入 **Task 5.5**（FC per-tool 错误隔离）、**Task 3 负例**、**Task 4.6**（`rtm` 缓存签名）、Task 8 花括号边界验收、**P1.5**（工具输出最小 Zod）、规格侧双模式成本与 prompt injection 备注；P3 项保留 planning pass 与反馈闭环。
- **第二版评审（A-）**：Task 4.6 **仅** `regionScope.rtm`；**Golden Set 升为 Task 3/5 闸门**；Task 5 删除 FC 内闲聊死代码说明；Task 5.5 **错误结果不写入缓存**；新增 **双模式演进与约 6 个月废弃 IR** 路径表。
- **第三版评审（A）**：工程部分闭环确认；新增附录 **产品路线图**（`ranking_query` / `trend_query` / `deadline_query` / `platform_query`、暂缓项、Golden 边界表），并指向「范围与推迟项」。
- **第四版（Vibe 审计）**：维持计划 **A**；新增 **「Vibe Code 专项审计」**（H1 `session.regions` 解析、H2 FC `content ?? null`、H3 过时注释；`addRecord` 冲突日志；禁止 Task 5.5 使用 `Promise.allSettled`；Task 7 **两处行号**、Task 4.6 **两处调用**；`AGENT_MODE` 导出；P1.5 `async` 说明；生产就绪度自评量级）。
- **第五版**：维持 **A**、执行可行性封顶评价；新增 **Task 0**（H1/H2/H3）嵌入 Phase 0 与 **Day 1 时间线**；审计章增加 **「HIGH 修补执行入口 → Task 0」** 与 **快速验证** `node --check`。
