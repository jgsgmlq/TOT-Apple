const { run } = require('./services/chatAgentRunner');
const chatToolsService = require('./services/chatToolsService');

// Mock `chatWithToolsStream`
const aiUtil = require('./utils/ai');

// 篡改底层的 API 调用，让它返回我们预期的 Tool Calls
aiUtil.chatWithToolsStream = async function(params) {
  const { messages } = params;
  const userMsg = messages[messages.length - 1].content;
  
  if (userMsg.includes('发邮件')) {
      // 实际上，如果命中发邮件，在 run() 里面就已经被 Supervisor 拦住了
      // 这里如果走到了 FC，说明 Supervisor 没拦住（比如网络报错降级了）
      return { content: '抱歉，我不具备发邮件权限。', tool_calls: [] };
  }

  if (userMsg.includes('南京店')) {
    // 模拟 AI 决定调用工具获取门店详情，但参数模糊
    return {
      content: null,
      tool_calls: [{
        id: 'call_mock_1',
        type: 'function',
        function: { name: 'getStoreDetailData', arguments: '{"storeId": "南京"}' }
      }]
    };
  }

  if (userMsg.includes('华东区业态')) {
     return {
        content: null,
        tool_calls: [{
           id: 'call_mock_2',
           type: 'function',
           function: { name: 'queryExecutiveMetrics', arguments: '{"dimensions": ["channel_l4"], "metrics": ["completion_rate"], "filters": {"region": "华东"}}'}
        }]
     };
  }

  return { content: '这是默认的回复内容。', tool_calls: [] };
};

// 同时也稍微 Mock 一下 getStoreDetailData 让它抛出澄清
const originalExecute = chatToolsService.executeByName;
chatToolsService.executeByName = async function(toolName, args, regionScope) {
  if (toolName === 'getStoreDetailData' && args.storeId === '南京') {
    return {
      needDisambiguation: true,
      reason: 'store_name_ambiguous',
      message: '请问您指的是哪一家南京店？',
      candidates: [
        { id: 'S002', name: '南京新街口店' },
        { id: 'S999', name: '南京虹悦城店' }
      ]
    };
  }
  return { error: false, data: [{ name: '模拟数据', rate: 100 }] };
};

async function runMockTests() {
  console.log("=== 启动 AI 推理与决策断言 (Mock LLM) ===\n");

  const regionScope = { type: 'national', regions: null, rtm: null };

  console.log("▶ [用例 A] 用户提出模糊的门店名词：南京店");
  const res1 = await run("查询南京店的完成率", [], regionScope, { sessionId: 's1' });
  console.log("  AI 最终返回:", res1);
  if (res1.attentionPoints.some(p => p.includes('命中多个门店'))) {
      console.log("  ✅ AI 成功触发了【主动澄清 (Disambiguation)】流程！\n");
  } else {
      console.log("  ❌ 主动澄清流程未触发。\n");
  }

  console.log("▶ [用例 B] 用户要求对比业态数据");
  const res2 = await run("华东区业态表现对比", [], regionScope, { sessionId: 's2' });
  console.log("  AI 最终返回:", res2);
  if (res2._toolMeta.toolName === 'queryExecutiveMetrics') {
      console.log("  ✅ AI 成功选择了【高管度量查询工具 (queryExecutiveMetrics)】！\n");
  } else {
      console.log("  ❌ 工具选择错误。\n");
  }
}

runMockTests();
