'use strict';

const { db } = require('../db');
const { buildRegionFilter } = require('../utils/chatUtils');
const { tokenizeMixedScript } = require('../agent/graph/decisionRules');

/**
 * tool_searchEntities.js (v1.0)
 *
 * 实体消歧 / 名称→ID 解析工具。
 *
 * 用途：
 * - 当其他取数工具因 task_id 缺失或名称模糊返回 TASK_REQUIRED / needDisambiguation 时，
 *   Agent 应先调用本工具拿到候选列表，再让用户选择或自行选最匹配项后重新发起查询。
 * - 替代 executiveMetricsQueryService 内黑盒的 alias 硬编码（开闭原则）。
 *
 * 支持实体：task / channel_l3 / channel_l4 / dealer / store
 */

const SUPPORTED_ENTITY_TYPES = new Set(['task', 'channel_l3', 'channel_l4', 'dealer', 'store']);

const schema = {
  type: 'function',
  function: {
    name: 'searchEntities',
    description:
      '按名称/关键词搜索任务、RTM L3、业态 L4、经销商、门店等实体，返回 ID 候选列表用于消歧。当其他工具返回 TASK_REQUIRED 或用户用模糊名称提问时，**应先调用此工具**拿到候选列表，再用 ID 精确查询。',
    parameters: {
      type: 'object',
      properties: {
        entityType: {
          type: 'string',
          enum: ['task', 'channel_l3', 'channel_l4', 'dealer', 'store'],
          description:
            'task=任务；channel_l3=RTM L3（s.rtm, Monobrand/Multibrand/Carrier）；channel_l4=业态（s.format）；dealer=经销商；store=门店',
        },
        keyword: {
          type: 'string',
          description: '关键词（模糊匹配）。空字符串表示返回全部（按 limit 截断）。',
        },
        limit: {
          type: 'number',
          description: '返回候选数量上限（默认 10，最大 50）',
        },
      },
      required: ['entityType'],
    },
  },
};

const meta = {
  enabled: true,
  requiredRole: ['executive', 'central', 'admin'],
  scopePolicy: 'any',
  timeoutMs: 5000,
};

function searchTasks(keyword, limit) {
  const kw = (keyword || '').trim();
  if (!kw) {
    return db.all(`SELECT id, title AS name, mypal_product_name, ddl_at, status FROM tasks ORDER BY created_at DESC LIMIT ?`, [limit]);
  }
  // 1. 精确子串匹配
  let rows = db.all(
    `SELECT id, title AS name, mypal_product_name, ddl_at, status FROM tasks WHERE title LIKE ? OR mypal_product_name LIKE ? OR id = ? ORDER BY created_at DESC LIMIT ?`,
    [`%${kw}%`, `%${kw}%`, kw, limit]
  );
  // 2. 无结果 → 分词匹配
  if (rows.length === 0) {
    const tokens = tokenizeMixedScript(kw);
    if (tokens.length > 0) {
      // OR 匹配 + 按命中数排序：至少命中 1 个 token 就返回，命中越多排越前
      const conditions = tokens.map(() => '(title LIKE ? OR mypal_product_name LIKE ?)').join(' OR ');
      const scoreExpr = tokens.map(() => `(CASE WHEN title LIKE ? OR mypal_product_name LIKE ? THEN 1 ELSE 0 END)`).join(' + ');
      const params = tokens.flatMap(t => [`%${t}%`, `%${t}%`]);
      const scoreParams = tokens.flatMap(t => [`%${t}%`, `%${t}%`]);
      rows = db.all(`SELECT id, title AS name, mypal_product_name, ddl_at, status, (${scoreExpr}) AS match_score FROM tasks WHERE ${conditions} ORDER BY match_score DESC, created_at DESC LIMIT ?`, [...scoreParams, ...params, limit]);
    }
  }
  return rows;
}

function searchChannelL3(keyword, limit, regionScope) {
  const filter = buildRegionFilter(regionScope);
  const kw = (keyword || '').trim();
  const where = [];
  const params = [];
  if (kw) {
    where.push('region LIKE ?');
    params.push(`%${kw}%`);
  }
  // 把 region scope 应用进来（注意：buildRegionFilter 用 s.region；这里替换前缀）
  const scopeSql = filter.sql.replace(/s\.region/g, 'region').replace(/s\.rtm/g, 'rtm');
  const whereSql = where.length ? `WHERE ${where.join(' AND ')} ${scopeSql.replace(/^AND /, 'AND ')}` : (scopeSql ? scopeSql.replace(/^AND /, 'WHERE ') : '');
  return db.all(
    `SELECT DISTINCT region AS id, region AS name
     FROM stores
     ${whereSql}
     ORDER BY region ASC
     LIMIT ?`,
    [...params, ...filter.params, limit]
  );
}

function searchChannelL4(keyword, limit, regionScope) {
  const filter = buildRegionFilter(regionScope);
  const kw = (keyword || '').trim();
  const where = ['format IS NOT NULL'];
  const params = [];
  if (kw) {
    where.push('format LIKE ?');
    params.push(`%${kw}%`);
  }
  const scopeSql = filter.sql.replace(/s\.region/g, 'region').replace(/s\.rtm/g, 'rtm');
  const whereSql = `WHERE ${where.join(' AND ')} ${scopeSql.replace(/^AND /, 'AND ')}`;
  return db.all(
    `SELECT DISTINCT format AS id, format AS name
     FROM stores
     ${whereSql}
     ORDER BY format ASC
     LIMIT ?`,
    [...params, ...filter.params, limit]
  );
}

function searchDealer(keyword, limit, regionScope) {
  const filter = buildRegionFilter(regionScope);
  const kw = (keyword || '').trim();
  const where = ['dealer_name IS NOT NULL'];
  const params = [];
  if (kw) {
    where.push('dealer_name LIKE ?');
    params.push(`%${kw}%`);
  }
  const scopeSql = filter.sql.replace(/s\.region/g, 'region').replace(/s\.rtm/g, 'rtm');
  const whereSql = `WHERE ${where.join(' AND ')} ${scopeSql.replace(/^AND /, 'AND ')}`;
  return db.all(
    `SELECT DISTINCT dealer_name AS id, dealer_name AS name, region, format
     FROM stores
     ${whereSql}
     ORDER BY dealer_name ASC
     LIMIT ?`,
    [...params, ...filter.params, limit]
  );
}

function searchStore(keyword, limit, regionScope) {
  const filter = buildRegionFilter(regionScope);
  const kw = (keyword || '').trim();
  const where = [];
  const params = [];
  if (kw) {
    // 同时按 ID 精确 / 名称模糊
    where.push('(id = ? OR name LIKE ?)');
    params.push(kw, `%${kw}%`);
  }
  const scopeSql = filter.sql.replace(/s\.region/g, 'region').replace(/s\.rtm/g, 'rtm');
  const whereSql = where.length
    ? `WHERE ${where.join(' AND ')} ${scopeSql.replace(/^AND /, 'AND ')}`
    : (scopeSql ? scopeSql.replace(/^AND /, 'WHERE ') : '');
  return db.all(
    `SELECT id, name, region, rtm, format, dealer_name
     FROM stores
     ${whereSql}
     ORDER BY name ASC
     LIMIT ?`,
    [...params, ...filter.params, limit]
  );
}

async function handler(args, regionScope) {
  try {
    const entityType = args.entityType;
    if (!SUPPORTED_ENTITY_TYPES.has(entityType)) {
      return {
        success: false,
        errorCode: 'INVALID_PARAMETERS',
        message: `不支持的 entityType: ${entityType}`,
      };
    }

    const limit = Math.max(1, Math.min(50, Number.isFinite(args.limit) ? Math.floor(args.limit) : 20));
    const keyword = args.keyword || '';

    let candidates = [];
    switch (entityType) {
      case 'task':
        candidates = searchTasks(keyword, limit);
        break;
      case 'channel_l3':
        candidates = searchChannelL3(keyword, limit, regionScope);
        break;
      case 'channel_l4':
        candidates = searchChannelL4(keyword, limit, regionScope);
        break;
      case 'dealer':
        candidates = searchDealer(keyword, limit, regionScope);
        break;
      case 'store':
        candidates = searchStore(keyword, limit, regionScope);
        break;
    }

    let suggestion = null;
    if (candidates.length === 0) {
      suggestion = `未找到任何匹配 "${keyword}" 的 ${entityType}。建议放宽关键词或更换实体类型。`;
    } else if (candidates.length === 1) {
      suggestion = `仅 1 个匹配：可直接使用 id="${candidates[0].id}" 进行后续查询。`;
    } else {
      suggestion = `命中 ${candidates.length} 个候选，请确认或要求用户从中选择一个具体 id。`;
    }

    return {
      success: true,
      entityType,
      keyword,
      candidates,
      candidateCount: candidates.length,
      suggestion,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    return {
      success: false,
      errorCode: 'INTERNAL_ERROR',
      message: `实体搜索失败: ${err.message}`,
      appliedParams: args,
    };
  }
}

module.exports = { schema, meta, handler };
