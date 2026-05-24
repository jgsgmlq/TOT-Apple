const { Worker } = require('bullmq');
const IORedis = require('ioredis');
const crypto = require('crypto');
const { nanoid } = require('nanoid');
const mysql = require('../../modules/common/db/mysql');
const { getMemoryModel } = require("../graph/llm");
const { SystemMessage } = require("@langchain/core/messages");
const { CallbackHandler } = require("langfuse-langchain");
const { loadAndRender } = require('../../prompts/loader');

const getLangfuseCallback = (sessionId) => {
  if (process.env.LANGFUSE_ENABLED !== 'true') return null;
  return new CallbackHandler({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    baseUrl: process.env.LANGFUSE_BASEURL || process.env.LANGFUSE_HOST,
    sessionId: sessionId,
    tags: ["langchain_node", "memory_worker"]
  });
};

// 确保能拿到 LLM 客户端用来做记忆抽取
const getMemoryLLM = () => getMemoryModel();

/**
 * 提取并写入中期记忆的后台 Worker
 */
async function startMemoryWorker() {
  const queueName = "MemoryIngestionQueue";
  const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: true,
    retryStrategy: () => null,
  });
  // 静默 ioredis 自身的 'error' 事件，否则它会抛 Unhandled error 把日志刷爆
  connection.on('error', () => undefined);
  try {
    await connection.connect();
  } catch (err) {
    console.warn(`[Queue Worker] Redis unavailable (${err?.code || err?.message || 'unknown'}); memory worker disabled`);
    try { connection.disconnect(); } catch (_) {}
    return null;
  }

  console.log(`[Queue Worker] 正在启动记忆消费集群，监听队列: ${queueName}`);

  const worker = new Worker(queueName, async job => {
    const event = job.data;
    console.log(`\n[Queue Worker] 收到记忆摄入事件: ${event.event_id}`);
    
    const { userId, userMessage, finalResponse } = event.payload;

    try {
      // 1. 调用大模型，判断这段对话是否有值得记录的新“事实/偏好”
      const prompt = loadAndRender('memory_extractor_v1', { userMessage, finalResponse });

      const llm = getMemoryLLM();
      const lfCallback = getLangfuseCallback(event.payload.sessionId);
      const invokeConfig = lfCallback ? { callbacks: [lfCallback] } : {};

      const res = await llm.invoke([
        new SystemMessage(prompt)
      ], invokeConfig);

      if (lfCallback) {
        // 由于 Worker 进程会一直挂起，手动 flush 确保实时上报
        await lfCallback.flushAsync().catch(() => {});
      }

      const rawText = res.content.trim();

      // 解析 memory JSON 或兼容旧格式
      let memoryItem;
      if (rawText && rawText !== "NONE") {
        try {
          memoryItem = JSON.parse(rawText);
        } catch (_) {
          memoryItem = { type: 'user', content: rawText };
        }

        if (memoryItem && memoryItem.content && memoryItem.content !== "NONE") {
          console.log(`[Queue Worker] 萃取记忆 [${memoryItem.type}]: ${memoryItem.content}`);

          const memoryHash = crypto
            .createHash('sha256')
            .update(memoryItem.content)
            .digest('hex');
          await mysql.run(
            `INSERT INTO user_memory (id, user_id, memory_hash, memory_type, content, confidence_score)
             VALUES (?, ?, ?, ?, ?, 0.7)
             ON DUPLICATE KEY UPDATE
               content = VALUES(content),
               confidence_score = VALUES(confidence_score),
               updated_at = NOW(3)`,
            [nanoid(), userId, memoryHash, memoryItem.type, memoryItem.content]
          );
          console.log(`[Queue Worker] 已成功写入 [${memoryItem.type}] 记忆.`);

      } else {
        console.log(`[Queue Worker] 对话无长尾价值，跳过。`);
      }
      }

    } catch (err) {
      console.error(`[Queue Worker] 处理记忆时报错:`, err);
      throw err; // throw 会触发 BullMQ 的重试退避机制
    }
  }, { connection });

  worker.on('failed', (job, err) => {
    console.error(`[Queue Worker] 任务 ${job.id} 最终执行失败:`, err);
  });

  return worker;
}

module.exports = { startMemoryWorker };

// 如果是通过 node 单独启动该脚本：
if (require.main === module) {
  require('dotenv').config({ path: '../../.env' });
  startMemoryWorker().catch(console.error);
}
