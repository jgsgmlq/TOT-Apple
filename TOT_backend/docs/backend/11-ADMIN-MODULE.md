# C — Admin + MyPal 模块 技术审计

> 日期：2026-05-13 | 分支：modular-base | 审查范围：`modules/admin/` + `modules/mypal/`

---

## 1. 目录结构总览

```
modules/admin/
├── crud/
│   ├── accountCrud.js                 # 88行，8函数 ✅
│   ├── storeCrud.js                   # 44行，7函数 ✅
│   ├── learnerCrud.js                 # 28行，4函数 ✅
│   └── dictCrud.js                    # 35行，6函数 ✅
├── services/
│   ├── authService.js                 # 101行，3函数，零SQL ✅
│   ├── accountService.js              # 12行，6函数，薄透传 ✅
│   ├── storeService.js                # 11行，5函数，薄透传 ✅
│   ├── learnerService.js              # 10行，4函数，薄透传 ✅
│   └── dictService.js                 # 11行，5函数，薄透传+校验 ✅
├── routes/
│   ├── authRoutes.js                  # 39行，3端点 ✅
│   ├── accountRoutes.js               # ✅
│   ├── storeRoutes.js                 # 23行，3端点 ✅
│   ├── learnerRoutes.js               # ✅
│   └── dictRoutes.js                  # ✅

modules/mypal/
├── crud/
│   └── mypalCrud.js                   # 28行，5函数 ✅
├── services/
│   └── mypalService.js                # 172行，7函数，零SQL ✅
└── routes/
    └── mypalRoutes.js                 # ✅
```

### 行数统计

| 模块 | 文件 | 行数 | 状态 |
|------|------|------|------|
| admin | accountCrud.js | 88 | ✅ |
| | storeCrud.js | 44 | ✅ |
| | learnerCrud.js | 28 | ✅ |
| | dictCrud.js | 35 | ✅ |
| | authService.js | 101 | ✅ |
| | accountService.js | 12 | ✅ |
| | storeService.js | 11 | ✅ |
| | learnerService.js | 10 | ✅ |
| | dictService.js | 11 | ✅ |
| | authRoutes.js | 39 | ✅ |
| | 其余 routes | — | ✅ |
| mypal | mypalCrud.js | 28 | ✅ |
| | mypalService.js | 172 | ✅ |
| | mypalRoutes.js | — | ✅ |
| common | auditCrud.js | — | ✅ |
| **合计** | | **~579** | |

---

## 2. 三层架构合规检查

### 2.1 Route 层

| 文件 | SQL | 调Service | 角色控制 | 统一响应 |
|------|-----|-----------|----------|----------|
| authRoutes.js | 0 | authService | authenticate | success() |
| storeRoutes.js | 0 | storeService | requireRole | success() |
| 其余 routes | 0 | 对应service | authenticate/requireRole | — |
| mypalRoutes.js | 0 | mypalService | authenticate | — |

**结论**：Route 层全部零 SQL，使用 responseHelper。角色校验正确。

### 2.2 Service 层

| 文件 | SQL | 依赖 | 状态 |
|------|-----|------|------|
| authService.js | 0 | accountCrud + auth middleware + errorCodes | ✅ |
| accountService.js | 0 | accountCrud | ✅ 薄透传+校验 |
| storeService.js | 0 | storeCrud | ✅ 薄透传+not-found |
| learnerService.js | 0 | learnerCrud | ✅ 薄透传+not-found |
| dictService.js | 0 | dictCrud | ✅ 薄透传+校验 |
| mypalService.js | 0 | mypalCrud + admin/learnerCrud | ✅ |

**authService.js** — 唯一有实质业务逻辑的 admin service：
- 双重密码校验（bcrypt 优先，明文兜底）
- JWT 签发（7天过期）
- 密码修改（bcrypt 哈希，最小长度校验）
- 登录时间记录（lastLoginAt, firstLoginDate）

**accountService.js** — 薄透传，但 createAccount 中有去重校验（emailId 唯一性检查）。

**mypalService.js** — 合并 4 个旧文件为 1 个，是合并最成功的案例：
- HMAC-SHA256 签名
- HTTP 调用 + AbortController 超时
- 分页同步编排（page loop + 1.1s 间隔）
- 跨模块调 admin 的 learnerCrud 做邮箱匹配

### 2.3 Crud 层

**全部使用新表名，无旧表名残留。**

| Crud | 表 | 函数数 | 写操作 |
|------|-----|--------|--------|
| accountCrud.js | account | 8 | create, update, delete, updateLastLogin, updateFirstLogin |
| storeCrud.js | reseller_headquarter + reseller_store | 7 | 无（纯读） |
| learnerCrud.js | learner_account | 4 | 无（纯读） |
| dictCrud.js | dictionary | 6 | create, update, delete |
| mypalCrud.js | mypal_learning_progress_sync + audit_log | 5 | upsert, insert audit |

---

## 3. 问题清单

### 3.1 HIGH

**H1 — 旧文件未改桩**

5 个旧文件仍为完整代码：
```
routes/auth.js (120行)
routes/stores.js (101行)
routes/employees.js (142行)
routes/mypal.js (36行)
routes/mypalMock.js (175行)
```

**H2 — app.js 17 处引用路径未切换**

旧路径 → 新路径的映射表已就绪（见进度文档），但实际切换尚未执行。当前 app.js 仍加载旧 `routes/*` 路径。

### 3.2 MEDIUM

**M1 — storeService / learnerService 太薄**

两个 service 几乎是一对一透传 crud，唯一的业务逻辑是 not-found 抛异常。如果未来没有更多业务规则，可考虑 route 直接调 crud（但违反三层架构）。

**M2 — accountCrud.js 使用 `var` + `.apply()` 模式**

```js
var getDb = require('../../common/db/connection').getDb;
// ...
.all.apply(null, p.concat([d.limit || 50, d.offset || 0]));
```

应改为 `const` + 展开运算符。

**M3 — authService 明文密码兜底**

```js
if (!match && password !== account.login_password) {
```
bcrypt 比较失败后用明文再比一次。这是历史兼容逻辑，应在所有账户迁移到 bcrypt 后移除。

### 3.3 LOW

**L1 — 全部 crud 使用 `var`** — 应全局替换为 `const`

**L2 — storeCrud.js 单行函数** — `getHqList` 等函数写在一行，可读性差

**L3 — storeCrud 只有读操作** — 缺少 create/update/delete，门店管理需要手动写 SQL

---

## 4. 跨模块依赖

### 4.1 C 提供给 A 和 B 的只读接口

```
accountCrud.getAccountById(id)
accountCrud.getAccountByEmail(email)
accountCrud.getAccountList({ role })
storeCrud.getStoreList({ region, format, dealer })
storeCrud.getStoreByAppleId(appleId)
storeCrud.getHqList()
learnerCrud.getLearnerList({ storeId })
learnerCrud.getLearnerByEmail(email)
```

### 4.2 mypalService 对 admin 的依赖

```
mypalService.resolveLearnerByEmail() → learnerCrud.getLearnerByEmail()
```

这是唯一跨 service 调 crud（符合规范：模块间只调 crud）。

### 4.3 依赖关系图

```
┌──────────────────────────────┐
│        C: Admin + MyPal      │
│                              │
│ accountCrud ─────────────────┼── account 表 ✅
│ storeCrud ───────────────────┼── reseller_headquarter/store ✅
│ learnerCrud ─────────────────┼── learner_account ✅
│ dictCrud ────────────────────┼── dictionary ✅
│ mypalCrud ───────────────────┼── mypal_learning_progress_sync ✅
│                              │
│ authService ─────────────────┼── 调accountCrud ✅
│ accountService ──────────────┼── 调accountCrud ✅
│ storeService ────────────────┼── 调storeCrud ✅
│ learnerService ──────────────┼── 调learnerCrud ✅
│ dictService ─────────────────┼── 调dictCrud ✅
│ mypalService ────────────────┼── 调mypalCrud + learnerCrud ✅
│                              │
│ 所有 routes ─────────────────┼── 调对应service，零SQL ✅
└──────────────────────────────┘
        │
        │  被 A, B 只读引用
        ▼
   ┌──────────┐  ┌──────────────┐
   │Dashboard │  │ Task Publish │
   └──────────┘  └──────────────┘
```

---

## 5. 修复路径

### 第一步：代码风格修复（~30分钟）

```
C1. 全部 crud 文件 var → const
C2. .apply() → 展开运算符
C3. storeCrud.js 单行函数拆分多行
```

### 第二步：旧文件改桩（~1小时）

```
C4. routes/auth.js      → re-export admin/routes/authRoutes
C5. routes/stores.js    → re-export admin/routes/storeRoutes
C6. routes/employees.js → re-export admin/routes/learnerRoutes
C7. routes/mypal.js     → re-export mypal/routes/mypalRoutes
C8. routes/mypalMock.js → re-export mypal/routes/mypalRoutes (mock逻辑已内聚)
```

### 第三步：app.js 路径切换（~2小时）

```
C9. 17处 require 路径从旧 routes/* 改为 modules/* 新路径
C10. 启动验证 + 认证/权限回归测试
```

### 第四步：安全加固（~1小时）

```
C11. authService 移除明文密码兜底（确认所有账户已 bcrypt 后）
C12. 敏感字段脱敏（password 不在日志/响应中出现）
```

---

## 6. 与旧代码的对照

| 旧文件 | 行数 | 新文件 | 状态 |
|--------|------|--------|------|
| routes/auth.js | 120 | authService + authRoutes | ✅ |
| routes/stores.js | 101 | storeCrud + storeService + storeRoutes | ✅ |
| routes/employees.js | 142 | learnerCrud + learnerService + learnerRoutes | ✅ |
| routes/mypal.js | 36 | mypalRoutes | ✅ |
| routes/mypalMock.js | 175 | mypalRoutes（mock逻辑内聚） | ✅ |
| services/mypalSyncService.js | 249 | mypalService | ✅ |
| services/mypalClient.js | 150 | mypalService | ✅ |
| services/mypalLink.js | 33 | mypalService | ✅ |
| services/mypalSign.js | 25 | mypalService | ✅ |

**Admin+MyPal 是三个模块中迁移完成度最高的** — 全部新文件已就位且符合三层架构，仅剩旧文件改桩和 app.js 切换两项收尾工作。
