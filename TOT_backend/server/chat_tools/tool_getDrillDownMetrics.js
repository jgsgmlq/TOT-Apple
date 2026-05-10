'use strict';

const { db } = require('../db');

module.exports = {
  schema: {
    type: 'function',
    function: {
      name: 'getStoreDetailData',
      description: '【门店下钻】查询指定门店内所有员工的培训进度明细（谁完成了、谁在进行中、各平台状态）。需要 storeId。当用户问"XX店的情况""S008的员工明细"时使用。门店名称模糊时会返回候选列表。',
      parameters: {
        type: 'object',
        required: ['storeId'],
        properties: {
          storeId: { type: 'string', description: '门店ID' },
          taskId:  { type: 'string', description: '任务ID，不传则取最近一个任务' }
        }
      }
    }
  },
  meta: { enabled: true, scopePolicy: 'regional_scoped' },
  handler: async (args, regionScope) => {
    let { storeId, taskId } = args;

    // Fallback: if storeId looks like a name (no S prefix), resolve by name.
    let resolvedId = storeId;
    if (storeId && !storeId.match(/^S\d+$/i)) {
      const candidateParams = [`%${storeId}%`];
      const scopeConditions = [];
      if (regionScope && regionScope.type === 'regional') {
        const regions = Array.isArray(regionScope.regions) ? regionScope.regions : [];
        if (!regions.length) {
          return {
            needDisambiguation: true,
            reason: 'store_not_found',
            message: `未找到名称包含“${storeId}”且在当前权限范围内的门店。`,
            storeQuery: storeId,
            candidates: [],
          };
        }
        scopeConditions.push(`region IN (${regions.map(() => '?').join(',')})`);
        candidateParams.push(...regions);
      } else if (regionScope && regionScope.type === 'rtm') {
        scopeConditions.push('rtm = ?');
        candidateParams.push(regionScope.rtm);
      }
      const whereScope = scopeConditions.length ? `AND ${scopeConditions.join(' AND ')}` : '';
      const candidates = db.all(
        `SELECT id, name, region, rtm, format
         FROM stores
         WHERE name LIKE ?
         ${whereScope}
         ORDER BY name ASC
         LIMIT 6`,
        candidateParams
      );

      if (candidates.length === 1) {
        resolvedId = candidates[0].id;
      } else if (candidates.length === 0) {
        return {
          needDisambiguation: true,
          reason: 'store_not_found',
          message: `未找到名称包含“${storeId}”且在当前权限范围内的门店。`,
          storeQuery: storeId,
          candidates: [],
        };
      } else {
        return {
          needDisambiguation: true,
          reason: 'store_name_ambiguous',
          message: `查询“${storeId}”命中多家门店，请指定 storeId 或更完整门店名称。`,
          storeQuery: storeId,
          candidates,
        };
      }
    }

    // Region access control: verify the store is within the executive's authorized scope
    if (regionScope && regionScope.type !== 'national') {
      const storeCheck = db.get('SELECT region, rtm FROM stores WHERE id = ?', [resolvedId]);
      if (storeCheck) {
        if (regionScope.type === 'regional') {
          const authorized = regionScope.regions || [];
          if (!authorized.includes(storeCheck.region)) {
            throw Object.assign(
              new Error(`Store ${resolvedId} (region: ${storeCheck.region}) is outside authorized regions`),
              { status: 403, code: 'AUTH_003' }
            );
          }
        } else if (regionScope.type === 'rtm') {
          if (storeCheck.rtm !== regionScope.rtm) {
            throw Object.assign(
              new Error(`Store ${resolvedId} (rtm: ${storeCheck.rtm}) is outside authorized RTM`),
              { status: 403, code: 'AUTH_003' }
            );
          }
        }
      }
    }

    // If no taskId, use the most recently created dispatched task for this store
    let resolvedTaskId = taskId;
    if (!resolvedTaskId) {
      const taskRow = db.get(
        `SELECT ta.task_id FROM task_assignments ta
         JOIN tasks t ON t.id = ta.task_id
         WHERE ta.store_id = ? AND t.status = 'dispatched'
         ORDER BY t.created_at DESC LIMIT 1`,
        [resolvedId]
      );
      resolvedTaskId = taskRow ? taskRow.task_id : null;
    }
    if (!resolvedTaskId) return { storeId: resolvedId, employees: [], summary: null };

    const storeRow = db.get('SELECT id, name, region, rtm, format FROM stores WHERE id = ?', [resolvedId]);
    const employees = db.all(
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
         ta.completed_at
       FROM task_assignments ta
       JOIN employees e ON e.id = ta.user_id
       WHERE ta.task_id = ? AND ta.store_id = ?
       ORDER BY ta.progress DESC`,
      [resolvedTaskId, resolvedId]
    );

    const total = employees.length;
    const completed = employees.filter((e) => e.status === 'completed').length;

    return {
      taskId: resolvedTaskId,
      store: storeRow || { id: resolvedId },
      summary: {
        totalCount: total,
        completedCount: completed,
        completionRate: total > 0 ? parseFloat(((completed / total) * 100).toFixed(1)) : 0,
        inProgressCount: employees.filter((e) => e.status === 'in_progress').length,
        pendingCount: employees.filter((e) => e.status === 'pending').length,
      },
      employees: employees.map((e) => ({
        employeeId: e.employee_id,
        employeeName: e.employee_name,
        status: e.status,
        progress: e.progress,
        platformStatus: {
          mypalCompleted:          !!e.mypal_completed,
          smartsellCompleted:      !!e.smartsell_completed,
          aiDemoCompleted:         !!e.ai_demo_completed,
          liveBroadcastCompleted:  !!e.live_broadcast_completed,
        },
        nudgeCount: e.nudge_count,
        receivedAt: e.received_at,
        startedAt:  e.started_at,
        completedAt: e.completed_at,
      })),
    };
  }
};
