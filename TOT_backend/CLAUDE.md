# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TOT/Apple 零售培训任务管理系统。后端 Express + LangGraph Agent，前端 Vue3 + Naive UI。

## CRITICAL: 永远不要修改数据库

**禁止对数据库执行任何写操作：**
- 禁止 `ALTER TABLE`、`DROP TABLE`、`CREATE TABLE`
- 禁止修改字段、约束、索引
- 禁止修改表结构、表名
- 禁止执行任何 DDL 语句

**数据库查询只允许 SELECT**。`INSERT`/`UPDATE`/`DELETE` 仅在用户明确要求且确认后才可执行。

违反此规则会导致严重生产事故。

## Common Commands

### Backend (`TOT_backend/server/`)

```bash
cd TOT_backend/server
npm run dev          # 开发模式 (node --watch, 自动重启)
npm start            # 生产模式
npm test             # 运行全部 Jest 测试
npm run seed         # 写入 SQLite 本地测试数据
```

运行单个测试文件：
```bash
cd TOT_backend/server && npx jest path/to/test.js
```

### Frontend (`TOT_frontend/`)

```bash
cd TOT_frontend
pnpm dev             # Vite 开发服务器 (端口 8001)
pnpm build           # 生产构建
pnpm lint:eslint     # ESLint 检查
```

## Architecture

### 数据库：SQLite → MySQL 迁移中

项目正在从 SQLite 迁移到 MySQL，**当前两套数据库并行运行**：

- **SQLite** (`server/database.db`) — `better-sqlite3` 同步 API，禁止 `await db.*`。表名：`tasks`, `stores`, `employees`, `task_assignments` 等。仍在用的模块：`permissions.js`、`chatUtils.js`、`ws/manager.js`、`autoNudge.js`、`mypalLink.js`、`mypalSyncService.js`。
- **MySQL** (远端 `43.139.52.218:3306/ops_forge`) — `mysql2/promise` 异步 API，必须 `await`。表名：`task_publish`, `learner_account`, `reseller_store`, `chat_session`, `chat_message` 等。已迁移的模块：所有 Admin/Task/Dashboard CRUD、Agent chat_tools、chatService、chatMemoryService。

Agent Chat 的对话数据都在 MySQL。`server/modules/common/db/mysql.js` 封装了连接池。

### Agent 架构 (LangGraph StateGraph)

入口：`server/services/chatService.js` → 构建图 → `app.invoke()`

**图节点流程：**

```
START → loadContext → safetyGateway ─┬─ deny/chat → FinalResponseStep
                                     ├─ hitl → HumanInTheLoopGate
                                     └─ fc → FC Loop (最多 3 轮):
                                              fc_CheckSteps → fc_LlmToolCallStep
                                              → fc_CheckDuplicate → fc_ExecuteTool
                                              → fc_MergeToolResults → 循环
                                     → FinalResponseStep → persistAndEmit → END
```

**关键节点：**
- `safetyGateway` — DeepSeek 结构化输出，分类 chat/tool/deny，提取实体
- `fc_LlmToolCallStep` — 绑定 9 个 chat_tools 的 LLM 调用，选择工具
- `fc_ExecuteTool` — 逐一执行工具，emit trace
- `humanInTheLoopGate` — LangGraph `interrupt()`，处理 HITL 澄清
- `finalResponseStep` — DeepSeek 结构化输出，选 template 生成最终回复
- `persistAndEmit` — 存 MySQL + 推 SSE done 事件

**4 个 LLM 模型实例**（都在 `agent/graph/llm.js`）：
- `routerModel` — safetyGateway 分类（DeepSeek，temp=0.1）
- `fcModel` — 工具选择与调用（DeepSeek，可能带 reasoning）
- `structuredModel` — 最终回复格式化（DeepSeek，temp=0.3）
- `titleModel` — 会话标题生成

**9 个 chat_tools**（`server/chat_tools/`，动态注册）：
`search_task`, `list_task_progress`, `query_metric`, `query_trend`, `funnel_analysis`, `get_task_dashboard`, `fetch_incomplete_persons`, `fetch_alert_persons`, `ask_user`

**5 个 Prompt 模板**（`server/prompts/`）：
`safetyGateway`, `fc_agent`, `final_response`, `chat_reply`, `router`（router 遗留未用）

### SSE 流式响应

8 种事件类型：`delta`(reasoning/content/tool_start/tool_end)、`trace`、`clarify`、`done`、`error`

路由：`POST /api/v1/chat/executive/sessions/:id/messages`

### 计划编写与 TDD

使用 `/superpowers:writing-plans` 编写实现计划时，评估每个 Task 是否适合 TDD：
- **需要 TDD**：涉及纯函数、数据变换、Schema 校验、工具 handler 等可测试的逻辑
- **不需要 TDD**：纯文件删除、Prompt 文本替换、CSS/模板调整、简单配置变更

需要 TDD 的 Task 在 plan 中标注，实现时让 Agent 调用 `tdd` skill 来执行。

### State 设计

`agent/graph/state.js` — 用 LangGraph `Annotation` 定义，约 30 个字段，不同 reducer 策略（`concat` 用于消息、`merge spread` 用于工具结果、默认 last-write-wins）。

### 目录结构要点

```
TOT_backend/server/
  app.js                    # 入口，Express + 路由挂载 + WebSocket
  modules/                  # 新模块架构
    common/db/mysql.js      # MySQL 连接池
    task/                   # 任务 CRUD + 路由
    dashboard/              # 看板 KPI + AI 洞察
    admin/                  # 管理后台
  agent/graph/              # LangGraph Agent
    nodes/                  # 10 个节点
    shared/runTrace.js      # 运行追踪（node/tool/llm 事件）
  chat_tools/               # Agent 工具集
  prompts/                  # LLM Prompt 模板
  services/                 # chatService, chatToolsService 等
```

### 环境变量

关键变量（`.env` 在 `TOT_backend/` 根目录）：
- `DEEPSEEK_API_KEY` — DeepSeek API
- `MYSQL_URL` — MySQL 连接串
- `JWT_SECRET` — JWT 签名密钥
- `MAX_FC_ROUNDS` — FC 循环最大轮数（默认 3）
- `DEBUG_GRAPH` — 开启图节点 console 追踪
