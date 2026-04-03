'use strict';

const { db } = require('../db');

/**
 * 邮箱规范化：trim + 小写，供 MyPal 对接与 employees.email 存库一致。
 * @param {unknown} email
 * @returns {string|null}
 */
function normalizeEmail(email) {
  if (email == null || typeof email !== 'string') return null;
  const t = email.trim().toLowerCase();
  return t.length ? t : null;
}

/**
 * MyPal 用户邮箱 → 本系统 `employees.id`。
 * 入参应与 MyPal `seedId` 同值；历史导出亦可能标为 `unique_code` / `user_uid`（均为邮箱，见 `docs/specs/01-DATA-MODEL.md` §9）。
 * 未配置邮箱或未命中时返回 null。
 * @param {string} email
 * @returns {string|null}
 */
function getEmployeeIdByMypalEmail(email) {
  const norm = normalizeEmail(email);
  if (!norm) return null;
  const row = db.get(
    'SELECT id FROM employees WHERE lower(trim(email)) = ?',
    [norm]
  );
  return row ? row.id : null;
}

module.exports = { normalizeEmail, getEmployeeIdByMypalEmail };
