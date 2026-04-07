'use strict';

const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'mvp-training-secret-2026';

// Map<employeeId, Set<WebSocket>>
const clients = new Map();

function setupWebSocket(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    let employeeId = null;

    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        employeeId = decoded.employeeId || null;
      } catch (_) {
        ws.close(4001, 'Invalid token');
        return;
      }
    }

    // central/admin/executive 没有 employeeId，暂不支持 WS 推送（可轮询）
    if (!employeeId) {
      ws.close(4002, 'No employeeId in token');
      return;
    }

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

module.exports = { setupWebSocket, broadcastToUser, broadcastToUsers };
