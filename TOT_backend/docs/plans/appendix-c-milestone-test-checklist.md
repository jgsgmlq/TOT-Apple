# 附件 C：里程碑与测试验收清单

**目标**: 为 Executive Chat LangGraph 迁移提供周粒度计划与可执行验收清单。

---

## C1. 周粒度里程碑（建议 5 周）

### Week 1 - 设计冻结

- [ ] 完成 As-Is/To-Be 架构评审
- [ ] 确认节点职责与 Graph State 字段
- [ ] 确认 **拍平 `ExecChatGraphState`** 字段与 **`InterruptPayload`** 约定（附件 A §A3）
- [ ] 确认 **单图** Executive：**无** Master/Executive LangGraph 嵌套；远期多 Agent 用 **独立图** 或 API 网关分发
- [ ] 确认 **Local Tool Registry**（`tool_namespace`）与 Top-K 检索仅在 Executive 图内执行
- [ ] 确认 PoC 范围（工具清单、协议边界）
- [ ] 确认**全量切流策略**（一次性发布）与**版本级回退预案**（非运行时双栈开关）

**出口标准**: 评审结论为 Go，未决问题有明确 owner 和截止日期。

### Week 2 - PoC 主链路与流式 Side-effect

- [ ] 搭建 LangGraph runtime 骨架，可被 `chatService` 路由调用
- [ ] 跑通单图主干：`LoadContext`（可选）-> **`ContextAnalyzerRouter`** -> `ToolRetrieve` -> **`fc_CheckSteps` -> `fc_LlmToolCallStep` -> `fc_ValidateParams` -> `fc_ExecuteTool` -> `fc_MergeToolResults`**（至少一轮闭环）
- [ ] **技术攻坚**：在 **`fc_LlmToolCallStep`** 内注入回调，以 Side-effect 形式实时推送 SSE Token 流（含 `reasoning` 与 `content`）；与附件 A §A2、§A11 一致
- [ ] 输出兼容现有的 `markdownContent`

**出口标准**: 至少 3 条核心单轮问答（含工具调用）在 PoC 路径稳定通过，前端打字机效果正常。

### Week 3 - 工具层迁移、监控对齐与多级记忆链路

- [ ] 工具动态注册与 JSON Schema 校验迁移至 **`fc_ExecuteTool`** 所调用的执行层（或等价 `chatToolsService` 封装）
- [ ] 角色与 scope 权限校验对齐 legacy
- [ ] 超时、错误语义映射对齐 legacy
- [ ] 引入 `LangfuseCallbackHandler`，验证图节点流转和 LLM 调用的 Trace 瀑布流是否完整
- [ ] **记忆落地**：实现 `LoadContext` 语义检索；先落 **`PersistAndEmit` 后事件 + Queue 接口抽象**，再接入 `MemoryWorker` 消费端（连接配置后补），验证 14 天 TTL 机制可用

**出口标准**: 工具层回归用例通过率 >= 95%，Langfuse 能够清晰追踪 LangGraph 执行流，长短期记忆可被正确存取。

### Week 4 - 基于 Checkpointer 的中断与恢复 (Clarification)

- [ ] 引入 `MemorySaver` 或 Redis Checkpointer 保存图执行快照
- [ ] 实现 **`HumanInTheLoopGate`**（兼容期可继续下发 SSE `phase: clarify` 或与 `InterruptPayload` 映射），当遇到重名等歧义时触发挂起
- [ ] 前端二次请求携带 `clarificationResponse` 时，测试直接恢复 (Resume) 图执行并闭环回答
- [ ] 验证旧版的“手工伪造 DB 消息”逻辑是否可被安全剔除

**出口标准**: 消歧场景端到端通过，图状态可被成功序列化与反序列化，无 P0/P1 回归。

### Week 5 - 稳定性与全量发布准备

- [ ] 补充 Fallback (intent_routing) 等边缘降级策略节点
- [ ] 性能压测（首 Token 时延、Checkpointer 读写耗时、P95 响应、超时率）
- [ ] 完成全量发布前检查清单（配置、依赖、监控、告警）
- [ ] 回退演练（通过版本回退/快速重发版，不依赖运行时 legacy 开关）
- [ ] 文档同步与运维手册更新

**出口标准**: 性能指标与功能门槛达标，进入正式切流窗口。

---

## C2. 测试清单（最小必测）

### 功能回归

- [ ] 寒暄闲聊正常走 `chat_only` 节点，不触发 LLM 工具分析
- [ ] 危险意图（如修改数据、发邮件）被 **`ContextAnalyzerRouter`（及必要规则前置）** 拒答或拦截，且工具层仍做确定性权限校验（与附件 A §A10.4 一致）
- [ ] 普通查询（如“查看全国完成率”）可触发工具并生成正确结论
- [ ] 多工具联动场景能在 **`fc_*` 链**（`fc_CheckSteps` 条件边闭环）中收敛，工具结果经 **`fc_MergeToolResults`** 汇总可追溯

### 消歧与状态恢复 (Interrupt/Resume)

- [ ] 门店名称存在歧义时，精准挂起并返回候选列表
- [ ] 用户选择候选后，Checkpointer 能正确恢复图状态并基于选项继续回答
- [ ] 无合法候选或错误候选时，返回可解释的引导提示

### 权限与安全

- [ ] regional 账号禁止越权调用 national 级别数据
- [ ] national_only 属性的工具必须阻断非 national scope 的调用
- [ ] LLM 给定异常参数时，工具层有效拦截并提示 `INVALID_PARAMETERS`

### 流式与打断

- [ ] `delta` 事件（content 与 reasoning）稳定平滑推送，无粘包/断流
- [ ] 工具调用的 `tool_start` 和 `tool_end` 时序正确，前端可显示“执行中”状态
- [ ] 客户端主动断开连接 (Abort) 后，图节点能够快速停止或收敛，不浪费算力

### 观测与诊断

- [ ] Langfuse Trace 包含完整的 Root 轨迹、核心 Node 耗时及最终出口状态
- [ ] **`fc_ExecuteTool`** 能正确记录 `cacheHit`、`errorCode` 和 `duration`（或等价 span 字段）
- [ ] 异常熔断链路（如图循环超限）可在日志和 Trace 中快速定位根因

---

## C3. 四层优化专项测试（新增）

### C3.1 NER 前置标准化专项

- [ ] `region_id/store_id/task_id` 可从自然语言稳定映射到 canonical 值
- [ ] 低置信（< `ner_confidence_threshold`）时必须进入 **`HumanInTheLoopGate`**（或等价澄清路径）
- [ ] `entities.raw/canonical/confidence` 写入调试日志且可追踪

### C3.2 Top-K 工具约束专项

- [ ] 默认只向 LLM 暴露 Top-3 工具
- [ ] Top-3 全低置信时触发一次 Top-5 扩容
- [ ] 扩容次数受限（仅一次），不会重复扩大决策空间

### C3.3 参数校验与修参闭环专项

- [ ] Schema 校验失败时进入 `ParamRepair`，并携带 `violations`
- [ ] 修参后能回到 **`fc_ValidateParams`**（与主文档 §11.3 **`ParamValidate`** 同义，见附件 A §A11）并正确通过
- [ ] 达到 `max_param_repair_attempts` 后转澄清或降级，不出现无限循环

### C3.4 参数准确率与告警专项

- [ ] 正确上报 `param_schema_pass_rate`
- [ ] 正确上报 `param_business_pass_rate`
- [ ] 低于阈值触发告警，并附带最近失败样本（脱敏）

---

## C3.5 `fc_*` 链与 Checkpoint 专项

- [ ] `fc_CheckSteps` 在达到 `max_steps` 时**硬性**停止工具调用（Conditional Edge），并返回可解释收尾
- [ ] `fc_CheckDuplicate` 拦截等价重复 tool call（同签名/同 hash），并有审计字段
- [ ] `fc_MergeToolResults` 成功后，模拟进程重启，可从 Checkpointer **恢复且不丢**已写入的 `toolResults`
- [ ] `fc_LlmToolCallStep` 单 Node 单次 LLM，循环仅由边构成，不在 Node 内 while

---

## C3.6 Plan-Execute（V2 可选，PoC 不验收）

PoC/V1 **不**将 Plan 列为交付项；若 V2 启用，再补：`PlanOnce` / `ExecutePlan` / `SummarizeOnce`、与 `fc_*` 互斥及降级策略（附件 A §A12）。

---

## C3.7 多级记忆流转专项（新增）

- [ ] 验证短记忆：长会话多轮对话未引发超窗，截断机制 (`trim_messages`) 起效
- [ ] 验证记忆注入：`LoadContext` 成功将历史强偏好注入上下文，**`ContextAnalyzerRouter` / FC** 回答遵循该偏好
- [ ] 验证异步清洗：主请求在 **`PersistAndEmit` 结束**后不阻塞；**`MemoryWorker`** 消费 `MemoryIngestRequested` 并成功创建 pending 或 active 状态记录
- [ ] 验证过期清理：定时扫描任务（或原生 TTL）能成功清除 > 14天 的 `mid_term` 记录

---

## C4. 发布门槛（建议）

- 核心场景通过率 >= 98%
- P95 响应时延不劣于 legacy 超过 15%
- 关键错误率不高于 legacy
- 回滚演练成功 >= 1 次
- 四层优化专项测试全部通过
