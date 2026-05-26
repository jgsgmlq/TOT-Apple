'use strict';

/**
 * Agent chat_tools 集成测试 — 验证每个工具的 handler 能否正常取数。
 *
 * 运行：cd server && npx jest --testPathPattern="tools-integration" --forceExit --testTimeout=30000
 *
 * 依赖真实 MySQL 数据库（.env 中的 MYSQL_URL），不 mock。
 * 测试用的任务 ID 从数据库动态获取，确保参数始终有效。
 */

const path = require('path');

// ─── Env ────────────────────────────────────────────────────────────────
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const mysql = require('../../../modules/common/db/mysql');

// ─── Tools under test ───────────────────────────────────────────────────
const toolSearchTask = require('../../../chat_tools/tool_search_task');
const toolListTaskProgress = require('../../../chat_tools/tool_list_task_progress');
const toolQueryMetric = require('../../../chat_tools/tool_query_metric');
const toolQueryTrend = require('../../../chat_tools/tool_query_trend');
const toolFunnelAnalysis = require('../../../chat_tools/tool_funnel_analysis');
const toolGetTaskDashboard = require('../../../chat_tools/tool_get_task_dashboard');
const toolFetchIncompletePersons = require('../../../chat_tools/tool_fetch_incomplete_persons');
const toolFetchAlertPersons = require('../../../chat_tools/tool_fetch_alert_persons');
const toolAskUser = require('../../../chat_tools/tool_ask_user');

// ─── Helpers ─────────────────────────────────────────────────────────────
const defaultRegionScope = {
  type: 'national',
  userRoles: ['executive'],
};

async function getFirstActiveTaskId() {
  const row = await mysql.get(
    "SELECT task_publish_id, task_title FROM task_publish WHERE publish_status = 'dispatched' ORDER BY created_at DESC LIMIT 1"
  );
  return row;
}

async function getTaskWithAlertData() {
  const row = await mysql.get(
    `SELECT t.task_publish_id, t.task_title
     FROM task_publish t
     JOIN learner_task_reminder ltr ON t.task_publish_id = ltr.task_publish_id
     WHERE t.publish_status = 'dispatched'
     GROUP BY t.task_publish_id, t.task_title
     ORDER BY COUNT(*) DESC
     LIMIT 1`
  );
  return row;
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('Agent Chat Tools — Integration Tests', () => {

  // ─── 1. search_task ──────────────────────────────────────────────────

  describe('search_task', () => {
    test('returns tasks without keyword (default all)', async () => {
      const result = await toolSearchTask.handler({}, defaultRegionScope);
      expect(result.success).toBe(true);
      expect(Array.isArray(result.data.rows)).toBe(true);
      expect(typeof result.data.total_count).toBe('number');
    });

    test('returns matching tasks with keyword', async () => {
      const result = await toolSearchTask.handler({ keyword: 'Chat Mock' }, defaultRegionScope);
      expect(result.success).toBe(true);
      expect(result.data.rows.length).toBeGreaterThan(0);
      expect(result.data.rows.every(r => r.task_name.includes('Chat Mock'))).toBe(true);
    });

    test('filters by status=active', async () => {
      const result = await toolSearchTask.handler({ status: 'active', keyword: 'Chat Mock' }, defaultRegionScope);
      expect(result.success).toBe(true);
      expect(result.data.rows.every(r => r.status === 'dispatched')).toBe(true);
    });

    test('filters by platform', async () => {
      const result = await toolSearchTask.handler({ platform: 'MyPAL' }, defaultRegionScope);
      expect(result.success).toBe(true);
      // 可能 0 条，但不应报错
    });

    test('each row has required fields', async () => {
      const result = await toolSearchTask.handler({ keyword: 'Chat Mock' }, defaultRegionScope);
      const row = result.data.rows[0];
      expect(row).toHaveProperty('task_id');
      expect(row).toHaveProperty('task_name');
      expect(row).toHaveProperty('platform');
      expect(row).toHaveProperty('priority');
      expect(row).toHaveProperty('status');
      expect(row).toHaveProperty('completion_rate');
    });
  });

  // ─── 2. list_task_progress ───────────────────────────────────────────

  describe('list_task_progress', () => {
    test('returns active tasks by default', async () => {
      const result = await toolListTaskProgress.handler({}, defaultRegionScope);
      expect(result.success).toBe(true);
      expect(Array.isArray(result.data.rows)).toBe(true);
    }, 30000);

    test('returns tasks sorted by completion_rate', async () => {
      const result = await toolListTaskProgress.handler(
        { sort_by: 'completion_rate', sort_order: 'asc' },
        defaultRegionScope
      );
      expect(result.success).toBe(true);
      if (result.data.rows.length >= 2) {
        const rates = result.data.rows.map(r => r.completion_rate);
        for (let i = 1; i < rates.length; i++) {
          expect(rates[i]).toBeGreaterThanOrEqual(rates[i - 1]);
        }
      }
    }, 30000);

    test('filters by completion_rate_max', async () => {
      const result = await toolListTaskProgress.handler(
        { filters: { completion_rate_max: 0.5 } },
        defaultRegionScope
      );
      expect(result.success).toBe(true);
      if (result.data.rows.length > 0) {
        expect(result.data.rows.every(r => r.completion_rate <= 0.5)).toBe(true);
      }
    }, 30000);

    test('each row has required fields', async () => {
      const result = await toolListTaskProgress.handler({}, defaultRegionScope);
      if (result.data.rows.length > 0) {
        const row = result.data.rows[0];
        expect(row).toHaveProperty('task_id');
        expect(row).toHaveProperty('task_name');
        expect(row).toHaveProperty('completion_rate');
        expect(row).toHaveProperty('deadline');
        expect(row).toHaveProperty('priority');
      }
    }, 30000);
  });

  // ─── 3. query_metric ─────────────────────────────────────────────────

  describe('query_metric', () => {
    let taskId, taskTitle;

    beforeAll(async () => {
      // Use a Chat Mock task known to have valid metric data
      const t = await mysql.get(
        "SELECT task_publish_id, task_title FROM task_publish WHERE task_title LIKE 'Chat Mock%' AND publish_status = 'dispatched' ORDER BY task_title LIMIT 1"
      );
      if (t) {
        taskId = t.task_publish_id;
        taskTitle = t.task_title;
      }
    });

    test('rejects missing task_id', async () => {
      const result = await toolQueryMetric.handler({}, defaultRegionScope);
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('MISSING_PARAM');
    });

    test('returns metrics by task_publish_id (ID resolution)', async () => {
      if (!taskId) return;
      const result = await toolQueryMetric.handler(
        { task_id: taskId, metrics: ['completion_rate', 'total_count'] },
        defaultRegionScope
      );
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('rows');
      expect(result.data).toHaveProperty('task_name');
      expect(result.data).toHaveProperty('platform');
      expect(result.data).toHaveProperty('priority');
    }, 30000);

    test('returns metrics by task title', async () => {
      if (!taskTitle) return;
      const result = await toolQueryMetric.handler(
        { task_id: taskTitle, metrics: ['completion_rate', 'total_count'] },
        defaultRegionScope
      );
      expect(result.success).toBe(true);
      expect(result.data.rows.length).toBeGreaterThanOrEqual(0);
    }, 30000);

    test('returns metrics with dimension=store (top_n)', async () => {
      if (!taskId) return;
      const result = await toolQueryMetric.handler(
        { task_id: taskId, metrics: ['completion_rate'], dimension: 'store', top_n: 10 },
        defaultRegionScope
      );
      expect(result.success).toBe(true);
      expect(result.data.rows.length).toBeLessThanOrEqual(10);
    }, 30000);
  });

  // ─── 4. query_trend ──────────────────────────────────────────────────

  describe('query_trend', () => {
    let taskId;

    beforeAll(async () => {
      const t = await getFirstActiveTaskId();
      taskId = t ? t.task_publish_id : null;
    });

    test('rejects missing task_id', async () => {
      const result = await toolQueryTrend.handler({}, defaultRegionScope);
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('MISSING_PARAM');
    });

    test('returns trend data for valid task', async () => {
      if (!taskId) return;
      const result = await toolQueryTrend.handler(
        { task_id: taskId, mode: 'completion' },
        defaultRegionScope
      );
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('task_id');
      expect(result.data).toHaveProperty('timeline');
      expect(Array.isArray(result.data.timeline)).toBe(true);
    }, 30000);
  });

  // ─── 5. funnel_analysis ──────────────────────────────────────────────

  describe('funnel_analysis', () => {
    let taskId;

    beforeAll(async () => {
      const t = await getFirstActiveTaskId();
      taskId = t ? t.task_publish_id : null;
    });

    test('rejects missing task_id', async () => {
      const result = await toolFunnelAnalysis.handler({}, defaultRegionScope);
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('MISSING_PARAM');
    });

    test('returns completion funnel for valid task', async () => {
      if (!taskId) return;
      const result = await toolFunnelAnalysis.handler(
        { task_id: taskId, funnel_type: 'completion' },
        defaultRegionScope
      );
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('task_id');
      expect(result.data.funnel_type).toBe('completion');
    }, 30000);

    test('returns alert funnel for valid task', async () => {
      if (!taskId) return;
      const result = await toolFunnelAnalysis.handler(
        { task_id: taskId, funnel_type: 'alert' },
        defaultRegionScope
      );
      expect(result.success).toBe(true);
      expect(result.data.funnel_type).toBe('alert');
    }, 30000);
  });

  // ─── 6. get_task_dashboard ───────────────────────────────────────────

  describe('get_task_dashboard', () => {
    let taskId, taskTitle;

    beforeAll(async () => {
      const t = await getFirstActiveTaskId();
      taskId = t ? t.task_publish_id : null;
      taskTitle = t ? t.task_title : null;
    });

    test('returns disambiguation prompt when task_id missing', async () => {
      const result = await toolGetTaskDashboard.handler({}, defaultRegionScope);
      expect(result.success).toBe(false);
      expect(result.needDisambiguation).toBe(true);
    });

    test('returns dashboard for valid task by ID', async () => {
      if (!taskId) return;
      const result = await toolGetTaskDashboard.handler(
        { task_id: taskId },
        defaultRegionScope
      );
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('overall_metrics');
      expect(result.data.overall_metrics).toHaveProperty('completion_rate');
      expect(result.data.overall_metrics).toHaveProperty('total_count');
      expect(result.data.overall_metrics).toHaveProperty('completed_count');
      expect(result.data).toHaveProperty('completion_funnel');
      expect(result).toHaveProperty('summary');
    }, 30000);

    test('returns dashboard for valid task by title', async () => {
      if (!taskTitle) return;
      const result = await toolGetTaskDashboard.handler(
        { task_id: taskTitle },
        defaultRegionScope
      );
      // 标题匹配可能有 NO_DATA（模糊搜索不到），两个结果都合理
      if (result.success) {
        expect(result.data).toHaveProperty('overall_metrics');
      } else {
        expect(result.errorCode).toBe('NO_DATA');
      }
    }, 30000);
  });

  // ─── 7. fetch_incomplete_persons ─────────────────────────────────────

  describe('fetch_incomplete_persons', () => {
    let taskId, taskTitle;

    beforeAll(async () => {
      // Use Chat Mock tasks which are known to have mypal_learning_progress_sync data
      const t = await mysql.get(
        `SELECT t.task_publish_id, t.task_title
         FROM task_publish t
         JOIN task_publish_learner tpl ON t.task_publish_id = tpl.task_publish_id
         JOIN learner_account la ON tpl.learner_id = la.learner_id
         JOIN mypal_learning_progress_sync mps ON la.email_id = mps.email_id AND mps.required_flag = 1
         WHERE mps.passed_time IS NULL AND t.publish_status = 'dispatched'
         GROUP BY t.task_publish_id, t.task_title
         LIMIT 1`
      );
      taskId = t ? t.task_publish_id : null;
      taskTitle = t ? t.task_title : null;
    });

    test('rejects missing task_id', async () => {
      const result = await toolFetchIncompletePersons.handler({}, defaultRegionScope);
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('MISSING_PARAM');
    });

    test('returns incomplete persons by task ID', async () => {
      if (!taskId) return;
      const result = await toolFetchIncompletePersons.handler(
        { task_id: taskId },
        defaultRegionScope
      );
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('task_id');
      expect(result.data).toHaveProperty('total_count');
      expect(result.data).toHaveProperty('rows');
      expect(Array.isArray(result.data.rows)).toBe(true);
      if (result.data.rows.length > 0) {
        const row = result.data.rows[0];
        expect(row).toHaveProperty('user_id');
        expect(row).toHaveProperty('email');
        expect(row).toHaveProperty('name');
        expect(row).toHaveProperty('store');
        expect(row).toHaveProperty('l3');
        expect(row).toHaveProperty('completion_status');
        expect(row.completion_status).toBe('未完成');
      }
    }, 15000);

    test('returns incomplete persons by task title (name resolution)', async () => {
      if (!taskTitle) return;
      const result = await toolFetchIncompletePersons.handler(
        { task_id: taskTitle },
        defaultRegionScope
      );
      expect(result.success).toBe(true);
      expect(result.data.rows.length).toBeGreaterThanOrEqual(0);
    }, 15000);

    test('no duplicate rows', async () => {
      if (!taskId) return;
      const result = await toolFetchIncompletePersons.handler(
        { task_id: taskId },
        defaultRegionScope
      );
      expect(result.success).toBe(true);
      const userIds = result.data.rows.map(r => r.user_id);
      const uniqueUserIds = [...new Set(userIds)];
      expect(userIds.length).toBe(uniqueUserIds.length);
    }, 15000);

    test('supports pagination', async () => {
      if (!taskId) return;
      const result = await toolFetchIncompletePersons.handler(
        { task_id: taskId, page_size: 2, page: 1 },
        defaultRegionScope
      );
      expect(result.success).toBe(true);
      expect(result.data.page).toBe(1);
      expect(result.data.page_size).toBe(2);
      expect(result.data.rows.length).toBeLessThanOrEqual(2);
    }, 15000);
  });

  // ─── 8. fetch_alert_persons ──────────────────────────────────────────

  describe('fetch_alert_persons', () => {
    let taskId, taskTitle;

    beforeAll(async () => {
      const t = await getTaskWithAlertData();
      taskId = t ? t.task_publish_id : null;
      taskTitle = t ? t.task_title : null;
    });

    test('rejects missing task_id', async () => {
      const result = await toolFetchAlertPersons.handler({ alert_level: 'P0' }, defaultRegionScope);
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('MISSING_PARAM');
    });

    test('returns P0 alert persons by task ID', async () => {
      if (!taskId) return;
      const result = await toolFetchAlertPersons.handler(
        { task_id: taskId, alert_level: 'P0' },
        defaultRegionScope
      );
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('total_count');
      expect(result.data).toHaveProperty('rows');
      expect(result.data.alert_level).toBe('P0');
      if (result.data.rows.length > 0) {
        const row = result.data.rows[0];
        expect(row).toHaveProperty('user_id');
        expect(row).toHaveProperty('email');
        expect(row).toHaveProperty('name');
        expect(row).toHaveProperty('alert_level');
        expect(row).toHaveProperty('alert_result');
        expect(row).toHaveProperty('alerted_at');
        expect(row).toHaveProperty('store');
        expect(row).toHaveProperty('l3');
      }
    }, 15000);

    test('returns P1 alert persons', async () => {
      if (!taskId) return;
      const result = await toolFetchAlertPersons.handler(
        { task_id: taskId, alert_level: 'P1' },
        defaultRegionScope
      );
      expect(result.success).toBe(true);
      expect(result.data.alert_level).toBe('P1');
    }, 15000);

    test('returns alert persons by task title (name resolution)', async () => {
      if (!taskTitle) return;
      const result = await toolFetchAlertPersons.handler(
        { task_id: taskTitle, alert_level: 'P0' },
        defaultRegionScope
      );
      expect(result.success).toBe(true);
    }, 15000);
  });

  // ─── 9. ask_user ─────────────────────────────────────────────────────

  describe('ask_user', () => {
    test('returns _ask_user marker', async () => {
      const result = await toolAskUser.handler(
        { question: '请问你想查看哪个任务？', options: [{ label: '任务A', value: 'a' }] },
        defaultRegionScope
      );
      expect(result._ask_user).toBe(true);
      expect(result.question).toBe('请问你想查看哪个任务？');
      expect(result.options).toHaveLength(1);
    });
  });
});
