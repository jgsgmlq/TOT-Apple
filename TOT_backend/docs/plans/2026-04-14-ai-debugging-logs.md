# AI 调试日志实施计划

## 目标（已完成 ✅）
在核心 AI 集成层（`TOT_backend/server/utils/ai.js`）中实现一个健壮的、由环境变量控制的日志机制。该机制会持久记录发送给 LLM 的精确输入（提示词、上下文、历史消息）以及接收的原始输出，以便排查复杂意图、提示词工程和 JSON 解析相关问题。

*（下方日志实现步骤已成功执行并完成验证。）*

## 实施步骤（已完成 ✅）
...（保留原始步骤用于历史追溯）

---

# 架构优化路线图：Executive Chat 与 Agent 框架

## 目标
为解决 Executive Chat 系统当前的局限（例如：僵化的 JSON 响应导致对话类问题出现幻觉、上下文记忆臃肿、Agent 架构割裂），我们提出分阶段的架构重构方案。该方案将显著提升意图扩展性、响应质量与可维护性。

## 范围与非目标
- **范围：**
  - `TOT_backend/server/services/chatService.js`
  - `TOT_backend/server/services/chatAgentRunner.js`
  - `TOT_backend/server/services/chatToolsService.js`
  - `TOT_frontend/src/views/executive/index.vue`
- **非目标：**
  - 不改动 Executive Chat 权限模型定义本身
  - 不在本阶段引入新的业务数据指标
  - 不做全量 Agent 重写（仅先打通兼容与演进路径）
  - 不实现 `generate_nudge_message`、邮件草稿生成、自动外发等运营动作能力（超出 Executive Chat 范围）

## 实施前置闸门（必须满足）
1. **契约闸门：** 对齐 `TOT_backend/docs/specs/04-API-SPEC.md` 与 `TOT_backend/docs/specs/09-EXECUTIVE-CHAT.md`，避免先改代码后漂移。
2. **权限闸门：** 任何工具执行都必须经过角色与区域裁剪（沿用 `chatToolsService` 权限收敛口）。
3. **回滚闸门：** 每阶段都要有可单独回滚开关或可逆改动策略。

## 第一阶段：上下文记忆优化与优雅回退（即时修复，功能已实现，验收待完成）
**目标：** 防止 AI 被冗长的历史 JSON 响应“污染”，并让它在对话类问题（如“你能做什么？”）下能够优雅作答，而不是被强制输出看板 UI 格式。

### 为什么这种“宽进严出”的方法对未来意图扩展至关重要：
在此次修复之前，系统强制 LLM *始终*输出复杂的 JSON 结构（包含 `overview`、`keyNumbers` 等），并将这个原始的 JSON 字符串盲目追加到对话历史中。这导致了严重的问题：
1.  **上下文污染与“复读机”效应：** LLM 的上下文窗口被重复的 JSON 语法塞满。当被问到一个简单的对话问题（例如，“谢谢”）时，受到自身历史严重偏置的 LLM 产生幻觉，重复之前的 JSON 块，而不是自然地回答。
2.  **意图扩展瓶颈：** 如果添加新分析意图（例如“分位数查询”或“相关性分析”），强迫 LLM 把复杂分析结果硬塞进固定看板 JSON 的单个 `overview` 字符串，会导致解析不稳定和 token 浪费。

通过允许 LLM 自由输出文本并在存入数据库记忆前提取纯文本（Context Pruning），LLM 能在后续对话中保持清晰的逻辑推理能力；而通过优雅的对话回退（Conversational Fallback），未来新增 `progress_query / warning_query / analytics_query` 等意图时，不会被历史 JSON 污染拖垮。

*   **步骤 1.1：上下文裁剪（`chatService.js`）**
    *   **操作：** 在为 LLM 构建 `history` 数组时，拦截 `role === 'assistant'` 的消息。
    *   **逻辑：** 不再发送原始序列化 JSON 字符串（其中包含 `overview`、`keyNumbers` 等），而是解析 JSON 并仅提取 `overview` 文本。若解析失败，则回退为原始文本。这样可保持 LLM 上下文窗口干净，聚焦叙事流，而非结构化样板内容。
*   **步骤 1.2：对话回退（`chatAgentRunner.js`）**
    *   **操作：** 更新 `SYSTEM_PROMPT`，明确允许模型在用户问题属于对话场景（如问候、询问能力）且不需要数据可视化时先输出纯文本；服务端统一封装为 `replyContent` 结构返回前端。
    *   **逻辑（推荐兼容方案）：** 修改后处理逻辑（`JSON.parse` 外层 `try/catch`）。若 AI 返回符合现有 schema 的合法 JSON，则按原样返回；若 AI 返回纯文本（或无法修复的非法 JSON），则优先包装为**兼容现有契约**的结构：
      `{
        replyContent: {
          overview: finalContent,
          keyNumbers: [],
          attentionPoints: [],
          followUpSuggestions: []
        }
      }`
      仅在 API Spec 明确升级后，再引入 `{ messageType: 'text', content }` 新形态。
    *   **前端影响：** 前端（`TOT_frontend/src/views/executive/index.vue`）需支持“结构化但空指标”渲染路径：当 `keyNumbers` 与 `attentionPoints` 为空时，展示文本主答复。

### 第一阶段验收标准
- 连续 20 条“闲聊/能力咨询”类问题，`JSON.parse` 失败率为 `0%`（0/20），且人工抽检幻觉率不高于基线（允许 `<=5%` 波动）。
- 连续 20 条“看板分析”类问题，仍保持原有 KPI 展示能力。
- 观测日志中 Assistant 历史上下文 token 中位数较改造前下降 `>=20%`。

### 第一阶段回滚策略
- 使用特性开关（例如 `EXEC_CHAT_TEXT_FALLBACK_ENABLED=false`）关闭回退逻辑。
- 保留旧 `history` 组装路径，可通过开关切换回原行为。

## 第二阶段：动态工具注册（插件化架构，已完成：基础治理版 ✅）
**目标：** 消除 `chatToolsService.js` 中庞大且硬编码的 `TOOL_SCHEMAS` 数组与大型 `switch` 语句。让新增意图变成“新增一个文件”这么简单。

*   **步骤 2.1：工具目录结构**
    *   **操作：** 新建目录 `TOT_backend/server/chat_tools/`。
*   **步骤 2.2：统一工具接口**
    *   **操作：** 将现有工具（如 `getOverviewData`、`getTaskListData`）重构为 `chat_tools/` 下的独立文件。
    *   **逻辑：** 每个文件必须导出：
        *   `schema`：定义工具名称、描述和参数的 JSON Schema（严格符合 DeepSeek/OpenAI 要求）。
        *   `handler`：执行数据库查询并返回结果的异步函数。
        *   `meta`（新增）：`requiredRole`、`scopePolicy`、`timeoutMs`、`enabled`，用于注册时统一校验。
*   **步骤 2.3：自动发现（`chatToolsService.js`）**
    *   **操作：** 重写 `chatToolsService.js`，在启动时通过 `fs.readdirSync` 动态读取 `chat_tools/` 目录。
    *   **逻辑：** 自动构建 `TOOL_SCHEMAS` 数组与 `toolHandlers` 映射。Agent 请求执行工具时，必须按顺序经过：
      1) 工具名白名单存在性校验  
      2) 参数 schema 校验  
      3) 角色/区域权限校验  
      4) 执行与超时保护  
      5) 统一错误包装（避免裸栈信息泄漏）

### 第二阶段验收标准
- 新增一个工具文件后无需改 `switch` 即可被发现并调用。
- 未通过权限校验的工具调用被稳定拒绝，并返回统一错误格式。
- 现有核心查询工具回归测试通过（结果与改造前一致）。

### 第二阶段后续增强（可选）
- 引入深度 JSON Schema 校验（如 Ajv），替代当前“required 字段”基础校验。
- 统一错误码与错误对象结构，替代当前字符串错误描述。

### 第二阶段回滚策略
- 保留旧版 `chatToolsService` 实现文件，支持通过开关切回静态路由。
- 插件加载失败时降级为“仅加载核心内置工具”模式，避免整体不可用。

## 第三阶段：统一 Agent 架构（长期）
**目标：** 将静态命令式 Agent（`server/agent/core.js`）与动态会话式 Agent（`chatAgentRunner.js`）合并为一个统一、内聚的框架。

*   **步骤 3.1：将 Skill 作为工具**
    *   **操作：** 将 Executive Chat 范围内的查询与分析能力（`progress_query`、`project_status`、`warning_query`、`drill_down`、`analytics_query`）暴露为可执行工具。
    *   **逻辑：** 以 `function_calling` 为主链路：模型自主选择 Tool 并填充参数；代码侧仅执行安全闸门（白名单、schema、权限、超时、错误包装）。轻量意图识别仅用于观测、拒绝越界请求与降级策略，不作为主调用路径。
*   **步骤 3.2：会话状态管理**
    *   **操作：** 引入与 `sessionId` 绑定的临时会话状态对象（内存或 Redis 支持）。
    *   **逻辑：** 不再把所有原始数据库结果塞进 LLM 上下文窗口（这会消耗 token 且有截断风险），而是将大数据集存入会话状态。LLM 仅接收摘要和“引用指针”（例如 `[Data stored in context key: highRiskStores_1]`）。后续问题可回溯该状态，无需重新查询数据库，也不会膨胀提示词。
    *   **生命周期约束（新增）：**
      - TTL：默认 30 分钟无活动即过期
      - 容量：每会话最大 `20` 个数据块（可通过配置覆盖），超出后 LRU 淘汰
      - 安全：状态对象绑定 `roleScope` 与 `regionScope` 指纹，若会话权限变化则强制失效
      - 并发：同一 `sessionId` 写入采用版本号（`version`）防覆盖

### 第三阶段实现清单：Skill / Tool / 底层调用函数（严格对齐 PRD §5.7 / §5.7.1）

> 目标：将 Executive Chat 能力收敛到“培训分析问答”主线，避免引入邮件生成、运营动作生成等越界功能。

#### A. 基础四类能力（PRD §5.7）

1. **`progress_query`（培训进度查询）**
   - 示例：`Q1 新品培训完成率？`
   - 输出：完成率、完成人数、样本范围。

2. **`project_status`（项目状态查询）**
   - 示例：`Trade-in 准备到哪一步了？`
   - 输出：阶段状态、阻塞点、预计节点。

3. **`warning_query`（预警查询）**
   - 示例：`现在有什么问题需要关注？`
   - 输出：需关注区域/门店、风险等级、触发口径。

4. **`drill_down`（区域/门店下钻）**
   - 示例：`华东区怎么样？最差的 5 家门店是哪些？`
   - 输出：分区域/门店细分指标、Top/Bottom 列表。

#### B. 高阶分析能力（PRD §5.7.1）

- **EC-P0（首发必含）**
  - `analytics_query` + `quantile_duration`
  - `analytics_query` + `completion_time_distribution`
  - `analytics_query` + `metric_correlation`

- **EC-P1（后续批次）**
  - `analytics_query` + `progress_variance_by_channel`
  - `analytics_query` + `completion_rate_forecast`
  - `analytics_query` + `trimmed_mean_duration`

#### C. Tool 暴露清单（给 LLM function calling）

> 命名原则：Tool 体现“查询能力”，不体现“外发动作”。

- `tool_getProgressMetrics`
  - 绑定能力：`progress_query`
  - schema（示例）：`{ taskId?, dateRange?, region?, channel? }`

- `tool_getProjectStatus`
  - 绑定能力：`project_status`
  - schema（示例）：`{ projectId|projectName, region?, dateRange? }`

- `tool_getWarnings`
  - 绑定能力：`warning_query`
  - schema（示例）：`{ scope, riskLevel?, dateRange?, topN? }`

- `tool_getDrillDownMetrics`
  - 绑定能力：`drill_down`
  - schema（示例）：`{ dimension: region|store, target, metric, rank?, topN? }`

- `tool_runAnalytics`
  - 绑定能力：`analytics_query`
  - schema（示例）：`{ analysisType, scope, metric, dateRange, options? }`
  - 约束：`analysisType` 必须来自 `entities.analysisType`（由意图识别阶段抽取并透传），不得在执行层“猜测”子类型。

#### D. 底层调用函数清单（真正执行层）

> 每个 Tool 必须有独立 Handler，统一由 `chatToolsService` 执行器调度，并经过权限/参数/超时/错误包装。

- `handleGetProgressMetrics(ctx, args)`
  - 建议文件：`TOT_backend/server/chat_tools/tool_getProgressMetrics.js`
  - 对应能力：`progress_query`

- `handleGetProjectStatus(ctx, args)`
  - 建议文件：`TOT_backend/server/chat_tools/tool_getProjectStatus.js`
  - 对应能力：`project_status`

- `handleGetWarnings(ctx, args)`
  - 建议文件：`TOT_backend/server/chat_tools/tool_getWarnings.js`
  - 对应能力：`warning_query`

- `handleGetDrillDownMetrics(ctx, args)`
  - 建议文件：`TOT_backend/server/chat_tools/tool_getDrillDownMetrics.js`
  - 对应能力：`drill_down`

- `handleRunAnalytics(ctx, args)`
  - 建议文件：`TOT_backend/server/chat_tools/tool_runAnalytics.js`
  - 对应能力：`analytics_query`（内部按 `analysisType` 分派）

#### E. 高阶分析底层函数（`tool_runAnalytics` 内部分派）

- `computeQuantileDuration(ctx, args)`（EC-P0）
- `computeCompletionTimeDistribution(ctx, args)`（EC-P0）
- `computeMetricCorrelation(ctx, args)`（EC-P0）
- `computeProgressVarianceByChannel(ctx, args)`（EC-P1）
- `computeCompletionRateForecast(ctx, args)`（EC-P1）
- `computeTrimmedMeanDuration(ctx, args)`（EC-P1）

#### F. 基础服务函数（建议新增）

- `TOT_backend/server/services/chatAnalyticsService.js`
  - 负责高阶统计计算与口径统一（分位数、分布、相关性、预测、截尾均值）。

- `TOT_backend/server/services/chatToolsService.js`（执行器扩展）
  - `registerToolsFromDirectory(dir)`
  - `validateToolArgs(schema, args)`
  - `authorizeToolCall(meta, sessionScope)`
  - `executeTool(name, ctx, args)`
  - 职责：统一注册、校验、鉴权、超时、错误包装与审计日志。

#### G. 意图识别保留项（仍然需要）

- `classifyIntentType(message, session)`（建议在 `chatAgentRunner.js`）
  - 输出：`progress_query | project_status | warning_query | drill_down | analytics_query | chat_only | deny`
  - 用途：用于观测与策略控制（如越界拦截/降级），**不替代** `function_calling` 的主路由决策。

- `extractEntities(message, intentType, session)`（建议在 `chatAgentRunner.js`）
  - 最低输出：`{ taskId?, region?, storeId?, topN?, analysisType? }`
  - 强约束：当 `intentType=analytics_query` 时，必须产出合法的 `entities.analysisType`，否则拒绝进入 `tool_runAnalytics` 并返回可追问提示。

#### H. 响应契约层级声明（与 04 保持一致）

- 本计划中提及的 `overview / keyNumbers / attentionPoints / followUpSuggestions` 均指 **`replyContent` 内部字段**，不是 API 顶层字段。
- 对话回退场景也必须保持 `replyContent` 结构稳定（允许数组为空），避免前后端解析分叉。
- `messageType` 如已存在于代码中，仅允许作为内部调试/埋点字段，不能成为前端渲染的外部契约依赖。

#### I. `warning_query` 数据口径降级策略

- 优先路径：使用预警明细能力返回门店/区域风险列表（按权限裁剪）。
- 降级路径：若明细口径受限或接口未就绪，则使用可用聚合口径（如 `overview`、`store-rank`、`trend` 的风险相关字段）生成结构化预警摘要。
- 任何降级返回都需在 `replyContent.overview` 或 `statisticsProvenance` 中标明“口径来源与限制”，防止误读。

#### J. 高阶统计实现策略（SQLite 约束下）

- 采用 **混合方案（推荐）**：SQL 负责过滤、权限裁剪、排序与基础聚合；Node.js 负责分位数、方差、截尾均值、相关性与简单预测计算。
- 不推荐在 SQLite 中强行拼装复杂统计 SQL（可读性与可维护性差，跨版本风险高）。
- 执行护栏：
  - 单次分析样本量设上限（防止内存尖峰）
  - 关键过滤字段建索引（防止慢查询）
  - 对重复分析结果做短 TTL 缓存（降低重复计算）

### 第三阶段验收标准
- 多轮追问命中会话缓存时，响应 P95 延迟较实时重查路径下降 `>=30%`。
- 权限切换或会话过期后，旧状态不可再被读取。
- 长对话场景下，连续 10 轮后提示词 token 增长斜率较改造前下降 `>=25%`。

### 第三阶段回滚策略
- Redis/内存态开关可关闭，退回“无会话缓存”的当前模式。
- Skill-as-Tool 调用链路按能力开关逐个上线，出现异常可单能力下线。

## 文档同步清单（执行本路线图时必须同步）
> 说明：本节在**进入代码实施阶段**时生效；当前“仅文档打磨阶段”以「执行决策记录」中的 `doc_sync=plan_only` 为准。

- 若引入新响应形态：更新 `TOT_backend/docs/specs/04-API-SPEC.md` 与 `TOT_backend/docs/specs/09-EXECUTIVE-CHAT.md`
- 若工具注册机制变更：更新 `TOT_backend/docs/backend/02-SERVICES.md`
- 若新增会话状态存储（含 Redis）：更新 `TOT_backend/docs/backend/03-DATABASE.md`（若无 DB 变更也需记录存储策略）

## 里程碑与建议顺序
1. **M1（1~2 天）：** 完成第一阶段并灰度发布  
2. **M2（2~4 天）：** 完成第二阶段插件化改造并做回归  
3. **M3（按迭代）：** 完成第三阶段会话态与能力融合

> 建议先完成 M1 并稳定 24~48 小时，再进入 M2，避免问题叠加导致定位困难。

## 执行决策记录（文档阶段）

> 以下为本轮确认的默认决策，用于后续实现阶段对齐；若实现时有变化，需先更新本节再改代码。

- **当前范围：** 仅打磨文档，不修改代码。
- **contract_shape：** `replycontent_only`（仅保持 `replyContent` 兼容形态，不引入 `messageType` 新形态）。
- **intent_placement：** `hybrid`（识别在 `chatIntentService`，编排在 `chatAgentRunner`）。
- **warning_fallback：** `store_rank_first`（`store-rank -> overview -> trend`）。
- **analytics_batch：** 文档阶段仅定义，不做代码实现分批。
- **session_store：** `memory_then_redis`（实现时先内存，预留 Redis 扩展）。
- **env_naming：** `add_minimal`（仅新增最小必要配置项）。
- **testset_owner：** `mixed`（用户提供核心题，AI 补齐长尾题）。
- **gray_release：** `N/A`（文档阶段不涉及上线灰度策略）。
- **doc_sync：** `plan_only`（本轮仅维护本计划文档）。
- **function_calling_policy：** `model_primary_with_code_guardrails`（模型主调度，代码强校验）。
- **message_type_policy：** `internal_only`（不作为对外契约）。
- **analytics_compute_policy：** `sql_filter_plus_node_compute`（SQLite 过滤 + Node 统计）。

## Phase 1 最小验收模板（待执行）

> 用途：将“功能已实现”升级为“已验证完成”。  
> 验收完成前，不建议将第一阶段标记为“已完成 ✅”。

### A. 用例分组与数量

- **闲聊/能力咨询类：20 条**
  - 例如：`你好`、`你能做什么`、`谢谢`、`你是谁`、`你支持哪些分析`
- **看板分析类：20 条**
  - 覆盖：`progress_query` / `project_status` / `warning_query` / `drill_down` / `analytics_query`（至少各 3 条）

### B. 单条记录模板（建议复制到表格）

| CaseID | 类别 | 用户问题 | 期望 intentType | 是否调用 Tool | 返回是否为 `replyContent` 结构 | `JSON.parse` 是否成功 | 结果摘要 | 备注 |
|---|---|---|---|---|---|---|---|---|
| C01 | chat | 你好 | chat_only | 否 | 是 | 是 | 通过/失败 |  |

### C. 量化通过门槛（与本文第一阶段验收标准对齐）

1. 闲聊/能力咨询 20 条中：
   - `JSON.parse` 失败率 = `0%`（0/20）
   - 幻觉率不高于基线（允许 `<=5%` 波动）
2. 看板分析 20 条中：
   - KPI 与结构化内容正常展示（无关键字段缺失导致的展示异常）
3. 上下文优化效果：
   - Assistant 历史上下文 token 中位数较改造前下降 `>=20%`

### D. 证据留存要求

- 保存执行日期、执行人、环境（dev/staging）。
- 记录每条用例的原始请求与响应摘要（可脱敏）。
- 附一份汇总结论：
  - 通过/未通过
  - 未通过项列表
  - 修复计划与回归时间