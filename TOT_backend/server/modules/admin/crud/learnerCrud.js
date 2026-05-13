'use strict';

var getDb = require('../../common/db/connection').getDb;

function getLearnerById(id) {
  return getDb().prepare('SELECT * FROM learner_account WHERE learner_id = ?').get(id) ?? null;
}
function getLearnerByEmail(emailId) {
  return getDb().prepare('SELECT * FROM learner_account WHERE email_id = ?').get(emailId) ?? null;
}
function getLearnerList(o) {
  var d = o || {}, c = [], p = [];
  if (d.storeAppleId) { c.push('store_apple_id = ?'); p.push(d.storeAppleId); }
  if (d.role) { c.push('apple_role_name = ?'); p.push(d.role); }
  if (d.emailIds && d.emailIds.length) { c.push('email_id IN (' + d.emailIds.map(function() { return '?'; }).join(',') + ')'); Array.prototype.push.apply(p, d.emailIds); }
  var w = c.length ? 'WHERE ' + c.join(' AND ') : '';
  return getDb().prepare('SELECT * FROM learner_account ' + w + ' ORDER BY email_id LIMIT ? OFFSET ?').all.apply(null, p.concat([d.limit || 200, d.offset || 0]));
}
function getLearnerPage(o) {
  var d = o || {}, c = [], p = [];
  if (d.storeAppleId) { c.push('store_apple_id = ?'); p.push(d.storeAppleId); }
  var w = c.length ? 'WHERE ' + c.join(' AND ') : '';
  var t = getDb().prepare('SELECT COUNT(*) AS c FROM learner_account ' + w).get.apply(null, p).c;
  var r = getDb().prepare('SELECT * FROM learner_account ' + w + ' ORDER BY email_id LIMIT ? OFFSET ?').all.apply(null, p.concat([d.pageSize, (d.page - 1) * d.pageSize]));
  return { rows: r, total: t, page: d.page, pageSize: d.pageSize };
}

module.exports = { getLearnerById: getLearnerById, getLearnerByEmail: getLearnerByEmail, getLearnerList: getLearnerList, getLearnerPage: getLearnerPage };
