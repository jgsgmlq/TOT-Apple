'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { db } = require('../db');
const { authenticate, JWT_SECRET } = require('../middleware/auth');
const { createError } = require('../middleware/errorHandler');

const router = express.Router();

/**
 * POST /api/v1/auth/login
 * 公开接口，无需认证
 */
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      throw createError(400, '用户名和密码不能为空', 'AUTH_004');
    }

    // 支持通过 username (如 'central') 或 employee email (如 'e001@mypal.seed.local') 登录
    const user = db.get(
      `SELECT u.id, u.username, u.password_hash, u.role, u.store_id, u.employee_id,
              e.name AS employee_name, s.name AS store_name
       FROM users u
       LEFT JOIN employees e ON u.employee_id = e.id
       LEFT JOIN stores s ON u.store_id = s.id
       WHERE u.username = ? OR e.email = ?`,
      [username, username]
    );

    if (!user) {
      throw createError(401, '用户名或密码错误', 'AUTH_005');
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      throw createError(401, '用户名或密码错误', 'AUTH_005');
    }

    const payload = {
      id:         user.id,
      username:   user.username,
      role:       user.role,
      storeId:    user.store_id,
      employeeId: user.employee_id,
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      code: 200,
      message: 'success',
      data: {
        token,
        userInfo: {
          userId:       String(user.id),
          employeeId:   user.employee_id,
          employeeName: user.employee_name || null,
          username:     user.username,
          role:         user.role,
          storeId:      user.store_id,
          storeName:    user.store_name || null,
        },
      },
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/auth/me
 * 鉴权联调接口：返回当前 token 对应的用户信息
 */
router.get('/me', authenticate, (req, res, next) => {
  try {
    const user = db.get(
      `SELECT u.id, u.username, u.role, u.store_id, u.employee_id, u.created_at,
              e.name AS employee_name, s.name AS store_name
       FROM users u
       LEFT JOIN employees e ON u.employee_id = e.id
       LEFT JOIN stores s ON u.store_id = s.id
       WHERE u.id = ?`,
      [req.user.id]
    );
    if (!user) {
      throw createError(401, '用户不存在或会话失效', 'AUTH_006');
    }

    res.json({
      code: 200,
      message: 'success',
      data: {
        userId:       String(user.id),
        username:     user.username,
        role:         user.role,
        storeId:      user.store_id,
        storeName:    user.store_name || null,
        employeeId:   user.employee_id,
        employeeName: user.employee_name || null,
        createdAt:    user.created_at,
      },
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

