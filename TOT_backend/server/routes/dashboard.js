'use strict';

/**
 * dashboard.js — 看板聚合查询（Day 5 Dev2）
 *
 * 端点：
 *   GET /api/v1/dashboard/overview   §5.1 总部/Executive 概览 KPI
 *   GET /api/v1/dashboard/heatmap    §5.2 RTM/区域热力图
 *   GET /api/v1/dashboard/store-rank §5.3 Top/Bottom N 门店排行
 *   GET /api/v1/dashboard/warnings   §5.5 预警列表（P0，实时聚合，无独立存储表）
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

const router = express.Router();

// ─── 工具函数 ──────────────────────────────────────────────────────────────────

function alertLevel(rate) {
  if (rate < 50) return 'p1';
  if (rate < 80) return 'p2';
  return 'normal';
}

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
         AND datetime('now') > t.ddl_at`,
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
    const totalReadCount   = employeeReadCount + managerReadCount;
    const realDeliveryRate = total > 0 ? parseFloat(((totalReadCount / total) * 100).toFixed(2)) : 0;

    // ─ 预警数（门店维度实时聚合）；无 stores 下钻时仍按店聚合（与旧版一致）
    const storeStats = db.all(
      `SELECT
         ta.store_id,
         t.ddl_at,
         COUNT(ta.id) AS total,
         ROUND(100.0 * SUM(CASE WHEN ta.status='completed' THEN 1 ELSE 0 END) / COUNT(ta.id), 2) AS completion_rate
       FROM task_assignments ta
       JOIN tasks t ON t.id = ta.task_id
       ${joinStore}
       WHERE ${taConditions.join(' AND ')} ${storeWhere}
       GROUP BY ta.store_id${taskId ? ', ta.task_id' : ''}`,
      allParams
    );
    let warnP1 = 0, warnP2 = 0;
    const now = new Date();
    for (const row of storeStats) {
      const rate = row.completion_rate || 0;
      const hoursLeft = (new Date(row.ddl_at) - now) / 3600000;
      // P1：完成率<50%，或完成率<80%且距截止不足24h
      const isP1 = rate < 50 || (rate < 80 && hoursLeft < 24);
      if (isP1) warnP1++;
      else if (rate < 80) warnP2++;
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

    // 起步异常/P0/P1预警统计 (基于 notification_events dedupe_key 包含的 ruleType 或事件类型)
    const warnStatsRow = db.get(
      `SELECT
         SUM(CASE WHEN ne.dedupe_key LIKE '%startDelay%' THEN 1 ELSE 0 END) AS start_delay_cnt,
         SUM(CASE WHEN ne.dedupe_key LIKE '%deadlineCrisisP0%' THEN 1 ELSE 0 END) AS p0_cnt,
         SUM(CASE WHEN ne.dedupe_key LIKE '%deadlineCrisisP1%' THEN 1 ELSE 0 END) AS p1_cnt
       FROM notification_events ne
       JOIN task_assignments ta ON ne.assignment_id = ta.id
       ${joinStore}
       WHERE ${taConditions.join(' AND ')} ${storeWhere}`,
      allParams
    );
    // 这里使用 total(即当次范围内的分配总数)作为分母计算占比
    const startDelayRate =
      total > 0
        ? parseFloat(((100 * (warnStatsRow.start_delay_cnt || 0)) / total).toFixed(2))
        : 0;
    const crisisP0Rate =
      total > 0 ? parseFloat(((100 * (warnStatsRow.p0_cnt || 0)) / total).toFixed(2)) : 0;
    const crisisP1Rate =
      total > 0 ? parseFloat(((100 * (warnStatsRow.p1_cnt || 0)) / total).toFixed(2)) : 0;

    // 任务触达率：晚于下发时间(ta.created_at)登录就算触达
    const reachRow = db.get(
      `SELECT COUNT(ta.id) AS reached_count
       FROM task_assignments ta
       JOIN users u ON ta.user_id = u.employee_id
       ${joinStore}
       WHERE ${taConditions.join(' AND ')} ${storeWhere}
         AND u.last_login_at IS NOT NULL
         AND u.last_login_at >= ta.created_at`,
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
        crisisP0Rate,
        crisisP1Rate,

        inProgressCount: inProgCnt,
        pendingCount:    pendingCnt,
        overdueCount,
        warningCount: { p1: warnP1, p2: warnP2 },
        updatedAt: base.last_updated || new Date().toISOString(),
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
      : new Date().toISOString();

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

    const updatedAt = new Date().toISOString();
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
// §5.5 预警列表（实时从 task_assignments 聚合，无独立存储表）
// P1：门店 completionRate < 50%
// P2：50% ≤ completionRate < 80%

router.get('/warnings', authenticate, requireRole(['central', 'admin']), (req, res, next) => {
  try {
    const { taskId, warningLevel, pageNum = 1, pageSize = 20 } = req.query;
    const drill = parseStoreDrill(req.query);

    if (warningLevel && !['p1', 'p2'].includes(warningLevel)) {
      throw createError(400, 'warningLevel 非法（p1/p2）', 'DASH_003');
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

    // warningLevel 转为 completion_rate 上界（p1 < 50，p2 在 [50,80)）
    let rateHaving = 'completion_rate < 80';
    if (warningLevel === 'p1') rateHaving = 'completion_rate < 50';
    else if (warningLevel === 'p2') rateHaving = 'completion_rate >= 50 AND completion_rate < 80';

    const whereClause = conditions.join(' AND ');
    const now = new Date().toISOString();

    // 聚合子查询：按门店+任务分组，计算完成率（在 DB 层过滤预警级别）
    const aggregateSql = `
      SELECT
        ta.task_id,
        ta.store_id,
        s.name AS store_name,
        t.ddl_at,
        COUNT(ta.id) AS total_count,
        SUM(CASE WHEN ta.status='completed' THEN 1 ELSE 0 END) AS completed_count,
        SUM(CASE WHEN ta.status!='completed' AND ? > t.ddl_at THEN 1 ELSE 0 END) AS overdue_count,
        ROUND(100.0 * SUM(CASE WHEN ta.status='completed' THEN 1 ELSE 0 END) / COUNT(ta.id), 2) AS completion_rate,
        MAX(ta.updated_at) AS last_updated
      FROM task_assignments ta
      JOIN stores s ON s.id = ta.store_id
      JOIN tasks t ON t.id = ta.task_id
      WHERE ${whereClause}
      GROUP BY ta.store_id, ta.task_id
      HAVING ${rateHaving}
    `;

    // 总数
    const countRow = db.get(
      `SELECT COUNT(*) AS cnt FROM (${aggregateSql}) sub`,
      [now, ...params]
    );
    const total = (countRow && countRow.cnt) || 0;
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    // 分页数据
    const storeRows = db.all(
      `${aggregateSql} ORDER BY completion_rate ASC LIMIT ? OFFSET ?`,
      [now, ...params, limit, offset]
    );

    const list = storeRows.map(r => {
      const rate = r.completion_rate || 0;
      const level = rate < 50 ? 'p1' : 'p2';
      const triggerDesc = rate < 50
        ? '完成率<50%，任务严重落后'
        : '完成率<80%，存在落队风险';
      return {
        taskId:         r.task_id,
        storeId:        r.store_id,
        storeName:      r.store_name,
        warningLevel:   level,
        completionRate: rate,
        completedCount: r.completed_count,
        totalCount:     r.total_count,
        overdueCount:   r.overdue_count || 0,
        triggerDesc,
        aiSuggestion:   aiSuggestion(rate),
        calculatedAt:   now,
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
        updatedAt: new Date().toISOString(),
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

    const targetDate = date || new Date().toISOString().slice(0, 10); // YYYY-MM-DD
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
