'use strict';

const { BlocksOutput } = require('../shared/blocksSchema');
const { extractPlottableData } = require('../shared/extractPlottableData');
const { repairBlocks, formatZodErrors } = require('../nodes/finalResponseStep');

describe('BlocksOutput schema', () => {
  test('accepts valid blocks array with mixed types', () => {
    const input = {
      blocks: [
        { type: 'markdown', content: '## Overview' },
        { type: 'keyNumbers', items: [{ label: '完成率', value: '72.5%' }] },
        { type: 'insights', items: [{ level: 'warning', text: '华南偏低' }] },
        { type: 'suggestions', items: ['查看详情'] },
      ],
    };
    const result = BlocksOutput.safeParse(input);
    expect(result.success).toBe(true);
  });

  test('rejects unknown block type', () => {
    const input = { blocks: [{ type: 'faketype', foo: 'bar' }] };
    const result = BlocksOutput.safeParse(input);
    expect(result.success).toBe(false);
  });

  test('accepts empty blocks array', () => {
    const result = BlocksOutput.safeParse({ blocks: [] });
    expect(result.success).toBe(true);
  });

  test('accepts chart block without optional chartType', () => {
    const input = { blocks: [{ type: 'chart', datasetId: 'd1' }] };
    const result = BlocksOutput.safeParse(input);
    expect(result.success).toBe(true);
  });

  test('accepts table block with datasetId only', () => {
    const input = { blocks: [{ type: 'table', datasetId: 'd1' }] };
    const result = BlocksOutput.safeParse(input);
    expect(result.success).toBe(true);
  });
});

describe('extractPlottableData', () => {
  test('datasets do not have kind or preferChartType', () => {
    const toolResults = {
      t1: {
        toolName: 'query_metric',
        data: {
          success: true,
          data: {
            rows: [
              { dimensions: { store: 'S001' }, completion_rate: 78.1, total_count: 100 },
              { dimensions: { store: 'S002' }, completion_rate: 55.2, total_count: 80 },
            ],
          },
        },
      },
    };
    const datasets = extractPlottableData(toolResults);
    for (const ds of datasets) {
      expect(ds.kind).toBeUndefined();
      expect(ds.preferChartType).toBeUndefined();
    }
  });

  test('datasets have sampleRows with Chinese column labels', () => {
    const toolResults = {
      t1: {
        toolName: 'query_metric',
        data: {
          success: true,
          data: {
            rows: [
              { dimensions: { store: 'S001' }, completion_rate: 78.1 },
              { dimensions: { store: 'S002' }, completion_rate: 55.2 },
            ],
          },
        },
      },
    };
    const datasets = extractPlottableData(toolResults);
    for (const ds of datasets) {
      expect(ds.sampleRows).toBeDefined();
      if (ds.sampleRows && ds.sampleRows.length > 0) {
        const row = ds.sampleRows[0];
        const keys = Object.keys(row);
        const hasEnglish = keys.some(k => k.includes('_'));
        expect(hasEnglish).toBe(false);
      }
    }
  });

  test('sampleRows capped at 5', () => {
    const rows = [];
    for (let i = 0; i < 20; i++) {
      rows.push({ dimensions: { store: 'S' + i }, completion_rate: 50 + i, total_count: 100 });
    }
    const toolResults = {
      t1: { toolName: 'query_metric', data: { success: true, data: { rows } } },
    };
    const datasets = extractPlottableData(toolResults);
    for (const ds of datasets) {
      if (ds.sampleRows) {
        expect(ds.sampleRows.length).toBeLessThanOrEqual(5);
      }
    }
  });
});

describe('repairBlocks', () => {
  test('fills missing content on markdown block', () => {
    const input = { blocks: [{ type: 'markdown' }] };
    const result = repairBlocks(input);
    expect(result.blocks[0].content).toBe('');
  });

  test('fills missing items on keyNumbers block', () => {
    const input = { blocks: [{ type: 'keyNumbers' }] };
    const result = repairBlocks(input);
    expect(result.blocks[0].items).toEqual([]);
  });

  test('fills missing items on insights block', () => {
    const input = { blocks: [{ type: 'insights' }] };
    const result = repairBlocks(input);
    expect(result.blocks[0].items).toEqual([]);
  });

  test('fills missing items on suggestions block', () => {
    const input = { blocks: [{ type: 'suggestions' }] };
    const result = repairBlocks(input);
    expect(result.blocks[0].items).toEqual([]);
  });

  test('fills missing datasetId on chart block', () => {
    const input = { blocks: [{ type: 'chart' }] };
    const result = repairBlocks(input);
    expect(result.blocks[0].datasetId).toBe('');
  });

  test('fills missing datasetId on table block', () => {
    const input = { blocks: [{ type: 'table' }] };
    const result = repairBlocks(input);
    expect(result.blocks[0].datasetId).toBe('');
  });

  test('does not overwrite existing values', () => {
    const input = { blocks: [{ type: 'markdown', content: 'hello' }] };
    const result = repairBlocks(input);
    expect(result.blocks[0].content).toBe('hello');
  });

  test('repaired output passes BlocksOutput Zod validation', () => {
    const input = {
      blocks: [
        { type: 'markdown' },
        { type: 'keyNumbers' },
        { type: 'insights' },
        { type: 'suggestions' },
        { type: 'chart' },
        { type: 'table' },
        { type: 'markdown', content: '## Summary' },
        { type: 'keyNumbers', items: [{ label: '完成率', value: '72.5%' }] },
      ],
    };
    const repaired = repairBlocks(input);
    const result = BlocksOutput.safeParse(repaired);
    expect(result.success).toBe(true);
  });

  test('handles null input gracefully', () => {
    expect(repairBlocks(null)).toBe(null);
    expect(repairBlocks(undefined)).toBe(undefined);
  });

  test('handles non-object input', () => {
    expect(repairBlocks('string')).toBe('string');
    expect(repairBlocks(123)).toBe(123);
  });
});

describe('formatZodErrors', () => {
  test('translates missing content error to Chinese', () => {
    const issues = [
      { expected: 'string', code: 'invalid_type', path: ['blocks', 0, 'content'], message: 'Invalid input', received: 'undefined' },
    ];
    const result = formatZodErrors(issues);
    expect(result).toContain('缺少 "content"');
  });

  test('translates missing items error to Chinese', () => {
    const issues = [
      { expected: 'array', code: 'invalid_type', path: ['blocks', 2, 'items'], message: 'Invalid input', received: 'undefined' },
    ];
    const result = formatZodErrors(issues);
    expect(result).toContain('缺少 "items"');
  });

  test('falls back to generic format for unknown errors', () => {
    const issues = [
      { expected: 'number', code: 'invalid_type', path: ['blocks', 0, 'x'], message: 'Invalid input', received: 'string' },
    ];
    const result = formatZodErrors(issues);
    expect(result).toContain('期望 number');
  });

  test('handles non-array input', () => {
    expect(formatZodErrors(null)).toBe('null');
    expect(formatZodErrors('raw string')).toBe('"raw string"');
  });
});
