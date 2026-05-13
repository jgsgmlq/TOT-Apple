'use strict';

var accountCrud = require('../crud/accountCrud');

function getAccountList(o) { return accountCrud.getAccountList(o); }
function getAccountById(id) { var a = accountCrud.getAccountById(id); if (!a) { var e = new Error('账户不存在'); e.status = 400; throw e; } return a; }
function getAccountPage(o) { return accountCrud.getAccountPage(o); }
function createAccount(d) { if (!d.emailId) { var e = new Error('邮箱不能为空'); e.status = 400; throw e; } var exist = accountCrud.getAccountByEmail(d.emailId); if (exist) { var e2 = new Error('账户已存在'); e2.status = 400; throw e2; } return accountCrud.createAccount(d); }
function updateAccount(id, d) { return accountCrud.updateAccount(id, d); }
function deleteAccount(id) { return accountCrud.deleteAccount(id); }

module.exports = { getAccountList: getAccountList, getAccountById: getAccountById, getAccountPage: getAccountPage, createAccount: createAccount, updateAccount: updateAccount, deleteAccount: deleteAccount };
