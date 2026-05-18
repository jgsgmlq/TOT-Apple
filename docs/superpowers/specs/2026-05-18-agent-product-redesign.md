# Agent 产品重构设计

> 2026-05-18 | 分支: macstudio | 仓库: TOT-Apple
> 从 AIPM 视角审视当前 Agent，提出产品层改进方案

## 1. 问题诊断

当前 Agent 存在以下产品层问题：

| 问题 | 根因 | 影响 |
|------|------|------|
| 意图分类与工具不对齐 | Router 6 分类按"问题类型"组织，新工具按"数据操作"组织 | Router 分类错误 → 工具池不对 → 回复失败 |
| FC 循环过重 | 8 个节点 + 3 层修复（repair→HITL→finalize） | 延迟高、维护成本高 |
| ToolRetrieve 不必要 | BM25 筛选工具候选池 | 额外节点，8 个工具区分度已足够 LLM 直接选 |
| Router 不做歧义检测 | 模糊问题直接进 FC 循环 | 多轮无效 tool call 后才追问 |
| tier 系统闲置 | L2/L3/L4 分级依赖 intent，intent 已废 | 死代码 |
| 回复格式单一 | 纯 markdown，图表靠 ` ```echarts ` 嵌入 | 前端无法分别渲染数据/图表/洞察 |

## 2. 目标架构

```
LoadContext → SafetyGateway → FC 循环(5节点) → FinalResponse → PersistAndEmit
                │  3 mode                       │  JSON 结构化输出
                │  实体提取                       │  { data, charts, insights }
                │  歧义检测 → HITL 追问
```

### 2.1 删除的节点和文件

| 删除 | 原因 |
|------|------|
| `contextAnalyzerRouter.js` | 替换为 SafetyGateway |
| `toolRetrieve.js` + `toolRetriever.js` | BM25 工具筛选不需要，8 工具全量给 FC LLM |
| `fc_ValidateParams.js` | 工具 handler 自己校验，FC LLM 看 error 自行修正 |
| `fc_ParamRepair.js` | FC LLM 比规则修复更聪明 |
| `routingPolicy.js` | tier 系统废弃 |
| `decisionRules.js` | 只剩 correctMode，移入 SafetyGateway |
| `INTENT_TOOL_MAP` / `INTENT_ALIAS_MAP` | 不再需要意图映射 |
| state.js 中以下字段 | `tool_namespace`、`selected_tier`、`candidateTools`、`fc_repair_attempts`、`repair_error_reason` |

### 2.2 新增的节点和文件

| 新增 | 职责 |
|------|------|
| `nodes/safetyGateway.js` | 3 mode 分类 + 实体提取 + 歧义检测 |
| `nodes/fc_Escalate.js` | 参数修正失败时 HITL 追问 |

### 2.3 修改的文件

| 文件 | 改动 |
|------|------|
| `state.js` | 加 extracted 实体 + ambiguity + escalate 字段 |
| `graph.js` | 新节点注册 + 新路由条件边 |
| `nodes/fc_LlmToolCallStep.js` | 8 工具全给，system prompt 注入 extracted 实体 |
| `nodes/fc_CheckSteps.js` | 固定 max_rounds=3 |
| `prompts/` | router.js→safetyGateway.js，更新 fc_agent.js |
| chat_tools/8 个 handler | description 加触发场景（不改 handler 逻辑） |

## 3. SafetyGateway 设计

### 3.1 Schema

```typescript
const SafetyGatewayOutput = z.object({
  mode: z.enum(["chat", "tool", "deny"]),

  extracted: z.object({
    task_ref: z.string().nullable(),
    org_ref: z.string().nullable(),
    org_type: z.enum(["region","store","dealer","l3","l4"]).nullable(),
    time_ref: z.string().nullable(),
  }),

  ambiguity: z.object({
    type: z.enum(["missing_task_ref","vague_task_ref","missing_context"]),
    description: z.string(),
    question: z.string(),
    candidates: z.array(z.object({
      id: z.string(),
      label: z.string(),
      value: z.string(),
    })).optional(),
  }).nullable(),

  reason: z.string(),
});
```

### 3.2 System Prompt 要点

- mode 判断：chat（闲聊/确认语）、tool（取数请求）、deny（危险操作/注入）
- 实体提取：只提取 task_ref、org_ref(+type)、time_ref，提取不到填 null，不编造
- 歧义检测：纯规则判断（missing_task_ref / vague_task_ref / missing_context），不用 LLM 自评置信度

### 3.3 分流逻辑

```
mode=deny  → FinalResponse（拒绝文案）
mode=chat  → FinalResponse（闲聊回复）
mode=tool + ambiguity=null  → FC 循环
mode=tool + ambiguity 存在   → HITL interrupt（追问 + 候选）
```

## 4. FC 循环设计

### 4.1 简化为 5 节点

```
fc_CheckSteps → fc_LlmToolCall → fc_CheckDuplicate → fc_ExecuteTool → fc_MergeToolResults
                    ↑                                                        │
                    └────────────── 循环（max 3 轮）──────────────────────────┘

fc_Escalate：参数修正失败 1 次后触发，HITL 追问用户
```

### 4.2 核心规则

- 固定 3 轮，超出强制总结
- 并行 tool_calls 不占额外轮数
- 工具 param error：FC LLM 有 1 次修正机会。第二轮还错 → fc_Escalate
- `MAX_FC_ROUNDS` 环境变量可调
- 8 个工具全量给 FC LLM，不做预筛选

## 5. 工具集成（留白）

### 5.1 工具接口约定

每个工具需提供以下接口，后续 V0.3 封装时按此填写：

```typescript
interface Tool {
  schema: {
    type: "function",
    function: {
      name: string,           // e.g. "get_task_dashboard"
      description: string,    // 含触发场景的一句话描述
      parameters: JSONSchema  // OpenAI function calling 格式
    }
  };
  meta: {
    enabled: boolean,
    requiredRole: string[],
    scopePolicy: string,
    timeoutMs: number
  };
  handler: (args, regionScope) => Promise<ToolResult>;
}

interface ToolResult {
  success?: boolean;
  error?: { code: string; message: string };
  // ... 工具特定数据字段
}
```

### 5.2 8 个工具的 description 路由表

| 工具 | description（触发场景） |
|------|----------------------|
| `get_task_dashboard` | 查询单个任务的全景数据（指标、漏斗、预警）。当用户指定了某个具体任务时使用 |
| `list_task_progress` | 批量查询多个任务的进度摘要。当用户问"有哪些任务""哪些比较紧急"时使用 |
| `query_metric` | 按维度查询指标值，支持 Top/Bottom N 排序。当用户问排名、对比、按维度下钻时使用 |
| `query_trend` | 查询某任务指标的时间序列。当用户问"每天怎么变""趋势"时使用 |
| `funnel_analysis` | 查询任务完成漏斗或预警催办漏斗。当用户问"各阶段流失""转化率"时使用 |
| `fetch_incomplete_persons` | 获取未完成人员名单。当用户问"谁还没完成""把名单给我"时使用 |
| `fetch_alert_persons` | 获取预警人员名单。当用户问"P0的有哪些人"时使用 |
| `search_task` | 按条件搜索任务元数据。当用户想查找任务但不确定具体名称时使用 |

> **注意**：工具 handler 具体实现待 V0.3 封装，当前保留旧 chat_tools/ 不动。

## 6. FinalResponse 结构化输出

### 6.1 设计原则

- **继承前端已有布局**：当前前端 `executive/index.vue:274-354` 已有一套成熟的回复卡片排版，新格式是对它的渐进升级，不是重写
- **支持渐进解析**：前端 `parseReplyContentProgressive()` 能从半截 JSON 提取已完整字段，新格式需保持流式友好
- **字段名对齐**：尽量复用前端现有的 `ReplyContent` 字段名，减少前端改动量

### 6.2 输出 JSON schema

```json
{
  "type": "structured_response",

  "overview": "iPhone 17 新品培训整体完成率 85%，华东大区表现最优。华南区完成率 72% 需关注。",

  "keyNumbers": [
    { "label": "总人数", "value": 1200, "unit": "人" },
    { "label": "完成率", "value": "85", "unit": "%" },
    { "label": "P0 预警", "value": "12", "unit": "人" }
  ],

  "table": {
    "title": "各区域完成率排名",
    "columns": ["区域", "完成率", "P0人数", "P1人数"],
    "rows": [
      ["华东", "85%", 12, 45],
      ["华南", "72%", 28, 67]
    ],
    "highlight": { "column": "完成率", "top": 3, "bottom": 3 }
  },

  "charts": [
    {
      "type": "bar",
      "title": "各区域完成率对比",
      "option": { /* ECharts option */ }
    }
  ],

  "insights": [
    { "level": "warning", "text": "华南区完成率 72%，低于整体 13 个百分点" },
    { "level": "warning", "text": "华南区 P0 人数 28 人，距截止只剩 24h" },
    { "level": "info", "text": "华东区预警催办转化率 62%，催办效果显著" }
  ],

  "suggestions": [
    "查看华南区未完成人员名单",
    "对比上周同期完成率趋势"
  ],

  "statisticsProvenance": {
    "统计口径": "按任务发放覆盖的总人数为分母",
    "数据截止": "2026-05-18 14:30",
    "预警定义": "P0=距ddl 24h, P1=距ddl 48h, P2=距ddl 一半时间"
  },

  "forecastDisclaimer": null
}
```

### 6.3 字段与前端对齐

| 字段 | 旧 ReplyContent | 新格式 | 前端改动 |
|------|----------------|--------|---------|
| 摘要 | `overview` | `overview` | **无** |
| 指标卡片 | `keyNumbers: {label,value,unit}[]` | `keyNumbers` | **无** |
| 表格 | 无 | `table` ← **新增** | 加 `TableSection` 组件 |
| 图表 | `visualizations` (裸数组) | `charts: {type,title,option}[]` | 改名 + 加 type/title |
| 洞察 | `attentionPoints` (平铺 string[]) | `insights: {level,text}[]` | 原样可用 level 加图标 |
| 追问 | `followUpSuggestions` | `suggestions` | 极小 |
| 溯源 | `statisticsProvenance` | `statisticsProvenance` | **无** |
| 免责 | `forecastDisclaimer` | `forecastDisclaimer` | **无** |

### 6.4 排版层级（前端渲染顺序）

借鉴当前前端 `executive/index.vue` 的卡片布局：

```
Section 1: thinking           ← 思考过程（可折叠，流式时实时显示）
Section 2: overview           ← 顶部摘要段落（先给结论）
Section 3: charts[]           ← 图表（对比/趋势/漏斗，AiChartRenderer）
Section 4: keyNumbers[]       ← 指标卡片行（label/value/unit 键值对）
Section 5: table              ← 表格块（排名/明细/名单，新增）
Section 6: insights[]         ← 洞察列表（warning=红色警示, info=蓝色补充）
Section 7: suggestions[]      ← 追问建议按钮（可点击直接发送）
Section 8: statisticsProvenance ← 数据溯源（折叠展示）
```

### 6.5 FinalResponseStep 逻辑

```
FC 循环结束 → toolResults
    │
    ▼
如果 mode=deny：直接生成拒绝文案
如果 mode=chat_only：调用闲聊 LLM 生成自然回复
    │
    ▼
如果 mode=tool：
  调用 FinalResponse LLM（不带工具，withStructuredOutput）：
    输入：原始问题 + toolResults + extracted 实体
    输出：严格按 6.2 schema 的 JSON
    │
    ▼
  落库 content 字段（JSON string），前端渲染分 8 个 section
```

### 6.6 FinalResponse LLM System Prompt 要点

- 严格输出指定 JSON schema，不要额外文字或 markdown 包裹
- `overview`：1-3 句话给结论，先回答用户最关心的问题
- `keyNumbers`：提取 3-6 个最关键的 KPI，label 中文简洁
- `table`：有排名/对比/名单数据时使用，无则 null
- `charts`：有意义的对比/趋势/分布才生成，不画无意义图
- `insights`：每条带 `level`（warning=需要管理者关注, info=补充信息），避免空洞的泛泛而谈
- `suggestions`：2-3 个自然的下一个问题，引导用户继续探索
- `statisticsProvenance`：说明口径定义和截止时间，帮助用户理解数据

## 7. state.js 变更

```diff
- tool_namespace
- selected_tier
- candidateTools
- fc_repair_attempts
- repair_error_reason

+ extracted_task_ref
+ extracted_org_ref
+ extracted_org_type
+ extracted_time_ref
+ ambiguity_payload        // null | { type, question, candidates }
+ escalate_count           // fc_Escalate 触发次数
```

## 8. 实施阶段

### Phase A: 删死代码
- 删 ToolRetrieve、ValidateParams、ParamRepair、BM25 相关
- 删 routingPolicy、decisionRules
- 更新 graph.js 节点注册
- 更新 state.js 字段

### Phase B: SafetyGateway
- 新建 nodes/safetyGateway.js（含 correctMode 逻辑）
- 新建 prompts/safetyGateway.js
- 注册 HITL 分流路径

### Phase C: FC 循环精简
- fc_CheckSteps 固定 max=3
- fc_LlmToolCall 8 工具全给 + extracted 实体注入
- 新建 fc_Escalate

### Phase D: FinalResponse 结构化
- 新建 FinalResponse LLM prompt
- 修改 finalResponseStep 输出 JSON
- 前端联调（改动大，另开 plan）

### Phase E: 测试更新
- 更新 routing.test.js
- 新增 safetyGateway.test.js
- 更新 graph.test.js

## 9. 验证标准

- [ ] SafetyGateway 3 分类准确率达到业务要求
- [ ] 歧义检测在模糊输入时触发 HITL
- [ ] FC 循环不超过 3 轮
- [ ] FinalResponse 输出合法 JSON { data, charts, insights, suggestions }
- [ ] npm test 全部通过
- [ ] 新旧工具 handler 都能加载
