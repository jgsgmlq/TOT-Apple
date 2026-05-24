'use strict';

const queryEngine = require('../modules/dashboard/services/queryEngine');
const mysqlCrud = require('../modules/dashboard/crud/dashboardMysqlCrud');

module.exports = {
  schema: {
    type: 'function',
    function: {
      name: 'get_task_dashboard',
      description: '查询单个任务的全景数据（指标、漏斗、预警）。当用户指定了某个具体任务时使用。',
      parameters: {
        type: 'object',
        required: ['task_id'],
        properties: {
          task_id: { type: 'string', description: '任务标识（名称模糊匹配或 ID 精确匹配）' }
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
      return {
        success: false, needDisambiguation: true,
        reason: 'missing_task_id', message: '请提供要查询的任务名称或 ID。'
      };
    }

    let taskId = rawId;

    const [overview, funnel, alerts] = await Promise.all([
      queryEngine.getOverviewBoardData({ taskId }).catch(() => null),
      queryEngine.getFunnelData({ taskId }).catch(() => null),
      queryEngine.getAlertFunnelData({ taskId }).catch(() => null)
    ]);

    if (!overview || overview.totalAssignments === 0) {
      return { success: false, errorCode: 'NO_DATA', message: `未找到任务 ${rawId} 的数据。` };
    }

    return {
      success: true,
      data: {
        task_id: taskId, task_name: rawId,
        overall_metrics: {
          total_count: overview.totalAssignments,
          completed_count: overview.completedCount,
          in_progress_count: overview.inProgressCount || 0,
          pending_count: overview.pendingCount || 0,
          completion_rate: overview.completionRate,
          learning_rate: overview.taskReadRate || overview.taskReachRate || 0
        },
        completion_funnel: funnel ? { stages: funnel.stages } : null,
        alerts: alerts || null
      },
      summary: `任务完成率 ${overview.completionRate}%，已 ${overview.completedCount}/${overview.totalAssignments} 人`,
      uiHints: { preferredView: 'dashboard' }
    };
  }
};
