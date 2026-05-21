# 待澄清与已知问题

## 待决策

1. **DIMENSION_MAP 统一**（架构审查候选 1，被跳过）
   - `executiveMetricsService.js:7-12` 的 `DIMENSION_MAP` 和 `queryEngine.js:20-26` 的 `DIMENSION_KEY` 是两个独立映射，键名和列名不一致
   - 影响：新增维度需要改两处，容易漏

2. **Redis 版本不足**
   - 日志报 `Redis version needs to be >= 5.0.0 Current: 3.2.12`
   - 影响：BullMQ MemoryIngestionQueue 无法启动，记忆功能不可用
   - 非阻塞，publish 失败静默忽略

3. **前端侧栏持久化方案**
   - 当前侧栏标题存在 `localStorage`，与后端 MySQL `chat_session.title` 不同步
   - 理想方案：侧栏从后端 API 加载，localStorage 仅做缓存
   - 当前实现：前端收到 SSE done 后更新侧栏，但首次加载仍依赖 localStorage

4. **Mock 数据清理**
   - MySQL `task_publish` 表只有 4 条 `CHATMOCK_TASK_*` 测试数据（`mock_v2_seed` 创建）
   - 真实 seed 数据已被覆盖
   - 需决定：恢复 seed 数据 or 导入真实数据

## 架构债务

| 债务 | 位置 | 状态 |
|---|---|---|
| tracer.js 双份 | `utils/` + `modules/common/utils/` | ✅ 已删除重复（2026-05-21） |
| toolResults 4 套解析器 | renderers/decideChart/extractPlottableData/finalResponseStep | ✅ 已统一为 normalizeToolResults（2026-05-21） |
| fc_Escalate 空节点 | `graph/nodes/fc_Escalate.js` | ✅ 已删除（2026-05-21） |
| 双轨错误格式 throw+return | chatToolsService + fc_ExecuteTool | ✅ 已统一为 return-only（2026-05-21） |
| 80% 模块零测试 | 全局 | ⚠️ 新增 normalize-tool-results 等 12 个测试，但覆盖率仍低 |
| DIMENSION_MAP 双份 | executiveMetricsService + queryEngine | ⛔ 被跳过 |

## UI 设计决策

- **配色**：Precision Dashboard（纯白底 #fff，海军蓝文字 #1a1f36，信任蓝 accent #2563eb）
- **字体**：system sans-serif + Georgia 衬线标题（禁律后改为统一 sans-serif）
- **图标**：禁用 emoji，使用纯 CSS LogoMark（`OF` 文字标记）
- **Hero card**：左色条+圆角→顶部细线（禁律），最终回退到左色条（数据可读性优先）
- **产品名**：TOT → Ops Forge（2026-05-21 改名）

## 数据库变更记录

| 日期 | 变更 |
|---|---|
| 2026-05-21 | `chat_session` 加 `title VARCHAR(64)` 列（会话自动标题） |
