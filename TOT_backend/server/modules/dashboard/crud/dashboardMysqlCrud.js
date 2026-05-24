'use strict';

const { get, all, run, ensureDashboardInsightsTable } = require('../../common/db/mysql');

// ═══════════════════════════════════════════════════════════════════
// 原子数据查询 — 仅做 SELECT + JOIN + WHERE，不含任何聚合/子查询
// ═══════════════════════════════════════════════════════════════════

async function getTaskById(taskPublishId) {
  if (!taskPublishId) return null;
  return await get(
    `SELECT tp.*, ca.task_week, ca.topic_name, ca.model_type
     FROM task_publish tp
     LEFT JOIN campaign_activity ca ON ca.activity_id = tp.activity_id
     WHERE tp.task_publish_id = ?`,
    [taskPublishId]
  );
}

// ─── Queue ─────────────────────────────────────────────────────────

async function getQueueEntries({ taskPublishId, storeAppleId, rtm4Name, resellerName, subRegionCode, emailId, limit, offset } = {}) {
  if (!taskPublishId) return [];
  const cond = ['ltq.task_publish_id = ?'];
  const params = [taskPublishId];

  if (storeAppleId)  { cond.push('la.store_apple_id = ?'); params.push(storeAppleId); }
  if (rtm4Name)      { cond.push('rs.rtm4_name = ?'); params.push(rtm4Name); }
  if (resellerName)  { cond.push('rs.reseller_name = ?'); params.push(resellerName); }
  if (subRegionCode) { cond.push('rs.sub_region_code = ?'); params.push(subRegionCode); }
  if (emailId)       { cond.push('ltq.email_id = ?'); params.push(emailId); }

  const where = 'WHERE ' + cond.join(' AND ');
  const sql = `SELECT ltq.queue_id, ltq.email_id, ltq.priority_level,
                      la.store_apple_id, la.rtm_level_3_name, la.rtm_level_4_name,
                      la.user_business_role_name, la.apple_role_name,
                      rs.store_name, rs.rtm4_name, rs.reseller_name, rs.sub_region_code
               FROM learner_task_queue ltq
               JOIN learner_account la ON la.email_id = ltq.email_id AND la.user_enabled_indicator = 1
               LEFT JOIN reseller_store rs ON rs.store_apple_id = la.store_apple_id
               ${where}
               ORDER BY ltq.queue_id
               LIMIT ? OFFSET ?`;

  return await all(sql, [...params, limit || 1000, offset || 0]);
}

async function countQueueByTask(taskPublishId) {
  if (!taskPublishId) return { total: 0, total_stores: 0 };
  return await get(
    `SELECT COUNT(*) AS total, COUNT(DISTINCT la.store_apple_id) AS total_stores
     FROM learner_task_queue ltq
     JOIN learner_account la ON la.email_id = ltq.email_id AND la.user_enabled_indicator = 1
     WHERE ltq.task_publish_id = ?`,
    [taskPublishId]
  );
}

// ─── MyPal ──────────────────────────────────────────────────────────

async function getMyPalProgressByWeek(taskWeek) {
  if (!taskWeek) return [];
  return await all(
    'SELECT * FROM mypal_learning_progress_sync WHERE task_week = ?',
    [taskWeek]
  );
}

async function getMyPalProgressByEmails(emailIds, limit = 500) {
  if (!emailIds || emailIds.length === 0) return [];
  const placeholders = emailIds.map(() => '?').join(',');
  return await all(
    `SELECT * FROM mypal_learning_progress_sync
     WHERE email_id IN (${placeholders})
     ORDER BY synced_at DESC
     LIMIT ?`,
    [...emailIds, limit]
  );
}

// ─── Task Overview Stats (SQL 聚合) ─────────────────────────────────

async function getTaskOverviewStats(taskPublishId, taskWeek) {
  if (!taskPublishId) return null;

  const row = await get(
    `SELECT
       COUNT(DISTINCT ltq.email_id) AS total_assignments,
       COUNT(DISTINCT CASE WHEN ls.status = 'completed' THEN ltq.email_id END) AS completed_count,
       COUNT(DISTINCT CASE WHEN ls.status = 'in_progress' THEN ltq.email_id END) AS in_progress_count,
       COUNT(DISTINCT CASE WHEN ltr.reminder_level = 'P0' THEN ltq.email_id END) AS p0_count,
       COUNT(DISTINCT CASE WHEN ltr.reminder_level = 'P1' THEN ltq.email_id END) AS p1_count,
       COUNT(DISTINCT CASE WHEN ltr.reminder_level = 'P2' THEN ltq.email_id END) AS p2_count,
       COUNT(DISTINCT CASE WHEN ltr.reminder_level = 'P3' THEN ltq.email_id END) AS p3_count
     FROM learner_task_queue ltq
     JOIN learner_account la ON la.email_id = ltq.email_id AND la.user_enabled_indicator = 1
     LEFT JOIN (
       SELECT mps2.email_id, mps2.task_week,
         CASE
           WHEN COUNT(*) = SUM(CASE WHEN mps2.passed_week IS NOT NULL THEN 1 ELSE 0 END)
             THEN 'completed'
           WHEN SUM(CASE WHEN mps2.first_use_time IS NOT NULL THEN 1 ELSE 0 END) > 0
             THEN 'in_progress'
           ELSE 'pending'
         END AS status
       FROM mypal_learning_progress_sync mps2
       WHERE mps2.required_flag = 1 AND mps2.task_week = ?
       GROUP BY mps2.email_id, mps2.task_week
     ) AS ls ON ls.email_id = ltq.email_id
     LEFT JOIN learner_task_reminder ltr
       ON ltr.task_publish_id = ltq.task_publish_id AND ltr.email_id = ltq.email_id
     WHERE ltq.task_publish_id = ?`,
    [taskWeek || null, taskPublishId]
  );

  return row;
}

// ─── Reminder / Confirmation ────────────────────────────────────────

async function getConfirmationStatus({ taskPublishId, emailIds } = {}) {
  if (!taskPublishId || !emailIds || emailIds.length === 0) return [];
  const ids = emailIds.length > 1000 ? emailIds.slice(0, 1000) : emailIds;
  const placeholders = ids.map(() => '?').join(',');
  return await all(
    `SELECT DISTINCT email_id FROM task_reminder_log
     WHERE task_publish_id = ?
       AND email_id IN (${placeholders})
       AND reminder_result = 'success'`,
    [taskPublishId, ...ids]
  );
}

async function getReminderList({ taskPublishId, emailId, limit = 1000, offset = 0 } = {}) {
  if (!taskPublishId) return [];
  const cond = ['task_publish_id = ?'];
  const params = [taskPublishId];
  if (emailId) { cond.push('email_id = ?'); params.push(emailId); }
  const where = 'WHERE ' + cond.join(' AND ');

  return await all(
    `SELECT * FROM learner_task_reminder ${where}
     ORDER BY reminder_id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
}

async function getRemindersByTaskId(taskPublishId) {
  if (!taskPublishId) return [];
  return await all(
    `SELECT email_id, reminder_level FROM learner_task_reminder
     WHERE task_publish_id = ?`,
    [taskPublishId]
  );
}

async function getReminderLogs({ taskPublishId, emailId, limit = 1000, offset = 0 } = {}) {
  if (!taskPublishId) return [];
  const cond = ['trl.task_publish_id = ?'];
  const params = [taskPublishId];
  if (emailId) { cond.push('trl.email_id = ?'); params.push(emailId); }
  const where = 'WHERE ' + cond.join(' AND ');

  return await all(
    `SELECT trl.*, rs.store_name
     FROM task_reminder_log trl
     LEFT JOIN learner_account la ON la.email_id = trl.email_id
     LEFT JOIN reseller_store rs ON rs.store_apple_id = la.store_apple_id
     ${where}
     ORDER BY trl.reminder_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
}

// ─── Agent: dispatched tasks ─────────────────────────────────────

async function getActiveDispatchedTasks() {
  return await all(
    `SELECT task_publish_id, task_title, due_date, publish_status
     FROM task_publish
     WHERE publish_status = 'dispatched'
       AND (due_date IS NULL OR due_date >= NOW())
     ORDER BY due_date ASC`
  );
}

async function getExpiredDispatchedTasksCount() {
  const row = await get(
    `SELECT COUNT(*) AS cnt FROM task_publish
     WHERE publish_status = 'dispatched'
       AND due_date IS NOT NULL
       AND due_date < NOW()`
  );
  return row ? row.cnt : 0;
}

// ─── dashboard_insights ───────────────────────────────────────────

let insightsTableReady = false;
let insightsTablePromise = null;

async function readyInsightsTable() {
  if (insightsTableReady) return;
  if (!insightsTablePromise) {
    insightsTablePromise = ensureDashboardInsightsTable().then(() => {
      insightsTableReady = true;
    }).catch(err => {
      insightsTablePromise = null;
      throw err;
    });
  }
  await insightsTablePromise;
}

async function insertAgentInsight(id, moduleType, content, contextJson, userId) {
  await readyInsightsTable();
  await run(
    `INSERT INTO dashboard_insights
     (id, module_type, content, context_json, created_by)
     VALUES (?, ?, ?, ?, ?)`,
    [id, moduleType, content, contextJson, userId || 'system']
  );
}

async function getLatestAgentInsight() {
  await readyInsightsTable();
  return await get(
    `SELECT context_json, created_at FROM dashboard_insights
     WHERE module_type = 'global_agent'
     ORDER BY created_at DESC LIMIT 1`
  );
}

async function insertInsight(data) {
  await readyInsightsTable();
  await run(
    `INSERT INTO dashboard_insights
     (id, module_type, task_publish_id, filter_rtm, filter_format, filter_dealer_name,
      filter_store_id, extra_params_json, content, context_json, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [data.id, data.moduleType, data.taskPublishId || null,
     data.filterRtm || null, data.filterFormat || null, data.filterDealerName || null,
     data.filterStoreId || null, JSON.stringify(data.extraParams || {}),
     data.content, JSON.stringify(data.context || {}), data.createdBy || 'system']
  );
}

async function getInsightById(id) {
  await readyInsightsTable();
  return await get('SELECT * FROM dashboard_insights WHERE id = ?', [id]);
}

async function incrementInsightVote(id, voteType) {
  await readyInsightsTable();
  const col = voteType === 'up' ? 'up_count' : 'down_count';
  await run(`UPDATE dashboard_insights SET ${col} = ${col} + 1 WHERE id = ?`, [id]);
}

async function decrementInsightVote(id, voteType) {
  await readyInsightsTable();
  const col = voteType === 'up' ? 'up_count' : 'down_count';
  await run(`UPDATE dashboard_insights SET ${col} = ${col} - 1 WHERE id = ? AND ${col} > 0`, [id]);
}

async function getInsightVotes(id) {
  await readyInsightsTable();
  return await get('SELECT up_count AS up, down_count AS down FROM dashboard_insights WHERE id = ?', [id]);
}

// ═══════════════════════════════════════════════════════════════════
// 统一任务搜索 — 替代旧 searchTasks(keyword) + 6个工具的各自搜索
// ═══════════════════════════════════════════════════════════════════

async function searchTasks(filters = {}) {
  const { conds, params } = buildSearchConditions(filters);
  const sql = `SELECT tp.task_publish_id, tp.task_title, tp.due_date, tp.publish_status,
                      tp.urgency_level, tp.platform_scope,
                      ca.model_type, ca.topic_name
               FROM task_publish tp
               LEFT JOIN campaign_activity ca ON ca.activity_id = tp.activity_id
               WHERE ${conds.join(' AND ')}
               ORDER BY tp.due_date ASC
               LIMIT ?`;
  params.push(filters.limit || 10);
  return await all(sql, params);
}

// ═══════════════════════════════════════════════════════════════════
// 统一任务搜索 — SQL condition builder（纯函数，可测试）
// ═══════════════════════════════════════════════════════════════════

// ─── 组织搜索 ────────────────────────────────────────────────────

async function searchOrg(name, type) {
  if (!name) return [];
  const results = [];

  // Layer 1: 黑话映射表（表不存在时静默跳过）
  try {
    const slangCond = type ? 'AND org_type = ?' : '';
    const slangParams = type ? [name, type] : [name];
    const slangRows = await all(
      `SELECT canonical_name, org_type, priority
       FROM org_slang_mappings
       WHERE alias = ? ${slangCond}
       ORDER BY priority DESC
       LIMIT 3`,
      slangParams
    );
    for (const row of slangRows) {
      const canonicalResults = await _searchResellerStore(row.canonical_name, row.org_type);
      for (const r of canonicalResults) {
        r.match_type = 'slang_exact';
        r.alias = name;
      }
      results.push(...canonicalResults);
    }
  } catch (_) { /* table not exists — silent skip */ }

  // Layer 2: 直接模糊匹配 reseller_store
  const directMatches = await _searchResellerStore(name, type);
  for (const r of directMatches) r.match_type = 'fuzzy_name';
  results.push(...directMatches);

  // Layer 3: 去空格回退
  if (results.length === 0 && /\s/.test(name)) {
    const noSpace = name.replace(/\s+/g, '');
    const noSpaceMatches = await _searchResellerStore(noSpace, type);
    for (const r of noSpaceMatches) r.match_type = 'fuzzy_name_nospace';
    results.push(...noSpaceMatches);
  }

  // Layer 4: learner_account 补充 (L3/L4)
  if (type === 'l3' || type === 'l4' || !type) {
    const laTypes = type ? [type] : ['l3', 'l4'];
    for (const laType of laTypes) {
      const col = laType === 'l3' ? 'rtm_level_3_name' : 'rtm_level_4_name';
      const rows = await all(
        `SELECT DISTINCT ${col} AS name, '${laType}' AS org_type, ${col} AS code
         FROM learner_account
         WHERE ${col} LIKE ?
         LIMIT 5`,
        [`%${name}%`]
      );
      for (const r of rows) r.match_type = 'fuzzy_learner';
      results.push(...rows);
    }
  }

  // 去重: 按 (code, org_type) 保留最高优先级 match_type
  const seen = new Map();
  const priority = { slang_exact: 1, fuzzy_name: 2, fuzzy_name_nospace: 3, fuzzy_learner: 4 };
  for (const r of results) {
    const key = `${r.code}::${r.org_type}`;
    const existing = seen.get(key);
    if (!existing || priority[r.match_type] < priority[existing.match_type]) {
      seen.set(key, r);
    }
  }
  return [...seen.values()].slice(0, 10);
}

const _RESELLER_COL_MAP = {
  region: ['sub_region_name', 'sub_region_code'],
  store: ['store_name', 'store_apple_id'],
  dealer: ['reseller_name', 'reseller_name'],
  l4: ['rtm4_name', 'rtm4_name'],
};

async function _searchResellerStore(name, type) {
  const types = type ? [type] : Object.keys(_RESELLER_COL_MAP);
  const queries = types.map(t => {
    const [nameCol, codeCol] = _RESELLER_COL_MAP[t];
    return all(
      `SELECT DISTINCT ${codeCol} AS code, ${nameCol} AS name, '${t}' AS org_type
       FROM reseller_store
       WHERE ${nameCol} LIKE ?
       LIMIT 5`,
      [`%${name}%`]
    );
  });
  const arrs = await Promise.all(queries);
  return arrs.flat();
}

function buildSearchConditions(filters) {
  const conds = [];
  const params = [];

  // 状态过滤 — 默认排除 draft
  if (filters.statuses && filters.statuses.length > 0) {
    conds.push(`tp.publish_status IN (${filters.statuses.map(() => '?').join(',')})`);
    params.push(...filters.statuses);
    // "active" 语义: dispatched + 未过期 (仅在单独 dispatch 时加)
    if (filters.statuses.length === 1 && filters.statuses[0] === 'dispatched') {
      conds.push('(tp.due_date IS NULL OR tp.due_date >= NOW())');
    }
  } else {
    conds.push("tp.publish_status != 'draft'");
  }

  // 任务名 — 去空格 + 全角→半角规范化后模糊匹配
  if (filters.name) {
    const normalized = filters.name
      .replace(/\s+/g, '')
      .replace(/｜/g, '|')
      .replace(/（/g, '(')
      .replace(/）/g, ')');
    conds.push(`(
      tp.task_title LIKE ?
      OR REPLACE(REPLACE(REPLACE(REPLACE(tp.task_title, ' ', ''), '｜', '|'), '（', '('), '）', ')') LIKE ?
    )`);
    params.push(`%${filters.name}%`, `%${normalized}%`);
  }

  // 类别 — JOIN campaign_activity
  if (filters.category) {
    conds.push('ca.model_type = ?');
    params.push(filters.category);
  }

  // 产品
  if (filters.product) {
    conds.push('ca.topic_name LIKE ?');
    params.push(`%${filters.product}%`);
  }

  // 优先级
  if (filters.priority) {
    conds.push('tp.urgency_level = ?');
    params.push(filters.priority);
  }

  // 平台
  if (filters.platform) {
    conds.push('tp.platform_scope LIKE ?');
    params.push(`%${filters.platform}%`);
  }

  // 截止日紧迫度 (与 status_filter 正交)
  if (filters.deadlineUrgency === 'soon') {
    conds.push('tp.due_date IS NOT NULL AND tp.due_date BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 7 DAY)');
  } else if (filters.deadlineUrgency === 'overdue') {
    conds.push('tp.due_date IS NOT NULL AND tp.due_date < NOW()');
  }

  // 时间范围
  if (filters.timeRange) {
    if (filters.timeRange.start) {
      conds.push('tp.due_date >= ?');
      params.push(filters.timeRange.start);
    }
    if (filters.timeRange.end) {
      conds.push('tp.due_date <= ?');
      params.push(filters.timeRange.end);
    }
  }

  return { conds, params };
}

module.exports = {
  getTaskById,
  getQueueEntries,
  countQueueByTask,
  getMyPalProgressByWeek,
  getMyPalProgressByEmails,
  getTaskOverviewStats,
  getConfirmationStatus,
  getReminderList,
  getRemindersByTaskId,
  getReminderLogs,
  getActiveDispatchedTasks,
  getExpiredDispatchedTasksCount,
  insertAgentInsight,
  getLatestAgentInsight,
  searchTasks,
  buildSearchConditions,
  searchOrg,
  insertInsight,
  getInsightById,
  incrementInsightVote,
  decrementInsightVote,
  getInsightVotes,
};
