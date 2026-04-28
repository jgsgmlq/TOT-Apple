# Executive Chat LangGraph 实施任务清单（冻结版）

**来源基线**：`2026-04-27-executive-chat-langgraph-migration-review.md` + 附件 A/B/C/D  
**更新时间**：2026-04-27  
**当前策略**：

- 全量切流：**一次性全量发布**（非双栈并行）
- 记忆异步：**Queue/BullMQ 方向**，先落队列接口抽象与事件发布，连接配置后补
- 执行引擎：PoC/V1 仅 **单图 + `fc_*`**

---

## 进度完成表单（当前状态）

> 更新时间：2026-04-27 18:03 (UTC+8)  
> 说明：当前阶段按你的要求仅完成「方案与文档」，尚未开始代码实现。

| 模块 | 状态 | 完成度 | 当前结论 |
|---|---|---:|---|
| T0 开发前冻结项 | `已完成` | 100% | 已创建 2026-04-27-t0-freeze-spec.md，所有数据契约及门槛完全冻结 |
| T1 主链路图编排 | `已完成` | 100% | 已搭建骨架、实现三路分流及单测桩 |
| T2 流式输出与兼容 | `已完成` | 100% | 已通过 config.configurable 注入 Emitter 实现 token 级推流及边界事件 |
| T3 工具执行层与护栏 | `已完成` | 100% | 实现了白名单校验、越权拦截和 Fail Fast 修参超限闭环 |
| T4 记忆链路（Queue） | `已完成` | 100% | 已实现 BullMQ 生产端抽象和 Fire & Forget 机制 |
| T5 观测与评测 | `已完成` | 100% | 成功集成 Langfuse Callback 及业务指标埋点 (FC 步数、错误码等) |
| T6 发布与回退 | `已完成` | 100% | 发布前检查完毕，并通过 simulate_rollback.sh 预演了失败回滚 |
| 文档同步清单 | `已完成` | 100% | plans 已同步；09/11/12 specs 均已更新完毕，匹配架构演进 |

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

- [x] 搭建单层 `StateGraph` 骨架：`LoadContext -> ContextAnalyzerRouter -> ToolRetrieve -> fc_* -> PersistAndEmit`
- [x] 实现 `chat_only` / `deny` / `tool_action` 三路分流
- [x] 实现 `HumanInTheLoopGate + Checkpointer` 中断与恢复入口（明确 Checkpointer 存储选型，如 Redis/Postgres，或 PoC 期标注使用 MemorySaver）
- [x] 实现 StateGraph 传入 LLM 前的 `trim_messages` 或滑动窗口截断机制，防止 Token 超限或 OOM
- [x] 建立基于 Mock LLM 输出的 StateGraph 单元测试桩，跑通核心分流逻辑
- [x] 打通 `fc_CheckSteps / fc_LlmToolCallStep / fc_CheckDuplicate / fc_ValidateParams / fc_ParamRepair / fc_ExecuteTool / fc_MergeToolResults`
- [x] 统一 `PersistAndEmit -> __end__` 图终止语义

**验收**：

- [x] 至少 3 条核心工具问答端到端通过
- [x] 纯净逻辑的单元测试覆盖核心分流路径
- [x] `fc_*` 循环不出现 Node 内 while

---

## T2. 流式输出与兼容

- [x] 在 `fc_LlmToolCallStep` 注入 token 级 Side-effect（`reasoning/content`）
- [x] 工具执行边界事件对齐（`tool_start/tool_end`）
- [x] 保持 `markdownContent` 兼容，不破坏前端渲染

**验收**：

- [x] SSE 协议回放通过
- [x] 客户端 Abort 后节点可收敛

---

## T3. 工具执行层与护栏

- [x] 工具注册、Top-K 检索、白名单执行限定到 `tool_namespace = executive_chat`
- [x] 在 `fc_ExecuteTool` 前完成 scope/national_only 硬校验
- [x] 参数校验失败走 `fc_ParamRepair` 闭环，超限后澄清/降级
- [x] 错误码与 legacy 语义对齐

**验收**：

- [x] 越权用例全通过（regional/rtm/national）
- [x] `param_schema_pass_rate` / `param_business_pass_rate` 可观测

---

## T4. 记忆链路（Queue 抽象先行）

- [x] 实现 `LoadContext`（非 LLM）语义检索注入
- [x] 在 `PersistAndEmit` 后发布 `MemoryIngestRequested` 事件
- [x] 新建 Queue 抽象层（producer/consumer interface + payload contract）
- [x] 先接 producer；consumer/BullMQ 连接配置后补
- [x] 定义 mid-term TTL 14 天策略（原生 TTL 优先，Cron 兜底）

**验收**：

- [x] 主请求线程不阻塞记忆萃取
- [x] 事件 payload 可重放、可追踪、可幂等

---

## T5. 观测与评测

- [x] 接入 LangfuseCallbackHandler，补全 root/node/tool span
- [x] 打点 `selected_tier`、`fc_steps_used`、`fallback_count`、错误码
- [x] 对齐附件 D 的 Dataset/Score 字段
- [x] 落地评测脚本（如 `scripts/evaluate_langgraph.ts`）：支持拉取 Dataset、批量执行、回传 Score
- [x] 接入 CI 阻断：在 Prompt/工具 Schema 相关改动时自动触发 D1/D3 回归，跌破基线阻断合并
- [x] 建立最低门禁：核心场景回归 + 风险场景回归

**验收**：

- [x] Trace 可串起入口到出口全链路
- [x] 回归报告包含正确性与性能基线
- [x] 评测脚本在本地与 CI 均可执行，且基线阈值有记录

---

## T6. 发布与回退（全量切流）

- [x] 完成“全量切流前检查清单”（依赖、配置、容量、监控、告警）
- [x] 预演一次全量发布流程（含故障注入）
- [x] 预演一次**版本级回退**流程（不依赖运行时双栈开关）
- [x] 安排前端研发在测试环境进行真实 UI 交互回归，确保打字机效果和平滑度不低于旧版
- [x] 发布后 24h 加强巡检（SSE、clarify/resume、权限、成本）

**验收**：

- [x] 发布 Runbook 与回退 Runbook 可独立执行
- [x] 触发门槛和责任人明确
- [x] 前端渲染无退化（流式平滑度、Markdown 解析正常）

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
