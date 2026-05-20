'use strict';

const { get, all, run } = require('../../common/db/mysql');

async function getAccountById(id) {
  return await get('SELECT * FROM account WHERE account_id = ?', [id]);
}

async function getAccountByEmail(emailId) {
  return await get('SELECT * FROM account WHERE email_id = ?', [emailId]);
}

async function getAccountList(o) {
  const d = o || {};
  const c = []; const p = [];
  if (d.role) { c.push('account_role = ?'); p.push(d.role); }
  if (d.enabledFlag !== undefined) { c.push('enabled_flag = ?'); p.push(d.enabledFlag); }
  const w = c.length ? 'WHERE ' + c.join(' AND ') : '';
  return await all(
    'SELECT * FROM account ' + w + ' ORDER BY account_id LIMIT ? OFFSET ?',
    p.concat([d.limit || 50, d.offset || 0])
  );
}

async function getAccountPage(o) {
  const d = o || {};
  const c = []; const p = [];
  if (d.role) { c.push('account_role = ?'); p.push(d.role); }
  const w = c.length ? 'WHERE ' + c.join(' AND ') : '';
  const row = await get('SELECT COUNT(*) AS c FROM account ' + w, p);
  const rows = await all(
    'SELECT * FROM account ' + w + ' ORDER BY account_id LIMIT ? OFFSET ?',
    p.concat([d.pageSize, (d.page - 1) * d.pageSize])
  );
  return { rows, total: row.c, page: d.page, pageSize: d.pageSize };
}

async function createAccount(d) {
  await run(
    'INSERT INTO account (account_id, email_id, account_name, login_password, account_role, rtm, enabled_flag) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?)',
    [d.id, d.emailId, d.name, d.password, d.role, d.rtm || null, d.enabledFlag || 1]
  );
  return await getAccountById(d.id);
}

async function updateAccount(id, d) {
  const k = Object.keys(d).filter(function(x) { return d[x] !== undefined; });
  if (!k.length) return await getAccountById(id);
  const s = k.map(function(x) { return x + ' = ?'; }).join(', ');
  const v = k.map(function(x) { return d[x]; });
  await run('UPDATE account SET ' + s + ' WHERE account_id = ?', v.concat([id]));
  return await getAccountById(id);
}

async function updateLastLogin(id) {
  await run(
    'UPDATE account SET login_date = NOW() WHERE account_id = ?',
    [id]
  );
}

async function deleteAccount(id) {
  const r = await run('DELETE FROM account WHERE account_id = ?', [id]);
  return r.changes > 0;
}

module.exports = {
  getAccountById,
  getAccountByEmail,
  getAccountList,
  getAccountPage,
  createAccount,
  updateAccount,
  updateLastLogin,
  deleteAccount,
};
