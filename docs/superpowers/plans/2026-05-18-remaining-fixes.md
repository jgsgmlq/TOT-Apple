# Memory & HITL 健壮性修复计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Memory 提取的 JSON 解析脆弱性 + 注入相关性过滤 + HITL resumeType 显式化 + cancel 路径修复

**Architecture:** Memory 用 Zod structured output 替代正则，注入加关键词匹配；HITL 前端显式传 resume_type，ToolMessage 用 JSON string

**Tech Stack:** Node.js, Zod, @langchain/openai

**已有修复:** extract LIMIT 2→6 ✅, inject LIMIT 5 ✅

---

### Task 1: Memory 提取用 Zod structuredOutput 替代正则

**Files:**
- Modify: `TOT_backend/server/services/chatMemoryService.js:128-141`

- [ ] **Step 1: 加 Zod schema，改用 simpleChat structured output**

```js
// 在文件顶部加：
const { z } = require('zod');

const MemoryItem = z.object({
  type: z.string(),
  content: z.string(),
  action: z.enum(["ADD", "UPDATE"]),
});

const MemoryOutput = z.array(MemoryItem);
```

- [ ] **Step 2: 替换 `simpleChat` 为带 structured output 的调用**

在 `extract()` 函数中，原来的 `simpleChat` 调用改为：

```js
const { ChatOpenAI } = require('@langchain/openai');

const memoryModel = new ChatOpenAI({
  modelName: "deepseek-chat",
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: process.env.DEEPSEEK_API_BASE_URL || "https://api.deepseek.com/v1" },
  temperature: 0.1,
  maxTokens: 512,
});

// 在 extract() 内，替换 simpleChat 调用：
const structuredModel = memoryModel.withStructuredOutput(MemoryOutput, {
  name: "memory_extract",
  method: "jsonMode",
});

const llmStart = Date.now();
let extracted;
try {
  extracted = await structuredModel.invoke([
    { role: 'system', content: MEMORY_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ]);
} catch (err) {
  // ... 错误处理
}

// 直接使用 extracted，不再需要 JSON.parse + regex
if (!Array.isArray(extracted) || extracted.length === 0) {
  // empty...
}
```

- [ ] **Step 3: 删除正则解析代码**

删除 `response.match(/\[[\s\S]*\]/)` 和相关 try-catch JSON.parse 逻辑。

- [ ] **Step 4: 验证**

```bash
node -e "require('./TOT_backend/server/services/chatMemoryService'); console.log('mem OK')"
```

- [ ] **Step 5: Commit**

```bash
git add TOT_backend/server/services/chatMemoryService.js
git commit -m "fix: use Zod structuredOutput for memory extraction"
```

---

### Task 2: 记忆注入加关键词相关性过滤

**Files:**
- Modify: `TOT_backend/server/services/chatMemoryService.js:202-216` (getMemories)
- Modify: `TOT_backend/server/agent/graph/nodes/loadContext.js:161-181` (loadContext)

- [ ] **Step 1: 修改 getMemories，接受可选 userMessage 参数做关键词过滤**

```js
function getMemories(userId, userMessage) {
  const rows = db.all(`
    SELECT memory_type, content
    FROM user_memories
    WHERE user_id = ?
      AND (
        memory_type != 'mid_term'
        OR (memory_type = 'mid_term' AND created_at > datetime('now', '-14 days'))
      )
    ORDER BY updated_at DESC
    LIMIT 10
  `, [userId]);
  if (!rows || !rows.length) return '';

  // 如果有当前用户消息，做关键词匹配过滤
  let filtered = rows;
  if (typeof userMessage === 'string' && userMessage.trim()) {
    const keywords = userMessage.split(/[，。！？\s,!\?]+/).filter(w => w.length >= 2);
    if (keywords.length > 0) {
      filtered = rows
        .map(r => {
          const hits = keywords.filter(kw => r.content.includes(kw)).length;
          return { ...r, _hits: hits };
        })
        .filter(r => r._hits > 0)
        .sort((a, b) => b._hits - a._hits);
      // 如果过滤后为空，退回全量 Top 5
      if (filtered.length === 0) filtered = rows.slice(0, 5).map(r => ({ ...r, _hits: 0 }));
    }
  }

  return filtered.slice(0, 5).map(r => `- [${r.memory_type}] ${r.content}`).join('\n');
}
```

- [ ] **Step 2: 更新 loadContext 调用，传入 userMessage**

```js
// loadContext.js 中
const rawMemories = chatMemoryService.getMemories(state.userId, state.userMessage);
```

- [ ] **Step 3: 验证加载**

```bash
node -e "const g = require('./TOT_backend/server/agent/graph/graph'); g.buildGraph(); console.log('OK')"
```

- [ ] **Step 4: Commit**

```bash
git add TOT_backend/server/services/chatMemoryService.js TOT_backend/server/agent/graph/nodes/loadContext.js
git commit -m "feat: keyword-based relevance filter for memory injection"
```

---

### Task 3: HITL resumeType 显式化

**Files:**
- Modify: `TOT_backend/server/agent/graph/nodes/humanInTheLoopGate.js:26-29`

- [ ] **Step 1: 优先使用显式 resume_type，降级到旧判断**

```js
// 替换 line 27-28
const resumeType = normalized?.resume_type
  || (normalized?.type === 'intent_shift' ? 'intent_shift' : null)
  || (normalized?.selected_option_id?.startsWith('clarify_') ? 'intent_shift' : 'slot_fill');
```

- [ ] **Step 2: Commit**

```bash
git add TOT_backend/server/agent/graph/nodes/humanInTheLoopGate.js
git commit -m "fix: prefer explicit resume_type in HITL gate"
```

---

### Task 4: HITL cancel 路径 ToolMessage content 修复

**Files:**
- Modify: `TOT_backend/server/agent/graph/nodes/humanInTheLoopGate.js:54-58`

- [ ] **Step 1: 将 error 对象 JSON.stringify**

```js
// 替换 line 55-57
const cancelMessages = (state.pending_tool_calls || []).map(tc =>
  makeToolMessage(
    { id: tc.id || 'unknown', name: tc.name || 'clarify_intent' },
    JSON.stringify({ error: 'User cancelled this operation due to intent shift.' })
  )
);
```

- [ ] **Step 2: 验证测试**

```bash
npx jest --testPathPatterns="graph/__tests__"
```

- [ ] **Step 3: Commit**

```bash
git add TOT_backend/server/agent/graph/nodes/humanInTheLoopGate.js
git commit -m "fix: JSON.stringify cancel ToolMessage content in HITL"
```

---

## 文件变更总览

| Task | 文件 | 改动 |
|------|------|------|
| 1 | `chatMemoryService.js` | Zod structuredOutput 替代正则 JSON 解析 |
| 2 | `chatMemoryService.js` + `loadContext.js` | getMemories 加关键词过滤，loadContext 传 userMessage |
| 3 | `humanInTheLoopGate.js` | resumeType 显式化 |
| 4 | `humanInTheLoopGate.js` | cancel ToolMessage JSON.stringify |
