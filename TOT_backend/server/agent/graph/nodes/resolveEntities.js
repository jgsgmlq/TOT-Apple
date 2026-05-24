'use strict';

const { startNodeSpan } = require('../shared/spanHelper');
const { endSpan } = require('../../../utils/tracer');
const dashboardMysqlCrud = require('../../../modules/dashboard/crud/dashboardMysqlCrud');
const trace = require('../shared/runTrace');

async function resolveEntities(state, config) {
  const emitter = config?.configurable?.sseEmitter;
  const span = startNodeSpan(state, 'resolveEntities');
  trace.nodeEnter(emitter, state, 'resolveEntities');

  const qf = state.query_filters || {};
  const result = {
    tasks: { status: 'not_requested', items: [] },
    org: { status: 'not_requested', resolved: null },
    needs_clarification: false,
  };

  const hasTaskFilter = qf.task_name || qf.task_category || qf.product_name
    || qf.priority || qf.platform;

  if (hasTaskFilter) {
    // overdue 自动扩 status_filter
    if (qf.deadline_urgency === 'overdue' && qf.status_filter === 'active') {
      qf.status_filter = 'all';
    }

    const statuses = qf.status_filter === 'ended'
      ? ['ended'] : qf.status_filter === 'all'
      ? ['dispatched', 'ended'] : ['dispatched'];

    let matches = await dashboardMysqlCrud.searchTasks({
      name: qf.task_name,
      category: qf.task_category,
      product: qf.product_name,
      priority: qf.priority,
      platform: qf.platform,
      statuses,
      timeRange: qf.time_range,
      deadlineUrgency: qf.deadline_urgency,
      limit: 10,
    });

    if (matches.length === 0 && qf.task_name && (qf.task_category || qf.product_name || qf.priority || qf.platform)) {
      matches = await dashboardMysqlCrud.searchTasks({
        category: qf.task_category,
        product: qf.product_name,
        priority: qf.priority,
        platform: qf.platform,
        statuses,
        timeRange: qf.time_range,
        deadlineUrgency: qf.deadline_urgency,
        limit: 10,
      });
    }

    if (matches.length === 1) {
      result.tasks = { status: 'resolved', items: matches };
    } else if (matches.length >= 2) {
      result.tasks = { status: 'multiple', items: matches };
      result.needs_clarification = true;
    } else {
      result.tasks = { status: 'not_found', items: [] };
      result.needs_clarification = true;

      // 宽泛搜索：去掉 name 条件，用 category/platform/status 找候选
      try {
        const fallbackMatches = await dashboardMysqlCrud.searchTasks({
          category: qf.task_category,
          platform: qf.platform,
          statuses,
          limit: 5,
        });
        if (fallbackMatches.length > 0) {
          result.tasks._fallbackOptions = fallbackMatches;
        }
      } catch (_) { /* fallback 失败不阻塞 */ }
    }
  }

  // 组织解析
  if (qf.org_name) {
    const orgMatches = await dashboardMysqlCrud.searchOrg(qf.org_name, qf.org_type);
    if (orgMatches.length === 1) {
      result.org = { status: 'resolved', resolved: orgMatches[0] };
    } else if (orgMatches.length >= 2) {
      result.org = { status: 'multiple', options: orgMatches };
      result.needs_clarification = true;
    } else {
      result.org = { status: 'not_found', resolved: null };
    }
  }

  const ambiguity_payload = result.needs_clarification
    ? buildAmbiguityPayload(result, qf, result.tasks?._fallbackOptions)
    : null;

  endSpan(span, {
    output: `tasks=${result.tasks.status} org=${result.org.status} clarify=${result.needs_clarification}`,
  });
  trace.nodeExit(emitter, state, 'resolveEntities', {
    tasks: result.tasks.status, org: result.org.status, clarify: result.needs_clarification,
  });

  return { resolved_entities: result, ambiguity_payload };
}

function buildAmbiguityPayload(result, filters, fallbackOptions) {
  if (result.tasks && result.tasks.status === 'multiple') {
    return {
      type: 'task_ambiguous',
      prompt: `"${filters.task_name || filters.task_category || '该条件'}" 匹配到 ${result.tasks.items.length} 个任务，请问是哪一个？`,
      question: `"${filters.task_name || filters.task_category || '该条件'}" 匹配到多个任务，请问是哪一个？`,
      options: result.tasks.items.map(t => ({
        id: t.task_publish_id,
        label: t.task_title,
        value: t.task_publish_id,
        subtitle: `${t.model_type || ''} · 截止 ${t.due_date ? t.due_date.slice(0, 10) : '--'}`,
        match_type: t.match_type,
        score: t.score,
      })),
      resume_type: 'slot_fill',
    };
  }
  if (result.tasks && result.tasks.status === 'not_found') {
    const options = fallbackOptions && fallbackOptions.length > 0
      ? fallbackOptions.map(t => ({
          id: t.task_publish_id,
          label: t.task_title,
          value: t.task_publish_id,
          subtitle: `${t.model_type || ''} · 截止 ${t.due_date ? t.due_date.slice(0, 10) : '--'}`,
        }))
      : [];
    return {
      type: 'task_not_found',
      prompt: `未找到"${filters.task_name || '该条件'}"对应的任务。${options.length > 0 ? '以下可能是您要找的任务：' : '请问是哪个任务？'}`,
      question: `未找到"${filters.task_name || '该条件'}"对应的任务。请问是哪个任务？`,
      options,
      resume_type: 'slot_fill',
    };
  }
  if (result.org && result.org.status === 'multiple') {
    return {
      type: 'org_ambiguous',
      prompt: `"${filters.org_name}" 匹配到 ${result.org.candidates.length} 个组织，请问是哪一个？`,
      question: `"${filters.org_name}" 匹配到多个组织，请问是哪一个？`,
      options: result.org.candidates.map(o => ({
        id: o.code, label: o.name, value: o.code,
      })),
      resume_type: 'slot_fill',
    };
  }
  return null;
}

function buildFcEntityBlock(state) {
  const re = state.resolved_entities;
  const qf = state.query_filters || {};

  const json = { tasks: [], org: null, unresolved_filters: {} };

  if (re.tasks && (re.tasks.status === 'resolved' || re.tasks.status === 'multiple')) {
    for (const t of re.tasks.items) {
      json.tasks.push({ task_id: t.task_publish_id, task_title: t.task_title });
    }
  }

  if (re.org && re.org.status === 'resolved' && re.org.resolved) {
    json.org = {
      code: re.org.resolved.code,
      name: re.org.resolved.name,
      org_type: re.org.resolved.org_type,
    };
  }

  if (qf.alert_level) json.unresolved_filters.alert_level = qf.alert_level;
  if (qf.deadline_urgency) json.unresolved_filters.deadline_urgency = qf.deadline_urgency;
  if (qf.time_range) json.unresolved_filters.time_range = qf.time_range;

  const jsonBlock = '已解析实体（可直接用于工具参数）:\n```json\n' + JSON.stringify(json, null, 2) + '\n```';

  const parts = [];
  if (json.tasks.length === 1) parts.push(`用户指定了任务 "${json.tasks[0].task_title}"`);
  else if (json.tasks.length > 1) parts.push(`用户指定了 ${json.tasks.length} 个任务`);
  if (json.org) parts.push(`组织范围: ${json.org.name} (${json.org.org_type})`);
  if (json.unresolved_filters.deadline_urgency === 'soon') parts.push('要求筛选 7 天内截止的');
  else if (json.unresolved_filters.deadline_urgency === 'overdue') parts.push('要求筛选已逾期的');
  if (json.unresolved_filters.alert_level) parts.push(`关注 ${json.unresolved_filters.alert_level} 预警级别`);

  const summary = parts.length > 0 ? '查询上下文: ' + parts.join('，') + '。' : '';

  return [jsonBlock, summary].filter(Boolean).join('\n\n');
}

function buildEntityContext(state) {
  const parts = [];
  const re = state.resolved_entities;
  const qf = state.query_filters || {};

  if (re.tasks && re.tasks.status === 'resolved' && re.tasks.items.length > 0) {
    const names = re.tasks.items.map(t => `"${t.task_title}"`).join('、');
    parts.push(`- 已解析任务: ${names}`);
  }

  if (qf.task_category) parts.push(`- 任务类别: ${qf.task_category}`);
  if (qf.product_name) parts.push(`- 产品: ${qf.product_name}`);
  if (qf.priority) parts.push(`- 优先级: ${qf.priority}`);
  if (qf.platform) parts.push(`- 平台: ${qf.platform}`);
  if (qf.deadline_urgency === 'soon') parts.push('- 紧迫度: 7天内截止');
  if (qf.deadline_urgency === 'overdue') parts.push('- 紧迫度: 已逾期');

  if (re.org && re.org.status === 'resolved' && re.org.resolved) {
    parts.push(`- 已解析组织: ${re.org.resolved.name} (${re.org.resolved.org_type})`);
  } else if (qf.org_name) {
    parts.push(`- 组织过滤: ${qf.org_name}`);
  }

  if (qf.time_range && (qf.time_range.start || qf.time_range.end)) {
    parts.push(`- 时间范围: ${qf.time_range.start || '不限'} ~ ${qf.time_range.end || '不限'}`);
  }

  if (parts.length === 0) return '';
  return '\n\n查询上下文（供参考，以实际工具查询结果为准）:\n' + parts.join('\n');
}

module.exports = { resolveEntities, buildAmbiguityPayload, buildFcEntityBlock, buildEntityContext };
