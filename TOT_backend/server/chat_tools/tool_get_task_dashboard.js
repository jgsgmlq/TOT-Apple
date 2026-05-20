'use strict';

const queryEngine = require('../modules/dashboard/services/queryEngine');

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
    const taskId = (args.task_id || '').trim();
    if (!taskId) {
      return {
        success: false,
        needDisambiguation: true,
        reason: 'missing_task_id',
        message: '请提供要查询的任务名称或 ID。'
      };
    }

    const [overview, funnel, alerts] = await Promise.all([
      queryEngine.getOverviewBoardData({ taskId }).catch(() => null),
      queryEngine.getFunnelData({ taskId }).catch(() => null),
      queryEngine.getAlertFunnelData({ taskId }).catch(() => null)
    ]);

    if (!overview || overview.totalAssignments === 0) {
      return { success: false, errorCode: 'NO_DATA', message: `未找到任务 ${taskId} 的数据。` };
    }

    return {
      success: true,
      data: {
        task_id: taskId,
        overall_metrics: {
          total_count: overview.totalAssignments,
          sent_count: overview.pushUserCount,
          delivered_count: overview.deliveredCount || 0,
          learning_count: overview.learningCount || 0,
          completed_count: overview.completedCount,
          uncompleted_count: overview.pendingCount + (overview.inProgressCount || 0),
          sent_rate: 1.0,
          delivered_rate: overview.deliveredRate || overview.taskReachRate || 0,
          learning_rate: overview.learningRate || overview.taskReadRate || 0,
          completion_rate: overview.completionRate
        },
        completion_funnel: funnel || null,
        alerts: alerts ? alerts.stages || alerts : null,
        alert_funnel: alerts || null
      },
      summary: `任务完成率 ${overview.completionRate}%，已完成 ${overview.completedCount}/${overview.totalAssignments} 人`,
      uiHints: { preferredView: 'dashboard' }
    };
  }
};
