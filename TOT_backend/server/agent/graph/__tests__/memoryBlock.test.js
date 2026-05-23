'use strict';

const { renderConversation, renderLongTerm } = require('../shared/memoryBlock');

describe('renderConversation', () => {
  test('空数组返回空字符串', () => {
    expect(renderConversation([])).toBe('');
    expect(renderConversation(null)).toBe('');
    expect(renderConversation(undefined)).toBe('');
  });

  test('正常 user+assistant 对话渲染', () => {
    const conv = [
      { role: 'user', content: '华东完成率？', turn: 1 },
      { role: 'assistant', content: '78%', provenance: { scope: '华东 iPhone 17' }, turn: 1 },
    ];
    const result = renderConversation(conv);
    expect(result).toContain('## 对话历史');
    expect(result).toContain('User: 华东完成率？');
    expect(result).toContain('Assistant [范围: 华东 iPhone 17]: 78%');
  });

  test('assistant 无 provenance 时不附加范围标注', () => {
    const conv = [
      { role: 'user', content: '你好', turn: 1 },
      { role: 'assistant', content: '你好！', provenance: null, turn: 1 },
    ];
    const result = renderConversation(conv);
    expect(result).toContain('Assistant: 你好！');
    expect(result).not.toContain('[范围:');
  });

  test('多轮对话按序渲染', () => {
    const conv = [
      { role: 'user', content: 'Q1', turn: 1 },
      { role: 'assistant', content: 'A1', provenance: null, turn: 1 },
      { role: 'user', content: 'Q2', turn: 2 },
      { role: 'assistant', content: 'A2', provenance: null, turn: 2 },
    ];
    const lines = renderConversation(conv).split('\n');
    const userIdx1 = lines.findIndex(l => l.includes('Q1'));
    const userIdx2 = lines.findIndex(l => l.includes('Q2'));
    expect(userIdx1).toBeLessThan(userIdx2);
  });
});

describe('renderLongTerm', () => {
  test('空字符串返回空字符串', () => {
    expect(renderLongTerm('')).toBe('');
    expect(renderLongTerm(null)).toBe('');
    expect(renderLongTerm('   ')).toBe('');
  });

  test('正常格式化', () => {
    const text = '[user]\n- 偏好柱状图\n\n[project]\n- iPhone 17 是 P0 任务';
    const result = renderLongTerm(text);
    expect(result).toContain('## 长期记忆');
    expect(result).toContain('[user]');
    expect(result).toContain('偏好柱状图');
  });
});
