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
    // Redis 连不上时，只在第一次警告，避免每次请求都吐三段 stack 淹没日志
    this._unavailableWarned = false;
    this._connectPromise = null;
  }

  async connect() {
    if (this.isConnected) return;
    if (this._connectPromise) return this._connectPromise;

    this._connectPromise = (async () => {
      try {
        const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
        this.redisClient = new IORedis(redisUrl, {
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          lazyConnect: true,
          retryStrategy: () => null,
        });
        // 静默 ioredis 自身的 'error' 事件，否则它会 process-wide 抛 Unhandled error
        this.redisClient.on('error', () => undefined);
        await this.redisClient.connect();
        this.bullQueue = new Queue(this.queueName, { connection: this.redisClient });
        this.isConnected = true;
        console.log(`[Queue] Connected to BullMQ (${this.queueName})`);
      } catch (err) {
        if (!this._unavailableWarned) {
          console.warn(`[Queue] Redis unavailable (${err?.code || err?.message || 'unknown'}); memory ingestion will be silently dropped`);
          this._unavailableWarned = true;
        }
        try { this.redisClient?.disconnect(); } catch (_) {}
        this.redisClient = null;
      } finally {
        this._connectPromise = null;
      }
    })();
    return this._connectPromise;
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
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 }
      });
      console.log(`[Queue Producer] 成功发布异步记忆任务: ${event.event_id}`);
    } catch (e) {
      // 同样静默：连接已断开 / Redis 暂不可用，不再吐 stack
      if (!this._unavailableWarned) {
        console.warn(`[Queue Producer] publish failed (${e?.code || e?.message || 'unknown'}); subsequent failures silenced`);
        this._unavailableWarned = true;
      }
    }

    return event.event_id;
  }
}

// 导出单例
const memoryQueueProducer = new MemoryQueueProducer();
module.exports = { memoryQueueProducer, MemoryQueueProducer };