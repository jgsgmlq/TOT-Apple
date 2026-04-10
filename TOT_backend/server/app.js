'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const http    = require('http');
const express = require('express');
const requestId        = require('./middleware/requestId');
const { errorHandler } = require('./middleware/errorHandler');
const { setupWebSocket } = require('./ws/manager');

const authRoutes          = require('./routes/auth');
const tasksRoutes         = require('./routes/tasks');
const storesRoutes        = require('./routes/stores');
const employeesRoutes     = require('./routes/employees');
const assignmentsRoutes   = require('./routes/assignments');
const notificationsRoutes = require('./routes/notifications');
const nudgeRoutes         = require('./routes/nudge');
const dashboardRoutes     = require('./routes/dashboard');
const mypalRoutes         = require('./routes/mypal');
const chatRoutes          = require('./routes/chat');

const MYPAL_MOCK = process.env.MYPAL_MOCK === '1';
const mypalMockRoutes = MYPAL_MOCK ? require('./routes/mypalMock') : null;

const app = express();

// ─── 基础中间件 ────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json());
app.use(requestId);

// ─── 路由 ──────────────────────────────────────────────────────────────────────
app.use('/api/v1/auth',        authRoutes);
app.use('/api/v1/tasks',       tasksRoutes);
app.use('/api/v1/stores',      storesRoutes);
app.use('/api/v1/employees',   employeesRoutes);
app.use('/api/v1/assignments', assignmentsRoutes);
app.use('/api/v1/events',      notificationsRoutes);
app.use('/api/v1/nudges',      nudgeRoutes);
app.use('/api/v1/dashboard',  dashboardRoutes);
app.use('/api/v1/mypal',      mypalRoutes);
app.use('/api/v1/chat',       chatRoutes);

// ─── MyPal（开发环境 Mock）──────────────────────────────────────────────────
if (mypalMockRoutes) {
  app.use('/api/v1/mypal/mock', mypalMockRoutes);
}

// ─── 统一错误处理（最后挂载）────────────────────────────────────────────────────
app.use(errorHandler);

// ─── HTTP + WebSocket 服务器 ───────────────────────────────────────────────────
const server = http.createServer(app);
setupWebSocket(server);

const { startAutoNudgeScheduler } = require('./jobs/autoNudgeScheduler');

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws?token=<JWT>`);
  startAutoNudgeScheduler();
});

module.exports = { app, server };
