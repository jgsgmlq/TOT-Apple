# 歧义消除系统 v3 设计

## 问题诊断

当前系统在用户问"查看某个任务"时，经常找不到任务，原因是三层防护缺失：

1. **SafetyGateway 提取不干净**：用户输入"那个跨渠道BAU的任务看看情况"，整个当成 task_name。口语噪音词没有剥离
2. **searchTasks 无容错**：完整 LIKE 匹配失败后就放弃了，不会拆关键词重试
3. **HITL task_not_found 无帮助**：说"未找到任务"但 options 为空

## 解决方案：三层防线

```
用户输入
    ↓
【防线 1】SafetyGateway — 口语理解 + 指代消解 + self-review
    ↓  输出干净的 task_name，或标记 ambiguity
【防线 2】searchTasks — normalize + 2-gram 关键词 fallback
    ↓  精确匹配 → 关键词匹配 → 宽泛兜底
【防线 3】HITL task_not_found — 带候选的选项
    ↓  至少给用户几个"可能是指"的选项
```

### 防线 1：SafetyGateway 口语理解 + self-review

**方案**：只改 prompt，不改 schema。

**新增 task_name 提取规则**：

```
【task_name 提取进阶规则】
- 提纯：用户常说"那个XX的任务""看一下XX""查查XX的情况""XX这个任务怎么样"
  → 从中提取核心任务名 XX，去掉"那个""看一下""的任务""的情况""怎么样"等口语外壳
- 指代消解：用户说"第三个""刚刚那个""上面提到的" → 看对话历史中 assistant 回复，
  找到对应任务，提取 assistant 回复中使用的准确任务名（确保字符一致性）
- 部分匹配：用户只说了任务名的一部分（如"跨渠道"），就提取这部分，不要编造完整名称
```

**新增利用对话历史规则**：

```
【利用对话历史】
对话历史中包含了上一轮 assistant 的回复。当用户用代词或简略说法指代之前提到的内容时，
务必查看对话历史来消歧：
- "第三个任务" → 看助理回复中列举的第 3 个任务是什么
- "刚刚那个" → 看上一轮讨论的是哪个任务
- "看看XX"（XX 不完整）→ 如果助理回复中有类似名称的任务，用助理回复中的准确写法
```

**新增 self-review 步骤**：

```
【task_name 自审】
提取 task_name 后，反问自己：
- 这个名称像一个真实的培训任务名吗？
- 它包含"这个""那个""它""第X个"等指代信息吗？
- 用户是在引用对话历史中的任务吗？（如果是，从历史中取准确名称）
如果不像正常任务名或存在歧义，用 ambiguity 标记而非强行猜测。
```

**不做的**：代码级 sanitizeTaskName()。噪音模式枚举不完，LLM 懂中文语法，靠 prompt 指导就够了。

### 防线 2：searchTasks 关键词容错

在 `searchTasks` 中增加 fallback 逻辑：

当完整 LIKE 匹配返回 0 时：

1. **关键词匹配**：将 `filters.name` 做 `normalizeForNameSearch()` 后，按中文 2-gram 拆词，每个关键词 `LIKE '%kw%'`
2. **按匹配度排序**：匹配到的关键词数量多的排前面，取前 5 个
3. **如果关键词也找不到**：去掉 name 条件，按 category/platform/status 宽泛搜索，返回前 5 个

`normalizeForNameSearch` 扩展现有全角转半角逻辑，补全常见字符：

```javascript
function normalizeForNameSearch(str) {
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
  const tokens = [];
  for (let i = 0; i < normalized.length - 1; i++) {
    tokens.push(normalized.slice(i, i + 2));
  }
  tokens.push(normalized);
  return [...new Set(tokens)];
}
```

### 防线 3：HITL task_not_found 带候选

`resolveEntities.js` 的 `buildAmbiguityPayload` — 当 `status=not_found` 时：

改为用 `searchTasks`（去掉 name 条件，保留 category/platform/statuses）做宽泛搜索填 options，不再用 `taskCrud.getTaskList()`。

```javascript
// not_found case: 用宽泛条件重搜填候选
const fallbackMatches = await dashboardMysqlCrud.searchTasks({
  category: qf.task_category,
  platform: qf.platform,
  statuses,
  limit: 5,
});
options: fallbackMatches.map(t => ({
  id: t.task_publish_id,
  label: t.task_title,
  value: t.task_publish_id,
  subtitle: `${t.model_type || ''} · 截止 ${t.due_date ? t.due_date.slice(0, 10) : '--'}`,
}))
```

## 实现决策总结

| 决策 | 选择 |
|------|------|
| SafetyGateway 改进方式 | prompt-only，加口语理解 + self-review，不加 schema 字段 |
| 代码级 sanitizeTaskName | 不做——噪音模式枚举不完 |
| searchTasks 2-gram | 保留——过度设计没坏处 |
| HITL 候选来源 | 统一用 `searchTasks`，不用 `taskCrud.getTaskList()` |
| 实现顺序 | 三个防线同时做 |

## 改动范围

| 文件 | 改动 |
|------|------|
| `prompts/src/safety_gateway_v2.md` | 增加口语理解规则、指代消解规则、对话历史利用、self-review 步骤 |
| `modules/dashboard/crud/dashboardMysqlCrud.js` | `searchTasks` 增加关键词 fallback；新增/扩展 normalize 函数；新增 `tokenizeForSearch` |
| `agent/graph/nodes/resolveEntities.js` | `buildAmbiguityPayload` 的 not_found case 用 searchTasks 填 options |

## 验证方式

```bash
# 测试口语噪音剥离
curl ... "那个跨渠道BAU的任务看看具体情况" → 期望：正确匹配到任务

# 测试部分关键词
curl ... "跨渠道" → 期望：找到包含"跨渠道"的任务

# 测试指代消解（需要两轮对话）
第1轮："有哪些进行中的任务" → 返回任务列表
第2轮："看看第三个" → 期望：正确找到第3个任务

# 测试找不到但有候选
curl ... "不存在的任务名XYZ" → 期望：HITL 返回相关任务的候选列表，不为空
```
