'use strict';

const { getDb } = require('../modules/common/db/connection');

const db = {
  /** 查询单行，无结果返回 null */
  get(sql, params = []) {
    return getDb().prepare(sql).get(...params) ?? null;
  },

  /** 查询多行，无结果返回 [] */
  all(sql, params = []) {
    return getDb().prepare(sql).all(...params);
  },

  /** 执行写操作，返回 { lastInsertRowid, changes } */
  run(sql, params = []) {
    return getDb().prepare(sql).run(...params);
  },

  /** 事务包装：fn 无参数，fn 内抛出则自动回滚 */
  transaction(fn) {
    return getDb().transaction(fn)();
  },
};

module.exports = { db, getDb };
