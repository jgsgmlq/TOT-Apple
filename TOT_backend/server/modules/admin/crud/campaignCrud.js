'use strict';

const { get, all, run, getPool } = require('../../common/db/mysql');

async function getCampaignById(id) {
  return await get('SELECT * FROM campaign_activity WHERE activity_id = ?', [id]);
}

async function getCampaignPage(o) {
  var d = o || {}, c = [], p = [];
  
  
  if (d.fiscal_year) { 
    const vals = d.fiscal_year.split(',');
    c.push('fiscal_year IN (' + vals.map(() => '?').join(',') + ')'); 
    p.push(...vals); 
  }
  if (d.quarter_no) { 
    const vals = d.quarter_no.split(',');
    c.push('quarter_no IN (' + vals.map(() => '?').join(',') + ')'); 
    p.push(...vals); 
  }
  if (d.model_type) { 
    const vals = d.model_type.split(',');
    c.push('model_type IN (' + vals.map(() => '?').join(',') + ')'); 
    p.push(...vals); 
  }
  if (d.rtm_scope) { 
    const vals = d.rtm_scope.split(',');
    c.push('rtm_scope IN (' + vals.map(() => '?').join(',') + ')'); 
    p.push(...vals); 
  }

  if (d.topicName) { 
    c.push('topic_name LIKE ?'); 
    p.push('%' + d.topicName + '%'); 
  }
  if (d.keyword) {
    c.push('(' +
      'activity_id LIKE ? OR ' +
      'task_week LIKE ? OR ' +
      'topic_name LIKE ? OR ' +
      'fiscal_year LIKE ? OR ' +
      'quarter_no LIKE ? OR ' +
      'week_code LIKE ? OR ' +
      'fiscal_week_code LIKE ? OR ' +
      'date_range LIKE ? OR ' +
      'model_type LIKE ? OR ' +
      'rtm_scope LIKE ?' +
    ')');
    const kw = '%' + d.keyword + '%';
    p.push(kw, kw, kw, kw, kw, kw, kw, kw, kw, kw);
  }

  var w = c.length ? 'WHERE ' + c.join(' AND ') : '';
  
  // 处理排序逻辑
  let orderClause = 'ORDER BY created_at DESC';
  if (d.sortField) {
    const validSortFields = [
      'activity_id', 'task_week', 'topic_name', 'fiscal_year', 
      'quarter_no', 'week_code', 'date_range', 'model_type', 'rtm_scope', 'created_at'
    ];
    if (validSortFields.includes(d.sortField)) {
      const direction = d.sortOrder === 'descend' ? 'DESC' : 'ASC';
      if (d.sortField === 'week_code') {
        orderClause = `ORDER BY SUBSTRING_INDEX(week_code, 'W', 1) ${direction}, CAST(SUBSTRING_INDEX(week_code, 'W', -1) AS UNSIGNED) ${direction}`;
      } else {
        orderClause = `ORDER BY ${d.sortField} ${direction}`;
      }
    }
  }
  
  const countRow = await get('SELECT COUNT(*) AS c FROM campaign_activity ' + w, p);
  const total = countRow.c;

  const pageSize = Number(d.pageSize) || 10;
  const page = Number(d.page) || 1;
  const offset = (page - 1) * pageSize;
  
  const queryParams = [...p, pageSize, offset];
  const rows = await all(
    'SELECT * FROM campaign_activity ' + w + ' ' + orderClause + ' LIMIT ? OFFSET ?',
    queryParams
  );
  
  return { rows: rows, total: total, page: page, pageSize: pageSize };
}

async function createCampaign(d) {
  await run(
    'INSERT INTO campaign_activity (' +
    'activity_id, task_week, topic_name, fiscal_year, quarter_no, ' +
    'week_code, date_range, model_type, rtm_scope' +
    ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      d.activity_id, 
      d.task_week, 
      d.topic_name, 
      d.fiscal_year, 
      d.quarter_no, 
      d.week_code, 
      d.date_range, 
      d.model_type, 
      d.rtm_scope
    ]
  );
  return await getCampaignById(d.activity_id);
}

async function updateCampaign(id, d) {
  var k = Object.keys(d).filter(function(x) { return d[x] !== undefined && x !== 'activity_id'; });
  if (!k.length) return await getCampaignById(id);
  
  var s = k.map(function(x) { return x + ' = ?'; }).join(', ');
  var v = k.map(function(x) { return d[x]; });
  v.push(id); 
  
  await run(
    'UPDATE campaign_activity SET ' + s + ' WHERE activity_id = ?',
    v
  );
  
  return await getCampaignById(id);
}

async function deleteCampaign(id) {
  const result = await run('DELETE FROM campaign_activity WHERE activity_id = ?', [id]);
  return result.changes > 0;
}

//批量删除
async function batchDeleteCampaign(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return 0;
  const result = await run(
    `DELETE FROM campaign_activity WHERE activity_id IN (${ids.map(() => '?').join(',')})`,
    ids
  );
  return result.changes;
}

// 批量上传（累加模式）
async function batchUpsertCampaign(dataArray) {
  const pool = getPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const d of dataArray) {
      // 1. 识别 ID：优先使用 CSV 里的，没有则生成
      let rawId = d['活动 ID'] || d['活动ID'] || d.activity_id;
      if (!rawId) {
        rawId = 'ACT-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
      }

      // 2. 实现“只管新增”：先检查是否存在，若冲突则改名插入
      const existing = await get('SELECT activity_id FROM campaign_activity WHERE activity_id = ?', [rawId]);
      const finalId = existing ? `${rawId}_${Date.now().toString().slice(-4)}` : rawId;

      // 3. 字段映射（兼容中英文表头）
      const taskWeek = d['任务周'] || d.task_week;
      const topicName = d['产品名称'] || d.topic_name;
      const fiscalYear = d['财年'] || d.fiscal_year;
      const quarterNo = d['季度'] || d.quarter_no;
      const weekCode = d['周次'] || d.week_code;
      const fiscalWeekCode = d['财务周'] || d.fiscal_week_code;
      const dateRange = d['任务时间'] || d.date_range;
      const modelType = d['运营类型'] || d.model_type;
      const rtmScope = d['渠道范围'] || d.rtm_scope;

      await connection.query(
        'INSERT INTO campaign_activity (' +
        'activity_id, task_week, topic_name, fiscal_year, quarter_no, ' +
        'week_code, fiscal_week_code, date_range, model_type, rtm_scope' +
        ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          finalId, taskWeek || null, topicName || null, fiscalYear || null,
          quarterNo || null, weekCode || null, fiscalWeekCode || null, dateRange || null, modelType || null, rtmScope || null
        ]
      );
    }
    await connection.commit();
    return dataArray.length;
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}


async function getFilterOptions() {
  const fyRows = await all("SELECT DISTINCT fiscal_year AS val FROM campaign_activity WHERE fiscal_year IS NOT NULL");
  const qRows = await all("SELECT DISTINCT quarter_no AS val FROM campaign_activity WHERE quarter_no IS NOT NULL");
  const mtRows = await all("SELECT DISTINCT model_type AS val FROM campaign_activity WHERE model_type IS NOT NULL");
  return {
    fiscal_year: fyRows.map(r => r.val).filter(v => v !== ''),
    quarter_no: qRows.map(r => r.val).filter(v => v !== ''),
    model_type: mtRows.map(r => r.val).filter(v => v !== '')
  };
}

module.exports = {
  getFilterOptions,
  getCampaignById,
  getCampaignPage,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  batchDeleteCampaign,
  batchUpsertCampaign
};
