'use strict';

// Mock mysql 模块（chatMemoryService 的 require 路径是 ../modules/common/db/mysql）
jest.mock('../modules/common/db/mysql', () => ({
  all: jest.fn(),
  get: jest.fn(),
  run: jest.fn(),
}));

const { all } = require('../modules/common/db/mysql');
const { getMemories } = require('../services/chatMemoryService');

describe('getMemories', () => {
  test('空结果返回空字符串', async () => {
    all.mockResolvedValue([]);
    const result = await getMemories(1);
    expect(result).toBe('');
  });

  test('单类型 user 分组', async () => {
    all.mockResolvedValue([
      { memory_type: 'user', content: '偏好柱状图' },
      { memory_type: 'user', content: '默认关注华东' },
    ]);
    const result = await getMemories(1);
    expect(result).toBe('[user]\n- 偏好柱状图\n- 默认关注华东');
  });

  test('多类型分组，组间用双换行分隔', async () => {
    all.mockResolvedValue([
      { memory_type: 'user', content: '偏好柱状图' },
      { memory_type: 'project', content: 'iPhone 17 是 P0' },
      { memory_type: 'feedback', content: '对比时排名' },
    ]);
    const result = await getMemories(1);
    expect(result).toContain('[user]');
    expect(result).toContain('[project]');
    expect(result).toContain('[feedback]');
    // 分组顺序验证
    const userIdx = result.indexOf('[user]');
    const feedbackIdx = result.indexOf('[feedback]');
    const projectIdx = result.indexOf('[project]');
    expect(userIdx).toBeLessThan(feedbackIdx);
    expect(feedbackIdx).toBeLessThan(projectIdx);
  });

  test('未知类型归入 other', async () => {
    all.mockResolvedValue([
      { memory_type: 'unknown_type', content: 'something' },
    ]);
    const result = await getMemories(1);
    expect(result).toContain('[other]');
    expect(result).toContain('[unknown_type] something');
  });
});
