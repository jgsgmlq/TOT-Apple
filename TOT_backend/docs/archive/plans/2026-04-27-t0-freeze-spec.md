# T0 开发前冻结项规格说明

**文档状态**: 已冻结 (Frozen)
**更新日期**: 2026-04-27
**关联任务**: `2026-04-27-executive-chat-langgraph-implementation-task-list.md` T0 阶段

本文档定义了 Executive Chat 迁移到 LangGraph 的核心数据结构、路由策略阈值、事件契约以及发布回退标准。在核心代码开发（T1-T5）前，以下契约必须保持稳定。

---

## 1. 状态机基座：Checkpointer 选型

根据架构评审决策，**PoC 及生产环境的图状态中断与恢复（Checkpointer）选用 `Postgres Checkpointer`**。
*   **原因**：与现有 TOT-Apple 的系统数据库组件（关系型）一致，无需引入新缓存组件，降低运维复杂度，满足 `sessionId/thread_id` 维度的会话级图持久化要求。

## 2. 核心状态：ExecChatGraphState

采用**单层拍平 (Flattened)** 的状态机设计，避免深层嵌套导致的 TS Reducer 覆盖异常。

```typescript
import { BaseMessage } from "@langchain/core/messages";

export interface ExecChatGraphState {
  // === 基础会话与身份 ===
  sessionId: string;           // 会话 ID (对应 LangGraph 的 thread_id)
  userId: string;              // 用户 ID
  userMessage: string;         // 本次请求的原始文本

  // === 消息与工具上下文 ===
  messages: BaseMessage[];     // 对话历史与当前轮次生成的 LLM/Tool 消息
  toolResults: Record<string, any>; // 缓存本会话内的工具调用结果，键为工具名或签名
  
  // === 护栏与权限 ===
  regionScope: {               // 用户的权限域
    type: string;              // 例如 'national', 'regional', 'store'
    regions?: string[];
    rtm?: string | null;
  };
  tool_namespace: "executive_chat"; // 隔离命名空间

  // === Router 解析结果 ===
  intent: string;              // 'chat_only', 'deny', 'tool_action'
  safety: "allow" | "deny";    // 危险操作门控
  entities: Record<string, {   // 标准化后的实体槽位
    raw: string;
    canonical: string;
    confidence: number;
  }>;
  selected_tier: "L1_cache_hit" | "L2_intent_fastpath" | "L3_fc_guarded" | "L4_heavy_fc";

  // === 工具循环控制 (fc_*) ===
  fc_super_step_count: number; // 成功执行完 ExecuteTool 的完整大轮次
  fc_current_step: number;     // 细粒度的节点流转计数（防止无限循环）
  fc_repair_attempts: number;  // 参数修复重试次数

  // === 人在回路 (HITL) ===
  hitl_status: "idle" | "pending_interrupt" | "resumed";
  hitl_payload?: {             // 消歧挂起时的 payload
    type: "select" | "input" | "confirm";
    prompt: string;
    options?: Array<{ id: string; label: string; }>;
    resume_token?: string;
  };
}
```

## 3. 路由与前置护栏：ContextAnalyzerRouter I/O Schema

`ContextAnalyzerRouter` 是主链路的首个 LLM 调用节点（小模型/快模型），负责安全监工、意图识别与槽位提取。

**输入 (Input)**: `userMessage` (String) + 检索到的短期记忆 `recent_context` (String)。
**输出 (Output JSON Schema)**:
```json
{
  "type": "object",
  "properties": {
    "safety": {
      "type": "string",
      "enum": ["allow", "deny"],
      "description": "危险操作（写库/发邮件等）拦截"
    },
    "intent": {
      "type": "string",
      "enum": ["chat_only", "tool_action"],
      "description": "闲聊/无业务相关性为 chat_only，其余为 tool_action"
    },
    "entities": {
      "type": "object",
      "description": "从用户询问中提取的实体，若无则为空",
      "additionalProperties": {
        "type": "object",
        "properties": {
          "raw": { "type": "string" },
          "canonical": { "type": "string" },
          "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
        },
        "required": ["raw", "canonical", "confidence"]
      }
    },
    "complexity_score": {
      "type": "number",
      "description": "判定问题的复杂度，0-1之间",
      "minimum": 0,
      "maximum": 1
    }
  },
  "required": ["safety", "intent", "entities", "complexity_score"]
}
```

## 4. 路由策略与门限：RoutingPolicy 参数

控制请求走哪个层级的 FC 预算以及失败重试上限。

```javascript
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
```

## 5. 记忆异步写入：MemoryIngestRequested 事件

采用解耦设计，主请求结束后抛出事件，由 Worker 异步消费，不阻塞用户响应时间。
**生命周期管理**: 使用底层原生 TTL（如 Redis EX）自动过期 `mid_term`（中期，14天）记忆。

**事件 payload Contract**:
```json
{
  "event_id": "uuid-v4",               // 幂等键
  "event_type": "MemoryIngestRequested",
  "timestamp": "2026-04-27T10:00:00Z",
  "payload": {
    "userId": "string",
    "sessionId": "string",
    "userMessage": "string",           // 用户原始请求
    "finalResponse": "string",         // 机器人的最终回答
    "extractedFacts": ["string"],      // (可选) Router 或 FC 过程中发现的潜在事实
    "namespace_target": "mid_term",    // 写入目标：mid_term 或 long_term
    "ttl_seconds": 1209600             // 14天 TTL (用于 Redis EX)
  }
}
```

## 6. 质量防线：性能门槛冻结表

以下门槛作为发布 Go/No-Go 的刚性指标（基于用户决策）。

| 指标 | 目标值 (冻结) | 统计口径 | 数据来源 |
|---|---|---|---|
| **首 Token 时延 (TTFT)** | **< 2.5s** | P95 | Langfuse + APM |
| **端到端响应时延** | **< 12s** | P95 | 网关 / 接口监控 |
| 请求错误率 | < 1% | 5 分钟滑窗 | 服务日志 |
| Clarify/Resume 失败率 | < 2% | 发布后 24h | 业务埋点 |

## 7. “全量发布 + 版本回退” Runbook

**发布策略**: 一次性全量切流至 LangGraph 主链路，不维持运行时代码双栈双跑。

### 7.1 发布前检查 (Go/No-Go)
- [ ] Langfuse trace 接入完成，`executive_chat` 隔离标签验证通过。
- [ ] Postgres Checkpointer 表结构已在生产库应用（创建 `checkpoints` / `checkpoint_blobs` 等表）。
- [ ] 压测环境性能达标 (TTFT < 2.5s, P95 < 12s)。
- [ ] T3 安全护栏自动化测试用例 100% PASS。

### 7.2 发布执行 (Deploy)
- [ ] 按照 `deploy.sh` 进行标准容器替换/滚动升级。
- [ ] (可选) 开启 `DEBUG_LANGGRAPH=true` 在一台灰度 Pod 观察前 10 分钟日志。

### 7.3 回退准则与步骤 (Rollback)
**触发条件** (任意满足):
1. 主链路 E2E 失败率 > 5% 持续 3 分钟。
2. 出现核心工具安全越权漏洞 (如跨 Region 数据泄漏)。
3. TTFT P95 恶化至 4s 以上，导致大量用户取消请求。

**回退步骤** (纯版本回滚):
1. 执行旧版镜像覆盖/回滚命令: `kubectl rollout undo deployment/tot-backend` (或对应的 PM2 历史版本恢复指令)。
2. 观察 E2E 监控恢复至 1% 以内。
3. LangGraph 独占的 Postgres Checkpoint 表不需回滚，保留以供死信分析。
