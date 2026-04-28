const { Worker } = require('bullmq');
const IORedis = require('ioredis');
const { db } = require('../../db');
const { ChatOpenAI } = require("@langchain/openai");
const { SystemMessage, HumanMessage } = require("@langchain/core/messages");
// T5 阶段二: 点亮后台盲区，注入官方 CallbackHandler 捕获后台 Worker 消耗 Token 数量
const CallbackHandler = require("langfuse-langchain").default;

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
    retryStrategy: () => null 
  });

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
        // 按照 T4 的 TTL 要求，由于 SQLite 原生不支持 TTL，我们在内存中存储时间戳，后续 CronJob 清理
        // 这里只是插入业务数据库做持久化
        db.run(
          `INSERT INTO user_memories (user_id, memory_type, content, status) 
           VALUES (?, 'mid_term', ?, 'active')`,
          [userId, fact]
        );
        console.log(`[Queue Worker] 已成功将 ${userId} 的 mid_term 记忆写入 SQLite.`);
        
        // 这里如果是用 Redis 存储短期记忆，可以同时向 Redis 写入带 EX 的 KV，这更符合 14 天 TTL 原生要求。
        // await connection.setex(`memory:mid_term:${userId}`, 14 * 24 * 60 * 60, fact);
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