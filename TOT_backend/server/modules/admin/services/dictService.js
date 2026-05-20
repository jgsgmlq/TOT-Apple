'use strict';

const dictCrud = require('../crud/dictCrud');

const getDictByType = async (type) => { return await dictCrud.getDictByType(type); };

const getDictList = async (o) => { return await dictCrud.getDictList(o); };

const createDict = async (d) => {
  if (!d.dictType || !d.dictValue) {
    const e = new Error('字典类型和值不能为空');
    e.status = 400;
    throw e;
  }
  return await dictCrud.createDict(d);
};

const updateDict = async (id, d) => { return await dictCrud.updateDict(id, d); };

const deleteDict = async (id) => { return await dictCrud.deleteDict(id); };

module.exports = {
  getDictByType,
  getDictList,
  createDict,
  updateDict,
  deleteDict,
};
