'use strict';

const { db } = require('../db');

/**
 * tool_searchEntities — 名称→ID 消歧工具
 *
 * 当用户说 "那个 Watch 任务" 或 "观音桥那个店" 时，FC LLM 先调此工具，
 * 把模糊名称解析为精确 ID，再传给其他工具。
 *
 * 支持 5 类实体：
 *   task      → 按任务标题模糊匹配
 *   store     → 按门店名称/ID 模糊匹配
 *   region    → 按 region 字段精确匹配
 *   channel_l3→ 按 RTM (Monobrand/Multibrand/Carrier) 匹配
 *   channel_l4→ 按业态 (MONO/Lifestyle/Mass Merchant) 匹配
 */

const ENTITY_CONFIG = {
  task: {
    table: 'tasks',
    idCol: 'id',
    nameCol: 'title',
    where: "status = 'dispatched'",
    extraCols: ['ddl_at'],
    label: (r) => `${r.title} (截止: ${r.ddl_at || '—'})`,
  },
  store: {
    table: 'stores',
    idCol: 'id',
    nameCol: 'name',
    where: '1=1',
    extraCols: ['region', 'rtm', 'format'],
    label: (r) => `${r.name} (${r.region}, ${r.rtm || r.format || '—'})`,
  },
  region: {
    table: 'stores',
    idCol: 'region',
    nameCol: 'region',
    where: '1=1',
    extraCols: [],
    distinct: true,
    label: (r) => r.region,
  },
  channel_l3: {
    table: 'stores',
    idCol: 'rtm',
    nameCol: 'rtm',
    where: 'rtm IS NOT NULL',
    extraCols: [],
    distinct: true,
    label: (r) => r.rtm,
  },
  channel_l4: {
    table: 'stores',
    idCol: 'format',
    nameCol: 'format',
    where: 'format IS NOT NULL',
    extraCols: [],
    distinct: true,
    label: (r) => r.format,
  },
};

const schema = {
  type: 'function',
  function: {
    name: 'searchEntities',
    description: '将用户提到的模糊名称解析为精确 ID。当用户说 "那个 Watch 任务" 或 "观音桥那个店" 等名称不完整的引用时，先用此工具查找实体，然后用返回的 ID 调其他工具。支持 task/store/region/channel_l3/channel_l4 五类实体。',
    parameters: {
      type: 'object',
      required: ['entityType', 'keyword'],
      properties: {
        entityType: {
          type: 'string',
          enum: ['task', 'store', 'region', 'channel_l3', 'channel_l4'],
          description: '实体类型',
        },
        keyword: {
          type: 'string',
          description: '用户提到的名称关键词。支持部分匹配。如用户说 "iPhone 17"，传 "iPhone" 即可。',
        },
      },
    },
  },
};

const meta = {
  enabled: true,
  requiredRole: ['executive', 'central', 'admin'],
  scopePolicy: 'regional_scoped',
  timeoutMs: 3000,
  freshness: 'daily',
};

async function handler(args) {
  const { entityType, keyword } = args;
  const config = ENTITY_CONFIG[entityType];
  if (!config) {
    return { success: false, errorCode: 'INVALID_PARAMETERS', message: `不支持的实体类型: ${entityType}` };
  }

  const cols = [config.idCol, config.nameCol, ...(config.extraCols || [])];
  const distinct = config.distinct ? 'DISTINCT ' : '';
  const likePattern = `%${keyword}%`;
  const params = [likePattern];

  try {
    const rows = config.distinct
      ? db.all(
          `SELECT ${distinct}${cols.map(c => `${c} AS "${c}"`).join(', ')} FROM ${config.table} WHERE ${config.nameCol} LIKE ? AND ${config.where} LIMIT 8`,
          params
        )
      : db.all(
          `SELECT ${cols.map(c => `${c} AS "${c}"`).join(', ')} FROM ${config.table} WHERE ${config.nameCol} LIKE ? AND ${config.where} ORDER BY ${config.nameCol} ASC LIMIT 8`,
          params
        );

    if (rows.length === 0) {
      return {
        success: true,
        candidates: [],
        entityType,
        keyword,
        message: `未找到匹配 "${keyword}" 的 ${entityType} 实体。`,
      };
    }

    const candidates = rows.map(r => ({
      id: r[config.idCol],
      name: r[config.nameCol],
      label: config.label(r),
    }));

    if (candidates.length === 1) {
      return {
        success: true,
        resolved: candidates[0],
        candidates,
        entityType,
        keyword,
        message: `已解析: ${candidates[0].label}`,
      };
    }

    return {
      success: true,
      candidates,
      entityType,
      keyword,
      needDisambiguation: true,
      message: `"${keyword}" 匹配到 ${candidates.length} 个 ${entityType} 实体，请选择。`,
    };
  } catch (err) {
    return { success: false, errorCode: 'INTERNAL_ERROR', message: err.message };
  }
}

module.exports = { schema, meta, handler };
