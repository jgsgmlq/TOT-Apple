# Chat 层 SQLite → MySQL 迁移设计

> 2026-05-20 | 分支: macstudio

## 目标

将 Agent 层对 chat 数据的读写从 SQLite (`server/db/index.js`) 迁移到 MySQL (`modules/common/db/mysql.js`)，使用同事已建好的 MySQL 表。

## 不改的范围

- MySQL 数据库本身（不执行任何 DDL）
- Agent 管道（SafetyGateway、FC 循环、chat_tools）
- `server/db/index.js`（可能还有其他模块在用 SQLite）

## 改动文件

### 新建: `modules/dashboard/crud/chatCrud.js`

封装所有 chat 相关 MySQL 操作，对外暴露 async 函数：

| 函数 | MySQL 表 | 操作 |
|------|---------|------|
| `createSession({ id, userId, entryType, scopeType, scopeRegionsJson, scopeRtm, ipAddress })` | chat_session | INSERT |
| `getSession(id)` | chat_session | SELECT |
| `updateSessionActive(id)` | chat_session | UPDATE last_active_at |
| `insertMessage({ id, sessionId, role, contentText, intentType, toolCallsJson, toolCallId, clientMessageId })` | chat_message | INSERT |
| `getMessages(sessionId)` | chat_message | SELECT (按 created_at 排序) |
| `getMessageByClientId(clientMessageId)` | chat_message | SELECT (幂等检查) |
| `insertFeedback({ id, messageId, userId, feedbackType })` | chat_message_feedback | INSERT |
| `deleteFeedback(messageId, userId)` | chat_message_feedback | DELETE |

列名映射在 chatCrud 内部处理，调用方不感知。

### 修改: `services/chatService.js`

- 删除 `const { db } = require('../db')`
- 新增 `const chatCrud = require('../modules/dashboard/crud/chatCrud')`
- 所有 SQLite db 调用替换为 MySQL：
  - chat_session/message/feedback → chatCrud
  - users 查询 → account 表 (account_id, account_role, rtm)
  - tasks 查询 → task_publish 表
- 受影响的函数加 async

### 修改: `agent/graph/nodes/persistAndEmit.js`

- 删除 `require('../../../db')`
- 新增 `const chatCrud = require('../../../modules/dashboard/crud/chatCrud')`
- SQLite transaction 替换为: `await chatCrud.updateSessionActive()` + `await chatCrud.insertMessage()`

### 修改: `services/chatMemoryService.js`

- 删除 `require('../db')`
- 新增 `const { get, all, run } = require('../modules/common/db/mysql')`
- `user_memories` → `user_memory`，同步调用改 async

### 修改: `agent/graph/nodes/loadContext.js`

- `chatMemoryService.getMemories()` 加 await（原来是同步调用）

## 列名映射（SQLite → MySQL）

| SQLite | MySQL |
|--------|-------|
| `chat_sessions` | `chat_session` |
| `chat_messages` | `chat_message` |
| `chat_message_feedback` | `chat_message_feedback` |
| `role_scope` | `scope_type` |
| `regions` | `scope_regions_json` |
| `rtm` | `scope_rtm` |
| `content` | `content_text` |
| `tool_calls` | `tool_calls_json` |
| `last_active` | `last_active_at` |
| `user_memories` | `user_memory` |
| — (new) | `entry_type` ('executive') |
| — (new) | `deleted_at` |

## 验证

1. 启动服务器，确认无 require 错误
2. 创建 session → 发消息 → Agent 回复 → 查历史
3. 运行 `scripts/test-tools-smoke.sh` 确认工具层未受影响
