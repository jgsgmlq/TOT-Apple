'use strict';
require('dotenv').config();
const { ChatOpenAI } = require('@langchain/openai');

const baseCfg = {
  modelName: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY,
  configuration: { baseURL: process.env.DEEPSEEK_API_BASE_URL || 'https://api.deepseek.com/v1' },
  temperature: 0.1,
  maxTokens: 256,
};

const sampleTool = {
  type: 'function',
  function: {
    name: 'getWarningsData',
    description: '获取门店预警数据',
    parameters: {
      type: 'object',
      properties: { region: { type: 'string', description: '区域名称' } },
      required: [],
    },
  },
};

async function timed(label, p) {
  const t0 = Date.now();
  try {
    const r = await Promise.race([
      p,
      new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT_30s')), 30000)),
    ]);
    console.log(`[OK] ${label} ${Date.now() - t0}ms tool_calls=${(r.tool_calls || []).length} content=${String(r.content || '').slice(0, 60)}`);
  } catch (e) {
    console.log(`[FAIL] ${label} ${Date.now() - t0}ms ${e.message}`);
  }
}

(async () => {
  console.log('baseURL =', baseCfg.configuration.baseURL);
  console.log('key tail =', String(baseCfg.apiKey || '').slice(-6));

  // A: 非 streaming + 无 tools（应该通，等价于 Router）
  await timed('A non-stream  no-tools', new ChatOpenAI(baseCfg).invoke('say hi'));

  // B: streaming=true + 无 tools
  await timed('B    stream  no-tools', new ChatOpenAI({ ...baseCfg, streaming: true }).invoke('say hi'));

  // C: 非 streaming + 绑 tools
  await timed('C non-stream  +tools  ', new ChatOpenAI(baseCfg).bindTools([sampleTool]).invoke('门店有哪些需要重点关注？'));

  // D: streaming=true + 绑 tools  (FC 实际配置)
  await timed('D    stream  +tools  ', new ChatOpenAI({ ...baseCfg, streaming: true }).bindTools([sampleTool]).invoke('门店有哪些需要重点关注？'));

  // E: 用 .stream() API 而非 invoke()，配置里 streaming 不设
  console.log('--- E: model.stream() AsyncIterator (streaming flag UNSET) ---');
  try {
    const t0 = Date.now();
    const it = await new ChatOpenAI(baseCfg).bindTools([sampleTool]).stream('门店有哪些需要重点关注？', { signal: AbortSignal.timeout(30000) });
    let chunkCount = 0;
    let accumulated = null;
    for await (const chunk of it) {
      chunkCount += 1;
      accumulated = accumulated ? accumulated.concat(chunk) : chunk;
    }
    console.log(`[OK] E .stream() unset      ${Date.now() - t0}ms chunks=${chunkCount} tool_calls=${(accumulated?.tool_calls || []).length} content=${String(accumulated?.content || '').slice(0, 60)}`);
  } catch (e) {
    console.log(`[FAIL] E .stream() unset    ${e.message}`);
  }

  // F: streaming:false 显式 + .stream()  ← 当前 nodes.js 的做法
  console.log('--- F: streaming:false + .stream() (current nodes.js) ---');
  try {
    const t0 = Date.now();
    const it = await new ChatOpenAI({ ...baseCfg, streaming: false }).bindTools([sampleTool]).stream('门店有哪些需要重点关注？', { signal: AbortSignal.timeout(30000) });
    let chunkCount = 0;
    let accumulated = null;
    for await (const chunk of it) {
      chunkCount += 1;
      accumulated = accumulated ? accumulated.concat(chunk) : chunk;
    }
    console.log(`[OK] F streaming:false      ${Date.now() - t0}ms chunks=${chunkCount} tool_calls=${(accumulated?.tool_calls || []).length} content=${String(accumulated?.content || '').slice(0, 60)}`);
  } catch (e) {
    console.log(`[FAIL] F streaming:false    ${e.message}`);
  }

  // G: streaming:true 显式 + .stream()  ← 真正想要的组合
  console.log('--- G: streaming:true + .stream() (target combo) ---');
  try {
    const t0 = Date.now();
    const it = await new ChatOpenAI({ ...baseCfg, streaming: true }).bindTools([sampleTool]).stream('门店有哪些需要重点关注？', { signal: AbortSignal.timeout(30000) });
    let chunkCount = 0;
    let accumulated = null;
    for await (const chunk of it) {
      chunkCount += 1;
      accumulated = accumulated ? accumulated.concat(chunk) : chunk;
    }
    console.log(`[OK] G streaming:true       ${Date.now() - t0}ms chunks=${chunkCount} tool_calls=${(accumulated?.tool_calls || []).length} content=${String(accumulated?.content || '').slice(0, 60)}`);
  } catch (e) {
    console.log(`[FAIL] G streaming:true     ${e.message}`);
  }

  process.exit(0);
})();
