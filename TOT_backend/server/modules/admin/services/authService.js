'use strict';

const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const accountCrud = require('../crud/accountCrud');
const E = require('../../common/errorCodes');

const { JWT_SECRET } = require('../../common/middleware/auth');

async function login(username, password) {
  if (!username || !password) {
    const err = new Error(E.AUTH_001.message);
    err.status = E.AUTH_001.code;
    throw err;
  }

  const account = await accountCrud.getAccountByEmail(username);
  if (!account) {
    const err = new Error(E.ADMIN_101.message);
    err.status = E.ADMIN_101.code;
    throw err;
  }

  if (!account.enabled_flag) {
    const err = new Error(E.ADMIN_102.message);
    err.status = E.ADMIN_102.code;
    throw err;
  }

  const match = bcrypt.compareSync(password, account.login_password);
  if (!match) {
    const err = new Error(E.ADMIN_101.message);
    err.status = E.ADMIN_101.code;
    throw err;
  }

  await accountCrud.updateLastLogin(account.account_id);

  const payload = {
    id: account.account_id,
    username: account.email_id,
    role: account.account_role,
  };

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

  return {
    token,
    userInfo: {
      userId: String(account.account_id),
      username: account.email_id,
      name: account.account_name,
      role: account.account_role,
      enabled: !!account.enabled_flag,
    },
  };
}

async function getProfile(accountId) {
  const account = await accountCrud.getAccountById(accountId);
  if (!account) {
    const err = new Error(E.ADMIN_100.message);
    err.status = E.ADMIN_100.code;
    throw err;
  }
  return {
    userId: String(account.account_id),
    username: account.email_id,
    name: account.account_name,
    role: account.account_role,
    rtm: account.rtm || null,
    enabled: !!account.enabled_flag,
  };
}

async function changePassword(accountId, oldPw, newPw) {
  const account = await accountCrud.getAccountById(accountId);
  if (!account) {
    const err = new Error(E.ADMIN_100.message);
    err.status = E.ADMIN_100.code;
    throw err;
  }

  const match = bcrypt.compareSync(oldPw, account.login_password);
  if (!match) {
    const err = new Error(E.ADMIN_101.message);
    err.status = E.ADMIN_101.code;
    throw err;
  }

  if (!newPw || newPw.length < 6) {
    const err = new Error('新密码长度不能小于 6 位');
    err.status = 400;
    throw err;
  }

  const hashed = bcrypt.hashSync(newPw, 10);
  await accountCrud.updateAccount(accountId, { login_password: hashed });
}

module.exports = { login, getProfile, changePassword };
