'use strict';

const { normalizeForNameSearch, tokenizeForSearch } = require('../dashboardMysqlCrud');

describe('normalizeForNameSearch', () => {
  test('removes whitespace', () => {
    expect(normalizeForNameSearch('跨渠道 BAU')).toBe('跨渠道BAU');
  });

  test('converts fullwidth pipe to halfwidth', () => {
    expect(normalizeForNameSearch('Chat Mock｜跨渠道')).toBe('ChatMock|跨渠道');
  });

  test('converts fullwidth parentheses', () => {
    expect(normalizeForNameSearch('任务（BAU）')).toBe('任务(BAU)');
  });

  test('converts fullwidth comma, colon, semicolon, exclamation', () => {
    expect(normalizeForNameSearch('A，B：C；D！')).toBe('A,B:C;D!');
  });

  test('handles mixed fullwidth and whitespace', () => {
    expect(normalizeForNameSearch('Chat Mock ｜ 跨渠道 （NPI）')).toBe('ChatMock|跨渠道(NPI)');
  });

  test('returns unchanged for already normalized input', () => {
    expect(normalizeForNameSearch('跨渠道BAU')).toBe('跨渠道BAU');
  });
});

describe('tokenizeForSearch', () => {
  test('returns 2-grams plus full string', () => {
    const result = tokenizeForSearch('跨渠道');
    expect(result).toContain('跨渠');
    expect(result).toContain('渠道');
    expect(result).toContain('跨渠道');
  });

  test('deduplicates tokens', () => {
    const result = tokenizeForSearch('aa');
    expect(result).toEqual(['aa']);
  });

  test('normalizes before tokenizing', () => {
    const result = tokenizeForSearch('A｜B');
    expect(result).toContain('A|B');
    expect(result).toContain('A|');
    expect(result).toContain('|B');
  });
});
