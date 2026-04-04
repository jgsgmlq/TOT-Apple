'use strict';

/**
 * @param {{ has_mypal: number, has_smartsell: number, has_ai_demo: number, has_live_broadcast: number }} task
 * @returns {string[]}
 */
function getConfiguredPlatformColumns(task) {
  const configured = [];
  if (task.has_mypal === 1) configured.push('mypal_completed');
  if (task.has_smartsell === 1) configured.push('smartsell_completed');
  if (task.has_ai_demo === 1) configured.push('ai_demo_completed');
  if (task.has_live_broadcast === 1) configured.push('live_broadcast_completed');
  return configured;
}

/**
 * 根据任务配置的平台列与 assignment 各列完成位，计算 progress / status / completedAt。
 * 与 `routes/assignments.js` complete_platform 语义对齐；completedCount===0 时保持原 status（避免 0% 却变成 in_progress）。
 *
 * @param {Record<string, unknown>} assignmentRow DB 行（snake_case 列名）
 * @param {object} task tasks 表行
 * @param {string} nowIso ISO 时间
 */
function computeAssignmentProgressStatus(assignmentRow, task, nowIso) {
  const configuredColumns = getConfiguredPlatformColumns(task);
  const totalConfigured = configuredColumns.length;
  const completedCount = configuredColumns.reduce(
    (acc, col) => acc + (assignmentRow[col] === 1 ? 1 : 0),
    0
  );
  const progress =
    totalConfigured === 0 ? 0 : Math.round((completedCount / totalConfigured) * 100);

  let nextStatus;
  if (completedCount === totalConfigured) {
    nextStatus = 'completed';
  } else if (completedCount > 0) {
    nextStatus = 'in_progress';
  } else {
    nextStatus = assignmentRow.status;
  }

  const completedAt = nextStatus === 'completed' ? nowIso : null;

  return {
    progress,
    nextStatus,
    completedAt,
    completedCount,
    totalConfigured,
  };
}

module.exports = {
  getConfiguredPlatformColumns,
  computeAssignmentProgressStatus,
};
