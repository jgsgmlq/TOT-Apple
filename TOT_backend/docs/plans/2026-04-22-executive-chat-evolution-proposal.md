# Executive Chat (E-Chat) v4.0 工程落地实施方案：AI 可执行版 (Final)

**文档状态：** Approved (AI-Optimized)
**重要指令：** 在执行本计划的任何代码变更时，**必须同步更新相关项目文档**，特别是 `TOT_backend/docs/specs/04-API-SPEC.md` (API) 和 `01-DATA-MODEL.md` (DB)。

## Executive Chat 关联文档（需随计划实施同步更新维护）

以下文档与本方案直接相关。实施过程中，凡涉及对应能力变更，需同步维护：

1. `TOT_backend/docs/specs/09-EXECUTIVE-CHAT.md`（能力边界、架构路线）
   - 维护要求：更新能力范围、分层架构、时序链路与演进阶段描述。
2. `TOT_backend/docs/specs/10-EXECUTIVE-CHAT-INTENTS-TOOLS.md`（意图与工具映射正本）
   - 维护要求：更新新增/下线工具、意图映射、澄清与降级策略、权限口径。
3. `TOT_backend/docs/specs/04-API-SPEC.md`（HTTP/SSE/错误码契约）
   - 维护要求：更新消息接口请求/响应字段、SSE phase 字段、新增错误码与兼容策略。
4. `TOT_backend/docs/specs/01-DATA-MODEL.md`（数据模型规格）
   - 维护要求：更新 `chat_messages` 结构变更、新增 `user_memories` 表与约束。
5. `TOT_backend/docs/backend/03-DATABASE.md`（数据库现状与迁移说明）
   - 维护要求：更新 `schema.sql` 对应 DDL、迁移函数与旧库兼容说明。
6. `TOT_backend/docs/tests/EXECUTIVE-CHAT-TESTING.md`（测试用例与验证路径）
   - 维护要求：补充 v4 场景测试（reasoning 摘要、消歧恢复、幂等、memory upsert）。

> 建议在每个 PR 描述中附上“文档同步清单”，逐项勾选以上条目，避免实现与规格漂移。

---

## 第一阶段：核心重构 (P0 - 体验与健壮性)

### 1. 透明思维链 (CoT) 摘要化与契约对齐
*   **目标文件**：`server/services/chatAgentRunner.js`, `server/utils/ai.js`
*   **SSE 契约对齐**：保持现有 `phase: 'reasoning'` 不变，新增字段 `reasoningLevel: 'summary'`。
*   **实现细节**：
    1.  **推理提取逻辑**：不依赖 `<thought>` 标签正则，直接消费模型流式返回的 `reasoning_content` 增量。
    2.  **安全脱敏**：封装 `sanitizeReasoningSummary(delta)` 函数。对 `reasoning_content` 进行实时过滤，剔除包含 "System Prompt"、"Ignore Instructions" 或敏感工具 Schema 的片段。
    3.  **SSE 契约输出**：
        ```javascript
        if (sc && sanitizedDelta) {
          sc.onDelta(sanitizedDelta, { phase: 'reasoning', reasoningLevel: 'summary' });
        }
        ```
*   **文档维护**：同步更新 `04-API-SPEC.md` §6.2 节关于 SSE 事件字段的描述。

### 2. 基于持久化幂等键的消歧恢复 (Stateful Resume)
*   **目标文件**：`server/services/chatService.js`, `server/db/schema.sql`
*   **幂等性设计**：
    1.  **数据库变更**：在 `chat_messages` 表中增加 `client_message_id TEXT UNIQUE` 字段。
    2.  **后端校验**：在 `handleIncomingMessage` 或 `sendMessage` 开头，检查 `req.body.messageId` 是否已存在于 `client_message_id`。若存在，直接返回已存储的消息或报 409，防止重复点击消歧卡片。
*   **恢复逻辑细节**：
    1.  **DB 消息序列要求**：严格按以下序列重构 history：
        *   `role: 'user', content: '...'`
        *   `role: 'assistant', tool_calls: [...], content: null`
        *   `role: 'tool', tool_call_id: '...', content: '{"storeId": "S001"}'` (这是用户选择后的结果)
    2.  **文档维护**：同步更新 `01-DATA-MODEL.md` §10 关于 `chat_messages` 的字段定义。

---

## 第二阶段：能力增强 (P1 - 沙盒与记忆)

### 3. Code Interpreter 资源隔离与治理
*   **实现架构**：基于 `Pyodide` (WASM) 在 `Worker Threads` 中运行。
*   **安全约束实现**：
    1.  **超时控制**：严格 3s 强制 `terminate()`。
    2.  **网络隔离**：Worker 线程不具备网络 I/O 能力。
*   **工具契约 (`chat_tools/tool_executeCode.js`)**：
    1.  后端通过 `fetchRawDataset` 生成脱敏 CSV 字符串。
    2.  通过 `postMessage` 将 CSV 注入沙盒内存文件系统。

### 4. 全局记忆 (Core Memory) 系统
*   **数据库 Schema (`server/db/schema.sql`)**：符合现有 DDL 规范：
    ```sql
    CREATE TABLE user_memories (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      memory_hash TEXT NOT NULL, -- 对 user_id + content 的 hash，用于稳健 Upsert
      memory_type TEXT DEFAULT 'bias', -- 'bias', 'fact', 'scope'
      content TEXT NOT NULL,
      confidence_score REAL DEFAULT 0.5,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime')),
      UNIQUE(user_id, memory_hash)
    );
    ```
*   **写入逻辑**：使用 `INSERT INTO ... ON CONFLICT(user_id, memory_hash) DO UPDATE`。
*   **文档维护**：同步更新 `01-DATA-MODEL.md` 增加 `user_memories` 章节。

---

## 验收与测试路径
*   **测试脚本规范**：脚本统一放置于 `server/` 根目录，命名遵循 `test-v4-*.js` 风格。
*   **核心自动化脚本**：
    *   `server/test-v4-reasoning.js`：验证 `reasoningLevel: 'summary'` 的下发与脱敏。
    *   `server/test-v4-idempotency.js`：模拟重复发送相同 `messageId` 的幂等拦截。
    *   `server/test-v4-memory-upsert.js`：验证记忆库的 Upsert 与 Hash 稳定性。
