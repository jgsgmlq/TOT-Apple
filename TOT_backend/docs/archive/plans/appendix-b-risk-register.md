# 附件 B：风险台账（Risk Register）

**范围**: Executive Chat 迁移到 LangGraph（编排层 + 工具层）

---

## B1. 风险分级定义

- **High**: 可能阻断发布或造成核心功能回归
- **Medium**: 可发布但会显著影响体验/稳定性
- **Low**: 可接受范围内的已知偏差

---

## B2. 风险清单

| ID | 风险描述 | 等级 | 触发信号 | 缓解措施 | 责任 |
|---|---|---|---|---|---|
| R1 | SSE 流式推送因 LangGraph 节点粒度问题产生卡顿或协议不兼容 | High | 前端无法显示打字机效果、工具执行态或 clarify | 将 SSE 拆解为 **`fc_LlmToolCallStep`** 等的 Token 级副作用，并做严格的协议回放对比测试 | Backend |
| R2 | 基于 Checkpointer 的 Clarify/Resume 机制引入持久化瓶颈或死锁 | High | 出现门店重名挂起后，二次请求无法正确唤醒原图状态 | 提前验证 Checkpointer (Redis/Postgres) 的序列化开销，确保挂起状态完全可重建 | Backend |
| R3 | scope/权限校验漏迁移，产生数据越权 | High | 区域账号可查全国数据或越区数据 | 统一在 **`fc_ExecuteTool`**（及工具内）强制校验，增加权限回归用例 | Backend |
| R4 | LangGraph 循环控制不当导致工具死循环 | High | token 激增、API 超时、模型成本异常 | 图定义中设置严格的 `maxIterations` 网关，并添加保护性熔断机制 | Backend |
| R5 | Langfuse 埋点遗漏导致观测断层 | Medium | 线上故障时 trace 不完整，无法还原执行瀑布流 | 废弃手动埋点，全面引入 `@langchain/core/tracers` 和官方 CallbackHandler | Backend |
| R6 | 工具错误语义映射变化引发回答偏差 | Medium | 相同报错场景下，前端收到的容错口径发生变化 | 复用现有的错误码映射字典，使用黄金用例进行双栈灰度对比 | Backend |
| R7 | 依赖升级（LangChain/LangGraph核心库）带来 Breaking Changes | Medium | 本地、CI与生产环境行为不一致 | 严格锁定 `@langchain/langgraph` 等核心依赖版本，增加 CI 冒烟测试 | Backend |
| R8 | 会话缓存命中逻辑变化导致结果抖动 | Low | 同问多次结果不一致 | 保持 Signature 签名规则稳定，监控 cacheHit 指标变化 | Backend |
| R9 | Multi-Agent / 嵌套子图过早抽象导致 PoC 延期 | Medium | 父子 Checkpoint、State 深嵌套返工；非 Executive 能力被误并入主图 | PoC 冻结：**单图 Executive** + 拍平 `ExecChatGraphState`；远期 Agent **独立图**；网关分发与 LangGraph 嵌套解耦 | Tech Lead |
| R10 | `L4_heavy_fc` 步数预算仍不足或误收敛 | Medium | 高复杂问题提前触发 `fc_FinalizeOrFallback`、答非所问 | 调 `max_iterations_per_turn` / Top-K / Router prompt；Langfuse 分档观测；V2 再评估 Plan（附件 A §A12） | Backend |
| R11 | 短期记忆无限膨胀导致 OOM 或 Context Window 溢出 | High | `messages` 数组过大导致 API 返回 400 | 在 **`fc_LlmToolCallStep` / `ContextAnalyzerRouter`** 等 LLM 节点前引入 `trim_messages` 做滑动窗口截断 | Backend |
| R12 | 异步记忆萃取引发竞态条件或旧记忆覆盖失败 | Medium | Store 中存在互相矛盾的长期记忆记录 | **`MemoryWorker`** 侧幂等键、串行更新或乐观锁；矛盾解决 Prompt 与重试策略在 Worker 内统一 | Backend |

---

## B3. 上线前必过风控 Gate

1. 权限越权用例全部通过（含 regional/rtm/national）。
2. clarify/resume 关键路径通过（验证基于 Checkpointer 的中断与恢复）。
3. SSE 事件协议回放通过（含 content / reasoning / tool_start / tool_end / clarify）。
4. Langfuse 跟踪完整（入口 -> **单图**节点链 -> LLM 请求 -> 出口）。
5. 版本级回退能力验证通过（无运行时 legacy 开关前提下可在目标时限内恢复）。

---

## B4. 回滚预案（最小）

触发条件（任一满足即回滚）：

- 线上核心问答失败率连续 5 分钟超阈值。
- Clarify 路径失败率显著高于 legacy，或导致死锁。
- 出现权限越权 P0 问题。
- SSE 延迟飙升（首 Token 时延显著恶化）。

回滚动作：

1. 触发紧急回退发布（回滚到上一个稳定版本），并冻结新版本继续扩散。
2. 保留现场请求日志、图状态快照与 Langfuse trace 样本。
3. 召开 30 分钟故障复盘，确认根因并修复后再重启发布流程。
