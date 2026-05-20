'use strict';

const accountCrud = require('../crud/accountCrud');
const E = require('../../common/errorCodes');

const getAccountList = async (o) => { return await accountCrud.getAccountList(o); };

const getAccountById = async (id) => {
  const a = await accountCrud.getAccountById(id);
  if (!a) {
    const e = new Error(E.ADMIN_100.message);
    e.status = E.ADMIN_100.code;
    throw e;
  }
  return a;
};

const getAccountPage = async (o) => { return await accountCrud.getAccountPage(o); };

const createAccount = async (d) => {
  if (!d.emailId) {
    const e = new Error('邮箱不能为空');
    e.status = 400;
    throw e;
  }
  const exist = await accountCrud.getAccountByEmail(d.emailId);
  if (exist) {
    const e = new Error(E.ADMIN_001.message);
    e.status = E.ADMIN_001.code;
    throw e;
  }
  return await accountCrud.createAccount(d);
};

const updateAccount = async (id, d) => {
  const a = await accountCrud.getAccountById(id);
  if (!a) {
    const e = new Error(E.ADMIN_100.message);
    e.status = E.ADMIN_100.code;
    throw e;
  }
  return await accountCrud.updateAccount(id, d);
};

const deleteAccount = async (id) => { return await accountCrud.deleteAccount(id); };

module.exports = {
  getAccountList,
  getAccountById,
  getAccountPage,
  createAccount,
  updateAccount,
  deleteAccount,
};
