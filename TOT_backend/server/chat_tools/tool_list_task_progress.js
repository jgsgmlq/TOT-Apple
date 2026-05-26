'use strict';

const taskCrud = require('../modules/task/crud/taskCrud');
const queryEngine = require('../modules/dashboard/services/queryEngine');

module.exports = {
  schema: {
    type: 'function',
    function: {
      name: 'list_task_progress',
      description: '批量查询多个任务的进度摘要。默认自动排除已截止的过期任务，查进行中/当前任务时无需参数。查所有/全部含已过期→status:"all"；查已结束/历史→status:"ended"；查逾期/超时→status:"all"后自行按deadline筛选；查快过期/临期→filters:{days_to_deadline_max:7}。排序：查最紧急/优先级最高→sort_by:"priority"；查截止日期最近→sort_by:"deadline"+sort_order:"asc"；查完成率最高→sort_by:"completion_rate"+sort_order:"desc"；查完成率最低→sort_order:"asc"。',
      parameters: {
        type: 'object',
        properties: {
          task_ids: { type: 'array', items: { type: 'string' }, description: '任务标识列表；不传则返回全部进行中的任务' },
          status: { type: 'string', enum: ['active', 'ended', 'all'], description: '过滤任务状态，默认 active' },
          filters: { type: 'object', description: '筛选条件: {completion_rate_max: 0.5, completion_rate_min: 0, days_to_deadline_max: 3}' },
          sort_by: { type: 'string', enum: ['deadline', 'completion_rate', 'priority', 'created_at'], description: '排序字段' },
          sort_order: { type: 'string', enum: ['asc', 'desc'], description: '排序方向，默认 desc' }
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
    const statuses = args.status === 'ended'
      ? ['ended'] : args.status === 'all'
      ? ['dispatched', 'ended'] : ['dispatched'];

    const tasks = await taskCrud.getTaskList({ statuses });

    if (!tasks || tasks.length === 0) {
      return { success: true, data: { total_count: 0, rows: [] } };
    }

    const rows = await Promise.all(tasks.slice(0, 50).map(async (t) => {
      const tid = t.task_publish_id;
      try {
        const ov = await queryEngine.getOverviewBoardData({ taskId: tid });
        return {
          task_id: tid, task_name: t.task_title,
          platform: (() => { try { return JSON.parse(t.platform_scope || '[]')[0] || null; } catch (_) { return null; } })(),
          priority: t.urgency_level,
          completion_rate: ov ? ov.completionRate : 0,
          learning_rate: ov ? (ov.taskReadRate || ov.taskReachRate || 0) : 0,
          deadline: t.due_date,
          learning_count: ov ? (ov.learningCount || ov.inProgressCount || 0) : 0
        };
      } catch (_) {
        return { task_id: tid, task_name: t.task_title, platform: null, priority: t.urgency_level, completion_rate: 0, learning_rate: 0, deadline: t.due_date, learning_count: 0 };
      }
    }));

    const sortBy = args.sort_by || 'created_at';
    const order = args.sort_order === 'asc' ? 1 : -1;
    if (sortBy === 'completion_rate') {
      rows.sort((a, b) => (a.completion_rate - b.completion_rate) * order);
    } else if (sortBy === 'deadline') {
      rows.sort((a, b) => String(a.deadline || '').localeCompare(String(b.deadline || '')) * order);
    }

    const now = new Date();
    const nowTs = now.getTime();

    let filtered = rows;

    if (args.filters) {
      if (args.filters.completion_rate_max != null) {
        filtered = filtered.filter(r => r.completion_rate <= args.filters.completion_rate_max);
      }
      if (args.filters.completion_rate_min != null) {
        filtered = filtered.filter(r => r.completion_rate >= args.filters.completion_rate_min);
      }
      if (args.filters.days_to_deadline_max != null) {
        const maxDate = new Date(nowTs + args.filters.days_to_deadline_max * 86400000);
        filtered = filtered.filter(r => {
          if (!r.deadline) return false;
          const d = new Date(r.deadline);
          return !isNaN(d.getTime()) && d <= maxDate;
        });
      }
    }

    return { success: true, data: { total_count: filtered.length, rows: filtered } };
  }
};
