# Executive Chat Agent 改进计划 v3

> 日期：2026-05-11 | v1 初始审计 → v2 引入 eval → v3 基于代码实际审查的精简版
> 原则：每项改动可被 eval 衡量；不做无法验证的改动

---

## 快速导航：相关文档索引

| 文档 | 路径 | 何时查看 |
|------|------|----------|
| **模块化重构总方案** | `docs/plans/2026-05-12-modularization-plan.md` | 理解哪些文件被排除不动（agent/ chat_tools/ prompts/ chatService 等） |
| **模块化进度追踪** | `docs/plans/2026-05-13-modularization-progress.md` | 了解三人分工进度，确认 Agent 改动不影响对方模块 |
| **编码规范** | `docs/CODING-STANDARDS.md` | 新增代码遵守三层架构、命名、错误码规则 |
| **EChat 需求规格** | `docs/specs/09-EXECUTIVE-CHAT.md` | 理解意图分类、工具调用、回复格式的业务需求 |
| **EChat Intent/Tools** | `docs/specs/10-EXECUTIVE-CHAT-INTENTS-TOOLS.md` | Router 的 intent 枚举 + 工具映射的权威定义 |
| **EChat 请求流程** | `docs/specs/11-EXECUTIVE-CHAT-REQUEST-FLOW.md` | LangGraph 状态流转、节点执行顺序 |
| **Agent 架构** | `docs/specs/12-AGENT-ARCHITECTURE.md` | Agent 框架的整体设计 |
| **EChat 代码地图** | `docs/internal/EXECUTIVE-CHAT-CODE-MAP.md` | 各源文件的职责和依赖关系 |
| **EChat Agent 工程简报** | `docs/internal/EXECUTIVE-CHAT-AGENT-ENGINEERING-BRIEF.md` | 工程决策记录 |
| **项目 AI 指令** | `CLAUDE.md` | 数据库同步操作、requireRole 等全局约定 |
| **技术债清单** | `docs/internal/TECH-DEBT.md` | 已知问题，避免重复造轮子 |
| **EChat 测试用例** | `docs/tests/EXECUTIVE-CHAT-TEST-QUERIES.md` | 手动测试参考查询 |
| **EChat 测试指南** | `docs/tests/EXECUTIVE-CHAT-TESTING.md` | 测试环境搭建和流程 |

> 阅读顺序建议：先看本文件了解改动范围 → 遇到不熟悉的术语查上表对应文档 → 改代码时参考编码规范。

---

## 涉及文件总览

### P0 代码修改

| 文件 | 改动 | 预期提升 |
|---|---|---|
| `TOT_backend/server/agent/graph/nodes.js:27-35` | `getRouterModel()` 加 `response_format: json_object` | 从源头减少 Router JSON parse 失败 |
| `TOT_backend/server/agent/graph/nodes.js:218-230` | Router LLM 调用的超时保护 | 防止 DeepSeek 挂起导致请求永久卡死 |
| `TOT_backend/server/prompts/router.js:15-34` | 补齐 `progress_query`/`analytics_query` 规则 + entity schema 从 1 字段扩展到 5 字段 | Router 分类更准 + repair 节点能推断缺失参数 |
| `TOT_backend/server/agent/graph/graph.js:11-13` | 删除 `<5字 → chat_only` 短路，改为明确问候词白名单 | "那华北呢？"不再被误判为闲聊 |
| `TOT_backend/server/db/seed.js:31-44` | 补齐 10 家门店的 `region` 字段（华东/华南/华北/西南/东北） | 区域下钻查询有数据可查，e2e eval 能覆盖区域场景 |
| `TOT_backend/server/chat_tools/tool_getRegionDetailData.js` | description 补中文关键词 | BM25 检索更准 |
| `TOT_backend/server/chat_tools/tool_runAnalytics.js` | description 补中文关键词 | BM25 检索更准 |

### P1 代码修改

| 文件 | 改动 | 预期提升 |
|---|---|---|
| `TOT_backend/server/agent/graph/state.js:50-60` | 新增 `prevIntent` 字段 | 跨消息的意图传递基础设施 |
| `TOT_backend/server/services/chatService.js:780-786` | inputState 注入上一条 assistant 消息的 `intent_type` 作为 `prevIntent` | 新消息能拿到上一轮的意图 |
| `TOT_backend/server/agent/graph/nodes.js:189-211` | 短追问时读取 `state.prevIntent` 注入 Router hint | 多轮追问不丢失意图 |
| `TOT_backend/server/agent/graph/nodes.js:312-340` | BM25 prior 权重调整（5→10, cap 3） | 意图专属工具不被通用工具挤出 |

### P2 代码修改

| 文件 | 改动 |
|---|---|
| `TOT_backend/server/agent/graph/nodes.js` | 拆分为 6 个文件后删除 |
| `TOT_backend/server/agent/graph/graph.js` | 更新 require 路径 |
| `TOT_backend/server/routes/chat.js` | 删除 `legacy_stream` 分支，默认 regenerate 改走 LangGraph |
| `TOT_backend/server/services/chatService.js` | 删除 `sendMessageStream`/`regenerateLastAssistantStream`/`regenerateLastAssistant` |

### 新增文件

| 文件 | 内容 | 阶段 |
|---|---|---|
| `TOT_backend/server/agent/eval/evalCases.json` | 40 条评估用例（30 条 Router/ToolRetrieve + 10 条端到端） | P0 |
| `TOT_backend/server/agent/eval/runEval.js` | eval 执行脚本，输出 baseline/compare 报告 | P0 |
| `TOT_backend/server/agent/graph/__tests__/decisionRules.test.js` | correctMode/selectTier 单元测试 | P2 |
| `TOT_backend/server/agent/graph/__tests__/toolCallUtils.test.js` | canonicalizeArgs/buildToolSignature 单元测试 | P2 |
| `TOT_backend/server/agent/graph/modelFactory.js` | 拆分出 getRouterModel/getFcModel/getLlmWithTools | P2 |
| `TOT_backend/server/agent/graph/toolIndex.js` | 拆分出 INTENT_TOOL_MAP + BM25 索引 + 启动校验 | P2 |
| `TOT_backend/server/agent/graph/nodes/routerNode.js` | 拆分出 loadContext/contextAnalyzerRouter | P2 |
| `TOT_backend/server/agent/graph/nodes/fcLoop.js` | 拆分出 toolRetrieve/fc_CheckSteps/fc_LlmToolCallStep | P2 |
| `TOT_backend/server/agent/graph/nodes/fcExecute.js` | 拆分出 去重/校验/修复/执行/合并 5 节点 | P2 |
| `TOT_backend/server/agent/graph/nodes/responseNode.js` | 拆分出 HITL/finalResponse/persist | P2 |

---

## P0-1：建立 Eval 体系

**这是所有后续改动的基石。没跑 eval 不动代码。**

### Eval Case 设计

**新增文件**：`TOT_backend/server/agent/eval/evalCases.json`

两类 case：

**A 类 — Router + ToolRetrieve 单元级（30 条）**
只调 `contextAnalyzerRouter` 和 `toolRetrieve`，不启动完整 graph。快速（全部跑完 <30 秒），适合改 prompt/改权重后快速对比。

```json
{
  "id": "R001",
  "type": "unit",
  "userMessage": "iPhone 17 新品培训完成率是多少？",
  "historyContext": [],
  "expected": {
    "intent": "progress_query",
    "mode": "tool_action",
    "topKIncludes": ["queryExecutiveMetrics"],
    "topKExcludes": ["getWarningsData", "getTaskListData"]
  }
}
```

**B 类 — 端到端（10 条）**
走完整 `buildGraph().invoke()`，检查最终回复内容。能抓到 FC LLM 选错参数、总结遗漏等下游问题。

```json
{
  "id": "E001",
  "type": "e2e",
  "userMessage": "有哪些门店需要重点关注？",
  "historyContext": [],
  "expected": {
    "responseMustContain": ["门店", "完成率"],
    "responseMustNotContain": ["无法", "抱歉", "暂时不支持"]
  }
}
```

覆盖分布：6 个 intent 各 4-5 条、多意图 3 条、闲聊 3 条、简短确认语上下文 4 条。

### Eval 脚本

**新增文件**：`TOT_backend/server/agent/eval/runEval.js`

```javascript
// node server/agent/eval/runEval.js --baseline  → 录 baseline.json
// node server/agent/eval/runEval.js --compare   → 对比 baseline.json，输出报告
// node server/agent/eval/runEval.js --e2e        → 跑端到端 case
//
// 报告格式 server/agent/eval/reports/YYYY-MM-DD-HHmmss.json：
// {
//   "summary": {
//     "intentAccuracy": { "before": 0.83, "after": 0.90, "delta": +0.07 },
//     "topKHitRate":    { "before": 0.76, "after": 0.82, "delta": +0.06 },
//     "e2ePassRate":    { "before": 0.60, "after": 0.70, "delta": +0.10 }
//   },
//   "regressions": [
//     { "caseId": "R012", "before": "correct", "after": "wrong", "detail": "..." }
//   ],
//   "improvements": [...]
// }
```

**注意**：跑端到端 case 需要真实 tool handler 能执行（可能需要 seed 数据）。如果环境不支持，B 类 case 可以先标记为 `skip`，等有测试环境再跑。

---

## P0-2：`response_format: json_object` — 从源头减少 Router parse 失败

**涉及文件**：`TOT_backend/server/agent/graph/nodes.js:27-35`（`getRouterModel`）

**问题**：当前 Router 依赖 LLM 自觉输出裸 JSON，失败了走降级。DeepSeek 支持 `response_format: { type: "json_object" }`，这会让模型保证输出有效 JSON，从源头消除 "JSON 被 markdown 包裹" 和 "输出不完整 JSON" 的问题。

**为什么不用 withStructuredOutput/Zod schema**：
- `withStructuredOutput()` 跟 DeepSeek 的兼容性未经测试（历史上有 streaming+invoke 死锁的坑）
- Zod 校验在 `JSON.parse` 之后运行——如果 parse 失败 Zod 没机会跑；如果 parse 成功 LLM 类型基本不错
- `response_format` 是 API 层面的约束，比后置校验更根本

**改动**：在 `getRouterModel()` 的 ChatOpenAI 配置中加一行：

```javascript
// nodes.js getRouterModel()，在 configuration 之后加：
modelKwargs: {
  response_format: { type: "json_object" }
}
```

**注意**：`response_format: json_object` 要求 prompt 中包含 "JSON" 字样。当前 Router prompt 已有 "OUTPUT RAW JSON ONLY"，满足条件。

**验证**：先录 baseline eval，改后跑 `--compare`，看 Router parse 失败率变化。

**改动规模**：3 行

---

## P0-3：Router 超时保护 + 补齐 intent 规则 + 扩展 entity schema

三项改动合并，因为它们都改 Router 相关的同一个区域。

### 3a. Router 超时保护

**涉及文件**：`TOT_backend/server/agent/graph/nodes.js:218-230`

复用 FC LLM（line 460-463）已有的 AbortController + setTimeout 模式，环境变量 `ROUTER_LLM_TIMEOUT_MS` 默认 15000ms。

```javascript
const ROUTER_TIMEOUT_MS = Number(process.env.ROUTER_LLM_TIMEOUT_MS || 15000);
const timeoutCtl = new AbortController();
const timer = setTimeout(
  () => timeoutCtl.abort(new Error(`Router timeout after ${ROUTER_TIMEOUT_MS}ms`)),
  ROUTER_TIMEOUT_MS
);
const mergedSignal = (AbortSignal?.any && config?.signal)
  ? AbortSignal.any([config.signal, timeoutCtl.signal])
  : (config?.signal || timeoutCtl.signal);

try {
  const res = await getRouterModel().invoke(messages, { signal: mergedSignal });
  // ...
} finally {
  clearTimeout(timer);
}
```

超时时 catch 块收到 AbortError → 走现有降级路径。

### 3b. 补齐 intent 分类规则

**涉及文件**：`TOT_backend/server/prompts/router.js:30-34`

在 `INTENT CLASSIFICATION RULES` 末尾追加：

```
- "progress_query": User asks about training progress/completion for a SPECIFIC entity they name (task/product/region). NO problem-seeking tone. Keywords: "进度", "进展", "完成率是多少", "做到哪了", "培训情况". Example: "iPhone 17 培训进展怎么样？"
- "analytics_query": User wants deep analysis beyond lookup: trends, forecasts, comparisons, root causes. Keywords: "分析", "趋势", "预测", "对比", "同比", "环比", "原因", "为什么". Example: "分析华东区Q1培训完成趋势"
```

### 3c. 扩展 entity schema

**涉及文件**：`TOT_backend/server/prompts/router.js:15-20`

将 entities JSON schema 从单字段改为 5 个 optional 字段：

```json
"entities": {
  "metric": { "raw": string, "canonical": string, "confidence": number },
  "region": { "raw": string, "canonical": string, "confidence": number },
  "store":  { "raw": string, "canonical": string, "confidence": number },
  "task":   { "raw": string, "canonical": string, "confidence": number },
  "rtm":    { "raw": string, "canonical": string, "confidence": number }
}
```

同步在 prompt 中追加 entity 提取说明：

```
ENTITY EXTRACTION: Extract entities from the user's message. Each field is optional — only fill what you find. Common examples:
- "华东" → region: { raw: "华东", canonical: "east_china", confidence: 0.95 }
- "S008" → store: { raw: "S008", canonical: "S008", confidence: 0.99 }
- "iPhone 17 新品培训" → task: { raw: "iPhone 17 新品培训", canonical: "iPhone 17 新品培训", confidence: 0.85 }
```

`flattenEntitiesForRepair`（nodes.js:865）不需要修改——它已遍历 `Object.entries(entities)` 的全部 key。

**改动规模**：~30 行

---

## P0-4：删除 graph.js `<5字 → chat_only` 短路规则

**涉及文件**：`TOT_backend/server/agent/graph/graph.js:11-13`

**问题**：当前 `routeAfterRouter` 有一个粗暴的规则：
```javascript
if (msg.length < 5) return "chat_only";
```

这导致"那华北呢？"（5 字）、"S008呢？"（5 字）被直接送往 FinalResponseStep 走闲聊，完全绕过 Router 和 FC 循环。这个规则比 P1-3 Intent 继承更优先——如果这里就短路了，后面注入 intent hint 的机会都没有。

**解决办法**：删除字数短路规则，改为问候/告别/感谢词白名单：

```javascript
// 替换 graph.js line 10-16 的 chat_only 判定：
if (state.mode === "chat_only" || state.intent === "chat_only") {
  const msg = (state.userMessage || '').trim().toLowerCase();
  const GREETING_PATTERNS = /^(你好|您好|hi|hello|hey|谢谢|thanks|thank you|再见|bye|好的谢谢|ok thanks|嗯|哦)[!！。.]*$/i;
  if (GREETING_PATTERNS.test(msg)) return "chat_only";
  // 其他短消息也走 tool_action 让 Router 判断
}
```

**验证**：eval cases 中"那华北呢？""S008呢？"这类简短追问应该被分类为 tool_action。

**改动规模**：~8 行

---

## P0-5：Seed 数据补齐 region 字段

**涉及文件**：`TOT_backend/server/db/seed.js:31-44`

**问题**（已验证）：10 家门店的 `region` 字段全部为 `''`。执行 `SELECT region, count(*) FROM stores GROUP BY region` 返回零行。这意味着：

- `getRegionDetailData("华东")` 永远返回空
- Router 即使正确提取了 `region: "华东"`，工具也查不到数据
- E2E eval 无法覆盖"华东区完成率""西南区门店详情"等核心区域下钻场景

**解决办法**：按城市分配区域，覆盖 5 个大区，每家 2 个门店：

```javascript
// seed.js STORE_DEFS，改 region: '' 为：
{ id: 'S001', region: '华东', city: '上海', ... },  // 优秀
{ id: 'S002', region: '华东', city: '南京', ... },  // 良好
{ id: 'S003', region: '华南', city: '广州', ... },  // 良好
{ id: 'S004', region: '华南', city: '深圳', ... },  // 良好
{ id: 'S005', region: '华北', city: '北京', ... },  // 良好
{ id: 'S006', region: '华北', city: '天津', ... },  // 待改进
{ id: 'S007', region: '西南', city: '成都', ... },  // 待改进
{ id: 'S008', region: '西南', city: '重庆', ... },  // 预警
{ id: 'S009', region: '东北', city: '沈阳', ... },  // 待改进
{ id: 'S010', region: '东北', city: '哈尔滨', ... },// 预警
```

重新 run seed 后，区域下钻场景可验证：
- "华东区完成率" → S001(90%) + S002(70%) 聚合
- "西南区门店详情" → S007(待改进) + S008(预警)，有区分度
- "华北怎么样" → S005(良好) + S006(待改进)，不同档位对比

**改动规模**：10 行字符串 + `node server/db/seed.js` 重跑

---

## P0-6：工具描述查漏补缺

**涉及文件**：
- `TOT_backend/server/chat_tools/tool_getRegionDetailData.js` — description 补中文关键词
- `TOT_backend/server/chat_tools/tool_runAnalytics.js` — description 补中文关键词

**审计结论**（已确认）：

| 工具 | 当前 description | 评价 |
|---|---|---|
| `queryExecutiveMetrics` | "查询培训任务的完成率、进度、耗时等具体数值指标。支持按大区/业态/经销商/门店维度分组对比和排序。需要指定 taskName 或 productName 来定位任务。注意：如果要查"重点关注"或"预警"门店，请用 getWarningsData。" | 优秀 |
| `getWarningsData` | "【预警专用】查询需要重点关注的门店列表。自动筛选进度最慢、完成率最低、或有P0/P1/P2危机的门店。当用户问"重点关注""预警""最差""落后"或任何问题性查询时，优先使用此工具。" | 优秀 |
| `searchEntities` | JSDoc 注释完善（5 类实体、搜索逻辑、模糊匹配说明） | 良好 |
| `getRegionDetailData` | "按区域下钻查询培训进度，包括区域汇总与门店表现排行" | **偏弱** — 缺少"华东""华南""华北""大区""门店详情""明细""各门店"等关键词 |
| `runAnalytics` | "执行高阶统计分析（分位数、分布、相关性等），返回结构化统计结果" | **偏弱** — 缺少"趋势""预测""对比""原因""同比""环比"等关键词 |

**改动**：

`tool_getRegionDetailData.js`：
```
// 旧：
description: '按区域下钻查询培训进度，包括区域汇总与门店表现排行',
// 新：
description: '按区域/大区下钻查询培训进度，包括区域汇总与各门店表现排行、明细、详情。支持华东/华南/华北/华中/西南等大区。用户问"华东区怎么样""各门店完成率"时使用。',
```

`tool_runAnalytics.js`：
```
// 旧：
description: '执行高阶统计分析（分位数、分布、相关性等），返回结构化统计结果',
// 新：
description: '执行高阶统计分析（趋势预测、同比环比对比、完成率分布、相关性分析等），返回结构化统计结果。用户问"分析趋势""预测完成率""对比去年同期""为什么下滑"时使用。',
```

**改动规模**：2 行 description 字符串

---

## P1-1：对话上下文 intent 继承

**涉及文件**（3 个，联动改动）：
- `TOT_backend/server/agent/graph/state.js:50-60` — 新增 `prevIntent` 字段
- `TOT_backend/server/services/chatService.js:780-786` — inputState 注入上一轮的 intent
- `TOT_backend/server/agent/graph/nodes.js:189-211` — Router 读取 `prevIntent` 注入 hint

**前置依赖**：P0-4（删除 <5 字短路）必须先做，否则短追问到不了 Router。

**架构背景**：当前每条新消息创建全新的 `thread_id`（`${sessionId}:${nanoid()}`），新 graph 的 state 是全新的，`state.intent` 永远为空。需要从 DB 中读取上一轮的 intent 并通过 inputState 传入。

**已验证**：`chat_messages` 表有 `intent_type TEXT` 列，`persistAndEmit`（nodes.js:1342）写入时填充了 `state.intent`。数据通路完整。

### 改动 A：state.js 新增 `prevIntent` 字段

```javascript
// ExecChatGraphState 中新增：
prevIntent: Annotation({ reducer: (x, y) => y ?? x, default: () => "" }),
```

### 改动 B：chatService.js 注入上一轮 intent

```javascript
// sendMessageStreamLangGraph，在构建 inputState（line 780）之前：
const lastAssistant = db.get(
  `SELECT intent_type FROM chat_messages 
   WHERE session_id = ? AND role = 'assistant' 
   ORDER BY created_at DESC LIMIT 1`,
  [sessionId]
);

const inputState = {
  userMessage,
  sessionId,
  userId: session.user_id.toString(),
  regionScope,
  messages: historyMessages,
  prevIntent: lastAssistant?.intent_type || ''  // ← 新增
};
```

### 改动 C：Router 读取 prevIntent

```javascript
// contextAnalyzerRouter，在 messages 构建之前：
let intentHint = '';
const prevIntent = state.prevIntent || '';
if (prevIntent && prevIntent !== 'chat_only') {
  const msgLen = (state.userMessage || '').trim().length;
  if (msgLen < 10) {
    intentHint = `\n\nCONTEXT: The last turn intent was "${prevIntent}" with entities ${JSON.stringify(state.entities || {})}. The current short message is likely a FOLLOW-UP. Do NOT classify as chat_only unless the user is clearly changing the topic.`;
  }
}
```

**验证**：eval cases 中"那华北呢？""S008呢？"应该保留上一轮的 intent。

**改动规模**：state.js +3 行，chatService.js +8 行，nodes.js +8 行 = ~19 行

---

## P1-2：BM25 prior 权重调整（eval 验证后合入）

**涉及文件**：`TOT_backend/server/agent/graph/nodes.js:312-340`

**前提**：必须先在 P0-1 baseline 上跑出当前的 Top-K 命中率，改后再跑 compare。

**改动**：
```javascript
// 当前（line 312-313）：
const PRIOR_BASE = 5;
const PRIOR_DECAY = 0.5;

// 改为：
const PRIOR_BASE = 10;
const PRIOR_DECAY = 1.0;          // seedList: 10, 9, 8, 7...
const BM25_MAX_BOOST = 3;         // BM25 最多 +3，无法颠覆 intent map 主导

// BM25 循环中加限制：
const bm25Boost = Math.min(score, BM25_MAX_BOOST);
scoreById.set(id, (scoreById.get(id) || 0) + bm25Boost);
```

**合入条件**：eval 对比显示 Top-K 命中率提升且无退化 case。

**改动规模**：~5 行

---

## P2：维护性重构

P0/P1 全部完成并验证后，再启动 P2。单独一个 PR。

### P2-1 nodes.js 拆分为 6 个文件

同 v1 计划 Phase 3.1。核心原则：
- 无环依赖（已画依赖图确认）
- 拆分后跑 eval 确保结果一致
- 全局 grep 确认无其他文件直接 require 旧 `nodes.js`

### P2-2 路由旧路径清理

基于已确认的路由分析（`routes/chat.js` 第 46-50、121-133 行）：

1. 修改 `routes/chat.js`：删除 `legacy_stream` 分支，默认 regenerate 改走 LangGraph
2. 修改 `chatService.js`：删除 `sendMessageStream`（~133行）、`regenerateLastAssistantStream`（~229行）、`regenerateLastAssistant`（~153行）
3. `module.exports` 移除对应函数名

---

## 执行顺序和依赖关系

```
P0-1  Eval 体系搭建
  ├─→ P0-2  response_format json_object     (跑 eval verify)
  ├─→ P0-3  超时 + intent规则 + entity schema (跑 eval verify)
  ├─→ P0-4  删除 <5字 短路                   (跑 eval verify)
  ├─→ P0-5  Seed 补齐 region 字段             (重跑 seed)
  └─→ P0-6  工具描述查漏补缺                  (跑 eval verify)
        ↓
      P1-1  Intent 继承                      (state+chatService+nodes 联动)
        ↓
      P1-2  BM25 权重调整                    (跑 eval --compare 决定合入)
        ↓
      P2    文件拆分 + 旧路径清理              (单独 PR)
```

---

## 预估工作量

| 阶段 | 内容 | 预估 |
|---|---|---|
| P0-1 | Eval 体系（40 条 case + 脚本） | 3-4h |
| P0-2 | response_format json_object | 0.5h |
| P0-3 | 超时 + prompt + schema | 1.5h |
| P0-4 | 删除 <5字 短路 | 0.5h |
| P0-5 | Seed 补齐 region（10 行 + 重跑） | 0.5h |
| P0-6 | 工具描述查漏补缺 | 0.5h |
| P1-1 | Intent 继承（state + chatService + nodes） | 1.5h |
| P1-2 | BM25 权重 | 0.5h |
| P2 | 拆分 + 清理 | 4-5h |
| **合计** | | **13-15.5h** |
