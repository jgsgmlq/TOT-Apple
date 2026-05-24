'use strict';

const { isErrorPayload } = require('../nodes/fc_MergeToolResults');
const { inspectToolResult } = require('../nodes/fc_ExecuteTool');
const { sanitizeUserFacingMarkdown, finalResponseStep, buildTableFromRows, prepareToolData } = require('../nodes/finalResponseStep');
describe('Node helper functions', () => {
  describe('isErrorPayload (fc_MergeToolResults)', () => {
    test('returns false for non-string', () => {
      expect(isErrorPayload(null)).toBe(false);
      expect(isErrorPayload(42)).toBe(false);
      expect(isErrorPayload({})).toBe(false);
    });

    test('returns false for non-json string', () => {
      expect(isErrorPayload('not json')).toBe(false);
    });

    test('returns false for JSON without error code', () => {
      expect(isErrorPayload('{"a":1}')).toBe(false);
    });

    test('returns true for JSON with error.code', () => {
      expect(isErrorPayload('{"error":{"code":"ERR","message":"fail"}}')).toBe(true);
    });

    test('returns false for JSON with error but no code', () => {
      expect(isErrorPayload('{"error":{"message":"fail"}}')).toBe(false);
    });
  });

  describe('inspectToolResult (fc_ExecuteTool)', () => {
    test('ok=true for plain object result', () => {
      const result = inspectToolResult({ data: [1, 2, 3] });
      expect(result.ok).toBe(true);
      expect(result.errorCode).toBeNull();
    });

    test('ok=true for string result', () => {
      const result = inspectToolResult('simple string');
      expect(result.ok).toBe(true);
    });

    test('ok=true for null result', () => {
      const result = inspectToolResult(null);
      expect(result.ok).toBe(true);
    });

    test('ok=false for object with error field', () => {
      const result = inspectToolResult({ error: { code: 'PERMISSION_DENIED', message: 'denied' } });
      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe('PERMISSION_DENIED');
    });

    test('ok=false for object with success=false', () => {
      const result = inspectToolResult({ success: false, errorCode: 'TIMEOUT', message: 'timeout' });
      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe('TIMEOUT');
    });
  });

  describe('sanitizeUserFacingMarkdown (finalResponseStep)', () => {
    test('returns non-string as-is', () => {
      expect(sanitizeUserFacingMarkdown('')).toBe('');
    });

    test('returns plain text unchanged', () => {
      expect(sanitizeUserFacingMarkdown('正常的回复内容')).toBe('正常的回复内容');
    });

    test('rewrites SYSTEM_ERROR for region scope issues', () => {
      const result = sanitizeUserFacingMarkdown('SYSTEM_ERROR: 区域范围限定错误 工具参数校验失败。');
      expect(result).toContain('无法查询该范围的数据');
    });

    test('rewrites SYSTEM_ERROR for missing required params', () => {
      const result = sanitizeUserFacingMarkdown('SYSTEM_ERROR: MISSING storeId 工具参数校验失败。');
      expect(result).toContain('需要更多信息');
    });

    test('rewrites generic SYSTEM_ERROR', () => {
      const result = sanitizeUserFacingMarkdown('SYSTEM_ERROR: some other error。');
      expect(result).toContain('查询过程中遇到了问题');
    });

    test('rewrites SYSTEM_ERROR without extra text', () => {
      const result = sanitizeUserFacingMarkdown('SYSTEM_ERROR');
      expect(result).toContain('查询过程中遇到了问题');
    });
  });

  describe('buildTableFromRows (finalResponseStep)', () => {
    test('returns empty for null input', () => {
      expect(buildTableFromRows(null)).toEqual({ columns: [], rows: [] });
    });

    test('returns empty for empty array', () => {
      expect(buildTableFromRows([])).toEqual({ columns: [], rows: [] });
    });

    test('maps completion_rate to 完成率%', () => {
      const rows = [{ completion_rate: 80, completed_count: 10 }];
      const table = buildTableFromRows(rows);
      expect(table.columns).toContain('完成率%');
      expect(table.columns).toContain('已完成');
      expect(table.rows[0]).toEqual([80, 10]);
    });

    test('expands dimensions object into columns', () => {
      const rows = [{ dimensions: { store: 'R123' }, completion_rate: 50 }];
      const table = buildTableFromRows(rows);
      expect(table.columns).toContain('门店');
      expect(table.rows[0][0]).toBe('R123');
    });

    test('truncates at 20 rows', () => {
      const rows = Array.from({ length: 25 }, (_, i) => ({
        completion_rate: i,
        dimensions: { store: `R${i}` },
      }));
      const table = buildTableFromRows(rows);
      expect(table.rows).toHaveLength(20);
    });

    test('filters out non-metric keys like task_id, _total, error', () => {
      const rows = [{ task_id: 'T1', _total: 100, error: null, completion_rate: 80 }];
      const table = buildTableFromRows(rows);
      expect(table.columns).not.toContain('task_id');
      expect(table.columns).not.toContain('_total');
      expect(table.columns).not.toContain('error');
    });

    test('formats ISO dates to YYYY-MM-DD', () => {
      const rows = [{ dimensions: {}, due_date: '2026-05-19T16:00:00.000Z' }];
      const table = buildTableFromRows(rows);
      expect(table.columns).toContain('截止日期');
      expect(table.rows[0][0]).toBe('2026-05-19');
    });
  });

  describe('prepareToolData (finalResponseStep)', () => {
    test('returns empty array for null', () => {
      expect(prepareToolData(null)).toEqual([]);
    });

    test('parses JSON string data', () => {
      const entry = { data: '{"result": 42}', toolName: 'query_metric', error: false };
      const items = prepareToolData({ c1: entry });
      expect(items).toHaveLength(1);
      expect(items[0].data).toEqual({ result: 42 });
      expect(items[0].toolName).toBe('query_metric');
    });

    test('handles already-parsed object data', () => {
      const entry = { data: { result: 42 }, toolName: 'qm', error: false };
      const items = prepareToolData({ c1: entry });
      expect(items[0].data).toEqual({ result: 42 });
    });

    test('handles parse failure gracefully', () => {
      const entry = { data: 'not json', toolName: 't', error: false };
      const items = prepareToolData({ c1: entry });
      expect(items[0].data).toBe('not json');
    });

    test('propagates error flag', () => {
      const entry = { data: '{}', toolName: 't', error: { code: 'ERR' } };
      const items = prepareToolData({ c1: entry });
      expect(items[0].error).toEqual({ code: 'ERR' });
    });
  });

  describe('finalResponseStep module exports', () => {
    test('exports sanitizeUserFacingMarkdown', () => {
      expect(typeof sanitizeUserFacingMarkdown).toBe('function');
    });

    test('exports finalResponseStep', () => {
      expect(typeof finalResponseStep).toBe('function');
    });
  });
});
