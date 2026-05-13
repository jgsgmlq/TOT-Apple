'use strict';

var getDb = require('../../common/db/connection').getDb;

function getAccountById(id) {
  return getDb().prepare('SELECT * FROM account WHERE account_id = ?').get(id) ?? null;
}

function getAccountByEmail(emailId) {
  return getDb().prepare('SELECT * FROM account WHERE email_id = ?').get(emailId) ?? null;
}

function getAccountList(o) {
  var d = o || {}, c = [], p = [];
  if (d.role) { c.push('account_role = ?'); p.push(d.role); }
  if (d.enabledFlag !== undefined) { c.push('user_enabled_indicator = ?'); p.push(d.enabledFlag); }
  var w = c.length ? 'WHERE ' + c.join(' AND ') : '';
  return getDb().prepare(
    'SELECT * FROM account ' + w + ' ORDER BY account_id LIMIT ? OFFSET ?'
  ).all.apply(null, p.concat([d.limit || 50, d.offset || 0]));
}

function getAccountPage(o) {
  var d = o || {}, c = [], p = [];
  if (d.role) { c.push('account_role = ?'); p.push(d.role); }
  var w = c.length ? 'WHERE ' + c.join(' AND ') : '';
  var t = getDb().prepare('SELECT COUNT(*) AS c FROM account ' + w).get.apply(null, p).c;
  var r = getDb().prepare(
    'SELECT * FROM account ' + w + ' ORDER BY account_id LIMIT ? OFFSET ?'
  ).all.apply(null, p.concat([d.pageSize, (d.page - 1) * d.pageSize]));
  return { rows: r, total: t, page: d.page, pageSize: d.pageSize };
}

function createAccount(d) {
  var db = getDb();
  db.prepare(
    'INSERT INTO account (account_id, email_id, account_name, login_password, account_role, ' +
    'apple_role_name, user_business_role_name, user_enabled_indicator, white_plus_ind, ' +
    'platform_scope, rtm_scope, executive_regions, executive_rtm, created_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\', \'localtime\'))'
  ).run(d.id, d.emailId, d.name, d.password, d.role,
    d.appleRoleName, d.businessRoleName, d.enabledFlag || 1, d.whitePlusInd || 0,
    d.platformScope, d.rtmScope, d.executiveRegions, d.executiveRtm);
  return getAccountById(d.id);
}

function updateAccount(id, d) {
  var k = Object.keys(d).filter(function(x) { return d[x] !== undefined; });
  if (!k.length) return getAccountById(id);
  var s = k.map(function(x) { return x + ' = ?'; }).join(', ');
  var v = k.map(function(x) { return d[x]; });
  getDb().prepare(
    'UPDATE account SET ' + s + ' WHERE account_id = ?'
  ).run.apply(null, v.concat([id]));
  return getAccountById(id);
}

function updateLastLogin(id) {
  getDb().prepare(
    'UPDATE account SET last_login_at = datetime(\'now\', \'localtime\'), ' +
    'login_date = date(\'now\', \'localtime\') WHERE account_id = ?'
  ).run(id);
}

function updateFirstLogin(id) {
  getDb().prepare(
    'UPDATE account SET first_login_date = date(\'now\', \'localtime\') ' +
    'WHERE account_id = ? AND first_login_date IS NULL'
  ).run(id);
}

function deleteAccount(id) {
  var r = getDb().prepare('DELETE FROM account WHERE account_id = ?').run(id);
  return r.changes > 0;
}


module.exports = {
  getAccountById: getAccountById,
  getAccountByEmail: getAccountByEmail,
  getAccountList: getAccountList,
  getAccountPage: getAccountPage,
  createAccount: createAccount,
  updateAccount: updateAccount,
  updateLastLogin: updateLastLogin,
  updateFirstLogin: updateFirstLogin,
  deleteAccount: deleteAccount
};
