'use strict';

const { get, all, run, getPool } = require('../../common/db/mysql');

/**
 * 根据数据库内部主键 ID 查询经销商总部信息
 * 用途：主要用于在执行完创建或更新操作后，重新从库里捞出完整且最新的该行数据，返回给前端确认。
 */
async function getResellerHqById(id) {
  return await get('SELECT * FROM reseller_headquarter WHERE reseller_hq_id = ?', [id]);
}

/**
 * 根据总部 Apple ID 业务键查询经销商总部信息
 * 用途：用于新增经销商时的唯一性查重；以及在导入/新增门店信息时，作为外键校验逻辑判断该总部是否真实存在。
 */
async function getResellerHqByAppleId(appleId) {
  return await get('SELECT * FROM reseller_headquarter WHERE hq_apple_id = ?', [appleId]);
}

/**
 * 按条件获取经销商总部列表（支持多重过滤，限制返回条数）
 * 用途：常用于系统内部的下拉选择框数据填充、或是其他非严格分页展示经销商名单的业务场景。
 */
async function getResellerHqList(o) {
  var d = o || {}, c = [], p = [];
  
  if (d.country_region_name) { 
    const vals = d.country_region_name.split(',');
    c.push('country_region_name IN (' + vals.map(() => '?').join(',') + ')'); 
    p.push(...vals); 
  }
  if (d.rtm4_name) { 
    const vals = d.rtm4_name.split(',');
    c.push('rtm4_name IN (' + vals.map(() => '?').join(',') + ')'); 
    p.push(...vals); 
  }

  if (d.resellerName) { 
    c.push('reseller_name LIKE ?'); 
    p.push('%' + d.resellerName + '%'); 
  }
  if (d.keyword) {
    c.push('(' +
      'reseller_hq_id LIKE ? OR ' +
      'hq_apple_id LIKE ? OR ' +
      'country_region_name LIKE ? OR ' +
      'sub_region_code LIKE ? OR ' +
      'rtm4_name LIKE ? OR ' +
      'contract_id LIKE ? OR ' +
      'reseller_name LIKE ? OR ' +
      'reseller_name_localized LIKE ? OR ' +
      'vad_hq_name LIKE ?' +
    ')');
    const kw = '%' + d.keyword + '%';
    p.push(kw, kw, kw, kw, kw, kw, kw, kw, kw);
  }

  var w = c.length ? 'WHERE ' + c.join(' AND ') : '';
  
  const limit = Number(d.limit) || 50;
  const offset = Number(d.offset) || 0;
  p.push(limit, offset);

  return await all(
    'SELECT * FROM reseller_headquarter ' + w + ' ORDER BY reseller_hq_id LIMIT ? OFFSET ?',
    p
  );
}

/**
 * 分页、多维度搜索及远程排序获取经销商列表
 * 用途：核心用于总部端“数据中心” -> “经销商信息”模块的表格。支撑前端表格的分页器切换、全局关键字搜索以及根据列头进行升降序排列。
 */
async function getResellerHqPage(o) {
  var d = o || {}, c = [], p = [];
  
  if (d.country_region_name) { 
    const vals = d.country_region_name.split(',');
    c.push('country_region_name IN (' + vals.map(() => '?').join(',') + ')'); 
    p.push(...vals); 
  }
  if (d.rtm4_name) { 
    const vals = d.rtm4_name.split(',');
    c.push('rtm4_name IN (' + vals.map(() => '?').join(',') + ')'); 
    p.push(...vals); 
  }

  if (d.resellerName) { 
    c.push('reseller_name LIKE ?'); 
    p.push('%' + d.resellerName + '%'); 
  }
  if (d.keyword) {
    c.push('(' +
      'reseller_hq_id LIKE ? OR ' +
      'hq_apple_id LIKE ? OR ' +
      'country_region_name LIKE ? OR ' +
      'sub_region_code LIKE ? OR ' +
      'rtm4_name LIKE ? OR ' +
      'contract_id LIKE ? OR ' +
      'reseller_name LIKE ? OR ' +
      'reseller_name_localized LIKE ? OR ' +
      'vad_hq_name LIKE ?' +
    ')');
    const kw = '%' + d.keyword + '%';
    p.push(kw, kw, kw, kw, kw, kw, kw, kw, kw);
  }

  var w = c.length ? 'WHERE ' + c.join(' AND ') : '';
  
  let orderClause = 'ORDER BY created_at DESC'; 
  if (d.sortField) {
    const validSortFields = [
      'reseller_hq_id', 'hq_apple_id', 'country_region_name', 
      'sub_region_code', 'rtm4_name', 'contract_id', 
      'reseller_name', 'reseller_name_localized', 'vad_hq_name', 'created_at'
    ];
    if (validSortFields.includes(d.sortField)) {
      const direction = d.sortOrder === 'descend' ? 'DESC' : 'ASC';
      orderClause = `ORDER BY ${d.sortField} ${direction}`;
    }
  }
  
  const countRow = await get('SELECT COUNT(*) AS c FROM reseller_headquarter ' + w, p);
  const total = countRow.c;

  const pageSize = Number(d.pageSize) || 10;
  const page = Number(d.page) || 1;
  const offset = (page - 1) * pageSize;
  
  const queryParams = [...p, pageSize, offset];
  const rows = await all(
    'SELECT * FROM reseller_headquarter ' + w + ' ' + orderClause + ' LIMIT ? OFFSET ?',
    queryParams
  );
  
  return { rows: rows, total: total, page: page, pageSize: pageSize };
}

/**
 * 在数据库中创建一条新的经销商总部记录
 * 用途：当用户在数据中心手动点击“新增数据”提交表单时；或者在导入其他相关联数据（如门店、学员）时，若其关联的总部 ID 在库中不存在，则自动调用此方法生成记录。
 */
async function createResellerHq(d) {
  await run(
    'INSERT INTO reseller_headquarter (' +
    'reseller_hq_id, hq_apple_id, country_region_name, sub_region_code, ' +
    'rtm4_name, contract_id, reseller_name, reseller_name_localized, vad_hq_name' +
    ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      d.reseller_hq_id, 
      d.hq_apple_id, 
      d.country_region_name, 
      d.sub_region_code, 
      d.rtm4_name, 
      d.contract_id, 
      d.reseller_name, 
      d.reseller_name_localized, 
      d.vad_hq_name
    ]
  );
  return await getResellerHqById(d.reseller_hq_id);
}

/**
 * 根据主键修改指定的经销商总部记录
 * 用途：用于总部端数据中心里，用户对选中的经销商行执行“编辑”操作并点击保存后，同步更新数据库内容。
 */
async function updateResellerHq(id, d) {
  var k = Object.keys(d).filter(function(x) { return d[x] !== undefined; });
  if (!k.length) return await getResellerHqById(id);
  
  var s = k.map(function(x) { return x + ' = ?'; }).join(', ');
  var v = k.map(function(x) { return d[x]; });
  v.push(id); 
  
  await run(
    'UPDATE reseller_headquarter SET ' + s + ' WHERE reseller_hq_id = ?',
    v
  );
  
  return await getResellerHqById(id);
}

/**
 * 从数据库中删除指定的经销商记录
 * 用途：在经销商信息表格页点击右侧“删除”按钮时，物理移除该 reseller_hq_id 对应的行数据。
 */
async function deleteResellerHq(id) {
  const result = await run('DELETE FROM reseller_headquarter WHERE reseller_hq_id = ?', [id]);
  return result.changes > 0;
}

/**
 * 检查总部下是否有管理的门店
 */
async function countAssociatedStores(hqAppleId) {
  const row = await get('SELECT COUNT(*) AS c FROM reseller_store WHERE hq_apple_id = ?', [hqAppleId]);
  return row ? row.c : 0;
}

/**
 * 检查总部下是否有管理的学员
 */
async function countAssociatedLearners(hqAppleId) {
  const row = await get('SELECT COUNT(*) AS c FROM learner_account WHERE hq_apple_id = ?', [hqAppleId]);
  return row ? row.c : 0;
}

/**
 * 批量同步/更新经销商总部数据
 * 用途：支持大批量经销商 CSV 文件的底层处理。内部采用数据库事务，根据 hq_apple_id 进行判断：库里没有则执行插入。
 * 注意：目前该方法为只新增不更新模式，Service 层已另行实现了支持 Upsert（更新+插入）逻辑的新版本。
 */
async function batchUpsertResellerHq(dataArray) {
  const pool = getPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const d of dataArray) {
      if (!d.hq_apple_id) continue; 
      
      const [rows] = await connection.query('SELECT hq_apple_id FROM reseller_headquarter WHERE hq_apple_id = ?', [d.hq_apple_id]);
      
      if (rows.length > 0) {
        continue;
      } else {
        const newId = d.reseller_hq_id || ('HQ-' + Date.now() + '-' + Math.floor(Math.random() * 10000));
        await connection.query(
          'INSERT INTO reseller_headquarter (' +
          'reseller_hq_id, hq_apple_id, country_region_name, sub_region_code, ' +
          'rtm4_name, contract_id, reseller_name, reseller_name_localized, vad_hq_name' +
          ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            newId, d.hq_apple_id, d.country_region_name || null, d.sub_region_code || null,
            d.rtm4_name || null, d.contract_id || null, d.reseller_name || null, d.reseller_name_localized || null, d.vad_hq_name || null
          ]
        );
      }
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

/**
 * 获取表格筛选项的去重枚举值
 * 用途：专供前端经销商信息表格上方的筛选器使用。自动扫描库中现有的“国家/地区”和“渠道类型”，提取出去重后的名单作为下拉框选项。
 */
async function getFilterOptions() {
  const cRows = await all("SELECT DISTINCT country_region_name AS val FROM reseller_headquarter WHERE country_region_name IS NOT NULL");
  const rRows = await all("SELECT DISTINCT rtm4_name AS val FROM reseller_headquarter WHERE rtm4_name IS NOT NULL");
  return {
    country_region_name: cRows.map(r => r.val).filter(v => v !== ''),
    rtm4_name: rRows.map(r => r.val).filter(v => v !== '')
  };
}

module.exports = {
  getFilterOptions,
  getResellerHqById,
  getResellerHqByAppleId,
  getResellerHqList,
  getResellerHqPage,
  createResellerHq,
  updateResellerHq,
  deleteResellerHq,
  countAssociatedStores,
  countAssociatedLearners,
  batchUpsertResellerHq
  };