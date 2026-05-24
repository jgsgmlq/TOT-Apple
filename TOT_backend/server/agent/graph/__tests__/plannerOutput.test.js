'use strict';

const { PlannerOutput } = require('../shared/blocksSchema');

describe('PlannerOutput', () => {
  test('validates a complete planner output', () => {
    const input = {
      questionType: 'list',
      analysis: '用户想知道当前有哪些进行中的任务，核心信息需求是任务名称、平台、优先级、截止时间。',
      selectedDatasets: ['list_abc123'],
      suggestedApproach: '先给关键数字，再用表格列出所有任务，补充一条洞察点出需要关注的任务。',
    };
    const result = PlannerOutput.safeParse(input);
    expect(result.success).toBe(true);
  });

  test('rejects unknown questionType', () => {
    const input = {
      questionType: 'unknown_type',
      analysis: '...',
      selectedDatasets: [],
      suggestedApproach: '...',
    };
    const result = PlannerOutput.safeParse(input);
    expect(result.success).toBe(false);
  });

  test('rejects missing analysis', () => {
    const input = {
      questionType: 'list',
      selectedDatasets: [],
      suggestedApproach: '...',
    };
    const result = PlannerOutput.safeParse(input);
    expect(result.success).toBe(false);
  });

  test('rejects non-string array in selectedDatasets', () => {
    const input = {
      questionType: 'list',
      analysis: '...',
      selectedDatasets: [123],
      suggestedApproach: '...',
    };
    const result = PlannerOutput.safeParse(input);
    expect(result.success).toBe(false);
  });

  test('accepts empty selectedDatasets', () => {
    const input = {
      questionType: 'trend',
      analysis: '...',
      selectedDatasets: [],
      suggestedApproach: '...',
    };
    const result = PlannerOutput.safeParse(input);
    expect(result.success).toBe(true);
  });
});
