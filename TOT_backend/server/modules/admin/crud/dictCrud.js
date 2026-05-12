'use strict';

var getDb = require('../../common/db/connection').getDb;

function getDictById(id) {
  return getDb().prepare('SELECT * FROM dictionary WHERE dict_id = ?').get(id) ?? null;
}
function getDictByType(dictType) {
  return getDb().prepare('SELECT * FROM dictionary WHERE dict_type = ? AND enabled_flag = 1 ORDER BY sort_order').all(dictType);
}
function getDictList(o) {
  var d = o || {}, c = [], p = [];
  if (d.dictType) { c.push('dict_type = ?'); p.push(d.dictType); }
  var w = c.length ? 'WHERE ' + c.join(' AND ') : '';
  return getDb().prepare('SELECT * FROM dictionary ' + w + ' ORDER BY dict_type, sort_order').all.apply(null, p);
}
function createDict(d) {
  var db = getDb();
  db.prepare('INSERT INTO dictionary (dict_id, dict_type, dict_value, sort_order, enabled_flag, created_at) VALUES (?, ?, ?, ?, ?, datetime(\'now\', \'localtime\'))').run(d.id, d.dictType, d.dictValue, d.sortOrder || 0, d.enabledFlag || 1);
  return getDictById(d.id);
}
function updateDict(id, d) {
  var k = Object.keys(d).filter(function(x) { return d[x] !== undefined; });
  if (!k.length) return getDictById(id);
  var s = k.map(function(x) { return x + ' = ?'; }).join(', ');
  var v = k.map(function(x) { return d[x]; });
  getDb().prepare('UPDATE dictionary SET ' + s + ' WHERE dict_id = ?').run.apply(null, v.concat([id]));
  return getDictById(id);
}
function deleteDict(id) {
  var r = getDb().prepare('DELETE FROM dictionary WHERE dict_id = ?').run(id);
  return r.changes > 0;
}

module.exports = { getDictById: getDictById, getDictByType: getDictByType, getDictList: getDictList, createDict: createDict, updateDict: updateDict, deleteDict: deleteDict };
