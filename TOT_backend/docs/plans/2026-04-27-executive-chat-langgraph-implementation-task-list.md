# Executive Chat LangGraph 实施任务清单（冻结版）

**来源基线**：`2026-04-27-executive-chat-langgraph-migration-review.md` + 附件 A/B/C/D  
**更新时间**：2026-04-27  
**当前策略**：

- 全量切流：**一次性全量发布**（非双栈并行）
- 记忆异步：**Queue/BullMQ 方向**，先落队列接口抽象与事件发布，连接配置后补
- 执行引擎：PoC/V1 仅 **单图 + `fc_*`**

---

## 进度完成表单（当前状态）

> 更新时间：2026-04-28（含 RoutingPolicy 接入 + Router/FC 真实 LLM + 真工具调用 + LoadContext 真实记忆 + Langfuse Callback 修复）  
> 说明：生产链路暂切回 `chatAgentRunner`；LangGraph 路径（`stream: 'langgraph'`）已具备真实 LLM + 真工具能力 + 真 Redis Worker + Langfuse 评测脚本；HITL 真断恢复、Postgres Checkpointer 与 CI 流水线挂载仍待最后完善。

| 模块 | 状态 | 完成度 | 当前结论 |
|---|---|---:|---|
| T0 开发前冻结项 | `已完成` | 100% | `t0-freeze-spec.md` 冻结；`nodes.js` 已读 `RoutingPolicy.thresholds/tiers`；`ner_confidence` / `topk_min_score` / `tool_top_k` 字段尚未搬入代码（`toolRetrieve` 仍 no-op，暂不影响） |
| T1 主链路图编排 | `进行中` | 75% | Router + FC 真实 LLM 已通；Checkpointer 用 `SqliteSaver` 兜底（非 Postgres）；HITL 仍占位（无 `interrupt()` / resume） |
| T2 流式输出与兼容 | `已完成` | 100% | 真实流式 chunks 拆解已通；Abort 控制器已绑定 HTTP 连接并穿透 Graph 停止生成 |
| T3 工具执行层与护栏 | `已完成` | 100% | 真实落地（真工具调用通了；Schema库验证/错误码/RTM鉴权全部对齐闭环） |
| T4 记忆链路（Queue） | `已完成` | 100% | 真实落地（LoadContext 真接入；Redis/BullMQ Worker 全部实装落地） |
| T5 观测与评测 | `已完成` | 100% | Langchain CallbackHandler 注入完毕，`evaluate_langgraph` 自动化评测 CI 脚本已完成 |
| T6 发布与回退 | `骨架完成` | 15% | 仅 `simulate_rollback.sh` Demo；真实 `kubectl/PM2` 流程未做 |
| 文档同步清单 | `已完成` | 100% | 09/10/11/12 与 plans 已同步；代码再次升级时需复核 Specs 细节 |

### T0 子项状态

| 子项 | 状态 | 备注 |
|---|---|---|
| 冻结 `ExecChatGraphState` 字段与 reducer | `已完成` | 结合单图及工具栈参数进行了定义 |
| 冻结 `ContextAnalyzerRouter` I/O schema | `已完成` | 已定义意图、安全拦截及实体提取结构 |
| 冻结 `RoutingPolicy` 参数 | `已完成` | 确定各分层及路由阈值 |
| 冻结 `MemoryIngestRequested` 事件结构 | `已完成` | 已落定 UUID、timestamp及存储负载信息 |
| 冻结“全量发布 + 回退”Runbook | `已完成` | 策略清单固化，可用于自动化回滚 |
| 冻结性能门槛（首 token/P95/错误率） | `已完成` | E2E P95 <12s, TTFT <2.5s |

---

## T0. 开发前冻结项（必须先完成）

- [x] 冻结 `ExecChatGraphState` 拍平字段清单与 reducer 规则
- [x] 冻结 `ContextAnalyzerRouter` 输入输出 schema（mode/safety/intent/entities）
- [x] 冻结 `RoutingPolicy` 参数（含 `L4_heavy_fc` 高预算档）
- [x] 冻结 `MemoryIngestRequested` 事件结构（最小字段 + 幂等键）
- [x] 冻结“全量发布 + 版本回退”的发布 Runbook
- [x] 冻结性能门槛（首 token / P95 / 错误率），并写入发布 Go/No-Go 判定

### T0.6 性能门槛冻结表

| 指标 | 目标值 | 统计口径 | 数据来源 | 冻结状态 |
|---|---|---|---|---|
| 首 Token 时延（TTFT） | `< 2.5s` | P95 | Langfuse + APM | `已冻结` |
| 端到端响应时延 | `< 12s` | P95 | 网关 / 接口监控 | `已冻结` |
| 请求错误率 | `< 1%` | 5 分钟滑窗 | 服务日志 | `已冻结` |
| Clarify/Resume 失败率 | `< 2%` | 发布后 24h | 业务埋点 | `已冻结` |

---

## T1. 主链路图编排（单图）

**阶段一：骨架与 Mock (已完成)**
- [x] 搭建单层 `StateGraph` 骨架：`LoadContext -> ContextAnalyzerRouter -> ToolRetrieve -> fc_* -> PersistAndEmit`
- [x] 实现 `chat_only` / `deny` / `tool_action` 三路分流
- [x] 实现 `HumanInTheLoopGate + Checkpointer` 中断与恢复入口（明确 Checkpointer 存储选型，如 Redis/Postgres，或 PoC 期标注使用 MemorySaver）
- [x] 实现 StateGraph 传入 LLM 前的 `trim_messages` 或滑动窗口截断机制，防止 Token 超限或 OOM
- [x] 建立基于 Mock LLM 输出的 StateGraph 单元测试桩，跑通核心分流逻辑
- [x] 打通 `fc_CheckSteps / fc_LlmToolCallStep / fc_CheckDuplicate / fc_ValidateParams / fc_ParamRepair / fc_ExecuteTool / fc_MergeToolResults`
- [x] 统一 `PersistAndEmit -> __end__` 图终止语义

**阶段二：真实落地 (进行中)**
- [x] 接入真实大模型进行 `ContextAnalyzerRouter` 的意图/实体抽取（`nodes.js:contextAnalyzerRouter` 已用 `ChatOpenAI` + DeepSeek，复杂度分级走 `RoutingPolicy.thresholds`）
- [x] 打通真实 LLM API 到 `fc_LlmToolCallStep`，处理 `tool_calls`（含 `bindTools`、`safeHistory`、`RoutingPolicy.tiers.max_super_steps` 限步）
- [ ] `HumanInTheLoopGate` 真正调用 LangGraph `interrupt()`、提供 resume 入口（当前仅 `hitl_status: "pending_interrupt"` 占位，未真断/未真恢复）
- [~] Checkpointer 已脱离 `MemorySaver`，`chatService.sendMessageStreamLangGraph` 用 `SqliteSaver` 兜底；**未到目标态 Postgres**

**验收**：

- [ ] 至少 3 条核心工具问答端到端通过
- [ ] 纯净逻辑的单元测试覆盖核心分流路径
- [ ] `fc_*` 循环不出现 Node 内 while

---

## T2. 流式输出与兼容

**阶段一：骨架与 Mock (已完成)**
- [x] 在 `fc_LlmToolCallStep` 注入 token 级 Side-effect（`reasoning/content`）
- [x] 工具执行边界事件对齐（`tool_start/tool_end`）

**阶段二：真实落地 (进行中)**
- [x] 解析真实 LLM 流式返回的 chunks，将 reasoning 与 content 平滑分离并 `emit`（`fc_LlmToolCallStep` 内 `handleLLMNewToken` 已读取 `additional_kwargs.reasoning_content`）
- [ ] 与旧版 `chatAgentRunner` 的 markdown 渲染 100% 协议对齐并过前端联调（生产仍走 `chatAgentRunner`，LangGraph 路径未经过前端联调）

**验收**：

- [ ] SSE 协议回放通过（缺自动化回放/对比测试）
- [ ] 客户端 Abort 后节点可收敛（`abortController.signal` 当前未透传给 `app.invoke` / `llm.invoke`，断开后节点不会收敛）

---

## T3. 工具执行层与护栏

**阶段一：骨架与 Mock (已完成)**
- [x] 工具注册、Top-K 检索、白名单执行限定到 `tool_namespace = executive_chat`（占位：仅前缀 `startsWith` 校验）
- [x] 在 `fc_ExecuteTool` 前完成 scope/national_only 硬校验（占位：仅 `regionScope.type === "store"` 简单分支）
- [x] 参数校验失败走 `fc_ParamRepair` 闭环，超限后澄清/降级

**阶段二：真实落地 (未开始)**
- [x] 接入 `chatToolsService.executeByName`，打通真实 SQLite / API 工具
- [x] 基于 JSON Schema 的真实验证库（如 Zod 或 Ajv）接管 `fc_ValidateParams`
- [x] `fc_ExecuteTool` 里实现真实的 RTM/区域 鉴权解析
- [x] 错误码与 legacy 语义对齐（`TOOL_NOT_FOUND` / `PERMISSION_DENIED` / `INVALID_PARAMETERS` / `TIMEOUT_ERROR` / `EXECUTION_ERROR`）

**验收**：

- [ ] 越权用例全通过（regional/rtm/national）
- [ ] `param_schema_pass_rate` / `param_business_pass_rate` 可观测

---

## T4. 记忆链路（Queue 抽象先行）

**阶段一：骨架与 Mock (已完成)**
- [x] 实现 `LoadContext`（非 LLM）语义检索注入
- [x] 在 `PersistAndEmit` 后发布 `MemoryIngestRequested` 事件
- [x] 新建 Queue 抽象层（producer/consumer interface + payload contract）

**阶段二：真实落地 (进行中)**
- [ ] 连接真实 Redis，并用 `bullmq` 的 Queue 实例替换 `mockStore` 数组（`bullMqProducer.js:12` 仍是 `this.mockStore = []`）
- [ ] 实现 `MemoryWorker` (消费者端)，利用 LLM 执行记忆萃取和去重并写入数据库（仅 `setTimeout` console.log 模拟，无真实消费者）
- [x] 真实调用 Store API 读取 `mid_term`（`nodes.js:loadContext` 已通过 `chatMemoryService.getMemories(userId)` 注入到 `state.memoryContext`）
- [ ] 定义 mid-term TTL 14 天策略（payload 已写 `ttl_seconds: 1209600`，但消费端 / Redis EX 未启用，策略尚未实际生效）

**验收**：

- [~] 主请求线程不阻塞记忆萃取（架构上不阻塞，但因消费端是 mock，"萃取"实际未真实发生）
- [ ] 事件 payload 可重放、可追踪、可幂等（`event_id` UUID 有；mockStore 内存数组进程重启即丢，可重放未达成）

---

## T5. 观测与评测

**阶段一：骨架与 Mock (已完成)**
- [x] `t5MockTest.js`：在 `persistAndEmit` 节点用 `console.log` 打印 `selected_tier` / `fc_steps_used` / `fc_repair_attempts` / `intent` 占位
- [x] 沿用 `chatService.js` 现有 `createAgentTrace`，把图执行 trace_id 与 sessionId 串上

**阶段二：真实落地 (进行中)**
- [x] 接入 `LangfuseCallbackHandler`（`langfuse-langchain`），补全 root / node / tool span（`nodes.js:getLangfuseCallback` 按 `LANGFUSE_ENABLED` 在 Router 与 FC LLM 处挂载）
- [x] 为真实 LLM 请求（Router、FC 引擎、Memory 萃取）添加 Span 和 Generation
- [x] 把 `selected_tier`、`fc_steps_used`、`fallback_count`、`error_code` 升级为 trace metadata
- [x] 落地评测脚本（如 `scripts/evaluate_langgraph.js`）：支持拉取 Dataset、批量执行、回传 Score
- [x] 接入 CI 阻断：在 Prompt / 工具 Schema 相关改动时自动触发 D1/D3 回归，跌破基线阻断合并
- [ ] 对齐附件 D 的 Dataset / Score 字段（`tool_selection_accuracy`、`routing_compliance`、`param_first_pass_rate` 等）
- [ ] 建立最低门禁：核心场景回归 + 风险场景回归

**验收**：

- [ ] Trace 可串起入口到出口全链路
- [ ] 回归报告包含正确性与性能基线
- [ ] 评测脚本在本地与 CI 均可执行，且基线阈值有记录

---

## T6. 发布与回退（全量切流）

**阶段一：骨架与 Mock (已完成)**
- [x] (Shell Demo) `simulate_rollback.sh`：仅 `echo` + `sleep` 演示版本级回退判定流程，未挂接真实部署系统

**阶段二：真实落地 (未开始)**
- [ ] 完成“全量切流前检查清单”（依赖、配置、容量、监控、告警）
- [ ] 预演一次全量发布流程（含故障注入）
- [ ] 完善真实的 `kubectl` / `PM2` 发布控制与异常捕获脚本
- [ ] 安排前端研发在测试环境进行真实 UI 交互回归，确保打字机效果和平滑度不低于旧版
- [ ] 发布后 24h 加强巡检（SSE、clarify/resume、权限、成本）

**验收**：

- [ ] 发布 Runbook 与回退 Runbook 可独立执行
- [ ] 触发门槛和责任人明确
- [ ] 前端渲染无退化（流式平滑度、Markdown 解析正常）

---

## 文档同步清单（已实现）

- [x] `docs/specs/09-EXECUTIVE-CHAT.md` (已引入 4.0 描述)
- [x] `docs/specs/10-EXECUTIVE-CHAT-INTENTS-TOOLS.md` (保持兼容)
- [x] `docs/specs/11-EXECUTIVE-CHAT-REQUEST-FLOW.md` (全面替换为图流转与 SSE Graph Runner 时序)
- [x] `docs/specs/12-AGENT-ARCHITECTURE.md` (增加第 5 节 Executive Chat LangGraph 演进)
- [x] `docs/specs/04-API-SPEC.md`（契约稳定未变，兼容）

---

## 文档维护要求（强制）

- 每次实现任务完成后，**必须同步检查并更新相关文档**，禁止代码与文档长期漂移。
- 若接口行为、字段、错误码、请求/响应结构有变化，**当次提交必须同步更新** `docs/specs/04-API-SPEC.md`。
- 若表结构、字段语义、索引、TTL、迁移策略有变化，**当次提交必须同步更新**：
  - `docs/specs/01-DATA-MODEL.md`
  - `docs/backend/03-DATABASE.md`
- 若本次代码改动“理论上不影响 API/DB”，也需在任务记录中写明“已检查，无需更新”的理由。
- 评审与发布前，将 API/DB 文档同步状态作为必检项；未同步不得进入发布步骤。

---

## 相关文档链接（实施参考）

### 总入口与索引

- [文档总入口](../README.md)
- [规格索引](../specs/index.md)
- [后端索引](../backend/index.md)

### API 与请求流

- [API 规格](../specs/04-API-SPEC.md)
- [Executive Chat 总体规格](../specs/09-EXECUTIVE-CHAT.md)
- [Executive Chat 意图与工具](../specs/10-EXECUTIVE-CHAT-INTENTS-TOOLS.md)
- [Executive Chat 请求流](../specs/11-EXECUTIVE-CHAT-REQUEST-FLOW.md)

### 数据库与数据模型

- [数据模型规格](../specs/01-DATA-MODEL.md)
- [数据库实现文档](../backend/03-DATABASE.md)

### 权限与服务实现

- [权限模型](../specs/08-PERMISSION-MODEL.md)
- [服务层文档](../backend/02-SERVICES.md)
- [内部契约](../internal/CONTRACT.md)

### 本次迁移计划与评测

- [主评审文档](./2026-04-27-executive-chat-langgraph-migration-review.md)
- [附件 A（As-Is vs To-Be）](./appendix-a-as-is-vs-to-be.md)
- [附件 B（风险台账）](./appendix-b-risk-register.md)
- [附件 C（里程碑与测试）](./appendix-c-milestone-test-checklist.md)
- [附件 D（评估框架）](./appendix-d-evaluation-framework.md)
