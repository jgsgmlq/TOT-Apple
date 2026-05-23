# TOT Executive Chat — 领域词汇与设计决策

## 领域词汇

| 术语 | 定义 |
|------|------|
| **conversation** | 会话级上下文：最近 5 轮自然语言对话，每轮包含 user 消息 + assistant 的 narrative 和 provenance。从 chat_message 表加载，注入 safetyGateway 和 finalResponse |
| **narrative** | assistant 回复中所有自然语言内容的拼接（markdown 分析文本 + keyNumbers 标签 + insights 标注），等价于 `_contentText` 字段 |
| **provenance** | 每次工具查询的数据来源信息（scope 统计口径 + cutoff 数据截止时间），附着在 assistant 回复上，供后续追问消解和对比上下文 |
| **long-term memory** | 跨会话持久化的用户记忆，三种类型：user（偏好习惯）、feedback（行为反馈）、project（业务上下文）。存储在 user_memory 表，每 10 轮触发 LLM 提取，注入 safetyGateway 和 finalResponse |
| **structured card** | 前端结构化卡片渲染（markdown、keyNumbers、chart、table、insights、suggestions），按需渲染 |
| **plottable dataset** | 从 toolResults 提取的可画图数据集，由代码生成保证数据不含幻觉 |
| **HITL** (Human-in-the-Loop) | 人在回路中断：SafetyGateway 检测到参数缺失时挂起图执行，前端展示澄清卡片 |
| **FC loop** (Function Calling loop) | LangGraph 的工具调用循环：LLM 决策 → 去重 → 执行 → 合并 → 判断是否继续 |
| **done event** | SSE 流的结束事件，承载 replyContent（结构化与纯文本） |
| **keyNumbers** | 3-6 个关键指标（label + value + unit），用于醒目展示 |
| **insights** | 数据洞察，每条带 level（warning/info/positive）和 text |
| **suggestions** | 追问建议列表，每条为可独立输入的数据查询问题 |
| **session cache** | chatSessionStateService 的进程内存缓存，按 tool signature 精确匹配去重，避免重复调用同一工具+参数 |

## 记忆系统架构

### 双层模型

```
会话级上下文 (Session Context)
  - 最近 5 轮自然语言对话
  - 生命周期：一次会话
  - 存储：chat_message 表 (content_text = narrative)
  - 加载：loadContext 节点每次请求时从 DB 查询

长期记忆 (Long-term Memory)
  - user: 用户偏好与习惯（"偏好柱状图"、"默认关注华东"）
  - feedback: 行为纠正与交互偏好（"对比时自动排名"、"P3预警不提醒"）
  - project: 业务上下文与领域知识（"iPhone 17 是 P0 任务"、"华东含直营店"）
  - 生命周期：跨会话持久
  - 存储：user_memory 表
  - 提取：BullMQ Worker，每 10 轮触发
  - 加载：loadContext 节点每次请求时从 DB 查询
```

### 各 Agent 注入内容

| | safetyGateway | FC | finalResponse |
|---|---|---|---|
| conversation (5轮) | x | | x |
| 当前实体 | | x | |
| 当前消息 | | x | |
| 本轮 toolResults | | | x |
| 长期记忆 | x | | x |

## 组件展示决策

### overview → narrative

原来的 `overview` 概念已废弃。assistant 回复不再区分"总结段"和"非总结段"，narrative 是所有自然语言内容的聚合（markdown + keyNumbers + insights）。

### table 与 chart 的数据源统一

- table 与 chart 共用 plottable dataset 体系，LLM 决定每个 dataset 用 chart、table、或两者
- 同一 dataset 可同时分给 chart 和 table，但 LLM 需确保 table 提供额外信息
- 禁止同一份数据既画完全等价的图又列完全等价的表

### insights / suggestions 可选化

- 简单查询 LLM 应返回空数组
- 复杂分析 LLM 应产出有意义的 warn/info/positive 条目

## 输出模板体系

| 模板 | 场景 | 组件 |
|------|------|------|
| `simple_metric` | 简单数字查询 | narrative + keyNumbers |
| `ranking` | 排名对比 | narrative + chart/table + insights |
| `overview` | 总体概况 | narrative + keyNumbers + funnel |
| `warning` | 预警排查 | narrative + table + insights |
| `diagnosis` | 数据诊断 | narrative + 归因分析 + 下钻建议 + chart/table |
| `general` | 兜底 | 自由 Markdown |

## 数据契约

- Chart 数据格式：`{ type, title?, xAxis?, series }`
- 后端 `extractPlottableData` 负责从 `toolResults` 提取所有可画数据集
- 前端 `AiChartRenderer` 对不认识的 chart type fallback 到 `bar`
