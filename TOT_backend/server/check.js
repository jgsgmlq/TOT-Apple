const db = require('./db');
const taskId = process.argv[2] || 'task1'; // Let's get the first active task id
const tasks = db.db.all("SELECT * FROM tasks WHERE status='dispatched'");
if (!tasks.length) {
  console.log("No dispatched tasks");
  process.exit(0);
}
for (let t of tasks) {
  console.log("Task ID:", t.id);
  console.log("Rules:", t.auto_nudge_rules);
  const assignments = db.db.all("SELECT ta.*, s.rtm, s.format FROM task_assignments ta JOIN stores s ON ta.store_id = s.id WHERE ta.task_id = ? AND ta.status != 'completed'", [t.id]);
  console.log("Assignments Count:", assignments.length);
  if(assignments.length > 0) {
    console.log("Sample Assignment:", assignments[0]);
  }
}
