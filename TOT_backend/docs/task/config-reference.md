# 配置项参考

所有环境变量在 `TOT_backend/.env` 中设置，`app.js` 启动时加载。

## Agent / FC 循环

| 变量 | 默认值 | 说明 |
|---|---|---|
| `CHAT_AGENT_MODE` | `intent_routing` | Agent 模式：`intent_routing` 走旧双阶段，`function_calling` 走 LangGraph FC |
| `MAX_FC_ROUNDS` | `3` | FC 循环最大轮次 |
| `FC_HISTORY_MAX_MESSAGES` | `30` | FC LLM 上下文截断的消息条数 |
| `FC_LLM_TIMEOUT_MS` | `60000` | FC LLM 流式调用超时（ms） |

## LLM

| 变量 | 说明 |
|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥（FC 模型、标题生成、FinalResponse） |
| `DEEPSEEK_API_BASE_URL` | DeepSeek API 地址，默认 `https://api.deepseek.com/v1` |
| `DEEPSEEK_REASONER` | 设为 `true` 时 FC 模型使用 `deepseek-reasoner`，否则用 `deepseek-chat` |

## MySQL / Redis

| 变量 | 说明 |
|---|---|
| `MYSQL_URL` | MySQL 连接串，格式 `mysql://user:pass@host:port/db` |
| `REDIS_URL` | Redis 连接串（BullMQ 队列需要 Redis >= 5.0） |

## MyPal

| 变量 | 说明 |
|---|---|
| `MYPAL_MOCK` | `1` 启用 `/api/v1/mypal/mock/learning` 路由（SQLite mock），`0` 关闭 |
| `MYPAL_ENABLED` | `1` 启用真实 MyPal HTTP 同步 |
| `MYPAL_API_BASE` | MyPal API 地址 |
| `MYPAL_APP_ID` | MyPal App ID |
| `MYPAL_APP_SECRET` | MyPal App Secret |
| `MYPAL_REQUEST_TIMEOUT_MS` | MyPal HTTP 超时，默认 `3000` |

## Langfuse 追踪

| 变量 | 说明 |
|---|---|
| `LANGFUSE_ENABLED` | `true` 启用追踪上报 |
| `LANGFUSE_SECRET_KEY` | 密钥 |
| `LANGFUSE_PUBLIC_KEY` | 公钥 |
| `LANGFUSE_BASEURL` | 地址（注意是 `BASEURL` 不是 `BASE_URL`） |
| `LANGFUSE_SAMPLE_RATE` | 采样率，`1.0` 全量 |
| `LANGFUSE_MASK_PII` | `true` 上报前脱敏手机号/邮箱 |

## Debug

| 变量 | 说明 |
|---|---|
| `DEBUG_AI_LOG` | `true` 时记录完整 AI 输入输出到 `server/logs/ai_debug.log` |
| `DEBUG_GRAPH` | `true` 时启用图节点追踪器（`graphDebugger.js`） |
| `TEST_MOCK_MODE` | `true` 时 persistAndEmit 跳过 DB 持久化（仅 test-runner 使用） |

## 未澄清项

- `MYPAL_MOCK=1` 同时 `MYPAL_ENABLED=1` 时，MyPal sync 到底走 mock 还是真实 API？当前两个开关独立，mock 路由和真实 sync 可能并存。
- `LANGFUSE_BASEURL` 命名不一致（SDK 约定 `BASEURL` 无下划线），容易写错。
