// HITL End-to-End Diagnostic
// 用法: node scripts/diag-hitl-full.mjs

import http from 'http';
import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '../../.env') });

// Use dynamic import for CJS modules
const { getPool } = await import('../modules/common/db/mysql.js');

const pool = getPool();
const sid = 'diagr-' + nanoid(6);
const tok = jwt.sign({ id: 'CENTRAL_001', username: 'central', role: 'executive' }, 'mvp-training-secret-2026');

function httpPost(path, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost', port: 3000, method: 'POST', path,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok }
    }, res => { let b = ''; res.on('data', c => b += c.toString()); res.on('end', () => resolve(b)); });
    req.on('error', reject);
    req.write(JSON.stringify(body)); req.end();
  });
}

try {
  // 1. Create session
  await pool.query('INSERT INTO chat_session (id,user_id,entry_type,scope_type,created_at,last_active_at) VALUES (?,?,?,?,NOW(3),NOW(3))', [sid, 'CENTRAL_001', 'executive', 'national']);

  // 2. Send HITL query
  console.log('=== 1. HITL Query ===');
  const clarifyRaw = await httpPost('/api/v1/chat/executive/sessions/' + sid + '/messages', { content: '有哪些门店需要重点关注？', stream: 'langgraph' });

  const hasClarify = clarifyRaw.includes('event: clarify');
  console.log('Clarify event:', hasClarify ? '✅' : '❌');

  if (!hasClarify) {
    console.log('RAW:', clarifyRaw.slice(0, 500));
    process.exit(1);
  }

  // Extract first option and threadId
  const cm = clarifyRaw.match(/event: clarify\ndata: (\{[\s\S]*?\})\n\n/);
  if (!cm) { console.log('No clarify payload found'); process.exit(1); }

  const clarify = JSON.parse(cm[1]);
  const opts = clarify.data?.options || [];
  const threadId = clarify.data?.threadId;
  console.log('Options:', opts.length, 'ThreadId:', threadId?.slice(0, 30));
  if (opts.length === 0) { console.log('NO OPTIONS'); process.exit(1); }

  const selected = { action: 'select_option', option: opts[0], value: opts[0].value, resume_type: 'slot_fill', user_text: opts[0].label };
  console.log('Selected:', opts[0].label);

  // 3. Resume
  console.log('');
  console.log('=== 2. Resume ===');
  const resumeRaw = await httpPost('/api/v1/chat/executive/sessions/' + sid + '/resume', { stream: 'langgraph', threadId, resumePayload: selected });

  // Analyze resume result
  const events = [...resumeRaw.matchAll(/event: (\w+)/g)].map(m => m[1]);
  console.log('Events:', [...new Set(events)].join(', '));

  const hasDone = resumeRaw.includes('event: done');
  const hasError = resumeRaw.includes('event: error');

  let rc = null, md = '';
  if (hasDone) {
    const dm = resumeRaw.match(/event: done\ndata: (\{[\s\S]*?\})\n\n/);
    if (dm) {
      const done = JSON.parse(dm[1]);
      const status = done.data?.status;
      rc = done.data?.replyContent;
      md = done.data?.markdownContent || '';
      console.log('Done status:', status || 'success');
      console.log('replyContent:', rc ? 'YES' : 'NO');
      console.log('markdownContent:', md.slice(0, 300));
    }
  }

  if (hasError) {
    const em = resumeRaw.match(/event: error\ndata: (\{[\s\S]*?\})\n\n/);
    if (em) console.log('Error:', JSON.parse(em[1]).message?.slice(0, 200));
  }

  // Check if we got useful data or just an error/fallback
  const contentText = [...resumeRaw.matchAll(/"phase":"content"[^}]*"text":"([^"]*)"/g)].map(m => m[1]).join('');
  console.log('Content text:', contentText.slice(0, 400));

  // Final verdict: check both replyContent (structured) and markdownContent (fallback)
  const doneOk = hasDone && (rc !== null || (md && md.length > 20));
  const noError = !contentText.includes('抱歉') && !contentText.includes('异常');
  const success = doneOk && noError;
  console.log('');
  console.log(success ? '✅ Full HITL flow works' : '❌ HITL flow has issues — see above');
  process.exit(success ? 0 : 1);

} catch (e) {
  console.error('FATAL:', e.message);
  process.exit(1);
}
