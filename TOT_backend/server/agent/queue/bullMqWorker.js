const { Worker } = require('bullmq');
const IORedis = require('ioredis');
const crypto = require('crypto');
const { nanoid } = require('nanoid');
const { db } = require('../../db');
const { ChatOpenAI } = require("@langchain/openai");
const { SystemMessage } = require("@langchain/core/messages");
// T5 阶段二: 点亮后台盲区，注入官方 CallbackHandler 捕获后台 Worker 消耗 Token 数量
const { CallbackHandler } = require("langfuse-langchain");

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
const getMemoryLLM = () => new ChatOpenAI({
  modelName: "deepseek-chat",
  apiKey: process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: process.env.DEEPSEEK_API_BASE_URL || "https://api.deepseek.com/v1"
  },
  temperature: 0.1,
  maxTokens: 512
});

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
      const prompt = `You are a memory extractor. Analyze the user's latest message and the bot's response.
Extract any mid-term preference or explicit fact the user mentioned (e.g. "I only care about region X", "focus on product Y").
If nothing is worth saving, output exactly "NONE". Otherwise, output a concise 1-sentence fact.
User Message: "${userMessage}"
Bot Response: "${finalResponse}"`;

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

      const fact = res.content.trim();
      
      // 如果大模型觉得有必要记下来
      if (fact && fact !== "NONE") {
        console.log(`[Queue Worker] 萃取到新事实: ${fact}`);

        // 2. 真实落库 (向现有的 user_memories 表写入)
        // 表 schema：id (PK NOT NULL) / user_id / memory_hash (NOT NULL, UNIQUE(user_id, memory_hash))
        // / memory_type (default 'bias') / content (NOT NULL) / confidence_score (default 0.5)
        // / created_at / updated_at（DB 默认）。
        const memoryHash = crypto
          .createHash('sha256')
          .update(`${userId}|${fact}`)
          .digest('hex');
        db.run(
          `INSERT INTO user_memories (id, user_id, memory_hash, memory_type, content, confidence_score)
           VALUES (?, ?, ?, 'fact', ?, 0.7)
           ON CONFLICT(user_id, memory_hash) DO UPDATE SET
             content = excluded.content,
             confidence_score = excluded.confidence_score,
             updated_at = datetime('now', 'localtime')`,
          [nanoid(), userId, memoryHash, fact]
        );
        console.log(`[Queue Worker] 已成功将 ${userId} 的 fact 记忆写入 SQLite.`);

      } else {
        console.log(`[Queue Worker] 对话无长尾价值，跳过。`);
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
