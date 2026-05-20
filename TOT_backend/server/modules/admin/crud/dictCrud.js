'use strict';

const { get, all, run } = require('../../common/db/mysql');

async function getDictById(id) {
  return await get('SELECT * FROM dictionary WHERE dict_id = ?', [id]);
}

async function getDictByType(dictType) {
  return await all(
    'SELECT * FROM dictionary WHERE dict_type = ? ORDER BY dict_id',
    [dictType]
  );
}

async function getDictList(o) {
  const d = o || {};
  const c = []; const p = [];
  if (d.dictType) { c.push('dict_type = ?'); p.push(d.dictType); }
  const w = c.length ? 'WHERE ' + c.join(' AND ') : '';
  return await all(
    'SELECT * FROM dictionary ' + w + ' ORDER BY dict_type, dict_id LIMIT ? OFFSET ?',
    p.concat([d.limit || 200, d.offset || 0])
  );
}

async function createDict(d) {
  await run(
    'INSERT INTO dictionary (dict_id, dict_type, dict_value) VALUES (?, ?, ?)',
    [d.id, d.dictType, d.dictValue]
  );
  return await getDictById(d.id);
}

async function updateDict(id, d) {
  const k = Object.keys(d).filter(function(x) { return d[x] !== undefined; });
  if (!k.length) return await getDictById(id);
  const s = k.map(function(x) { return x + ' = ?'; }).join(', ');
  const v = k.map(function(x) { return d[x]; });
  await run('UPDATE dictionary SET ' + s + ' WHERE dict_id = ?', v.concat([id]));
  return await getDictById(id);
}

async function deleteDict(id) {
  const r = await run('DELETE FROM dictionary WHERE dict_id = ?', [id]);
  return r.changes > 0;
}

module.exports = {
  getDictById,
  getDictByType,
  getDictList,
  createDict,
  updateDict,
  deleteDict,
};
