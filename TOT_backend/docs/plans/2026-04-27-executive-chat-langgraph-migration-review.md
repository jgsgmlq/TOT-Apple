# Executive Chat -> LangGraph 迁移评审（PoC 优先）

**版本**: v0.7  
**日期**: 2026-04-27  
**状态**: Draft（用于架构评审）

---

## 1. 背景与目标

当前 Executive Chat 已具备较完整能力链路：安全监工、FC 工具循环、消歧挂起恢复、会话级工具缓存、SSE 流式协议、追踪埋点。  
现计划将「编排层 + 工具调用层」迁移到 LangGraph，以提升状态管理清晰度、可测试性与可演进性。

本轮目标：

1. 形成可评审的迁移方案与阶段计划。
2. 落地可运行 PoC，不改变对外 API 契约。
3. 利用 LangGraph 原生特性（如 Interrupt/Checkpointer）重构挂起恢复逻辑，摒弃“伪造历史消息”的脏活。
4. 为后续上线准备灰度与回滚路径。

非目标：

- 不在本轮扩展 Executive Chat 新业务能力。
- 不强制重构前端渲染协议（保持兼容优先）。
- 不新增数据库结构变更（除非为观测或兼容最小必要）。

---

## 2. 范围定义（In / Out）

### 2.1 In Scope

- `server/services/chatAgentRunner.js` 的编排逻辑迁移到 LangGraph StateGraph。
- `server/services/chatToolsService.js` 的工具调用入口与 guardrail 迁移/重构。
- 采用 LangGraph 机制重构消歧 (Clarification)、权限、超时、错误语义、会话缓存等行为。
- SSE 流式协议在图节点中以副作用（Side-effect）形式对齐。
- Langfuse 追踪节点通过官方 CallbackHandler 在新链路中保持可观测。
- **Multi-Agent 地基（PoC 期预留）**：PoC **仅实现 Executive Chat 一条垂直能力**，编排落地为 **单层拍平的 `StateGraph`**（**不**使用 LangGraph Subgraph API 嵌套 Master/Executive）；前置 **`ContextAnalyzerRouter`**（单次小模型）合并原多段「护栏 + 模式 + 语义监工 + NER」逻辑；状态模型为 **单层 `ExecChatGraphState`**（见附件 A §A3）；工具检索与执行限定在 **`tool_namespace = executive_chat` 的 Local Tool Registry**；人在回路采用 **HumanInTheLoopGate + InterruptPayload**。远期其它 Agent 以 **独立图 / 独立 compile 产物** 扩展，而非在同一图内嵌套 Supervisor 子图。

### 2.2 Out of Scope

- 前端页面与交互重构（保持现有 `SSE + markdownContent` 兼容）。
- 业务指标定义调整与口径变更。
- 与 Executive Chat 无关的通用 Agent 框架整体重写。

---

## 3. 现状与主要痛点

现状参考实现：

- 路由入口：`server/routes/chat.js`
- 会话与流式：`server/services/chatService.js`
- 编排核心：`server/services/chatAgentRunner.js`
- 工具执行：`server/services/chatToolsService.js` + `server/chat_tools/*.js`

当前架构痛点：

1. **状态流转隐式化**：编排分支多，状态变量跨函数散落，演进难度高。
2. **消歧恢复不优雅**：遇到门店重名挂起时，当前依赖向数据库强插“伪造的 Tool 角色消息”来恢复上下文，容易产生时序和状态一致性 Bug。
3. **流式耦合深**：SSE 推送与 DeepSeek 的请求强耦合在 `chatWithToolsStream` 的长函数中，难以单独测试。
4. **工具层组合性弱**：工具层校验与错误映射集中，但缺乏细粒度的节点重试或回退机制。

---

## 4. 目标架构（To-Be）

详细对照见附件 A：`appendix-a-as-is-vs-to-be.md`。

目标架构原则：

1. **对外契约稳定**：请求/响应/SSE 主协议不破坏。
2. **状态图显式化**：每个节点单职责，可独立测试。用 Graph State 承载意图、上下文和工具调用栈。
3. **原生人在回路 (Human-in-the-loop)**：使用 LangGraph 的 `interrupt` 或 `Checkpointer` 机制处理 Clarification 挂起与唤醒。
4. **流式副作用分离**：节点级别的流转由 LangGraph 接管，Token 级别的流式 (SSE) 抽取为节点内的回调副作用。
5. **切流策略（已定）**：采用**一次性全量切换**到 LangGraph 主链路（不保留长期双栈）；通过发布流程与快速回退版本控制风险。
6. **单图优先**：Executive Chat PoC/V1 为 **一个 `StateGraph`**，节点用前缀表达逻辑分组（如 `fc_*`）；**不**嵌套 Master/Executive 子图，以降低 TS 状态映射与父子 Checkpoint 成本（见附件 A §A2）。
7. **工具隔离**：`ToolRetrieve` / `fc_ExecuteTool` **仅在 Executive Local Tool Registry**（`tool_namespace`）内检索与执行。
8. **唯一执行引擎（PoC/V1）**：**`fc_*` 细粒度 FC 链**（每步一 Node、硬性步数上限、修参闭环）；**不**实现 Plan-Execute 第二路径。高 `complexity_score` 走 **`L4_heavy_fc`**（提高 FC 预算等），而非 Plan（Plan 为附件 A §A12 **V2 远期**）。

建议核心节点（冻结版，**单图**）：

`LoadContext`（可选，Store 检索、非 LLM）-> **`ContextAnalyzerRouter`**（单次小模型：安全 + 意图 + NER 等）->（`QuickReply` / `DenyReply` / `HumanInTheLoopGate`）-> `ToolRetrieve` -> **`fc_CheckSteps` -> `fc_LlmToolCallStep` -> `fc_CheckDuplicate` -> `fc_ValidateParams` <-> `fc_ParamRepair` -> `fc_ExecuteTool` -> `fc_MergeToolResults`**（循环或 `fc_FinalizeOrFallback`）-> `PersistAndEmit` -> **`__end__`**；落库后由应用层发布 **`MemoryIngestRequested`**，**进程外 `MemoryWorker`** 负责异步记忆萃取（**非**图内 `AsyncMemoryExtract` Node）。

### 4.1 LLM 次数与 Checkpoint（摘要）

| 段落 | 典型 LLM 次数 | 说明 |
|---|---|---|
| `ContextAnalyzerRouter` | **1 次 / 轮**（失败时规则降级或第二次轻量调用，实现自定） | 合并原多段前置判断，降低 TTFT |
| `fc_*` 主链 | 每 super-step 至少 **1 次**（`fc_LlmToolCallStep`），总次数受 `fc_CheckSteps` 与 `RoutingPolicy` 档位预算约束 | PoC/V1 **唯一**工具执行引擎 |
| 记忆萃取 | **0 次**（主请求线程内） | 由 **MemoryWorker** 异步执行，避免 Serverless 下图内挂孤儿任务 |

**Checkpoint**：在配置 **Checkpointer** 的前提下，LangGraph 在 **Node 边界**落盘；**super-step** 定义为一次 **`fc_MergeToolResults` 成功提交 state（含 `toolResults`）之后**，进程崩溃可从**最后一次成功 super-step** 恢复已收集的工具结果（当前 Node 内未写完的流式 token 可能丢失，属可接受范围）。详见附件 A §A11.3。

---

## 5. 迁移策略与阶段

### 阶段 1：评审与设计冻结

- 输出 As-Is/To-Be、状态模型、节点职责、验收标准。
- 冻结 PoC 范围（建议仅覆盖 3-4 个核心工具）。

### 阶段 2：PoC 主链路（攻坚流式）

- 基于 LangGraph 落地最小主链路（含工具调用）。
- 重点攻坚：在 **`fc_LlmToolCallStep`** 中集成 Token 级别的流式回吐，经 Side-effect 映射到现有 SSE `delta`（含 `reasoning` / `content`）；工具边界事件仍由 **`fc_ExecuteTool`** 触发。粗粒度「单 Node 内 FC while」不作为目标形态。
- 保持 `markdownContent` 字段兼容。

### 阶段 3：复杂分支补齐（攻坚 Checkpointer）

- 接入 Clarification/Resume（引入 Checkpointer 持久化图状态，替换旧的 DB 伪造消息流）。
- 补齐 Session Cache、Fallback Routing 与**多级记忆机制（Store）**。
- 对齐 Langfuse 监控追踪（利用 Langchain 官方 Tracer）。

### 阶段 4：稳定性验证

- 压测与失败注入（timeout/permission/tool error）。
- 灰度策略与回滚演练。

---

## 6. 交付物

1. 设计文档：本文件 + 附件 A/B/C/**D**（`appendix-d-evaluation-framework.md`：Langfuse 评估与 Dataset 约定）。
2. PoC 代码（按评审基线直连 LangGraph 主链路；legacy 仅保留历史分支，不作为运行时开关路径）。
3. 验证报告（核心场景通过率、性能基线、已知风险）；**与附件 D 的 Experiment / Score 基线可对齐**。
4. 文档同步（按最终实现更新 specs/plans，含 §10 所列规格与 `12-AGENT-ARCHITECTURE.md` 若已创建）。

---

## 7. 工时评估（当前口径）

- 架构评审材料：2-4 人天
- 可运行 PoC：7-12 人天（包含 SSE 和 Checkpointer 技术攻坚）
- 准上线级改造：20-35 人天

---

## 8. 周粒度里程碑（建议）

详细清单见附件 C：`appendix-c-milestone-test-checklist.md`。

- Week 1: 设计冻结与评审通过
- Week 2: PoC 主链路与流式 Side-effect 跑通
- Week 3: Langfuse 监控对齐、工具层迁移与**多级记忆链路落地**
- Week 4: 基于 Checkpointer 的 Clarify 挂起与恢复场景补齐
- Week 5: 性能、全量切流发布与回退演练

---

## 9. 决策门（Go / No-Go）

进入开发前需确认（当前会话已冻结）：

1. **已确认**：采用**一次性全量切换**（非双栈并行）。
2. **已确认**：采用 LangGraph Checkpointer 替代原有的 DB 伪造消息恢复机制。
3. 待冻结：性能门槛定义（首 token、P95、错误率）。
4. **已确认**：MemoryWorker 走队列化方案，但先落**队列接口抽象 + 事件发布**，连接配置后补。
5. **已确认**：PoC/V1 采纳 **单图 + `fc_*` 细粒度 FC** 为唯一执行引擎；Plan-Execute 仅 V2 远期。

---

## 10. 文档同步策略

若后续进入代码实施并产生行为变化，至少同步：

- `docs/specs/09-EXECUTIVE-CHAT.md`
- `docs/specs/10-EXECUTIVE-CHAT-INTENTS-TOOLS.md`
- `docs/specs/11-EXECUTIVE-CHAT-REQUEST-FLOW.md`
- `docs/specs/12-AGENT-ARCHITECTURE.md` (可将本文核心内容抽象固化至此)
- `docs/specs/04-API-SPEC.md`（仅对外契约变化时）

---

## 11. 状态机打磨方案（评审结论草案）

为提升参数正确率、工具选择稳定性和线上可观测性，Executive Chat 状态机在 LangGraph 迁移中采用四层优化。

### 11.1 第一层：LLM 前 NER 预提取与标准化

**PoC 落地**：NER 与意图、安全门控一并由 **`ContextAnalyzerRouter`** 的结构化输出承载（`entities_raw` / `entities` / `entities_confidence` 等，字段名以代码为准）；**`LoadContext`（若启用）** 仍在其前，仅做 Store 检索。在任何 **`fc_LlmToolCallStep`（工具规划）** 之前，槽位应已标准化或可澄清。

规则：

1. 在进入 **FC 工具规划**前，关键槽位应已标准化：`region_id`、`store_id`、`task_id`、`metric`、`time_range`。
2. 输出统一三元结构：`raw`、`canonical`、`confidence`（可由 Router schema 表达）。
3. 对高影响槽位（region/store/task）设置信心门槛，低于阈值时优先进入澄清，不允许“猜测执行”。

建议参数：

- `ner_confidence_threshold = 0.85`
- `high_impact_slots = ["region_id", "store_id", "task_id"]`

### 11.2 第二层：工具检索与 Top-K 约束

新增节点：`ToolRetrieve`（RAG/语义检索），仅向 LLM 暴露最相关候选工具。

规则：

1. 默认仅暴露 `Top-3` 工具，减少误选空间。
2. 若 Top-3 全低置信或连续失败，允许一次扩容到 `Top-5`（仅一次）。
3. 每次工具候选应携带 `score` 与 `reason`，用于诊断与回放。

建议参数：

- `tool_top_k = 3`
- `tool_expand_once = true`
- `tool_expand_to_k = 5`

### 11.3 第三层：参数校验中间件与修参闭环

新增节点：`ParamValidate` + `ParamRepair`（位于 **`fc_ExecuteTool` 之前**）。**图实现命名**为 **`fc_ValidateParams` / `fc_ParamRepair`**（与本节 **`ParamValidate`** / **`ParamRepair`** 同义，见附件 A §A11）。

规则：

1. 工具执行前必须经过 JSON Schema + 业务规则校验（必填、枚举、scope、跨字段约束）。
2. 校验失败时，将 `violations` 回传 LLM 进行参数修复，避免直接打到工具执行层。
3. 限制修参次数，避免无限循环；超限后转入澄清或降级回答。

建议参数：

- `max_param_repair_attempts = 2`
- `validation_order = schema_first_then_business_rules`

### 11.4 第四层：Langfuse 参数准确率持续评估

新增观测指标：`param_accuracy`，并按 intent/tool 细分监控。

规则：

1. 在线统计参数正确率（以通过校验并成功执行为基准）。
2. 当全局或关键 tool 低于阈值时触发告警。
3. 告警后自动附带最近失败样本（脱敏）用于快速定位。

建议参数：

- `param_accuracy_alert_threshold_global = 0.90`
- `param_accuracy_alert_threshold_by_tool = { drill_down: 0.85, analytics_query: 0.92 }`

### 11.5 补充护栏（建议一并纳入）

1. **参数来源标注**：每个参数记录 `source`（`ner|memory|llm|default`）。
2. **槽位门控执行**：关键槽位缺失时禁止进入工具执行。
3. **离线回放**：每日回放样本集，追踪 `tool_select_accuracy`、`param_accuracy`、`first_pass_success_rate`。

---

## 12. 请求级动态路由（四档连续频谱）

当前架构依赖环境变量进行“进程级二选一模式切换”，无法做到按请求特征动态选择执行路径。  
迁移后采用 `RoutingPolicy`，将每个请求自动路由到最合适档位，实现速度、成本与鲁棒性的平衡。

### 12.1 四档定义

1. `L1_cache_hit`：命中可复用结果，直接返回（最快、最省）。
2. `L2_intent_fastpath`：意图路由 + 规则执行（快、稳、低成本）。
3. `L3_fc_guarded`：受约束 FC（Top-K 工具 + 参数校验 + 修参）。
4. `L4_heavy_fc`：高复杂度下的 **加预算多轮 FC**（更多 super-step / 可调 Top-K 等）；**非** Plan-Execute（PoC/V1 不实现 Plan）。

### 12.2 路由原则

1. **默认低档优先**：先尝试低成本路径，失败再升级。
2. **失败可升级**：`L2 -> L3 -> L4` 允许逐级升级，不允许无限往返。
3. **复杂度感知**：由规则 + 轻量判定器识别请求复杂度，避免简单问题走重链路。
4. **安全优先**：无论哪一档，均需经过 **`ContextAnalyzerRouter` 的门控输出** 与 **工具层确定性护栏**（`regionScope` / national_only 等在 **`fc_ExecuteTool`** 前硬校验）。

### 12.3 预期收益

- 高频简单查询优先走 `L1/L2`，显著降低延迟和成本。
- 复杂问题自动升级到 `L3` / `L4_heavy_fc`（仍为 FC），保持灵活性和答案质量。
- 从“模式切换”升级到“策略编排”，便于后续精细化运营和灰度调优。

### 12.4 默认阈值建议（Baseline）

首版建议先采用静态阈值，待上线后按 Langfuse 数据回调：

- `intent_confidence_threshold = 0.80`
- `entity_completeness_threshold = 0.85`
- `complexity_score_l2_max = 0.35`（<= 0.35 优先 `L2`）
- `complexity_score_l4_min = 0.70`（>= 0.70 走 **`L4_heavy_fc`**，非 Plan）
- `topk_min_score_threshold = 0.60`（Top-3 最低相关性门槛）
- `max_fallback_count_per_request = 2`
- `max_iterations_per_turn = 4`

实现约定：

1. 阈值统一放在 `routingPolicy` 配置对象，禁止散落硬编码。
2. 每次决策都记录 `selected_tier + thresholds_snapshot`，便于回放诊断。
3. 先做“保守升级”（宁可升档，不要误走低档导致答非所问）。

### 12.5 档位（L1–L4）与执行形态对照

便于实现与评测对齐：**`selected_tier`** 决定 **FC 预算与快路径短路策略**（允许配置微调；降级时可能偏离）。PoC/V1 **无** `RouteExecutionPath`、**无** Plan 分支。

| `selected_tier`（概念档） | 典型执行形态 | 说明 |
|---|---|---|
| `L1_cache_hit` | 缓存直出 | 在 `ContextAnalyzerRouter` 前或专用短路节点命中会话/签名缓存即返回。 |
| `L2_intent_fastpath` | 快路径 | 等价 legacy `intent_routing` 等：**仍经** `ContextAnalyzerRouter` + `ToolRetrieve`，但 **`fc_*` 往往 1 个 super-step 内结束**（实现可优化提示词与工具面）。 |
| `L3_fc_guarded` | 受约束多轮 FC | 默认 **`fc_*` 链** + 默认 `max_iterations_per_turn` / Top-K。 |
| `L4_heavy_fc` | 加预算多轮 FC | **同一套 `fc_*` 链**，提高步数上限等；**非** Plan-Execute（V2 见附件 A §A12）。 |

**说明**：`L2` 与「仅一次 LLM」不是强制等价——Router 已占 1 次调用；应在 Langfuse 中区分 `routing_tier` 与 `execution_path`（如 `fc_steps_used`）以免评测误判。

---

## 13. 多级记忆架构与生命周期管理

为解决记忆膨胀、跨会话遗忘与记忆冲突问题，采用“短/中/长”三级分层架构，深度结合 LangGraph 原生特性。

### 13.1 短期记忆 (Short-term Memory)：Checkpointer 托管

- **机制**：完全由 **LangGraph Checkpointer** 自动接管。State 中的 `toolResults`、对话上下文（`messages`）严格跟随 `thread_id`（Session）隔离。
- **优势**：开箱即用，天然支持崩溃恢复与人为挂起唤醒（HITL）。
- **防护**：在图流转进入大模型前，应用滑动窗口或 token 截断机制（`trim_messages`），防止随对话轮数增加导致 OOM 或超限。

### 13.2 中/长期记忆 (Mid/Long-term Memory)：Store 命名空间

- **机制**：使用 LangGraph 的 **Store**（基于 KV/Vector 底层）。
- **命名空间隔离**：
  - 中期记忆存入：`namespace = ["user_id", "mid_term"]`
  - 长期记忆存入：`namespace = ["user_id", "long_term"]`
- **注入链路 (Load)**：新增 **`LoadContext` Node**（**非 LLM**，在 **`ContextAnalyzerRouter` 之前**）。它直接利用当前 User Query 在 Store 中进行**语义搜索 (Semantic Search)**，捞取 Top-K 相关记忆（如：“我不看华东数据”），并无缝注入到本次对话上下文，供 Router 与后续 FC 使用。

### 13.3 异步记忆萃取与升级 (Async Memory Extraction & Promotion)

- **机制**：为了不阻塞用户的打字机等待时间，记忆的提取与清洗 **不在主图内**执行。主图在 **`PersistAndEmit` → `__end__`** 结束后，由应用层发布 **`MemoryIngestRequested`**（或等价事件），**独立 `MemoryWorker`**（队列消费者）异步执行萃取、矛盾检测与 Store 写回（见附件 A §A2、§A10.6）。
- **Pending 升级策略**：
  - 新发现的用户偏好/事实，初始标记为 `pending`。
  - 若在后续其它会话中被再次验证或频繁触及，由大模型判定后**升级**为 `active`（长期记忆）。
- **矛盾检测**：在写入新记忆时，若与 Store 中检索到的旧记忆冲突，提取大模型将基于时序逻辑进行覆盖或降级，解决“记忆精神分裂”。

### 13.4 中期记忆 TTL (Time-To-Live)

- **要求**：中期记忆（如“本周重点看新品培训任务”）应具有 14 天生命周期。
- **实现方案**：
  - **首选（依赖底层能力）**：若底层的 Store 实现（如 Redis 或具备 TTL 功能的文档库）支持原生 TTL，则在写入时直接赋予 14 天过期时间，零算力损耗。
  - **兜底（Cron Job）**：若底层不支持原生过期，则建立定时任务。每日低峰期扫描 Store 中的 `mid_term` 命名空间，基于 `created_at` 字段硬删除过期条目。
