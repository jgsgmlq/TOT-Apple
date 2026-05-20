// Diagnose all delta events in resume flow
import http from 'http'; import jwt from 'jsonwebtoken'; import { nanoid } from 'nanoid';
import { config } from 'dotenv'; import { join, dirname } from 'path'; import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '../../.env') });
const { getPool } = await import('../modules/common/db/mysql.js');
const pool = getPool();
const sid = 'dd2-' + nanoid(6);
const tok = jwt.sign({ id: 'CENTRAL_001', username: 'central', role: 'executive' }, 'mvp-training-secret-2026');
const httpPost = (path, body) => new Promise(r => {
  const req = http.request({ hostname: 'localhost', port: 3000, method: 'POST', path, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok } }, res => { let b = ''; res.on('data', c => b += c.toString()); res.on('end', () => r(b)); });
  req.write(JSON.stringify(body)); req.end();
});

try {
  await pool.query('INSERT INTO chat_session (id,user_id,entry_type,scope_type,created_at,last_active_at) VALUES (?,?,?,?,NOW(3),NOW(3))', [sid, 'CENTRAL_001', 'executive', 'national']);

  const c = await httpPost('/api/v1/chat/executive/sessions/' + sid + '/messages', { content: '有哪些门店需要重点关注？', stream: 'langgraph' });
  const cm = c.match(/event: clarify\ndata: (\{[\s\S]*?\})\n\n/);
  const clarify = JSON.parse(cm[1]);
  const tid = clarify.data?.threadId, opt = clarify.data?.options[0];

  const raw = await httpPost('/api/v1/chat/executive/sessions/' + sid + '/resume', { stream: 'langgraph', threadId: tid, resumePayload: { action: 'select_option', option: opt, value: opt.value, resume_type: 'slot_fill', user_text: opt.label } });

  console.log('=== ALL DELTA EVENTS ===');
  raw.split('\n').forEach(line => {
    if (line.startsWith('event:')) console.log(line);
    if (line.startsWith('data:') && line.includes('"phase"')) {
      try {
        const d = JSON.parse(line.slice(6));
        const t = (d.text || '').slice(0, 100);
        const p = d.phase || '';
        if (t || p) console.log('  [' + p + ']', t);
      } catch (e) { }
    }
  });

  // Check done event
  const dm = raw.match(/event: done\ndata: (\{[\s\S]*?\})\n\n/);
  if (dm) {
    const done = JSON.parse(dm[1]);
    console.log('\n=== DONE ===');
    console.log('replyContent:', done.data?.replyContent ? 'YES' : 'NO');
  }
  process.exit(0);
} catch (e) { console.error(e.message); process.exit(1); }
