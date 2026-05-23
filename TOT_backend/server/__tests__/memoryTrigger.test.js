'use strict';

const { shouldTriggerLongTermExtraction } = require('../agent/graph/nodes/persistAndEmit');

describe('shouldTriggerLongTermExtraction', () => {
  test('turnCount=0 触发', () => {
    expect(shouldTriggerLongTermExtraction(0)).toBe(true);
  });

  test('turnCount=1~9 不触发', () => {
    for (let i = 1; i <= 9; i++) {
      expect(shouldTriggerLongTermExtraction(i)).toBe(false);
    }
  });

  test('turnCount=10 触发', () => {
    expect(shouldTriggerLongTermExtraction(10)).toBe(true);
  });

  test('turnCount=11 不触发', () => {
    expect(shouldTriggerLongTermExtraction(11)).toBe(false);
  });

  test('turnCount=20 触发', () => {
    expect(shouldTriggerLongTermExtraction(20)).toBe(true);
  });
});
