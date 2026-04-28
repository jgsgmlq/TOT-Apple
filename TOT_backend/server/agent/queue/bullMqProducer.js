const crypto = require('crypto');
const { Queue } = require('bullmq');
const IORedis = require('ioredis');

/**
 * 抽象 Queue Producer 契约（T4 阶段真实落地）
 * 连接到 Redis 并使用真实的 BullMQ 实例
 */
class MemoryQueueProducer {
  constructor() {
    this.queueName = "MemoryIngestionQueue";
    this.isConnected = false;
    this.bullQueue = null;
    this.redisClient = null;
  }

  async connect() {
    if (this.isConnected) return;
    
    try {
      // 默认尝试连接本地 Redis，真实生产环境可通过环境变量覆盖
      const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
      this.redisClient = new IORedis(redisUrl, { 
        maxRetriesPerRequest: 1, 
        retryStrategy: () => null // 失败不重试，直接丢弃，防止 CI 被刷屏 
      });
      this.bullQueue = new Queue(this.queueName, { connection: this.redisClient });
      this.isConnected = true;
      console.log(`[Queue] Connected to BullMQ (${this.queueName})`);
    } catch (err) {
      console.error(`[Queue] Failed to connect to BullMQ:`, err);
    }
  }

  /**
   * 发布 MemoryIngestRequested 事件 (Producer 接口)
   * 遵循 2026-04-27-t0-freeze-spec.md 冻结的事件结构
   */
  async publishMemoryIngestion(payload) {
    if (!this.isConnected) {
      // 如果还没连上，就主动连一次
      await this.connect();
    }

    if (!this.isConnected || !this.bullQueue) {
      console.warn(`[Queue] Warning: Queue not connected. Event will be dropped.`);
      return null;
    }

    const event = {
      event_id: crypto.randomUUID(),
      event_type: "MemoryIngestRequested",
      timestamp: new Date().toISOString(),
      payload: {
        userId: payload.userId,
        sessionId: payload.sessionId,
        userMessage: payload.userMessage,
        finalResponse: payload.finalResponse,
        extractedFacts: payload.extractedFacts || [],
        namespace_target: "mid_term",
        ttl_seconds: 1209600 // 14天 TTL (对于 Redis EX 友好)
      }
    };

    // 生产环境中 Fire & Forget：将任务加入真正的 BullMQ 队列
    try {
      await this.bullQueue.add('ingest', event, { 
        removeOnComplete: true, // 完成后清理
        removeOnFail: false,    // 失败保留以便排查死信
        attempts: 3,            // 失败重试次数
        backoff: { type: 'exponential', delay: 2000 } // 退避策略
      });
      console.log(`[Queue Producer] 成功发布异步记忆任务: ${event.event_id}`);
    } catch (e) {
      console.error(`[Queue Producer] 发布记忆任务失败:`, e);
    }

    return event.event_id;
  }
}

// 导出单例
const memoryQueueProducer = new MemoryQueueProducer();
module.exports = { memoryQueueProducer, MemoryQueueProducer };