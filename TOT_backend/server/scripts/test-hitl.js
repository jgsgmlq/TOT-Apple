const http=require('http'),jwt=require('jsonwebtoken'),{nanoid}=require('nanoid');
require('dotenv').config({path:require('path').join(__dirname,'../../.env')});
const pool=require('../modules/common/db/mysql').getPool();
(async()=>{
  const sid='t5-'+nanoid(6);
  await pool.query('INSERT INTO chat_session (id,user_id,entry_type,scope_type,created_at,last_active_at) VALUES (?,?,?,?,NOW(3),NOW(3))',[sid,'CENTRAL_001','executive','national']);
  const tok=jwt.sign({id:'CENTRAL_001',username:'central',role:'executive'},'mvp-training-secret-2026');
  const raw=await new Promise(r=>{const req=http.request({hostname:'localhost',port:3000,method:'POST',path:'/api/v1/chat/executive/sessions/'+sid+'/messages',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tok}},res=>{let b='';res.on('data',c=>b+=c.toString());res.on('end',()=>r(b))});req.write(JSON.stringify({content:'有哪些门店需要重点关注？',stream:'langgraph'}));req.end()});
  console.log('SSE:',raw.includes('event: clarify')?'✅ clarify':'❌');
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
