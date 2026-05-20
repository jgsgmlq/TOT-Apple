'use strict';

const { get, all, run, getPool } = require('../../common/db/mysql');

/**
 * 根据数据库内部主键查询门店信息
 * 用途：在前端点击“编辑”或“删除”某个门店操作前/后，用于确认该记录是否存在，或在更新完成后返回该条数据的最新状态。
 */
async function getStoreById(id) {
  return await get('SELECT * FROM reseller_store WHERE reseller_store_id = ?', [id]);
}

/**
 * 根据门店 Apple ID 业务键查询门店信息
 * 用途：在手动新增单个门店，或批量导入门店 CSV 表格时，作为“唯一业务键”进行查重校验。如果存在则做更新操作，不存在则插入新记录。
 */
async function getStoreByAppleId(appleId) {
  return await get('SELECT * FROM reseller_store WHERE store_apple_id = ?', [appleId]);
}

/**
 * 按条件获取门店列表（支持多条件组合、不严格分页）
 * 用途：常用于系统内其他模块需要下拉选择、批量导出特定门店数据，或者通过传入一组 store_apple_id 数组来批量匹配拉取现存门店的场景。
 */
async function getStoreList(o) {
  const d = o || {};
  const c = []; const p = [];
  if (d.hqAppleId) { c.push('hq_apple_id = ?'); p.push(d.hqAppleId); }
  if (d.rtm4) { c.push('rtm4_name = ?'); p.push(d.rtm4); }
  if (d.subRegion) { c.push('sub_region_code = ?'); p.push(d.subRegion); }
  if (d.storeAppleIds && d.storeAppleIds.length) {
    c.push('store_apple_id IN (' + d.storeAppleIds.map(function() { return '?'; }).join(',') + ')');
    p.push(...d.storeAppleIds);
  }
  const w = c.length ? 'WHERE ' + c.join(' AND ') : '';
  return await all(
    'SELECT * FROM reseller_store ' + w + ' ORDER BY store_name LIMIT ? OFFSET ?',
    p.concat([d.limit || 200, d.offset || 0])
  );
}

/**
 * 分页、多关键字模糊搜索及排序获取门店列表
 * 用途：专供总部端“数据中心” -> “门店信息”面板的表格使用。支撑表格的远程加载、分页切换、全局输入框的模糊搜索以及列头的点击排序。
 */
async function getStorePage(o) {
  const d = o || {};
  const c = []; const p = [];
  if (d.hqAppleId) { c.push('hq_apple_id = ?'); p.push(d.hqAppleId); }
  if (d.rtm4) { c.push('rtm4_name = ?'); p.push(d.rtm4); }
  
  // 新增：支持针对 门店 Apple ID 的精确过滤
  if (d.store_apple_id) {
    c.push('store_apple_id = ?');
    p.push(d.store_apple_id);
  }

  if (d.keyword) {
    c.push('(' +
      'reseller_store_id LIKE ? OR ' +
      'store_apple_id LIKE ? OR ' +
      'hq_apple_id LIKE ? OR ' +
      'sub_region_code LIKE ? OR ' +
      'country_region_name LIKE ? OR ' +
      'rtm4_name LIKE ? OR ' +
      'contract_id LIKE ? OR ' +
      'product_authorization LIKE ? OR ' +
      'reseller_name LIKE ? OR ' +
      'reseller_name_localized LIKE ? OR ' +
      'store_name LIKE ? OR ' +
      'store_name_localized LIKE ? OR ' +
      'address_line_1 LIKE ? OR ' +
      'address_line_2 LIKE ? OR ' +
      'store_address_line_1 LIKE ? OR ' +
      'store_address_line_2 LIKE ? OR ' +
      'program_name LIKE ? OR ' +
      'local_program_name LIKE ? OR ' +
      'city_name LIKE ? OR ' +
      'state_name LIKE ? OR ' +
      'store_city_name LIKE ? OR ' +
      'actual_opening_date LIKE ?' +
    ')');
    const kw = `%${d.keyword}%`;
    p.push(kw, kw, kw, kw, kw, kw, kw, kw, kw, kw, kw, kw, kw, kw, kw, kw, kw, kw, kw, kw, kw, kw);
  }
  const w = c.length ? 'WHERE ' + c.join(' AND ') : '';
  const orderCol = d.sortField || 'created_at';
  const orderDir = d.sortOrder === 'descend' ? 'DESC' : (d.sortField ? 'ASC' : 'DESC');
  
  const row = await get('SELECT COUNT(*) AS c FROM reseller_store ' + w, p);
  const rows = await all(
    `SELECT * FROM reseller_store ${w} ORDER BY ${orderCol} ${orderDir} LIMIT ? OFFSET ?`,
    p.concat([d.pageSize, (d.page - 1) * d.pageSize])
  );
  return { rows, total: row.c, page: d.page, pageSize: d.pageSize };
}

/**
 * 插入一条全新的门店数据
 * 用途：当用户在数据中心点击“新增门店”并提交表单时；或者在 CSV 批量导入流程中，发现库中尚未存在该 store_apple_id 时，执行物理插入入库。
 */
async function createStore(d) {
  const cols = [
    'reseller_store_id', 'store_apple_id', 'hq_apple_id', 'sub_region_code', 'country_region_name',
    'rtm4_name', 'contract_id', 'product_authorization', 'reseller_name', 'reseller_name_localized',
    'store_name', 'store_name_localized', 'address_line_1', 'address_line_2',
    'store_address_line_1', 'store_address_line_2', 'program_name', 'local_program_name',
    'city_name', 'state_name', 'store_city_name', 'actual_opening_date'
  ];
  const vals = cols.map(c => d[c] !== undefined ? d[c] : null);
  const placeholders = cols.map(() => '?').join(', ');

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    // 按照用户要求：临时关闭外键检查，实现单纯新增
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    await conn.query(
      `INSERT INTO reseller_store (${cols.join(', ')}) VALUES (${placeholders})`,
      vals
    );
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    conn.release();
  }
  return await getStoreByAppleId(d.store_apple_id);
}

/**
 * 根据数据库内部主键更新某条门店数据
 * 用途：用于总部端数据中心里，用户点击某一条具体的门店记录执行“编辑”并保存时，定向对该行数据进行修改操作。
 */
async function updateStore(id, d) {
  const k = Object.keys(d).filter(function(x) { return d[x] !== undefined && x !== 'reseller_store_id'; });
  if (!k.length) return await getStoreById(id);
  const s = k.map(function(x) { return x + ' = ?'; }).join(', ');
  const v = k.map(function(x) { return d[x]; });
  await run('UPDATE reseller_store SET ' + s + ' WHERE reseller_store_id = ?', v.concat([id]));
  return await getStoreById(id);
}

/**
 * 根据门店 Apple ID 业务键进行更新覆盖
 * 用途：专属用于 CSV 表格的批量上传功能（Batch Upload）。当上传的文件中存在系统内已有的 store_apple_id 时，不使用数据库的主键 id，而是直接根据业务唯一键做对应的数据覆盖。
 */
async function updateStoreByAppleId(appleId, d) {
  const k = Object.keys(d).filter(function(x) { return d[x] !== undefined && x !== 'store_apple_id'; });
  if (!k.length) return await getStoreByAppleId(appleId);
  const s = k.map(function(x) { return x + ' = ?'; }).join(', ');
  const v = k.map(function(x) { return d[x]; });
  await run('UPDATE reseller_store SET ' + s + ' WHERE store_apple_id = ?', v.concat([appleId]));
  return await getStoreByAppleId(appleId);
}

/**
 * 删除指定的门店数据
 * 用途：在前端页面表格右侧的动作栏中点击“删除”操作时，物理擦除对应 reseller_store_id 的这行数据。
 */
async function deleteStore(id) {
  const r = await run('DELETE FROM reseller_store WHERE reseller_store_id = ?', [id]);
  return r.changes > 0;
}

/**
 * 检查门店下是否有关联的学员
 */
async function countAssociatedLearners(storeAppleId) {
  const row = await get('SELECT COUNT(*) AS c FROM learner_account WHERE store_apple_id = ?', [storeAppleId]);
  return row ? row.c : 0;
}



module.exports = {
  getStoreById,
  getStoreByAppleId,
  getStoreList,
  getStorePage,
  createStore,
  updateStore,
  updateStoreByAppleId,
  deleteStore,
  countAssociatedLearners
};