# RTM 下发筛选规则规格

**版本:** 2.4.0 | **PRD §6.10** | **更新日期:** 2026-03-27

---

## 筛选路径层级

```
RTM（一级）→ 业态值 format（二级，叶子节点）
```

> 说明：`sub_rtm` 已在 `stores` 表中删除（见 `01-DATA-MODEL.md` v2.1.0 变更），RTM 筛选只使用 `stores.rtm` + `stores.format`。

---

## 支持的筛选值

| RTM | 业态值 format | stores.format 匹配值（大小写不敏感） |
|-----|---------------|--------------------------------------|
| Monobrand | MONO | Mono |
| Monobrand | Lifestyle | Lifestyle |
| Multibrand | Mass Merchant | Mass Merchant |
| Multibrand | OTC | OTC |
| Multibrand | Township | Township |
| Multibrand | Duty Free | Duty Free |
| Carrier | （可空） | 暂无匹配数据 |
| Education | Education | Education |
| Enterprise | （可空） | 暂无匹配数据 |

> 规则：
> - `rtm` 必填，对应 `stores.rtm`
> - `format` 选填，对应 `stores.format`
> - 若某 RTM 下暂无 format 叶子节点（如 Carrier / Enterprise），可只按 `rtm` 过滤

---

## 筛选逻辑

### 层次一：条件内 AND（路径内同时满足）

每个叶子节点代表一条完整路径，门店必须**同时满足**该路径上所有层级的值才算命中此条件。

示例：条件 `{ rtm: "Monobrand", format: "MONO" }` 要求：
```
stores.rtm = 'Monobrand' AND stores.format = 'MONO'
```

### 层次二：条件间 OR（多条件取并集）

总部勾选多个叶子节点时，满足**任意一个**条件的门店均命中。

示例：同时勾选 MONO 和 Education：
```
(stores.rtm = 'Monobrand' AND stores.format = 'MONO')
OR
(stores.rtm = 'Education' AND stores.format = 'Education')
```

---

## 大小写不敏感匹配

所有 format 字段匹配使用 `LOWER()` 兜底，防止数据清洗不一致：

```sql
LOWER(stores.format) = LOWER(:format)
```

特别注意：PRD 中 MONO 的展示值是大写，但门店表原值可能是 `Mono`，必须用 `LOWER()` 比较。

---

## rtm_filter / rtmFilter 数据结构

```json
{
  "rtm_filter": [
    { "rtm": "Monobrand", "format": "MONO" },
    { "rtm": "Education", "format": "Education" },
    { "rtm": "Carrier" }
  ]
}
```

与 `tasks` 表字段一致（见 `01-DATA-MODEL.md`）：
- `tasks.rtm_filter`: JSON 数组或 `null`
- `tasks.store_scope`: `"all"` 或 JSON 数组（仅当 `rtm_filter` 为空时生效）

字段约束口径（与 `01-DATA-MODEL.md v2.4.0` 一致）：
- `rtm_filter`: `NULL` 或合法 JSON 数组（`json_valid` + `json_type='array'`）
- `store_scope`: `'all'` 或合法 JSON 数组（`json_valid` + `json_type='array'`）

API/UI 命名对照（本规格同时支持两种写法说明）：

| 语义 | DB 字段（snake_case） | API/UI 字段（camelCase） |
|------|------------------------|---------------------------|
| RTM 筛选 | `rtm_filter` | `rtmFilter` |
| 门店范围 | `store_scope` | `storeScope` |

---

## SQL 实现

```javascript
/**
 * 根据 rtm_filter 构建门店筛选 SQL 条件
 * @param {Array} rtmFilter - [{rtm, format?}, ...]
 * @returns {string} SQL WHERE 子句（不含 WHERE 关键字）
 */
function buildRtmFilterSQL(rtmFilter) {
  if (!rtmFilter || rtmFilter.length === 0) {
    return '1=1'; // 无筛选条件，命中所有
  }

  const conditions = rtmFilter.map(f => {
    const parts = [`LOWER(s.rtm) = LOWER(?)`]; // rtm 必填
    if (f.format) {
      parts.push(`LOWER(s.format) = LOWER(?)`); // format 选填
    }
    return `(${parts.join(' AND ')})`;
  });

  return conditions.join(' OR ');
}

/**
 * 构建对应的参数数组
 */
function buildRtmFilterParams(rtmFilter) {
  const params = [];
  for (const f of rtmFilter) {
    params.push(f.rtm);
    if (f.format) {
      params.push(f.format);
    }
  }
  return params;
}

// 完整查询示例
const sql = `
  SELECT DISTINCT s.id AS store_id
  FROM stores s
  WHERE ${buildRtmFilterSQL(rtmFilter)}
`;
const params = buildRtmFilterParams(rtmFilter);
const matchedStores = db.prepare(sql).all(...params);
```

---

## rtm_filter / rtmFilter 与 store_scope / storeScope 优先级

```
const hasRtmFilter = (rtmFilter && rtmFilter.length > 0) || (rtm_filter && rtm_filter.length > 0);
if (hasRtmFilter) {
  // 使用 RTM 筛选逻辑（上方 SQL）
} else if (storeScope === 'all' || store_scope === 'all') {
  // 全部门店：SELECT id FROM stores
} else {
  // storeScope/store_scope 是 JSON 数组：SELECT id FROM stores WHERE id IN (...)
}
```

> 服务端建议：在进入筛选逻辑前先做字段合法性校验（JSON 结构），与 DB 约束保持同一口径，尽早失败（fail-fast）。

---

## 空结果处理

当 `rtm_filter`（或 `rtmFilter`）筛选结果为 0 家门店时：

**服务端:**
```json
HTTP 400
{
  "error": "当前筛选无门店命中，请调整筛选条件",
  "errorCode": "RTM_001"
}
```

**前端展示:**
- 创建任务时，提供"下发预览"功能：用户选择 rtmFilter 后，立即显示"将命中 X 家门店，Y 人"
- 命中数为 0 时，禁用"下发"按钮，展示提示文案

---

## 请求校验（建议）

在创建/下发任务接口，建议按以下顺序校验：

2. `rtmFilter/rtm_filter` 若传入，必须是数组；数组元素必须包含 `rtm`，`format` 可选
3. `storeScope/store_scope` 仅允许 `'all'` 或门店 ID 数组
4. 若 `rtmFilter/rtm_filter` 非空，优先使用 RTM 结果，忽略 `storeScope/store_scope` 内容
5. 若筛选命中门店数为 0，返回 `RTM_001`

---

## 下发目标用户计算

确定目标门店后，拉取该门店所有员工：

```sql
SELECT e.id AS user_id, e.store_id
FROM employees e
WHERE e.store_id IN (:matchedStoreIds);
```

---

## 幂等下发保证

批量 INSERT task_assignments 时使用 `INSERT OR IGNORE`：

```sql
INSERT OR IGNORE INTO task_assignments
  (id, task_id, user_id, user_role, store_id, status, created_at, updated_at)
VALUES
  (?, ?, ?, ?, ?, 'pending', ?, ?);
-- UNIQUE(task_id, user_id) 约束确保重复下发不重复生成
```

---

## 数据质量要求

MVP 部署前，需对门店数据进行清洗：

1. `stores.format` 字段值统一为标准格式（参考上方支持值表）
2. `stores.rtm` 字段值与筛选值枚举一致
3. 系统层已做 `LOWER()` 兜底，但仍建议数据层保持一致
4. `stores.dealer_name` 字段需填充（用于经销商维度看板）

---

## 与数据模型一致性（v2.4.0）

本规格已与 `01-DATA-MODEL.md` 对齐，关键点如下：

1. 移除 `sub_rtm`，筛选仅依赖 `stores.rtm` + `stores.format`
2. 文档保留双命名对照：DB 用 `rtm_filter/store_scope`，API/UI 可用 `rtmFilter/storeScope`
3. 保持筛选语义不变：条件内 AND、条件间 OR、format 大小写不敏感
4. 字段约束与数据模型一致：`rtm_filter/store_scope` 的 JSON 有效性与数组约束
