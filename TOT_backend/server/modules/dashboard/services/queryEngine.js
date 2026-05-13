'use strict';

/**
 * queryEngine.js — 看板查询引擎
 *
 * 与 GET /dashboard/overview、GET /dashboard/heatmap、GET /dashboard/trend 同源的数据拼装逻辑，
 * 供 HTTP 路由与看板诊断 Agent（dashboardAgentService）复用。
 *
 * 数据访问全部通过 dashboardCrud，本文件为纯业务逻辑。
 */

const crud = require('../crud/dashboardCrud');
const { createError } = require('../../common/middleware/errorHandler');
const { parseStoreDrill } = require('../../common/utils/storeDrill');
const { formatLocalDateYYYYMMDD, formatNowSqliteLocal } = require('../../common/utils/ddlAt');
const {
  parseAutoNudgeRules,
  classifyDeadlineCrisisBand,
  getDeadlineCrisisHours,
} = require('../../../services/autoNudgeRules');
const { getPlatformDefinition } = require('../../common/utils/platforms');

function heatmapColor(rate) {
  if (rate >= 80) return '#4CAF50';
  if (rate >= 50) return '#FF9900';
  return '#F44336';
}

function parsePlatformFilter(query) {
  if (!query.platform) return null;
  const platform = getPlatformDefinition(query.platform);
  if (!platform) {
    throw createError(400, 'platform 非法', 'DASH_006');
  }
  return {
    ...platform,
    readSource: `task_detail_open:${platform.sourceLabel}`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 对外导出的 board data 函数
// ═══════════════════════════════════════════════════════════════════════════════

function getOverviewBoardData(query) {
  const { taskId } = query;
  const drill = parseStoreDrill(query);
  const platform = parsePlatformFilter(query);
  const nowMs = Date.now();

  const base = crud.queryAssignmentBaseAgg({ taskId, drill, platform });
  if (!base) {
    return emptyOverview(platform);
  }
  const total = base.total || 0;
  const completedCnt = base.completed_count || 0;
  const inProgCnt = base.in_progress_count || 0;
  const pendingCnt = base.pending_count || 0;
  const completionRate = total > 0 ? parseFloat(((100 * completedCnt) / total).toFixed(2)) : 0;
  const completedOnTimeCnt = base.completed_on_time_count || 0;
  const onTimeCompletionRate = total > 0 ? parseFloat(((100 * completedOnTimeCnt) / total).toFixed(2)) : 0;
  const avgCompletionTimeHours =
    base.avg_completion_time_hours != null ? parseFloat(base.avg_completion_time_hours) : 0;

  const pushUserCount = crud.countPushUsers({ taskId, drill });

  const sevRows = crud.countNudgeUsersBySeverity({ taskId, drill, platform });
  let p0N = 0, p1N = 0, p2N = 0;
  for (const r of sevRows) {
    if (r.severity === 'red') p0N += r.cnt;
    if (r.severity === 'orange') p1N += r.cnt;
    if (r.severity === 'yellow') p2N += r.cnt;
  }

  const crisisP2Rate = total > 0 ? parseFloat(((100 * p2N) / total).toFixed(2)) : 0;
  const crisisP1Rate = total > 0 ? parseFloat(((100 * p1N) / total).toFixed(2)) : 0;
  const crisisP0Rate = total > 0 ? parseFloat(((100 * p0N) / total).toFixed(2)) : 0;

  const readSource = platform ? platform.readSource : 'task_detail_open';
  const employeeReadCount = crud.countReadUsers({ taskId, drill, source: readSource });
  const totalReadCount = employeeReadCount;

  const overdueCount = crud.countOverdueAssignments({ taskId, drill, platform });

  const reachedCount = crud.countReachedAssignments({ taskId, drill, platform });
  const taskReachRate = total > 0 ? parseFloat(((reachedCount / total) * 100).toFixed(2)) : 0;

  let nudgeConversionRate = 0;
  try {
    const nr = crud.queryNudgeConversionAggregate({ taskId, drill, platform });
    if (nr && nr.total_nudged > 0) {
      nudgeConversionRate = parseFloat(((100 * nr.converted_nudged) / nr.total_nudged).toFixed(2));
    }
  } catch (e) { /* ignore */ }

  let completionRateDelta = 0;
  if (total > 0) {
    const ye = new Date(); ye.setDate(ye.getDate() - 1); ye.setHours(23, 59, 59, 999);
    const yeStr = ye.toISOString().replace('T', ' ').substring(0, 19);
    const ydBase = crud.queryAssignmentBaseAgg({
      taskId, drill, platform,
      extraWhere: 'AND ta.completed_at <= ?',
      extraParams: [yeStr],
    });
    const yc = (ydBase && ydBase.completed_count) || 0;
    completionRateDelta = parseFloat((completionRate - (total > 0 ? (yc / total) * 100 : 0)).toFixed(2));
  }

  let remainingSeconds = 0;
  if (taskId) {
    const task = crud.getTaskById(taskId);
    if (task && task.ddl_at) remainingSeconds = Math.floor((new Date(task.ddl_at).getTime() - nowMs) / 1000);
  }

  return {
    totalAssignments: total,
    pushUserCount,
    employeeReadCount,
    managerReadCount: employeeReadCount,
    totalReadCount,

    completionRate,
    completedCount: completedCnt,
    onTimeCompletionRate,
    avgCompletionTimeHours,

    taskReachRate,
    taskReadRate: total > 0 ? parseFloat(((totalReadCount / total) * 100).toFixed(2)) : 0,
    nudgeConversionRate,

    crisisP2Rate,
    crisisP1Rate,
    crisisP0Rate,

    inProgressCount: inProgCnt,
    pendingCount: pendingCnt,
    overdueCount,
    warningCount: { p2: p2N, p1: p1N, p0: p0N },

    confirmedCount: inProgCnt + completedCnt,
    confirmationRate: total > 0 ? parseFloat(((100 * (inProgCnt + completedCnt)) / total).toFixed(2)) : 0,
    nudgeSeverityCounts: { p2: p2N, p1: p1N, p0: p0N },

    completionRateDelta,
    remainingSeconds,

    platform: platform ? platform.sourceLabel : null,
    updatedAt: base.last_updated || formatNowSqliteLocal(),
  };
}

function emptyOverview(platform) {
  return {
    totalAssignments: 0, pushUserCount: 0, employeeReadCount: 0, managerReadCount: 0, totalReadCount: 0,
    completionRate: 0, completedCount: 0, onTimeCompletionRate: 0, avgCompletionTimeHours: 0,
    taskReachRate: 0, taskReadRate: 0, nudgeConversionRate: 0,
    crisisP2Rate: 0, crisisP1Rate: 0, crisisP0Rate: 0,
    inProgressCount: 0, pendingCount: 0, overdueCount: 0,
    warningCount: { p2: 0, p1: 0, p0: 0 },
    confirmedCount: 0, confirmationRate: 0,
    nudgeSeverityCounts: { p2: 0, p1: 0, p0: 0 },
    completionRateDelta: 0, remainingSeconds: 0,
    platform: platform ? platform.sourceLabel : null,
    updatedAt: formatNowSqliteLocal(),
  };
}

function getFunnelBoardData(query) {
  const { funnelStage } = query;
  const drill = parseStoreDrill(query);
  const platform = parsePlatformFilter(query);

  if (funnelStage) {
    const validStages = ['pushed', 'delivered', 'in_progress', 'completed'];
    if (!validStages.includes(funnelStage)) {
      throw createError(400, 'funnelStage 参数非法', 'DASH_007');
    }
    return getFunnelDrillDownData(query, drill, platform);
  }
  return getFunnelSummaryData(query, drill, platform);
}

function getFunnelSummaryData(query, drill, platform) {
  const { taskId } = query;
  const base = crud.queryAssignmentBaseAgg({ taskId, drill, platform });
  const total = base ? base.total || 0 : 0;
  const completedCnt = base ? base.completed_count || 0 : 0;
  const inProgCnt = base ? base.in_progress_count || 0 : 0;
  const pushUserCount = crud.countPushUsers({ taskId, drill });

  const pushed = pushUserCount || total;
  const delivered = total;
  const inProgress = inProgCnt + completedCnt;
  const completed = completedCnt;

  const first = pushed || 1;
  const share = (v) => parseFloat(((100 * v) / first).toFixed(2));
  const drop = (prev, curr) => {
    if (prev === 0) return 0;
    return parseFloat((((prev - curr) / prev) * 100).toFixed(2));
  };

  const stages = [
    { stage: 'pushed', label: '推送', count: pushed, sharePercent: share(pushed), dropPercent: 0, dropWidth: 0 },
    { stage: 'delivered', label: '送达', count: delivered, sharePercent: share(delivered), dropPercent: drop(pushed, delivered), dropWidth: parseFloat((share(pushed) - share(delivered)).toFixed(2)) },
    { stage: 'in_progress', label: '学习中', count: inProgress, sharePercent: share(inProgress), dropPercent: drop(delivered, inProgress), dropWidth: parseFloat((share(delivered) - share(inProgress)).toFixed(2)) },
    { stage: 'completed', label: '已完成', count: completed, sharePercent: share(completed), dropPercent: drop(inProgress, completed), dropWidth: parseFloat((share(inProgress) - share(completed)).toFixed(2)) },
  ];

  return {
    taskId: taskId || null,
    platform: platform ? platform.sourceLabel : null,
    stages,
    updatedAt: (base && base.last_updated) || formatNowSqliteLocal(),
  };
}

function getFunnelDrillDownData(query, drill, platform) {
  const { taskId, funnelStage, rtmLevel = 'rtm' } = query;
  if (!taskId) throw createError(400, 'taskId 为必填参数', 'DASH_001');
  const { selectDim, groupByDim } = crud.buildDimensionSelect(rtmLevel, 'entity_name');
  const updatedAt = formatNowSqliteLocal();

  if (funnelStage === 'pushed') {
    const rows = crud.queryPushUsersGrouped({ taskId, drill, selectDim, groupByDim });
    return {
      taskId, funnelStage,
      rtmLevel: String(rtmLevel).toLowerCase(),
      platform: platform ? platform.sourceLabel : null,
      rows: rows.map((r) => ({
        name: r.entity_name || '(未知)',
        total: r.entity_count || 0,
        count: r.entity_count || 0,
        rate: 1,
      })),
      updatedAt,
    };
  }

  const rows = crud.queryAssignmentGroupedAgg({
    taskId, drill, platform, selectDim, groupByDim,
    orderBy: 'ORDER BY assignment_count DESC',
  });

  const mappedRows = rows.map((r) => {
    const total = r.assignment_count || 0;
    let count = 0;
    if (funnelStage === 'delivered') {
      count = total;
    } else if (funnelStage === 'in_progress') {
      count = (r.in_progress_count || 0) + (r.completed_count || 0);
    } else if (funnelStage === 'completed') {
      count = r.completed_count || 0;
    }
    return {
      name: r.entity_name || '(未知)',
      total,
      count,
      rate: total > 0 ? parseFloat((count / total).toFixed(4)) : 0,
    };
  });

  return {
    taskId, funnelStage,
    rtmLevel: String(rtmLevel).toLowerCase(),
    platform: platform ? platform.sourceLabel : null,
    rows: mappedRows,
    updatedAt,
  };
}

function getAlertFunnelData(query) {
  const { taskId } = query;
  const overview = getOverviewBoardData(query);
  const total = overview.totalAssignments || 0;
  const unfinished = (overview.pendingCount || 0) + (overview.inProgressCount || 0);

  const nsc = overview.nudgeSeverityCounts || { p2: 0, p1: 0, p0: 0 };
  const funnelP2 = nsc.p2;
  const funnelP1 = nsc.p1;
  const funnelP0 = nsc.p0;

  const nowMs = Date.now();
  let hasTaskMeta = false;
  let hoursLeft = Infinity;
  let p0Threshold = 24;
  let p1Threshold = 48;
  let p2ThresholdPercent = 50;

  if (taskId) {
    const task = crud.getTaskById(taskId);
    if (task && task.ddl_at) {
      hasTaskMeta = true;
      const ddlMs = new Date(task.ddl_at).getTime();
      hoursLeft = (ddlMs - nowMs) / (1000 * 60 * 60);
      const rules = parseAutoNudgeRules(task.auto_nudge_rules);
      const h = getDeadlineCrisisHours(rules);
      if (h) {
        p0Threshold = h.p0Hours;
        p1Threshold = h.p1Hours;
        p2ThresholdPercent = h.p2Percent;
      }
    }
  }

  const p2Triggered = hasTaskMeta;
  const p1Triggered = hasTaskMeta && hoursLeft <= p1Threshold;
  const p0Triggered = hasTaskMeta && hoursLeft <= p0Threshold;
  const unfinishedTriggered = hasTaskMeta && hoursLeft <= 0;

  const rawP2 = nsc.p2;
  const rawP1 = nsc.p1;
  const rawP0 = nsc.p0;

  const stageArray = [
    { stage: 'P2', label: 'P2', count: funnelP2, rawCount: rawP2, triggered: p2Triggered },
    { stage: 'P1', label: 'P1', count: funnelP1, rawCount: rawP1, triggered: p1Triggered },
    { stage: 'P0', label: 'P0', count: funnelP0, rawCount: rawP0, triggered: p0Triggered },
    { stage: 'Unfinished', label: '未完成', count: unfinished, rawCount: unfinished, triggered: unfinishedTriggered },
  ];

  const maxCount = Math.max(...stageArray.map((s) => s.count), 1);
  const stageWidth = (count) => parseFloat(((count / maxCount) * 100).toFixed(2));

  const stageConversionRate = (index) => {
    if (index === 0) return null;
    const prevStage = stageArray[index - 1];
    const currStage = stageArray[index];
    if (!prevStage.triggered || !currStage.triggered) return null;
    const prevCount = prevStage.count;
    const currCount = currStage.count;
    if (prevCount === 0) return null;
    const saved = prevCount - currCount;
    if (saved < 0) return null;
    return parseFloat(((saved / prevCount) * 100).toFixed(2));
  };

  let overallConversionRate = null;
  if (funnelP2 > 0 && hasTaskMeta) {
    let lastCount = funnelP2;
    if (hoursLeft <= 0) lastCount = unfinished;
    else if (hoursLeft <= p0Threshold) lastCount = funnelP0;
    else if (hoursLeft <= p1Threshold) lastCount = funnelP1;
    const saved = funnelP2 - lastCount;
    if (saved >= 0 && lastCount !== funnelP2) {
      overallConversionRate = parseFloat(((saved / funnelP2) * 100).toFixed(2));
    }
  }

  const result = stageArray.map((s, i) => ({
    stage: s.stage, label: s.label,
    count: s.count, rawCount: s.rawCount,
    width: stageWidth(s.count),
    conversionRate: i === 0 ? null : stageConversionRate(i),
    percentageOfTotal: total > 0 ? parseFloat(((s.count / total) * 100).toFixed(1)) : 0,
    rawPercentageOfTotal: total > 0 ? parseFloat(((s.rawCount / total) * 100).toFixed(1)) : 0,
  }));

  return {
    taskId: taskId || null,
    platform: overview.platform || null,
    stages: result,
    overallConversionRate,
    maxCount,
    updatedAt: overview.updatedAt || formatNowSqliteLocal(),
  };
}

function getAlertDrillDownData(query) {
  const { taskId, alertLevel, rtmLevel = 'rtm' } = query;
  if (!taskId) throw createError(400, 'taskId 为必填参数', 'DASH_001');
  const drill = parseStoreDrill(query);
  const platform = parsePlatformFilter(query);
  const { selectDim, groupByDim } = crud.buildDimensionSelect(rtmLevel, 'entity_name');
  const updatedAt = formatNowSqliteLocal();

  if (alertLevel === 'Unfinished') {
    const completedCond = crud.buildCompletedCond(platform, 'ta');
    const rows = crud.queryAssignmentGroupedAgg({
      taskId, drill, platform, selectDim, groupByDim,
      having: 'HAVING uncompleted_count > 0',
      orderBy: 'ORDER BY assignment_count DESC',
      extraSelect: `, COUNT(ta.id) - SUM(CASE WHEN ${completedCond} THEN 1 ELSE 0 END) AS uncompleted_count`,
    });

    return {
      taskId, alertLevel,
      dimension: String(rtmLevel).toLowerCase(),
      platform: platform ? platform.sourceLabel : null,
      rows: rows.map((r) => {
        const total = r.assignment_count || 0;
        const uncompleted = r.uncompleted_count || 0;
        return {
          name: r.entity_name || '(未知)',
          totalEmployees: total,
          completedCount: r.completed_count || 0,
          riskCount: uncompleted,
          riskRate: total > 0 ? parseFloat((uncompleted / total).toFixed(4)) : 0,
        };
      }),
      updatedAt,
    };
  }

  const levelKey = alertLevel === 'P0' ? 'red' : alertLevel === 'P1' ? 'orange' : 'yellow';
  const nudgeData = getNudgeConversionBoardData({ ...query, level: String(rtmLevel).toLowerCase() });

  const mappedRows = nudgeData.list
    .filter((a) => a[levelKey].nudged > 0)
    .map((a) => {
      const stats = a[levelKey];
      return {
        name: a.targetName,
        totalEmployees: a.total?.nudged || 0,
        completedCount: stats.converted,
        riskCount: stats.nudged,
        riskRate: stats.rate / 100,
        nudged: stats.nudged,
        converted: stats.converted,
        conversionRate: stats.rate,
      };
    });

  return {
    taskId, alertLevel,
    dimension: String(rtmLevel).toLowerCase(),
    platform: platform ? platform.sourceLabel : null,
    rows: mappedRows,
    updatedAt,
  };
}

function getHeatmapBoardData(query) {
  const { taskId, rtmLevel = 'rtm' } = query;
  if (!taskId) throw createError(400, 'taskId 为必填参数', 'DASH_001');
  const drill = parseStoreDrill(query);
  const platform = parsePlatformFilter(query);
  const { selectDim, groupByDim } = crud.buildDimensionSelect(rtmLevel, 'rtm_value');

  const rows = crud.queryAssignmentGroupedAgg({
    taskId, drill, platform, selectDim, groupByDim,
    orderBy: 'ORDER BY completion_rate DESC',
  });

  const heatmapData = rows.map((r) => {
    const hours = r.avg_completion_time_hours !== null && r.avg_completion_time_hours !== undefined
      ? parseFloat(r.avg_completion_time_hours) : null;
    let avgTimeFormatted = '-';
    if (hours !== null && hours !== undefined) {
      if (hours > 0 && hours < 0.1) avgTimeFormatted = '< 0.1h';
      else avgTimeFormatted = `${hours.toFixed(1)}h`;
    }
    return {
      rtmValue: r.rtm_value || '(未知)',
      completionRate: r.completion_rate || 0,
      avgCompletionTimeHours: hours || 0,
      avgTimeFormatted,
      color: heatmapColor(r.completion_rate || 0),
      assignmentCount: r.assignment_count,
      completedCount: r.completed_count,
      inProgressCount: r.in_progress_count,
    };
  });

  const updatedAt = rows.length > 0
    ? rows.reduce((m, r) => (r.last_updated > m ? r.last_updated : m), '')
    : formatNowSqliteLocal();

  return {
    taskId, rtmLevel,
    platform: platform ? platform.sourceLabel : null,
    heatmapData, updatedAt,
  };
}

function getTrendBoardData(query) {
  const { taskId, type = 'daily', date } = query;
  if (!taskId) throw createError(400, 'taskId 不能为空', 'DASH_001');
  if (!['daily', 'hourly'].includes(type)) {
    throw createError(400, 'type 必须是 daily 或 hourly', 'DASH_005');
  }

  const drill = parseStoreDrill(query);
  const platform = parsePlatformFilter(query);
  const targetDate = date || formatLocalDateYYYYMMDD();
  const completedAtExpr = platform ? 'COALESCE(ta.completed_at, ta.updated_at)' : 'ta.completed_at';

  let rows;
  if (type === 'daily') {
    rows = crud.queryDailyCompletions({ taskId, drill, platform, completedAtExpr });
  } else {
    rows = crud.queryHourlyCompletions({ taskId, drill, platform, date: targetDate, completedAtExpr });
  }

  let cumulativeCount = 0;
  const trendData = rows.map((r) => {
    cumulativeCount += r.new_completed;
    return {
      timeKey: r.time_key,
      newCompleted: r.new_completed,
      cumulativeCompleted: cumulativeCount,
    };
  });

  return {
    taskId, type,
    date: targetDate,
    platform: platform ? platform.sourceLabel : null,
    trendData,
  };
}

function getUnifiedAlertsBoardData(query) {
  const { taskId } = query;
  const platform = parsePlatformFilter(query);
  const alerts = [];

  const levels = [
    { level: 'p2', label: 'P2', descFallback: '起步异常' },
    { level: 'p1', label: 'P1', descFallback: '临期 P1 预警' },
    { level: 'p0', label: 'P0', descFallback: '高危 P0 预警' },
  ];
  for (const { level, label, descFallback } of levels) {
    try {
      const wr = getWarningsBoardData({
        ...query,
        warningLevel: level,
        pageSize: 500,
        level: 'store',
      });
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
    } catch (e) { /* skip failed level */ }
  }

  try {
    const hm = getHeatmapBoardData({ taskId, rtmLevel: 'store', platform: platform ? platform.sourceLabel : undefined });
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

  const list = alerts.map((a) => ({
    ...a,
    rtm3: a.rtm3 || '未分类 RTM3',
    rtm4: a.rtm4 || '未分类 RTM4',
    dealer: a.dealer || '默认经销商',
    store: a.storeName || a.related_entity || '默认门店',
  }));

  return {
    taskId: taskId || null,
    platform: platform ? platform.sourceLabel : null,
    list,
    total: list.length,
    updatedAt: formatNowSqliteLocal(),
  };
}

function getWarningsBoardData(query) {
  const { taskId, warningLevel, pageNum = 1, pageSize = 20, level = 'store' } = query;
  if (warningLevel && !['p2', 'p1', 'p0', 'startDelay'].includes(warningLevel)) {
    throw createError(400, 'warningLevel 非法（p2/p1/p0/startDelay）', 'DASH_003');
  }
  const drill = parseStoreDrill(query);
  const platform = parsePlatformFilter(query);

  const page = Math.max(1, parseInt(pageNum, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));
  const offset = (page - 1) * limit;

  const nowIso = formatNowSqliteLocal();
  const nowMs = Date.now();
  const rawRows = crud.queryWarningAggregate({ taskId, drill, platform, level, nowIso });

  const severityMap = { p0: 'red', p1: 'orange', p2: 'yellow' };
  const targetSeverity = severityMap[warningLevel];
  const historicalStats = {};
  if (targetSeverity && taskId) {
    const eventRows = crud.queryWarningHistoricalEvents({ taskId, severity: targetSeverity, level });
    for (const row of eventRows) {
      historicalStats[row.target_id] = row.cnt;
    }
  }

  const matched = [];
  for (const r of rawRows) {
    const createdAtMs = new Date(r.task_created_at).getTime();
    const ddlMs = new Date(r.ddl_at).getTime();
    const hoursLeft = (ddlMs - nowMs) / (1000 * 60 * 60);
    const passedMs = nowMs - createdAtMs;
    const totalDur = ddlMs - createdAtMs;
    const passedPct = totalDur > 0 ? (passedMs / totalDur) * 100 : 100;

    const rules = parseAutoNudgeRules(r.auto_nudge_rules);
    const band = classifyDeadlineCrisisBand(rules, hoursLeft, passedPct);

    const histCount = historicalStats[r.target_id] || 0;
    const isRealTimeMatch = band && (!warningLevel || warningLevel === band);
    const isHistoryMatch = warningLevel && histCount > 0;
    if (!isRealTimeMatch && !isHistoryMatch) continue;

    r._band = isRealTimeMatch ? band : warningLevel;
    r._riskCount = histCount > 0 ? histCount : r.uncompleted_count;
    r._warningRate = (r._riskCount / r.total_count) * 100;
    matched.push(r);
  }

  matched.sort((a, b) => (b._warningRate || 0) - (a._warningRate || 0));
  const total = matched.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
  const pageSlice = matched.slice(offset, offset + limit);

  const list = pageSlice.map((r) => {
    const band = r._band;
    const rules = parseAutoNudgeRules(r.auto_nudge_rules);
    const h = getDeadlineCrisisHours(rules);
    const warningRate = r._warningRate ?? 0;

    let triggerDesc = '';
    if (band === 'p0') {
      triggerDesc = `距 Deadline 不足${h.p0Hours}小时，仍有 ${r.uncompleted_count} 人未完成（P0）`;
    } else if (band === 'p1') {
      triggerDesc = `距 Deadline 不足${h.p1Hours}小时，仍有 ${r.uncompleted_count} 人未完成（P1）`;
    } else if (band === 'p2') {
      triggerDesc = `任务时间进度已达 ${Number(h.p2Percent).toFixed(0)}% 阈值，仍有 ${r.uncompleted_count} 人未完成（P2）`;
    }

    return {
      taskId: r.task_id,
      targetId: r.target_id,
      targetName: r.target_name,
      targetType: level,
      storeId: r.target_id,
      storeName: r.target_name,
      warningLevel: band,
      warningRate,
      riskCount: r._riskCount,
      completionRate: r.completion_rate,
      completedCount: r.completed_count,
      totalCount: r.total_count,
      overdueCount: r.overdue_count,
      triggerDesc,
      aiSuggestion: '建议及时督促对应门店/区域进行学习',
      updatedAt: r.last_updated || nowIso,
    };
  });

  return {
    platform: platform ? platform.sourceLabel : null,
    list,
    pagination: { pageNum: page, pageSize: limit, total, totalPages },
  };
}

function getNudgeConversionBoardData(query) {
  const { taskId, pageNum = 1, pageSize = 20, level = 'store' } = query;
  const drill = parseStoreDrill(query);
  const platform = parsePlatformFilter(query);

  const page = Math.max(1, parseInt(pageNum, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));
  const offset = (page - 1) * limit;

  const rawRows = crud.queryNudgeConversion({ taskId, drill, platform, level });
  const totalRows = crud.queryNudgeConversionTotals({ taskId, drill, platform, level });

  const map = new Map();
  for (const r of rawRows) {
    if (!map.has(r.target_id)) {
      map.set(r.target_id, {
        targetId: r.target_id,
        targetName: r.target_name,
        targetType: level,
        red: { nudged: 0, converted: 0, rate: 0 },
        orange: { nudged: 0, converted: 0, rate: 0 },
        yellow: { nudged: 0, converted: 0, rate: 0 },
        total: { nudged: 0, converted: 0, rate: 0 },
      });
    }
    const item = map.get(r.target_id);
    const sev = r.severity;
    if (item[sev]) {
      item[sev].nudged += r.total_nudged;
      item[sev].converted += r.converted_nudged;
      item[sev].rate = item[sev].nudged > 0
        ? parseFloat(((100 * item[sev].converted) / item[sev].nudged).toFixed(2))
        : 0;
    }
  }

  for (const tr of totalRows) {
    if (map.has(tr.target_id)) {
      const item = map.get(tr.target_id);
      item.total.nudged = tr.overall_nudged;
      item.total.converted = tr.overall_converted;
      item.total.rate = tr.overall_nudged > 0
        ? parseFloat(((100 * tr.overall_converted) / tr.overall_nudged).toFixed(2))
        : 0;
    }
  }

  const matched = Array.from(map.values());
  matched.sort((a, b) => b.total.nudged - a.total.nudged);

  const totalRecords = matched.length;
  const totalPages = totalRecords === 0 ? 0 : Math.ceil(totalRecords / limit);
  const list = matched.slice(offset, offset + limit);

  return {
    platform: platform ? platform.sourceLabel : null,
    list,
    pagination: { pageNum: page, pageSize: limit, total: totalRecords, totalPages },
  };
}

module.exports = {
  getOverviewBoardData,
  getFunnelBoardData,
  getAlertFunnelData,
  getAlertDrillDownData,
  getUnifiedAlertsBoardData,
  getHeatmapBoardData,
  getTrendBoardData,
  getWarningsBoardData,
  getNudgeConversionBoardData,
};
