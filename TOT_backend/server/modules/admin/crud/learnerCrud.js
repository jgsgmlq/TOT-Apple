'use strict';

const { get, all, run, getPool } = require('../../common/db/mysql');

/**
 * 根据数据库内部主键查询学员信息
 */
async function getLearnerById(id) {
  return await get('SELECT * FROM learner_account WHERE learner_id = ?', [id]);
}

/**
 * 根据学员邮箱（唯一业务键）查询学员信息
 */
async function getLearnerByEmail(emailId) {
  return await get('SELECT * FROM learner_account WHERE email_id = ?', [emailId]);
}

/**
 * 分页、多维度搜索及排序获取学员列表
 */
async function getLearnerPage(o) {
  const d = o || {};
  const c = []; const p = [];
  
  if (d.storeAppleId) { c.push('store_apple_id = ?'); p.push(d.storeAppleId); }
  if (d.hqAppleId) { c.push('hq_apple_id = ?'); p.push(d.hqAppleId); }
  
  if (d.keyword) {
    c.push('(' +
      'learner_id LIKE ? OR ' +
      'email_id LIKE ? OR ' +
      'store_apple_id LIKE ? OR ' +
      'hq_apple_id LIKE ? OR ' +
      'rtm_level_3_name LIKE ? OR ' +
      'rtm_level_4_name LIKE ? OR ' +
      'vad_hq_name LIKE ? OR ' +
      'hq_reseller_localized_name LIKE ? OR ' +
      'reseller_localized_name LIKE ? OR ' +
      'sales_name LIKE ? OR ' +
      'user_business_role_name LIKE ? OR ' +
      'apple_role_name LIKE ? OR ' +
      'first_login_date LIKE ?' +
    ')');
    const kw = '%'+d.keyword+'%';
    p.push(kw, kw, kw, kw, kw, kw, kw, kw, kw, kw, kw, kw, kw);
  }
  
  const w = c.length ? 'WHERE ' + c.join(' AND ') : '';
  
  let orderClause = 'ORDER BY created_at DESC'; 
  if (d.sortField) {
    const validSortFields = [
      'learner_id', 'email_id', 'store_apple_id', 'hq_apple_id', 
      'rtm_level_3_name', 'rtm_level_4_name', 'vad_hq_name', 
      'sales_name', 'user_business_role_name', 'apple_role_name', 'first_login_date', 'created_at'
    ];
    if (validSortFields.includes(d.sortField)) {
      const direction = d.sortOrder === 'descend' ? 'DESC' : 'ASC';
      orderClause = 'ORDER BY ' + d.sortField + ' ' + direction;
    }
  }
  
  const countRow = await get('SELECT COUNT(*) AS c FROM learner_account ' + w, p);
  
  const page = Number(d.page) || 1;
  const pageSize = Number(d.pageSize) || 10;
  const offset = (page - 1) * pageSize;
  
  const rows = await all(
    'SELECT * FROM learner_account ' + w + ' ' + orderClause + ' LIMIT ? OFFSET ?',
    p.concat([pageSize, offset])
  );
  return { rows, total: countRow.c, page: page, pageSize: pageSize };
}

/**
 * 插入一条新学员数据
 */
async function createLearner(d) {
  const cols = [
    'learner_id', 'email_id', 'store_apple_id', 'hq_apple_id', 'rtm_level_3_name',
    'rtm_level_4_name', 'vad_hq_name', 'hq_reseller_localized_name', 'reseller_localized_name',
    'sales_name', 'user_business_role_name', 'apple_role_name', 'first_login_date', 'user_enabled_indicator'
  ];
  const vals = cols.map(c => d[c] !== undefined ? d[c] : null);
  const placeholders = cols.map(() => '?').join(', ');

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    // 按照用户要求：临时关闭外键检查，实现单纯新增
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    await conn.query(
      'INSERT INTO learner_account (' + cols.join(', ') + ') VALUES (' + placeholders + ')',
      vals
    );
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    conn.release();
  }
  return await getLearnerByEmail(d.email_id);
}

/**
 * 根据主键更新学员信息
 */
async function updateLearner(id, d) {
  const k = Object.keys(d).filter(x => d[x] !== undefined && x !== 'learner_id');
  if (!k.length) return await getLearnerById(id);
  const s = k.map(x => x + ' = ?').join(', ');
  const v = k.map(x => d[x]);
  await run('UPDATE learner_account SET ' + s + ' WHERE learner_id = ?', v.concat([id]));
  return await getLearnerById(id);
}

/**
 * 根据邮箱更新学员信息 (Upsert)
 */
async function updateLearnerByEmail(email, d) {
  const k = Object.keys(d).filter(x => d[x] !== undefined && x !== 'email_id');
  if (!k.length) return await getLearnerByEmail(email);
  const s = k.map(x => x + ' = ?').join(', ');
  const v = k.map(x => d[x]);
  await run('UPDATE learner_account SET ' + s + ' WHERE email_id = ?', v.concat([email]));
  return await getLearnerByEmail(email);
}

/**
 * 删除学员信息
 */
async function deleteLearner(id) {
  const r = await run('DELETE FROM learner_account WHERE learner_id = ?', [id]);
  return r.changes > 0;
}

/**
 * 检查学员是否关联了培训任务
 */
async function countAssociatedTasks(learnerId) {
  const row = await get('SELECT COUNT(*) AS c FROM task_publish_learner WHERE learner_id = ?', [learnerId]);
  return row ? row.c : 0;
}

//批量删除
async function batchDeleteLearners(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return 0;
  const result = await run(
    `DELETE FROM learner_account WHERE learner_id IN (${ids.map(() => '?').join(',')})`,
    ids
  );
  return result.changes;
}

/**
 * 彻底清理学员在所有业务表中的关联记录（大扫除模式）
 */
async function deleteLearnerTaskAssignments(learnerId, emailId) {
  // 1. 清理按 learner_id 关联的表
  if (learnerId) {
    await run('DELETE FROM task_publish_learner WHERE learner_id = ?', [learnerId]);
  }
  
  // 2. 清理按 email_id 关联的业务表
  if (emailId) {
    await run('DELETE FROM learner_task_queue WHERE email_id = ?', [emailId]);
    await run('DELETE FROM learner_task_reminder WHERE email_id = ?', [emailId]);
    await run('DELETE FROM task_reminder_log WHERE email_id = ?', [emailId]);
  }
}

module.exports = {
  getLearnerById,
  getLearnerByEmail,
  getLearnerPage,
  createLearner,
  updateLearner,
  updateLearnerByEmail,
  deleteLearner,
  deleteLearnerTaskAssignments,
  countAssociatedTasks,
  batchDeleteLearners
};