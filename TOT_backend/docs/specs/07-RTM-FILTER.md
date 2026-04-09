# RTM 下发筛选规则规格

**版本:** 2.5.0 | **PRD §6.8、术语表 RTM L3/L4** | **更新日期:** 2026-04-09

---

## 术语与分层（产品 vs 数据列）

| 概念 | 含义 | 与库表关系 |
|------|------|------------|
| **RTM L3** | P0 下发范围的一级渠道口径；PRD 固定枚举 **`Multibrand`、`Monobrand`、`Education`**（多条件间 OR） | 对应门店列 **`stores.rtm`** 的常见取值；**服务端不对 rtm 字符串做强枚举校验**，以库内实际值 + `LOWER()` 匹配为准 |
| **RTM L4 / 业态** | 看板下钻渠道口径：`Education`、`Lifestyle`、`Mass Merchant`、`Mono`、`OTC` 等 | 对应 **`stores.format`**；下发筛选可选二级条件，与看板维度同源字段 |
| **筛选路径** | 产品表述为「一级 → 二级叶子」 | 实现：**`rtm` 必填（路径内）**，**`format` 可选**；无 `format` 时仅按 `rtm` 命中该 RTM 下全部门店 |

> **`sub_rtm` 已删除**（`01-DATA-MODEL.md` v2.1.0）：筛选仅使用 **`stores.rtm` + `stores.format`**。

---

## 实现位置（与代码对齐）

- **门店集合：** `server/routes/tasks.js` 内 **`getMatchedStoreIds(task)`**（读取 `tasks.rtm_filter` / `tasks.store_scope`）。
- **目标用户：** **`getTargetUsers(storeIds)`** — `employees.store_id IN (...)`，返回该门店下**全部员工行**（与 `employees` 表一一对应账号）。
- **下发：** **`POST /api/v1/tasks/:id/dispatch`**：`matchedStoreIds.length === 0` → **400 `RTM_001`**；有门店但无员工 → **400 `TASK_006`**；含 MyPAL 任务时另需 **`mypal_task_week`** → **400 `TASK_007`**（见 `04-API-SPEC` / `01-DATA-MODEL`）。

---

## 与 PRD §6.8 的差异说明

| PRD 要求 | 当前工程 |
|---------|----------|
| 下发范围可选「仅店长」或与 RTM 组合 | **未单独建模**：dispatch 仅为命中门店下 **所有 `employees`** 建 assignment；**店长学习对象若需单独圈选，需在员工主数据或后续接口中扩展** |
| 多个 RTM L3 条件 OR | **已实现**：`rtmFilter` 数组元素之间 **`OR`**，元素内 **`rtm`（+ 可选 `format`）`AND`** |
| 筛选 0 门店阻止下发并提示 | **已实现**：`RTM_001`，文案与代码一致 |
| 大小写不敏感 | **已实现**：`LOWER(s.rtm)` / `LOWER(s.format)` |

---

## 支持的筛选值（参考）

**一级 `rtm`（与 PRD L3 及种子数据对齐）：** 至少应能覆盖 **`Multibrand`、`Monobrand`、`Education`**；种子脚本 `db/seed.js` 另含 **`Carrier`、`Enterprise`** 等，便于联调多样性。

**二级 `format`（示例；以导入数据为准，匹配时大小写不敏感）：**

| 常见 rtm（示例） | format 示例（库内可能值） | 说明 |
|------------------|---------------------------|------|
| Monobrand | `MONO`、`Lifestyle`（或 `Mono` 等） | PRD 看板 L4 写作 `Mono` / `Lifestyle` |
| Multibrand | `Mass Merchant`、`OTC` 等 | 种子环境曾用 `Operator`、`Campus` 等占位，**生产应以主数据清洗结果为准** |
| Education | `Education` 等 | 可与 rtm 同名或单独细分 |
| Carrier / Enterprise | 可空或任意 | 仅 rtm、不传 format 时命中该 rtm 下全部门店 |

---

## 筛选逻辑

### 层次一：条件内 AND

每条 `{ rtm, format? }` 表示一条路径：门店须 **`LOWER(rtm)` 一致**，若提供 **`format`** 则还须 **`LOWER(format)` 一致**。

### 层次二：条件间 OR

数组中**任意一条**路径命中即纳入门店集合。

```sql
-- 语义等价（参数化）
(LOWER(s.rtm) = LOWER(?) AND LOWER(s.format) = LOWER(?))
OR
(LOWER(s.rtm) = LOWER(?))
```

---

## `rtmFilter` / `rtm_filter` 与 `storeScope` / `store_scope` 优先级

与 **`getMatchedStoreIds`** 一致：

1. **`rtm_filter` 解析为非空数组** → 仅用 RTM 路径 SQL，**不再读取 `store_scope`**。
2. 否则若 **`store_scope === 'all'`**（字符串）→ 全部门店 `SELECT id FROM stores`。
3. 否则将 **`store_scope` 解析为门店 ID 数组** → `WHERE id IN (...)`；**空数组 → 无门店**。

创建/更新任务时，若传入 **`rtmFilter`**，元素必须含 **`rtm`**；**`format` 可选**。非法 JSON 或非数组 → **400 `TASK_005`**（见任务路由校验）。

---

## 应用层构建逻辑（与实现等价）

```javascript
function getMatchedStoreIdsFromTaskRow(task) {
  const rtmFilter = parseTaskArray(task.rtm_filter, 'rtmFilter');
  if (rtmFilter.length > 0) {
    const conditions = [];
    const params = [];
    for (const item of rtmFilter) {
      if (!item || !item.rtm) throw new Error('TASK_005 rtm required');
      conditions.push(
        item.format
          ? '(LOWER(s.rtm) = LOWER(?) AND LOWER(s.format) = LOWER(?))'
          : '(LOWER(s.rtm) = LOWER(?))'
      );
      params.push(item.rtm);
      if (item.format) params.push(item.format);
    }
    // SELECT DISTINCT s.id FROM stores s WHERE ( ... OR ... )
    return { where: conditions.join(' OR '), params };
  }
  // ... store_scope all 或 IN 列表
}
```

---

## API / DB 命名

| 语义 | DB（snake_case） | HTTP JSON（camelCase） |
|------|------------------|-------------------------|
| RTM 筛选 | `rtm_filter` | `rtmFilter` |
| 门店范围 | `store_scope` | `storeScope` |

JSON 示例（请求体）：

```json
{
  "rtmFilter": [
    { "rtm": "Monobrand", "format": "Mono" },
    { "rtm": "Education", "format": "Education" },
    { "rtm": "Carrier" }
  ]
}
```

---

## 空结果与错误码

| 场景 | HTTP | 错误码 | 说明 |
|------|------|--------|------|
| 筛选门店数为 0 | 400 | `RTM_001` | 文案：`当前筛选无门店命中，请调整筛选条件` |
| 有门店但无任何员工 | 400 | `TASK_006` | `筛选结果无目标员工` |
| `rtmFilter` 条目缺 `rtm` 等 | 400 | `TASK_005` | 创建/更新任务时校验 |

错误响应体格式以 **`04-API-SPEC.md`「通用错误体」** 为准（非旧版 `{ "error": ... }` 示例）。

---

## 下发目标用户

```sql
SELECT id AS user_id, store_id
FROM employees
WHERE store_id IN (:matchedStoreIds);
```

---

## 幂等下发

```sql
INSERT OR IGNORE INTO task_assignments
  (id, task_id, user_id, store_id, status, progress, nudge_count, created_at, updated_at)
VALUES (?, ?, ?, ?, 'pending', 0, 0, ?, ?);
-- UNIQUE(task_id, user_id)
```

（列以 `server/db/schema.sql` 为准。）

---

## 数据质量与种子数据

1. 生产导入前建议统一 **`stores.rtm` / `stores.format`** 与产品 L3/L4 口径。
2. 实现层已用 **`LOWER()`** 兜底，仍建议主数据一致。
3. **`db/seed.js`** 中 `FORMATS` 含 `MONO`、`Lifestyle`、`Mass Merchant`、`Operator`、`Campus` 等，**与 PRD 看板 L4 列表不必逐字相同**，联调时以实际 seed 行为为准。

---

## 与数据模型一致性

以 **`01-DATA-MODEL.md`**（`tasks.rtm_filter` / `tasks.store_scope` 的 `json_valid` + `array` 约束）及本节为下发筛选的单一事实来源；**HTTP 契约**以 **`04-API-SPEC.md`** 任务与下发章节为准。

---

## 文档维护

| 版本 | 日期 | 变更 |
|------|------|------|
| 2.4.0 | 2026-03-27 | sub_rtm 移除、双命名、SQL 模板 |
| 2.5.0 | 2026-04-09 | 对齐 PRD §6.8 / L3·L4 术语；`routes/tasks.js` 实现路径；店长范围缺口；错误码与 schema；种子 format 说明；修正 task_assignments 插入示例 |
