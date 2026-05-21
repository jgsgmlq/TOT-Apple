# Agent 架构

## 图结构（10 节点）

```
START → LoadContext → SafetyGateway ─┬─ deny/chat → FinalResponseStep
                                     ├─ hitl → HumanInTheLoopGate → FinalResponseStep / fc_CheckSteps
                                     └─ fc → fc_CheckSteps
                                                │
                                    fc_CheckSteps → fc_LlmToolCallStep / FinalResponseStep
                                                │
                                    fc_LlmToolCallStep → fc_CheckDuplicate / FinalResponseStep
                                                │
                                    fc_CheckDuplicate → fc_ExecuteTool / fc_MergeToolResults
                                                │
                                    fc_ExecuteTool ─┬─ merge → fc_MergeToolResults
                                                     ├─ escalate → FinalResponseStep
                                                     └─ hitl → HumanInTheLoopGate
                                                │
                                    fc_MergeToolResults → fc_CheckSteps / FinalResponseStep

FinalResponseStep → PersistAndEmit → END
```

## 节点职责

| 节点 | 职责 | 文件 |
|---|---|---|
| LoadContext | 加载会话上下文、用户范围 | `nodes/loadContext.js` |
| SafetyGateway | 意图分类（tool/chat/deny/hitl），实体预提取 | `nodes/safetyGateway.js` |
| fc_CheckSteps | 步数计数，超过 MAX_FC_ROUNDS 停止循环 | `nodes/fc_CheckSteps.js` |
| fc_LlmToolCallStep | 调 FC LLM 决定工具调用，流式输出思考过程 | `nodes/fc_LlmToolCallStep.js` |
| fc_CheckDuplicate | 工具调用去重（同参数短时间内跳过） | `nodes/fc_CheckDuplicate.js` |
| fc_ExecuteTool | 执行工具调用（含参数校验、鉴权） | `nodes/fc_ExecuteTool.js` |
| fc_MergeToolResults | 合并工具结果到 toolResults | `nodes/fc_MergeToolResults.js` |
| HumanInTheLoopGate | 中断等待用户补充信息（ask_user / ambiguity） | `nodes/humanInTheLoopGate.js` |
| FinalResponseStep | LLM 生成结构化 JSON 回复（模板体系） | `nodes/finalResponseStep.js` |
| PersistAndEmit | 持久化到 MySQL、Langfuse trace、会话标题生成 | `nodes/persistAndEmit.js` |

## 已移除节点

- **fc_Escalate**（2026-05-21 删除）：7 行空操作，设置 `fc_next_action=''` 后总是跳到 FinalResponseStep。路由已内联到 `routeAfterExecute` 直接返回 `"FinalResponseStep"`。

## FC 循环控制

- `fc_super_step_count`：全局步数，`fc_CheckSteps` 递增
- `MAX_FC_ROUNDS`（默认 3）：上限
- `fc_next_action`：下一步动作（`continue` / `merge` / `hitl`）
- `pending_tool_calls`：待执行的工具调用列表
- `escalate_count`：权限拒绝计数器（>=1 直接结束 FC 循环）

## State 关键字段

| 字段 | 写入节点 | 说明 |
|---|---|---|
| `mode` | SafetyGateway | `tool` / `chat` / `deny` |
| `intent` | SafetyGateway | 意图分类 |
| `extracted_task_ref` | SafetyGateway | 预提取任务引用 |
| `extracted_org_ref` | SafetyGateway | 预提取组织引用 |
| `extracted_time_ref` | SafetyGateway | 预提取时间引用 |
| `ambiguity_payload` | SafetyGateway | 歧义时 HITL 中断 |
| `fc_super_step_count` | fc_CheckSteps | FC 步数 |
| `pending_tool_calls` | fc_CheckDuplicate | 去重后的工具调用 |
| `toolResults` | fc_ExecuteTool | 工具执行结果 |
| `finalResponse` | FinalResponseStep | 结构化 JSON 回复 |
| `sessionTitle` | PersistAndEmit | AI 生成的会话标题 |

## toolResults 数据流

```
toolResults (state map)
  → normalizeToolResults()        → datasets[]  (图表/表格)
  → prepareToolData()             → LLM prompt  (原始 JSON)
  → renderToolResultsMarkdown()   → 兜底渲染    (降级 markdown)
```

详见 `data-pipeline.md`。
