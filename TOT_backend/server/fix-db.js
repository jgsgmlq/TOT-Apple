const db = require('./db');
const tasks = db.db.all("SELECT id, auto_nudge_rules FROM tasks");
tasks.forEach(t => {
  if (t.auto_nudge_rules && t.auto_nudge_rules.includes('laggingLifestyle')) {
    try {
      const old = JSON.parse(t.auto_nudge_rules);
      const newRules = {
        progressLag: { lifestyle: old.laggingLifestyle || 3, mono: old.laggingMono || 1 },
        startDelay: old.startDelayPercent || 50,
        deadlineCrisis: { p0: old.deadlineCrisisHours || 24, p1: old.deadlineCrisisHoursSecondary || 48 }
      };
      db.db.run("UPDATE tasks SET auto_nudge_rules = ? WHERE id = ?", [JSON.stringify(newRules), t.id]);
      console.log(`Updated task ${t.id}`);
    } catch(e) {}
  }
});
