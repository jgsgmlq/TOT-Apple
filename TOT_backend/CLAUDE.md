# MVP2.0 项目助手指令

## 项目背景速读

TOT/Apple 培训任务管理系统，后端 P0 已完成（Day 1–6）。
详细进度见：`/Users/skyler/.claude/projects/-Users-skyler-Desktop-MVP2-0/memory/project_progress.md`

---

## 强制行为：代码修改后更新项目记录

**每当你在本次对话中使用了 Edit 或 Write 工具修改了代码文件，在完成该轮任务后，必须更新项目记录文件：**

```
/Users/skyler/.claude/projects/-Users-skyler-Desktop-MVP2-0/memory/project_progress.md
```

### 更新规则

1. **追加修复/变更记录**：在文件"Code Review 修复记录"或新建"变更记录"章节，追加本次修改的内容，格式：
   ```
   | 日期 | 文件 | 变更描述 |
   ```

2. **更新模块完成状态**：若有新模块完成或状态变化，更新对应表格。

3. **更新"下一步"章节**：反映当前最新的待办事项。

4. **参考追踪日志**：本轮被修改的文件路径记录在 `/tmp/mvp2_modified.log`（若存在），可用于确认修改范围。

### 不需要更新的情况

- 仅做代码阅读/分析，未执行 Edit/Write
- 仅修改了 memory 目录内的文件本身

---

## 技术栈提示

- **DB 操作全部同步**（better-sqlite3），禁止对 `db.*` 调用使用 `await`
- `requireRole` 支持字符串或数组两种入参
- `POST /assignments/batch-create` 不写 notification_events（设计如此）
- WebSocket 仅 employee/store_manager 角色可连接
