'use strict';

const {
  normalizeArgValue,
  canonicalizeArgs,
  safeParseJson,
  buildToolSignature,
  getLastAiToolCalls,
  safeJsonContent,
  makeToolMessage,
} = require('./toolCallUtils');
const { ToolMessage } = require('@langchain/core/messages');

describe('toolCallUtils', () => {
  describe('normalizeArgValue', () => {
    test('trims whitespace from strings', () => {
      expect(normalizeArgValue('  hello  ')).toBe('hello');
    });

    test('returns undefined for empty strings', () => {
      expect(normalizeArgValue('')).toBeUndefined();
      expect(normalizeArgValue('   ')).toBeUndefined();
    });

    test('returns undefined for null and undefined', () => {
      expect(normalizeArgValue(null)).toBeUndefined();
      expect(normalizeArgValue(undefined)).toBeUndefined();
    });

    test('converts numeric strings to numbers', () => {
      expect(normalizeArgValue('3')).toBe(3);
      expect(normalizeArgValue('-5')).toBe(-5);
      expect(normalizeArgValue('3.14')).toBe(3.14);
    });

    test('recursively normalizes arrays', () => {
      expect(normalizeArgValue(['  a ', '3', ''])).toEqual(['a', 3]);
    });

    test('recursively normalizes objects', () => {
      const result = normalizeArgValue({ b: '2', a: '  x ' });
      expect(result).toEqual({ a: 'x', b: 2 });
    });
  });

  describe('canonicalizeArgs', () => {
    test('sorts keys alphabetically', () => {
      const result = canonicalizeArgs({ b: 2, a: 1, c: 3 });
      expect(Object.keys(result)).toEqual(['a', 'b', 'c']);
    });

    test('normalizes values while sorting keys', () => {
      const result = canonicalizeArgs({ b: '3', a: '  hello  ' });
      expect(result).toEqual({ a: 'hello', b: 3 });
    });

    test('removes undefined/null/empty values', () => {
      const result = canonicalizeArgs({ a: null, b: '', c: 1 });
      expect(result).toEqual({ c: 1 });
    });

    test('returns normalized value for non-objects', () => {
      expect(canonicalizeArgs(null)).toBeUndefined();
      expect(canonicalizeArgs('  x ')).toBe('x');
      expect(canonicalizeArgs(['  a ', '2'])).toEqual(['a', 2]);
    });
  });

  describe('safeParseJson', () => {
    test('parses valid JSON', () => {
      expect(safeParseJson('{"a":1}')).toEqual({ a: 1 });
    });

    test('returns null for invalid JSON', () => {
      expect(safeParseJson('not json')).toBeNull();
    });
  });

  describe('buildToolSignature', () => {
    test('same args + same scope + same time bucket → same signature', () => {
      const t = 1_700_000_000_000;
      const sig1 = buildToolSignature('getOverviewData', { taskId: 'T1' }, 'fp_beijing', { nowMs: t, bucketMs: 60_000 });
      const sig2 = buildToolSignature('getOverviewData', { taskId: 'T1' }, 'fp_beijing', { nowMs: t + 30_000 });
      expect(sig1).toBe(sig2);
    });

    test('same args + same scope + cross time bucket → different signature', () => {
      const t = 1_700_000_000_000;
      const sig1 = buildToolSignature('getOverviewData', { taskId: 'T1' }, 'fp_shanghai', { nowMs: t, bucketMs: 60_000 });
      const sig2 = buildToolSignature('getOverviewData', { taskId: 'T1' }, 'fp_shanghai', { nowMs: t + 90_000 });
      expect(sig1).not.toBe(sig2);
    });

    test('same args + different scope → different signature', () => {
      const t = 1_700_000_000_000;
      const sig1 = buildToolSignature('getOverviewData', { taskId: 'T1' }, 'fp_beijing', { nowMs: t, bucketMs: 60_000 });
      const sig2 = buildToolSignature('getOverviewData', { taskId: 'T1' }, 'fp_shanghai', { nowMs: t, bucketMs: 60_000 });
      expect(sig1).not.toBe(sig2);
    });

    test('args key order independent (canonicalize sorts keys)', () => {
      const t = 1_700_000_000_000;
      const sig1 = buildToolSignature('getOverviewData', { taskId: 'T1', region: '华东' }, 'fp_beijing', { nowMs: t, bucketMs: 60_000 });
      const sig2 = buildToolSignature('getOverviewData', { region: '华东', taskId: 'T1' }, 'fp_beijing', { nowMs: t, bucketMs: 60_000 });
      expect(sig1).toBe(sig2);
    });

    test('bucketMs=0 falls back to default 60s bucket → same signature within window', () => {
      const t = 1_700_000_000_000;
      const sig1 = buildToolSignature('getOverviewData', { taskId: 'T1' }, 'fp_beijing', { nowMs: t, bucketMs: 0 });
      const sig2 = buildToolSignature('getOverviewData', { taskId: 'T1' }, 'fp_beijing', { nowMs: t + 30_000 });
      expect(sig1).toBe(sig2);
    });

    test('bucketMs=0 falls back to default 60s bucket → cross bucket differs', () => {
      const t = 1_700_000_000_000;
      const sig1 = buildToolSignature('getOverviewData', { taskId: 'T1' }, 'fp_beijing', { nowMs: t, bucketMs: 0 });
      const sig2 = buildToolSignature('getOverviewData', { taskId: 'T1' }, 'fp_beijing', { nowMs: t + 90_000 });
      expect(sig1).not.toBe(sig2);
    });

    test('per-tool freshness bucketMs affects signature', () => {
      const t = 1_700_000_000_000;
      const sig1 = buildToolSignature('getTaskListData', { taskId: 'T1' }, 'fp_beijing', { nowMs: t, bucketMs: 3_600_000 });
      const sig2 = buildToolSignature('getTaskListData', { taskId: 'T1' }, 'fp_beijing', { nowMs: t + 1_800_000, bucketMs: 3_600_000 });
      expect(sig1).toBe(sig2);
    });

    test('per-tool freshness: cross hour bucket → different signature', () => {
      const t = 1_700_000_000_000;
      const sig1 = buildToolSignature('getTaskListData', { taskId: 'T1' }, 'fp_beijing', { nowMs: t, bucketMs: 3_600_000 });
      const sig2 = buildToolSignature('getTaskListData', { taskId: 'T1' }, 'fp_beijing', { nowMs: t + 3_600_001, bucketMs: 3_600_000 });
      expect(sig1).not.toBe(sig2);
    });

    test('handles JSON string args', () => {
      const t = 1_700_000_000_000;
      const sig1 = buildToolSignature('tool', { a: 1 }, 'fp', { nowMs: t, bucketMs: 60_000 });
      const sig2 = buildToolSignature('tool', '{"a":1}', 'fp', { nowMs: t, bucketMs: 60_000 });
      expect(sig1).toBe(sig2);
    });

    test('handles empty scope fingerprint', () => {
      const t = 1_700_000_000_000;
      const sig = buildToolSignature('tool', { a: 1 }, '', { nowMs: t, bucketMs: 60_000 });
      expect(typeof sig).toBe('string');
      expect(sig).toHaveLength(32);
    });
  });

  describe('getLastAiToolCalls', () => {
    const aiMsg = (toolCalls) => ({
      _getType: () => 'ai',
      tool_calls: toolCalls,
    });

    const humanMsg = {
      _getType: () => 'human',
    };

    test('finds last AI message with tool_calls', () => {
      const state = {
        messages: [
          humanMsg,
          aiMsg([]),
          aiMsg([{ name: 'query_metric', args: {} }]),
        ],
      };
      const result = getLastAiToolCalls(state);
      expect(result.anchor).toBeDefined();
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('query_metric');
    });

    test('returns empty when no AI message has tool_calls', () => {
      const state = {
        messages: [humanMsg, aiMsg([]), aiMsg(undefined)],
      };
      const result = getLastAiToolCalls(state);
      expect(result.anchor).toBeNull();
      expect(result.toolCalls).toEqual([]);
    });

    test('returns empty for null state', () => {
      const result = getLastAiToolCalls(null);
      expect(result.anchor).toBeNull();
      expect(result.toolCalls).toEqual([]);
    });

    test('skips non-AI messages between AI and end', () => {
      const target = aiMsg([{ name: 't1' }]);
      const state = {
        messages: [humanMsg, aiMsg([]), target, { _getType: () => 'tool' }],
      };
      const result = getLastAiToolCalls(state);
      expect(result.anchor).toBe(target);
    });
  });

  describe('safeJsonContent', () => {
    test('returns empty string for undefined', () => {
      expect(safeJsonContent(undefined)).toBe('');
    });

    test('returns string as-is', () => {
      expect(safeJsonContent('hello')).toBe('hello');
    });

    test('JSON stringifies objects', () => {
      expect(safeJsonContent({ a: 1 })).toBe('{"a":1}');
    });

    test('replaces NaN with null', () => {
      expect(safeJsonContent({ a: NaN })).toBe('{"a":null}');
    });

    test('replaces Infinity with null', () => {
      expect(safeJsonContent({ a: Infinity })).toBe('{"a":null}');
    });
  });

  describe('makeToolMessage', () => {
    test('creates ToolMessage with tool_call_id and name', () => {
      const msg = makeToolMessage({ id: 'call_123', name: 'testTool' }, 'content');
      expect(msg).toBeInstanceOf(ToolMessage);
      expect(msg.tool_call_id).toBe('call_123');
      expect(msg.name).toBe('testTool');
      expect(msg.content).toBe('content');
    });

    test('handles missing id/name gracefully', () => {
      const msg = makeToolMessage({}, 'content');
      expect(msg.tool_call_id).toBe('unknown_call_id');
      expect(msg.name).toBe('unknown_tool');
    });

    test('JSON-stringifies object content', () => {
      const msg = makeToolMessage({ id: 'x', name: 't' }, { a: 1 });
      expect(msg.content).toBe('{"a":1}');
    });
  });
});
