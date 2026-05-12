# Central Board 数据架构及后端重构方案

## 概览 (Overview)
当前项目中，前端 (`central/newBoard/index.vue`) 承担了极为沉重的计算任务。后端 API（`/api/v1/dashboard/*`）主要提供了“细颗粒度的数据切片”或“原始百分比”，而真正的**业务规则（如预警倒挂修正、趋势切片、催办转化率）全部耦合在前端**。

**术语（与「下沉 / 下钻」区分）**

- **计算收口至后端**：把原先在前端的组装、换算、派生指标改为由接口直接返回（与「前端仅展示」同一目标；**不是**下钻）。下文如未特别声明，**口语中的「下沉」均指本含义**。
- **数据下钻**：按 RTM / 经销商 / 门店等维度**层层展开**查看细分行数据（弹窗、breadcrumb、`rtmLevel` 等请求参数）。

二者独立：可以只做计算收口而不改下钻交互；下钻也可以继续用现有多接口，由后端新增「下钻专用一次返回」来减少前端编排。

本次重构的核心理念：**前端仅负责展示（V），数据的组装、聚合、判定、换算尽量计算收口至后端服务（C/M）。并且后端服务一定要模块化**

---

## 1. 北极星模块 (North Star / 核心效率指标)

该模块主要展示大盘的顶层 KPI 数据。

| 展示数据 / 指标 | 数据示例 | 当前计算方 | 当前计算逻辑分析 | 重构建议 |
| :--- | :--- | :--- | :--- | :--- |
| **按时完成率 / 总完成率** | 39.00% | ⚠️ **前后端混合** | 后端算出 `0-100` 返回。前端执行 `/ 100` 转化为小数。 | 后端统一下发规范（建议 `0-1` 浮点数），前端移除补丁。 |
| **较昨日变化 (Rate Delta)** | 0.0pp（无变化） | ❌ **前端计算** | 前端遍历 Trend 每日数据算出昨日完成率，用今日减昨日得出。 | 后端 Overview 接口直接新增 `completionRateDelta`。 |
| **人均耗时** | 206.3h | ✅ **后端计算** | 后端 SQL 聚合算出 `avgCompletionTimeHours`。 | 保持不变。 |
| **剩余时间 (倒计时)** | 161h 46m 44s | ❌ **前端计算** | 前端用 `ddlTime - Date.now()` 毫秒换算天/时/分。 | 后端直接返回倒计时的友好字符串或严格的剩余秒数。 |
| **数据截止时间** | 05/18 09:17 | ✅ **后端计算** | 后端返回 `updatedAt`。 | 保持不变。 |
| **触达确认率 (送达与确认)** | 71.0% (已确认:71 / 已送达:100) | ✅ **后端计算** | 后端通过 `taskReachRate` (71%)、`totalAssignments` (100) 下发。 | 保持不变。 |
| **预警总条数及优先级分布** | 共 71 条 (P0: 0 / P1: 0 / P2: 71) | ❌ **前端计算** | 前端通过各级预警率反算人数并手动加和。 | 后端在 Overview 中给出精确绝对数值。 |

---

## 2. 转化漏斗一栏 (用户 / 任务全流程转化) 【支持数据下钻】

该模块展示从“推送 -> 送达 -> 学习中 -> 已完成”的标准进度漏斗。

| 展示数据 / 指标 | 数据示例 (数值 / 占比 / 流失率) | 当前计算方 | 当前计算逻辑分析 | 重构建议 | 需重写后端返回该字段 / 后端已计算则仅改前端 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **推送** | 100 / 100% / 流失: - | ⚠️ **混合** | **人数**：后端 `pushUserCount`；前端仅在缺省时用 `totalAssignments` 兜底，并非重新查库计算。**占比 / 流失**：前端基于漏斗数组内 `count` 相除；后端未返回。 | 在 Overview（或嵌套对象）中下发组装好的阶段数据；可选字段：`shareOfFirst`、`dropFromPrevious`。不必强求新路由，除非要单独缓存/鉴权。 | **人数**：后端已计算（`pushUserCount`），**仅前端**映射/兜底即可。**占比、流失率**：当前前端相除；若**计算收口至后端**，需在 Overview 扩展派生字段或随 `stages[]` 一并返回。 |
| **送达** | 100 / 100% / 流失: - | ⚠️ **混合** | **人数**：后端 `totalAssignments`。**占比 / 流失**：同上前端相除。 | 同上。 | **人数**：后端已计算（`totalAssignments`），**仅前端**绑定「送达」阶段即可。**占比、流失率**：同推送；若**计算收口至后端**，需扩展接口。 |
| **学习中** | 71 / 71% / 流失: 29% (送达→学习中) | ⚠️ **混合** | **人数**：`inProgressCount` 与 `completedCount` **均由后端 SQL 聚合**；**两者之和**为当前 UI 的「学习中」人数，属于**前端固定的展示口径**（后端未提供合并后的单字段）。**流失率**：前端用相邻阶段 `count` 计算。 | 后端可增加显式字段（如 `funnelLearningCount`）或仅在 `conversionFunnel.stages[]` 中给出已合并的 `count` 及派生率，保证与**数据下钻**行和大盘口径一致。 | **两段原子人数**：后端已计算（`inProgressCount`、`completedCount`），在前端相加即可时 **仅前端**。**合并后的「学习中」单一人数**：若要以服务端为唯一口径，**需后端**新字段或 `stages[]` 中的已定稿 `count`。**流失率**：若**计算收口至后端**，需在 Overview 扩展派生字段。 |
| **已完成** | 39 / 39% / 流失: 45% (学习中→已完成) | ⚠️ **混合** | **人数**：后端 `completedCount`，前端直接引用。**占比 / 流失**：前端相除。 | 同上。 | **人数**：后端已计算（`completedCount`），**仅前端**引用即可。**占比、流失率**：同推送；若**计算收口至后端**，需扩展接口。 |
| **数据下钻（按阶段 × RTM→经销商→门店）** | 弹窗内各层级行：节点名、人数、占比 | ⚠️ **混合** | 前端 `loadFunnelModalData`：先请求 `GET /dashboard/heatmap`（带 `rtm` / `format` / `dealerName` 等下钻参数），再按所选漏斗阶段对每行拼装——`completed` 用 heatmap 的 `completedCount`/`completionRate`；`in_progress` 在前端再做 `inProgressCount + completedCount`；`pushed`/`delivered` 用当前行 `assignmentCount` 近似（注释中写明与精细 overview 拆解的差异）；非门店维且阶段为 read 时还会对每行并发 `GET /dashboard/overview`。门店维存在 heatmap 只回报名、overview 需 `storeId` 等限制，逻辑集中在前端。 | 提供按 `funnelStage`（及现有下钻 query）**一次返回下钻表格行**的接口，或与 heatmap 扩展「每行带阶段口径 count/rate」；消除 N×overview 与前端分支。 | **heatmap + overview 已能算** 各维度的原子指标；**仅前端**可维持现状但编排成本高。**若在数据下钻场景下**，行内口径须与大盘漏斗严格一致并去掉近似与多请求，**需后端**新增或扩展聚合返回（属下钻能力优化，与大盘「计算收口至后端」可分步实施）。 |

---

## 3. 预警中心一栏 (Warning Center) 【支持数据下钻】

此处历史上**前端重复推演时间带、反算人数、拼漏斗**的问题较突出；当前后端在 `dashboardQueryCore.getOverviewBoardData` / `getWarningsBoardData` 中已承担部分口径。需特别注意：**`crisisP*Rate` 与 `warningCount` 里的「P0/P1/P2」不是同一套定义**——前者来自**催办通知** `notification_events` 按 `severity` 去重人数；后者来自**时间带规则** `classifyDeadlineCrisisBand` 作用在每个 **`GROUP BY store_id, task_id` 聚合桶**上，桶内有未完成则该档 **+1**（单任务筛选下等价于「落入该档的**门店桶**个数」），**不是**「处于危机的人数」，也与「至少收到过一次黄催」的人数无必然相等关系。前端若用 `crisisP*Rate × totalAssignments` 反推「人数」，与 `warningCount` 或文案中的「人」可能对不齐。

| 展示数据 / 指标 | 数据示例 | 当前计算方 | 当前计算逻辑分析 | 重构建议 | 需重写后端返回该字段 / 后端已计算则仅改前端 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **预警等级占比 (P2/P1/P0)** | P2: 71%；涉及人数卡片 | ⚠️ **混合** | 后端下发 **`crisisP*Rate`**：`COUNT(DISTINCT target_user_id)`（该 `severity` 的催办记录）÷ **`totalAssignments`** ×100。**另有** **`warningCount: { p2, p1, p0 }`**：对每个 `(store_id, task_id)` 桶用 `ddl_at` + `auto_nudge_rules` 算临期带，命中则该档计数 **+1**（桶数维度，单任务下≈门店数）。两套数字**不得**混解释为同一「人数」。 | 产品定稿：**卡片上的「%」与「涉及 xx 人」**应对齐到哪一套（催办触达人头 / 时间带危机人头 / 门店桶数）；在 Overview 中拆成明确字段名（如 `crisisBandPersonCount`、`nudgeSeverityPersonCount`、`storeBucketCount`）并写进 API 文档；禁止前端用 rate×total 反推「人」。 | **`crisisP*Rate`**：后端已算，**仅前端**展示时勿与 `warningCount` 混读。**与 UI 一致的「绝对人数」**：**需后端**按定稿口径新增或重命名字段；**`warningCount`** 仅改文案/绑定或改 SQL 由产品决定。 |
| **预警风险漏斗 (各档人数及「未触发」文案)** | P2: 71, P1: 0, P0: 0, 未完成: 61 | ⚠️ **混合** | 临期带判定（`classifyDeadlineCrisisBand` + `auto_nudge_rules`）已在 **`getOverviewBoardData`** 内用于汇总 `warningCount`：对每个 `(store_id, task_id)` 桶 **if / else if** 只落入 **p0 / p1 / p2 之一**，故三个计数**互斥**，不会在「店桶」层同一桶重复累计多档。若前端仍用本地 `deadline` 再算一遍或与 **`crisisP*Rate`（催办人头）** 混排漏斗，仍易错。**未完成**：可用 `totalAssignments - completedCount`（或与 `completedCount` 同源的未完成定义）由前端算，或要求后端显式字段。 | **与漏斗图一致的「展示用」人数**：若产品要把 `warningCount`、`crisisP*`、未完成画在同一漏斗且满足单调/防倒挂，应在 **overview 内输出专用 `alertFunnel[]`（已定序、已定稿人数）**；`warningCount` 与 `crisisP*` 保留为原始指标亦可，但 UI 须标明含义。 | **店桶档位**：后端已算（`warningCount`）；**仅前端**删除重复 `classify…`。**未完成 / 漏斗合成**：**需后端**新字段或前端仅用 `totalAssignments`/`completedCount`。**单调展示**：**需后端**若产品强制与 `crisisP*` 合成一条漏斗。 |
| **总催办转化率（被催后转化）** | 例：50% | ✅ **后端计算** | Overview 已下发 **`nudgeConversionRate`**（被催办且随后完成（或平台完成）的去重人数 / 被催人数）。 | 若 UI 要的是**另一套**「漏斗阶段流失率」，与 `nudgeConversionRate` 区分命名，另设字段（如 `conversionRates.funnelOverall`），避免同名混用。 | **催办转化率**：后端已有（`nudgeConversionRate`），**仅前端**绑定即可。**漏斗整体转化率**：若仍要，**需后端**新字段。 |
| **预警列表 / 下钻 / 文案** | 列表行 + `triggerDesc` | ⚠️ **混合** | 已有 **`GET /dashboard/warnings`**（`getWarningsBoardData`）：分页、`warningLevel`、`triggerDesc`、`riskCount` 等在后端组装。前端若仍 **并发多请求 + concat + 手写 Unfinished**，属于未消费现成接口。 | 预警中心表格与下钻**优先改为只调** `GET /dashboard/warnings`（及现有 drill query）；缺「多 level 一次请求」再扩展 query（如 `levels=p2,p1,p0`），不必另起名为 `/alerts` 除非路由规划需要。 | **列表与描述**：后端已能算（`getWarningsBoardData`），**仅前端**改数据源即可；**多 level 合并请求**若仍要减少往返，**需后端**扩展参数或新聚合接口。 |

---

## 4. 完成趋势一栏 (Completion Trend)

展示任务随时间推进的累计和每日增量柱状图（示例时间范围：05.05 - 05.09，按日统计）。

**与实现对齐（`dashboardQueryCore.getTrendBoardData`）**：`type=daily` 时 SQL 按 `date(completed_at)` 分组得到每日 **`new_completed`（当日完成条数）**；随后在 Node 内做前缀和生成 **`cumulativeCompleted`**。`type=hourly` 同理按小时聚合。即**单日增量已在接口字段 `newCompleted` 中下发**，不必再靠前端对累计做差分（除非某处旧代码仍用差分，应以 `newBoard` 当前实现为准）。

| 展示数据 / 指标 | 数据示例 | 当前计算方 | 当前计算逻辑分析 | 重构建议 | 需重写后端返回该字段 / 后端已计算则仅改前端 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **每日累计完成数** | 05-08: 40<br>05-09: 48（累计应单调不减） | ✅ **后端计算** | `GET /dashboard/trend` 每条含 `cumulativeCompleted`（由 `newCompleted` 顺序累加）。 | 若希望纯 SQL 窗口函数产出累计，可改写查询；对前端展示非必须。 | **字段**：后端已有；**仅前端**绑定 `cumulative`/`cumulativeCompleted` 即可。 |
| **每日单期增量（柱状「当日完成」）** | 05-07: 8<br>05-08: 27 | ✅ **后端计算** | 接口已含 **`newCompleted`**，与「当日完成条数」同义。`newBoard` 中 `increment` **直接取** `d.newCompleted`，**不是**用「当日累计 − 前日累计」在前端重算。 | 文档与 API 规范中显式写明 `newCompleted` 即日增量；若团队更习惯命名 `dailyCompleted`，可做**别名字段**或仅改 OpenAPI/注释，避免重复造字段。 | **后端**：已有 `newCompleted`，**无需**再为同一语义加 `dailyCompleted`，除非兼容旧客户端双字段并存。**前端**：已正确映射则**仅文档**；若有其它页面仍用差分，改为读 `newCompleted`。 |
| **按周分段展示（7 天一组 + 标签）** | 05.05 - 05.09 (本周) | ❌ **前端计算** | `fetchOverview` 内对 `trendData` **`reverse` + `slice(7)` + 再 `reverse`** 拼出「本周/上周」等标签与分组；**后端 `groupBy=week` 未实现**。 | 若产品需要真按自然周/财年周聚合，再在 Trend 上增加 **`groupBy=week`**（或单独周维度接口），由 SQL `strftime` 分桶返回，减少前端切片与标签硬编码。 | **周桶数据**：**需后端**新参数或新接口。**仅 UI 分段**：可维持前端分组，**仅前端**。 |

---

## 5. RTM 进度排行一栏 (按渠道 / 门店类型) 【支持数据下钻】

多维度的完成进度横向条形图排行。

**与实现对齐**：`GET /dashboard/heatmap` → `getHeatmapBoardData`：按 `rtmLevel`（`rtm` / `region` / `format` / `dealer`·`dealer_name`·`dealername` / `store` 等）对 `task_assignments`+`stores` 分组，返回 `heatmapData[]`（`rtmValue`、`completionRate`、`completedCount`、`assignmentCount`、`avgCompletionTimeHours` 等）。下钻过滤由 **`parseStoreDrill`** 解析查询串中的 **`rtm`、`format`、`dealerName`、`storeId`**，拼入 `WHERE`。**新看板** `fetchRegionRanking`：UI 维度 `rtm3 | rtm4 | dealer | store` 映射为 `rtmLevel` = `rtm | format | dealerName | store`，并在下钻时附带对应 drill 参数。

| 展示数据 / 指标 | 数据示例 | 当前计算方 | 当前计算逻辑分析 | 重构建议 | 需重写后端返回该字段 / 后端已计算则仅改前端 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **桶标签（渠道 / 门店类型等）** | RTM3：`华东`；RTM4（format）：`Monobrand` / `Multibrand` | ✅ **后端聚合** | 各桶的展示名来自接口字段 **`rtmValue`**（SQL 里对 `s.rtm`、`s.format`、`s.dealer_name`、`s.name` 等维度聚合）。 | 若产品要固定别名表或国际化，可在后端映射层统一输出 `displayName`。 | **桶名**：后端已有；**别名**：可**仅后端**扩展字段，或**仅前端**字典。 |
| **榜单排名序号** | 1、2、3… | ⚠️ **混合** | SQL 默认 **`ORDER BY completion_rate DESC`**；前端 **`rrCurrentNodes`** 仍会对列表按 `rrSortKey` / `rrSortOrder` 再排序并 **`rank: idx + 1`**。用户切换排序后，名次与后端原始行序可能不一致。 | 若要求「排名与后端权威一致」，可由接口增加 `rank` 或约定仅后端排序且前端只读。 | **权威排名**：**需后端**（排序 + rank）或规范为**仅前端**展示序、不称「全量名次」。 |
| **完成进度百分比** | Mono: 53% | ✅ **后端计算** | `completionRate`（0–100）由聚合 SQL 计算；前端转为 `completion_rate`（0–1）用于条形图。 | 与上一行一致：交互排序在前端时，「按完成率排序」仍是前端重排。 | **比率**：后端已有；**排序 UX**：**仅前端**即可。 |
| **完成 / 派发量（完成数与分母）** | Mono: 21/40 | ✅ **后端计算** | `completedCount` / `assignmentCount`。**分母为该区间的派单总数**，不是独立配置的「目标 KPI」字段；UI 写「完成/目标」时实为「完成/派发」。 | 若业务确有「目标数」列，需数据源或新字段，与 heatmap 分母解耦。 | **当前两字段**：后端已有；**真·目标**：**需后端**新口径或新表。 |
| **平均完成耗时（小时）** | 206.0h | ✅ **后端计算** | `avgCompletionTimeHours`：对**已完成**且有时间戳的派单，取 **`julianday(completed_at) - julianday(task.created_at)`** 的均值（小时）。是 **「派单维度」的平均耗时**，不是严格按「人数」平均的人头口径（除非业务一人一单等价）。 | 若产品文案写「人均」，需与业务确认是否改为「平均完成耗时」或按人头重算。 | **当前指标**：后端已有；**人头口径**：**需后端**改 SQL 或新字段。 |
| **下钻与维度切换** | RTM3→RTM4→经销商→门店 | ⚠️ **前后端混合** | **前端**：`rrCurrentDimension`、`rrHandleDrillDown` / 面包屑、`rtm`·`format`·`dealerName` 随请求传递。**后端**：同一 heatmap 接口 + `parseStoreDrill` 收窄门店集合。 | 可选：后端返回「当前可下钻维度 / 下一跳」元数据，减少前端写死 `rtm3→rtm4→…`；属体验与维护性优化，非数据正确性必需。 | **下钻链配置**：**需后端**元数据或**仅前端**维护；**过滤语义**：已在后端 `storeDrill`。 |