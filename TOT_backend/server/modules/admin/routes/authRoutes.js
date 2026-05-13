'use strict';

var express = require('express');
var authService = require('../services/authService');
var { authenticate } = require('../../common/middleware/auth');
var { success } = require('../../common/responseHelper');

var router = express.Router();

router.post('/login', function(req, res, next) {
  try {
    var { username, password } = req.body;
    var result = authService.login(username, password);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

router.get('/me', authenticate, function(req, res, next) {
  try {
    var profile = authService.getProfile(req.user.id);
    res.json(success(profile));
  } catch (err) {
    next(err);
  }
});

router.post('/change-password', authenticate, function(req, res, next) {
  try {
    var { oldPassword, newPassword } = req.body;
    authService.changePassword(req.user.id, oldPassword, newPassword);
    res.json(success({ message: '密码修改成功' }));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
