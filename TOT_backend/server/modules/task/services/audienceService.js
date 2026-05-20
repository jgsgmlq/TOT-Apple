'use strict';

/**
 * audienceService.js — 受众圈选规则解析（业务逻辑层）
 *
 * 职责：
 *   1. 将前端受众条件映射为 SQL WHERE 片段（维度 → 列映射）
 *   2. 调用 crud 层执行查询（实时覆盖预览 / 圈选学员）
 *   3. 获取各维度可选值
 *
 * 维度 → DB 映射：
 *   RTM           → learner_account.rtm_level_3_name
 *   Reseller      → learner_account.reseller_localized_name
 *   Business Role → learner_account.user_business_role_name
 *   POS           → reseller_store.program_name (JOIN via store_apple_id)
 *   New Store Weeks → reseller_store.actual_opening_date (JOIN, 计算周数)
 */

const taskCrud = require('../crud/taskMysqlCrud');

// 需要 JOIN reseller_store 的维度
const STORE_DIMENSIONS = new Set(['POS', 'New Store Weeks']);

// 维度 → learner_account 列名
const LEARNER_COL_MAP = {
  'RTM':           'la.rtm_level_3_name',
  'Reseller':      'la.reseller_localized_name',
  'Business Role': 'la.user_business_role_name',
};

// 维度 → reseller_store 列名
const STORE_COL_MAP = {
  'POS': 'rs.program_name',
};

/**
 * 根据条件数组生成 SQL WHERE 片段（纯业务逻辑，不执行查询）
 *
 * @param {Array} conditions - [{ dimension_type, operator_type, condition_value_text }]
 * @returns {{ whereSql: string, params: Array, needsStoreJoin: boolean }}
 */
function buildAudienceWhere(conditions) {
  if (!conditions || !conditions.length) {
    return { whereSql: '', params: [], needsStoreJoin: false };
  }

  const clauses = [];
  const params = [];
  let needsStoreJoin = false;

  for (const c of conditions) {
    const dim = c.dimension_type;
    const op = c.operator_type || 'in';
    const val = c.condition_value_text;

    if (STORE_DIMENSIONS.has(dim)) {
      needsStoreJoin = true;
    }

    if (dim === 'New Store Weeks') {
      const raw = val == null ? '' : (Array.isArray(val) ? String(val[0] ?? '').trim() : String(val).trim());
      if (raw === '') continue;
      const weeks = Number(raw);
      if (!Number.isFinite(weeks) || weeks < 0) continue;

      if (op === 'lte') {
        clauses.push('rs.actual_opening_date IS NOT NULL AND DATEDIFF(CURDATE(), rs.actual_opening_date) / 7 <= ?');
        params.push(weeks);
      } else if (op === 'gte') {
        clauses.push('rs.actual_opening_date IS NOT NULL AND DATEDIFF(CURDATE(), rs.actual_opening_date) / 7 >= ?');
        params.push(weeks);
      } else { // equals
        clauses.push('rs.actual_opening_date IS NOT NULL AND DATEDIFF(CURDATE(), rs.actual_opening_date) / 7 >= ? AND DATEDIFF(CURDATE(), rs.actual_opening_date) / 7 < ?');
        params.push(weeks, weeks + 1);
      }
      continue;
    }

    // 确定列名
    let col = LEARNER_COL_MAP[dim];
    if (!col && STORE_COL_MAP[dim]) {
      col = STORE_COL_MAP[dim];
    }
    if (!col) continue;

    const vals = Array.isArray(val) ? val : [val];
    if (!vals.length) continue;

    if (op === 'in' || Array.isArray(val)) {
      const placeholders = vals.map(() => '?').join(', ');
      clauses.push(col + ' IN (' + placeholders + ')');
      params.push(...vals);
    } else if (op === 'equals') {
      clauses.push(col + ' = ?');
      params.push(String(val));
    }
  }

  const whereSql = clauses.length ? 'AND ' + clauses.join(' AND ') : '';
  return { whereSql, params, needsStoreJoin };
}

/**
 * 根据受众条件解析匹配的学员列表（供下发时调用）
 *
 * @param {Array} conditions
 * @returns {Promise<{ learners: Array, count: number }>}
 */
async function resolveAudience(conditions) {
  const { whereSql, params, needsStoreJoin } = buildAudienceWhere(conditions);
  const learners = await taskCrud.queryLearnersByAudienceWhere({ whereSql, params, needsStoreJoin });
  return { learners, count: learners.length };
}

/**
 * 计算预计覆盖人数（仅计数，用于前端实时预览）
 *
 * 无有效 SQL 筛选时返回 null，避免把「未配置」显示成 0 或全员人数产生误导。
 * 显式「全员」场景由 options.allow_no_filter 打开（与前端「所有学员」预设对齐）。
 *
 * @param {Array} conditions
 * @param {{ allow_no_filter?: boolean }} [options]
 * @returns {Promise<number|null>}
 */
async function previewCoverage(conditions, options = {}) {
  const allowNoFilter = !!options.allow_no_filter;
  const { whereSql, params, needsStoreJoin } = buildAudienceWhere(conditions);
  if (!whereSql) {
    if (allowNoFilter) {
      return await taskCrud.countLearnersByAudienceWhere({ whereSql: '', params: [], needsStoreJoin: false });
    }
    return null;
  }
  return await taskCrud.countLearnersByAudienceWhere({ whereSql, params, needsStoreJoin });
}

/**
 * 获取各维度的可选值列表（供前端下拉框动态渲染）
 */
async function getDimensionValues() {
  const [rtm, roles, resellers, pos] = await Promise.all([
    taskCrud.getDistinctLearnerColumn('rtm_level_3_name'),
    taskCrud.getDistinctLearnerColumn('user_business_role_name'),
    taskCrud.getDistinctLearnerColumn('reseller_localized_name'),
    taskCrud.getDistinctStoreColumn('program_name'),
  ]);

  return {
    rtm: rtm.map(r => r.v),
    'Business Role': roles.map(r => r.v),
    Reseller: resellers.map(r => r.v),
    POS: pos.map(r => r.v),
  };
}

// ─── 模板管理 ────────────────────────────────────────────────────────
// 模板存入 task_audience_group（group_desc = 'template'），与任务无关

const { nanoid } = require('nanoid');

/**
 * 将当前受众条件另存为模板
 */
async function saveTemplate(audienceGroup, username) {
  if (!audienceGroup || !audienceGroup.conditions || !audienceGroup.conditions.length) {
    throw Object.assign(new Error('模板至少需要一个条件'), { statusCode: 400 });
  }

  const groupId = nanoid();
  await taskCrud.createAudienceGroup({
    id: groupId,
    name: audienceGroup.group_name || '未命名模板',
    desc: 'template',
    enabledFlag: 1,
    createdBy: username,
  });

  const entries = audienceGroup.conditions.map((c, i) => ({
    id: nanoid(),
    groupId,
    dimensionType: c.dimension_type,
    operatorType: c.operator_type || 'in',
    conditionValueText: Array.isArray(c.condition_value_text)
      ? JSON.stringify(c.condition_value_text)
      : String(c.condition_value_text ?? ''),
    order: c.condition_order ?? i + 1,
    createdBy: username,
  }));

  if (entries.length) {
    await taskCrud.batchCreateAudienceConditions(entries);
  }

  return { id: groupId, name: audienceGroup.group_name || '未命名模板' };
}

/**
 * 获取所有已保存的模板列表（含条件）
 */
async function listTemplates() {
  const groups = await taskCrud.getAudienceTemplates();
  const result = [];
  for (const g of groups) {
    const conditions = await taskCrud.getAudienceConditions(g.audience_group_id);
    result.push({
      id: g.audience_group_id,
      name: g.group_name,
      created_at: g.created_at,
      conditions: conditions.map(c => ({
        dimension_type: c.dimension_type,
        operator_type: c.operator_type,
        condition_value_text: safeParseValue(c.condition_value_text),
        condition_order: c.condition_order,
      })),
    });
  }
  return result;
}

/**
 * 删除模板（级联删除组 + 条件）
 */
async function deleteTemplate(groupId) {
  const group = await taskCrud.getAudienceGroupById(groupId);
  if (!group) {
    throw Object.assign(new Error('模板不存在'), { statusCode: 404 });
  }
  await taskCrud.deleteAudienceGroupCascade(groupId);
  return { deleted: true };
}

function safeParseValue(v) {
  if (!v) return v;
  if (typeof v === 'string' && (v.startsWith('[') || v.startsWith('{'))) {
    try { return JSON.parse(v); } catch (_) { /* fall through */ }
  }
  return v;
}

module.exports = {
  buildAudienceWhere,
  resolveAudience,
  previewCoverage,
  getDimensionValues,
  saveTemplate,
  listTemplates,
  deleteTemplate,
};
