// diag-pipeline.js — 全链路诊断脚本
// 用法: cd TOT_backend/server && node scripts/diag-pipeline.js
'use strict';
require('dotenv').config({ path: '../.env' });

const chatCrud = require('../modules/dashboard/crud/chatCrud');
const { nanoid } = require('nanoid');
const { buildGraph } = require('../agent/graph/graph');
const { SqliteSaver } = require('@langchain/langgraph-checkpoint-sqlite');

function step(label) { console.log(`\n[${new Date().toISOString().slice(11,19)}] ═══ ${label} ═══`); }
function ok(label, detail) { console.log(`  ✅ ${label}${detail ? ': ' + detail : ''}`); }
function fail(label, detail) { console.log(`  ❌ ${label}${detail ? ': ' + detail : ''}`); }
function info(label, detail) { console.log(`  📋 ${label}${detail ? ': ' + JSON.stringify(detail).slice(0,500) : ''}`); }

(async () => {
  step('1. 创建测试 session');
  const sid = 'diag-' + nanoid(6);
  await chatCrud.createSession({ id: sid, userId: 'CENTRAL_001', entryType: 'executive', scopeType: 'national' });
  ok('session', sid);

  step('2. 编译 LangGraph');
  const app = (buildGraph()).compile({ checkpointer: SqliteSaver.fromConnString(':memory:') });
  ok('graph compiled');

  step('3. 调用 SafetyGateway + FC 循环');
  const t0 = Date.now();
  let state;
  try {
    state = await app.invoke({
      userMessage: 'iPad mini 培训完成率怎么样？',
      sessionId: sid, userId: 'CENTRAL_001',
      regionScope: { type: 'national' }, messages: []
    }, { configurable: { thread_id: sid }, recursionLimit: 60 });
    ok('invoke completed', `${Date.now()-t0}ms`);
  } catch (err) {
    fail('invoke failed', err.message);
    process.exit(1);
  }

  step('4. 检查 SafetyGateway');
  info('mode', state.mode);
  info('ambiguity', state.ambiguity_payload?.type);
  info('task_ref', state.extracted_task_ref);

  step('5. 检查 FC 工具调用');
  const toolKeys = Object.keys(state.toolResults || {});
  info('tools called', toolKeys.length + ' tools');
  for (const [id, entry] of Object.entries(state.toolResults || {})) {
    const hasErr = !!(entry.error || (entry.data && typeof entry.data === 'string' && entry.data.includes('"error"')));
    const preview = typeof entry.data === 'string' ? entry.data.slice(0,200) : JSON.stringify(entry.data).slice(0,200);
    if (hasErr) {
      fail('tool result', `${entry.toolName || id}: ${preview}`);
    } else {
      ok('tool result', `${entry.toolName || id}: ${preview}`);
    }
  }

  step('6. 检查 fc_LlmToolCallStep 回复');
  const fcReply = state.reply_markdown || '';
  if (fcReply && fcReply.length > 0) {
    info('FC LLM inline reply', fcReply.slice(0,300));
  } else {
    info('FC LLM inline reply', '(none)');
  }

  step('7. 检查 FinalResponse 输出');
  const finalReply = state.finalResponse || '';
  if (!finalReply) {
    fail('finalResponse is empty');
  } else {
    info('raw (first 200)', finalReply.slice(0,200));
    let parsed;
    try { parsed = JSON.parse(finalReply); } catch (_) { parsed = null; }
    if (parsed) {
      ok('is valid JSON');
      ok('overview', parsed.overview?.slice(0,100));
      ok('keyNumbers', (parsed.keyNumbers||[]).length + ' items');
      ok('attentionPoints', (parsed.attentionPoints||[]).length + ' items');
      ok('followUpSuggestions', (parsed.followUpSuggestions||[]).length + ' items');
      info('statisticsProvenance', parsed.statisticsProvenance);
      // Check for empty text in attentionPoints
      const badPoints = (parsed.attentionPoints||[]).filter(p => !p.text);
      if (badPoints.length > 0) fail('attentionPoints with empty text', badPoints.length + ' items');
      // Check visualizations
      if (parsed.visualizations && parsed.visualizations.length > 0) {
        ok('visualizations', parsed.visualizations.length + ' charts');
      } else {
        info('visualizations', 'none or null (OK for single-metric query)');
      }
      // Check table
      if (parsed.table) ok('table', parsed.table.title); else info('table', 'none');
    } else {
      fail('response is NOT valid JSON — fallback used');
      info('raw text', finalReply.slice(0,500));
    }
  }

  step('8. 检查 MySQL 落库');
  const msgs = await chatCrud.getMessages(sid);
  const lastMsg = msgs[msgs.length-1];
  if (!lastMsg) {
    fail('no messages in DB');
  } else {
    ok('content_text', String(lastMsg.content_text||'').slice(0,100));
    ok('content_json', lastMsg.content_json ? typeof lastMsg.content_json : 'MISSING');
    const hasJson = typeof lastMsg.content_json === 'object';
    if (hasJson) {
      ok('content_json overview', lastMsg.content_json.overview?.slice(0,80));
      ok('content_json keyNumbers', (lastMsg.content_json.keyNumbers||[]).length + ' items');
    }
  }

  console.log('\n═══════════════════════════════════════');
  console.log('  诊断完成。查看上方 ✅/❌ 定位问题。');
  console.log('═══════════════════════════════════════\n');
  process.exit(0);
})().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
