# ADR-0001: Entity Resolution Layer

**Date:** 2026-05-24 | **Status:** Accepted

## Context

Executive Chat 的任务解析逻辑散落在 6 个工具中，使用 4 种不同匹配策略（SQL LIKE、JS exact、JS includes、双重解析），导致：

- 中文空格不敏感（"跨渠道BAU" 匹配不到 "跨渠道 BAU"）
- 不支持按类别/产品搜索（`model_type`、`topic_name` 在 `campaign_activity` 表，工具层无 JOIN）
- 同名工具行为不一致（`fetch_incomplete_persons` 用 exact 匹配，"iPhone 17" 找不到 "iPhone 17 新品培训"）
- HITL 节点自己查任务列表，候选来源与其他路径不一致

用户输入 "跨渠道BAU进展" → 返回无数据，根因是搜索链路断裂。

## Decision

在 SafetyGateway 和 FC 循环之间插入 `resolveEntities` 节点，建立统一的实体解析层：

```
safetyGateway (LLM 语义分类) → resolveEntities (DB 精确解析) → FC/HITL (拿 ID 执行)
```

**核心原则：** LLM 管语义理解，DB 管结构化匹配，resolveEntities 管编排决策。

- SafetyGateway v2：提取结构化 `query_filters`（10 维：task_name, task_category, product_name, priority, alert_level, platform, org, time_range, deadline_urgency, status_filter），不再做路由决策
- resolveEntities：调统一 `searchTasks(filters)` + `searchOrg(name, type)` 做 DB 解析，0 或多匹配 → ambiguity_payload → HITL
- FC 循环：不再做任务名搜索，工具只接受精确 task_id
- `searchTasks()` 替换 6 个工具中 4 种不同的搜索逻辑
- `searchOrg()` 四层回退：黑话映射 → reseller_store → 去空格 → learner_account

## Alternatives Considered

**A. 不改架构，只修每个工具的搜索逻辑** — 治标不治本，下次新工具还是会带上第 5 种搜索策略。

**B. SafetyGateway 直接查 DB** — 加重 Gateway（当前纯 LLM 节点），把语义理解和 DB 查询耦合在一起，测试困难。

**C. FC 内统一搜索工具** — 消耗 FC 步骤（总共 3 步），复杂查询可能步骤不够。

## Consequences

- **正：** 任务解析一致、可测试（4 个纯函数支持 TDD）、支持类别/产品/组织/时间组合查询
- **负：** 增加一个图节点和 ~5 个新 State 字段；Gateway prompt 需要 v2 升级
- **风险：** SafetyGateway v2 LLM 提取质量是单点依赖，通过 prompt 领域词汇表 + resolveEntities fallback 缓解
- **回退：** 旧 prompt v1 和 fc/v3 保留；旧 State 字段标记 deprecated 保留兼容；graph 路由可切回 `safetyGateway → fc/hitl`
