# Agent 待澄清问题

> 设计决策、遗留问题、需要多方确认的事项。已解决的划掉并注明日期。

---

## 待确认

### platform_scope 存储格式统一 (2026-05-22)

- **现状**: `task_publish.platform_scope` 列中 `'["MyPal"]'`(JSON数组) 和 `'mypal'`(纯字符串) 并存
- **影响**: `list_task_progress` 和 `search_task` 中 `JSON.parse` 对纯字符串抛异常，导致部分任务 platform 为空
- **方向**: 工具层兼容 + 数据层清洗，来源方确认入库格式规范

### LOWER() 索引问题 (2026-05-22)

- **现状**: `fetch_alert_persons` SQL 中 `LOWER(ltr.reminder_level) = ?` 使该列索引失效
- **方向**: 入库时统一小写存储 OR 改用 case-insensitive collation

### tool_search_task platform 过滤顺序 (2026-05-22)

- **现状**: SQL 先分页，JS 层 `Array.filter` 再按 platform 过滤，导致页面数据可能不满且排序被破坏
- **方向**: 将 platform 过滤下推到 SQL WHERE 子句

---

## 设计决策

### FC 循环工具调用上限（当前 = 3）

- 当前 `MAX_FC_ROUNDS=3`，如果一个查询需要更多工具串联需要用户追问
- 是否需要按 intent 区分上限（简单查询 2 步，复杂诊断 4 步）？

### FinalResponse COL_NAME_MAP 维护策略 (2026-05-22)

- 当前 `buildTableFromRows` 中 20+ 个字段→中文名映射，新增 tool 字段容易遗漏
- 未映射字段 fallback 到原字段名（`COL_NAME_MAP[k] \|\| k`），不会崩溃但显示不友好
- **方向**: 将显示 label 下放到各 tool 的 meta 定义，消除集中映射

### Chat 历史 LLM 压缩 (2026-05-22)

- `compressAssistantContent` 只做 JSON.parse + overview 截断
- 长会话（> 20 轮）是否需要真正的 LLM 摘要压缩？

---

## 已知不致命问题

| 问题 | 状态 |
|------|------|
| Langfuse LangGraph 子节点 trace 降级 | `getLangfuseCallback = () => null`，顶层 trace 由 tracer.js 接管。需先解决 langfuse-langchain 版本兼容 |
| Regenerate 请求偶发 client abort | 后端 `restoreOldMessage` 兜底不丢数据，前端 toast + 解锁不卡死。根因未定位 |
| MysqlSaver `TASKS` 常量拼接 SQL | LangGraph 库内置常量 `"__TASKS__"`，当前无注入风险但不够安全 |
| Redis 未连接时记忆静默丢弃 | BullMQ lazy connect + 静默失败，有意的降级策略 |
