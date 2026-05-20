# Chat SQLite → MySQL 迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 chat 数据读写从 SQLite 迁移到同事已建好的 MySQL 表 (`chat_session`, `chat_message`, `chat_message_feedback`, `user_memory`)，不改数据库。

**Architecture:** 新建 `chatCrud.js` 封装 MySQL 操作 → `chatService.js` / `persistAndEmit.js` / `chatMemoryService.js` 调用 chatCrud 或 MySQL `get/all/run` → 保留 Agent 管道和 chat_tools 不变。

**Tech Stack:** Node.js, mysql2/promise, better-sqlite3 (保留不动)

---

## Task 1: 创建 chatCrud.js

**Files:**
- Create: `TOT_backend/server/modules/dashboard/crud/chatCrud.js`

- [ ] **Step 1: 写文件**

```js
// TOT_backend/server/modules/dashboard/crud/chatCrud.js
'use strict';

const { get, all, run } = require('../../common/db/mysql');

async function createSession({ id, userId, entryType, scopeType, scopeRegionsJson, scopeRtm, ipAddress }) {
  await run(
    `INSERT INTO chat_session (id, user_id, entry_type, scope_type, scope_regions_json, scope_rtm, ip_address, created_at, last_active_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
    [id, userId, entryType || 'executive', scopeType, scopeRegionsJson || null, scopeRtm || null, ipAddress || null]
  );
}

async function getSession(id) {
  return await get('SELECT * FROM chat_session WHERE id = ? AND deleted_at IS NULL', [id]);
}

async function updateSessionActive(id) {
  await run('UPDATE chat_session SET last_active_at = NOW(3) WHERE id = ?', [id]);
}

async function insertMessage({ id, sessionId, role, contentText, intentType, toolCallsJson, toolCallId, clientMessageId }) {
  await run(
    `INSERT INTO chat_message (id, session_id, role, content_text, intent_type, tool_calls_json, tool_call_id, client_message_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(3))`,
    [id, sessionId, role, contentText, intentType || null, toolCallsJson || null, toolCallId || null, clientMessageId || null]
  );
}

async function getMessages(sessionId) {
  return await all(
    'SELECT id, session_id, role, content_text, intent_type, tool_calls_json, tool_call_id, client_message_id, created_at FROM chat_message WHERE session_id = ? AND deleted_at IS NULL ORDER BY created_at ASC, id ASC',
    [sessionId]
  );
}

async function getMessageByClientId(clientMessageId) {
  if (!clientMessageId) return null;
  return await get('SELECT id FROM chat_message WHERE client_message_id = ?', [clientMessageId]);
}

async function insertFeedback({ id, messageId, userId, feedbackType }) {
  await run(
    `INSERT INTO chat_message_feedback (id, message_id, user_id, feedback_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, NOW(3), NOW(3))
     ON DUPLICATE KEY UPDATE feedback_type = VALUES(feedback_type), updated_at = NOW(3)`,
    [id, messageId, userId, feedbackType]
  );
}

async function deleteFeedback(messageId, userId) {
  await run('DELETE FROM chat_message_feedback WHERE message_id = ? AND user_id = ?', [messageId, userId]);
}

async function getLastAssistantMessage(sessionId) {
  return await get(
    "SELECT id, content_text FROM chat_message WHERE session_id = ? AND role = 'assistant' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1",
    [sessionId]
  );
}

async function getMessageById(messageId) {
  return await get('SELECT id, role, session_id FROM chat_message WHERE id = ? AND deleted_at IS NULL', [messageId]);
}

async function deleteMessage(messageId) {
  await run('UPDATE chat_message SET deleted_at = NOW(3) WHERE id = ?', [messageId]);
}

async function getMessageCount(sessionId) {
  const row = await get('SELECT COUNT(*) AS total FROM chat_message WHERE session_id = ? AND deleted_at IS NULL', [sessionId]);
  return row ? row.total : 0;
}

async function getUserById(userId) {
  return await get('SELECT account_id, account_role, rtm FROM account WHERE account_id = ? AND enabled_flag = 1', [userId]);
}

async function getLatestDispatchedTask() {
  return await get("SELECT task_title AS title FROM task_publish WHERE publish_status = 'dispatched' ORDER BY created_at DESC LIMIT 1");
}

async function softDeleteSessionMessages(sessionId) {
  await run('UPDATE chat_message SET deleted_at = NOW(3) WHERE session_id = ? AND deleted_at IS NULL', [sessionId]);
}

async function softDeleteSession(sessionId) {
  await run('UPDATE chat_session SET deleted_at = NOW(3) WHERE id = ?', [sessionId]);
}

module.exports = {
  createSession, getSession, updateSessionActive,
  insertMessage, getMessages, getMessageByClientId,
  insertFeedback, deleteFeedback,
  getLastAssistantMessage, getMessageById, deleteMessage, getMessageCount,
  softDeleteSessionMessages, softDeleteSession,
  getUserById, getLatestDispatchedTask,
};
```

- [ ] **Step 2: 运行 node --check 验证语法**

```bash
cd TOT_backend/server && node --check modules/dashboard/crud/chatCrud.js
```

Expected: 无输出（无语法错误）

- [ ] **Step 3: 提交**

```bash
git add TOT_backend/server/modules/dashboard/crud/chatCrud.js
git commit -m "feat: add chatCrud.js — MySQL CRUD for chat tables"
```

---

## Task 2: 修改 chatService.js — 替换所有 SQLite 调用

**Files:**
- Modify: `TOT_backend/server/services/chatService.js`

- [ ] **Step 1: 更新 require**

将第 4 行：
```js
const { db } = require('../db');
```
改为：
```js
const chatCrud = require('../modules/dashboard/crud/chatCrud');
```

将第 5 行 `const { formatNowSqliteLocal } = require('../utils/ddlAt');` 保留不动（其他函数可能引用）。

- [ ] **Step 2: 替换 buildExampleQuestions (line 218-226)**

```js
async function buildExampleQuestions() {
  const task = await chatCrud.getLatestDispatchedTask();
  const taskRef = task ? `"${task.title}"` : '最近的';
  return [
    `${taskRef}培训完成率是多少？`,
    '有哪些门店需要重点关注？',
    '现在有哪些进行中的培训任务？',
  ];
}
```

- [ ] **Step 3: 替换 createSession (line 229-246)**

```js
async function createSession(userId, reqUser, ipAddress) {
  const user = await chatCrud.getUserById(userId);
  if (!user) throw Object.assign(new Error('User not found'), { status: 404, code: 'CHAT_002' });

  const combinedUser = { ...user, roles: reqUser?.roles || ['executive'] };
  const regionScope = resolveRegionScope(combinedUser);
  const sessionId = nanoid();

  await chatCrud.createSession({
    id: sessionId,
    userId,
    entryType: 'executive',
    scopeType: regionScope.type,
    scopeRegionsJson: regionScope.regions ? JSON.stringify(regionScope.regions) : null,
    scopeRtm: regionScope.rtm || null,
    ipAddress: ipAddress || null,
  });

  return { sessionId, contextId: sessionId, exampleQuestions: await buildExampleQuestions() };
}
```

同时更新 `resolveRegionScope` (line 19-39)：MySQL `account` 表没有 `executive_regions`/`executive_rtm` 字段，改为用 `rtm`：

```js
function resolveRegionScope(reqUser) {
  const roles = reqUser?.roles;
  if (!roles || !Array.isArray(roles) || roles.length === 0) {
    throw Object.assign(new Error('User roles are missing or invalid'), { status: 403, code: 'AUTH_005' });
  }
  if (reqUser.rtm) {
    return { type: 'rtm', rtm: reqUser.rtm, regions: null, userRoles: roles };
  }
  return { type: 'national', regions: null, rtm: null, userRoles: roles };
}
```

- [ ] **Step 4: 替换 handleIncomingMessage 中的 SQLite 调用 (line 248-310)**

将所有 `db.get`、`db.run`、`db.all` 替换为 `await chatCrud.xxx`：

Line 262 — 幂等检查:
```js
// 旧: const existing = db.get('SELECT id FROM chat_messages WHERE client_message_id = ?', [messageId]);
const existing = await chatCrud.getMessageByClientId(messageId);
```

Line 279 — tool 消息写入:
```js
// 旧: db.run('INSERT INTO chat_messages (id, session_id, role, content, tool_call_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', ...);
await chatCrud.insertMessage({
  id: toolMsgId, sessionId, role: 'tool',
  contentText: clarificationResponse.userFacingText || '',
  toolCallId: clarificationResponse.toolCallId,
});
```

Line 285-286 — clarification user 消息:
```js
// 旧: db.run('INSERT INTO chat_messages (id, session_id, role, content, client_message_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', ...);
await chatCrud.insertMessage({
  id: userMsgId, sessionId, role: 'user',
  contentText: userMessage,
  clientMessageId: messageId || null,
});
```

Line 298 — 普通 user 消息:
```js
// 旧: db.run('INSERT INTO chat_messages (id, session_id, role, content, client_message_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', ...);
await chatCrud.insertMessage({
  id: userMsgId, sessionId, role: 'user',
  contentText: userMessage,
  clientMessageId: messageId || null,
});
```

函数签名加 `async`：`handleIncomingMessage` 改为 `async function handleIncomingMessage(...)`。

- [ ] **Step 5: 替换 sendMessage 中的 SQLite 调用 (line 420-495)**

Line 432 — 查 session:
```js
// 旧: const session = db.get('SELECT * FROM chat_sessions WHERE id = ?', [sessionId]);
const session = await chatCrud.getSession(sessionId);
```

Line 488 — 写 assistant 消息:
```js
// 旧: db.run('INSERT INTO chat_messages (id, session_id, role, content, intent_type, tool_calls, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', ...);
await chatCrud.insertMessage({
  id: assistMsgId, sessionId, role: 'assistant',
  contentText: finalMarkdown,
  intentType: derivedIntent || null,
  toolCallsJson: toolCallsJson || null,
});
```

Line 492 — 更新 session 活跃时间:
```js
// 旧: db.run('UPDATE chat_sessions SET last_active = ? WHERE id = ?', [now, sessionId]);
await chatCrud.updateSessionActive(sessionId);
```

函数签名加 `async`：`sendMessage` 改为 `async function sendMessage(...)`。

- [ ] **Step 6: 替换 resume 路径中的 SQLite 调用 (line 545, 577)**

Line 545 — 查 session:
```js
// 旧: const session = db.get('SELECT * FROM chat_sessions WHERE id = ?', [sessionId]);
const session = await chatCrud.getSession(sessionId);
```

Line 577 — 查 session（sendMessageStreamLangGraph 内部）:
```js
// 旧: const session = db.get('SELECT * FROM chat_sessions WHERE id = ?', [sessionId]);
const session = await chatCrud.getSession(sessionId);
```

Line 704 — 同上:
```js
const session = await chatCrud.getSession(sessionId);
```

- [ ] **Step 7: 替换 regenerate 路径中的 SQLite 调用 (line 779, 830-860)**

Line 779 — 查最后 assistant 消息:
```js
// 旧: const lastAssistant = db.get("SELECT id, content FROM chat_messages WHERE session_id = ? AND role = 'assistant' ORDER BY created_at DESC LIMIT 1", [sessionId]);
const lastAssistant = await chatCrud.getLastAssistantMessage(sessionId);
```

Line 905 — 消息计数:
```js
// 旧: const totalRow = db.get('SELECT COUNT(*) AS total FROM chat_messages WHERE session_id = ?', [sessionId]);
const total = await chatCrud.getMessageCount(sessionId);
```

Line 908 — 消息列表:
```js
// 旧: const rows = db.all(...);
const rows = await chatCrud.getMessages(sessionId);
// 注意：返回的列名从 content → content_text，后续代码引用 .content 需改为 .content_text
```

更新 line 912-913 的消息格式化（如果引用了 `.content`）：
```js
const formatted = rows.map(r => ({ id: r.id, role: r.role, content: r.content_text, ... }));
```

- [ ] **Step 8: 替换 feedback 路径中的 SQLite 调用 (line 967-975)**

Line 967:
```js
// 旧: const msg = db.get('SELECT id, role, session_id FROM chat_messages WHERE id = ?', [messageId]);
const msg = await chatCrud.getMessageById(messageId);
```

Line 973:
```js
// 旧: db.run('DELETE FROM chat_message_feedback WHERE message_id = ? AND user_id = ?', [messageId, userId]);
await chatCrud.deleteFeedback(messageId, userId);
```

Line 975:
```js
// 旧: db.run('INSERT INTO chat_message_feedback (id, message_id, user_id, feedback_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', ...);
await chatCrud.insertFeedback({ id: nanoid(), messageId, userId, feedbackType: feedback === 'none' ? null : feedback });
```

- [ ] **Step 9: 替换 delete session 路径中的 SQLite 调用**

Line 987 — 查 session:
```js
const session = await chatCrud.getSession(sessionId);
```

删除 session 相关——将原来的硬删除：
```js
// 旧: db.run('DELETE FROM chat_messages WHERE session_id = ?', [sessionId]);
// 旧: db.run('DELETE FROM chat_sessions WHERE id = ?', [sessionId]);
await chatCrud.softDeleteSessionMessages(sessionId);
await chatCrud.softDeleteSession(sessionId);
```

- [ ] **Step 10: 替换 sendMessage 中剩余的 SQLite 调用**

Line 492 — 更新 session 活跃时间（已在 Step 5 覆盖）。

Line 488 — 写 assistant 消息（已在 Step 5 覆盖）。

检查其他地方：`grep -n "db\.\|chat_sessions\|chat_messages" TOT_backend/server/services/chatService.js` 确认无遗漏。

- [ ] **Step 11: 运行 node --check**

```bash
cd TOT_backend/server && node --check services/chatService.js
```

Expected: 无输出。

- [ ] **Step 12: 提交**

```bash
git add TOT_backend/server/services/chatService.js
git commit -m "refactor: migrate chatService.js SQLite calls to MySQL chatCrud"
```

---

## Task 3: 修改 persistAndEmit.js

**Files:**
- Modify: `TOT_backend/server/agent/graph/nodes/persistAndEmit.js`

- [ ] **Step 1: 替换 require 和 SQL 调用**

将第 4 行：
```js
const { db } = require('../../../db');
```
改为：
```js
const chatCrud = require('../../../modules/dashboard/crud/chatCrud');
```

将第 5 行 `const { formatNowSqliteLocal } = require('../../../utils/ddlAt');` 删掉（MySQL 用 NOW(3)）。

将第 19-26 行的 SQLite transaction：
```js
try {
    db.transaction(() => {
      db.run(
        'INSERT INTO chat_messages (id, session_id, role, content, intent_type, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [assistMsgId, sessionId, 'assistant', replyContent, state.intent || null, now]
      );
      db.run('UPDATE chat_sessions SET last_active = ? WHERE id = ?', [now, sessionId]);
    });
  } catch (err) {
    throw Object.assign(new Error(`CHAT_PERSIST_FAILED: ${err.message}`), { code: 'CHAT_PERSIST_FAILED', status: 500 });
  }
```

替换为：
```js
try {
    await chatCrud.insertMessage({
      id: assistMsgId, sessionId, role: 'assistant',
      contentText: replyContent,
      intentType: state.intent || null,
    });
    await chatCrud.updateSessionActive(sessionId);
  } catch (err) {
    throw Object.assign(new Error(`CHAT_PERSIST_FAILED: ${err.message}`), { code: 'CHAT_PERSIST_FAILED', status: 500 });
  }
```

同时删掉第 14 行 `const now = formatNowSqliteLocal();`（不再需要）。

- [ ] **Step 2: 运行 node --check**

```bash
cd TOT_backend/server && node --check agent/graph/nodes/persistAndEmit.js
```

Expected: 无输出。

- [ ] **Step 3: 提交**

```bash
git add TOT_backend/server/agent/graph/nodes/persistAndEmit.js
git commit -m "refactor: migrate persistAndEmit.js to MySQL chatCrud"
```

---

## Task 4: 修改 chatMemoryService.js

**Files:**
- Modify: `TOT_backend/server/services/chatMemoryService.js`

- [ ] **Step 1: 更新 require**

第 3 行：
```js
// 旧: const { db } = require('../db');
const { get, all, run } = require('../modules/common/db/mysql');
```

- [ ] **Step 2: 替换 SQL 调用**

Line 55 — 查 session（`chat_sessions` → `chat_session`，`content` → `content_text`）:
```js
const session = await get('SELECT user_id FROM chat_session WHERE id = ? AND deleted_at IS NULL', [sessionId]);
```

Line 58-60 — 查消息:
```js
const messages = await all(
  'SELECT role, content_text FROM chat_message WHERE session_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 2',
  [sessionId]
);
const reversed = [...messages].reverse();
if (reversed.length < 2) return;
const conversationText = reversed.map((m) => `${m.role}: ${m.content_text}`).join('\n');
```

Line 67 — 查记忆（`user_memories` → `user_memory`）:
```js
const existingMemories = await all('SELECT memory_type, content FROM user_memory WHERE user_id = ?', [session.user_id]);
```

Line 160 — 写记忆（`user_memories` → `user_memory`，`ON CONFLICT` → `ON DUPLICATE KEY UPDATE`）:
```js
await run(
  `INSERT INTO user_memory (id, user_id, memory_hash, memory_type, content, confidence_score, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, NOW(3), NOW(3))
   ON DUPLICATE KEY UPDATE
     memory_type = VALUES(memory_type),
     content = VALUES(content),
     confidence_score = VALUES(confidence_score),
     updated_at = NOW(3)`,
  [nanoid(), session.user_id, hash, item.type, item.content, 0.8]
);
```

Line 204 — 读记忆（`getMemories` 函数）:
```js
async function getMemories(userId) {
  const rows = await all(`
    SELECT memory_type, content
    FROM user_memory
    WHERE user_id = ?
      AND (expires_at IS NULL OR expires_at > NOW(3))
      AND (
        memory_type != 'mid_term'
        OR (memory_type = 'mid_term' AND updated_at > NOW(3) - INTERVAL 14 DAY)
      )
  `, [userId]);
  if (!rows || !rows.length) return '';
  return rows.map(r => `- [${r.memory_type}] ${r.content}`).join('\n');
}
```

Line 221 — 删记忆:
```js
async function deleteMemory(userId, memoryId) {
  return await run('DELETE FROM user_memory WHERE id = ? AND user_id = ?', [memoryId, userId]);
}
```

- [ ] **Step 3: 运行 node --check**

```bash
cd TOT_backend/server && node --check services/chatMemoryService.js
```

Expected: 无输出。

- [ ] **Step 4: 提交**

```bash
git add TOT_backend/server/services/chatMemoryService.js
git commit -m "refactor: migrate chatMemoryService.js to MySQL"
```

---

## Task 5: 修改 loadContext.js

**Files:**
- Modify: `TOT_backend/server/agent/graph/nodes/loadContext.js`

- [ ] **Step 1: 给 getMemories 加 await**

`loadContext.js` 当前第 13 行：
```js
const rawMemories = chatMemoryService.getMemories(state.userId, state.userMessage);
```

改为：
```js
const rawMemories = await chatMemoryService.getMemories(state.userId, state.userMessage);
```

函数已为 async，无需改签名。

- [ ] **Step 2: 运行 node --check**

```bash
cd TOT_backend/server && node --check agent/graph/nodes/loadContext.js
```

Expected: 无输出。

- [ ] **Step 3: 提交**

```bash
git add TOT_backend/server/agent/graph/nodes/loadContext.js
git commit -m "fix: await getMemories in loadContext (now async MySQL)"
```

---

## Task 6: E2E 验证

- [ ] **Step 1: 确认无语法错误**

```bash
cd TOT_backend/server && node --check app.js
```

Expected: 无输出。

- [ ] **Step 2: 启动服务**

```bash
node TOT_backend/server/app.js &
sleep 3
curl -s http://localhost:3000/api/health
```

Expected: `{"ok":true,"service":"mvp-lan-api"}`

- [ ] **Step 3: 运行端到端测试**

```bash
cd TOT_backend/server && node -e "
require('dotenv').config({ path: __dirname + '/../.env' });
const chatCrud = require('./modules/dashboard/crud/chatCrud');
const { nanoid } = require('nanoid');

(async () => {
  // 1. 创建 session
  const sid = 'e2e-' + nanoid(6);
  await chatCrud.createSession({
    id: sid, userId: '1', entryType: 'executive',
    scopeType: 'national', scopeRegionsJson: null, scopeRtm: null, ipAddress: null
  });
  console.log('createSession: OK', sid);

  // 2. 写消息
  const mid = nanoid();
  await chatCrud.insertMessage({ id: mid, sessionId: sid, role: 'user', contentText: '测试消息' });
  console.log('insertMessage: OK', mid);

  // 3. 读消息
  const msgs = await chatCrud.getMessages(sid);
  console.log('getMessages:', msgs.length, '条');

  // 4. 更新 session
  await chatCrud.updateSessionActive(sid);
  console.log('updateSessionActive: OK');

  // 5. 幂等检查
  const dup = await chatCrud.getMessageByClientId('nonexistent');
  console.log('getMessageByClientId (no hit):', dup === null ? 'OK' : 'UNEXPECTED');

  console.log('ALL CHECKS PASSED');
  process.exit(0);
})().catch(err => { console.error('FAIL:', err.message); process.exit(1); });
"
```

Expected: `ALL CHECKS PASSED`

- [ ] **Step 4: 运行 Agent E2E 测试**

```bash
cd TOT_backend/server && node -e "
require('dotenv').config({ path: __dirname + '/../.env' });
const chatCrud = require('./modules/dashboard/crud/chatCrud');
const { nanoid } = require('nanoid');

(async () => {
  const sid = 'agent-' + nanoid(6);
  await chatCrud.createSession({
    id: sid, userId: '1', entryType: 'executive',
    scopeType: 'national'
  });

  const { buildGraph } = require('./agent/graph/graph');
  const { SqliteSaver } = require('@langchain/langgraph-checkpoint-sqlite');
  const graph = buildGraph();
  const app = graph.compile({ checkpointer: SqliteSaver.fromConnString(':memory:') });

  console.log('=== Agent: iPad mini 培训完成率？ ===');
  const t0 = Date.now();
  const state = await app.invoke({
    userMessage: 'iPad mini 培训完成率怎么样？',
    sessionId: sid, userId: '1',
    regionScope: { type: 'national' },
    messages: []
  }, {
    configurable: { thread_id: sid + ':main' },
    recursionLimit: 60
  });

  console.log('耗时:', Date.now() - t0, 'ms');
  const reply = state.reply_markdown || state.finalResponse || '';
  console.log('回复:', reply.slice(0, 500));

  // 验证消息已持久化到 MySQL
  const msgs = await chatCrud.getMessages(sid);
  console.log('持久化消息数:', msgs.length);
  if (msgs.length === 0) { console.error('FAIL: 消息未持久化'); process.exit(1); }
  console.log('ALL CHECKS PASSED');
  process.exit(0);
})().catch(err => { console.error('FAIL:', err.message); process.exit(1); });
"
```

Expected: `ALL CHECKS PASSED`，回复含实际数据，消息已写入 MySQL。

- [ ] **Step 5: 运行工具 smoke test**

```bash
cd TOT_backend/server && bash scripts/test-tools-smoke.sh
```

Expected: `ALL CHECKS PASSED`

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "test: add E2E verification for chat MySQL migration"
```

---

## 不改的文件

- `TOT_backend/server/db/index.js` — 保留不动
- `TOT_backend/server/db/schema.sql` — 保留不动
- `TOT_backend/server/agent/graph/` (除 persistAndEmit.js, loadContext.js) — 保留不动
- `TOT_backend/server/chat_tools/` — 保留不动
- MySQL 数据库 — 不执行任何 DDL/SQL
