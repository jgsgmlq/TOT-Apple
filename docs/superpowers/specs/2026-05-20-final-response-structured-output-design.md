# FinalResponse 结构化输出设计

> 2026-05-20 | 分支: macstudio | 基于 eChat 3.0 渲染器 + 5/18 Agent 重构 spec §6

## 1. 目标

将 FinalResponseStep 的输出从纯 Markdown 文本升级为结构化 JSON，前端可按 section 渲染卡片（overview → charts → keyNumbers → table → insights → suggestions → provenance），同时保留纯文本兜底。

## 2. 输出 Schema

对齐前端现有 `ReplyContent` 接口，渐进升级：

```ts
{
  overview: string,                                                    // 必填，1-3句话结论先行
  keyNumbers: { label: string, value: string|number, unit?: string }[], // 有核心数字就填3-6个，无则[]
  attentionPoints: { level: "warning"|"info"|"positive", text: string }[], // 有洞察就填，无则[]
  followUpSuggestions: string[],                                       // 必填，2-3个追问建议
  visualizations?: { type: "bar"|"line"|"pie", title: string, option: object }[], // 由decideChart.js提供
  statisticsProvenance: object,                                        // 必填，{统计口径, 数据截止}
  forecastDisclaimer?: string | null,                                  // 预测类才有
  table?: { title: string, columns: string[], rows: string[][] } | null // 对比/排名/名单时填
}
```

**字段名对齐策略：** 沿用前端现有命名（`attentionPoints` 而非 `insights`，`visualizations` 而非 `charts`，`followUpSuggestions` 而非 `suggestions`），减少前端改动。`attentionPoints` 从 `string[]` 升级为 `{level,text}[]` 向下兼容——前端只取 `.text` 仍可正常渲染。

## 3. 图与表的选择规则

LLM 根据数据形态自动决定用什么字段，规则写在 prompt 里：

| 条件 | 输出 |
|------|------|
| ≥3 个对比实体 + 数值差异 ≥5% | 用 `visualizations` 画图（展示趋势/排名/差异） |
| ≥2 行 + ≥2 列的结构化数据 | 用 `table`（展示精确数字供比较） |
| 图和表同时出现 | 图展示核心差异（Top/Bottom N），表放完整排名，互补不重复 |
| 只有 1-2 个核心数字 | 只用 `keyNumbers`，不画图不建表 |

判断交给 LLM——它比代码更理解数据的"对比价值"。Prompt 里写明以上规则。

## 4. FinalResponseStep 流程

```
FC 循环结束 → state.toolResults
    │
    ├─ mode=deny → 静态拒绝文案（同现有）
    ├─ mode=chat → LLM 流式生成纯文本（同现有，不需要结构化）
    │
    └─ mode=tool:
        │
        ├─ 预处理 toolResults
        │   └─ 提取 { toolName, data, error }，去包装，截断超大结果
        │
        ├─ 组装 prompt
        │   ├─ 用户问题
        │   ├─ 预处理后的 tool 数据
        │   ├─ decideChart.js 生成的图表建议
        │   └─ 图/表选择规则
        │
        ├─ LLM withStructuredOutput (Zod schema)
        │   ├─ 成功 → 结构化 JSON
        │   └─ 失败 → renderToolResultsMarkdown() 兜底（eCh3.0 风格渲染器）
        │
        └─ 落库
            ├─ content_text = overview 文本
            ├─ content_json = 完整结构化 JSON
            └─ reply_markdown = renderToolResultsMarkdown 降级文本
```

## 5. 存储策略

MySQL `chat_message` 双列写：

| 列 | 内容 | 用途 |
|----|------|------|
| `content_text` | overview 纯文本 | 历史列表预览、TTS 朗读 |
| `content_json` | 完整结构化 JSON | 前端卡片渲染、后续分析 |
| `tool_calls_json` | FC 循环中调用的工具列表 | 调试、trace |

## 6. 降级链路（三层兜底）

1. **LLM 结构化输出成功** → 返回 JSON → 前端渲染卡片
2. **LLM 输出 JSON 但 Zod 校验失败** → `repairJson` 修复 → 重试解析 → 仍失败则降级
3. **LLM 调用失败 / repairJson 失败** → `renderToolResultsMarkdown()` 用代码从 toolResults 生成 Markdown（eCh3.0 渲染器：按数据形态选模版，限制显示行数，加追问引导）

## 7. Prompt 设计要点

### 角色
培训数据分析师。根据工具查询结果回答管理者的问题。

### 字段选择规则
```
- overview：每条回复必填。1-3 句话给结论，先回答用户最关心的数字。
- keyNumbers：提取 3-6 个最关键的指标。label 用中文（"完成率"而非"completionRate"）。
- attentionPoints：发现异常/风险/亮点时才填。每条带 level。
  · warning = 落后、逾期、预警，需要管理者关注
  · info = 补充背景信息
  · positive = 表现优异，值得肯定
- table：有对比/排名/名单时使用。title 必填，columns 用中文。数据太少（<2行）不建表。
- visualizations：有 ≥3 个对比实体且差异 ≥5% 时，用 AVAILABLE CHART DATA 提供的图表。不编造。
- followUpSuggestions：2-3 个自然的下一步问题。引导用户继续探索。
- statisticsProvenance：始终填 { "统计口径": "...", "数据截止": "..." }
```

### 图表与表格互补规则
```
- 图和表同时出现时：图展示核心差异（Top/Bottom N），表放完整排名。信息不重复。
- 图里有的数字表里不一定有，表里有的趋势图来表现。
```

### 硬约束
```
- 严格输出指定 JSON schema，不要额外文字或 markdown 包裹
- 所有数字来自工具查询结果，不编造
- overview 中的数字与 keyNumbers 保持一致
```

## 8. 改动范围

| 文件 | 操作 | 内容 |
|------|------|------|
| `prompts/final_response.js` | **新建** | FinalResponse system prompt |
| `prompts/registry.js` | 修改 | 注册 `final_response` prompt |
| `agent/graph/nodes/finalResponseStep.js` | 修改 | tool 模式走 withStructuredOutput |
| `agent/graph/renderers.js` | 保留 | 作为兜底渲染器 |

## 9. 不改的范围

- SafetyGateway、FC 循环、chat_tools
- 前端（后续渐进适配）
- 数据库（仅使用已有列 content_text / content_json）
- chat 模式和 deny 模式的 FinalResponse 逻辑

## 10. 验证标准

- [ ] "iPad mini 培训完成率" → keyNumbers + overview，不含 table
- [ ] "各区域完成率排名" → table + visualizations
- [ ] "有哪些门店需要重点关注" → attentionPoints(level=warning) + table
- [ ] LLM JSON 解析失败时 → renderToolResultsMarkdown 兜底
- [ ] content_json 正确写入 MySQL
- [ ] 前端现有 Markdown 渲染不受影响
