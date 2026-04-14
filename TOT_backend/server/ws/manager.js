'use strict';

const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const { formatNowSqliteLocal } = require('../utils/ddlAt');

const JWT_SECRET = process.env.JWT_SECRET || 'mvp-training-secret-2026';

// Map<employeeId, Set<WebSocket>>
const employeeClients = new Map();
// Set<WebSocket> for central/admin/executive roles
const dashboardClients = new Set();

function setupWebSocket(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    
    let decoded = null;
    if (token) {
      try {
        decoded = jwt.verify(token, JWT_SECRET);
      } catch (_) {
        ws.close(4001, 'Invalid token');
        return;
      }
    } else {
      ws.close(4001, 'Missing token');
      return;
    }

    const role = decoded.role;
    const employeeId = decoded.employeeId || null;

    // 分发到不同的连接池
    if (role === 'employee' && employeeId) {
      if (!employeeClients.has(employeeId)) {
        employeeClients.set(employeeId, new Set());
      }
      employeeClients.get(employeeId).add(ws);
      ws.send(JSON.stringify({ event: 'connected', role: 'employee', employeeId }));

      ws.on('close', () => {
        const set = employeeClients.get(employeeId);
        if (set) {
          set.delete(ws);
          if (set.size === 0) employeeClients.delete(employeeId);
        }
      });
      ws.on('error', () => {
        const set = employeeClients.get(employeeId);
        if (set) set.delete(ws);
      });
    } else if (['central', 'executive', 'admin'].includes(role)) {
      dashboardClients.add(ws);
      ws.send(JSON.stringify({ event: 'connected', role }));

      ws.on('close', () => {
        dashboardClients.delete(ws);
      });
      ws.on('error', () => {
        dashboardClients.delete(ws);
      });
    } else {
      ws.close(4003, 'Unauthorized role or missing employeeId');
      return;
    }
  });

  return wss;
}

/**
 * 向单个 employeeId 广播事件
 * @param {string} employeeId
 * @param {object} payload  { event: string, data: object }
 */
function broadcastToUser(employeeId, payload) {
  const set = employeeClients.get(employeeId);
  if (!set || set.size === 0) return;
  const msg = JSON.stringify(payload);
  for (const ws of set) {
    if (ws.readyState === 1 /* OPEN */) {
      try { ws.send(msg); } catch (_) { /* ignore */ }
    }
  }

  // Update received_at for task_assigned events if we successfully found a connected client
  if (payload.event === 'task_assigned' && payload.data && payload.data.taskId) {
    try {
      const { db } = require('../db');
      const now = formatNowSqliteLocal();
      db.run(
        'UPDATE task_assignments SET received_at = ?, updated_at = ? WHERE task_id = ? AND user_id = ? AND received_at IS NULL',
        [now, now, payload.data.taskId, employeeId]
      );
    } catch (err) {
      console.error('Error updating received_at via websocket broadcast:', err);
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
 * 向所有看板管理端广播事件 (central/executive/admin)
 * @param {object} payload
 */
function broadcastToDashboard(payload) {
  if (dashboardClients.size === 0) return;
  const msg = JSON.stringify(payload);
  for (const ws of dashboardClients) {
    if (ws.readyState === 1 /* OPEN */) {
      try { ws.send(msg); } catch (_) { /* ignore */ }
    }
  }
}

module.exports = { setupWebSocket, broadcastToUser, broadcastToUsers, broadcastToDashboard };
