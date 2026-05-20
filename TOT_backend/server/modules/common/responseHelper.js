'use strict';

/**
 * 统一 API 响应格式工具
 *
 * 成功: { code: 200, message: "success", data: {...}, requestId: "..." }
 * 列表: { code: 200, data: { list: [...], pagination: {...} } }
 * 错误: { code: 400, message: "...", errorCode: "TASK_001", data: null }
 */

function success(data, requestId) {
  const body = { code: 200, message: 'success', data };
  if (requestId) body.requestId = requestId;
  return body;
}

function paginated(list, pagination, requestId) {
  const body = { code: 200, data: { list, pagination } };
  if (requestId) body.requestId = requestId;
  return body;
}

function fail(message, code = 400, errorCode = '', requestId) {
  const body = { code, message, data: null };
  if (errorCode) body.errorCode = errorCode;
  if (requestId) body.requestId = requestId;
  return body;
}

module.exports = { success, paginated, fail };
