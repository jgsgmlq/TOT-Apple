'use strict';

var getDb = require('../../common/db/connection').getDb;

function getHqById(id) {
  return getDb().prepare('SELECT * FROM reseller_headquarter WHERE reseller_hq_id = ?').get(id) ?? null;
}
function getHqByAppleId(appleId) {
  return getDb().prepare('SELECT * FROM reseller_headquarter WHERE hq_apple_id = ?').get(appleId) ?? null;
}
function getHqList(o) {
  var d = o || {}, c = [], p = [];
  if (d.country) { c.push('country_region_name = ?'); p.push(d.country); }
  if (d.rtm4) { c.push('rtm4_name = ?'); p.push(d.rtm4); }
  var w = c.length ? 'WHERE ' + c.join(' AND ') : '';
  return getDb().prepare('SELECT * FROM reseller_headquarter ' + w + ' ORDER BY reseller_name LIMIT ? OFFSET ?').all.apply(null, p.concat([d.limit || 200, d.offset || 0]));
}

function getStoreById(id) {
  return getDb().prepare('SELECT * FROM reseller_store WHERE reseller_store_id = ?').get(id) ?? null;
}
function getStoreByAppleId(appleId) {
  return getDb().prepare('SELECT * FROM reseller_store WHERE store_apple_id = ?').get(appleId) ?? null;
}
function getStoreList(o) {
  var d = o || {}, c = [], p = [];
  if (d.hqAppleId) { c.push('hq_apple_id = ?'); p.push(d.hqAppleId); }
  if (d.rtm4) { c.push('rtm4_name = ?'); p.push(d.rtm4); }
  if (d.subRegion) { c.push('sub_region_code = ?'); p.push(d.subRegion); }
  if (d.storeAppleIds && d.storeAppleIds.length) { c.push('store_apple_id IN (' + d.storeAppleIds.map(function() { return '?'; }).join(',') + ')'); Array.prototype.push.apply(p, d.storeAppleIds); }
  var w = c.length ? 'WHERE ' + c.join(' AND ') : '';
  return getDb().prepare('SELECT * FROM reseller_store ' + w + ' ORDER BY store_name LIMIT ? OFFSET ?').all.apply(null, p.concat([d.limit || 200, d.offset || 0]));
}
function getStorePage(o) {
  var d = o || {}, c = [], p = [];
  if (d.hqAppleId) { c.push('hq_apple_id = ?'); p.push(d.hqAppleId); }
  if (d.rtm4) { c.push('rtm4_name = ?'); p.push(d.rtm4); }
  var w = c.length ? 'WHERE ' + c.join(' AND ') : '';
  var t = getDb().prepare('SELECT COUNT(*) AS c FROM reseller_store ' + w).get.apply(null, p).c;
  var r = getDb().prepare('SELECT * FROM reseller_store ' + w + ' ORDER BY store_name LIMIT ? OFFSET ?').all.apply(null, p.concat([d.pageSize, (d.page - 1) * d.pageSize]));
  return { rows: r, total: t, page: d.page, pageSize: d.pageSize };
}

module.exports = { getHqById: getHqById, getHqByAppleId: getHqByAppleId, getHqList: getHqList, getStoreById: getStoreById, getStoreByAppleId: getStoreByAppleId, getStoreList: getStoreList, getStorePage: getStorePage };
