'use strict';

const queryEngine = require('../modules/dashboard/services/queryEngine');
const mysqlCrud = require('../modules/dashboard/crud/dashboardMysqlCrud');

module.exports = {
  schema: {
    type: 'function',
    function: {
      name: 'fetch_alert_persons',
      description: '获取预警人员名单。当用户问"P0的有哪些人"时使用。',
      parameters: {
        type: 'object',
        required: ['task_id', 'alert_level'],
        properties: {
          task_id: { type: 'string', description: '任务标识（名称模糊匹配或 ID 精确匹配）' },
          alert_level: { type: 'string', enum: ['P0', 'P1', 'P2'], description: '预警级别' },
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
    const rawId = (args.task_id || '').trim();
    if (!rawId) {
      return { success: false, errorCode: 'MISSING_PARAM', message: '参数 task_id 是必填的' };
    }

    let taskId = rawId;
    const matches = await mysqlCrud.searchTasks(rawId.toLowerCase());
    if (matches.length > 0) taskId = matches[0].task_publish_id;

    const level = String(args.alert_level || '').toLowerCase();
    const warnings = await queryEngine.getWarningsBoardData({
      taskId, warningLevel: level,
      pageNum: args.page || 1, pageSize: args.page_size || 50
    });

    const list = warnings && warnings.list ? warnings.list : [];
    const rows = list.map(w => ({
      user_id: w.email_id, name: w.learner_name,
      alert_level: args.alert_level, completion_status: '未完成',
      store: w.store_name, dealer: w.dealer_name, l3: w.region
    }));

    return {
      success: true,
      data: {
        task_id: taskId, alert_level: args.alert_level,
        total_count: warnings.pagination?.total || rows.length,
        page: args.page || 1, rows
      }
    };
  }
};
