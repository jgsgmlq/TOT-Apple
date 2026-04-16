'use strict';

const assert = require('assert');

async function testIntentMappingToRegionTool() {
  const chatIntentService = require('../services/chatIntentService');
  const chatToolsService = require('../services/chatToolsService');
  const chatAnswerService = require('../services/chatAnswerService');
  const chatAgentRunner = require('../services/chatAgentRunner');

  const originalClassify = chatIntentService.classify;
  const originalExecuteByName = chatToolsService.executeByName;
  const originalFormat = chatAnswerService.format;

  let calledToolName = null;
  let calledParams = null;

  try {
    chatIntentService.classify = async () => ({
      intentType: 'drill_down',
      entities: { region: '华东', topN: 5 }
    });

    chatToolsService.executeByName = async (toolName, params) => {
      calledToolName = toolName;
      calledParams = params;
      return {
        region: '华东',
        summary: { completionRate: 81.2 },
        storeLaggards: [],
        storeLeaders: [],
        dataSource: 'region_drilldown'
      };
    };

    chatAnswerService.format = async () => ({
      overview: '华东区当前完成率 81.2%',
      keyNumbers: [{ label: '完成率', value: '81.2', unit: '%' }],
      attentionPoints: [],
      followUpSuggestions: ['可追问：华东区最差的 5 家门店']
    });

    const reply = await chatAgentRunner.run('华东区怎么样？', [], { type: 'national' });

    assert.strictEqual(calledToolName, 'getRegionDetailData', 'drill_down with region should map to getRegionDetailData');
    assert.strictEqual(calledParams.region, '华东', 'region entity should be forwarded to tool');
    assert.strictEqual(reply._intentType, 'drill_down', 'reply intent should remain drill_down');
    assert.ok(typeof reply.overview === 'string' && reply.overview.length > 0, 'reply should contain overview');
  } finally {
    chatIntentService.classify = originalClassify;
    chatToolsService.executeByName = originalExecuteByName;
    chatAnswerService.format = originalFormat;
  }
}

async function testRegionScopeAuthDeny() {
  const regionTool = require('../chat_tools/tool_getRegionDetailData');

  let caught = null;
  try {
    await regionTool.handler(
      { region: '华东' },
      { type: 'regional', regions: ['华南'] }
    );
  } catch (err) {
    caught = err;
  }

  assert.ok(caught, 'should throw when querying region outside authorized scope');
  assert.strictEqual(caught.code, 'AUTH_003', 'error code should be AUTH_003');
  assert.strictEqual(caught.status, 403, 'error status should be 403');
}

async function main() {
  await testIntentMappingToRegionTool();
  await testRegionScopeAuthDeny();
  console.log('test-region-drilldown: all checks passed');
}

main().catch((err) => {
  console.error('test-region-drilldown failed:', err);
  process.exit(1);
});
