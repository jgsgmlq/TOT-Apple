require('dotenv').config({path: require('path').join(__dirname, '../../.env')});
const pool=require('../modules/common/db/mysql').getPool();
(async()=>{
  const ids=(await pool.query("SELECT task_publish_id FROM task_publish WHERE task_title LIKE '%smoke%' OR task_title LIKE '%冒烟%' OR task_title LIKE 'TEST_%'"))[0];
  console.log('Deleting', ids.length, 'smoke tasks...');
  for(const r of ids){
    const tid=r.task_publish_id;
    try{await pool.query('DELETE FROM task_publish_learner WHERE task_publish_id = ?',[tid]);}catch(_){}
    try{await pool.query('DELETE FROM learner_task_reminder WHERE task_publish_id = ?',[tid]);}catch(_){}
    try{await pool.query('DELETE FROM learner_task_queue WHERE task_publish_id = ?',[tid]);}catch(_){}
    await pool.query('DELETE FROM task_publish WHERE task_publish_id = ?',[tid]);
    console.log('  Deleted:', tid);
  }
  console.log('Done');
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
