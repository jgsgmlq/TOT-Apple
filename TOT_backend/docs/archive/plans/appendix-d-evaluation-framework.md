# 附件 D：Langfuse 评估体系设计 (Evaluation Framework)

**目标**: 为 Executive Chat 从 legacy 架构迁移至 LangGraph 提供可量化的测试与持续演进基建，确保复杂的“四层优化”、“动态路由”和“多级记忆”在上线前及迭代中不发生退化。

---

## D1. 评估体系概览

本体系基于 **Langfuse Dataset + Experiment + Score** 构建，将传统的手工回归测试升级为**自动化、多维度的 Agentic 评估流水线**。核心思想是通过“场景矩阵”穷举测试用例，并通过“线上 Bad Case 回流”实现测试集的持续增长。

- **Dataset（考卷）**: 沉淀高管真实查询场景、边缘测试用例及历史 Bug。
- **Experiment（考试）**: 将 Dataset 批量输入特定版本的 LangGraph 实例，收集运行轨迹 (Trace)。
- **Score（阅卷）**: 结合确定性规则与 LLM-as-a-Judge，对图执行的各个关键中间节点及最终回答进行精准打分。

---

## D2. 基于“场景矩阵法”构建初始测试集 (Dataset Construction)

摒弃凭经验发散写用例的方式，采用 **业务对象 × 操作类型** 的场景矩阵来系统性构建 D1-D4 数据集，确保核心能力的正交覆盖。

### D2.1 场景矩阵 (Scenario Matrix) 维度示例

- **业务对象 (Business Objects)**：`区域 (Region)`、`门店 (Store)`、`任务 (Task)`、`产品 (Product)`。
- **操作类型 (Operation Types)**：`单点查询 (Query)`、`横向对比 (Compare)`、`看趋势/极值 (Trend/TopN)`、`查异常/预警 (Warning)`。

通过笛卡尔积生成穷举测试用例，例如：
- `区域 × 看趋势` = “华东大区过去三个月的完成率变化”
- `门店 × 查异常` = “找出上周进度为 0 的门店”

### D2.2 Dataset Item 标准结构

存入 Langfuse Dataset 的每一条 case 必须包含严谨的结构化定义：

```json
{
  "input": "对比华东和华南本月进度，找出落后门店",
  "expected_tools": ["queryExecutiveMetrics", "getWarningsData"],
  "expected_output": {
    "contains_facts": ["华东完成率", "华南完成率"],
    "routing_tier": "L4_heavy_fc"
  }
}
```

### D2.3 黄金数据集分类规划

| 数据集名称 | 测试焦点 | 预期行为 (Expected) | 适用阶段 |
|---|---|---|---|
| **D1_Core_Query** (核心直达) | 矩阵生成的单对象、单操作查询（如“查看华东区完成率”） | 触发 `L2_intent_fastpath`，工具选择 100% 正确，参数提取无误。 | PoC 主链路 |
| **D2_Complex_FC** (复杂编排) | 矩阵生成的多对象组合、模糊时间查询 | 路由至 **`L4_heavy_fc`**，**`fc_*` 多步**工具链正确，无幻觉汇总。 | PoC+ / 复杂档调参 |
| **D3_Robustness** (鲁棒与异常) | 错别字、关键参数缺失、越权请求、恶意指令 | **`ContextAnalyzerRouter`** 结构化实体纠错或触发 `HumanInTheLoopGate`；恶意/注入类与业务拒答由 **Router + 规则前置** 与 **`fc_ExecuteTool`** 前硬校验协同（与附件 A §A10.4 一致）。 | 护栏优化期 |
| **D4_Memory_MultiTurn** (记忆多轮) | 多轮追问、依赖过往偏好的查询（如“我不看华东”，“全国进度如何”） | `LoadContext` 成功注入偏好，回答遵循该偏好（即全国剔除华东）。 | 记忆链路期 |

---

## D3. 多维打分体系 (Langfuse Scores)

摒弃单一的“回答好坏”评价，针对 LangGraph 的图结构特性，我们在实验运行后收集以下 Score：

### D3.1 确定性指标 (Deterministic Scores)
由评估脚本基于 Trace 结构自动计算，无需消耗大模型算力：

- **`tool_selection_accuracy` (0/1)**：实际调用的工具集合（从 Trace 中 **`fc_ExecuteTool`** 或等价 span 提取）是否与 Dataset 标注的 `expected_tools` **一致**。约定：**默认按「集合相等」判定（无序）**；若某用例要求严格顺序（罕见），在 Dataset Item 中增加 `expected_tools_ordered: true` 并由脚本分支处理。V2 若引入 Plan，再增加 `expected_plan_tools` 等字段。
- **`routing_compliance` (0/1)**：系统动态计算的 `selected_tier` (L1-L4) 是否符合该用例的预期复杂度。
- **`param_first_pass_rate` (0/1)**：参数是否在不经过 **`fc_ParamRepair`** 的情况下，一次性通过 **`fc_ValidateParams`** 的 JSON Schema 和业务校验。
- **`latency_ms` & `total_token_cost` (Numeric)**：衡量执行成本与速度，重点监控 L3/L4 链路的资源消耗。

### D3.2 裁判模型指标 (LLM-as-a-Judge Scores)
调用强大的裁判模型（如 GPT-4o / Claude 3.5 Sonnet），根据预设 Rubric 对最终输出进行打分：

- **`answer_helpfulness` (1-5)**：最终 Markdown 内容是否直接、准确地解答了高管的问题。
- **`hallucination_rate` (0/1)**：交叉比对大模型最终回答与 `toolResults` 中的原始数据，检查是否存在捏造的数据点或结论。
- **`memory_adherence` (0/1)**：(针对 D4 数据集) 最终回答是否严格遵循了从 Store 中 `LoadContext` 注入的用户中长期偏好。

---

## D4. 自动化实验与线上回流机制 (Experiment & Feedback Loop)

为打破测试集固化、覆盖率停滞的瓶颈，建立以下双向流水线：

### D4.1 每次改动自动验证 (Experiment Pipeline)

开发独立的评估脚本（如 `scripts/evaluate_langgraph.ts`）：
1. **拉取试卷**：通过 Langfuse SDK 拉取目标 Dataset。
2. **批量跑图**：遍历 Dataset Items 作为输入，调用本地/预发环境的 **Executive Chat `StateGraph`（单图，`compile()` 产物）**。
3. **绑定 Trace**：将每次图执行生成的 `trace_id` 强绑定到当前的 Experiment 运行批次中。
4. **自动打分**：提取 Trace 记录计算确定性 Score；并异步触发 LLM-as-a-Judge 评估主观 Score。
5. **CI/CD 阻断**：在修改 Prompt 或工具 Schema 的代码合并前，自动触发 D1/D3 数据集回归测试，`tool_selection_accuracy` 跌破基线则阻断合并。

### D4.2 线上 Bad Case 自动化回流机制 (Data Flywheel)

这是让测试集“活起来”并持续增长的关键链路：

1. **触发捕获**：线上真实请求若满足以下条件之一，则自动标记为待定 Bad Case：
   - 最终回答被 LLM 裁判（抽样旁路评测）打出低分。
   - 触发了图的降级路由（Fallback）。
   - 用户在前端点击了“踩 (Thumbs Down)”。
2. **人工确认 (Human Review)**：研发或产品在 Langfuse 后台巡检标注为 Bad Case 的 Trace，确认为真 Bug 后补充 `expected_tools` 等期望断言。
3. **一键回流 (API Integration)**：通过配置的 Webhook 或人工点击，调用 Langfuse API 将这条 Trace 直接转换为一条标准 Dataset Item，追加到 D1-D4 测试集中。
4. **效果**：系统运行越久，积累的疑难杂症用例越多。每次跑 Experiment 都能确保架构的任何重构都不会在历史上跌倒过的地方再次翻车。

---

## D5. 数据驱动的持续迭代闭环

评估体系建立后，将直接指导架构中各项经验参数的调优：

1. **动态路由校准**：若发现大量本该走 `L2` 的 D1 简单用例错误路由到了 `L3`，则需审查并调高 `routingPolicy` 中的 `complexity_score_l2_max` 阈值（见附件 A §A8.5）。
2. **工具 Schema 与 Prompt 优化**：若 Langfuse 监控面板显示某特定工具的 `param_first_pass_rate` 持续走低，且频繁触发 `ParamRepair` 重试上限，则明确指示需优化该工具的 JSON Schema 描述或增加 few-shot 示例。