# Executive Chat 实现设计文档

**日期：** 2026-04-10  
**状态：** 已批准，待实现  
**关联规格：** `docs/specs/09-EXECUTIVE-CHAT.md`、`docs/specs/04-API-SPEC.md §6`

---

## 背景与目标

Executive Chat（简称 EChat）是一个面向 `executive` 角色的 AI 对话界面，让高管可以用自然语言查询培训任务数据（完成率、预警、门店排名等），而无需手动操作看板界面。

**MVP 目标：**
- 支持 4 类意图的自然语言查询
- 单 executive 账号，查看全量数据（national 范围）
- 对话历史持久化

---

## 关键决策汇总

| 决策项 | 结论 | 理由 |
|--------|------|------|
| 辖区绑定策略 | Strategy A：DB 列 | 持久化、重启不丢失、可扩展 |
| 会话存储 | SQLite 持久化 | 对话历史可查、重启不丢失 |
| Agent 架构 | 双阶段 LLM（意图 + 答复） | 数据准确、可调试、工具可复用 |
| MVP 意图范围 | 前 4 类 | analytics_query 留后续迭代 |
| LLM 响应方式 | 非流式 Batch | 实现简单，与现有接口一致 |
| 权限（MVP） | `NULL` = national 全量 | 单账号，暂无需过滤 |

---

## 1. 权限模型

### 1.1 DB 列设计

在 `users` 表新增两列（MVP 阶段均为 NULL）：

```sql
ALTER TABLE users ADD COLUMN executive_regions TEXT;
-- NULL = national 全量；JSON 数组 = 仅指定大区，如 '["华东","华北"]'

ALTER TABLE users ADD COLUMN executive_rtm TEXT;
-- NULL = 不限 RTM；单个 RTM 值 = 仅指定渠道，如 'Monobrand'（后续迭代）
```

### 1.2 辖区解析逻辑

```javascript
// chatService.js: createSession() 中调用
function resolveRegionScope(user) {
  if (user.executive_rtm) {
    return { type: 'rtm', rtm: user.executive_rtm, regions: null };
  }
  if (user.executive_regions) {
    return { type: 'regional', regions: JSON.parse(user.executive_regions), rtm: null };
  }
  return { type: 'national', regions: null, rtm: null };
}
```

### 1.3 查询过滤注入

所有工具函数接受 `regionScope` 参数：

```javascript
// national: 不添加 WHERE 过滤
// regional: WHERE s.region IN (?, ?, ...)
// rtm:      WHERE s.rtm = ?
```

---

## 2. 数据库变更

### 2.1 新增列（`server/db/index.js` 迁移）

```javascript
function migrateUsersExecutiveScope(db) {
  const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!cols.includes('executive_regions')) {
    db.prepare("ALTER TABLE users ADD COLUMN executive_regions TEXT").run();
  }
  if (!cols.includes('executive_rtm')) {
    db.prepare("ALTER TABLE users ADD COLUMN executive_rtm TEXT").run();
  }
}
```

### 2.2 新建表

```sql
-- server/db/schema.sql 补充

CREATE TABLE IF NOT EXISTS chat_sessions (
  id          TEXT PRIMARY KEY,           -- nanoid
  user_id     INTEGER NOT NULL REFERENCES users(id),
  role_scope  TEXT NOT NULL
              CHECK (role_scope IN ('national', 'regional', 'rtm')),
  regions     TEXT,                       -- JSON 数组；role_scope=regional 时非空
  rtm         TEXT,                       -- role_scope=rtm 时非空
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  last_active TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id          TEXT PRIMARY KEY,           -- nanoid
  session_id  TEXT NOT NULL REFERENCES chat_sessions(id),
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content     TEXT NOT NULL,
  -- user 行: 原始提问文本
  -- assistant 行: JSON 序列化的 replyContent 对象
  intent_type TEXT,                       -- 仅 assistant 行填写，如 progress_query
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cm_session_id ON chat_messages(session_id);
```

---

## 3. 整体架构

### 3.1 MVP 模式（意图路由）

```
Client
  │
  ├─ POST /api/v1/chat/executive/sessions
  │     └─ chatService.createSession(userId)
  │           ├─ 读 users.executive_regions / executive_rtm
  │           ├─ resolveRegionScope() → { type, regions, rtm }
  │           └─ 写 chat_sessions → 返回 { sessionId, contextId, exampleQuestions }
  │
  └─ POST /api/v1/chat/executive/sessions/:id/messages
        └─ chatService.sendMessage(sessionId, userMessage)
              │
              ├─ Step 1: 读 chat_messages（最近 6 条，3 轮上下文）
              │
              ├─ Step 2: ★ chatAgentRunner.run(userMessage, history, regionScope)
              │            │
              │            │  [CHAT_AGENT_MODE=intent_routing（MVP默认）]
              │            ├─ chatIntentService.classify() → { intentType, entities }
              │            ├─ chatToolsService.executeByName(intentType, entities, regionScope)
              │            └─ chatAnswerService.format(userMessage, toolResult, history)
              │
              │            [CHAT_AGENT_MODE=function_calling（FC升级后）]
              │            └─ FC Loop（见 §3.2）
              │
              └─ Step 3: 写 chat_messages（user + assistant 各一行）
                         → 返回 replyContent
```

**★ 关键抽象点：** `chatAgentRunner.run()` 是意图路由模式与 Function Calling 模式的**唯一切换层**。`chatService.js` 不感知使用哪种模式，所有上层逻辑（Session 管理、DB 读写、路由鉴权）在两种模式下完全不变。

### 3.2 FC 升级后模式（Function Calling）

```
chatAgentRunner.run(userMessage, history, regionScope)
  │
  ├─ LLM Call（携带 TOOL_SCHEMAS）
  │     model: deepseek-chat
  │     tools: chatToolsService.TOOL_SCHEMAS   ← 与工具函数定义同源
  │     tool_choice: 'auto'
  │
  ├─ 若 response.tool_calls 非空：
  │     └─ chatToolsService.executeByName(name, params, regionScope)  ← 与 MVP 同一入口
  │           （可并行调用多个工具，天然支持复合查询）
  │
  └─ LLM 携带工具结果再次调用 → 直接返回 replyContent
```

切换方式：`.env` 中设置 `CHAT_AGENT_MODE=function_calling`，重启即生效，无需代码部署。

---

## 4. 文件结构

### 4.1 新增文件

```
server/routes/chat.js
  - POST /chat/executive/sessions
  - POST /chat/executive/sessions/:id/messages
  - GET  /chat/executive/sessions/:id/history

server/services/chatService.js
  - createSession(userId)
  - sendMessage(sessionId, userMessage, userId)   ← 调 chatAgentRunner，不感知模式
  - getHistory(sessionId, pageNum, pageSize)

server/services/chatAgentRunner.js               ← ★ FC 升级切换层
  - run(userMessage, history, regionScope) → replyContent
  - [intent_routing] 内部调 classify → executeByName → format
  - [function_calling] 内部走 FC Loop，调同一个 executeByName
  - 读 process.env.CHAT_AGENT_MODE 决定走哪条路

server/services/chatIntentService.js             ← 仅 intent_routing 模式使用
  - classify(userMessage, history) → { intentType, entities }
  - SYSTEM_PROMPT（4 类意图定义 + 输出格式约束）

server/services/chatToolsService.js              ← ★ 两种模式共用，不改动
  - TOOL_SCHEMAS                                 ← JSON Schema 定义（MVP即写好，FC时直接用）
  - executeByName(toolName, params, regionScope) ← FC-ready 统一入口
  - getOverviewData(taskId, regionScope)
  - getTaskListData(regionScope)
  - getWarningsData(taskId, regionScope)
  - getStoreDetailData(storeId, taskId)

server/services/chatAnswerService.js             ← 仅 intent_routing 模式使用（FC模式由LLM自行生成答复）
  - format(userMessage, toolResult, history) → replyContent
  - SYSTEM_PROMPT（结构化输出要求）
```

### 4.2 修改文件

```
server/app.js
  - 注册: app.use('/api/v1/chat', chatRouter)

server/db/index.js
  - 新增迁移函数: migrateUsersExecutiveScope
  - 新增迁移函数: ensureChatTables

server/db/schema.sql
  - 补充 chat_sessions + chat_messages 建表语句

docs/specs/01-DATA-MODEL.md
  - §10（新增）: chat_sessions / chat_messages 表定义

docs/backend/03-DATABASE.md
  - 新增两行：chat_sessions、chat_messages

docs/specs/04-API-SPEC.md
  - §6 Chat API 状态从 "P1（未实现）" → "P1（已实现）"

docs/specs/09-EXECUTIVE-CHAT.md
  - 补充实现说明章节：Strategy A 选定、文件结构、权限演进路线
```

---

## 5. 意图分类（LLM Call 1）

### 5.1 意图类型

| intentType | 含义 | 典型问句 |
|---|---|---|
| `progress_query` | 查完成率/进度数据 | "Q1培训完成率是多少？" |
| `project_status` | 查任务列表/状态概览 | "现在有哪些进行中的任务？" |
| `warning_query` | 查预警/风险门店 | "有哪些门店需要关注？" |
| `drill_down` | 查具体门店员工进度 | "上海环球港店具体情况怎么样？" |
| `unknown` | 闲聊/打招呼，或系统�����对应数据的业务问题 | "你好！" / "给我分析下员工的心理状态" |

**`unknown` 意图双路分支处理：**
- **闲聊/打招呼**（如"你好"、"谢谢"）：`chatAnswerService.format()` 接收空 `toolResult`，LLM 自由回答，不查询任何数据。
- **超出数据范围的业务问题**（如"员工的学习偏好分析"）：`toolResult` 为空，LLM 在答复中说明"暂无相关数据"，不捏造数据。

### 5.2 意图分类 Prompt 结构

```
SYSTEM: 你是一个培训管理系统的意图分类助手。
        根据用户提问，输出以下 JSON（不加代码块标记）：
        { "intentType": "<类型>", "entities": { "taskId": null|string, "storeId": null|string, "region": null|string } }
        
        合法 intentType: progress_query | project_status | warning_query | drill_down | unknown
        
        unknown 的判断标准：
        - 闲聊/打招呼（无业务意图）→ unknown
        - 业务问题但系统无对应数据（如"员工学习偏好"）→ unknown
        
        示例：
        用户: "Q1培训完成率？" → { "intentType": "progress_query", "entities": { "taskId": null } }
        用户: "上海环球港店怎么样？" → { "intentType": "drill_down", "entities": { "storeId": null, "storeName": "上海环球港" } }
        用户: "你好！" → { "intentType": "unknown", "entities": {} }
        用户: "分析员工的学习偏好" → { "intentType": "unknown", "entities": {} }

HISTORY: [最近 3 轮对话]

USER: {userMessage}
```

### 5.3 实体解析补丁

LLM 可能返回 `storeName` 而非 `storeId`，工具层在 dispatch 时进行名称→ID 模糊匹配。

---

## 6. 工具函数（数据层）

所有工具函数均使用 `better-sqlite3` 同步查询（与项目规范一致，不用 `await`）。

**`chatToolsService.js` 是整个 EChat 中唯一在 FC 升级时完全不改动的文件。**

### 6.1 TOOL_SCHEMAS（MVP 即定义，FC 时直接启用）

```javascript
// MVP阶段：TOOL_SCHEMAS 写好但不传给 LLM���仅作为工具文档
// FC升级后：直接作为 openai.chat.completions.create({ tools: TOOL_SCHEMAS }) 的入参

const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'getOverviewData',
      description: '查询培训任务整体完成率、进度统计、预警率等汇总数据',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: '任务ID，不传则汇总所有已下发任务' },
          region: { type: 'string', description: '大区名称过滤，如"华东"' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'getTaskListData',
      description: '查询当前所有已下发培训任务的列表、截止时间与完成情况',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'getWarningsData',
      description: '查询存在风险的门店列表（完成率低或临近截止），即预警数据',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: '任务ID，不传则扫描所有任务' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'getStoreDetailData',
      description: '查询某一具体门店内所有员工的培训进度明细',
      parameters: {
        type: 'object',
        required: ['storeId'],
        properties: {
          storeId: { type: 'string', description: '门店ID' },
          taskId:  { type: 'string', description: '任务ID，不传则取最近一个任务' }
        }
      }
    }
  }
];
```

### 6.2 executeByName（FC-ready 统一入口）

**这是 FC 升级的核心接口契约**——意图路由和 FC Loop 都通过同一函数调用工具：

```javascript
// MVP的 dispatch() 内部调这个；FC升级后 FC Loop 直接调这个
function executeByName(toolName, params, regionScope) {
  switch (toolName) {
    case 'getOverviewData':    return getOverviewData(params.taskId, regionScope);
    case 'getTaskListData':    return getTaskListData(regionScope);
    case 'getWarningsData':    return getWarningsData(params.taskId, regionScope);
    case 'getStoreDetailData': return getStoreDetailData(params.storeId, params.taskId);
    default: throw new Error(`Unknown tool: ${toolName}`);
  }
}
```

### 6.3 regionScope 过滤注入

```javascript
function buildRegionFilter(regionScope) {
  if (!regionScope || regionScope.type === 'national') return { sql: '', params: [] };
  if (regionScope.type === 'regional') {
    const placeholders = regionScope.regions.map(() => '?').join(',');
    return { sql: `AND s.region IN (${placeholders})`, params: regionScope.regions };
  }
  if (regionScope.type === 'rtm') {
    return { sql: 'AND s.rtm = ?', params: [regionScope.rtm] };
  }
}
```

### 6.4 四个工具函数

- `getOverviewData(taskId, regionScope)`：复用 dashboard overview 查询逻辑
- `getTaskListData(regionScope)`：查 tasks WHERE status='dispatched'，JOIN task_assignments 聚合
- `getWarningsData(taskId, regionScope)`：复用 dashboard warnings 查询逻辑
- `getStoreDetailData(storeId, taskId)`：复用 dashboard store-detail 查询逻辑

---

## 7. 答复格式化（LLM Call 2）

### 7.1 输出结构

```typescript
interface ReplyContent {
  overview: string;                          // 1-2 句总结
  keyNumbers: { label: string; value: string; unit: string }[];  // 关键数字
  attentionPoints: string[];                 // 需要关注的问题（最多 3 条）
  followUpSuggestions: string[];            // 追问引导（最多 3 条，以"可追问："开头）
}
```

### 7.2 答复 Prompt 结构

```
SYSTEM: 你是一个培训数据分析助手，请根据以下查询结果，
        用中文回答用户问题，输出严格符合以下 JSON 格式（不加代码块标记）:
        { "overview": "...", "keyNumbers": [...], "attentionPoints": [...], "followUpSuggestions": [...] }
        
        要求：
        - overview 不超过 60 字
        - keyNumbers 最多 4 项，数字必须来自查询结果，不得捏造
        - attentionPoints 最多 3 项，聚焦问题与风险
        - followUpSuggestions 最多 3 项，以"可追问："开头

DATA: {JSON.stringify(toolResult)}

USER: {userMessage}
```

---

## 8. 多轮上下文策略

- 每次 LLM 调用前，读取该 session 最近 **6 条** chat_messages（3 轮对话）
- history 以 `[{ role: 'user', content }, { role: 'assistant', content }]` 形式传入 LLM
- assistant 行的 content 在 DB 存储为 `JSON.stringify(replyContent)`；传入 LLM 时取 `replyContent.overview`（避免 token 爆炸）

---

## 9. API 路由概要

### 9.1 `POST /api/v1/chat/executive/sessions`

**权限：** `executive`  
**请求体：** 无（辖区从 JWT → users.executive_regions 自动解析）  
**响应：**
```json
{
  "sessionId": "string",
  "contextId": "string",      // 与 sessionId 相同（兼容 API spec）
  "exampleQuestions": ["Q1新品培训完成率？", "有哪些门店需要关注？", "现在有哪些进行中的任务？"]
}
```

### 9.2 `POST /api/v1/chat/executive/sessions/:id/messages`

**权限：** `executive`（且只能访问自己的 session）  
**请求体：** `{ content: string }`  
**响应：** `{ messageId, replyContent, responseTime, contextId, timestamp }`

### 9.3 `GET /api/v1/chat/executive/sessions/:id/history`

**权限：** `executive`（且只能访问自己的 session）  
**查询参数：** `pageNum, pageSize`  
**响应：** 分页 chat_messages 列表

---

## 10. 关键实现约束

### 10.1 Sync/Async 边界（重要）

项目使用 `better-sqlite3`，所有 DB 操作必须同步，禁止对 `db.*` 调用使用 `await`。LLM 调用（`utils/ai.generateText`）是 async 的。两者在同一函数中共存时必须：

```javascript
// ✅ 正确
async function sendMessage(sessionId, userMessage) {
  // DB 读取：同步
  const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(sessionId);
  const history = db.prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 6').all(sessionId);
  
  // LLM 调用：await
  const intent = await chatIntentService.classify(userMessage, history);
  const toolResult = chatToolsService.dispatch(intent.intentType, intent.entities, session);  // 同步
  const reply = await chatAnswerService.format(userMessage, toolResult, history);  // await
  
  // DB 写入：同步
  db.prepare('INSERT INTO chat_messages ...').run(...);
  return reply;
}
```

### 10.2 Session 所有权校验

所有 session 相关接口（发消息、查历史）必须在路由层校验：

```javascript
// routes/chat.js
router.post('/executive/sessions/:sessionId/messages', authenticate, requireRole(['executive']), async (req, res) => {
  const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(req.params.sessionId);
  if (!session) return res.status(404)...;
  if (session.user_id !== req.user.id) return res.status(403)...;
  // ...
});
```

### 10.3 Warning Query 数据访问

`warning_query` 工具函数不调用 `/api/v1/dashboard/warnings` HTTP 接口（该路由仅限 `central`），而是**直接调用底层服务函数**或复用 SQL 查询逻辑，绕过路由层权限中间件。

```javascript
// chatToolsService.js
function getWarningsData(taskId, regionScope) {
  // 直接查询，不走 HTTP
  const filter = buildRegionFilter(regionScope);
  return db.prepare(`
    SELECT s.id, s.name, COUNT(*) as total,
           SUM(CASE WHEN ta.status='completed' THEN 1 ELSE 0 END) as completed
    FROM task_assignments ta
    JOIN stores s ON s.id = ta.store_id
    WHERE ta.task_id = ? ${filter.sql}
    GROUP BY s.id
    HAVING CAST(completed AS FLOAT)/total < 0.8
  `).all(taskId, ...filter.params);
}
```

### 10.4 请求体 `executiveId` 字段

API spec §6.1 的请求体包含 `executiveId` 字段，但实现时**忽略此字段**，身份以 JWT `req.user.id` 为准，与项目其他接口保持一致（避免身份伪造风险）。

---

## 11. 错误处理（原 §10）

| 场景 | 处理方式 |
|---|---|
| LLM Call 1 返回格式非法 JSON | 降级为 `progress_query`，entities 全空 |
| LLM Call 1 返回 `unknown` 意图 | 跳过工具调用，直接以空 toolResult 进入 LLM Call 2；LLM 自由回答（闲聊）或说明"暂无相关数据"（超范围业务问题）|
| LLM Call 2 返回格式非法 JSON | 使用 fallback 模板答复 |
| 工具函数查询结果为空 | LLM 收到空数据，生成"暂无数据"类答复 |
| DeepSeek API 超时/不可用 | 返回 503，错误码 `AI_001` |
| sessionId 不属于当前 executive | 返回 403 |

---

## 14. Function Calling 升级路径（MVP 终态目标）

### 14.1 升级范围

| 文件 | MVP 阶段 | FC 升级后 | 改动量 |
|---|---|---|---|
| `chatService.js` | 调 chatAgentRunner | 不变 | 0 |
| `chatAgentRunner.js` | intent_routing 分支 | 新增 function_calling 分支 | ~50 行 |
| `chatToolsService.js` | TOOL_SCHEMAS 已定义，executeByName 已实现 | **完全不变** | 0 |
| `chatIntentService.js` | 使用 | FC 模式下不调用（但保留文件） | 0 |
| `chatAnswerService.js` | 使用 | FC 模式下不调用（LLM自行生成答复） | 0 |
| `utils/ai.js` | generateText | 新增支持 tools 参数 | ~20 行 |
| 路由、DB、鉴权 | 使用 | 完全不变 | 0 |

**总估算：~70 行新增代码，0 行删除，0 处接口破坏。**

### 14.2 chatAgentRunner.js 完整实现结构

```javascript
const CHAT_AGENT_MODE = process.env.CHAT_AGENT_MODE || 'intent_routing';

async function run(userMessage, history, regionScope) {
  if (CHAT_AGENT_MODE === 'function_calling') {
    return runFunctionCalling(userMessage, history, regionScope);
  }
  return runIntentRouting(userMessage, history, regionScope);
}

// MVP 模式（当前实现）
async function runIntentRouting(userMessage, history, regionScope) {
  const intent = await chatIntentService.classify(userMessage, history);
  const toolResult = chatToolsService.executeByName(intent.intentType, intent.entities, regionScope);
  return chatAnswerService.format(userMessage, toolResult, history);
}

// FC 升级后（一次实现，通过环境变量启用）
async function runFunctionCalling(userMessage, history, regionScope) {
  const messages = [...history, { role: 'user', content: userMessage }];

  // 第一次 LLM 调用：携带 TOOL_SCHEMAS
  const response = await ai.chatWithTools({
    messages,
    tools: chatToolsService.TOOL_SCHEMAS
  });

  if (!response.tool_calls?.length) {
    // LLM 直接回答（无需调工具）
    return parseReplyContent(response.content);
  }

  // 执行所有工具（同步调用，可并行）
  const toolResults = response.tool_calls.map(tc =>
    chatToolsService.executeByName(
      tc.function.name,
      JSON.parse(tc.function.arguments),
      regionScope          // ← regionScope 在这里注入，LLM 感知不到权限边界
    )
  );

  // 第二次 LLM 调用：携带工具结果生成最终答复
  const finalResponse = await ai.chatWithTools({
    messages: [
      ...messages,
      { role: 'assistant', content: null, tool_calls: response.tool_calls },
      ...toolResults.map((result, i) => ({
        role: 'tool',
        tool_call_id: response.tool_calls[i].id,
        content: JSON.stringify(result)
      }))
    ],
    tools: chatToolsService.TOOL_SCHEMAS,
    tool_choice: 'none'   // 第二次不再调工具
  });

  return parseReplyContent(finalResponse.content);
}
```

### 14.3 升级时机建议

当出现以下任一条件时启动升级：

1. 用户频繁提复合问题（日志中 `intent=unknown` 占比 > 10%）
2. 意图误分类 case 出现（如 warning 被识别为 progress）
3. 新增第 5 类意图（analytics_query）

升级步骤：
1. 在 `utils/ai.js` 添加 `chatWithTools()` 方法（支持 OpenAI FC 格式）
2. 在 `chatAgentRunner.js` 实现 `runFunctionCalling()` 分支
3. 在测试环境设 `CHAT_AGENT_MODE=function_calling` 验证
4. 确认无误后生产切换，`chatIntentService.js` / `chatAnswerService.js` 保留不删（可回滚）

---

## 12. 不在本期范围

- `analytics_query` 意图（分位数、完成时间分布、Pearson 相关）
- RTM 级权限过滤（`executive_rtm` 列扩展）
- 流式 SSE 响应
- Chat session 列表查询
- Session 过期/清理逻辑

---

## 13. 实现顺序建议

1. DB 迁移（`users` 新列 + 两张新表）
2. `chatToolsService.js`（TOOL_SCHEMAS + executeByName + 四工具函数，先用静态数据测通路）
3. `chatIntentService.js`（LLM Call 1 意图分类）
4. `chatAnswerService.js`（LLM Call 2 答复格式化）
5. `chatAgentRunner.js`（串联 intent_routing 模式完整流程）
6. `chatService.js`（Session CRUD + 调 chatAgentRunner）
7. `routes/chat.js` + `app.js` 挂载
8. 文档同步更新
9. （MVP 终态）`chatAgentRunner.js` 添加 FC 分支，`utils/ai.js` 扩展 `chatWithTools()`
