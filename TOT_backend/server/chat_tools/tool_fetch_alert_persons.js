'use strict';

const { paginatedQuery } = require('./shared/pagination');
const taskCrud = require('../modules/task/crud/taskCrud');

module.exports = {
  schema: {
    type: 'function',
    function: {
      name: 'fetch_alert_persons',
      description: '获取预警人员名单（learner_task_reminder 真实催办记录）。当用户问"P0预警""P1预警""哪些人收到了P0催办"时使用。注意：这与任务优先级(urgency_level)是不同概念——本工具查的是实际已发出的预警记录。',
      parameters: {
        type: 'object',
        required: ['task_id', 'alert_level'],
        properties: {
          task_id: { type: 'string', description: '任务标识（task_publish_id 或任务标题）' },
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
    let rawId = (args.task_id || '').trim();
    if (!rawId) {
      return { success: false, errorCode: 'MISSING_PARAM', message: '参数 task_id 是必填的' };
    }


    const level = String(args.alert_level || '').toLowerCase();
    const baseSql = `FROM learner_task_reminder ltr
       JOIN learner_account la ON ltr.email_id = la.email_id
       WHERE ltr.task_publish_id = ? AND LOWER(ltr.reminder_level) = ?`;
    const params = [rawId, level];

    const { total, rows, page, pageSize } = await paginatedQuery({
      countSql: `SELECT COUNT(*) AS c ${baseSql}`,
      dataSql: `SELECT la.learner_id, la.email_id, la.sales_name, la.store_apple_id,
              la.rtm_level_3_name, la.rtm_level_4_name,
              la.reseller_localized_name, la.hq_reseller_localized_name,
              ltr.reminder_level, ltr.reminder_at, ltr.reminder_result ${baseSql}
       ORDER BY ltr.reminder_at DESC`,
      countParams: params,
      dataParams: params,
      page: args.page ?? 1,
      pageSize: args.page_size ?? 50,
      rowMapper: r => ({
        user_id: r.learner_id, email: r.email_id, name: r.sales_name,
        alert_level: r.reminder_level || args.alert_level,
        alert_result: r.reminder_result,
        alerted_at: r.reminder_at,
        completion_status: '未完成',
        store: r.store_apple_id, dealer: r.reseller_localized_name,
        l3: r.rtm_level_3_name, l4: r.rtm_level_4_name
      }),
    });

    return {
      success: true,
      data: { task_id: rawId, alert_level: args.alert_level, total_count: total, page, page_size: pageSize, rows }
    };
  }
};
