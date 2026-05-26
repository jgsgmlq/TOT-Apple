'use strict';

const { summarizeArgs } = require('../shared/runTrace');

describe('summarizeArgs', () => {
  test('handles null/undefined', () => {
    expect(summarizeArgs(null)).toBe('(none)');
    expect(summarizeArgs(undefined)).toBe('(none)');
  });

  test('preserves scalar values', () => {
    const result = summarizeArgs({ name: 'hello', count: 42, enabled: true });
    expect(result).toEqual({ name: 'hello', count: 42, enabled: true });
  });

  test('truncates long strings (>80 chars)', () => {
    const long = 'a'.repeat(100);
    const result = summarizeArgs({ text: long });
    expect(result.text).toBe('a'.repeat(77) + '...');
  });

  test('shows small array contents inline', () => {
    const result = summarizeArgs({
      metrics: ['completion_rate', 'total_count', 'completed_count'],
    });
    expect(result.metrics).toEqual(['completion_rate', 'total_count', 'completed_count']);
  });

  test('truncates large arrays with first 5 items + count', () => {
    const bigArray = Array.from({ length: 20 }, (_, i) => `item_${i}`);
    const result = summarizeArgs({ items: bigArray });
    expect(result.items.length).toBe(6); // 5 items + summary string
    expect(result.items[0]).toBe('item_0');
    expect(result.items[4]).toBe('item_4');
    expect(result.items[5]).toContain('还有 15 项');
  });

  test('shows small object contents inline', () => {
    const result = summarizeArgs({
      filters: { region: 'east', status: 'active' },
    });
    expect(result.filters).toEqual({ region: 'east', status: 'active' });
  });

  test('summarizes large objects', () => {
    const bigObj = {};
    for (let i = 0; i < 15; i++) bigObj[`key_${i}`] = i;
    const result = summarizeArgs({ config: bigObj });
    expect(result.config).toBe('{15 keys}');
  });

  test('handles real-world query_metric args', () => {
    const result = summarizeArgs({
      task_id: 'CHATMOCK_TASK_NPI_CROSS_STALLED',
      metrics: ['completion_rate', 'completed_count', 'uncompleted_count', 'total_count'],
      dimension: 'store',
      sort_by: 'completion_rate',
      sort_order: 'asc',
      top_n: 10,
    });
    expect(result.task_id).toBe('CHATMOCK_TASK_NPI_CROSS_STALLED');
    expect(result.metrics).toEqual(['completion_rate', 'completed_count', 'uncompleted_count', 'total_count']);
    expect(result.dimension).toBe('store');
    expect(result.sort_by).toBe('completion_rate');
    expect(result.sort_order).toBe('asc');
    expect(result.top_n).toBe(10);
  });

  test('handles empty arrays and objects', () => {
    const result = summarizeArgs({ emptyArr: [], emptyObj: {} });
    expect(result.emptyArr).toEqual([]);
    expect(result.emptyObj).toEqual({});
  });

  test('skips null/undefined values', () => {
    const result = summarizeArgs({ a: null, b: undefined, c: 'keep' });
    expect(result.a).toBeUndefined();
    expect(result.b).toBeUndefined();
    expect(result.c).toBe('keep');
  });
});
