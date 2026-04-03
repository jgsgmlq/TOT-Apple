# TOT/Apple Training Management System (MVP P0)

## Project Overview

This is the backend repository for the **TOT/Apple Training Management System (Train The Trainer)**, designed to manage retail store training tasks. Central HQ creates and dispatches training tasks to store employees based on RTM channels/regions. Employees complete learnings across four platforms (MyPAL, SmartSell, AI Demo, Live Broadcast). The system aggregates completion rates in real-time and enables HQ to send warnings and nudges.

### Technology Stack
*   **Runtime:** Node.js + Express 4.x
*   **Database:** SQLite 3 (WAL mode) via `better-sqlite3` (Synchronous API)
*   **Authentication:** JWT HS256 (7-day validity)
*   **Real-time:** WebSocket (`ws` library) for push notifications with REST fallback
*   **Utilities:** `nanoid` for ID generation, `bcrypt` for password hashing

### Architecture
The project strictly separates routes, services, and middleware. Key domains include Task Management, Assignment State Machines (pending → in_progress → completed), Notification/Nudge logic, and Dashboard KPI aggregations. All architectural and data model decisions are deeply documented in the `docs/specs/` directory.

---

## Building and Running

Ensure you have Node.js installed. Navigate to the `server` directory before running any commands.

### Setup and Database Initialization
```bash
cd server
npm install

# Initialize the SQLite database with seed data
npm run seed
# or explicitly: node db/seed.js
```

### Running the Server
```bash
# Start the production server
npm start

# Start the server in development mode (auto-reload on file changes)
npm run dev
```

By default, the REST API listens on `http://localhost:3000/api/v1` and WebSocket on `ws://localhost:3000/ws?token=<JWT>`.

**To Reset the Database:** Delete `server/database.db`, `server/database.db-shm`, and `server/database.db-wal`, then run `npm run seed` again.

---

## Development Conventions

### 1. Database Operations (CRITICAL)
The `better-sqlite3` library is completely **synchronous**. 
*   **Do NOT** use `await` or `async` with `db.*` calls.
*   **Correct:** `const task = db.get('SELECT * FROM tasks WHERE id = ?', [id]);`
*   **Incorrect:** `const task = await db.get(...);`

### 2. Roles and Permissions
The `store_manager` role has been **completely removed** from the system context to streamline operations. The system now strictly operates with:
*   `central` / `admin`: Full HQ access, task creation, dispatching, system-wide nudging, and KPI dashboards.
*   `employee`: Store employees receiving and completing tasks.
*   `executive`: Read-only access to dashboards.

*Note: You may find historical mentions of `store_manager` in older commit histories, but current logic must strictly adhere to the flattened HQ -> Employee structure.*

### 3. API Response Format
Always follow the unified response wrapper format:
```json
{
  code: 200, 
  message: success, 
  data: {}, 
  requestId: req-...
}
```
For failures, use appropriate HTTP status codes and provide an `errorCode` in the body (e.g., `errorCode: AUTH_003`).

### 4. Code Specifications & Documentation
The `/docs/specs/` folder is the ultimate source of truth. Always consult `01-DATA-MODEL.md`, `04-API-SPEC.md`, and `02-STATE-MACHINES.md` before implementing or modifying backend behaviors. Ensure idempotent workflows (especially for task assignments and system events).
