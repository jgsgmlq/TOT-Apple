'use strict';

const jwt = require('jsonwebtoken');
const { createError } = require('./errorHandler');

const JWT_SECRET = process.env.JWT_SECRET || 'mvp-training-secret-2026';

/**
 * authenticate — 验证 JWT，注入 req.user
 * req.user = { id, username, role, storeId, employeeId }
 */
function authenticate(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return next(createError(401, '未提供认证 Token', 'AUTH_001'));
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = {
      id:         payload.id,
      username:   payload.username,
      role:       payload.role,
      storeId:    payload.storeId ?? null,
      employeeId: payload.employeeId ?? null,
    };
    next();
  } catch (e) {
    next(createError(401, 'Token 无效或已过期', 'AUTH_002'));
  }
}

/**
 * requireRole — 角色白名单校验（在 authenticate 之后使用）
 * 用法：requireRole('central')  或  requireRole(['central', 'admin'])
 */
function requireRole(roles) {
  const allowed = Array.isArray(roles) ? roles : [roles];
  return (req, res, next) => {
    if (!allowed.includes(req.user.role)) {
      return next(createError(403, '权限不足', 'AUTH_003'));
    }
    next();
  };
}

module.exports = { authenticate, requireRole, JWT_SECRET };
