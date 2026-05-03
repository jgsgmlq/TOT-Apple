'use strict';

const { withRetry } = require('../utils/ai');

async function main() {
  let attempts = 0;
  try {
    await withRetry(async () => {
      attempts++;
      if (attempts < 3) throw Object.assign(new Error('DeepSeek API Failed: 503'), { status: 503 });
      return 'success';
    }, 2);
    console.log(`✅ 重试成功，共尝试 ${attempts} 次（预期 3）`);
  } catch (e) {
    console.error('❌ 意外失败:', e.message);
  }

  attempts = 0;
  try {
    await withRetry(async () => {
      attempts++;
      throw new Error('DEEPSEEK_API_KEY is not set');
    }, 2);
  } catch (e) {
    console.log(`✅ API Key 错误不重试，尝试 ${attempts} 次（预期 1）：${e.message}`);
  }
}

main().catch(console.error);
