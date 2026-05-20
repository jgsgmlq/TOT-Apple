'use strict';

const mysql = require('mysql2/promise');

let pool = null;

function getPool() {
  if (!pool) {
    const url = process.env.MYSQL_URL;
    if (!url) {
      throw new Error('MYSQL_URL 未配置，请在 .env 中设置 MySQL 连接字符串');
    }
    pool = mysql.createPool({
      uri: url,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
    });
  }
  return pool;
}

async function query(sql, params = []) {
  const p = getPool();
  const [rows] = await p.query(sql, params);
  return rows;
}

async function get(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] ?? null;
}

async function all(sql, params = []) {
  return await query(sql, params);
}

async function run(sql, params = []) {
  const p = getPool();
  const [result] = await p.query(sql, params);
  return { lastInsertRowid: result.insertId, changes: result.affectedRows };
}

/**
 * 在单连接事务中执行 callback(conn)；成功 commit，失败 rollback。
 * @param {(conn: import('mysql2/promise').PoolConnection) => Promise<T>} callback
 * @returns {Promise<T>}
 */
async function withTransaction(callback) {
  const p = getPool();
  const conn = await p.getConnection();
  try {
    await conn.beginTransaction();
    const result = await callback(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function ensureDashboardInsightsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS dashboard_insights (
      id VARCHAR(32) PRIMARY KEY,
      module_type VARCHAR(32) NOT NULL,
      task_publish_id VARCHAR(32),
      filter_rtm VARCHAR(64),
      filter_format VARCHAR(64),
      filter_dealer_name VARCHAR(128),
      filter_store_id VARCHAR(32),
      extra_params_json TEXT,
      content TEXT NOT NULL,
      context_json TEXT,
      up_count INT NOT NULL DEFAULT 0,
      down_count INT NOT NULL DEFAULT 0,
      created_by VARCHAR(64),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_di_module_task (module_type, task_publish_id),
      INDEX idx_di_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

module.exports = { getPool, query, get, all, run, withTransaction, ensureDashboardInsightsTable };
