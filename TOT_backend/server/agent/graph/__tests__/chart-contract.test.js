'use strict';

/**
 * Chart 数据契约测试
 * 验证后端生成的数据格式与前端 ChartData 类型 / AiChartRenderer 期望一致。
 *
 * 这些测试保护以下 bug 不回退：
 *   1. labels ← 应为 xAxis（前端 ECharts 用 xAxis，空值导致 "xAxis '0' not found"）
 *   2. 不认识的 chart type 前端能否容错（前端 fallback 到 bar）
 *   3. series 结构完整性
 */

const { extractPlottableData } = require('../shared/extractPlottableData');

// 模拟真实 toolResults
const makeToolResults = () => ({
  'call_1': {
    data: JSON.stringify({
      success: true,
      data: [
        { dimensions: { store: '11110001' }, completion_rate: 90, total_count: 10 },
        { dimensions: { store: '11110002' }, completion_rate: 60, total_count: 10 },
        { dimensions: { store: '11110003' }, completion_rate: 20, total_count: 10 },
        { dimensions: { store: '11110004' }, completion_rate: 0,  total_count: 10 },
      ],
    }),
    toolName: 'query_metric',
  },
  'call_funnel': {
    data: JSON.stringify({
      success: true,
      data: {
        task_id: 'T1',
        completion_funnel: {
          stages: [
            { stage: 'pushed', label: '推送', count: 40 },
            { stage: 'started', label: '开始学习', count: 33 },
            { stage: 'done', label: '完成学习', count: 17 },
          ],
        },
      },
    }),
    toolName: 'get_task_dashboard',
  },
});

describe('extractPlottableData 输出契约', () => {
  let datasets;
  beforeAll(() => { datasets = extractPlottableData(makeToolResults()); });

  test('每个 dataset 用 xAxis (不是 labels) —— 前端 ChartData 类型期望 xAxis', () => {
    expect(datasets.length).toBeGreaterThanOrEqual(1);
    for (const ds of datasets) {
      expect(ds.xAxis).toBeDefined();
      expect(Array.isArray(ds.xAxis)).toBe(true);
      expect(ds.xAxis.length).toBeGreaterThanOrEqual(1);
      // 关键：不应有 labels 字段（旧名，前端不认识）
      expect(ds.labels).toBeUndefined();
    }
  });

  test('每个 dataset 的 series 结构完整', () => {
    for (const ds of datasets) {
      expect(Array.isArray(ds.series)).toBe(true);
      expect(ds.series.length).toBeGreaterThanOrEqual(1);
      for (const s of ds.series) {
        expect(typeof s.name).toBe('string');
        expect(Array.isArray(s.data)).toBe(true);
        expect(s.data.length).toBeGreaterThanOrEqual(1);
        expect(s.data.every((v) => typeof v === 'number')).toBe(true);
      }
    }
  });

  test('preferChartType 为前端已知类型或可 fallback', () => {
    // 前端 AiChartRenderer SUPPORTED = ['bar','line','pie','scatter']
    // funnel/radar 由前端 fallback 到 bar。preferChartType 仅为建议。
    const FALLBACK_SAFE = ['bar', 'line', 'pie', 'scatter', 'funnel', 'radar'];
    for (const ds of datasets) {
      expect(FALLBACK_SAFE).toContain(ds.preferChartType);
    }
  });

  test('funnel 数据集也产生 xAxis（前端 isCartesian 依赖 xAxis）', () => {
    const funnel = datasets.find((d) => d.kind === 'funnel');
    expect(funnel).toBeDefined();
    expect(funnel.xAxis.length).toBeGreaterThanOrEqual(2);
  });
});
