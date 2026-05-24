'use strict';

const { buildSearchConditions } = require('../../../modules/dashboard/crud/dashboardMysqlCrud');

describe('buildSearchConditions', () => {
  test('空 filters 只排除 draft', () => {
    const { conds, params } = buildSearchConditions({});
    expect(conds).toContain("tp.publish_status != 'draft'");
    expect(params).toEqual([]);
  });

  test('statuses=["dispatched"] 加 active 语义（未过期）', () => {
    const { conds, params } = buildSearchConditions({ statuses: ['dispatched'] });
    expect(conds).toContain('tp.publish_status IN (?)');
    expect(params).toContain('dispatched');
    expect(conds).toContain('(tp.due_date IS NULL OR tp.due_date >= NOW())');
  });

  test('statuses=["ended"] 不加过期排除', () => {
    const { conds } = buildSearchConditions({ statuses: ['ended'] });
    expect(conds.some(c => c.includes('due_date'))).toBe(false);
  });

  test('statuses=["dispatched","ended"] 不加过期排除', () => {
    const { conds } = buildSearchConditions({ statuses: ['dispatched', 'ended'] });
    expect(conds.some(c => c.includes('due_date IS NULL'))).toBe(false);
  });

  test('name 生成去空格 LIKE 双条件', () => {
    const { conds, params } = buildSearchConditions({ name: 'iPhone 17' });
    expect(conds.some(c => c.includes('REPLACE(tp.task_title, " ", "") LIKE ?'))).toBe(true);
    expect(params).toContain('%iPhone 17%');
    expect(params).toContain('%iPhone17%');
  });

  test('category 精确匹配 campaign_activity.model_type', () => {
    const { conds, params } = buildSearchConditions({ category: 'BAU' });
    expect(conds).toContain('ca.model_type = ?');
    expect(params).toContain('BAU');
  });

  test('product 模糊匹配 topic_name', () => {
    const { conds, params } = buildSearchConditions({ product: 'iPhone' });
    expect(conds).toContain('ca.topic_name LIKE ?');
    expect(params).toContain('%iPhone%');
  });

  test('priority 精确匹配 urgency_level', () => {
    const { conds, params } = buildSearchConditions({ priority: 'P0' });
    expect(conds).toContain('tp.urgency_level = ?');
    expect(params).toContain('P0');
  });

  test('platform LIKE 匹配 platform_scope', () => {
    const { conds, params } = buildSearchConditions({ platform: 'MyPAL' });
    expect(conds).toContain('tp.platform_scope LIKE ?');
    expect(params).toContain('%MyPAL%');
  });

  test('deadlineUrgency "soon" → 7天内截止', () => {
    const { conds } = buildSearchConditions({ deadlineUrgency: 'soon' });
    expect(conds.some(c => c.includes('DATE_ADD(NOW(), INTERVAL 7 DAY)'))).toBe(true);
  });

  test('deadlineUrgency "overdue" → 已过期', () => {
    const { conds } = buildSearchConditions({ deadlineUrgency: 'overdue' });
    expect(conds.some(c => c.includes('tp.due_date < NOW()'))).toBe(true);
  });

  test('timeRange 生成 BETWEEN 条件', () => {
    const { conds, params } = buildSearchConditions({
      timeRange: { start: '2026-05-01', end: '2026-05-31' }
    });
    expect(conds).toContain('tp.due_date >= ?');
    expect(conds).toContain('tp.due_date <= ?');
    expect(params).toContain('2026-05-01');
    expect(params).toContain('2026-05-31');
  });

  test('timeRange 只有 start 不设 end', () => {
    const { conds, params } = buildSearchConditions({
      timeRange: { start: '2026-05-01' }
    });
    expect(conds).toContain('tp.due_date >= ?');
    expect(conds.some(c => c.includes('due_date <='))).toBe(false);
    expect(params).toContain('2026-05-01');
  });

  test('组合: statuses + category + name + deadlineUrgency', () => {
    const { conds, params } = buildSearchConditions({
      statuses: ['dispatched'],
      category: 'BAU',
      name: '跨渠道BAU',
      deadlineUrgency: 'soon'
    });
    expect(conds).toContain('tp.publish_status IN (?)');
    expect(conds).toContain('(tp.due_date IS NULL OR tp.due_date >= NOW())');
    expect(conds).toContain('ca.model_type = ?');
    expect(params).toContain('BAU');
    expect(conds.some(c => c.includes('DATE_ADD(NOW(), INTERVAL 7 DAY)'))).toBe(true);
  });

  test('name 传入 null 不生成 name 条件', () => {
    const { conds } = buildSearchConditions({ name: null });
    expect(conds.some(c => c.includes('task_title'))).toBe(false);
  });

  test('name 传入空字符串不生成 name 条件', () => {
    const { conds } = buildSearchConditions({ name: '' });
    expect(conds.some(c => c.includes('task_title'))).toBe(false);
  });
});
