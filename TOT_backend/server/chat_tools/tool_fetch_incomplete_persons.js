'use strict';

const taskCrud = require('../modules/task/crud/taskCrud');

module.exports = {
  schema: {
    type: 'function',
    function: {
      name: 'fetch_incomplete_persons',
      description: '获取未完成人员名单。当用户问"谁还没完成""把名单给我"时使用。',
      parameters: {
        type: 'object',
        required: ['task_id'],
        properties: {
          task_id: { type: 'string', description: '任务标识（名称模糊匹配或 ID 精确匹配）' },
          filter: { type: 'object', description: '组织层级筛选: {l3: "华东大区", store: "xxx"}' },
          page_size: { type: 'integer', description: '每页条数，默认 50' },
          page: { type: 'integer', description: '页码，默认 1' }
        }
      }
    }
  },
  meta: {
    enabled: true,
    requiredRole: ['executive', 'central', 'admin'],
    scopePolicy: 'regional_scoped',
    timeoutMs: 15000
  },
  handler: async (args, regionScope) => {
    const taskId = (args.task_id || '').trim();
    if (!taskId) {
      return { success: false, errorCode: 'MISSING_PARAM', message: '参数 task_id 是必填的' };
    }

    const page = args.page || 1;
    const pageSize = args.page_size || 50;
    const result = await taskCrud.getQueuePage({ taskPublishId: taskId, status: 'pending', page, pageSize });
    const queues = result && result.data ? result.data : (Array.isArray(result) ? result : []);

    const rows = (Array.isArray(queues) ? queues : []).map(q => ({
      user_id: q.email_id || q.emailId, name: q.learner_name || q.learnerName,
      completion_status: '未完成',
      store: q.store_name || q.storeName, dealer: q.dealer_name || q.dealerName,
      l3: q.region, l4: q.format
    }));

    return {
      success: true,
      data: {
        task_id: taskId, total_count: result.total || rows.length,
        page, page_size: pageSize, rows
      }
    };
  }
};
