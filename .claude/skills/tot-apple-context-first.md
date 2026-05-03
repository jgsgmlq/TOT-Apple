---
name: tot-apple-context-first
description: >-
  TOT-Apple 仓库（TOT_backend 训练任务系统）的文档优先工作流：先从文档入手，
  用选择题澄清需求，阅读规格再编�����，方案审批后实现，并同步 API/DB 文档。
  在本仓库内修改后端或前端行为、新增 API、变更 SQLite Schema、涉及
  Executive Chat，或用户说"先读文档"、"方案审批"、"tot-apple-context-first"时触发。
---

# TOT-Apple：先读文档再动手

## 何时触发

在 **本仓库**（TOT-Apple）内做任何 **非纯问答** 的工作（改代码、加接口、改表、联调）时，默认按本 Skill 执行。

### 可简化的例外

以下情况不必强行走完方案闸门：

- 用户明确说 **直接改 / 只修这个点 / hotfix**，且改动范围在一两个文件内。
- 纯**拼写、注释、格式化**，或**明显且孤立的**单处 bugfix，且不改变对外契约。

此种情况仍须**快速对照**相关 Spec 中与该处相关的段落；若涉及 API/DB 行为变更，**不得**省略文档同步闸门。

---

## 0. 项目事实来源（不要猜，要读）

| 用途 | 路径 |
|------|------|
| 文档总入口（含「AI 快速阅读路径」） | `TOT_backend/docs/README.md` |
| 产品口径 | `TOT_backend/docs/product/PRODUCT_REQUIREMENTS.md` |
| 规格索引 | `TOT_backend/docs/specs/index.md` |
| 后端实现索引 | `TOT_backend/docs/backend/index.md` |
| 后端技术硬约束（better-sqlite3 同步 API 等） | `TOT_backend/CLAUDE.md` |
| 内部契约（响应形态、联调约定） | `TOT_backend/docs/internal/CONTRACT.md` |
| 前端页面规格索引 | `TOT_backend/docs/frontend/index.md` |

> 长文规格不要整份读入；按下方各闸门**按需打开**对应文件。

---

## 闸门 1：需求闸门（编码前）

在写或改代码之前，必须能复述：

- **目标**：用户要什么结果（一句话可验收）
- **范围**：动哪些模块（API / DB / 前端 / 仅文档）
- **约束**：兼容、权限、性能、不能破坏的行为
- **验收**��怎样算完成（接口行为、错误码、数据落库等）

若任一条不清楚：**用 2～4 个互斥选项的选择题**向用户确认，并给出**推荐项**与简短理由；避免开放式连环追问。

---

## 闸门 2：上下文闸门（读文档）

四要素对齐或消歧后，出方案前至少完成：

1. 打开 `TOT_backend/docs/README.md`，按其中「AI 快速阅读路径」通读或扫读。
2. 按改动类型**追加**（只读相关章节）：

   | 改动类型 | 阅读文档 |
   |----------|----------|
   | HTTP / WebSocket 契约 | `TOT_backend/docs/specs/04-API-SPEC.md` |
   | 表与字段语义 | `TOT_backend/docs/specs/01-DATA-MODEL.md` |
   | 库表与迁移现状 | `TOT_backend/docs/backend/03-DATABASE.md` |
   | 权限 | `TOT_backend/docs/specs/08-PERMISSION-MODEL.md` |
   | 服务层行为 | `TOT_backend/docs/backend/02-SERVICES.md` |
   | 前端页面与集成 | `TOT_backend/docs/frontend/index.md` 及相关篇 |
   | 已有实施计划 | `TOT_backend/docs/plans/` 目录下文件名最相关的一份 |

3. 标为 **Historical / Archived** 的文档仅作背景，**不得**作为当前实现唯一依据。

---

## 闸门 3：方案闸门（用户显式同意前不写业务代码）

输出简短**实施方案**，包含：

- 需求复述（与用户表述对齐）
- 将改动的**代码路径**（估计即可）
- 将同步的**文档**（见下一节）
- 风险与回滚要点
- 验证方式（命令或场景）

**在用户明确同意该方案之前**，不开始修改业务代码（可读代码、可查文档）。

---

## 闸门 4：文档同步闸门（实现中）

| 变更 | 必须更新的文档 |
|------|----------------|
| API / WS 行为 | `TOT_backend/docs/specs/04-API-SPEC.md` |
| 数据库结构或迁移语义 | `TOT_backend/docs/specs/01-DATA-MODEL.md` + `TOT_backend/docs/backend/03-DATABASE.md` |
| 服务层重大行为 | `TOT_backend/docs/backend/02-SERVICES.md` 或 `TOT_backend/docs/backend/index.md` |
| 前端集成/页面行为 | `TOT_backend/docs/frontend/` 下相关篇 + 必要时 `04-API-SPEC.md` |
| 产品口径 | `TOT_backend/docs/product/PRODUCT_REQUIREMENTS.md`（按团队流程） |

交付时在回复末尾用简短列表说明：**已更新哪些文档**；若无需更新，说明**原因**。

---

## 实现注意事项

- 遵守 `TOT_backend/CLAUDE.md`（better-sqlite3 同步 API，禁止对 `db.*` 误用 `await`）。
- 改动范围尽量贴合需求；避免无关重构。
- 规格与 PRD 冲突时：先对齐产品意图，再改 Spec 或代码，避免 silent drift。

### Executive Chat 变更最小核对清单

当改动 `Executive Chat`（尤其是 `chatAgentRunner`、`chatIntentService`、`chat_tools/*`）时，至少核对：

- **意图到工具映射**：`drill_down` 需明确区分区域级与门店级（`region` 优先走区域下钻工具，门店参数走门店下钻工具）。
- **歧义与降级口径**：名称查询场景需有可解释返回（如 `needDisambiguation`、候选列表、下一步建议），禁止"静默无数据"。
- **权限边界**：区域/RTM/全国口径必须在工具层落地校验；越权返回统一错误码（如 `AUTH_003`）。
- **输出契约**：最终回复保持 `replyContent` 结构（`overview/keyNumbers/attentionPoints/followUpSuggestions`），内部字段不得污染外部契约。
- **文档同步**：涉及 Chat 行为或能力边界变化，至少同步 `TOT_backend/docs/specs/09-EXECUTIVE-CHAT.md`；如 API 可见行为变化，再同步 `04-API-SPEC.md`。

验证命令（路径含空格时用 `--prefix`）：

```bash
node --check TOT_backend/server/services/chatAgentRunner.js
node --check TOT_backend/server/services/chatIntentService.js
node --check TOT_backend/server/chat_tools/<tool-file>.js
npm --prefix "/Users/skyler/Desktop/MVP 3.0/TOT-Apple/TOT_backend/server" run test:region-drilldown
```

---

## 用户触发关键词

用户消息中出现以下任一词语，即视为要求完整走本 Skill：

- `按 tot-apple-context-first 流程`
- `先读 docs/README 再改`
- `先读文档`
- `方案审批`
- `vibe coding`（本仓库内）
