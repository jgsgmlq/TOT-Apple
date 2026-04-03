# 文档整理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除 3 个已标注为历史的过时文档，修复 4 个文档中的已知错误内容（错误路径/端口/命令/角色引用）。

**Architecture:** 纯文档操作——文件删除 + 文件内容编辑。无代码变更，无测试需求。每个任务独立，可按任意顺序执行，执行后立即提交。

**Tech Stack:** git, markdown 文件编辑

---

## File Map

| 操作 | 文件 |
|------|------|
| 删除 | `TOT_backend/docs/backend/ARCHITECTURE.md` |
| 删除 | `TOT_backend/docs/backend/BACKEND_IMPLEMENTATION_REPORT.md` |
| 删除 | `TOT_backend/docs/frontend/FRONTEND_SYSTEM_BEHAVIOR.md` |
| 修改 | `TOT_backend/docs/tests/QUICK_START.md` |
| 修改 | `TOT_backend/docs/README.md` |
| 修改 | `TOT_backend/docs/frontend/index.md` |
| 修改 | `TOT_backend/docs/backend/index.md` |

---

### Task 1: 删除 3 个历史文档

**Files:**
- Delete: `TOT_backend/docs/backend/ARCHITECTURE.md`
- Delete: `TOT_backend/docs/backend/BACKEND_IMPLEMENTATION_REPORT.md`
- Delete: `TOT_backend/docs/frontend/FRONTEND_SYSTEM_BEHAVIOR.md`

- [ ] **Step 1: 确认文件存在**

```bash
ls TOT_backend/docs/backend/ARCHITECTURE.md \
   TOT_backend/docs/backend/BACKEND_IMPLEMENTATION_REPORT.md \
   TOT_backend/docs/frontend/FRONTEND_SYSTEM_BEHAVIOR.md
```

Expected: 三个文件路径各自列出，无报错。

- [ ] **Step 2: 删除文件**

```bash
git rm TOT_backend/docs/backend/ARCHITECTURE.md \
       TOT_backend/docs/backend/BACKEND_IMPLEMENTATION_REPORT.md \
       TOT_backend/docs/frontend/FRONTEND_SYSTEM_BEHAVIOR.md
```

Expected:
```
rm 'TOT_backend/docs/backend/ARCHITECTURE.md'
rm 'TOT_backend/docs/backend/BACKEND_IMPLEMENTATION_REPORT.md'
rm 'TOT_backend/docs/frontend/FRONTEND_SYSTEM_BEHAVIOR.md'
```

- [ ] **Step 3: 提交**

```bash
git commit -m "docs: delete 3 historical/outdated docs (architecture, backend report, frontend behavior)"
```

---

### Task 2: 修复 docs/tests/QUICK_START.md 中的错误路径/端口/命令

**Files:**
- Modify: `TOT_backend/docs/tests/QUICK_START.md`

背景：该文件写于旧版本，有三处错误：
1. 路径写的是 `/Users/skyler/Desktop/MVP/server`（旧用户名 + 旧目录结构），应为 `TOT_backend/server`（相对仓库根）
2. 端口 `8080` 实际现在是 `3000`
3. 启动命令 `npm start` 应为 `npm run dev`（对应 `node --watch app.js`）

- [ ] **Step 1: 读取文件确认行号**

阅读 `TOT_backend/docs/tests/QUICK_START.md` 全文，定位所有出现 `/Users/skyler/Desktop/MVP/server`、`8080`、`npm start` 的行。

- [ ] **Step 2: 替换错误路径**

将文件中所有 `/Users/skyler/Desktop/MVP/server` 替换为 `TOT_backend/server`（在仓库根目录下的相对路径）。

- [ ] **Step 3: 替换端口**

将文件中所有端口 `8080` 替换为 `3000`。
同时将示例 URL `http://localhost:8080` 替换为 `http://localhost:3000`。

- [ ] **Step 4: 替换启动命令**

将 `npm start` 替换为 `npm run dev`。

注意：`server/package.json` 中 `"dev": "node --watch app.js"`，`"start"` 用于生产。开发环境文档应使用 `npm run dev`。

- [ ] **Step 5: 验证修改结果**

```bash
grep -n "skyler\|8080\|npm start" TOT_backend/docs/tests/QUICK_START.md
```

Expected: 无输出（无残留旧内容）。

- [ ] **Step 6: 提交**

```bash
git add TOT_backend/docs/tests/QUICK_START.md
git commit -m "docs: fix QUICK_START path/port/command errors (8080→3000, skyler path→TOT_backend/server, npm start→npm run dev)"
```

---

### Task 3: 修复 docs/README.md 中的 store_manager 引用

**Files:**
- Modify: `TOT_backend/docs/README.md`

背景：该文件中有两处与已移除的 `store_manager` 角色相关的内容：
1. 用户规模统计写着 "50 个门店 × 5 名员工 = 250 名员工 + 50 名店长"——store_manager 角色已移除
2. 前端开发者导航部分引用 `frontend/02-STORE.md` 为活跃文档

- [ ] **Step 1: 定位并删除 store_manager 统计描述**

在文件中找到以下内容（出现在 "支持多少用户？" 的回答处）：
```
50 个门店 × 5 名员工 = 250 名员工 + 50 名店长
```
替换为：
```
系统当前角色：central（总部）、employee（店员）、executive（高管）、admin（管理员）
```

- [ ] **Step 2: 移除前端文档导航中对 02-STORE.md 的活跃引用**

找到前端开发者导航中引用 `[frontend/02-STORE.md](frontend/02-STORE.md)` 或类似链接的行，删除或改为注释说明该文档已归入历史。

- [ ] **Step 3: 验证修改**

```bash
grep -n "shop_manager\|store_manager\|店长\|02-STORE" TOT_backend/docs/README.md
```

Expected: 无指向活跃文档的 store_manager 描述（若有历史备注可保留，但不应作为导航链接）。

- [ ] **Step 4: 提交**

```bash
git add TOT_backend/docs/README.md
git commit -m "docs: remove store_manager role references from README (role removed)"
```

---

### Task 4: 更新 docs/frontend/index.md — 将 02-STORE.md 移入历史分区

**Files:**
- Modify: `TOT_backend/docs/frontend/index.md`

当前文件内容：
```markdown
| [02-STORE.md](./02-STORE.md) | store.html 店长移动端（Phase 2c）| ✅ |
```
需移入"历史文档"分区，并加 ⚠️ 说明。

- [ ] **Step 1: 从活跃表格中移除 02-STORE.md 行**

删除文档列表表格中的以下行：
```
| [02-STORE.md](./02-STORE.md) | store.html 店长移动端（Phase 2c）| ✅ |
```

- [ ] **Step 2: 在"历史文档"分区加入 02-STORE.md**

找到文件末尾的 `## 历史文档（已过时）` 分区，在现有条目下追加：
```markdown
- [02-STORE.md](./02-STORE.md) — 店长移动端页实现指南（store_manager 角色已从当前系统移除）
```

- [ ] **Step 3: 验证**

```bash
grep -n "02-STORE" TOT_backend/docs/frontend/index.md
```

Expected: 只出现在历史文档分区，不出现在活跃文档表格中。

- [ ] **Step 4: 提交**

```bash
git add TOT_backend/docs/frontend/index.md
git commit -m "docs: move 02-STORE.md to historical section (store_manager role removed)"
```

---

### Task 5: 更新 docs/backend/index.md — 移除已删除文件的历史引用

**Files:**
- Modify: `TOT_backend/docs/backend/index.md`

当前文件"历史文档"分区包含对 Task 1 中已删除文件的引用：
```markdown
## 历史文档（已过时）

- [ARCHITECTURE.md](./ARCHITECTURE.md) — 旧版架构设计（基于 2026-03-18，仅供参考）
- [BACKEND_IMPLEMENTATION_REPORT.md](./BACKEND_IMPLEMENTATION_REPORT.md) — 旧版实现报告
```

文件删除后这些链接会失效，需清理。

- [ ] **Step 1: 删除或更新历史文档分区**

将"历史文档"整个分区替换为简短说明：
```markdown
## 历史文档

> 2026-03-18 版本的旧版架构设计（ARCHITECTURE.md）与实现报告（BACKEND_IMPLEMENTATION_REPORT.md）已于 2026-04-04 从仓库中删除，可通过 git history 查阅。
```

- [ ] **Step 2: 验证无失效链接**

```bash
grep -n "ARCHITECTURE\|BACKEND_IMPLEMENTATION" TOT_backend/docs/backend/index.md
```

Expected: 仅出现在上述 git history 提示中，不以 markdown 链接形式出现。

- [ ] **Step 3: 提交**

```bash
git add TOT_backend/docs/backend/index.md
git commit -m "docs: update backend/index.md, replace broken links to deleted historical docs"
```

---

## 验收检查

所有 Task 完成后运行：

```bash
# 确认 3 个文件已删除
ls TOT_backend/docs/backend/ARCHITECTURE.md 2>&1 | grep "No such file"
ls TOT_backend/docs/backend/BACKEND_IMPLEMENTATION_REPORT.md 2>&1 | grep "No such file"
ls TOT_backend/docs/frontend/FRONTEND_SYSTEM_BEHAVIOR.md 2>&1 | grep "No such file"

# 确认无旧路径/端口残留
grep -rn "8080\|/Users/skyler/Desktop/MVP/server\|npm start" TOT_backend/docs/

# 确认无 store_manager 活跃导航引用
grep -rn "02-STORE.md" TOT_backend/docs/README.md TOT_backend/docs/frontend/index.md
```

Expected for last command: `README.md` 无引用；`frontend/index.md` 中仅出现在历史文档分区行。
