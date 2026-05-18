# LangGraph Agent 重构设计

> 2026-05-18 | 分支: macstudio | 仓库: TOT-Apple

## 目标

重构 `agent/graph/` 层，修复 macstudio 分支的工程问题，保留 LangGraph 架构和业务逻辑不变。

## 范围

| 改 | 不改 |
|----|------|
| nodes.js 拆分 14 文件 | chat_tools/ 20 个 handler |
| 新增 llm.js 单例 | chatService.js 业务逻辑 |
| 新增 __tests__/ | renderers.js / decideChart.js |
| 删除 chatAgentRunner.js | state.js / graph.js 结构 |
| chatService 只引 buildGraph | 前端 / 路由 / 权限 |

---

## 1. 目录结构

```
agent/graph/
├── state.js
├── graph.js
├── llm.js              ← 新增：ChatOpenAI 单例
├── nodes/
│   ├── loadContext.js
│   ├── contextAnalyzerRouter.js
│   ├── toolRetrieve.js
│   ├── fc_CheckSteps.js
│   ├── fc_LlmToolCallStep.js
│   ├── fc_CheckDuplicate.js
│   ├── fc_ValidateParams.js
│   ├── fc_ParamRepair.js
│   ├── fc_ExecuteTool.js
│   ├── fc_MergeToolResults.js
│   ├── humanInTheLoopGate.js
│   ├── finalResponseStep.js
│   └── persistAndEmit.js
├── shared/             ← 新增：跨节点共享工具
│   ├── spanHelper.js   ← startNodeSpan
│   ├── memoryBlock.js  ← renderMemoryBlock
│   └── entities.js     ← flattenEntitiesForRepair
├── routingPolicy.js
├── decisionRules.js
├── toolRetriever.js
├── toolCallUtils.js
├── intents.js
├── renderers.js
├── decideChart.js
└── __tests__/
    ├── graph.test.js
    ├── router.test.js
    └── fcLoop.test.js
```

---

## 2. 关键变更

### 2.1 nodes.js 拆分 (1580 行 → 14 文件)

每个节点一个文件，导出 `async function(state, config)`。共享逻辑抽到 `shared/`:

- `startNodeSpan` → `shared/spanHelper.js`
- `renderMemoryBlock` → `shared/memoryBlock.js`
- `flattenEntitiesForRepair` → `shared/entities.js`

### 2.2 llm.js — ChatOpenAI 单例

```js
const { ChatOpenAI } = require("@langchain/openai");

const routerModel = new ChatOpenAI({
  modelName: "deepseek-chat",
  temperature: 0.1,
  maxTokens: 512,
  // ...
});

const fcModel = new ChatOpenAI({
  modelName: "deepseek-chat",
  temperature: 0.1,
  maxTokens: 2048,
  streaming: true,
});

function getLlmWithTools(candidateTools) { /* bindTools 逻辑 */ }

module.exports = { routerModel, fcModel, getLlmWithTools };
```

### 2.3 Router 用 withStructuredOutput

```js
// 替代正则剥 ```json```
const { z } = require("zod");
const RouterOutput = z.object({
  mode: z.enum(["chat_only", "tool_action", "deny"]),
  intent: z.string(),
  entities: z.record(z.any()).optional(),
  entities_confidence: z.record(z.number()).optional(),
  complexity_score: z.number().optional(),
  risk_flags: z.boolean().optional(),
});

const structuredRouter = routerModel.withStructuredOutput(RouterOutput);
const parsed = await structuredRouter.invoke(messages);
```

### 2.4 删除 chatAgentRunner.js

- chatService.js 删除 `require('./chatAgentRunner')`
- 删除 `AGENT_MODE` 环境变量判断
- `sendMessage` / `sendMessageStream` 统一走 `buildGraph()`

### 2.5 SSE 流式改进（M2）

stream 方式保持现有 `graph.invoke()` + sseEmitter（M1 不动 SSE 协议，避免前后端联调风险），M2 再切 `graph.stream()`。

### 2.6 测试

```js
// __tests__/graph.test.js
const { buildGraph } = require("../graph");
const { MemorySaver } = require("@langchain/langgraph");

test("闲聊模式直接走到 FinalResponseStep", async () => {
  const app = buildGraph().compile({ checkpointer: new MemorySaver() });
  const result = await app.invoke({
    userMessage: "你好",
    sessionId: "test-1",
    messages: [],
  });
  expect(result.mode).toBe("chat_only");
});

test("华东区查询触发 drill_down 意图", async () => {
  const app = buildGraph().compile({ checkpointer: new MemorySaver() });
  const result = await app.invoke({
    userMessage: "华东区完成率最低的5家门店",
    sessionId: "test-2",
    messages: [],
  });
  expect(result.intent).toBe("drill_down");
  expect(result.candidateTools).toContain("getRegionDetailData");
});
```

---

## 3. 实施步骤

### Step 1: 拆分 nodes.js（零逻辑变更）

1. 创建 `agent/graph/nodes/` 和 `agent/graph/shared/`
2. 每个节点提取到独立文件
3. 共享 helper 抽到 shared/
4. 更新 `graph.js` 的 import 路径
5. 运行现有 mockTest 确认无回归

### Step 2: 标准化改进

1. 创建 `llm.js`，迁移 model 实例化
2. Router 接入 `withStructuredOutput`
3. 删除 `chatAgentRunner.js` 和 `AGENT_MODE`
4. 更新 `chatService.js` import

### Step 3: 测试

1. 配置 Jest
2. 写 graph 级别测试（MemorySaver）
3. 写 Router 单元测试
4. 写 FC 循环集成测试

---

## 4. 验证标准

- [ ] 所有节点在独立文件中，每个 < 200 行
- [ ] `npm test` 通过，覆盖率 > 80%
- [ ] 现有 mockTest 全部通过
- [ ] chatService 只有 buildGraph 一个 agent 入口
- [ ] 无 chatAgentRunner 引用
- [ ] llm.js 单例，无重复 new ChatOpenAI
