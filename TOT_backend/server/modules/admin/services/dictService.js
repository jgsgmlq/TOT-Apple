'use strict';

var dictCrud = require('../crud/dictCrud');

function getDictByType(type) { return dictCrud.getDictByType(type); }
function getDictList(o) { return dictCrud.getDictList(o); }
function createDict(d) { if (!d.dictType || !d.dictValue) { var e = new Error('字典类型和值不能为空'); e.status = 400; throw e; } return dictCrud.createDict(d); }
function updateDict(id, d) { return dictCrud.updateDict(id, d); }
function deleteDict(id) { return dictCrud.deleteDict(id); }

module.exports = { getDictByType: getDictByType, getDictList: getDictList, createDict: createDict, updateDict: updateDict, deleteDict: deleteDict };
