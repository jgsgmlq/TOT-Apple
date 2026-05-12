# Executive Chat 反馈功能实施文档（详细版）

**Status:** Active  
**Owner:** Backend & AI Team  
**Last-Updated:** 2026-04-13  
**Related-Specs:** `docs/specs/04-API-SPEC.md`, `docs/specs/01-DATA-MODEL.md`, `docs/backend/03-DATABASE.md`, `docs/frontend/05-EXECUTIVE-CHAT.md`

## 1. 背景与目标

### 1.1 背景
- 当前 Executive Chat 已支持：
  - 会话创建、发消息、历史查询、会话删除。
  - AI 回答持久化在 `chat_messages`（`role='assistant'`）。
- 当前缺失：
  - 用户无法对 AI 回答执行「重新生成」「喜欢」「不喜欢」。
  - 用户偏好反馈未落库，无法用于后续质量评估与优化。

### 1.2 目标
- 在 Executive Chat 引入三个交互：
  - `重新生成`
  - `喜欢`
  - `不喜欢`
- 将 `喜欢/不喜欢` 落库，满足：
  - 每个用户对每条 assistant 消息仅保留一个最终状态（`like`/`dislike`/`none`）。
- 保持现有会话与消息模型稳定，不破坏当前接口兼容性。

### 1.3 已确认业务规则
- `重新生成`：
  - 仅支持当前会话最后一条 assistant 消息。
  - 触发后生成一条新的 assistant 消息，旧回答保留（多版本并存）。
- `喜欢/不喜欢`：
  - 单用户单消息单状态，可切换。
  - 同按钮再次点击表示取消（状态变 `none`）。

---

## 2. 方案选型与结论

### 2.1 方案 A：扩展 `chat_messages`
- 在 `chat_messages` 增加反馈相关字段（例如计数或 JSON）。
- 问题：
  - 难以在数据库层表达“每用户单状态”约束。
  - 数据职责混杂（消息内容 + 用户关系行为）。
  - 并发更新和审计扩展复杂（JSON 字段维护成本高）。

### 2.2 方案 B：新增 `chat_message_feedback`（推荐）
- 单独反馈表建模用户与消息的关系。
- 通过 `UNIQUE(message_id, user_id)` 直接保证单状态约束。
- 优势：
  - 职责清晰、可扩展（后续可加 `reason`、时间线、统计）。
  - 查询/维护清晰，符合关系型建模最佳实践。

### 2.3 最终决策
- 采用方案 B：新增 `chat_message_feedback` 表。

---

## 3. 影响范围（文件级）

## 3.1 后端
- `TOT_backend/server/db/schema.sql`
- `TOT_backend/server/db/index.js`
- `TOT_backend/server/services/chatService.js`
- `TOT_backend/server/routes/chat.js`
- （可选）`TOT_backend/server/test-echat.sh`

## 3.2 前端
- `TOT_frontend/src/api/chat/index.ts`
- `TOT_frontend/src/views/executive/index.vue`

## 3.3 文档（必须同步）
- `TOT_backend/docs/specs/04-API-SPEC.md`
- `TOT_backend/docs/backend/03-DATABASE.md`
- `TOT_backend/docs/specs/01-DATA-MODEL.md`

---

## 4. 数据库设计

### 4.1 新增表定义
```sql
CREATE TABLE IF NOT EXISTS chat_message_feedback (
  id            TEXT PRIMARY KEY,
  message_id    TEXT NOT NULL REFERENCES chat_messages(id),
  user_id       INTEGER NOT NULL REFERENCES users(id),
  feedback_type TEXT NOT NULL CHECK (feedback_type IN ('like', 'dislike')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_cmf_message_id ON chat_message_feedback(message_id);
CREATE INDEX IF NOT EXISTS idx_cmf_user_id    ON chat_message_feedback(user_id);
```

### 4.2 迁移策略
- 在 `db/index.js` 增加 `ensureChatFeedbackTable(database)`。
- 在 `getDb()` 中注册该迁移函数，确保新老库均可安全执行。
- 迁移要求：
  - 幂等（`IF NOT EXISTS`）。
  - 不影响现有 `chat_sessions` / `chat_messages`。

### 4.3 一致性规则
- 用户仅可反馈属于自己会话中的 assistant 消息。
- 反馈状态写入逻辑：
  - `like/dislike`：upsert（更新 `feedback_type` + `updated_at`）。
  - `none`：删除该用户该消息反馈记录。

---

## 5. API 设计（新增）

### 5.1 提交反馈
- `POST /api/v1/chat/executive/sessions/{sessionId}/messages/{messageId}/feedback`

#### 请求体
```json
{
  "feedback": "like"
}
```
- `feedback` 枚举：`like | dislike | none`

#### 响应体（建议）
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "sessionId": "xxx",
    "messageId": "xxx",
    "userFeedback": "like"
  },
  "requestId": "xxx"
}
```
- 当 `feedback=none` 时：`userFeedback` 返回 `null`。

### 5.2 重新生成回答
- `POST /api/v1/chat/executive/sessions/{sessionId}/messages/{messageId}/regenerate`

#### 语义
- 仅允许 `messageId` 是该会话最后一条 assistant 消息，否则返回 400。
- 服务端以该消息对应上下文重新调用 Agent，生成新 assistant 消息并落库。

#### 响应体（建议）
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "messageId": "new_assistant_msg_id",
    "replyContent": {
      "overview": "string",
      "keyNumbers": [],
      "attentionPoints": [],
      "followUpSuggestions": []
    },
    "responseTime": 1234,
    "contextId": "session_id",
    "timestamp": "2026-04-13 10:00:00"
  },
  "requestId": "xxx"
}
```

### 5.3 历史接口补充
- `GET /api/v1/chat/executive/sessions/{sessionId}/history`
- assistant 项新增字段：
  - `userFeedback: 'like' | 'dislike' | null`

---

## 6. 后端实施步骤

### Step 1: DB 层
- `schema.sql` 追加 `chat_message_feedback` DDL。
- `db/index.js`：
  - 新增 `ensureChatFeedbackTable`。
  - 在 `getDb()` 调用注册。

### Step 2: Service 层（`chatService.js`）
- 新增：
  - `setMessageFeedback(sessionId, messageId, userId, feedback)`
  - `regenerateLastAssistant(sessionId, messageId, userId)`
- `getHistory()`：
  - 查询 assistant 消息时左连接/二次查询当前用户反馈态，组装 `userFeedback`。

### Step 3: Route 层（`routes/chat.js`）
- 新增两个 POST 路由：
  - `.../feedback`
  - `.../regenerate`
- 保留与现有接口一致的鉴权与 ownership 校验风格。

### Step 4: 错误码建议
- `CHAT_006`: feedback 参数非法
- `CHAT_007`: message 不存在或不属于会话
- `CHAT_008`: 仅支持最后一条 assistant 消息重新生成

---

## 7. 前端实施步骤

### Step 1: API 封装（`src/api/chat/index.ts`）
- 新增：
  - `submitChatFeedback(sessionId, messageId, feedback)`
  - `regenerateChatMessage(sessionId, messageId)`
- 扩展 `ChatHistoryItem`：
  - 增加 `userFeedback?: 'like' | 'dislike' | null`

### Step 2: 视图模型（`src/views/executive/index.vue`）
- 将消息模型从“纯文本气泡”升级为带元数据对象：
  - `messageId`
  - `role`
  - `content/replyContentText`
  - `feedbackState`
  - `canRegenerate`

### Step 3: UI 交互
- AI 消息气泡底部增加按钮：
  - 重新生成
  - 喜欢
  - 不喜欢
- 状态规则：
  - 点赞后再点踩：切换为踩。
  - 点赞后再点赞：取消（none）。
  - 踩同理。
- 重新生成按钮仅对“最后一条 AI 消息”显示可用。

---

## 8. 验证与测试

### 8.1 后端验证
- 启动后检查新表存在。
- feedback 用例：
  - like -> dislike -> none 流程正确。
  - 非本人会话返回 403。
  - user 消息 id 不可反馈（应 400）。
- regenerate 用例：
  - 最后一条 assistant 消息可成功生成新消息。
  - 非最后一条 assistant 消息返回 400。

### 8.2 前端验证
- 历史消息可正确显示反馈态。
- 刷新页面后反馈态仍正确回显（来自历史接口）。
- 快速连续点击反馈按钮状态不乱（以前端 loading/禁用防抖）。

### 8.3 回归范围
- 不影响已有：
  - 创建会话
  - 发送消息
  - 历史分页
  - 删除会话

---

## 9. 文档更新要求（强制）

### 9.1 API 文档
- 更新 `04-API-SPEC.md`：
  - 新增 feedback、regenerate 两个接口。
  - 更新历史消息结构新增 `userFeedback` 字段。
  - 补充错误码与权限说明。

### 9.2 数据库文档
- 更新 `03-DATABASE.md`：
  - 新增 `chat_message_feedback` 表章节（字段、索引、唯一约束、语义）。
  - 增加迁移说明与关联关系说明。

### 9.3 数据模型文档
- 更新 `01-DATA-MODEL.md`：
  - 新增 EChat 反馈实体关系：
    - `chat_messages (1) -> (n) chat_message_feedback`
    - `users (1) -> (n) chat_message_feedback`

---

## 10. 里程碑与交付物

### M1（DB + 后端接口）
- 交付：
  - 新表迁移
  - feedback/regenerate 接口
  - getHistory 返回 `userFeedback`

### M2（前端交互）
- 交付：
  - 三按钮交互上线
  - 重新生成与反馈状态联动

### M3（文档与测试）
- 交付：
  - API/DB/数据模型文档更新完成
  - 验证脚本补全并通过

---

## 11. 风险与缓解

- 风险：重新生成引发多条相似 AI 回答导致用户困惑。
  - 缓解：仅允许最后一条触发；前端在 UI 上明确“已重新生成新版本”。
- 风险：反馈按钮重复点击导致请求并发。
  - 缓解：按钮请求期间禁用，后端 upsert/删除幂等。
- 风险：历史查询性能下降。
  - 缓解：`chat_message_feedback` 建立 `message_id` 和 `user_id` 索引。

---

## 12. 验收标准（DoD）

- 功能：
  - 用户可对 AI 消息执行“重新生成/喜欢/不喜欢/取消”。
  - 反馈在刷新后可从数据库恢复显示。
- 数据：
  - 任意 `(message_id, user_id)` 在表中至多一条记录。
- 接口：
  - 新接口通过鉴权、ownership、参数校验。
- 文档：
  - `04-API-SPEC.md`、`03-DATABASE.md`、`01-DATA-MODEL.md` 均完成更新且内容一致。
- 回归：
  - 现有 EChat 主流程无回归。

