'use strict';
require('dotenv').config({ path: '../.env' });

async function main() {
  console.log('1. 检查 E2B_API_KEY:', process.env.E2B_API_KEY ? '已配置' : '❌ 未配置');

  if (!process.env.E2B_API_KEY) {
    console.log('❌ 请在 TOT_backend/.env 中设置 E2B_API_KEY');
    process.exit(1);
  }

  console.log('2. 连接 E2B 沙盒...');
  const { Sandbox } = require('@e2b/code-interpreter');

  let sb;
  try {
    sb = await Sandbox.create({ timeoutMs: 30_000 });
    console.log('✅ 沙盒创建成功, id:', sb.sandboxId);

    console.log('3. 执行 Python 测试...');
    const r = await sb.runCode('print(1 + 1)');
    const stdout = (r.logs?.stdout || []).join('').trim();
    console.log('   输出:', stdout === '2' ? '✅ 1+1=2' : `❌ 预期2, 实际: ${stdout}`);

  } catch (e) {
    console.error('❌ 沙盒测试失败:', e.message);
    if (e.message.includes('401') || e.message.includes('UNAUTHORIZED')) {
      console.error('   → API Key 无效，请去 https://e2b.dev 重新申请');
    }
  } finally {
    if (sb) {
      await sb.kill().catch(() => {});
      console.log('4. 沙盒已销毁');
    }
  }
}

main();
