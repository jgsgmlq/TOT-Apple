'use strict';

const { buildConversation } = require('../nodes/loadContext');

function row(role, contentText, contentJson) {
  return { role, content_text: contentText, content_json: contentJson || null };
}

describe('buildConversation', () => {
  test('空数组返回 []', () => {
    expect(buildConversation([])).toEqual([]);
    expect(buildConversation(null)).toEqual([]);
  });

  test('单轮对话配对', () => {
    const rows = [
      row('user', '华东完成率？'),
      row('assistant', '78%', '{"_contentText":"完成率 78%","_provenance":{"scope":"华东 iPhone 17","cutoff":"2026-05-23"}}'),
    ];
    const result = buildConversation(rows);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ role: 'user', content: '华东完成率？', turn: 1 });
    expect(result[1].role).toBe('assistant');
    expect(result[1].content).toBe('完成率 78%');
    expect(result[1].provenance).toEqual({ scope: '华东 iPhone 17', cutoff: '2026-05-23' });
  });

  test('只有 user 无 assistant 不形成轮次', () => {
    const rows = [row('user', '华东？')];
    expect(buildConversation(rows)).toEqual([]);
  });

  test('超过 5 轮只保留最近 5 轮', () => {
    const rows = [];
    for (let i = 1; i <= 10; i++) {
      rows.push(row('user', `Q${i}`));
      rows.push(row('assistant', `A${i}`));
    }
    const result = buildConversation(rows);
    expect(result).toHaveLength(10); // 5 rounds * 2
    expect(result[0].content).toBe('Q6');
    expect(result[result.length - 2].content).toBe('Q10');
  });

  test('assistant 无 content_json 时用 content_text', () => {
    const rows = [row('user', 'Hi'), row('assistant', 'Hello!')];
    const result = buildConversation(rows);
    expect(result[1].content).toBe('Hello!');
  });

  test('中间混入 tool 消息不影响配对', () => {
    const rows = [
      row('user', 'Q1'),
      row('assistant', 'A1'),
      row('tool', 'tool_result'),
      row('user', 'Q2'),
      row('assistant', 'A2'),
    ];
    const result = buildConversation(rows);
    expect(result).toHaveLength(4);
  });
});
