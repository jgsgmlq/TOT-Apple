'use strict';

/**
 * 统一 API 响应格式工具
 *
 * 成功: { code: 200, message: "success", data: {...}, requestId: "..." }
 * 列表: { code: 200, data: { list: [...], pagination: {...} } }
 * 错误: { code: 400, message: "...", errorCode: "TASK_001", data: null }
 */

function success(data) {
  return { code: 200, message: 'success', data };
}

function paginated(list, pagination) {
  return { code: 200, data: { list, pagination } };
}

function fail(message, code = 400, errorCode = '') {
  const body = { code, message, data: null };
  if (errorCode) body.errorCode = errorCode;
  return body;
}

module.exports = { success, paginated, fail };
