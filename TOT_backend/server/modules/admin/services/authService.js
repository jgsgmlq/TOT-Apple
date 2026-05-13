'use strict';

var jwt = require('jsonwebtoken');
var bcrypt = require('bcrypt');
var accountCrud = require('../crud/accountCrud');
var { JWT_SECRET } = require('../../common/middleware/auth');
var E = require('../../common/errorCodes');

function login(username, password) {
  if (!username || !password) {
    var err = new Error(E.AUTH_001.message);
    err.status = E.AUTH_001.code;
    throw err;
  }

  var account = accountCrud.getAccountByEmail(username);
  if (!account) {
    var err2 = new Error(E.ADMIN_101.message);
    err2.status = E.ADMIN_101.code;
    throw err2;
  }

  if (!account.user_enabled_indicator) {
    var err3 = new Error(E.ADMIN_102.message);
    err3.status = E.ADMIN_102.code;
    throw err3;
  }

  var match = bcrypt.compareSync(password, account.login_password);
  if (!match && password !== account.login_password) {
    var err4 = new Error(E.ADMIN_101.message);
    err4.status = E.ADMIN_101.code;
    throw err4;
  }

  accountCrud.updateLastLogin(account.account_id);

  var payload = {
    id: account.account_id,
    username: account.email_id,
    role: account.account_role,
  };

  var token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

  return {
    token: token,
    userInfo: {
      userId: String(account.account_id),
      username: account.email_id,
      name: account.account_name,
      role: account.account_role,
      enabled: !!account.user_enabled_indicator,
    },
  };
}

function getProfile(accountId) {
  var account = accountCrud.getAccountById(accountId);
  if (!account) {
    var err = new Error(E.ADMIN_100.message);
    err.status = E.ADMIN_100.code;
    throw err;
  }
  return {
    userId: String(account.account_id),
    username: account.email_id,
    name: account.account_name,
    role: account.account_role,
    appleRoleName: account.apple_role_name,
    businessRoleName: account.user_business_role_name,
    enabled: !!account.user_enabled_indicator,
  };
}

function changePassword(accountId, oldPw, newPw) {
  var account = accountCrud.getAccountById(accountId);
  if (!account) {
    var err = new Error(E.ADMIN_100.message);
    err.status = E.ADMIN_100.code;
    throw err;
  }

  var match = bcrypt.compareSync(oldPw, account.login_password);
  if (!match && oldPw !== account.login_password) {
    var err2 = new Error(E.ADMIN_101.message);
    err2.status = E.ADMIN_101.code;
    throw err2;
  }

  if (!newPw || newPw.length < 6) {
    var err3 = new Error('新密码长度不能小于 6 位');
    err3.status = 400;
    throw err3;
  }

  var hashed = bcrypt.hashSync(newPw, 10);
  accountCrud.updateAccount(accountId, { login_password: hashed });
}

module.exports = { login: login, getProfile: getProfile, changePassword: changePassword };
