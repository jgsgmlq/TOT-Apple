'use strict';

const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'mvp-training-secret-2026';

// Map<employeeId, Set<WebSocket>>
const clients = new Map();

/** 总部/管理端连接（JWT 无 employeeId，仅 central/admin/executive） */
const hqSockets = new Set();

const HQ_ROLES = new Set(['central', 'admin', 'executive']);

function setupWebSocket(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');

    if (!token) {
      ws.close(4001, 'Missing token');
      return;
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (_) {
      ws.close(4001, 'Invalid token');
      return;
    }

    const employeeId = decoded.employeeId || null;
    const role = decoded.role || '';

    if (employeeId) {
      if (!clients.has(employeeId)) {
        clients.set(employeeId, new Set());
      }
      clients.get(employeeId).add(ws);

      ws.send(JSON.stringify({ event: 'connected', employeeId }));

      ws.on('close', () => {
        const set = clients.get(employeeId);
        if (set) {
          set.delete(ws);
          if (set.size === 0) clients.delete(employeeId);
        }
      });

      ws.on('error', () => {
        const set = clients.get(employeeId);
        if (set) set.delete(ws);
      });
      return;
    }

    if (HQ_ROLES.has(role)) {
      hqSockets.add(ws);
      ws.send(JSON.stringify({ event: 'connected', role: 'hq' }));

      ws.on('close', () => {
        hqSockets.delete(ws);
      });

      ws.on('error', () => {
        hqSockets.delete(ws);
      });
      return;
    }

    ws.close(4002, 'No employeeId in token');
  });

  return wss;
}

/**
 * 向单个 employeeId 广播事件
 * @param {string} employeeId
 * @param {object} payload  { event: string, data: object }
 */
function broadcastToUser(employeeId, payload) {
  const set = clients.get(employeeId);
  if (!set || set.size === 0) return;
  const msg = JSON.stringify(payload);
  for (const ws of set) {
    if (ws.readyState === 1 /* OPEN */) {
      try { ws.send(msg); } catch (_) { /* ignore */ }
    }
  }
}

/**
 * 向多个 employeeId 广播相同事件
 * @param {string[]} employeeIds
 * @param {object}   payload
 */
function broadcastToUsers(employeeIds, payload) {
  for (const eid of employeeIds) {
    broadcastToUser(eid, payload);
  }
}

/**
 * 向所有已连接的总部/管理端 WebSocket 广播（如 task_updated 同步看板）
 * @param {object} payload { event: string, data: object }
 */
function broadcastToHq(payload) {
  const msg = JSON.stringify(payload);
  for (const ws of hqSockets) {
    if (ws.readyState === 1 /* OPEN */) {
      try { ws.send(msg); } catch (_) { /* ignore */ }
    }
  }
}

module.exports = { setupWebSocket, broadcastToUser, broadcastToUsers, broadcastToHq };
