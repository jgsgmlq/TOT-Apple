#!/bin/bash
set -e
cd "$(dirname "$0")/.."

echo "=== Step 1: 发 HITL 查询 ==="
SID="diag-$(node -e "console.log(require('nanoid').nanoid(6))")"
THREAD_ID="${SID}:main"

# 创建 session  
node -e "
require('dotenv').config({path: require('path').join(__dirname,'../../.env')});
const pool=require('../modules/common/db/mysql').getPool();
(async()=>{
  await pool.query('INSERT INTO chat_session (id,user_id,entry_type,scope_type,created_at,last_active_at) VALUES (?,?,?,?,NOW(3),NOW(3))',['$SID','CENTRAL_001','executive','national']);
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
"

# 发 clarify 查询
CLARIFY_RAW=$(node -e "
const http=require('http'),jwt=require('jsonwebtoken');
const tok=jwt.sign({id:'CENTRAL_001',username:'central',role:'executive'},'mvp-training-secret-2026');
const req=http.request({hostname:'localhost',port:3000,method:'POST',path:'/api/v1/chat/executive/sessions/$SID/messages',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tok}},res=>{
  let b='';res.on('data',c=>b+=c.toString());res.on('end',()=>process.stdout.write(b));
});req.write(JSON.stringify({content:'有哪些门店需要重点关注？',stream:'langgraph'}));req.end();
")

echo "Clarify event: $(echo "$CLARIFY_RAW" | grep -c 'event: clarify')"
echo "Done event: $(echo "$CLARIFY_RAW" | grep -c 'event: done')"

# 提取第一个 option
FIRST_OPT=$(echo "$CLARIFY_RAW" | node -e "
process.stdin.on('data',d=>{
  const m=d.match(/event: clarify\\\\ndata: (\\\\{[\\\\s\\\\S]*?\\\\})\\\\n\\\\n/);
  if(m){ const c=JSON.parse(m[1]); const o=c.data?.options?.[0]; console.log(JSON.stringify(o)); }
});
")

echo ""
echo "=== Step 2: Resume with option ==="
echo "Selected: $FIRST_OPT"

if [ -z "$FIRST_OPT" ]; then
  echo "ERROR: No options in clarify event. Full clarify payload:"
  echo "$CLARIFY_RAW" | grep -A2 "event: clarify"
  exit 1
fi

# 提取 threadId
THREAD_ID=$(echo "$CLARIFY_RAW" | node -e "process.stdin.on('data',d=>{const m=d.match(/\"threadId\":\"([^\"]+)\"/);console.log(m?m[1]:'');})")
echo "ThreadId: $THREAD_ID"

# 发送 resume
RESUME_RAW=$(node -e "
const http=require('http'),jwt=require('jsonwebtoken');
const tok=jwt.sign({id:'CENTRAL_001',username:'central',role:'executive'},'mvp-training-secret-2026');
const opt=$FIRST_OPT;
const body=JSON.stringify({
  stream:'langgraph',
  threadId:'$THREAD_ID',
  resumePayload:{ action:'select_option', option:opt, value:opt.value, resume_type:'slot_fill', user_text:opt.label }
});
const req=http.request({hostname:'localhost',port:3000,method:'POST',path:'/api/v1/chat/executive/sessions/$SID/resume',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tok}},res=>{
  let b='';res.on('data',c=>b+=c.toString());res.on('end',()=>process.stdout.write(b));
});req.write(body);req.end();
")

echo ""
echo "=== Step 3: Resume result ==="
echo "Events: $(echo "$RESUME_RAW" | grep -o 'event: \\w*' | sort -u | tr '\n' ' ')"
echo "Done: $(echo "$RESUME_RAW" | grep -c 'event: done')"
echo "Error: $(echo "$RESUME_RAW" | grep -c 'event: error')"

# 看最终的回复
FINAL=$(echo "$RESUME_RAW" | node -e "
process.stdin.on('data',d=>{
  const m=d.match(/event: done\\\\ndata: (\\\\{[\\\\s\\\\S]*?\\\\})\\\\n\\\\n/);
  if(m){ const done=JSON.parse(m[1]); console.log('replyContent:',done.data?.replyContent?'YES':'NO','| markdownContent:',(done.data?.markdownContent||'').slice(0,150)); }
  const deltas=[...d.matchAll(/\"phase\":\"content\"[^}]*\"text\":\"([^\"]*)\"/g)].map(m=>m[1]).join('');
  if(deltas) console.log('content deltas:', deltas.slice(0,300));
});
")

echo "$FINAL"
