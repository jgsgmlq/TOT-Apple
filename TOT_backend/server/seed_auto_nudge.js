const { db } = require('./db');
const { evaluateAndTriggerAutoNudges } = require('./services/autoNudge');
(async () => {
  const tasks = db.all("SELECT id FROM tasks WHERE status = 'dispatched'");
  for (const t of tasks) {
    const res = await evaluateAndTriggerAutoNudges(t.id);
    console.log(t.id, res);
  }
  // Wait for setImmediate to finish
  await new Promise(r => setTimeout(r, 2000));
  const counts = db.get("SELECT COUNT(*) as c FROM notification_events WHERE event_type LIKE 'nudge_%'");
  console.log("Nudge events generated:", counts.c);
  process.exit();
})();
