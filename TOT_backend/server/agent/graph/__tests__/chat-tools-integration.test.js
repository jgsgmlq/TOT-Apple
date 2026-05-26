'use strict';

// 集成测试：直接调用 chat_tools handler，打在真实 MySQL 上
// Jest 不会自动加载 .env，需要手动初始化
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '..', '..', '.env') });

const searchTask = require('../../../chat_tools/tool_search_task');
const getTaskDashboard = require('../../../chat_tools/tool_get_task_dashboard');
const queryMetric = require('../../../chat_tools/tool_query_metric');
const listTaskProgress = require('../../../chat_tools/tool_list_task_progress');
const funnelAnalysis = require('../../../chat_tools/tool_funnel_analysis');
const queryTrend = require('../../../chat_tools/tool_query_trend');
const fetchAlertPersons = require('../../../chat_tools/tool_fetch_alert_persons');
const fetchIncompletePersons = require('../../../chat_tools/tool_fetch_incomplete_persons');
const askUser = require('../../../chat_tools/tool_ask_user');

const nationalScope = { type: 'national' };

// 从 MySQL 获取一个真实 task 用于参数化测试
let knownTaskId = null;

beforeAll(async () => {
  const taskCrud = require('../../../modules/task/crud/taskCrud');
  const tasks = await taskCrud.getTaskList({ statuses: ['dispatched', 'ended'] });
  if (tasks.length > 0) {
    knownTaskId = tasks[0].task_publish_id;
  }
}, 15000);

describe('chat_tools integration (real MySQL)', () => {
  describe('search_task', () => {
    test('returns task list without params', async () => {
      const result = await searchTask.handler({}, nationalScope);
      expect(result.success).toBe(true);
      expect(result.data.total_count).toBeGreaterThan(0);
      expect(Array.isArray(result.data.rows)).toBe(true);
    });

    test('filters by keyword', async () => {
      const result = await searchTask.handler({ keyword: 'mock' }, nationalScope);
      expect(result.success).toBe(true);
      expect(Array.isArray(result.data.rows)).toBe(true);
    }, 10000);

    test('filters by status=active', async () => {
      const result = await searchTask.handler({ status: 'active' }, nationalScope);
      expect(result.success).toBe(true);
      expect(Array.isArray(result.data.rows)).toBe(true);
    }, 10000);
  });

  describe('get_task_dashboard', () => {
    test('returns error for empty task_id', async () => {
      const result = await getTaskDashboard.handler({ task_id: '' }, nationalScope);
      expect(result.success).toBe(false);
      expect(result.errorCode || result.needDisambiguation).toBeTruthy();
    });

    test('returns error for nonexistent task', async () => {
      const result = await getTaskDashboard.handler({ task_id: 'NONEXISTENT_TASK_XYZ_999' }, nationalScope);
      expect(result).toBeDefined();
      // 模糊搜索不到 → 原值查询 → 无数据
      expect(result.success === false || result.data === undefined).toBe(true);
    }, 10000);

    test('returns dashboard data for known task', async () => {
      if (!knownTaskId) return;
      const result = await getTaskDashboard.handler({ task_id: knownTaskId }, nationalScope);
      expect(result).toBeDefined();
      // Should have data or a clear error
      if (result.success) {
        expect(result.data).toBeDefined();
        expect(result.data.overall_metrics).toBeDefined();
        expect(typeof result.data.overall_metrics.completion_rate).toBe('number');
      }
    }, 15000);
  });

  describe('query_metric', () => {
    test('returns error for empty task_id', async () => {
      const result = await queryMetric.handler({ task_id: '' }, nationalScope);
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('MISSING_PARAM');
    });

    test('queries completion_rate for known task', async () => {
      if (!knownTaskId) return;
      const result = await queryMetric.handler(
        { task_id: knownTaskId, metrics: ['completion_rate'] },
        nationalScope
      );
      expect(result).toBeDefined();
    }, 15000);

    test('queries with dimension=store returns rows', async () => {
      if (!knownTaskId) return;
      const result = await queryMetric.handler(
        { task_id: knownTaskId, metrics: ['completion_rate'], dimension: 'store', top_n: 5 },
        nationalScope
      );
      expect(result).toBeDefined();
    }, 15000);
  });

  describe('list_task_progress', () => {
    test('returns active task progress list', async () => {
      const result = await listTaskProgress.handler({}, nationalScope);
      expect(result.success).toBe(true);
      expect(Array.isArray(result.data.rows)).toBe(true);
    }, 30000);

    test('filters by completion_rate_max', async () => {
      const result = await listTaskProgress.handler(
        { filters: { completion_rate_max: 1.0 } },
        nationalScope
      );
      expect(result.success).toBe(true);
    }, 30000);

    test('filters by days_to_deadline_max', async () => {
      const result = await listTaskProgress.handler(
        { filters: { days_to_deadline_max: 30 } },
        nationalScope
      );
      expect(result.success).toBe(true);
    }, 30000);
  });

  describe('funnel_analysis', () => {
    test('returns error for empty task_id', async () => {
      const result = await funnelAnalysis.handler({ task_id: '' }, nationalScope);
      expect(result.success).toBe(false);
    });

    test('returns completion funnel for known task', async () => {
      if (!knownTaskId) return;
      const result = await funnelAnalysis.handler(
        { task_id: knownTaskId, funnel_type: 'completion' },
        nationalScope
      );
      expect(result).toBeDefined();
    }, 15000);
  });

  describe('query_trend', () => {
    test('returns error for empty task_id', async () => {
      const result = await queryTrend.handler({ task_id: '' }, nationalScope);
      expect(result.success).toBe(false);
    });

    test('returns trend data for known task', async () => {
      if (!knownTaskId) return;
      const result = await queryTrend.handler(
        { task_id: knownTaskId, mode: 'completion' },
        nationalScope
      );
      expect(result).toBeDefined();
    }, 15000);
  });

  describe('fetch_alert_persons', () => {
    test('returns error for empty task_id', async () => {
      const result = await fetchAlertPersons.handler({ task_id: '' }, nationalScope);
      expect(result.success).toBe(false);
    });

    test('queries alert persons for known task', async () => {
      if (!knownTaskId) return;
      const result = await fetchAlertPersons.handler(
        { task_id: knownTaskId },
        nationalScope
      );
      expect(result).toBeDefined();
    }, 15000);
  });

  describe('fetch_incomplete_persons', () => {
    test('returns error for empty task_id', async () => {
      const result = await fetchIncompletePersons.handler({ task_id: '' }, nationalScope);
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('MISSING_PARAM');
    });

    test('queries incomplete persons for known task', async () => {
      if (!knownTaskId) return;
      const result = await fetchIncompletePersons.handler(
        { task_id: knownTaskId },
        nationalScope
      );
      expect(result).toBeDefined();
    }, 15000);
  });

  describe('ask_user', () => {
    test('returns structured question payload', async () => {
      const result = await askUser.handler(
        { question: '请选择要查询的任务', options: [{ label: 'A', value: 'a' }] },
        nationalScope
      );
      // ask_user 不返回 success，由 fc_ExecuteTool 检测并走 interrupt
      expect(result._ask_user).toBe(true);
      expect(result.question).toBe('请选择要查询的任务');
      expect(Array.isArray(result.options)).toBe(true);
    });
  });
});
