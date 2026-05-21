# TOT Executive Chat — 领域词汇与设计决策

## 领域词汇

| 术语 | 定义 |
|------|------|
| **structured card** | 前端结构化卡片渲染（hero/overview、keyNumbers、chart、table、insights、suggestions），按需渲染 |
| **plottable dataset** | 从 toolResults 提取的可画图数据集，由代码生成保证数据不含幻觉 |
| **HITL** (Human-in-the-Loop) | 人在回路中断：SafetyGateway 检测到参数缺失时挂起图执行，前端展示澄清卡片 |
| **FC loop** (Function Calling loop) | LangGraph 的工具调用循环：LLM 决策 → 去重 → 执行 → 合并 → 判断是否继续 |
| **done event** | SSE 流的结束事件，承载 `replyContent`（结构化）与 `markdownContent`（纯文本） |
| **overview** | 最终回答的自然语言总结段 |
| **keyNumbers** | 3-6 个关键指标（label + value + unit），用于醒目展示 |
| **attentionPoints** | 异常/风险/亮点标注，每条带 level（warning/info/positive），可选 |
| **followUpSuggestions** | 追问建议列表，可选 |

## 前端展示设计决策

### Template 合并

原来三条互斥分支合并为一条条件渲染路径：

```
overview    → 永远渲染（Markdown 文本段）
keyNumbers  → 有则渲染
chart       → 有则渲染（按数据集逐条）
table       → 有则渲染
attentionPoints → 有则渲染
suggestions → 有则渲染
```

不再区分「纯 Markdown」和「结构化卡片」两条路径。每个组件独立判断数据是否存在。

### overview 与 keyNumbers 的 LLM 策略

- 数据 ≤3 个 → keyNumbers 主导，overview 精简
- 数据 >3 个 → overview 总结，keyNumbers 精选最重要的 3-6 个

### table 与 chart 的数据源统一

- table 与 chart 共用 plottable dataset 体系，LLM 决定每个 dataset 用 chart、table、或两者
- 同一 dataset 可同时分给 chart 和 table，但 LLM 需确保 table 提供额外信息（更多行、更多列、或精确数值）
- 禁止同一份数据既画完全等价的图又列完全等价的表

### attentionPoints / followUpSuggestions 可选化

- 简单查询（如「这个任务多少人」）LLM 应返回空数组
- 复杂分析（如门店排名对比）LLM 应产出有意义的 warn/info/positive 条目

## 数据契约

- Chart 数据格式与前端 `ChartData` 类型一致：`{ type, title?, xAxis?, series }`
- 后端 `extractPlottableData` 负责从 `toolResults` 提取所有可画数据集
- 前端 `AiChartRenderer` 对不认识的 chart type fallback 到 `bar`
