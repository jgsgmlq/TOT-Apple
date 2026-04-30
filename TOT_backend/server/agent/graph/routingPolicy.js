'use strict';

/**
 * 根据 `t0-freeze-spec.md` 约定的 RoutingPolicy 定义
 * 为 Executive Chat 提供动态的复杂度门限与 FC 循环预算配置
 */
const RoutingPolicy = {
  // 阈值定义
  thresholds: {
    ner_confidence: 0.85,           // 实体置信度底线，低于此值需触发 Clarify
    complexity_score_l2_max: 0.35,  // <=0.35 走 L2 快路径
    complexity_score_l4_min: 0.70,  // >=0.70 走 L4 增强 FC
    topk_min_score: 0.60            // Tool 检索最低相关性分数
  },
  
  // 各档位执行参数约束
  tiers: {
    // max_super_steps 给 3 而不是 2：2 步等于 LLM 选 1 个工具就立刻被强制总结，
    // 中间没有补调第二个工具的空间。一旦 LLM 第一步选错工具或单工具数据不够，
    // 就只能输出"我无法访问数据"兜底。3 步给一次纠错/补调机会，代价是多 1 次 LLM 调用。
    L2_intent_fastpath: { max_super_steps: 3, tool_top_k: 2, max_repair_attempts: 1 },
    L3_fc_guarded:      { max_super_steps: 4, tool_top_k: 3, max_repair_attempts: 2 },
    L4_heavy_fc:        { max_super_steps: 6, tool_top_k: 5, max_repair_attempts: 3 }
  }
};

module.exports = RoutingPolicy;