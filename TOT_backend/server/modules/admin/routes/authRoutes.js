'use strict';

const express = require('express');
const authService = require('../services/authService');
const { authenticate } = require('../../common/middleware/auth');
const { success } = require('../../common/responseHelper');

const router = express.Router();

router.post('/login', async function(req, res, next) {
  try {
    const { username, password } = req.body;
    const result = await authService.login(username, password);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

router.get('/me', authenticate, async function(req, res, next) {
  try {
    const profile = await authService.getProfile(req.user.id);
    res.json(success(profile));
  } catch (err) {
    next(err);
  }
});

router.post('/change-password', authenticate, async function(req, res, next) {
  try {
    const { oldPassword, newPassword } = req.body;
    await authService.changePassword(req.user.id, oldPassword, newPassword);
    res.json(success({ message: '密码修改成功' }));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
