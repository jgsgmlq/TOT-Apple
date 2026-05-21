'use strict';

const { normalizeToolResults } = require('../shared/normalizeToolResults');

const makeEntry = (data) => JSON.stringify(data);

describe('normalizeToolResults', () => {
  test('格式 1: { data: [...] } — 裸数组在 data 键下', () => {
    const tr = { c1: { data: makeEntry({ data: [{ a: 1 }, { a: 2 }] }), toolName: 't1' } };
    const ds = normalizeToolResults(tr);
    expect(ds).toHaveLength(1);
    expect(ds[0].id).toBe('c1');
    expect(ds[0].rows).toHaveLength(2);
  });

  test('格式 2: { data: { rows: [...] } } — list_task_progress 格式', () => {
    const tr = { c1: { data: makeEntry({ data: { rows: [{ x: 1 }, { x: 2 }] } }), toolName: 't2' } };
    const ds = normalizeToolResults(tr);
    expect(ds).toHaveLength(1);
    expect(ds[0].rows).toHaveLength(2);
  });

  test('格式 3: { rows: [...] } — query_metric 格式（rows 在顶层）', () => {
    const tr = { c1: { data: makeEntry({ task_id: 'T1', rows: [{ dimensions: { store: 'R1' }, completion_rate: 50 }] }), toolName: 'qm' } };
    const ds = normalizeToolResults(tr);
    expect(ds).toHaveLength(1);
    expect(ds[0].rows).toHaveLength(1);
    expect(ds[0].rows[0].dimensions.store).toBe('R1');
    expect(ds[0].rows[0].completion_rate).toBe(50);
  });

  test('格式 4: get_task_dashboard — overall_metrics 展开', () => {
    const tr = { c1: { data: makeEntry({ data: { task_name: 'T1', overall_metrics: { completion_rate: 80, total_count: 10 } } }), toolName: 'gtd' } };
    const ds = normalizeToolResults(tr);
    expect(ds).toHaveLength(1);
    expect(ds[0].rows[0].completion_rate).toBe(80);
    expect(ds[0].rows[0].task_name).toBe('T1');
  });

  test('格式 5: { data: {...} } — 单条对象', () => {
    const tr = { c1: { data: makeEntry({ data: { kpi: 42 } }), toolName: 't5' } };
    const ds = normalizeToolResults(tr);
    expect(ds).toHaveLength(1);
    expect(ds[0].rows[0].kpi).toBe(42);
  });

  test('格式 6: 裸数组（无 data 包装）', () => {
    const tr = { c1: { data: JSON.stringify([{ a: 1 }, { a: 2 }]), toolName: 't6' } };
    const ds = normalizeToolResults(tr);
    expect(ds).toHaveLength(1);
    expect(ds[0].rows).toHaveLength(2);
  });

  test('格式 7: 裸对象', () => {
    const tr = { c1: { data: JSON.stringify({ key: 'val' }), toolName: 't7' } };
    const ds = normalizeToolResults(tr);
    expect(ds).toHaveLength(1);
    expect(ds[0].rows).toHaveLength(1);
  });

  test('跳过 entry.error 为真的条目', () => {
    const tr = {
      c1: { data: makeEntry({ data: [{ ok: true }] }), toolName: 'good' },
      c2: { data: makeEntry({ data: [{ ok: false }] }), toolName: 'bad', error: { code: 'ERR' } },
    };
    const ds = normalizeToolResults(tr);
    expect(ds).toHaveLength(1);
    expect(ds[0].toolName).toBe('good');
  });

  test('跳过 data 为 null 的条目', () => {
    const tr = { c1: { data: null, toolName: 'nil' } };
    const ds = normalizeToolResults(tr);
    expect(ds).toHaveLength(0);
  });

  test('JSON 解析失败不崩溃', () => {
    const tr = { c1: { data: 'not json{{{', toolName: 'bad' } };
    expect(() => normalizeToolResults(tr)).not.toThrow();
    expect(normalizeToolResults(tr)).toHaveLength(0);
  });

  test('data 已为对象时不重复解析', () => {
    const tr = { c1: { data: { data: [{ x: 1 }] }, toolName: 'obj' } };
    const ds = normalizeToolResults(tr);
    expect(ds).toHaveLength(1);
    expect(ds[0].rows).toHaveLength(1);
  });
});
