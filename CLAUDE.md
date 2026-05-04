# TOT-Apple Project Guide (v7.0)

## Project Overview

TOT (Training On Track) is an AI-powered training management system for Apple Retail in Greater China. The core product is **Executive Chat** — a conversational AI assistant that lets VP/Regional Directors query training data in natural language.

- **Backend**: Node.js/Express + LangGraph.js + DeepSeek-Chat + SQLite
- **Frontend**: Vue 3 + Naive UI + Vite + ECharts
- **AI Architecture**: 3 Agent + 10 Node + 11 Tool + Prompt Registry + Decision Rules

## Directory Structure

```
TOT_backend/server/
  agent/graph/          LangGraph state machine
    nodes.js              All 3 agents + 10 nodes (~1700 lines)
    state.js              40+ state field definitions
    graph.js              StateGraph wiring + routing functions
    routingPolicy.js      Intent→Tool mapping, step calculation
    decisionRules.js      Business rules (8 categories, 15 functions)
  prompts/               Prompt Registry (centralized prompt management)
    registry.js            Loader, version check, template fill
    router.js              Router Agent prompt (v7.0)
    fc_agent.js            FC Agent prompt (v7.0, 5 segments)
    final_response.js      FRA prompt + MODIFIER_FORMATS + FewShot
  chat_tools/            11 active tools + 12 disabled old tools
  services/              Backend services
  db/                    SQLite database + seed data

TOT_frontend/src/
  views/executive/      Executive Chat UI + components
  types/chat.d.ts       ChartData type definition
```

## Startup

```bash
# Backend (port 3000)
cd TOT_backend/server && npm start

# Frontend (port 8001)
cd TOT_frontend && pnpm dev
```

Requires `DEEPSEEK_API_KEY` in `TOT_backend/.env`. Requires seed data: `cd TOT_backend/server && node db/seed.js`

## Agent Architecture (v7.0)

### 3 Agents

| Agent | Code | Model | Purpose |
|-------|------|-------|---------|
| **Router** | `nodes.js:contextAnalyzerRouter` | DeepSeek-Chat (t=0.1, 512t) | 3+8 intent classification |
| **FC Agent** | `nodes.js:fc_LlmToolCallStep` | DeepSeek-Chat Tool Calling (t=0.1, 2048t) | Tool orchestration |
| **FinalResponseAgent** | `nodes.js:finalResponseAgent` | DeepSeek-Chat JSON (t=0.3, 2000t) | headline + narrative output |

### Router Output (v7.0)

```json
{
  "main_intent": "chat_only | data_query | deny",
  "modifiers": { "needs_lookup": false, "needs_ranking": false, ... 8 bools },
  "risk_flags": false
}
```

No entities extraction — FC Agent understands user message directly.

### 8 Modifier Priority

`comparison > timeseries > ranking > distribution > funnel > analytics > detail > lookup`

lookup is infrastructure (auto-cleared after data arrives). Rest determine output format.

### Step Budget

```js
getMaxSteps(modifiers) = 2 (base) + comparison?(+1) + analytics?(+1) + 1 (buffer)
// Result: 3 / 4 / 5 steps
```

### HITL (Human-in-the-Loop) Trigger Policy

| Trigger | Behavior |
|---------|----------|
| listTasks + ranking + urgency signal | auto-select (pickUrgentTaskId) |
| listTasks + ranking + no urgency | HITL popup |
| listTasks + detail signal | Pass through (full list) |
| listTasks + no signal | HITL popup |
| Channel dim without L3/L4 specified | Code intercept → clarify text |
| SearchEntities ≥2 candidates | FC Agent text clarify |

### Clarification Round-Trip

When FC Agent outputs a clarifying question (`is_clarification=true`):
- FinalResponseAgent extracts the question, records `pending_clarification` with context (originalQuery, taskId, taskName)
- Next query: chatService reads checkpoint, rebuilds enriched userMessage with full context
- After data answer: `pending_clarification` cleared

### State Management (cross-query isolation)

- `toolResults`: cleared via `{__clear: true}` signal in inputState
- `chartPayload`: `y !== undefined ? y : x` reducer (null overrides old value)
- `pending_clarification`: cleared in inputState + data answers
- `is_clarification`: cleared in inputState
- `fc_super_step_count`: reset per query; reset to 0 on clarification
- `messages`: FC intermediate messages filtered from safeHistory (lastFinalIdx-based)

## 11 Tools (v7.0)

```
🔍 searchEntities       entityType*, keyword, limit
📊 queryMetrics          task_id*, metrics*, dimensions, time_start/end, sort_by/order
🏆 rank                  task_id*, metric*, dimension*, n*
📈 distribution          task_id*, metric*, bins*
🔀 compare               task_id*, metrics*, mode*, dimension, values | periods
📅 timeseries            task_id*, metric*, granularity*, time_start/end
🔽 funnel                task_id*, dimensions
🧪 analyze               task_id*, analysis_type*
📋 listRecords           entityType*, fields*, task_id*, store_ids, status, limit
📝 listTasks             无参数
💾 fetchData             task_id*, code?
```

### Dimension Mapping

```
channel_l3 = s.rtm     (Monobrand, Multibrand, Carrier)
channel_l4 = s.format  (MONO, Lifestyle, Mass Merchant, Campus)
dealer     = s.dealer_name
store      = s.id
```

Geographic region (华东/华南/华北) uses `s.region`, NOT channel_l3.

## Key Files

| File | Purpose |
|------|---------|
| `agent/graph/nodes.js` | 3 agents + 10 nodes |
| `agent/graph/decisionRules.js` | Centralized business rules (8 categories) |
| `agent/graph/graph.js` | LangGraph wiring + routing |
| `agent/graph/state.js` | 40+ state fields |
| `agent/graph/routingPolicy.js` | Intent→Tool, step calculation |
| `prompts/registry.js` | Prompt loader + template fill |
| `prompts/router.js` | Router prompt (v7.0) |
| `prompts/fc_agent.js` | FC Agent prompt (v7.0, 5 segments) |
| `prompts/final_response.js` | FRA prompt + MODIFIER_FORMATS + FewShot |
| `services/chatService.js` | SSE pipeline + clarification context rebuild |
| `services/chatIntentService.js` | Legacy intent classify (uses router.js prompt) |
| `services/chatToolsService.js` | Dynamic tool loading |
| `services/executiveMetricsQueryService.js` | 19 metrics Phase A/B |
| `chat_tools/tool_*.js` | 11 active tools |

## Known Issues & Gotchas

1. **build/ directory**: gitignored, restore via `git checkout 87e9771 -- TOT_frontend/build/`
2. **pnpm only**: Frontend uses pnpm, not npm
3. **port 8001**: Configured in `.env.development`
4. **Dimension confusion**: channel_l3 = s.rtm, NOT s.region
5. **State reducers**: `y !== undefined ? y : x` for nullable fields — `null` explicitly overrides
6. **isOverCap**: `(step+1) > maxSteps` (was `>=`, fixed)
7. **searchEntities tokenizer**: Latin-CJK mixed words (e.g., "MacBook培训") tokenized by `tokenizeMixedScript` in decisionRules.js with OR matching
8. **DeepSeek 400 errors**: Caused by orphan tool messages — mitigated by `cleanedMessages` filter in fc_LlmToolCallStep
9. **Resume tools**: listTasks removed from candidate tools after HITL resume (prevents step waste)
10. **Prompt tuning**: Edit `prompts/*.js` → bump version → restart. Do NOT edit prompts inline in nodes.js
