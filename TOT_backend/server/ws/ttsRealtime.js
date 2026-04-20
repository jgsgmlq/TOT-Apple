'use strict';

/**
 * Executive Chat 配套：浏览器 WebSocket → 百炼 Qwen-TTS Realtime（与 ASR 共用 DASHSCOPE / ASR_API_KEY）
 * 路径：/ws/tts?token=<JWT>
 * 客户端 JSON：{ type:'start', voice?, mode?, language_type? } | { type:'append', text } | { type:'finish' }
 * 服务端透传上游 JSON 事件（含 response.audio.delta 等）
 */

const { WebSocketServer, WebSocket } = require('ws');
const jwt = require('jsonwebtoken');
const { nanoid } = require('nanoid');

const JWT_SECRET = process.env.JWT_SECRET || 'mvp-training-secret-2026';

const DEFAULT_UPSTREAM_BASE = 'wss://dashscope.aliyuncs.com';
const DEFAULT_MODEL = 'qwen3-tts-flash-realtime';

function getApiKey() {
  return String(process.env.ASR_API_KEY || process.env.DASHSCOPE_API_KEY || '').trim();
}

function getUpstreamBase() {
  const raw = process.env.TTS_REALTIME_BASE_URL || process.env.DASHSCOPE_WS_BASE || DEFAULT_UPSTREAM_BASE;
  return String(raw).replace(/\/+$/, '');
}

function buildUpstreamUrl() {
  const model = process.env.TTS_MODEL || DEFAULT_MODEL;
  return `${getUpstreamBase()}/api-ws/v1/realtime?model=${encodeURIComponent(model)}`;
}

/**
 * 使用 noServer：由 app.js 与 /ws 共用 upgrade 时按 pathname 分发（见 manager.js 头注释）。
 */
function setupTtsRealtimeWebSocket() {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (clientWs, req) => {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    let decoded = null;
    if (token) {
      try {
        decoded = jwt.verify(token, JWT_SECRET);
      } catch (_) {
        clientWs.close(4001, 'Invalid token');
        return;
      }
    } else {
      clientWs.close(4001, 'Missing token');
      return;
    }

    const role = decoded.role;
    if (!['executive', 'central', 'admin'].includes(role)) {
      clientWs.close(4003, 'Unauthorized role for TTS');
      return;
    }

    const apiKey = getApiKey();
    if (!apiKey) {
      clientWs.close(4503, 'TTS API key not configured');
      return;
    }

    const upstream = new WebSocket(buildUpstreamUrl(), {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    });

    const pending = [];
    let started = false;
    const defaultVoice = process.env.TTS_VOICE || 'Cherry';

    function flushPending() {
      while (pending.length && upstream.readyState === WebSocket.OPEN) {
        const raw = pending.shift();
        upstream.send(raw);
      }
    }

    function sendSessionUpdate(opts) {
      const session = {
        voice: opts.voice || defaultVoice,
        mode: opts.mode || 'server_commit',
        language_type: opts.language_type || 'Chinese',
        response_format: 'pcm',
        sample_rate: 24000,
      };
      upstream.send(
        JSON.stringify({
          event_id: nanoid(),
          type: 'session.update',
          session,
        })
      );
    }

    upstream.on('open', () => {
      sendSessionUpdate({});
      started = true;
      flushPending();
      try {
        clientWs.send(JSON.stringify({ type: 'ready', source: 'tot-tts-proxy' }));
      } catch (_) {
        /* ignore */
      }
    });

    upstream.on('message', (data, isBinary) => {
      const payload = isBinary ? data.toString() : data.toString();
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(payload);
      }
    });

    upstream.on('close', (code, reason) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close(code || 1000, reason?.toString() || '');
      }
    });

    upstream.on('error', (err) => {
      try {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(
            JSON.stringify({ type: 'error', message: err.message || 'upstream error', code: 'TTS_UPSTREAM' })
          );
        }
      } catch (_) {
        /* ignore */
      }
    });

    clientWs.on('message', (buf) => {
      let msg;
      try {
        msg = JSON.parse(buf.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'start') {
        if (upstream.readyState !== WebSocket.OPEN) return;
        sendSessionUpdate({
          voice: msg.voice,
          mode: msg.mode,
          language_type: msg.language_type,
        });
        return;
      }

      if (msg.type === 'append' && typeof msg.text === 'string' && msg.text.length > 0) {
        const payload = JSON.stringify({
          event_id: nanoid(),
          type: 'input_text_buffer.append',
          text: msg.text,
        });
        if (upstream.readyState === WebSocket.OPEN && started) {
          upstream.send(payload);
        } else {
          pending.push(payload);
        }
        return;
      }

      if (msg.type === 'finish') {
        const payload = JSON.stringify({
          event_id: nanoid(),
          type: 'session.finish',
        });
        if (upstream.readyState === WebSocket.OPEN && started) {
          upstream.send(payload);
        } else {
          pending.push(payload);
        }
      }
    });

    clientWs.on('close', () => {
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.close(1000);
      }
    });

    clientWs.on('error', () => {
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.close(1011);
      }
    });
  });

  return wss;
}

module.exports = { setupTtsRealtimeWebSocket };
