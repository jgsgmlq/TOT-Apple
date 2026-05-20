'use strict';

const path = require('path');
const os = require('os');
// 先读仓库根目录 `.env`，再读 `server/.env` 仅补全根目录未出现的键（不覆盖）
const rootEnv = path.join(__dirname, '..', '.env');
const serverEnv = path.join(__dirname, '.env');
require('dotenv').config({ path: rootEnv });
require('dotenv').config({ path: serverEnv });

const http    = require('http');
const express = require('express');
// ─── 基础中间件（modules/common/）─────────────────────────────────────────────
const requestId        = require('./modules/common/middleware/requestId');
const { errorHandler } = require('./modules/common/middleware/errorHandler');

// ─── WebSocket（modules/common/ws/）───────────────────────────────────────────
const { setupWebSocket } = require('./modules/common/ws/manager');
const { setupTtsRealtimeWebSocket } = require('./modules/common/ws/ttsRealtime');

const app = express();

// ─── 基础中间件 ────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, appId, timestamp, nonce, Signature');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '50mb' }));
// open-sync 签名校验依赖原始 form body，须在全局 urlencoded 之前挂载
app.use(
  '/api/v1/open-sync',
  express.urlencoded({
    limit: '50mb',
    extended: false,
    verify: (req, _res, buf) => {
      if (buf && buf.length) req.rawBody = buf.toString('utf8');
    },
  })
);
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(requestId);

// ─── 根路径与健康检查（无页面：前端默认 Vite :8001）──────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'mvp-lan-api' });
});

app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'TOT backend API',
    hint: '浏览器使用前端：TOT_frontend → pnpm dev（默认 http://localhost:8001）',
    health: '/api/health',
    api: '/api/v1',
  });
});

// Chrome DevTools 会探测此 URL；返回 204 避免根域 404 噪音（与 CSP 无关）
app.get('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => {
  res.status(204).end();
});

// ─── 路由 ──────────────────────────────────────────────────────────────────────
// 旧路径兼容：/api/v1/auth|stores|employees → Admin Router; /api/v1/assignments → Queue Router; /api/v1/events|nudges → Reminder Router
app.use('/api/v1/auth',        require('./modules/admin/routes/authRoutes'));
app.use('/api/v1/tasks',       require('./modules/task/routes/taskRoutes'));
app.use('/api/v1/campaigns',   require('./modules/task/routes/campaignRoutes'));
app.use('/api/v1/stores',      require('./modules/admin/routes/storeRoutes'));
app.use('/api/v1/employees',   require('./modules/admin/routes/learnerRoutes'));
app.use('/api/v1/assignments', require('./modules/task/routes/queueRoutes'));
app.use('/api/v1/events',      require('./modules/task/routes/reminderRoutes'));
app.use('/api/v1/nudges',      require('./modules/task/routes/reminderRoutes'));
app.use('/api/v1/dashboard',   require('./modules/dashboard/routes/dashboardRoutes'));
app.use('/api/v1/dashboard',   require('./modules/dashboard/routes/insightRoutes'));
app.use('/api/v1/dashboard',   require('./modules/dashboard/routes/agentRoutes'));
app.use('/api/v1/mypal',       require('./modules/mypal/routes/mypalRoutes'));
app.use('/api/v1/open-sync',   require('./modules/task/routes/openSyncRoutes'));
app.use('/api/v1/chat',        require('./routes/chat'));
app.use('/api/v1/asr',         require('./routes/asr'));

app.use('/api/v1/admin/auth',     require('./modules/admin/routes/authRoutes'));
app.use('/api/v1/admin/accounts', require('./modules/admin/routes/accountRoutes'));
app.use('/api/v1/admin/stores',   require('./modules/admin/routes/storeRoutes'));
app.use('/api/v1/admin/dicts',    require('./modules/admin/routes/dictRoutes'));
app.use('/api/v1/admin/learners', require('./modules/admin/routes/learnerRoutes'));
app.use('/api/v1/data-import',    require('./modules/admin/routes/resellerhqRoutes'));
app.use('/api/v1/data-import/campaign', require('./modules/admin/routes/campaignRoutes'));

if (process.env.MYPAL_MOCK === '1') {
  app.use('/api/v1/mypal/mock', require('./modules/mypal/routes/mypalMockRoutes'));
}

// ─── 统一错误处理（最后挂载）────────────────────────────────────────────────────
app.use(errorHandler);

// ─── HTTP + WebSocket 服务器 ───────────────────────────────────────────────────
const server = http.createServer(app);

const dashboardWss = setupWebSocket();
const ttsRealtimeWss = setupTtsRealtimeWebSocket();

server.on('upgrade', (request, socket, head) => {
  let pathname = request.url || '/';
  const q = pathname.indexOf('?');
  if (q !== -1) pathname = pathname.slice(0, q);
  if (pathname === '/ws/tts') {
    ttsRealtimeWss.handleUpgrade(request, socket, head, (ws) => {
      ttsRealtimeWss.emit('connection', ws, request);
    });
  } else if (pathname === '/ws') {
    dashboardWss.handleUpgrade(request, socket, head, (ws) => {
      dashboardWss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

const { startAutoNudgeScheduler } = require('./jobs/autoNudgeScheduler');
const { startDashboardAgentScheduler } = require('./jobs/dashboardAgentScheduler');

function firstLanIPv4() {
  const nets = os.networkInterfaces();
  for (const key of Object.keys(nets)) {
    for (const net of nets[key] || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return null;
}

function printStartupBanner(port) {
  if (!process.env.JWT_SECRET) {
    console.warn(
      '[auth] WARNING: JWT_SECRET not set, using default dev secret. DO NOT use in production.'
    );
  }
  const bindHost = '0.0.0.0';
  const lan = firstLanIPv4();
  const lanUrl = lan ? `http://${lan}:${port}` : 'http://192.168.x.x:3000 (no non-loopback IPv4 found)';
  console.log(`MVP LAN server running at http://${bindHost}:${port}`);
  console.log(`  Local:   http://localhost:${port}`);
  console.log(`  LAN:     ${lanUrl}`);
  console.log(`  WS:      ws://localhost:${port}/ws?token=<JWT>`);
  console.log(`  TTS WS:  ws://localhost:${port}/ws/tts?token=<JWT>  (Qwen-TTS Realtime 代理)`);
}

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, '0.0.0.0', () => {
  printStartupBanner(PORT);
  startAutoNudgeScheduler();
  startDashboardAgentScheduler();
});

// ─── Graceful shutdown: Langfuse flush ──────────────────────────────────────
// Langfuse v3 SDK 走后台批量上报，直接进程退出会丢最后一批 trace（见
// `docs/plans/2026-04-23-agent-execution-telemetry.md` §5.8）。SIGTERM/SIGINT
// 到达时触发一次带 5s 超时的 flushAsync，再关闭 HTTP server 与退出。
const { getClient: getLangfuseClient } = require('./modules/common/utils/tracer');
const logger = require('./modules/common/utils/logger');

let shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('graceful_shutdown_start', { signal });

  const client = getLangfuseClient();
  if (client && typeof client.flushAsync === 'function') {
    try {
      await Promise.race([
        client.flushAsync(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('flush_timeout')), 5000)),
      ]);
      logger.info('langfuse_flush_ok', { signal });
    } catch (err) {
      logger.warn('langfuse_flush_failed', { signal, message: err.message });
    }
  }

  server.close(() => {
    logger.info('graceful_shutdown_done', { signal });
    process.exit(0);
  });
  // 兜底：若 server.close 15s 内未完成，强退。
  setTimeout(() => process.exit(1), 15000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = { app, server };
