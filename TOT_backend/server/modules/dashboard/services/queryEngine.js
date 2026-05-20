'use strict';

/**
 * queryEngine.js — Dashboard query engine (MySQL data source)
 *
 * All board-data functions are async. Data access goes through dashboardMysqlCrud
 * (atomic SQL only — SELECT + JOIN + WHERE). All aggregation and status classification
 * is done in pure JS. Warning levels are read from learner_task_reminder.reminder_level
 * (new/P0/P1/P2/P3). 'new' = no warning, P0-P3 = corresponding warning level.
 */

const mysqlCrud = require('../crud/dashboardMysqlCrud');
const { createError } = require('../../common/middleware/errorHandler');
const { formatLocalDateYYYYMMDD, formatNowSqliteLocal } = require('../../common/utils/ddlAt');

// ═══════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════

const DIMENSION_KEY = {
  rtm:        'rtm4_name',
  format:     'sub_region_code',
  dealer:     'reseller_name',
  dealerName: 'reseller_name',
  store:      'store_name',
};

function heatmapColor(rate) {
  if (rate >= 80) return '#4CAF50';
  if (rate >= 50) return '#FF9900';
  return '#F44336';
}

function emptyOverview() {
  return {
    totalAssignments: 0, pushUserCount: 0, employeeReadCount: 0, managerReadCount: 0, totalReadCount: 0,
    completionRate: 0, completedCount: 0, onTimeCompletionRate: 0, avgCompletionTimeHours: 0,
    taskReachRate: 0, taskReadRate: 0, nudgeConversionRate: 0,
    crisisNewRate: 0, crisisP3Rate: 0, crisisP2Rate: 0, crisisP1Rate: 0, crisisP0Rate: 0,
    inProgressCount: 0, pendingCount: 0, overdueCount: 0,
    warningCount: { new: 0, p3: 0, p2: 0, p1: 0, p0: 0 },
    confirmedCount: 0, confirmationRate: 0,
    nudgeSeverityCounts: { new: 0, p3: 0, p2: 0, p1: 0, p0: 0 },
    completionRateDelta: 0, remainingSeconds: 0,
    platform: null,
    updatedAt: formatNowSqliteLocal(),
  };
}

// ═══════════════════════════════════════════════════════════════════
// Core JS helpers — status & warning classification
// ═══════════════════════════════════════════════════════════════════

/**
 * Classify a learner's completion status from MyPal progress rows.
 * Returns 'completed' | 'in_progress' | 'pending'.
 */
function classifyStatus(emailId, mpsRows) {
  const learnerRows = mpsRows.filter(r => r.email_id === emailId);
  if (learnerRows.length === 0) return 'pending';

  const required = learnerRows.filter(r => r.required_flag === 1);
  if (required.length === 0) return 'completed';
  if (required.every(r => r.passed_week !== null)) return 'completed';
  if (required.some(r => r.first_use_time !== null)) return 'in_progress';
  return 'pending';
}


/**
 * Compute completion time in hours (passed_time - task.start_date).
 */
function completionTimeHours(task, mpsRows, emailId) {
  if (!task.start_date) return null;
  const learnerRows = mpsRows.filter(r => r.email_id === emailId);
  const completed = learnerRows.filter(r => r.required_flag === 1 && r.passed_time);
  if (completed.length === 0) return null;

  const passedTimes = completed.map(r => new Date(r.passed_time).getTime());
  const latestPassed = Math.max(...passedTimes);
  const startMs = new Date(task.start_date).getTime();
  return (latestPassed - startMs) / (1000 * 60 * 60);
}

// ═══════════════════════════════════════════════════════════════════
// Drill filter adapter
// ═══════════════════════════════════════════════════════════════════

function resolveDrillFilter(query) {
  return {
    storeAppleId:  query.storeId     || undefined,
    rtm4Name:      query.rtm         || undefined,
    subRegionCode: query.format      || undefined,
    resellerName:  query.dealerName  || undefined,
  };
}

function resolveDimensionKey(entry, rtmLevel) {
  const col = DIMENSION_KEY[rtmLevel] || 'rtm4_name';
  return entry[col] || '(未知)';
}

// ═══════════════════════════════════════════════════════════════════
// Common data-fetch pipeline
// ═══════════════════════════════════════════════════════════════════

async function fetchTaskContext(taskId, query) {
  const task = taskId ? await mysqlCrud.getTaskById(taskId) : null;
  const drill = resolveDrillFilter(query);
  const queues = await mysqlCrud.getQueueEntries({ taskPublishId: taskId, ...drill });
  const emailIds = [...new Set(queues.map(q => q.email_id))];

  let mpsRows = [];
  if (task && task.task_week) {
    mpsRows = await mysqlCrud.getMyPalProgressByWeek(task.task_week);
  } else if (emailIds.length > 0) {
    mpsRows = await mysqlCrud.getMyPalProgressByEmails(emailIds);
  }

  const confirmedRows = taskId && emailIds.length > 0
    ? await mysqlCrud.getConfirmationStatus({ taskPublishId: taskId, emailIds })
    : [];
  const confirmedSet = new Set(confirmedRows.map(r => r.email_id));

  const reminders = taskId ? await mysqlCrud.getRemindersByTaskId(taskId) : [];
  const reminderMap = new Map(reminders.map(r => [r.email_id, r.reminder_level]));

  return { task, queues, emailIds, mpsRows, confirmedSet, reminderMap };
}

// ═══════════════════════════════════════════════════════════════════
// /dashboard/overview
// ═══════════════════════════════════════════════════════════════════

/**
 * @param {{ taskId?: string }} query
 * @returns {Promise<Object>} overview 汇总数据
 */
async function getOverviewBoardData(query) {
  const { taskId } = query;
  const { task, queues, mpsRows, confirmedSet, reminderMap } = await fetchTaskContext(taskId, query);

  if (!task || queues.length === 0) return emptyOverview();

  const now = Date.now();
  const total = queues.length;
  const dueMs = new Date(task.due_date).getTime();

  let completedCnt = 0, inProgCnt = 0, pendingCnt = 0, overdueCnt = 0;
  let onTimeCnt = 0, confirmedCnt = 0;
  let timeTotal = 0, timeCount = 0;
  let newN = 0, p0N = 0, p1N = 0, p2N = 0, p3N = 0;

  for (const q of queues) {
    const status = classifyStatus(q.email_id, mpsRows);
    const confirmed = confirmedSet.has(q.email_id);
    const level = reminderMap.get(q.email_id) || 'new';

    if (status === 'completed') {
      completedCnt++;
      const hrs = completionTimeHours(task, mpsRows, q.email_id);
      if (hrs !== null) { timeTotal += hrs; timeCount++; }
      const passedTimes = mpsRows
        .filter(r => r.email_id === q.email_id && r.required_flag === 1 && r.passed_time)
        .map(r => new Date(r.passed_time).getTime());
      if (passedTimes.length > 0 && Math.max(...passedTimes) <= dueMs) onTimeCnt++;
    } else if (status === 'in_progress') {
      inProgCnt++;
    } else {
      pendingCnt++;
    }

    if (status !== 'completed' && now > dueMs) overdueCnt++;
    if (confirmed) confirmedCnt++;

    if (level === 'new') newN++;
    else if (level === 'P0') p0N++;
    else if (level === 'P1') p1N++;
    else if (level === 'P2') p2N++;
    else if (level === 'P3') p3N++;
  }

  const completionRate       = total > 0 ? parseFloat(((100 * completedCnt) / total).toFixed(2)) : 0;
  const onTimeCompletionRate = total > 0 ? parseFloat(((100 * onTimeCnt) / total).toFixed(2)) : 0;
  const avgCompletionTimeHours = timeCount > 0
    ? parseFloat((timeTotal / timeCount).toFixed(2))
    : 0;

  const nudgeConversionRate = total > 0
    ? parseFloat(((100 * completedCnt) / total).toFixed(2))
    : 0;

  const participationRate = total > 0
    ? parseFloat(((100 * (inProgCnt + completedCnt)) / total).toFixed(2))
    : 0;

  const remainingSeconds = task.due_date
    ? Math.max(0, Math.floor((dueMs - now) / 1000))
    : 0;

  const warningCount = { new: newN, p3: p3N, p2: p2N, p1: p1N, p0: p0N };

  return {
    totalAssignments: total,
    pushUserCount: total,
    employeeReadCount: total,
    managerReadCount: total,
    totalReadCount: total,

    completionRate,
    completedCount: completedCnt,
    onTimeCompletionRate,
    avgCompletionTimeHours,

    taskReachRate: participationRate,
    taskReadRate: participationRate,
    nudgeConversionRate,

    crisisNewRate: total > 0 ? parseFloat(((100 * newN) / total).toFixed(2)) : 0,
    crisisP3Rate: total > 0 ? parseFloat(((100 * p3N) / total).toFixed(2)) : 0,
    crisisP2Rate: total > 0 ? parseFloat(((100 * p2N) / total).toFixed(2)) : 0,
    crisisP1Rate: total > 0 ? parseFloat(((100 * p1N) / total).toFixed(2)) : 0,
    crisisP0Rate: total > 0 ? parseFloat(((100 * p0N) / total).toFixed(2)) : 0,

    inProgressCount: inProgCnt,
    pendingCount: pendingCnt,
    overdueCount: overdueCnt,
    warningCount,

    confirmedCount: confirmedCnt,
    confirmationRate: total > 0 ? parseFloat(((100 * confirmedCnt) / total).toFixed(2)) : 0,
    nudgeSeverityCounts: warningCount,

    completionRateDelta: 0,
    remainingSeconds,

    platform: null,
    updatedAt: formatNowSqliteLocal(),
  };
}

// ═══════════════════════════════════════════════════════════════════
// /dashboard/heatmap
// ═══════════════════════════════════════════════════════════════════

/**
 * @param {{ taskId: string, rtmLevel?: string }} query
 * @returns {Promise<Object>} heatmap 热力图数据
 */
async function getHeatmapBoardData(query) {
  const { taskId, rtmLevel = 'rtm' } = query;
  if (!taskId) throw createError(400, 'taskId 为必填参数', 'DASH_001');

  const { task, queues, mpsRows } = await fetchTaskContext(taskId, query);

  if (!task || queues.length === 0) {
    return { taskId, rtmLevel, platform: null, heatmapData: [], updatedAt: formatNowSqliteLocal() };
  }

  const groups = new Map();
  for (const q of queues) {
    const key = resolveDimensionKey(q, rtmLevel);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(q);
  }

  const heatmapData = [];
  for (const [dimValue, entries] of groups) {
    const assignmentCount = entries.length;
    let completedCount = 0, inProgressCount = 0;
    let timeTotal = 0, timeCount = 0;

    for (const e of entries) {
      const status = classifyStatus(e.email_id, mpsRows);
      if (status === 'completed') {
        completedCount++;
        const t = completionTimeHours(task, mpsRows, e.email_id);
        if (t !== null) { timeTotal += t; timeCount++; }
      } else if (status === 'in_progress') {
        inProgressCount++;
      }
    }

    const completionRate = assignmentCount > 0
      ? parseFloat(((100 * completedCount) / assignmentCount).toFixed(2))
      : 0;
    const avgHours = timeCount > 0 ? parseFloat((timeTotal / timeCount).toFixed(2)) : 0;

    let avgTimeFormatted = '-';
    if (timeCount > 0) {
      avgTimeFormatted = avgHours > 0 && avgHours < 0.1 ? '< 0.1h' : `${avgHours.toFixed(1)}h`;
    }

    heatmapData.push({
      rtmValue: dimValue,
      completionRate,
      avgCompletionTimeHours: avgHours,
      avgTimeFormatted,
      color: heatmapColor(completionRate),
      assignmentCount,
      completedCount,
      inProgressCount,
    });
  }

  heatmapData.sort((a, b) => b.completionRate - a.completionRate);

  return { taskId, rtmLevel, platform: null, heatmapData, updatedAt: formatNowSqliteLocal() };
}

// ═══════════════════════════════════════════════════════════════════
// /dashboard/trend
// ═══════════════════════════════════════════════════════════════════

/**
 * @param {{ taskId: string, type?: string, date?: string }} query
 * @returns {Promise<Object>} trend 趋势数据
 */
async function getTrendBoardData(query) {
  const { taskId, type = 'daily', date } = query;
  if (!taskId) throw createError(400, 'taskId 不能为空', 'DASH_001');
  if (!['daily', 'hourly'].includes(type)) {
    throw createError(400, 'type 必须是 daily 或 hourly', 'DASH_005');
  }

  const targetDate = date || formatLocalDateYYYYMMDD();
  const { task, mpsRows } = await fetchTaskContext(taskId, query);

  if (!task) return { taskId, type, date: targetDate, platform: null, trendData: [] };

  // Earliest completion time per learner
  const learnerCompletion = new Map();
  for (const r of mpsRows) {
    if (!r.passed_time || r.required_flag !== 1) continue;
    const t = new Date(r.passed_time).getTime();
    if (!learnerCompletion.has(r.email_id) || t < learnerCompletion.get(r.email_id)) {
      learnerCompletion.set(r.email_id, t);
    }
  }

  const buckets = new Map();
  const pad2 = n => String(n).padStart(2, '0');

  for (const [, passedMs] of learnerCompletion) {
    const d = new Date(passedMs);
    let timeKey;
    if (type === 'daily') {
      timeKey = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    } else {
      const dateKey = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      if (dateKey !== targetDate) continue;
      timeKey = `${dateKey} ${pad2(d.getHours())}:00`;
    }
    buckets.set(timeKey, (buckets.get(timeKey) || 0) + 1);
  }

  const sortedKeys = [...buckets.keys()].sort();
  let cumulative = 0;
  const trendData = sortedKeys.map(k => {
    const n = buckets.get(k);
    cumulative += n;
    return { timeKey: k, newCompleted: n, cumulativeCompleted: cumulative };
  });

  return { taskId, type, date: targetDate, platform: null, trendData };
}

// ═══════════════════════════════════════════════════════════════════
// /dashboard/funnel
// ═══════════════════════════════════════════════════════════════════

/**
 * @param {{ taskId?: string, funnelStage?: string }} query
 * @returns {Promise<Object>} funnel 漏斗数据
 */
async function getFunnelBoardData(query) {
  const { funnelStage } = query;

  if (funnelStage) {
    // summary 阶段为 pushed/delivered/in_progress/completed；pushed/delivered
    // 与 assigned 在当前数据模型里等价（见 getFunnelSummaryData 注释）。
    const validStages = ['assigned', 'pushed', 'delivered', 'in_progress', 'completed'];
    if (!validStages.includes(funnelStage)) {
      throw createError(400, 'funnelStage 参数非法', 'DASH_007');
    }
    return getFunnelDrillDownData(query);
  }
  return getFunnelSummaryData(query);
}

async function getFunnelSummaryData(query) {
  const { taskId } = query;
  const { task, queues, mpsRows } = await fetchTaskContext(taskId, query);

  if (!task || queues.length === 0) {
    return { taskId: taskId || null, platform: null, stages: [], updatedAt: formatNowSqliteLocal() };
  }

  let inProgWithCompleted = 0, completedCnt = 0;
  for (const q of queues) {
    const status = classifyStatus(q.email_id, mpsRows);
    if (status === 'completed') { completedCnt++; inProgWithCompleted++; }
    else if (status === 'in_progress') inProgWithCompleted++;
  }

  const assigned = queues.length;
  const inProgress = inProgWithCompleted;
  const completed = completedCnt;

  const first = assigned || 1;
  const share = v => parseFloat(((100 * v) / first).toFixed(2));
  const drop = (prev, curr) => prev === 0 ? 0 : parseFloat((((prev - curr) / prev) * 100).toFixed(2));

  // 4-stage for frontend compat; pushed == delivered in new data model
  const stages = [
    { stage: 'pushed',    label: '推送',   count: assigned,  sharePercent: share(assigned),  dropPercent: 0,                                dropWidth: 0 },
    { stage: 'delivered', label: '送达',   count: assigned,  sharePercent: share(assigned),  dropPercent: drop(assigned, assigned),         dropWidth: 0 },
    { stage: 'in_progress', label: '学习中', count: inProgress, sharePercent: share(inProgress), dropPercent: drop(assigned, inProgress), dropWidth: parseFloat((share(assigned) - share(inProgress)).toFixed(2)) },
    { stage: 'completed', label: '已完成', count: completed, sharePercent: share(completed), dropPercent: drop(inProgress, completed), dropWidth: parseFloat((share(inProgress) - share(completed)).toFixed(2)) },
  ];

  return { taskId: taskId || null, platform: null, stages, updatedAt: formatNowSqliteLocal() };
}

async function getFunnelDrillDownData(query) {
  const { taskId, funnelStage, rtmLevel = 'rtm' } = query;
  if (!taskId) throw createError(400, 'taskId 为必填参数', 'DASH_001');

  const { task, queues, mpsRows } = await fetchTaskContext(taskId, query);
  const updatedAt = formatNowSqliteLocal();

  if (!task || queues.length === 0) {
    return { taskId, funnelStage, rtmLevel: String(rtmLevel).toLowerCase(), platform: null, rows: [], updatedAt };
  }

  const groups = new Map();
  for (const q of queues) {
    const key = resolveDimensionKey(q, rtmLevel);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(q);
  }

  const rows = [];
  for (const [name, entries] of groups) {
    const total = entries.length;
    let count = 0;

    if (funnelStage === 'assigned' || funnelStage === 'pushed' || funnelStage === 'delivered') {
      count = total;
    } else {
      for (const e of entries) {
        const status = classifyStatus(e.email_id, mpsRows);
        if (funnelStage === 'in_progress' && (status === 'in_progress' || status === 'completed')) count++;
        else if (funnelStage === 'completed' && status === 'completed') count++;
      }
    }

    rows.push({ name: name || '(未知)', total, count, rate: total > 0 ? parseFloat((count / total).toFixed(4)) : 0 });
  }

  return { taskId, funnelStage, rtmLevel: String(rtmLevel).toLowerCase(), platform: null, rows, updatedAt };
}

// ═══════════════════════════════════════════════════════════════════
// /dashboard/warnings
// ═══════════════════════════════════════════════════════════════════

/**
 * @param {{ taskId: string, warningLevel?: string, pageNum?: number, pageSize?: number, level?: string }} query
 * @returns {Promise<Object>} warnings 预警列表数据
 */
async function getWarningsBoardData(query) {
  const { taskId, warningLevel, pageNum = 1, pageSize = 20, level = 'store' } = query;
  if (warningLevel && !['new', 'p3', 'p2', 'p1', 'p0'].includes(warningLevel)) {
    throw createError(400, 'warningLevel 非法（new/p3/p2/p1/p0）', 'DASH_003');
  }

  const page = Math.max(1, parseInt(pageNum, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));
  const offset = (page - 1) * limit;

  const { task, queues, mpsRows, reminderMap } = await fetchTaskContext(taskId, query);

  if (!task || queues.length === 0) {
    return { platform: null, list: [], pagination: { pageNum: page, pageSize: limit, total: 0, totalPages: 0 } };
  }

  const groupColumn = level === 'store' ? 'store_name' : level === 'dealer' ? 'reseller_name' : 'rtm4_name';
  const groups = new Map();
  for (const q of queues) {
    const key = q[groupColumn] || '(未知)';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(q);
  }

  const bandPriority = { p0: 0, p1: 1, p2: 2, p3: 3, new: 4 };

  const matched = [];
  for (const [groupName, entries] of groups) {
    const totalCount = entries.length;
    let completedCount = 0, riskCount = 0;
    let bestBand = null;
    let bestBandPriority = Infinity;

    for (const e of entries) {
      const status = classifyStatus(e.email_id, mpsRows);
      if (status === 'completed') { completedCount++; }
      const level = reminderMap.get(e.email_id) || 'new';

      if (warningLevel) {
        if (level.toLowerCase() === warningLevel) riskCount++;
      } else if (level !== 'new') {
        riskCount++;
        const priority = bandPriority[level.toLowerCase()] ?? Infinity;
        if (priority < bestBandPriority) {
          bestBand = level.toLowerCase();
          bestBandPriority = priority;
        }
      }
    }

    const effectiveBand = warningLevel || bestBand || 'p2';
    if (warningLevel && riskCount === 0) continue;

    const uncompletedCount = totalCount - completedCount;
    const warningRate = totalCount > 0 ? parseFloat(((100 * riskCount) / totalCount).toFixed(2)) : 0;
    const completionRate = totalCount > 0 ? parseFloat(((100 * completedCount) / totalCount).toFixed(2)) : 0;

    const bandLabel = { new: 'new', p0: 'P0', p1: 'P1', p2: 'P2', p3: 'P3' };
    let triggerDesc = '';
    if (effectiveBand === 'p0') {
      triggerDesc = `该门店/区域存在 P0 高危预警学员，仍有 ${uncompletedCount} 人未完成`;
    } else if (effectiveBand === 'p1') {
      triggerDesc = `该门店/区域存在 P1 预警学员，仍有 ${uncompletedCount} 人未完成`;
    } else if (effectiveBand === 'p2') {
      triggerDesc = `该门店/区域存在 P2 预警学员，仍有 ${uncompletedCount} 人未完成`;
    } else if (effectiveBand === 'p3') {
      triggerDesc = `该门店/区域存在 P3 预警学员，仍有 ${uncompletedCount} 人未完成`;
    } else if (effectiveBand === 'new') {
      triggerDesc = `该门店/区域有 ${riskCount} 名学员处于新任务状态`;
    }

    matched.push({
      taskId,
      targetId: groupName,
      targetName: groupName,
      targetType: level,
      storeId: groupName,
      storeName: groupName,
      warningLevel: effectiveBand,
      warningRate,
      riskCount: riskCount || uncompletedCount,
      completionRate,
      completedCount,
      totalCount,
      overdueCount: 0,
      triggerDesc,
      aiSuggestion: '建议及时督促对应门店/区域进行学习',
      updatedAt: formatNowSqliteLocal(),
    });
  }

  matched.sort((a, b) => b.warningRate - a.warningRate);
  const total = matched.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  return {
    platform: null,
    list: matched.slice(offset, offset + limit),
    pagination: { pageNum: page, pageSize: limit, total, totalPages },
  };
}

// ═══════════════════════════════════════════════════════════════════
// /dashboard/nudge-conversion
// ═══════════════════════════════════════════════════════════════════

/**
 * @param {{ taskId: string, pageNum?: number, pageSize?: number, level?: string }} query
 * @returns {Promise<Object>} nudge 催办转化数据
 */
async function getNudgeConversionBoardData(query) {
  const { taskId, pageNum = 1, pageSize = 20, level = 'store' } = query;

  const page = Math.max(1, parseInt(pageNum, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));
  const offset = (page - 1) * limit;

  if (!taskId) {
    return { platform: null, list: [], pagination: { pageNum: page, pageSize: limit, total: 0, totalPages: 0 } };
  }

  const { task, queues, mpsRows, reminderMap } = await fetchTaskContext(taskId, query);

  if (!task || queues.length === 0) {
    return { platform: null, list: [], pagination: { pageNum: page, pageSize: limit, total: 0, totalPages: 0 } };
  }

  const groupColumn = level === 'store' ? 'store_name' : level === 'dealer' ? 'reseller_name' : 'rtm4_name';

  const groups = new Map();
  for (const q of queues) {
    const key = q[groupColumn] || '(未知)';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(q);
  }

  const LEVELS = ['p0', 'p1', 'p2', 'p3', 'new'];

  const list = [];
  for (const [name, entries] of groups) {
    const bandEntries = { p0: [], p1: [], p2: [], p3: [], new: [] };
    for (const e of entries) {
      const rawLevel = reminderMap.get(e.email_id) || 'new';
      const band = rawLevel.toLowerCase();
      if (bandEntries[band]) bandEntries[band].push(e);
    }

    let totalCount = 0, totalCompleted = 0;
    const item = { targetId: name, targetName: name, targetType: level };

    for (const b of LEVELS) {
      const count = bandEntries[b].length;
      let completed = 0;
      for (const e of bandEntries[b]) {
        if (classifyStatus(e.email_id, mpsRows) === 'completed') completed++;
      }
      const rate = count > 0 ? parseFloat(((100 * completed) / count).toFixed(2)) : 0;
      item[b] = { count, completed, rate };
      totalCount += count;
      totalCompleted += completed;
    }

    list.push(item);
  }

  list.sort((a, b) => (b.p0.count + b.p1.count + b.p2.count) - (a.p0.count + a.p1.count + a.p2.count));

  const totalRecords = list.length;
  const totalPages = totalRecords === 0 ? 0 : Math.ceil(totalRecords / limit);

  return {
    platform: null,
    list: list.slice(offset, offset + limit),
    pagination: { pageNum: page, pageSize: limit, total: totalRecords, totalPages },
  };
}

// ═══════════════════════════════════════════════════════════════════
// /dashboard/alerts-unified
// ═══════════════════════════════════════════════════════════════════

/**
 * @param {{ taskId?: string }} query
 * @returns {Promise<Object>} alerts 统一预警数据
 */
async function getUnifiedAlertsBoardData(query) {
  const { taskId } = query;
  const alerts = [];

  const levels = [
    { level: 'new', label: 'new', descFallback: '新任务' },
    { level: 'p3', label: 'P3', descFallback: 'P3 预警' },
    { level: 'p2', label: 'P2', descFallback: 'P2 预警' },
    { level: 'p1', label: 'P1', descFallback: 'P1 预警' },
    { level: 'p0', label: 'P0', descFallback: '高危 P0 预警' },
  ];

  for (const { level, label, descFallback } of levels) {
    try {
      const wr = await getWarningsBoardData({ ...query, warningLevel: level, pageSize: 500, level: 'store' });
      for (const a of wr.list) {
        alerts.push({
          alert_id: (a.storeId || '') + '-' + level,
          level: label,
          description: a.triggerDesc || descFallback,
          related_entity: a.storeName,
          storeName: a.storeName,
          total_employees: a.totalCount || 0,
          completed_count: a.completedCount || 0,
          risk_rate: a.warningRate || 0,
          aiSuggestion: a.aiSuggestion || '',
          taskId: a.taskId,
          storeId: a.storeId,
        });
      }
    } catch (e) { /* skip */ }
  }

  try {
    const hm = await getHeatmapBoardData({ taskId, rtmLevel: 'store' });
    for (const h of (hm.heatmapData || [])) {
      const uncompleted = (h.assignmentCount || 0) - (h.completedCount || 0);
      if (uncompleted <= 0) continue;
      alerts.push({
        alert_id: (h.rtmValue || '') + '-unfinished',
        level: 'Unfinished',
        description: `目前仍有 ${uncompleted} 人未完成任务`,
        related_entity: h.rtmValue || '未知门店',
        storeName: h.rtmValue,
        total_employees: h.assignmentCount || 0,
        completed_count: h.completedCount || 0,
        risk_rate: h.assignmentCount > 0 ? parseFloat(((uncompleted / h.assignmentCount) * 100).toFixed(2)) : 0,
        aiSuggestion: '建议及时督促对应门店/区域进行学习',
        taskId,
        storeId: h.rtmValue,
      });
    }
  } catch (e) { /* skip */ }

  const list = alerts.map(a => ({
    ...a,
    rtm3: a.rtm3 || '未分类 RTM3',
    rtm4: a.rtm4 || '未分类 RTM4',
    dealer: a.dealer || '默认经销商',
    store: a.storeName || a.related_entity || '默认门店',
  }));

  return {
    taskId: taskId || null,
    platform: null,
    list,
    total: list.length,
    updatedAt: formatNowSqliteLocal(),
  };
}

// ═══════════════════════════════════════════════════════════════════
// /dashboard/funnel?type=alert
// ═══════════════════════════════════════════════════════════════════

/**
 * Alert distribution by reminder_level — counts of non-completed learners
 * at each reminder_level (P2, P1, P0).
 *
 * @param {{ taskId?: string }} query
 * @returns {Promise<Object>} alert distribution data
 */
async function getAlertFunnelData(query) {
  const { taskId } = query;
  const { task, queues, mpsRows, reminderMap } = await fetchTaskContext(taskId, query);
  const total = queues.length;

  if (!task || queues.length === 0) {
    return {
      taskId: taskId || null,
      platform: null,
      stages: [],
      updatedAt: formatNowSqliteLocal(),
    };
  }

  let newN = 0, p0N = 0, p1N = 0, p2N = 0, p3N = 0;
  let uncompletedCount = 0;
  let warnedCompleted = 0; // 被催办（P3/P2/P1/P0）且已完成的人数

  for (const q of queues) {
    const status = classifyStatus(q.email_id, mpsRows);
    if (status !== 'completed') uncompletedCount++;

    const reminderLevel = reminderMap.get(q.email_id) || 'new';

    if (reminderLevel === 'new') newN++;
    else if (reminderLevel === 'P0') { p0N++; if (status === 'completed') warnedCompleted++; }
    else if (reminderLevel === 'P1') { p1N++; if (status === 'completed') warnedCompleted++; }
    else if (reminderLevel === 'P2') { p2N++; if (status === 'completed') warnedCompleted++; }
    else if (reminderLevel === 'P3') { p3N++; if (status === 'completed') warnedCompleted++; }
  }

  // Cumulative: "触发过该级别" = 该档 + 所有更严重档位
  const cumulativeP3 = p3N + p2N + p1N + p0N;
  const cumulativeP2 = p2N + p1N + p0N;
  const cumulativeP1 = p1N + p0N;

  // 总转化率 = 被催办且已完成 / 触发过P3的总人数
  const totalConversionRate = cumulativeP3 > 0
    ? parseFloat((warnedCompleted / cumulativeP3 * 100).toFixed(2))
    : 0;

  const maxCount = Math.max(p3N, p2N, p1N, p0N, newN, 1);
  const stageWidth = count => parseFloat(((count / maxCount) * 100).toFixed(2));
  const toPctOfTotal = count => total > 0 ? parseFloat(((count / total) * 100).toFixed(1)) : 0;
  // P3→P2 = P3 / (P3+P2+P1+P0), P2→P1 = P2 / (P2+P1+P0), P1→P0 = P1 / (P1+P0)
  const conv = (curr, cumulative) => cumulative > 0 ? parseFloat((curr / cumulative * 100).toFixed(2)) : 0;

  const result = [
    { stage: 'P3', label: 'P3', count: p3N, width: stageWidth(p3N), percentageOfTotal: toPctOfTotal(p3N), conversionToNext: conv(p3N, cumulativeP3) },
    { stage: 'P2', label: 'P2', count: p2N, width: stageWidth(p2N), percentageOfTotal: toPctOfTotal(p2N), conversionToNext: conv(p2N, cumulativeP2) },
    { stage: 'P1', label: 'P1', count: p1N, width: stageWidth(p1N), percentageOfTotal: toPctOfTotal(p1N), conversionToNext: conv(p1N, cumulativeP1) },
    { stage: 'P0', label: 'P0', count: p0N, width: stageWidth(p0N), percentageOfTotal: toPctOfTotal(p0N), conversionToNext: 0 },
    { stage: 'new', label: 'new', count: newN, width: stageWidth(newN), percentageOfTotal: toPctOfTotal(newN), conversionToNext: 0 },
  ];

  return {
    taskId: taskId || null,
    platform: null,
    stages: result,
    maxCount,
    totalConversionRate,
    uncompletedCount,
    updatedAt: formatNowSqliteLocal(),
  };
}

/**
 * Unified funnel entry — dispatches to summary, alert funnel, or alert drill-down
 * based on query.type and query.alertLevel.
 *
 * @param {{ taskId?: string, type?: string, alertLevel?: string }} query
 * @returns {Promise<Object>} funnel 数据
 */
async function getFunnelData(query) {
  if (query.type === 'alert') {
    return query.alertLevel
      ? await getAlertDrillDownData(query)
      : await getAlertFunnelData(query);
  }
  return await getFunnelBoardData(query);
}

// ═══════════════════════════════════════════════════════════════════
// /dashboard/funnel?type=alert&alertLevel=
// ═══════════════════════════════════════════════════════════════════

/**
 * @param {{ taskId: string, alertLevel?: string, rtmLevel?: string }} query
 * @returns {Promise<Object>} alert 下钻数据
 */
async function getAlertDrillDownData(query) {
  const { taskId, alertLevel, rtmLevel = 'rtm' } = query;
  if (!taskId) throw createError(400, 'taskId 为必填参数', 'DASH_001');

  const { queues, mpsRows, reminderMap } = await fetchTaskContext(taskId, query);
  const updatedAt = formatNowSqliteLocal();

  if (!queues.length) {
    return {
      taskId, alertLevel,
      dimension: String(rtmLevel).toLowerCase(),
      platform: null,
      rows: [],
      updatedAt,
    };
  }

  const targetLevel = alertLevel ? alertLevel.toUpperCase() : null;

  const groups = new Map();
  for (const q of queues) {
    const reminderLevel = reminderMap.get(q.email_id) || 'new';
    if (targetLevel && reminderLevel !== targetLevel) continue;

    const key = resolveDimensionKey(q, rtmLevel);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(q);
  }

  const rows = [];
  for (const [name, entries] of groups) {
    const total = entries.length;
    rows.push({
      name,
      totalEmployees: total,
      completedCount: 0,
      riskCount: total,
      riskRate: 1.0,
    });
  }

  return {
    taskId, alertLevel,
    dimension: String(rtmLevel).toLowerCase(),
    platform: null,
    rows,
    updatedAt,
  };
}

// ═══════════════════════════════════════════════════════════════════
// /dashboard/store-rank
// ═══════════════════════════════════════════════════════════════════

/**
 * @param {{ taskId: string, type?: string, limit?: number }} query
 * @returns {Promise<Object>} store 排名数据
 */
async function getStoreRankBoardData(query) {
  const { taskId, type = 'top', limit: rawLimit } = query;
  if (!taskId) throw createError(400, 'taskId 为必填参数', 'DASH_001');
  if (!['top', 'bottom'].includes(type)) {
    throw createError(400, 'type 必须是 top 或 bottom', 'DASH_006');
  }

  const limit = Math.min(100, Math.max(1, parseInt(rawLimit, 10) || 10));
  const { task, queues, mpsRows } = await fetchTaskContext(taskId, query);

  if (!task || queues.length === 0) {
    return { rankList: [], updatedAt: formatNowSqliteLocal() };
  }

  const groups = new Map();
  for (const q of queues) {
    const key = q.store_name || q.store_apple_id || '(未知)';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(q);
  }

  const rankList = [];
  for (const [storeName, entries] of groups) {
    const assignmentCount = entries.length;
    let completedCount = 0;

    for (const e of entries) {
      if (classifyStatus(e.email_id, mpsRows) === 'completed') completedCount++;
    }

    const completionRate = assignmentCount > 0
      ? parseFloat(((100 * completedCount) / assignmentCount).toFixed(2))
      : 0;

    rankList.push({
      storeId: entries[0].store_apple_id || storeName,
      storeName,
      completionRate,
      assignmentCount,
      completedCount,
    });
  }

  rankList.sort((a, b) => type === 'top'
    ? b.completionRate - a.completionRate
    : a.completionRate - b.completionRate
  );

  return {
    rankList: rankList.slice(0, limit),
    updatedAt: formatNowSqliteLocal(),
  };
}

// ═══════════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════════

module.exports = {
  // Board-data functions
  getOverviewBoardData,
  getFunnelData,
  getFunnelBoardData,
  getAlertFunnelData,
  getAlertDrillDownData,
  getUnifiedAlertsBoardData,
  getHeatmapBoardData,
  getTrendBoardData,
  getWarningsBoardData,
  getNudgeConversionBoardData,
  getStoreRankBoardData,
  // Shared helpers (used by insightService.js)
  classifyStatus,
  completionTimeHours,
  resolveDrillFilter,
  resolveDimensionKey,
  fetchTaskContext,
  DIMENSION_KEY,
};
