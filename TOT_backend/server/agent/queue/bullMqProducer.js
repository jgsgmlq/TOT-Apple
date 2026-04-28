const crypto = require('crypto');

/**
 * 抽象 Queue Producer 契约（T4 阶段先行）
 * 真实环境中，这将连接到 Redis 和真实的 BullMQ 实例
 */
class MemoryQueueProducer {
  constructor() {
    this.queueName = "MemoryIngestionQueue";
    this.isConnected = false;
    // PoC 期使用内存数组暂存，后期替换为 bullmq 的 queue 实例
    this.mockStore = [];
  }

  async connect() {
    // 模拟连接 Redis
    this.isConnected = true;
    console.log(`[Queue] Connected to BullMQ (${this.queueName})`);
  }

  /**
   * 发布 MemoryIngestRequested 事件 (Producer 接口)
   * 遵循 2026-04-27-t0-freeze-spec.md 冻结的事件结构
   */
  async publishMemoryIngestion(payload) {
    if (!this.isConnected) {
      console.warn(`[Queue] Warning: Queue not connected, but attempting to publish.`);
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

    // 生产环境中这里将是: await this.bullQueue.add('ingest', event, { removeOnComplete: true });
    // T4 模拟：由于是 Fire & Forget，不抛错，直接扔进 mockStore
    this.mockStore.push(event);
    
    // 我们用 setTimeout 来模拟异步 worker 消费的延迟，不阻塞主线程
    setTimeout(() => {
      console.log(`\n[Queue Worker Mock] 异步消费 Memory 事件: ${event.event_id}`);
      console.log(`[Queue Worker Mock] 提取到的事实将落库并设置 14 天过期...`);
    }, 500);

    return event.event_id;
  }
}

// 导出单例
const memoryQueueProducer = new MemoryQueueProducer();
module.exports = { memoryQueueProducer, MemoryQueueProducer };