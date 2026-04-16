'use strict';

/**
 * dashboard.js — 看板聚合查询（Day 5 Dev2）
 *
 * 端点：
 *   GET /api/v1/dashboard/overview   §5.1 总部/Executive 概览 KPI
 *   GET /api/v1/dashboard/heatmap    §5.2 RTM/区域热力图
 *   GET /api/v1/dashboard/store-rank §5.3 Top/Bottom N 门店排行
 *   GET /api/v1/dashboard/warnings   §5.5 预警列表（临期 p0/p1 + 起步 startDelay）
 *
 * 门店层级下钻（可选 query，可组合，AND）：rtm、format、dealerName、storeId
 * 对应 stores：rtm → format → dealer_name → id。不传则与旧行为一致。
 *
 * completionRate / avgProgress 统一为整数 0-100。
 * 数据全部实时从 task_assignments 聚合，无缓存表。
 */

const express = require('express');
const { db } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { createError } = require('../middleware/errorHandler');
const { parseStoreDrill } = require('../utils/storeDrill');
const { formatLocalDateYYYYMMDD, formatNowSqliteLocal } = require('../utils/ddlAt');
const {
  parseAutoNudgeRules,
  classifyDeadlineCrisisBand,
  getDeadlineCrisisHours,
} = require('../services/autoNudgeRules');
const {
  computeAssignmentWarningRates,
  ruleBasedStoreWarningRate,
} = require('../utils/dashboardWarningRates');

const router = express.Router();

// ─── 工具函数 ──────────────────────────────────────────────────────────────────

function heatmapColor(rate) {
  if (rate >= 80) return '#4CAF50';
  if (rate >= 50) return '#FF9900';
  return '#F44336';
}

function aiSuggestion(rate) {
  if (rate < 30) return '情况紧急，建议立即电话跟进并发起红色催办';
  if (rate < 50) return '建议发起红色催办';
  return '建议通过系统发送黄色催办提醒';
}

// ─── GET /api/v1/dashboard/overview ──────────────────────────────────────────
// §5.1 总部概览 KPI

router.get('/overview', authenticate, requireRole(['central', 'executive', 'admin']), (req, res, next) => {
  try {
    const { taskId } = req.query;
    const drill = parseStoreDrill(req.query);

    const taConditions = ['1=1'];
    const taParams = [];
    if (taskId) { taConditions.push('ta.task_id = ?'); taParams.push(taskId); }

    const joinStore = drill.hasDrill ? 'JOIN stores s ON s.id = ta.store_id' : '';
    const storeWhere = drill.hasDrill ? drill.sql : '';
    const allParams = [...taParams, ...drill.params];
    const nowMs = Date.now();

    // ─ assignment 基础聚合 ──
    const base = db.get(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN ta.status = 'completed'  THEN 1 ELSE 0 END) AS completed_count,
         SUM(CASE WHEN ta.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_count,
         SUM(CASE WHEN ta.status = 'pending'     THEN 1 ELSE 0 END) AS pending_count,
         SUM(CASE WHEN ta.status = 'completed' AND ta.completed_at <= t.ddl_at THEN 1 ELSE 0 END) AS completed_on_time_count,
         AVG(CASE WHEN ta.status = 'completed' AND ta.completed_at IS NOT NULL AND t.created_at IS NOT NULL THEN (julianday(ta.completed_at) - julianday(t.created_at)) * 24 END) AS avg_completion_time_hours,
         MAX(ta.updated_at) AS last_updated
       FROM task_assignments ta
       JOIN tasks t ON t.id = ta.task_id
       ${joinStore}
       WHERE ${taConditions.join(' AND ')} ${storeWhere}`,
      allParams
    );

    const total        = base.total        || 0;
    const completedCnt = base.completed_count    || 0;
    const inProgCnt    = base.in_progress_count  || 0;
    const pendingCnt   = base.pending_count      || 0;
    const completionRate =
      total > 0 ? parseFloat(((100 * completedCnt) / total).toFixed(2)) : 0;

    // 新增: 整体任务按时完成率 & 人均完成时间 (小时)
    const completedOnTimeCnt = base.completed_on_time_count || 0;
    const onTimeCompletionRate =
      total > 0 ? parseFloat(((100 * completedOnTimeCnt) / total).toFixed(2)) : 0;
    const avgCompletionTimeHours = base.avg_completion_time_hours ? parseFloat(base.avg_completion_time_hours.toFixed(1)) : 0;

    // ─ 逾期数（未完成 AND 当前时间 > ddl_at）──
    const overdueRow = db.get(
      `SELECT COUNT(*) AS cnt
       FROM task_assignments ta
       JOIN tasks t ON t.id = ta.task_id
       ${joinStore}
       WHERE ${taConditions.join(' AND ')} ${storeWhere}
         AND ta.status != 'completed'
         AND datetime('now', 'localtime') > t.ddl_at`,
      allParams
    );
    const overdueCount = (overdueRow && overdueRow.cnt) || 0;

    // ─ 推送人数（task_assigned 通知去重）──
    let pushUserCount = 0;
    if (drill.hasDrill && taskId) {
      const pr = db.get(
        `SELECT COUNT(DISTINCT ne.target_user_id) AS cnt
         FROM notification_events ne
         JOIN stores s ON s.id = ne.store_id
         WHERE ne.task_id = ? AND ne.event_type = 'task_assigned' ${drill.sql}`,
        [taskId, ...drill.params]
      );
      pushUserCount = (pr && pr.cnt) || 0;
    } else {
      const pushRow = db.get(
        `SELECT COUNT(DISTINCT ne.target_user_id) AS cnt
         FROM notification_events ne
         ${taskId ? 'WHERE ne.task_id = ? AND ne.event_type = \'task_assigned\'' : 'WHERE ne.event_type = \'task_assigned\''}`,
        taskId ? [taskId] : []
      );
      pushUserCount = (pushRow && pushRow.cnt) || 0;
    }

    // ─ 已读人数（task_detail_open 去重）──
    const baseNeCond = taskId ? 'ne.task_id = ?' : '1=1';
    const baseNeParam = taskId ? [taskId] : [];

    let employeeReadCount = 0;
    let managerReadCount = 0;
    if (drill.hasDrill && taskId) {
      const readRow = db.get(
        `SELECT COUNT(DISTINCT rr.user_id) AS cnt
         FROM read_receipts rr
         JOIN notification_events ne ON ne.id = rr.event_id
         JOIN stores s ON s.id = ne.store_id
         WHERE ne.task_id = ? AND rr.source = 'task_detail_open' ${drill.sql}`,
        [taskId, ...drill.params]
      );
      employeeReadCount = (readRow && readRow.cnt) || 0;
      managerReadCount = employeeReadCount;
    } else {
      const empReadRow = db.get(
        `SELECT COUNT(DISTINCT rr.user_id) AS cnt
         FROM read_receipts rr
         JOIN notification_events ne ON ne.id = rr.event_id
         WHERE ${baseNeCond}
           AND rr.source = 'task_detail_open'`,
        baseNeParam
      );
      employeeReadCount = (empReadRow && empReadRow.cnt) || 0;
      const mgrReadRow = db.get(
        `SELECT COUNT(DISTINCT rr.user_id) AS cnt
         FROM read_receipts rr
         JOIN notification_events ne ON ne.id = rr.event_id
         WHERE ${baseNeCond}
           AND rr.source = 'task_detail_open'`,
        baseNeParam
      );
      managerReadCount = (mgrReadRow && mgrReadRow.cnt) || 0;
    }
    // 已读人数：与下钻无关均为「DISTINCT rr.user_id」一条口径；managerReadCount 占位与 employee 同值时再相加会翻倍
    const totalReadCount = employeeReadCount;

    // ─ 预警数（门店+任务维度）；临期口径与 autoNudge.evaluateAndTriggerAutoNudges 一致（tasks.auto_nudge_rules.deadlineCrisis、p0/p1 小时、hoursLeft<=0 不计）
    const storeTaskRows = db.all(
      `SELECT
         ta.store_id,
         ta.task_id,
         t.ddl_at,
         t.auto_nudge_rules,
         SUM(CASE WHEN ta.status != 'completed' THEN 1 ELSE 0 END) AS uncompleted_count
       FROM task_assignments ta
       JOIN tasks t ON t.id = ta.task_id
       ${joinStore}
       WHERE ${taConditions.join(' AND ')} ${storeWhere}
       GROUP BY ta.store_id, ta.task_id`,
      allParams
    );
    let warnP1 = 0;
    let warnP0 = 0;
    for (const row of storeTaskRows) {
      if (!row.uncompleted_count) continue;
      const rules = parseAutoNudgeRules(row.auto_nudge_rules);
      const ddlAt = new Date(row.ddl_at).getTime();
      const hoursLeft = (ddlAt - nowMs) / (1000 * 60 * 60);
      const band = classifyDeadlineCrisisBand(rules, hoursLeft);
      if (band === 'p0') warnP0++;
      else if (band === 'p1') warnP1++;
    }

    // ─ 预警及链路相关指标 (PRD 1.3) ──
    // 催办转化率：有被催办且在催办后开始任务/完成任务的 assignment 数？
    // 简化处理：若 PRD 只写“点击任务开始学习任务数/总任务数”，那可能就是 `started` / `total`。但因为名字叫“催办转化率”，我们取:
    // 有被催办记录（nudge_count > 0）且已开始或已完成的数量 / 被催办的总数量。
    const nudgeRow = db.get(
      `SELECT
         COUNT(ta.id) AS total_nudged,
         SUM(CASE WHEN ta.started_at IS NOT NULL OR ta.status = 'completed' THEN 1 ELSE 0 END) AS converted_nudged
       FROM task_assignments ta
       ${joinStore}
       WHERE ${taConditions.join(' AND ')} ${storeWhere} AND ta.nudge_count > 0`,
      allParams
    );
    const nudgeConversionRate =
      nudgeRow.total_nudged > 0
        ? parseFloat(((100 * nudgeRow.converted_nudged) / nudgeRow.total_nudged).toFixed(2))
        : 0;

    // 起步异常 / 临期 P0/P1：与 autoNudge 规则一致，按 assignment 计数 ÷ total（与 GET /dashboard/warnings 下钻门店率同口径）
    const assignRateRows = db.all(
      `SELECT ta.status, ta.progress, t.created_at, t.ddl_at, t.auto_nudge_rules
       FROM task_assignments ta
       JOIN tasks t ON t.id = ta.task_id
       ${joinStore}
       WHERE ${taConditions.join(' AND ')} ${storeWhere}`,
      allParams
    );
    const {
      startDelayRate,
      crisisP0Rate,
      crisisP1Rate,
    } = computeAssignmentWarningRates(assignRateRows, total, nowMs);

    // 任务触达率：晚于下发时间(ta.created_at)登录就算触达，或者任务已经收到（ta.received_at有值），或者通过websocket收到了通知
    const reachRow = db.get(
      `SELECT COUNT(ta.id) AS reached_count
       FROM task_assignments ta
       JOIN users u ON ta.user_id = u.employee_id
       ${joinStore}
       WHERE ${taConditions.join(' AND ')} ${storeWhere}
         AND (
           (u.last_login_at IS NOT NULL AND u.last_login_at >= ta.created_at)
           OR ta.received_at IS NOT NULL
         )`,
      allParams
    );
    const reachedCount = (reachRow && reachRow.reached_count) || 0;
    const taskReachRate = total > 0 ? parseFloat(((reachedCount / total) * 100).toFixed(2)) : 0;

    res.json({
      code: 200,
      message: 'success',
      data: {
        totalAssignments: total,
        pushUserCount,
        employeeReadCount,
        managerReadCount,
        totalReadCount,
        
        // 核心北极星指标
        completionRate,
        completedCount:  completedCnt,
        onTimeCompletionRate,
        avgCompletionTimeHours,

        // 链路数据
        taskReachRate,
        taskReadRate: total > 0 ? parseFloat(((totalReadCount / total) * 100).toFixed(2)) : 0,
        nudgeConversionRate,
        
        // 预警数据
        startDelayRate,
        crisisP1Rate,
        crisisP0Rate,

        inProgressCount: inProgCnt,
        pendingCount:    pendingCnt,
        overdueCount,
        warningCount: { p1: warnP1, p0: warnP0 },
        updatedAt: base.last_updated || formatNowSqliteLocal(),
      },
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/v1/dashboard/heatmap ────────────────────────────────────────────
// §5.2 RTM / 区域 / 业态热力图

router.get('/heatmap', authenticate, requireRole(['central', 'executive', 'admin']), (req, res, next) => {
  try {
    const { taskId, rtmLevel = 'rtm' } = req.query;
    if (!taskId) throw createError(400, 'taskId 为必填参数', 'DASH_001');

    const drill = parseStoreDrill(req.query);
    const level = String(rtmLevel).toLowerCase();

    // rtm / region / format / subRtm；dealer(dealer_name) / store 为下钻维度
    const colMap = {
      rtm: 's.rtm',
      region: 's.region',
      format: 's.format',
      subrtm: 's.rtm',
      dealer: 's.dealer_name',
      dealer_name: 's.dealer_name',
      dealername: 's.dealer_name',
    };

    let selectDim;
    let groupByDim;
    if (level === 'store') {
      selectDim = 'MAX(s.name) AS rtm_value';
      groupByDim = 's.id';
    } else if (level === 'dealer' || level === 'dealer_name' || level === 'dealername') {
      selectDim = 'COALESCE(NULLIF(TRIM(s.dealer_name), \'\'), \'(未知)\') AS rtm_value';
      groupByDim = 'COALESCE(NULLIF(TRIM(s.dealer_name), \'\'), \'\')';
    } else {
      const col = colMap[level] || 's.rtm';
      selectDim = `${col} AS rtm_value`;
      groupByDim = col;
    }

    const heatParams = [taskId, ...drill.params];
    const rows = db.all(
      `SELECT
         ${selectDim},
         COUNT(ta.id) AS assignment_count,
         SUM(CASE WHEN ta.status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
         ROUND(100.0 * SUM(CASE WHEN ta.status='completed' THEN 1 ELSE 0 END) / COUNT(ta.id), 2) AS completion_rate,
         AVG(CASE WHEN ta.status = 'completed' AND ta.completed_at IS NOT NULL AND t.created_at IS NOT NULL THEN (julianday(ta.completed_at) - julianday(t.created_at)) * 24 END) AS avg_completion_time_hours,
         MAX(ta.updated_at) AS last_updated
       FROM task_assignments ta
       JOIN stores s ON s.id = ta.store_id
       JOIN tasks t ON t.id = ta.task_id
       WHERE ta.task_id = ? ${drill.sql}
       GROUP BY ${groupByDim}
       ORDER BY completion_rate DESC`,
      heatParams
    );

    const heatmapData = rows.map(r => ({
      rtmValue:       r.rtm_value || '(未知)',
      completionRate: r.completion_rate || 0,
      avgCompletionTimeHours: r.avg_completion_time_hours ? parseFloat(r.avg_completion_time_hours.toFixed(1)) : 0,
      color:          heatmapColor(r.completion_rate || 0),
      assignmentCount: r.assignment_count,
      completedCount:  r.completed_count,
    }));

    const updatedAt = rows.length > 0
      ? rows.reduce((m, r) => (r.last_updated > m ? r.last_updated : m), '')
      : formatNowSqliteLocal();

    res.json({
      code: 200,
      message: 'success',
      data: { taskId, rtmLevel, heatmapData, updatedAt },
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/v1/dashboard/store-rank ─────────────────────────────────────────
// §5.3 Top / Bottom N 门店排行

router.get('/store-rank', authenticate, requireRole(['central', 'executive', 'admin']), (req, res, next) => {
  try {
    const { taskId, type, limit = 5 } = req.query;
    const drill = parseStoreDrill(req.query);

    if (!taskId) throw createError(400, 'taskId 为必填参数', 'DASH_001');
    if (!type || !['top', 'bottom'].includes(type)) {
      throw createError(400, 'type 必须为 top 或 bottom', 'DASH_002');
    }
    const n = Math.min(50, Math.max(1, parseInt(limit, 10) || 5));

    const conditions = ['ta.task_id = ?'];
    const params = [taskId];
    if (drill.hasDrill) {
      conditions.push(drill.sql.replace(/^\s*AND\s+/, ''));
      params.push(...drill.params);
    }

    const whereClause = conditions.join(' AND ');

    const orderDir = type === 'top' ? 'DESC' : 'ASC';
    const bottomFilter = type === 'bottom' ? 'HAVING completion_rate < 100' : '';

    const rows = db.all(
      `SELECT
         s.id AS store_id,
         s.name AS store_name,
         COUNT(ta.id) AS assignment_count,
         SUM(CASE WHEN ta.status='completed' THEN 1 ELSE 0 END) AS completed_count,
         ROUND(100.0 * SUM(CASE WHEN ta.status='completed' THEN 1 ELSE 0 END) / COUNT(ta.id), 2) AS completion_rate,
         ROUND(AVG(ta.progress), 0) AS avg_progress
       FROM task_assignments ta
       JOIN stores s ON s.id = ta.store_id
       WHERE ${whereClause}
       GROUP BY ta.store_id
       ${bottomFilter}
       ORDER BY completion_rate ${orderDir}, avg_progress ${orderDir}, s.id ASC
       LIMIT ?`,
      [...params, n]
    );

    const rankList = rows.map(r => ({
      storeId:         r.store_id,
      storeName:       r.store_name,
      completionRate:  r.completion_rate || 0,
      assignmentCount: r.assignment_count,
      completedCount:  r.completed_count,
    }));

    const updatedAt = formatNowSqliteLocal();
    res.json({
      code: 200,
      message: 'success',
      data: { taskId, type, rankList, updatedAt },
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/v1/dashboard/warnings ───────────────────────────────────────────
// §5.5 预警列表（实时聚合，无独立 alerts 表）
// - p1/p0：task_assignments + deadlineCrisis 与 autoNudge 一致
// - 门店 warningRate：与 §5.1 同公式在单店范围（起步异常=进度0人数/店人数；临期=未完成人数/店人数，且任务须落在对应临期带）

router.get('/warnings', authenticate, requireRole(['central', 'admin']), (req, res, next) => {
  try {
    const { taskId, warningLevel, pageNum = 1, pageSize = 20 } = req.query;
    const drill = parseStoreDrill(req.query);

    if (warningLevel && !['p1', 'p0', 'startDelay'].includes(warningLevel)) {
      throw createError(400, 'warningLevel 非法（p1/p0/startDelay）', 'DASH_003');
    }

    const page  = Math.max(1, parseInt(pageNum,  10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));
    const offset = (page - 1) * limit;

    const conditions = ['1=1'];
    const params = [];
    if (taskId) { conditions.push('ta.task_id = ?'); params.push(taskId); }
    if (drill.hasDrill) {
      conditions.push(drill.sql.replace(/^\s*AND\s+/, ''));
      params.push(...drill.params);
    }

    const whereClause = conditions.join(' AND ');
    const nowIso = formatNowSqliteLocal();
    const nowMs = Date.now();

    if (warningLevel === 'startDelay') {
      const startDelaySql = `
      SELECT
        ta.task_id,
        ta.store_id,
        s.name AS store_name,
        MAX(t.created_at) AS task_created_at,
        t.ddl_at,
        t.auto_nudge_rules,
        COUNT(ta.id) AS total_count,
        SUM(CASE WHEN ta.status='completed' THEN 1 ELSE 0 END) AS completed_count,
        SUM(CASE WHEN ta.status!='completed' THEN 1 ELSE 0 END) AS uncompleted_count,
        SUM(CASE WHEN ta.status!='completed' AND COALESCE(ta.progress, 0) = 0 THEN 1 ELSE 0 END) AS zero_prog_incomplete,
        SUM(CASE WHEN ta.status!='completed' AND ? > t.ddl_at THEN 1 ELSE 0 END) AS overdue_count,
        ROUND(100.0 * SUM(CASE WHEN ta.status='completed' THEN 1 ELSE 0 END) / COUNT(ta.id), 2) AS completion_rate,
        MAX(ta.updated_at) AS last_updated
      FROM task_assignments ta
      JOIN stores s ON s.id = ta.store_id
      JOIN tasks t ON t.id = ta.task_id
      WHERE ${whereClause}
      GROUP BY ta.store_id, ta.task_id
    `;
      const rawRows = db.all(startDelaySql, [nowIso, ...params]);
      const matchedStartDelay = [];
      for (const r of rawRows) {
        const rules = parseAutoNudgeRules(r.auto_nudge_rules);
        if (!rules.startDelay) continue;
        const zp = r.zero_prog_incomplete || 0;
        if (!zp) continue;
        const createdAtMs = new Date(r.task_created_at).getTime();
        const ddlMs = new Date(r.ddl_at).getTime();
        const totalDur = ddlMs - createdAtMs;
        const passedPct = totalDur > 0 ? ((nowMs - createdAtMs) / totalDur) * 100 : 100;
        if (passedPct < rules.startDelay) continue;
        matchedStartDelay.push(r);
      }
      matchedStartDelay.forEach((r) => {
        r._warningRate = ruleBasedStoreWarningRate('startDelay', r);
      });
      matchedStartDelay.sort((a, b) => (b._warningRate || 0) - (a._warningRate || 0));
      const total = matchedStartDelay.length;
      const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
      const pageSlice = matchedStartDelay.slice(offset, offset + limit);

      const list = pageSlice.map((r) => {
        const rules = parseAutoNudgeRules(r.auto_nudge_rules);
        const completionRate = r.completion_rate || 0;
        const warningRate = r._warningRate ?? 0;
        const threshold = rules.startDelay;
        const triggerDesc =
          threshold != null && threshold !== ''
            ? `任务时间进度已达 ${Number(threshold).toFixed(0)}% 阈值（startDelay），店内仍有学员进度为 0`
            : '店内仍有学员进度为 0（起步异常 / startDelay）';
        return {
          taskId:         r.task_id,
          storeId:        r.store_id,
          storeName:      r.store_name,
          warningLevel:   'startDelay',
          warningRate,
          completionRate,
          completedCount: r.completed_count,
          totalCount:     r.total_count,
          overdueCount:   r.overdue_count || 0,
          triggerDesc,
          aiSuggestion:   aiSuggestion(completionRate),
          calculatedAt:   nowIso,
        };
      });

      return res.json({
        code: 200,
        message: 'success',
        data: {
          list,
          pagination: { pageNum: page, pageSize: limit, total, totalPages },
        },
        requestId: req.requestId,
      });
    }

    const aggregateSql = `
      SELECT
        ta.task_id,
        ta.store_id,
        s.name AS store_name,
        t.ddl_at,
        t.auto_nudge_rules,
        COUNT(ta.id) AS total_count,
        SUM(CASE WHEN ta.status='completed' THEN 1 ELSE 0 END) AS completed_count,
        SUM(CASE WHEN ta.status!='completed' THEN 1 ELSE 0 END) AS uncompleted_count,
        SUM(CASE WHEN ta.status!='completed' AND ? > t.ddl_at THEN 1 ELSE 0 END) AS overdue_count,
        ROUND(100.0 * SUM(CASE WHEN ta.status='completed' THEN 1 ELSE 0 END) / COUNT(ta.id), 2) AS completion_rate,
        MAX(ta.updated_at) AS last_updated
      FROM task_assignments ta
      JOIN stores s ON s.id = ta.store_id
      JOIN tasks t ON t.id = ta.task_id
      WHERE ${whereClause}
      GROUP BY ta.store_id, ta.task_id
    `;

    const rawRows = db.all(aggregateSql, [nowIso, ...params]);

    const matched = [];
    for (const r of rawRows) {
      if (!r.uncompleted_count) continue;
      const rules = parseAutoNudgeRules(r.auto_nudge_rules);
      const ddlAt = new Date(r.ddl_at).getTime();
      const hoursLeft = (ddlAt - nowMs) / (1000 * 60 * 60);
      const band = classifyDeadlineCrisisBand(rules, hoursLeft);
      if (!band) continue;
      if (warningLevel && band !== warningLevel) continue;
      matched.push({ row: r, band });
    }

    matched.forEach(({ row: r, band }) => {
      r._warningRate = ruleBasedStoreWarningRate(band, r);
    });
    matched.sort((a, b) => (b.row._warningRate || 0) - (a.row._warningRate || 0));

    const total = matched.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    const pageSlice = matched.slice(offset, offset + limit);

    const list = pageSlice.map(({ row: r, band }) => {
      const rules = parseAutoNudgeRules(r.auto_nudge_rules);
      const h = getDeadlineCrisisHours(rules);
      const completionRate = r.completion_rate || 0;
      const warningRate = r._warningRate ?? 0;
      const triggerDesc = band === 'p0'
        ? `距 Deadline 不足${h.p0Hours}小时，仍未完成（P0）`
        : `距 Deadline 不足${h.p1Hours}小时，仍未完成（P1）`;
      return {
        taskId:         r.task_id,
        storeId:        r.store_id,
        storeName:      r.store_name,
        warningLevel:   band,
        warningRate,
        completionRate,
        completedCount: r.completed_count,
        totalCount:     r.total_count,
        overdueCount:   r.overdue_count || 0,
        triggerDesc,
        aiSuggestion:   aiSuggestion(completionRate),
        calculatedAt:   nowIso,
      };
    });

    res.json({
      code: 200,
      message: 'success',
      data: {
        list,
        pagination: { pageNum: page, pageSize: limit, total, totalPages },
      },
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/v1/dashboard/store-detail ───────────────────────────────────────
// 门店员工进度明细（下钻用）

router.get('/store-detail', authenticate, requireRole(['central', 'admin']), (req, res, next) => {
  try {
    const { taskId, storeId: qStoreId } = req.query;
    const { role, storeId: userStoreId } = req.user;

    if (!taskId) throw createError(400, 'taskId 为必填参数', 'DASH_001');

    const targetStoreId = qStoreId || null;
    if (!targetStoreId) throw createError(400, 'storeId 为必填参数（非 central 角色）', 'DASH_004');

    const rows = db.all(
      `SELECT
         e.id AS employee_id,
         e.name AS employee_name,
         ta.status,
         ta.progress,
         ta.mypal_completed,
         ta.smartsell_completed,
         ta.ai_demo_completed,
         ta.live_broadcast_completed,
         ta.nudge_count,
         ta.received_at,
         ta.started_at,
         ta.completed_at,
         ta.updated_at
       FROM task_assignments ta
       JOIN employees e ON e.id = ta.user_id
       WHERE ta.task_id = ? AND ta.store_id = ?
       ORDER BY ta.progress DESC`,
      [taskId, targetStoreId]
    );

    const store = db.get('SELECT id, name, region, rtm, format FROM stores WHERE id = ?', [targetStoreId]);

    const total     = rows.length;
    const completed = rows.filter(r => r.status === 'completed').length;
    const completionRate =
      total > 0 ? parseFloat(((100 * completed) / total).toFixed(2)) : 0;

    res.json({
      code: 200,
      message: 'success',
      data: {
        taskId,
        store: store || { id: targetStoreId },
        summary: {
          totalCount:      total,
          completedCount:  completed,
          completionRate,
          inProgressCount: rows.filter(r => r.status === 'in_progress').length,
          pendingCount:    rows.filter(r => r.status === 'pending').length,
        },
        employees: rows.map(r => ({
          employeeId:   r.employee_id,
          employeeName: r.employee_name,
          status:       r.status,
          progress:     r.progress,
          lagLevel:     r.progress >= 80 ? 'fast' : r.progress >= 50 ? 'medium' : 'behind',
          platformStatus: {
            mypalCompleted:          r.mypal_completed === 1,
            smartsellCompleted:      r.smartsell_completed === 1,
            aiDemoCompleted:         r.ai_demo_completed === 1,
            liveBroadcastCompleted:  r.live_broadcast_completed === 1,
          },
          nudgeCount:   r.nudge_count,
          receivedAt:   r.received_at || null,
          startedAt:    r.started_at  || null,
          completedAt:  r.completed_at || null,
          updatedAt:    r.updated_at,
        })),
        updatedAt: formatNowSqliteLocal(),
      },
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/v1/dashboard/trend ──────────────────────────────────────────────
// 完成人数的时间趋势（按天/按小时）
router.get('/trend', authenticate, requireRole(['central', 'executive', 'admin']), (req, res, next) => {
  try {
    const { taskId, type = 'daily', date } = req.query;
    const drill = parseStoreDrill(req.query);
    if (!taskId) throw createError(400, 'taskId 不能为空', 'DASH_001');
    if (!['daily', 'hourly'].includes(type)) {
      throw createError(400, 'type 必须是 daily 或 hourly', 'DASH_005');
    }

    const targetDate = date || formatLocalDateYYYYMMDD(); // 本地日历「当天」，避免 UTC 日期偏差
    const joinStore = drill.hasDrill ? 'JOIN stores s ON s.id = ta.store_id' : '';
    const storeWhere = drill.hasDrill ? drill.sql : '';
    const trendParamsDaily = [taskId, ...drill.params];
    const trendParamsHourly = [taskId, targetDate, ...drill.params];

    let rows;
    if (type === 'daily') {
      // 每日新增
      rows = db.all(
        `SELECT
           date(ta.completed_at) AS time_key,
           COUNT(ta.id) AS new_completed
         FROM task_assignments ta
         ${joinStore}
         WHERE ta.task_id = ? AND ta.status = 'completed' AND ta.completed_at IS NOT NULL ${storeWhere}
         GROUP BY date(ta.completed_at)
         ORDER BY date(ta.completed_at) ASC`,
        trendParamsDaily
      );
    } else {
      // 分小时新增 (指定日期)；占位符顺序：task_id、date(当天)、下钻条件
      rows = db.all(
        `SELECT
           strftime('%H', ta.completed_at) AS time_key,
           COUNT(ta.id) AS new_completed
         FROM task_assignments ta
         ${joinStore}
         WHERE ta.task_id = ? AND ta.status = 'completed' AND ta.completed_at IS NOT NULL
           AND date(ta.completed_at) = ? ${storeWhere}
         GROUP BY strftime('%H', ta.completed_at)
         ORDER BY strftime('%H', ta.completed_at) ASC`,
        trendParamsHourly
      );
    }

    let cumulativeCount = 0;
    const trendData = rows.map(r => {
      cumulativeCount += r.new_completed;
      return {
        timeKey: r.time_key,
        newCompleted: r.new_completed,
        cumulativeCompleted: cumulativeCount
      };
    });

    res.json({
      code: 200,
      message: 'success',
      data: { taskId, type, date: targetDate, trendData },
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
