# 歧义消除系统 v3 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 三层防线增强歧义消除系统：SafetyGateway 口语理解 + searchTasks 关键词容错 + HITL not_found 带候选。

**Architecture:** SafetyGateway prompt-only（口语理解 + self-review），searchTasks 加 normalize + 2-gram fallback，resolveEntities 补 not_found 宽泛搜索，extractContentText 补 table 提取。

**Tech Stack:** Node.js, MySQL, DeepSeek Chat, Zod

---

### Task 1: normalizeForNameSearch + tokenizeForSearch 纯函数 (TDD)

**Files:**
- Create: `TOT_backend/server/modules/dashboard/crud/__tests__/nameNormalize.test.js`
- Modify: `TOT_backend/server/modules/dashboard/crud/dashboardMysqlCrud.js`

**TDD: Yes** — 纯函数，输入字符串 → 输出字符串/数组。

- [ ] **Step 1: 写测试**

```javascript
// TOT_backend/server/modules/dashboard/crud/__tests__/nameNormalize.test.js
'use strict';

const { normalizeForNameSearch, tokenizeForSearch } = require('../dashboardMysqlCrud');

describe('normalizeForNameSearch', () => {
  test('removes whitespace', () => {
    expect(normalizeForNameSearch('跨渠道 BAU')).toBe('跨渠道BAU');
  });

  test('converts fullwidth pipe to halfwidth', () => {
    expect(normalizeForNameSearch('Chat Mock｜跨渠道')).toBe('ChatMock|跨渠道');
  });

  test('converts fullwidth parentheses', () => {
    expect(normalizeForNameSearch('任务（BAU）')).toBe('任务(BAU)');
  });

  test('converts fullwidth comma, colon, semicolon, exclamation', () => {
    expect(normalizeForNameSearch('A，B：C；D！')).toBe('A,B:C;D!');
  });

  test('handles mixed fullwidth and whitespace', () => {
    expect(normalizeForNameSearch('Chat Mock ｜ 跨渠道 （NPI）')).toBe('ChatMock|跨渠道(NPI)');
  });

  test('returns unchanged for already normalized input', () => {
    expect(normalizeForNameSearch('跨渠道BAU')).toBe('跨渠道BAU');
  });
});

describe('tokenizeForSearch', () => {
  test('returns 2-grams plus full string', () => {
    const result = tokenizeForSearch('跨渠道');
    expect(result).toContain('跨渠');
    expect(result).toContain('渠道');
    expect(result).toContain('跨渠道'); // full string
  });

  test('deduplicates tokens', () => {
    const result = tokenizeForSearch('aa');
    // 'aa' → 2-grams: ['aa'], full: 'aa', deduped to ['aa']
    expect(result).toEqual(['aa']);
  });

  test('normalizes before tokenizing', () => {
    const result = tokenizeForSearch('A｜B');
    // normalize: 'A|B', 2-grams: ['A|', '|B'], full: 'A|B'
    expect(result).toContain('A|B');
    expect(result).toContain('A|');
    expect(result).toContain('|B');
  });

  test('handles single character', () => {
    const result = tokenizeForSearch('跨');
    expect(result).toEqual(['跨']);
  });
});
```

- [ ] **Step 2: 运行测试，验证失败**

Run: `cd TOT_backend/server && npx jest modules/dashboard/crud/__tests__/nameNormalize.test.js --verbose`
Expected: FAIL — `normalizeForNameSearch is not defined`

- [ ] **Step 3: 实现函数**

在 `dashboardMysqlCrud.js` 开头（module.exports 之前）添加：

```javascript
function normalizeForNameSearch(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/\s+/g, '')
    .replace(/｜/g, '|')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/，/g, ',')
    .replace(/：/g, ':')
    .replace(/；/g, ';')
    .replace(/！/g, '!');
}

function tokenizeForSearch(str) {
  const normalized = normalizeForNameSearch(str);
  if (normalized.length === 0) return [];
  const tokens = [];
  for (let i = 0; i < normalized.length - 1; i++) {
    tokens.push(normalized.slice(i, i + 2));
  }
  tokens.push(normalized);
  return [...new Set(tokens)];
}
```

然后在文件底部更新 exports：

```javascript
module.exports = {
  getTaskById, getOrgTreeByTaskId, getOrgByStoreName, getOrgByDealerName,
  getTaskList, getCampaignList, getQueueByTaskId,
  searchTasks, searchOrg,
  normalizeForNameSearch, tokenizeForSearch,
};
```

- [ ] **Step 4: 运行测试，验证通过**

Run: `cd TOT_backend/server && npx jest modules/dashboard/crud/__tests__/nameNormalize.test.js --verbose`
Expected: 9 PASS

- [ ] **Step 5: 全量回归**

Run: `cd TOT_backend/server && npx jest --passWithNoTests 2>&1 | tail -3`
Expected: 无新增失败

- [ ] **Step 6: Commit**

```bash
cd /Users/pipi/tot-apple-review && git add \
  TOT_backend/server/modules/dashboard/crud/__tests__/nameNormalize.test.js \
  TOT_backend/server/modules/dashboard/crud/dashboardMysqlCrud.js
git commit -m "feat: add normalizeForNameSearch and tokenizeForSearch for fullwidth/halfwidth normalization"
```

---

### Task 2: extractContentText Table Block 提取 (TDD)

**Files:**
- Modify: `TOT_backend/server/agent/graph/nodes/finalResponseStep.js:126-142`
- Modify: `TOT_backend/server/agent/graph/__tests__/node-helpers.test.js`

**TDD: Yes** — 纯函数，blocks array → text。

- [ ] **Step 1: 写测试**

在 `node-helpers.test.js` 添加：

```javascript
const { extractContentText } = require('../nodes/finalResponseStep');

describe('extractContentText', () => {
  test('extracts markdown content', () => {
    const result = extractContentText([
      { type: 'markdown', content: 'hello world' },
    ]);
    expect(result).toContain('hello world');
  });

  test('extracts table block rows as text', () => {
    const result = extractContentText([
      { type: 'table', title: '任务列表', datasetId: 'ds1' },
    ]);
    // table block without resolved data won't crash
    expect(typeof result).toBe('string');
  });

  test('extracts suggestions as text', () => {
    const result = extractContentText([
      { type: 'suggestions', items: ['查一下完成率', '对比各区域'] },
    ]);
    expect(result).toContain('查一下完成率');
    expect(result).toContain('对比各区域');
  });
});
```

先确认 `extractContentText` 是否已在 module.exports 中。如果不在，需先加到 exports。

- [ ] **Step 2: 运行测试，验证失败**

Run: `cd TOT_backend/server && npx jest agent/graph/__tests__/node-helpers.test.js --verbose`
Expected: 新增 table/suggestions 相关测试至少部分 FAIL

- [ ] **Step 3: 实现**

修改 `extractContentText`：

```javascript
function extractContentText(blocks) {
  const parts = [];
  for (const block of blocks) {
    if (block.type === 'markdown') {
      parts.push(block.content);
    } else if (block.type === 'keyNumbers') {
      for (const item of block.items) {
        parts.push(`${item.label}: ${item.value}${item.unit || ''}`);
      }
    } else if (block.type === 'insights') {
      for (const item of block.items) {
        parts.push(`[${item.level}] ${item.text}`);
      }
    } else if (block.type === 'table') {
      parts.push(block.title || '');
    } else if (block.type === 'suggestions') {
      for (const item of block.items) {
        parts.push(item);
      }
    }
  }
  return parts.join('\n');
}
```

确认 `extractContentText` 在 module.exports 中（增加 export）。

- [ ] **Step 4: 运行测试，验证通过**

Run: `cd TOT_backend/server && npx jest agent/graph/__tests__/node-helpers.test.js --verbose`
Expected: 所有 extractContentText 测试 PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/pipi/tot-apple-review && git add \
  TOT_backend/server/agent/graph/nodes/finalResponseStep.js \
  TOT_backend/server/agent/graph/__tests__/node-helpers.test.js
git commit -m "feat: extractContentText supports table and suggestions blocks"
```

---

### Task 3: searchTasks 关键词 fallback

**Files:**
- Modify: `TOT_backend/server/modules/dashboard/crud/dashboardMysqlCrud.js` （约 400-420 行，`searchTasks` 函数内的 name 匹配逻辑之后）

**TDD: No** — 集成 SQL 查询，适合手动验证。

- [ ] **Step 1: 实现 searchTasksWithFallback**

在 `searchTasks` 函数内，当完整 LIKE（现有的主查询）返回 0 时，添加 fallback：

```javascript
// 现有代码：查询后 if (matches.length === 0 && filters.name) { ... }
// 在原有 fallback（去掉 name 用 category+platform 重搜）之后，新增关键词 fallback：

if (matches.length === 0 && filters.name) {
  // 先尝试关键词匹配
  const tokens = tokenizeForSearch(filters.name);
  if (tokens.length > 0) {
    // 构建 OR LIKE 条件，每个 token 一个 LIKE
    const tokenConds = tokens.map(() => 'tp.task_title LIKE ?').join(' OR ');
    const tokenParams = tokens.map(t => `%${t}%`);
    
    const keywordSql = `SELECT ... FROM task_publish tp
      LEFT JOIN campaign_activity ca ON ca.task_publish_id = tp.task_publish_id
      WHERE tp.publish_status IN (${statuses.map(() => '?').join(',')})
        AND (${tokenConds})
      ORDER BY ... LIMIT 5`;
    
    const keywordMatches = await all(keywordSql, [...statuses, ...tokenParams]);
    
    // 按匹配 token 数量排序，整串匹配加权
    const scored = keywordMatches.map(row => {
      const normalizedTitle = normalizeForNameSearch(row.task_title || '');
      const matchCount = tokens.filter(t => normalizedTitle.includes(t)).length;
      // 整串包含：完整 normalized input 在 title 中，权重 +10
      const fullMatch = normalizedTitle.includes(normalizeForNameSearch(filters.name)) ? 10 : 0;
      return { ...row, match_score: matchCount + fullMatch };
    });
    scored.sort((a, b) => b.match_score - a.match_score);
    matches = scored.slice(0, 5);
  }
}
```

- [ ] **Step 2: 验证服务器加载无语法错误**

Run: `node -e "require('/Users/pipi/tot-apple-review/TOT_backend/server/modules/dashboard/crud/dashboardMysqlCrud')" && echo "SYNTAX OK"`

- [ ] **Step 3: 重启后端 + 手动测试口语噪音查询**

重启后端，发送测试查询："那个跨渠道BAU的任务看看具体情况"
期望：从日志看 searchTasks 返回匹配结果，而非 0 matches

- [ ] **Step 4: Commit**

```bash
cd /Users/pipi/tot-apple-review && git add \
  TOT_backend/server/modules/dashboard/crud/dashboardMysqlCrud.js
git commit -m "feat: add keyword tokenization fallback to searchTasks for fuzzy name matching"
```

---

### Task 4: buildAmbiguityPayload fallbackOptions + resolveEntities 宽泛搜索 (TDD)

**Files:**
- Modify: `TOT_backend/server/agent/graph/nodes/resolveEntities.js:96-134`
- Modify: `TOT_backend/server/agent/graph/__tests__/buildAmbiguityPayload.test.js`

**TDD: Yes** — `buildAmbiguityPayload` 是纯函数，新增参数可测试。

- [ ] **Step 1: 写测试**

在 `buildAmbiguityPayload.test.js` 添加：

```javascript
test('task_not_found with fallbackOptions fills options', () => {
  const result = { tasks: { status: 'not_found', items: [] } };
  const filters = { task_name: 'XYZ' };
  const fallbackOptions = [
    { task_publish_id: 't1', task_title: '跨渠道BAU', model_type: 'BAU', due_date: '2026-06-01' },
    { task_publish_id: 't2', task_title: 'iPhone培训', model_type: 'NPI', due_date: '2026-06-15' },
  ];
  const payload = buildAmbiguityPayload(result, filters, fallbackOptions);
  expect(payload.type).toBe('task_not_found');
  expect(payload.options).toHaveLength(2);
  expect(payload.options[0].label).toBe('跨渠道BAU');
});

test('task_not_found without fallbackOptions returns empty options', () => {
  const result = { tasks: { status: 'not_found', items: [] } };
  const filters = { task_name: 'XYZ' };
  const payload = buildAmbiguityPayload(result, filters);
  expect(payload.type).toBe('task_not_found');
  expect(payload.options).toEqual([]);
});
```

- [ ] **Step 2: 运行测试，验证失败**

Run: `cd TOT_backend/server && npx jest agent/graph/__tests__/buildAmbiguityPayload.test.js --verbose`
Expected: 新增测试 FAIL — `payload.options` undefined

- [ ] **Step 3: 修改 buildAmbiguityPayload**

```javascript
function buildAmbiguityPayload(result, filters, fallbackOptions) {
  // ... 现有 task_ambiguous / org_ambiguous 逻辑不变 ...

  if (result.tasks && result.tasks.status === 'not_found') {
    const options = fallbackOptions && fallbackOptions.length > 0
      ? fallbackOptions.map(t => ({
          id: t.task_publish_id,
          label: t.task_title,
          value: t.task_publish_id,
          subtitle: `${t.model_type || ''} · 截止 ${t.due_date ? t.due_date.slice(0, 10) : '--'}`,
        }))
      : [];
    return {
      type: 'task_not_found',
      prompt: `未找到"${filters.task_name || '该条件'}"对应的任务。${options.length > 0 ? '以下可能是您要找的任务：' : '请问是哪个任务？'}`,
      question: `未找到"${filters.task_name || '该条件'}"对应的任务。请问是哪个任务？`,
      options,
      resume_type: 'slot_fill',
    };
  }
  // ...
}
```

- [ ] **Step 4: 修改 resolveEntities not_found 流程**

```javascript
// resolveEntities: 在 not_found case 中，调用宽泛搜索
if (matches.length === 0) {
  result.tasks = { status: 'not_found', items: [] };
  result.needs_clarification = true;
  
  // 执行宽泛搜索准备 fallbackOptions
  const fallbackMatches = await dashboardMysqlCrud.searchTasks({
    category: qf.task_category,
    platform: qf.platform,
    statuses,
    limit: 5,
  });
  result._fallbackOptions = fallbackMatches; // 暂存
}

// ... 后续 ...
const ambiguity_payload = result.needs_clarification
  ? buildAmbiguityPayload(result, qf, result._fallbackOptions)
  : null;
```

- [ ] **Step 5: 运行测试，验证通过**

Run: `cd TOT_backend/server && npx jest agent/graph/__tests__/buildAmbiguityPayload.test.js --verbose`
Expected: 新增测试 PASS，已有测试保持 PASS

- [ ] **Step 6: 全量回归**

Run: `cd TOT_backend/server && npx jest --passWithNoTests 2>&1 | tail -3`
Expected: 无新增失败

- [ ] **Step 7: Commit**

```bash
cd /Users/pipi/tot-apple-review && git add \
  TOT_backend/server/agent/graph/nodes/resolveEntities.js \
  TOT_backend/server/agent/graph/__tests__/buildAmbiguityPayload.test.js
git commit -m "feat: add fallbackOptions to buildAmbiguityPayload, broad search on task_not_found"
```

---

### Task 5: SafetyGateway v2.md Prompt 更新

**Files:**
- Modify: `TOT_backend/server/prompts/src/safety_gateway_v2.md`

**TDD: No** — 纯 prompt 文件。

- [ ] **Step 1: 替换 task_name 提取规则**

将当前第 43 行的 `- task_name：...` 替换为：

```markdown
【task_name 提取进阶规则】
- 提纯：用户常说"那个XX的任务""看一下XX""查查XX的情况""XX这个任务怎么样"
  → 从中提取核心任务名 XX，去掉"那个""看一下""的任务""的情况""怎么样"等口语外壳
- 指代消解：用户说"第三个""刚刚那个""上面提到的" → 看对话历史中 assistant 回复，
  找到对应任务，提取 assistant 回复中使用的准确任务名（确保字符一致性）
- 部分匹配：用户只说了任务名的一部分（如"跨渠道"），就提取这部分，不要编造完整名称
- 不强制完整：大多数时候用户不会打完整任务名，2-3 个关键词足够用于搜索匹配
```

- [ ] **Step 2: 在 ambiguity 段之前添加对话历史利用和 self-review**

```markdown
【利用对话历史】
对话历史中包含了上一轮 assistant 的回复。当用户用代词或简略说法指代之前提到的内容时，
务必查看对话历史来消歧：
- "第三个任务" → 看助理回复中列举的第 3 个任务是什么
- "刚刚那个" → 看上一轮讨论的是哪个任务
- "看看XX"（XX 不完整）→ 如果助理回复中有类似名称的任务，用助理回复中的准确写法

【task_name 自审】
提取 task_name 后，反问自己：
- 这个名称像一个真实的培训任务名吗？
- 它包含"这个""那个""它""第X个"等指代信息吗？
- 用户是在引用对话历史中的任务吗？（如果是，从历史中取准确名称）
如果不像正常任务名或存在歧义，用 ambiguity 标记而非强行猜测。
```

- [ ] **Step 3: 验证 prompt 可正确加载**

Run: `node -e "const {loadPrompt} = require('/Users/pipi/tot-apple-review/TOT_backend/server/prompts/loader'); const t = loadPrompt('safety_gateway_v2'); console.log('OK:', t.includes('提纯') && t.includes('自审') && t.includes('对话历史'))"`
Expected: `OK: true`

- [ ] **Step 4: Commit**

```bash
cd /Users/pipi/tot-apple-review && git add \
  TOT_backend/server/prompts/src/safety_gateway_v2.md
git commit -m "feat: add oral language understanding, coreference resolution, and self-review to safety gateway"
```

---

### Task 6: 全量回归测试 + 端到端验证

**Files:**
- 无新建

**TDD: No** — 集成验证。

- [ ] **Step 1: 运行所有测试**

Run: `cd TOT_backend/server && npx jest --passWithNoTests 2>&1 | tail -5`

- [ ] **Step 2: 前端编译**

Run: `cd TOT_frontend && pnpm build 2>&1 | tail -5`

- [ ] **Step 3: 重启前后端 + 端到端测试**

```bash
# 口语噪音剥离
curl ... "那个跨渠道BAU的任务看看具体情况" → 期望：正确匹配

# 部分关键词
curl ... "iPhone 培训" → 期望：找到相关任务

# 找不到但有候选
curl ... "完全不存在的任务XYZ" → 期望：HITL 返回候选列表不为空
```

- [ ] **Step 4: Commit（如有修复）**

```bash
cd /Users/pipi/tot-apple-review && git add ... && git commit -m "fix: regression fixes from ambiguity v3"
```
