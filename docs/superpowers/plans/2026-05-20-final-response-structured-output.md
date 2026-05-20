# FinalResponse 结构化输出实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** FinalResponseStep tool 模式输出结构化 JSON（对齐前端 ReplyContent），带三层降级兜底。

**Architecture:** 新建 FinalResponse prompt + Zod schema → finalResponseStep.js tool 分支改调 withStructuredOutput → 落库双列 (content_text + content_json) → 失败降级 eCh3.0 渲染器。

**Tech Stack:** Node.js, LangChain.js, Zod, DeepSeek-chat

---

## Task 1: 创建 FinalResponse prompt 文件

**Files:**
- Create: `TOT_backend/server/prompts/final_response.js`

- [ ] **Step 1: 写 prompt 文件**

```js
// TOT_backend/server/prompts/final_response.js
'use strict';

const FINAL_RESPONSE_VERSION = 'final_response/v1';

const FINAL_RESPONSE_PROMPT = `你是培训数据分析师。根据工具查询结果，输出结构化回答。

【字段选择规则】
- overview：必填。1-3 句话给结论，先回答用户最关心的数字。不要用"根据查询结果"开头。
- keyNumbers：提取 3-6 个最关键的指标。label 用中文（"完成率"而非"completionRate"）。value 用原始数字或百分比。有单位才填 unit。
- attentionPoints：发现异常/风险/亮点时才填。每条带 level：
  · warning = 落后、逾期、预警，需要管理者关注
  · info = 补充背景信息
  · positive = 表现优异，值得肯定
  不要空洞的泛泛而谈，每条必须有具体数字支撑。
- table：有对比/排名/名单时使用（≥2行+≥2列）。title 必填，columns 用中文。数据太少不建表。
- visualizations：有 ≥3 个对比实体且差异 ≥5% 时，用 AVAILABLE CHART DATA 提供的图表数据。不要编造。
- followUpSuggestions：2-3 个自然的下一步问题。引导用户继续探索，不要重复用户刚问过的问题。
- statisticsProvenance：始终填。包含"统计口径"和"数据截止"两项。

【图表与表格互补规则】
- 图和表同时出现时：图展示核心差异（Top/Bottom N），表放完整排名。信息不重复。
- 图里有的数字表里不一定有，表里有的趋势图来表现。

【硬约束】
- 严格输出指定 JSON schema，不要额外文字或 markdown 包裹
- 所有数字来自工具查询结果，不编造
- overview 中的数字与 keyNumbers 保持一致
- forecastDisclaimer 仅在涉及预测时填，否则为 null`;

module.exports = { FINAL_RESPONSE_VERSION, FINAL_RESPONSE_PROMPT };
```

- [ ] **Step 2: 运行 node --check**

```bash
cd TOT_backend/server && node --check prompts/final_response.js
```

Expected: 无输出。

- [ ] **Step 3: 提交**

```bash
git add TOT_backend/server/prompts/final_response.js
git commit -m "feat: add FinalResponse structured output prompt"
```

---

## Task 2: 注册 prompt

**Files:**
- Modify: `TOT_backend/server/prompts/registry.js`

- [ ] **Step 1: 在 registry.js 中添加注册**

在 require 区域加上：
```js
const { FINAL_RESPONSE_VERSION, FINAL_RESPONSE_PROMPT } = require('./final_response');
```

在 PROMPTS 对象中加上：
```js
final_response: { version: FINAL_RESPONSE_VERSION, get: () => FINAL_RESPONSE_PROMPT },
```

- [ ] **Step 2: 运行 node --check**

```bash
cd TOT_backend/server && node --check prompts/registry.js
```

Expected: 无输出。

- [ ] **Step 3: 提交**

```bash
git add TOT_backend/server/prompts/registry.js
git commit -m "feat: register final_response prompt"
```

---

## Task 3: 改造 finalResponseStep.js — tool 模式走结构化输出

**Files:**
- Modify: `TOT_backend/server/agent/graph/nodes/finalResponseStep.js`

- [ ] **Step 1: 添加 Zod schema 定义和工具结果预处理**

在文件头部 require 之后、`sanitizeUserFacingMarkdown` 之前插入：

```js
const { z } = require("zod");

const FinalResponseOutput = z.object({
  overview: z.string(),
  keyNumbers: z.array(z.object({
    label: z.string(),
    value: z.union([z.string(), z.number()]),
    unit: z.string().optional(),
  })),
  attentionPoints: z.array(z.object({
    level: z.enum(["warning", "info", "positive"]),
    text: z.string(),
  })),
  followUpSuggestions: z.array(z.string()),
  visualizations: z.array(z.object({
    type: z.enum(["bar", "line", "pie"]),
    title: z.string(),
    option: z.record(z.any()),
  })).optional(),
  statisticsProvenance: z.object({
    "统计口径": z.string(),
    "数据截止": z.string(),
  }).passthrough(),
  forecastDisclaimer: z.string().nullable().optional(),
  table: z.object({
    title: z.string(),
    columns: z.array(z.string()),
    rows: z.array(z.array(z.string())),
  }).nullable().optional(),
});

// 预处理 toolResults：提取纯数据，去包装
function prepareToolData(toolResults) {
  const items = [];
  for (const [, entry] of Object.entries(toolResults || {})) {
    if (!entry) continue;
    let parsed = entry.data;
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed); } catch (_) { /* keep raw */ }
    }
    items.push({
      toolName: entry.toolName || null,
      data: parsed,
      error: entry.error || (parsed && parsed.error) || null,
    });
  }
  return items;
}
```

- [ ] **Step 2: 替换工具总结分支**

找到 tool mode 的 else 分支（约 line 81-127），将 LLM 总结那段替换为：

```js
    } else {
      const toolResultKeys = Object.keys(state.toolResults || {});
      if (toolResultKeys.length > 0) {
        console.log('[FinalResponseStep] 工具查询完成，调用 FinalResponse LLM (structured)...');
        const emitter = config?.configurable?.sseEmitter;
        const llm = getFcModel();
        const traceId = config?.configurable?.traceId;
        const client = getClient();
        const gen = client && traceId
          ? client.generation({ traceId, name: 'FinalResponse_Structured', model: 'deepseek-chat', input: maskPII(state.userMessage), metadata: { mode: 'tool' } })
          : NOOP_TRACE.generation({ name: 'FinalResponse_Structured' });

        const toolItems = prepareToolData(state.toolResults);
        const resultsText = JSON.stringify(toolItems, null, 2).slice(0, 4000);

        // decideChart 已生成的图表数据
        const { decideChart } = require('../decideChart');
        const suggestedChart = decideChart(state.toolResults || {}, state.intent);
        const chartBlock = suggestedChart
          ? `\n\nAVAILABLE CHART DATA (可修改 title/colors，但不要编造数据):\n` + JSON.stringify(suggestedChart, null, 2)
          : '';

        const prompt = promptRegistry.get('final_response');
        const fullPrompt = prompt + `\n\n用户问题: ${state.userMessage}\n\n工具查询结果:\n${resultsText}\n${chartBlock}`;

        try {
          const structuredModel = llm.withStructuredOutput(FinalResponseOutput, {
            name: "final_response",
            method: "jsonMode",
          });
          const parsed = await structuredModel.invoke([
            new SystemMessage(fullPrompt),
            new HumanMessage('根据以上数据生成结构化回答，严格遵守 JSON schema。')
          ], { signal: config?.signal });

          response = JSON.stringify(parsed);

          // 流式推送 JSON 给前端
          if (emitter && typeof emitter.handleLLMNewToken === 'function') {
            emitter.handleLLMNewToken(response, { isReasoning: false });
          }
          endGeneration(gen, { output: maskPII(preview(response)), model: 'deepseek-chat' });
        } catch (err) {
          console.error('[FinalResponseStep] 结构化输出失败，降级到渲染器:', err.message);
          endGeneration(gen, { output: maskPII(preview(err.message)), level: 'WARNING', statusMessage: err.message, model: 'deepseek-chat' });
          response = renderToolResultsMarkdown(state.toolResults || {}, state.intent) || '抱歉，查询过程中遇到了问题。';
        }
      } else {
        response = renderToolResultsMarkdown(state.toolResults || {}, state.intent) || "抱歉，我暂时无法回答这个问题，或者执行过程中遇到了错误。请稍后重试或尝试缩小查询范围。";
      }
    }
```

- [ ] **Step 3: 更新返回值的 content_json**

将最后 return 语句（约 line 130-132）改为：

```js
  response = sanitizeUserFacingMarkdown(response);
  endSpan(span, { output: preview(response), metadata: { responseBytes: response.length } });

  // 提取 overview 文本用于 content_text
  let overviewText = response;
  try {
    const parsed = JSON.parse(response);
    if (parsed.overview) overviewText = parsed.overview;
  } catch (_) { /* not JSON, use full response */ }

  return {
    finalResponse: response,
    reply_markdown: response,
    reply_content_json: response,   // 结构化 JSON（或降级文本）
    reply_overview_text: overviewText,
    messages: [new AIMessage({ content: response })]
  };
```

- [ ] **Step 4: 运行 node --check**

```bash
cd TOT_backend/server && node --check agent/graph/nodes/finalResponseStep.js
```

Expected: 无输出。

- [ ] **Step 5: 提交**

```bash
git add TOT_backend/server/agent/graph/nodes/finalResponseStep.js
git commit -m "feat: FinalResponseStep tool mode → structured JSON output"
```

---

## Task 4: 更新 persistAndEmit.js — 双列落库

**Files:**
- Modify: `TOT_backend/server/agent/graph/nodes/persistAndEmit.js`

- [ ] **Step 1: 替换 insertMessage 调用**

将原来的：
```js
await chatCrud.insertMessage({
  id: assistMsgId, sessionId, role: 'assistant',
  contentText: replyContent,
  intentType: state.intent || null,
});
```

替换为：
```js
const contentJson = state.reply_content_json || replyContent;
const overviewText = state.reply_overview_text || replyContent;

// 使用 MySQL run 直接写入双列
const { run } = require('../../../modules/common/db/mysql');
await run(
  `INSERT INTO chat_message (id, session_id, role, content_text, content_json, intent_type, created_at)
   VALUES (?, ?, ?, ?, ?, ?, NOW(3))`,
  [assistMsgId, sessionId, 'assistant', overviewText, contentJson, state.intent || null]
);

await chatCrud.updateSessionActive(sessionId);
```

（同时删除原来的 `chatCrud.insertMessage()` 调用，因为 content_json 不在 insertMessage 参数中）

- [ ] **Step 2: 运行 node --check**

```bash
cd TOT_backend/server && node --check agent/graph/nodes/persistAndEmit.js
```

Expected: 无输出。

- [ ] **Step 3: 提交**

```bash
git add TOT_backend/server/agent/graph/nodes/persistAndEmit.js
git commit -m "feat: persist structured JSON in content_json column"
```

---

## Task 5: E2E 验证

- [ ] **Step 1: 重启服务**

```bash
pkill -f "node.*app.js" 2>/dev/null; sleep 2
cd TOT_backend/server && node app.js &
sleep 3
curl -s http://localhost:3000/api/health
```

- [ ] **Step 2: 测试结构化输出**

```bash
cd TOT_backend/server && node -e "
require('dotenv').config({ path: '../.env' });
const chatCrud = require('./modules/dashboard/crud/chatCrud');
const { nanoid } = require('nanoid');

(async () => {
  const sid = 'struct-' + nanoid(6);
  await chatCrud.createSession({ id: sid, userId: 'CENTRAL_001', entryType: 'executive', scopeType: 'national' });

  const { buildGraph } = require('./agent/graph/graph');
  const { SqliteSaver } = require('@langchain/langgraph-checkpoint-sqlite');
  const app = (buildGraph()).compile({ checkpointer: SqliteSaver.fromConnString(':memory:') });

  console.log('=== iPad mini 培训完成率？ ===');
  const state = await app.invoke({
    userMessage: 'iPad mini 培训完成率怎么样？', sessionId: sid, userId: 'CENTRAL_001',
    regionScope: { type: 'national' }, messages: []
  }, { configurable: { thread_id: sid }, recursionLimit: 60 });

  const reply = state.reply_markdown || state.finalResponse || '';

  // 验证是 JSON
  let parsed;
  try { parsed = JSON.parse(reply); } catch (_) { parsed = null; }

  if (parsed) {
    console.log('✅ 输出是有效 JSON');
    console.log('  overview:', parsed.overview?.slice(0, 100));
    console.log('  keyNumbers:', parsed.keyNumbers?.length, '个');
    console.log('  attentionPoints:', parsed.attentionPoints?.length, '个');
    console.log('  followUpSuggestions:', parsed.followUpSuggestions?.length, '个');
    const ok = parsed.overview && parsed.keyNumbers?.length > 0;
    console.log(ok ? '✅ 结构化输出完整' : '⚠️ 部分字段缺失');
  } else {
    console.log('⚠️ 非 JSON，降级到纯文本');
    console.log('  回复:', reply.slice(0, 300));
  }

  // 验证 MySQL 双列落库
  const msgs = await chatCrud.getMessages(sid);
  const lastMsg = msgs[msgs.length - 1];
  console.log('');
  console.log('content_json 存在:', lastMsg?.content_json ? '✅' : '❌');

  process.exit(0);
})().catch(err => { console.error('FAIL:', err.message); process.exit(1); });
"
```

Expected: `✅ 输出是有效 JSON`，`✅ 结构化输出完整`，`✅ content_json 存在`

- [ ] **Step 3: 测试降级链路**

把 DEEPSEEK_API_KEY 故意写错，确认降级到 renderer：

```bash
cd TOT_backend/server && node -e "
// 暂存原 key，注入错误 key
const orig = process.env.DEEPSEEK_API_KEY;
process.env.DEEPSEEK_API_KEY = 'bad-key';
// ... 同上测试 ...
// 恢复
process.env.DEEPSEEK_API_KEY = orig;
"
```

Expected: 降级到 `renderToolResultsMarkdown` 生成的 Markdown，非 JSON 但包含数据。

- [ ] **Step 4: 提交**

```bash
git add -A && git commit -m "test: verify FinalResponse structured output E2E"
```

---

## 不改的文件

- SafetyGateway、FC 循环、chat_tools — 不动
- 前端 — 不动（JSON 在 Markdown 渲染器中以文本形式展示，后续前端升级渲染）
- decideChart.js — 只读引用，不修改
- MySQL 表结构 — 不执行 DDL
