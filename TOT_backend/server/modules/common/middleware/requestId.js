'use strict';

const { formatNowSqliteLocal } = require('../utils/ddlAt');

function requestId(req, res, next) {
  const ts = formatNowSqliteLocal().replace(/\D/g, '').slice(0, 14);
  const rand = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
  req.requestId = `req-${ts}-${rand}`;
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

module.exports = requestId;
