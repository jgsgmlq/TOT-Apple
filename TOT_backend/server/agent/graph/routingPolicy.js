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
    L2_intent_fastpath: { max_super_steps: 1, tool_top_k: 2, max_repair_attempts: 1 },
    L3_fc_guarded:      { max_super_steps: 3, tool_top_k: 3, max_repair_attempts: 2 },
    L4_heavy_fc:        { max_super_steps: 5, tool_top_k: 5, max_repair_attempts: 3 }
  }
};

module.exports = RoutingPolicy;