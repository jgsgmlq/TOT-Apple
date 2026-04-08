const { evaluateAndTriggerAutoNudges } = require('./services/autoNudge');
(async () => {
  const result = await evaluateAndTriggerAutoNudges('Gw2hjjLT2DVLaxdyirU8v');
  console.log(result);
  process.exit();
})();
