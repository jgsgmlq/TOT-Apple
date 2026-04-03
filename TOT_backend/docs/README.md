# MVP 项目文档中心

**最后更新:** 2026-03-24
**文档版本:** 1.1
**适用于:** AI、开发者、测试人员

---

## 📖 文档导航地图

### 🚀 新人快速上手（15 分钟）

如果你是第一次接触这个项目，按以下顺序阅读：

1. **[PROJECT_OVERVIEW.md](product/PROJECT_OVERVIEW.md)** (5 分钟)
   - 项目是什么？
   - 核心业务流程
   - 项目文件结构

2. **[QUICK_START.md](tests/QUICK_START.md)** (5 分钟)
   - 如何本地启动？
   - 如何测试完整流程？
   - 常见问题排查

3. **[ARCHITECTURE.md](backend/ARCHITECTURE.md)** (10 分钟)
   - 系统怎么设计的？
   - 数据怎么流动的？
   - 核心服务是什么？

---

## 🗂️ 分类入口

- 产品：[`product/index.md`](product/index.md)
- Spec：[`specs/index.md`](specs/index.md)
- 前端：[`frontend/index.md`](frontend/index.md)
- 后端：[`backend/index.md`](backend/index.md)
- 测试：[`tests/index.md`](tests/index.md)

---

## 📚 按用途查找文档

### 我是前端开发者

**目标:** 理解前端实现，维护三个页面

📖 **推荐阅读顺序:**
1. [04-API-SPEC.md](specs/04-API-SPEC.md) - 了解所有 API 接口
2. [frontend/04-SHARED.md](frontend/04-SHARED.md) - auth.js / api.js / ws.js 公共模块
3. [QUICK_START.md](tests/QUICK_START.md) - 本地测试和调试

**关键问题回答:**
- Q: "我需要调用哪些 API?"
  A: 查看 [04-API-SPEC.md](specs/04-API-SPEC.md) 第 2-3 章（任务和分配 API）

- Q: "员工进度更新后，怎么让店长和总部实时看到?"
  A: 查看 [04-WEBSOCKET.md](backend/04-WEBSOCKET.md)（WebSocket 广播机制）

- Q: "前端各页面状态和 API 对应关系是什么?"
  A: 查看 [frontend/01-CENTRAL.md](frontend/01-CENTRAL.md)、[03-EMPLOYEE.md](frontend/03-EMPLOYEE.md)

---

### 我是后端开发者

**目标:** 理解系统架构，维护和扩展后端服务

📖 **推荐阅读顺���:**
1. [ARCHITECTURE.md](backend/ARCHITECTURE.md) - 系统设计和数据流
2. [specs/01-DATA-MODEL.md](specs/01-DATA-MODEL.md) - 数据库结构
3. [04-API-SPEC.md](specs/04-API-SPEC.md) - API 约定

**关键问题回答:**
- Q: "任务和分配的关系是什么?"
  A: 查看 [specs/01-DATA-MODEL.md](specs/01-DATA-MODEL.md)

- Q: "如何优化性能?"
  A: 查看 [ARCHITECTURE.md](backend/ARCHITECTURE.md)

- Q: "如何添加新的 API?"
  A: 查看 [ARCHITECTURE.md](backend/ARCHITECTURE.md) 第 5 章（API 规范）

---

### 我是产品经理或测试人员

**目标:** 理解系统功能，进行测试和验证

📖 **推荐阅读顺序:**
1. [PROJECT_OVERVIEW.md](product/PROJECT_OVERVIEW.md) - 了解项目目标和流程
2. [QUICK_START.md](tests/QUICK_START.md) - 了解如何测试完整场景
3. [04-API-SPEC.md](specs/04-API-SPEC.md) - 了解系统能做什么

**测试场景:**
- Q: "如何测试员工更新进度?"
  A: 查看 [QUICK_START.md](tests/QUICK_START.md) 第 4 章

- Q: "系统支持哪些角色?"
  A: 系统当前角色：central（总部）、employee（店员）、executive（高管）、admin（管理员）

---

### 我是系统架构师

**目标:** 理解整体架构，规划扩展和优化

📖 **推荐阅读顺序:**
1. [ARCHITECTURE.md](backend/ARCHITECTURE.md) - 完整的系统设计
2. [specs/01-DATA-MODEL.md](specs/01-DATA-MODEL.md) - 数据库设计和扩展性考虑
3. [BACKEND_IMPLEMENTATION_REPORT.md](backend/BACKEND_IMPLEMENTATION_REPORT.md) - 后端实现细节

**架构决策参考:**
- Q: "系统能支持多少用户?"
  A: 查看 [ARCHITECTURE.md](backend/ARCHITECTURE.md)

- Q: "如何支持未来的扩展?"
  A: 查看 [ARCHITECTURE.md](backend/ARCHITECTURE.md)

---

## 🗂️ 文档完整目录

### 核心文档（必读）

| 文档 | 完成度 | 说明 |
|------|--------|------|
| [product/PROJECT_OVERVIEW.md](product/PROJECT_OVERVIEW.md) | ✅ 100% | 项目全景和导航 |
| [backend/ARCHITECTURE.md](backend/ARCHITECTURE.md) | ✅ 100% | 系统设计和数据流 |
| [specs/04-API-SPEC.md](specs/04-API-SPEC.md) | ✅ 100% | 完整 API 参考 |
| [specs/01-DATA-MODEL.md](specs/01-DATA-MODEL.md) | ✅ 100% | 数据库设计 |
| [tests/QUICK_START.md](tests/QUICK_START.md) | ✅ 100% | 快速启动和测试 |

### 前端文档

| 文档 | 完成度 | 说明 |
|------|--------|------|
| [frontend/04-SHARED.md](frontend/04-SHARED.md) | ✅ 100% | 公共模块（auth / api / ws） |
| [frontend/01-CENTRAL.md](frontend/01-CENTRAL.md) | ✅ 100% | 总部看板页（central.html） |
| [frontend/03-EMPLOYEE.md](frontend/03-EMPLOYEE.md) | ✅ 100% | 员工移动端（employee.html） |

### 补充文档

| 文档 | 完成度 | 说明 |
|------|--------|------|
| [backend/BACKEND_IMPLEMENTATION_REPORT.md](backend/BACKEND_IMPLEMENTATION_REPORT.md) | ✅ 100% | 后端开发完成报告 |
| [specs/05-NOTIFICATION-NUDGE.md](specs/05-NOTIFICATION-NUDGE.md) | ✅ 100% | 通知与催办规范 |
| [specs/02-STATE-MACHINES.md](specs/02-STATE-MACHINES.md) | ✅ 100% | 状态机定义 |

---

## 🎯 常见查询速解

### "我不知道从哪开始..."
→ 从 [PROJECT_OVERVIEW.md](product/PROJECT_OVERVIEW.md) 开始，5 分钟快速了解项目

### "如何启动后端?"
→ 查看 [QUICK_START.md](tests/QUICK_START.md) 第 2 章

### "API 怎么调用?"
→ 查看 [04-API-SPEC.md](specs/04-API-SPEC.md)

### "数据库表是什么?"
→ 查看 [specs/01-DATA-MODEL.md](specs/01-DATA-MODEL.md)

### "如何做前后端集成?"
→ 查看 [frontend/04-SHARED.md](frontend/04-SHARED.md)（公共模块）

### "系统架构怎么设计的?"
→ 查看 [ARCHITECTURE.md](backend/ARCHITECTURE.md)

### "性能��标是什么?"
→ 查看 [04-API-SPEC.md](specs/04-API-SPEC.md) 第 8 章

### "支持哪些角色?"
→ 系统当前角色：central（总部）、employee（店员）、executive（高管）、admin（管理员）

---

## 📊 文档统计

- **总文档数:** 13 份
- **核心文档:** 6 份（完全新建）
- **总字数:** 约 20,000 字
- **平均阅读时间:** 45 分钟（全部）
- **最快上手时间:** 15 分钟（快速路径）

---

## 🔄 文档维护规则

### 更新触发条件

以下情况发生时，应更新相应文档：

1. **新增功能** → 更新 [04-API-SPEC.md](specs/04-API-SPEC.md)
2. **修改数据库** → 更新 [specs/01-DATA-MODEL.md](specs/01-DATA-MODEL.md)
3. **架构改变** → 更新 [ARCHITECTURE.md](backend/ARCHITECTURE.md)
4. **启动流程变化** → 更新 [QUICK_START.md](tests/QUICK_START.md)

### 版本控制

所有文档头部包含版本号和更新日期：
```
**文档版本:** 1.0.0
**最后更新:** 2026-03-18
```

---

## 🤝 贡献者指南

### 如何贡献文档？

1. **提出问题** - 在 GitHub Issues 中提出文档改进建议
2. **更新文档** - 编辑对应的 .md 文件
3. **验证准确性** - 确保文档与代码保持同步
4. **更新版本号** - 修改文档头部的版本和日期
5. **提交 PR** - 创建 Pull Request

### 文档风格指南

- **语言:** 中文，技术术语英文
- **结构:** 标题 → 概述 → 详情 → 示例 → 总结
- **代码示例:** 包含输入和预期输出
- **表格:** 用于对比和总结
- **链接:** 内部链接用相对路径 `[text](file.md)`

---

## 📞 获取帮助

### 常见问题未解决?

1. 搜索所有文档（Ctrl+F）
2. 查看 [QUICK_START.md](tests/QUICK_START.md) 第 8 章（故障排查）
3. 查看项目代码中的注释

### 文档有错误或不清楚?

- 在 GitHub 创建 Issue
- 详细说明：哪篇文档？哪个章节？什么问题？

---

## 📚 相关资源

- **代码仓库:** `/Users/skyler/Desktop/MVP/`
- **API 演练场:** Postman 或 curl
- **数据库浏览:** SQLite Studio
- **Git 历史:** `git log --oneline` 查看所有 commit

---

## ✅ 下一步

### 对于 AI/新开发者
- [ ] 阅读 [PROJECT_OVERVIEW.md](product/PROJECT_OVERVIEW.md)
- [ ] 本地启动项目（[QUICK_START.md](tests/QUICK_START.md)）
- [ ] 了解 API（[04-API-SPEC.md](specs/04-API-SPEC.md)）
- [ ] 按需深入相关文档

### 对于前端开发
- [x] Phase 2a–2d 前端 API 集成已完成
- [x] 三个角色端到端测试通过
- [ ] UI/UX 优化（下一阶段）

### 对于后端维护
- [ ] 定期检查文档是否与代码同步
- [ ] 新功能完成后及时更新 [04-API-SPEC.md](specs/04-API-SPEC.md)
- [ ] 大变更时更新 ARCHITECTURE.md

---

**文档中心维护者:** Backend & AI Team
**最后更新:** 2026-03-24
**下次计划更新:** 功能完成后或每月定期

---

💡 **建议:** 将此文档收藏为浏览器书签，便于快速访问！
