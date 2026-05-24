'use strict';

const { buildAmbiguityPayload } = require('../nodes/resolveEntities');

describe('buildAmbiguityPayload', () => {
  test('tasks multiple → task_ambiguous with options', () => {
    const result = {
      tasks: {
        status: 'multiple',
        items: [
          { task_publish_id: 'T1', task_title: 'Task A', model_type: 'BAU', due_date: '2026-06-01', match_type: 'fuzzy_name', score: 0.92 },
          { task_publish_id: 'T2', task_title: 'Task B', model_type: 'BAU', due_date: '2026-05-28', match_type: 'category_filter', score: 0.80 }
        ]
      },
      org: { status: 'not_requested', resolved: null },
      needs_clarification: true
    };
    const filters = { task_name: 'BAU', task_category: null };
    const payload = buildAmbiguityPayload(result, filters);
    expect(payload.type).toBe('task_ambiguous');
    expect(payload.options.length).toBe(2);
    expect(payload.options[0].id).toBe('T1');
    expect(payload.options[0].label).toBe('Task A');
    expect(payload.options[0].subtitle).toContain('BAU');
    expect(payload.resume_type).toBe('slot_fill');
  });

  test('tasks not_found → task_not_found with empty options', () => {
    const result = {
      tasks: { status: 'not_found', items: [] },
      org: { status: 'not_requested', resolved: null },
      needs_clarification: true
    };
    const filters = { task_name: 'NoSuchTask', task_category: null };
    const payload = buildAmbiguityPayload(result, filters);
    expect(payload.type).toBe('task_not_found');
    expect(payload.question).toContain('NoSuchTask');
    expect(payload.options).toEqual([]);
  });

  test('org multiple → org_ambiguous', () => {
    const result = {
      tasks: { status: 'not_requested', items: [] },
      org: {
        status: 'multiple',
        options: [
          { code: 'EAST', name: '华东', org_type: 'region' },
          { code: 'WEST', name: '西部', org_type: 'region' }
        ]
      },
      needs_clarification: true
    };
    const filters = { org_name: '华' };
    const payload = buildAmbiguityPayload(result, filters);
    expect(payload.type).toBe('org_ambiguous');
    expect(payload.options[0].id).toBe('EAST');
  });

  test('no clarification needed → null', () => {
    const result = {
      tasks: { status: 'resolved', items: [{ task_publish_id: 'T1' }] },
      org: { status: 'resolved', resolved: { code: 'EAST' } },
      needs_clarification: false
    };
    const filters = {};
    expect(buildAmbiguityPayload(result, filters)).toBeNull();
  });
});
