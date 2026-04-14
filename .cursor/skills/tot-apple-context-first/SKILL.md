---
name: tot-apple-context-first
description: >-
  Enforces a document-first workflow for the TOT-Apple repo (TOT_backend training
  task system): onboard from docs, clarify requirements with multiple-choice questions,
  read specs before coding, get plan approval, then implement and sync API/DB docs.
  Use when working in this repository, changing backend or frontend behavior, adding
  APIs, modifying SQLite schema, Executive Chat, or when the user says vibe coding,
  quick context, read docs first, 先读文档, 方案审批, or tot-apple-context-first.
---

# TOT-Apple：先读文档再动手

## 何时启用

在 **本仓库**（TOT-Apple）内做任何 **非纯问答** 的工作（改代码、加接口、改表、联调）时，默认按本 Skill 执行。

若仓库根存在 **`AGENTS.md`**，与本 Skill **一并遵守**（不冲突时；冲突以更严格的文档与 PRD 为准）。

### 可简化的例外（不必强行走完方案闸门）

- 用户明确说 **直接改 / 只修这个点 / hotfix**，且改动范围可在一两个文件内说清。
- 纯**拼写、注释、格式化**，或**明显且孤立的**单处 bugfix，且不改变对外契约。

此种情况仍应 **快速对照** [`TOT_backend/docs/README.md`](../../../TOT_backend/docs/README.md) 或相关 Spec 中与该处相关的段落；若涉及 API/DB 行为变更，**不得**省略文档同步闸门。

## 0. 项目事实来源（不要猜）

- **文档总入口**：[`TOT_backend/docs/README.md`](../../../TOT_backend/docs/README.md)（含「AI 快速阅读路径」与文档状态说明）。
- **产品口径**：[`TOT_backend/docs/product/PRODUCT_REQUIREMENTS.md`](../../../TOT_backend/docs/product/PRODUCT_REQUIREMENTS.md)
- **规格索引**：[`TOT_backend/docs/specs/index.md`](../../../TOT_backend/docs/specs/index.md)
- **后端实现索引**：[`TOT_backend/docs/backend/index.md`](../../../TOT_backend/docs/backend/index.md)
- **后端技术硬约束**（如 DB 同步）：[`TOT_backend/CLAUDE.md`](../../../TOT_backend/CLAUDE.md)
- **内部契约**（响应形态、联调约定）：[`TOT_backend/docs/internal/CONTRACT.md`](../../../TOT_backend/docs/internal/CONTRACT.md)
- **前端页面规格索引**：[`TOT_backend/docs/frontend/index.md`](../../../TOT_backend/docs/frontend/index.md)（实现以 `TOT_frontend` 源码为准时，以代码为准、文档为对照）

长文规格不要整份背进对话；按下面路径 **按需打开** 对应文件即可。Skill 内链相对路径均相对于 **本 `SKILL.md` 所在目录**（`../../../` = 仓库根）。

## 1. 需求闸门（编码前）

在写或改代码之前，必须能复述：

- **目标**：用户要什么结果（可验收的一句话）。
- **范围**：动哪些模块（API / DB / 前端 / 仅文档）。
- **约束**：兼容、权限、性能、不能破坏的行为。
- **验收**：怎样算完成（接口行为、错误码、数据落库等）。

若任一条不清楚：**用 2～4 个互斥选项的选择题**向用户确认，并给出**推荐项**与简短理由；避免开放式连环追问。

## 2. 上下文闸门（读文档）

**上一节「需求闸门」中的四要素**（目标 / 范围 / 约束 / 验收）已对齐或已用选择题消歧后，在出方案前至少完成：

1. 打开 [`TOT_backend/docs/README.md`](../../../TOT_backend/docs/README.md)，按其中 **「AI 快速阅读路径」** 通读或扫读。
2. 按改动类型 **追加**（只读相关章节即可）：
   - **HTTP / WebSocket 契约** → [`TOT_backend/docs/specs/04-API-SPEC.md`](../../../TOT_backend/docs/specs/04-API-SPEC.md)
   - **表与字段语义** → [`TOT_backend/docs/specs/01-DATA-MODEL.md`](../../../TOT_backend/docs/specs/01-DATA-MODEL.md)
   - **库表与迁移现状** → [`TOT_backend/docs/backend/03-DATABASE.md`](../../../TOT_backend/docs/backend/03-DATABASE.md)
   - **权限** → [`TOT_backend/docs/specs/08-PERMISSION-MODEL.md`](../../../TOT_backend/docs/specs/08-PERMISSION-MODEL.md)
   - **服务层对照** → [`TOT_backend/docs/backend/02-SERVICES.md`](../../../TOT_backend/docs/backend/02-SERVICES.md)
   - **前端页面与集成** → [`TOT_backend/docs/frontend/index.md`](../../../TOT_backend/docs/frontend/index.md) 及其中与任务相关的单篇；必要时对照 [`TOT_backend/docs/specs/04-API-SPEC.md`](../../../TOT_backend/docs/specs/04-API-SPEC.md)
   - **已有实施计划** → 在 [`TOT_backend/docs/plans/`](../../../TOT_backend/docs/plans/) 目录中打开与用户任务 **文件名或标题最相关** 的一份（目录链接在部分预览器中无法展开时，用仓库文件树或搜索 `plans` 定位）。
3. 索引里标为 **Historical / Archived** 的文档：仅作背景，**不得**作为当前实现唯一依据。

## 3. 方案闸门（用户显式同意前不写业务代码）

输出简短**实施方案**，包含：

- 需求复述（与用户表述对齐）
- 将改动的**代码路径**（估计即可）
- 将同步的**文档**（见下一节）
- 风险与回滚要点
- 验证方式（命令或场景）

**在用户明确同意该方案之前**，不开始修改业务代码（可读代码、可查文档）。

## 4. 文档同步闸门（实现中）

变更类型与文档对应关系（与文档中心一致）：

| 变更 | 必须更新的文档 |
|------|----------------|
| API / WS 行为 | [`TOT_backend/docs/specs/04-API-SPEC.md`](../../../TOT_backend/docs/specs/04-API-SPEC.md) |
| 数据库结构或迁移语义 | [`TOT_backend/docs/specs/01-DATA-MODEL.md`](../../../TOT_backend/docs/specs/01-DATA-MODEL.md) + [`TOT_backend/docs/backend/03-DATABASE.md`](../../../TOT_backend/docs/backend/03-DATABASE.md) |
| 服务层重大行为 | [`TOT_backend/docs/backend/02-SERVICES.md`](../../../TOT_backend/docs/backend/02-SERVICES.md) 或 [`TOT_backend/docs/backend/index.md`](../../../TOT_backend/docs/backend/index.md) |
| 前端集成/页面行为（规格层） | [`TOT_backend/docs/frontend/`](../../../TOT_backend/docs/frontend/) 下相关篇 +必要时 [`TOT_backend/docs/specs/04-API-SPEC.md`](../../../TOT_backend/docs/specs/04-API-SPEC.md) |
| 产品口径 | [`TOT_backend/docs/product/PRODUCT_REQUIREMENTS.md`](../../../TOT_backend/docs/product/PRODUCT_REQUIREMENTS.md)（按团队流程） |

交付时在回复末尾用简短列表说明：**已更新哪些文档**；若无需更新，说明**原因**。

## 5. 实现时注意

- 遵守 [`TOT_backend/CLAUDE.md`](../../../TOT_backend/CLAUDE.md)（例如 better-sqlite3 同步 API、禁止对 `db.*` 误用 `await`）。
- 改动范围尽量贴合需求；避免无关重构。
- 规格与 PRD 冲突时：先对齐产品意图，再改 Spec 或代码，避免 silent drift。

## 6. 用户一键触发语（可选用）

用户可在消息中写：**「按 tot-apple-context-first 流程」** 或 **「先读 docs/README 再改」**，即视为要求完整走本 Skill。
