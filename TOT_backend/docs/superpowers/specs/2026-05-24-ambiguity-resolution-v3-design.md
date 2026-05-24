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
    ↓  精确匹配 → 关键词匹配（整串加权）→ 宽泛兜底
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

**对话历史完整性**：`extractContentText` 目前只提取 markdown/keyNumbers/insights 的文本，不提取 table block 内容。需要补上 table 数据，确保对话历史中 tables 里的任务名也能被 SafetyGateway 看到。

**兜底**：指代消解最终仍失败时，走 HITL 让用户选择/重新输入。

### 防线 2：searchTasks 关键词容错

在 `searchTasks` 中增加 fallback 逻辑：

当完整 LIKE 匹配返回 0 时：

1. **关键词匹配**：`normalizeForNameSearch()` + 中文 2-gram 拆词，每个关键词 `LIKE '%kw%'`
2. **按匹配度排序**：匹配到的关键词数量多的排前面。**整串包含加权最高**——如果 normalize 后的完整输入直接出现在 task_title 的 normalize 结果中，排第一
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
  tokens.push(normalized); // 完整字符串，整串匹配权重最高
  return [...new Set(tokens)];
}
```

### 防线 3：HITL task_not_found 带候选

`buildAmbiguityPayload` 保持纯函数。异步 I/O（宽泛搜索）留在 `resolveEntities` 里完成，结果通过新参数传入：

```javascript
// resolveEntities: not_found 时先做宽泛搜索
const fallbackMatches = await dashboardMysqlCrud.searchTasks({
  category: qf.task_category,
  platform: qf.platform,
  statuses,
  limit: 5,
});
const payload = buildAmbiguityPayload(result, qf, fallbackMatches);
```

`buildAmbiguityPayload` 新增第三个参数 `fallbackOptions`，not_found case 时用它填 options。不用 `taskCrud.getTaskList()`。

## 实现决策总结

| 决策 | 选择 |
|------|------|
| SafetyGateway 改进方式 | prompt-only，加口语理解 + self-review，不升级 schema |
| 代码级 sanitizeTaskName | 不做——噪音模式枚举不完 |
| 对话历史完整性 | 补 extractContentText 对 table 的提取 |
| searchTasks 2-gram | 保留——过度设计没坏处 |
| 关键词匹配排序 | 整串包含加权最高 |
| HITL 候选来源 | 统一用 `searchTasks`，不用 `taskCrud.getTaskList()` |
| buildAmbiguityPayload | 保持纯函数，fallbackOptions 参数传入 |
| ADR | 不需要——ADR-0001 已覆盖架构，v3 是渐进增强 |
| 实现顺序 | 三个防线同时做 |

## 改动范围

| 文件 | 改动 |
|------|------|
| `prompts/src/safety_gateway_v2.md` | 口语理解规则、指代消解、对话历史利用、self-review |
| `agent/graph/nodes/finalResponseStep.js` | `extractContentText` 补 table block 提取 |
| `modules/dashboard/crud/dashboardMysqlCrud.js` | `searchTasks` 关键词 fallback；扩展 normalize；新增 tokenizeForSearch |
| `agent/graph/nodes/resolveEntities.js` | not_found case 宽泛搜索填 fallbackOptions；`buildAmbiguityPayload` 新增参数 |

## 验证方式

```bash
# 测试口语噪音剥离
curl ... "那个跨渠道BAU的任务看看具体情况" → 期望：正确匹配到任务

# 测试部分关键词
curl ... "跨渠道" → 期望：找到包含"跨渠道"的任务

# 测试指代消解（两轮对话）
第1轮："有哪些进行中的任务" → 返回任务列表
第2轮："看看第三个" → 期望：正确找到第3个任务

# 测试找不到但有候选
curl ... "不存在的任务名XYZ" → 期望：HITL 返回候选列表，不为空
```
