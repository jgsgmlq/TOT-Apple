const { evaluateAndTriggerAutoNudges } = require('./services/autoNudge');
(async () => {
  const result = await evaluateAndTriggerAutoNudges('OP-rD1lPbBq06uDfp-yLb');
  console.log(result);
  process.exit();
})();
