# ADR 0002: Final Response 两轮规划-执行架构

## 背景

当前 Final Response Agent 采用单轮 LLM 调用：把所有可用数据集（含 sample 数据）和用户问题一起喂给 LLM，一次性生成最终回复 blocks。这导致三个问题：

1. 数据集过多时 LLM 倾向"每个都用上"，产生重复图表
2. LLM 先看到数据再想问题，而非先想问题再找数据
3. 回答缺乏聚焦，为做图而做图，而非服务于用户的信息需求

## 决策

将 Final Response 拆分为两轮 LLM 调用：**规划（Planner）→ 执行（Final Response）**。

**关键洞察**：两轮拿到的是**完全相同的数据**。区别不在数据，而在 **prompt 和 output schema**。

**Planner（第一轮）**：
- 看到完整数据，但 output schema 限制它只能输出"分析"（analysis + selectedDatasets + suggestedApproach），不能输出 blocks
- 站在用户角度思考"用户想知道什么、需要哪些信息、以什么方式呈现"
- 输出自然语言分析，不是硬性组件指令

**Final Response（第二轮）**：
- 看到相同数据 + Planner 的分析结果
- Prompt 以 `[问题分析]` 段开头，拿到已经做好的思考
- 基于分析和数据生成最终 blocks
- Planner 的分析是参考，不是硬约束

## 替代方案

**方案 A：两轮不同数据（Planner 只看目录）**：Planner 只看数据目录（无 sample），减少数据量但需要额外生成目录。被否决——目录摘要质量难以保证，不如让 Planner 直接看完整数据。

**方案 B：只重构提示词（不改架构）**：把"先规划后选数据"的逻辑写在一个 prompt 里。更简单但效果有限——单轮模式下 LLM 没有"只思考不输出"的强制约束。

**方案 C：加硬性的 blocks 模板系统**：预定义每种问题类型的 blocks 组合，LLM 只需填充数据。可预测但僵化——高管的问题经常跨类型，模板系统反而限制灵活性。

## 权衡

**增加的复杂度**：
- 两次 LLM 调用，延迟增加约 2-3 秒（从 ~4 秒到 ~6-7 秒）
- 两个独立的 prompt 文件需要维护
- 第一轮也有 repair loop，代码路径多了一倍

**获得的收益**：
- 回答聚焦用户问题，先想后做
- output schema 强制分离"规划"和"执行"，LLM 无法混在一起
- 两个 prompt 职责分明，各自独立调优
- Planner 的分析可复用（未来可以做缓存）

## 影响

- `finalResponseStep.js` 是唯一改动较大的文件
- 其他 graph 节点不受影响
- 前端只在 `AiChartRenderer.vue` 加 funnel 类型支持
- 不涉及数据库变更
