# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

TOT (Training On Track) — Apple retail training task management system. Monorepo: Express backend + Vue 3 frontend. Currently undergoing module-based refactoring (`modular-base` branch).

See `TOT_backend/CLAUDE.md` for additional backend-specific rules. The Cursor skill at `.cursor/skills/tot-apple-context-first/SKILL.md` enforces a document-first workflow for non-trivial changes.

## Commands

### Backend (`TOT_backend/server/`)

```bash
npm run dev          # Start with --watch (auto-restart on changes), port 3000
npm run seed         # Reset + seed database (must run from server/ dir)
npm start            # Start without watch
```

### Frontend (`TOT_frontend/`)

```bash
pnpm run dev         # Vite dev server, port 8001
pnpm run build       # Production build
pnpm run lint:eslint # ESLint fix
```

### Quick test

```bash
curl http://localhost:3000/api/health           # Heartbeat
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"central","password":"Train2026!"}' | ...)
```

## Architecture

### Backend layers

```
routes/          → Thin handlers, auth middleware, call services
services/        → Business logic (chatAgentRunner, autoNudge, etc.)
modules/         → Refactored domain modules (see below)
db/              → SQLite connection + schema.sql + seed.js
agent/           → AI agent framework (skill registration, LangGraph graph)
chat_tools/      → LangGraph tool implementations for Executive Chat
ws/              → WebSocket manager (role-based broadcast, TTS realtime)
jobs/            → Cron-style schedulers (autoNudge, dashboardAgent)
middleware/       → requestId, errorHandler, auth/permissions
```

### Module structure (modular refactoring in progress)

Each domain module under `modules/<name>/` follows this pattern:
```
modules/<name>/
  routes/        → Express router (thin, delegates to services)
  services/      → Business logic
  crud/          → Direct database operations (raw SQL via better-sqlite3)
```

Current modules: `dashboard`, `task-publish`, `admin`, `mypal`, `common` (shared DB connection).

Old flat `routes/` and `services/` directories still exist alongside modules during the transition.

#### Three-tier contract (Route → Service → Crud)

| Layer | Can | Cannot |
|-------|-----|--------|
| **Route** | Extract/validate params, call service, format response with `responseHelper` | Write SQL, call `getDb()`, call crud directly, contain business logic |
| **Service** | Business logic, orchestration, call crud (own module or cross-module read) | Write SQL, call `getDb()`, receive `req`/`res` objects |
| **Crud** | Pure SQL queries via `getDb()`, sole data access | Contain business logic, call other crud files |

#### Table ownership

| Module | Owns (write) | Read by |
|--------|-------------|---------|
| `task-publish` | task_publish, task_audience_rule, learner_task_queue, learner_task_reminder, task_reminder_log, campaign_activity | dashboard |
| `admin` | account, reseller_headquarter, reseller_store, learner_account, dictionary | dashboard, task-publish |
| `mypal` | mypal_learning_progress_sync + 5 sync_audit_log | — |
| `dashboard` | none (read-only analytics) | — |
| `common` | 5 audit_log tables (shared) | all |

**Cross-module rule**: read another module's crud only; never call another module's service.

### Database

- **better-sqlite3** with WAL mode. **All DB operations are synchronous** — never `await` a `db.*` call.
- DB access via `modules/common/db/connection.js` → `getDb()` (singleton).
- On first `getDb()` call: runs `schema.sql`, then applies all migration functions in order.
- Seed: `npm run seed` from `TOT_backend/server/` — deletes and re-creates seed data (10 stores, 100 employees, 3 preset tasks, test users).

### Executive Chat (LangGraph)

Agent orchestration at `agent/graph/graph.js` — a LangGraph StateGraph with:
- Intent routing → tool selection → execution → human-in-the-loop (HITL) interrupt/resume
- DeepSeek as LLM provider via `@langchain/openai` compatible adapter
- Tools in `chat_tools/` — each tool is a LangGraph tool node
- Memory extraction via BullMQ + Redis (async background worker)

### WebSocket

Two upgrade paths in `app.js`:
- `/ws` — Dashboard notifications (role-filtered; only employee/store_manager can connect)
- `/ws/tts` — TTS realtime audio streaming (Qwen-TTS proxy)

### Frontend

Vue 3 + Vite + Naive UI + Pinia + Alova (HTTP client). Multi-entry SPA:
- `/hq` — Central/headquarters dashboard
- `/employee/` — Store employee task view
- `/executive/` — Executive Chat (natural language analytics)

## Environment variables

Backend reads `.env` from repo root first, then `TOT_backend/.env` (only fills missing keys). Frontend uses `TOT_frontend/.env.development`.

| Var | Required | Purpose |
|-----|----------|---------|
| `JWT_SECRET` | Production | JWT signing key (dev default: `mvp-training-secret-2026`) |
| `DEEPSEEK_API_KEY` | AI features | DeepSeek API key for Executive Chat |
| `MYPAL_MOCK` | Dev | `1` to enable local MyPal mock |
| `MYPAL_ENABLED` | Production | `1` to enable real MyPal HTTP integration |
| `REDIS_URL` | AI memory | BullMQ backing store (default: `redis://127.0.0.1:6379`) |
| `CHAT_AGENT_MODE` | AI | `intent_routing` or `function_calling` |
| `LANGFUSE_ENABLED` | Opt-in | `true` to enable LLM tracing |
| `PORT` | No | Backend port (default: `3000`) |

## Key conventions

- **API response envelope**: `{ code, message, data, requestId }`
- **better-sqlite3 is synchronous** — `db.get()`, `db.all()`, `db.run()` return directly; wrapping in `await` is a bug
- `requireRole` middleware accepts string or array
- `POST /assignments/batch-create` intentionally does not write `notification_events`
- WebSocket connections require JWT in query string: `ws://host:3000/ws?token=<JWT>`
- Frontend `.env.development.local` overrides API URL without being committed
- Middleware files in `server/middleware/` are re-exports → actual implementations in `modules/common/middleware/`
- DB connection singleton via `modules/common/db/connection.js` → `getDb()`

## Test scripts

Backend test scripts in `TOT_backend/server/` (run with `node`):
- `test-ai-intent.js`, `test-ai-mock.js` — AI agent testing
- `test-echat.sh`, `test-echat-feedback.sh` — Executive Chat E2E
- `test-day4.sh`, `test-day6-dev1.sh` — Integration tests
- `test-chat-tools.sh` — Chat tool testing

Agent unit tests: `server/agent/graph/decideChart.test.js`, `decisionRules.test.js`, `toolCallUtils.test.js`

## Documentation index

| What | Where |
|------|-------|
| Product requirements (authoritative) | `TOT_backend/docs/product/PRODUCT_REQUIREMENTS.md` |
| API + WebSocket spec | `TOT_backend/docs/specs/04-API-SPEC.md` |
| Data model (all tables) | `TOT_backend/docs/specs/01-DATA-MODEL.md` |
| Backend docs index | `TOT_backend/docs/backend/index.md` |
| Module architecture spec | `TOT_backend/docs/backend/08-MODULE-ARCHITECTURE.md` |
| Module services spec | `TOT_backend/docs/backend/09-MODULE-SERVICES.md` |
| Modularization plan + progress | `TOT_backend/docs/plans/` |
| Onboarding guide | `TOT_backend/docs/team-onboarding.md` |
