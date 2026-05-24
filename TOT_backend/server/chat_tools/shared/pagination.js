'use strict';

const mysql = require('../../modules/common/db/mysql');

/**
 * 通用分页查询辅助 — 消除各 tool handler 中重复的 COUNT + SELECT + rows.map 样板代码。
 *
 * @param {object} opts
 * @param {string}   opts.countSql  - COUNT(*) 查询语句
 * @param {string}   opts.dataSql   - 数据查询语句
 * @param {Array}    opts.countParams - COUNT 查询参数
 * @param {Array}    opts.dataParams  - 数据查询参数（不含 LIMIT/OFFSET，由 helper 追加）
 * @param {number}   opts.page      - 页码（默认 1）
 * @param {number}   opts.pageSize  - 每页条数（默认 50）
 * @param {function} opts.rowMapper - (row) => mappedRow 行映射函数
 * @returns {{ total: number, rows: Array, page: number, pageSize: number }}
 */
async function paginatedQuery({ countSql, dataSql, countParams, dataParams, page, pageSize, rowMapper }) {
  const p = page ?? 1;
  const ps = pageSize ?? 50;
  const offset = (p - 1) * ps;

  const countRow = await mysql.get(countSql, countParams);
  const total = countRow ? countRow.c : 0;

  const rows = await mysql.all(
    `${dataSql} LIMIT ? OFFSET ?`,
    [...(dataParams || []), ps, offset]
  );

  return {
    total,
    rows: rowMapper ? rows.map(rowMapper) : rows,
    page: p,
    pageSize: ps,
  };
}

module.exports = { paginatedQuery };
