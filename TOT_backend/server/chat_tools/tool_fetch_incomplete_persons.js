'use strict';

const { paginatedQuery } = require('./shared/pagination');
const taskCrud = require('../modules/task/crud/taskCrud');

module.exports = {
  schema: {
    type: 'function',
    function: {
      name: 'fetch_incomplete_persons',
      description: '获取未完成人员名单。当用户问谁还没完成/把名单给我/未完成名单时使用。传入 task_id 时优先用 task_publish_id 格式，也可以传任务标题（会自动解析）。',
      parameters: {
        type: 'object',
        required: ['task_id'],
        properties: {
          task_id: { type: 'string', description: '任务标识（task_publish_id 或任务标题）' },
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
    let taskId = (args.task_id || '').trim();
    if (!taskId) {
      return { success: false, errorCode: 'MISSING_PARAM', message: '参数 task_id 是必填的' };
    }


    const baseSql = `FROM task_publish_learner tpl
       JOIN learner_account la ON tpl.learner_id = la.learner_id
       INNER JOIN mypal_learning_progress_sync mps ON la.email_id = mps.email_id AND mps.required_flag = 1
       WHERE tpl.task_publish_id = ? AND mps.passed_time IS NULL`;
    const params = [taskId];

    const { total, rows, page, pageSize } = await paginatedQuery({
      countSql: `SELECT COUNT(DISTINCT la.learner_id) AS c ${baseSql}`,
      dataSql: `SELECT la.learner_id, la.email_id, la.sales_name, la.store_apple_id,
              la.rtm_level_3_name, la.rtm_level_4_name,
              la.reseller_localized_name, la.hq_reseller_localized_name ${baseSql}
       GROUP BY la.learner_id
       ORDER BY la.sales_name`,
      countParams: params,
      dataParams: params,
      page: args.page ?? 1,
      pageSize: args.page_size ?? 50,
      rowMapper: r => ({
        user_id: r.learner_id, email: r.email_id, name: r.sales_name,
        completion_status: '未完成',
        store: r.store_apple_id, dealer: r.reseller_localized_name,
        l3: r.rtm_level_3_name, l4: r.rtm_level_4_name
      }),
    });

    return {
      success: true,
      data: { task_id: taskId, total_count: total, page, page_size: pageSize, rows }
    };
  }
};
