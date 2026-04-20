'use strict';

/**
 * FC 流式拆分器单测：
 *   - JSON 围栏场景：围栏前 reasoning、围栏及之后 content
 *   - Markdown 正文场景（无 json 围栏）：首句/空行前 reasoning、Markdown 正文 content
 *   - 直接正文（无前言）：全部 content
 *   - 纯文本（无分界）：全部 reasoning
 *
 *   node scripts/test-fc-stream-splitter.js
 */

const { createFcStreamDeltaSplitter } = require('../utils/fcStreamDeltaSplit');

function collect(stream) {
  const out = [];
  const w = createFcStreamDeltaSplitter((text, meta) => {
    if (text) out.push({ text, phase: meta && meta.phase });
  });
  for (const [text, phase] of stream) {
    w(text, phase ? { phase } : { phase: 'content' });
  }
  return out;
}

function fail(msg, ctx) {
  console.error('FAIL', msg, JSON.stringify(ctx));
  process.exit(1);
}

function assertPhases(caseName, events, predicate) {
  if (!events.every(predicate)) fail(caseName, events);
}

// Case A: JSON 围栏
{
  const events = collect([
    ['我来帮您分析。'],
    ['\n\n```json\n'],
    ['{"overview":"完成率约 50%","keyNumbers":[],"attentionPoints":[],"followUpSuggestions":[]}'],
  ]);
  // 围栏之前 reasoning，之后 content
  const joined = events.map((e) => e.text).join('');
  if (!joined.includes('```json')) fail('A: lost fence', events);
  const fenceStart = joined.indexOf('```json');
  let cursor = 0;
  for (const ev of events) {
    const endOfEv = cursor + ev.text.length;
    const isPre = endOfEv <= fenceStart;
    const expected = isPre ? 'reasoning' : 'content';
    if (ev.phase !== expected) fail('A: phase', { ev, expected });
    cursor = endOfEv;
  }
}

// Case B: Markdown 正文（无 json）
{
  const events = collect([
    ['我来为您查询需要重点关注的门店。'],
    ['\n\n'],
    ['## 预警门店列表\n'],
    ['| 门店 | 完成率 |\n|---|---|\n| A | 30% |\n'],
  ]);
  const reasoningText = events
    .filter((e) => e.phase === 'reasoning')
    .map((e) => e.text)
    .join('');
  const contentText = events
    .filter((e) => e.phase === 'content')
    .map((e) => e.text)
    .join('');
  if (!reasoningText.startsWith('我来为您查询')) fail('B: reasoning missing intro', events);
  if (!contentText.startsWith('## 预警门店列表')) fail('B: content should start with heading', events);
  if (reasoningText.includes('预警门店列表')) fail('B: body leaked into reasoning', events);
}

// Case C: 直接 Markdown 正文
{
  const events = collect([['## 培训任务列表\n'], ['| A | 1 |']]);
  assertPhases('C: direct markdown', events, (e) => e.phase === 'content');
}

// Case D: 纯文本（无结构、无空行）
{
  const events = collect([['这是一段纯文字的简单回答。']]);
  assertPhases('D: pure text', events, (e) => e.phase === 'reasoning');
}

// Case E: 两段文字，首个空行即分界
{
  const events = collect([['我来帮您分析。'], ['\n\n'], ['数据显示整体向好。']]);
  const reasoningText = events
    .filter((e) => e.phase === 'reasoning')
    .map((e) => e.text)
    .join('');
  const contentText = events
    .filter((e) => e.phase === 'content')
    .map((e) => e.text)
    .join('');
  if (!reasoningText.includes('我来帮您分析')) fail('E: intro lost', events);
  if (!contentText.includes('数据显示整体向好')) fail('E: body lost', events);
}

console.log(JSON.stringify({ event: 'fc_stream_splitter_ok', cases: ['A', 'B', 'C', 'D', 'E'] }));
