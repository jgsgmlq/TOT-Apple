'use strict';

var storeCrud = require('../crud/storeCrud');

function getStoreList(o) { return storeCrud.getStoreList(o); }
function getStoreById(id) { var s = storeCrud.getStoreById(id); if (!s) { var e = new Error('门店不存在'); e.status = 400; throw e; } return s; }
function getStoreByAppleId(id) { return storeCrud.getStoreByAppleId(id); }
function getStorePage(o) { return storeCrud.getStorePage(o); }
function getHqList(o) { return storeCrud.getHqList(o); }

module.exports = { getStoreList: getStoreList, getStoreById: getStoreById, getStoreByAppleId: getStoreByAppleId, getStorePage: getStorePage, getHqList: getHqList };
