# Agent 配置参考

> 所有可调参数、环境变量、Prompt 版本号的单一信息源。新增配置时同步更新此文件。

---

## 环境变量

### LLM

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DEEPSEEK_API_KEY` | `OPENAI_API_KEY` 的值 | DeepSeek API 密钥 |
| `DEEPSEEK_API_BASE_URL` | `https://api.deepseek.com/v1` | DeepSeek API 地址 |
| `DEEPSEEK_REASONER` | `false` | 设为 `true` 时 FC 模型切为 `deepseek-reasoner`，maxTokens 从 2048 → 4096 |

### FC 循环

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MAX_FC_ROUNDS` | `3` | FC 工具调用最大轮数，超限后 LLM 不再绑工具直接总结 |
| `FC_LLM_TIMEOUT_MS` | `60000` | 单次 FC LLM 调用超时（毫秒） |
| `FC_HISTORY_MAX_MESSAGES` | `30` | 注入 FC LLM 的历史消息条数上限（含 tool 消息） |

### Chat 会话

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CHAT_HISTORY_MAX_ROWS` | `100` | 每次请求加载的历史消息 SQL LIMIT 上限 |

### Agent Graph

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DEBUG_GRAPH` | `false` | 为 `true` 时每个节点输入输出写入日志 |
| `LOG_LEVEL` | — | 设为 `debug` 时 tool 调用打印 args/result 摘要 |

### 基础设施

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `JWT_SECRET` | `mvp-training-secret-2026` | JWT 签名密钥 |
| `MYSQL_URL` | — | MySQL 连接字符串（`mysql://user:pass@host:port/db`） |
| `PORT` | `3000` | HTTP 服务端口 |

---

## 模型配置

所有模型在 `agent/graph/llm.js` 中定义。

| 名称 | 用途 | 模型 | temperature | maxTokens | streaming | 其他 |
|------|------|------|-------------|-----------|-----------|------|
| `routerModel` | 安全网关意图分类 | deepseek-chat | 0.1 | 512 | 否 | — |
| `fcModel` | FC 循环工具选择+思考链 | deepseek-chat/reasoner | 0.1 | 2048/4096 | 是 | 由 `DEEPSEEK_REASONER` 控制 |
| `structuredModel` | FinalResponse 结构化 JSON | deepseek-chat | 0.1 | 2048 | 是 | `response_format: json_object` |
| `titleModel` | 会话标题自动生成 | deepseek-chat | 0 | 32 | 否 | — |
| `memoryModel` | 异步记忆提取(BullMQ) | deepseek-chat | 0.1 | 512 | 否 | — |

**注意**：所有模型均为模块级单例。

---

## Prompt 注册表

在 `prompts/registry.js` 中注册。

| Key | 版本 | 文件 | 使用者 |
|-----|------|------|--------|
| `safety_gateway` | `safety_gateway/v1` | `prompts/safetyGateway.js` | `SafetyGateway` 节点 |
| `fc_agent` | `fc/v2` | `prompts/fc_agent.js` | `fc_LlmToolCallStep` 节点 |
| `final_response` | `final_response/v1` | `prompts/final_response.js` | `FinalResponseStep` 节点 |
| `chat_reply` | — | `prompts/chat_reply.js` | `FinalResponseStep` 闲聊路径 |
| `router` | — | `prompts/router.js` | 未直接使用（SafetyGateway 替代） |

---

## Graph 参数

| 参数 | 值 | 位置 |
|------|-----|------|
| `recursionLimit` | 60 | `chatService.js` — `app.invoke()` 调用处 |
| Checkpoint DB 表 | `checkpoints`, `writes` | `mysqlSaver.js` — 应用启动时 DDL |
| Checkpoint 序列化 | `JsonPlusSerializer`(默认) | `MysqlSaver` 构造函数 |
