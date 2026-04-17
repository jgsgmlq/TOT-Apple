/**
 * Executive Chat：百炼 Qwen-TTS Realtime（经后端 /ws/tts 代理），与 SSE 流式文字并行朗读。
 * 朗读文本与气泡内 formatReplyContentText(partialReply) 对齐，随结构化字段增量而追加。
 */
import { formatReplyContentText } from '@/api/chat';
import type { ReplyContent } from '@/api/chat';

const LS_KEY = 'tot_executive_voice_enabled';

export function getExecutiveVoiceEnabled(): boolean {
  try {
    return localStorage.getItem(LS_KEY) === '1';
  } catch {
    return false;
  }
}

export function setExecutiveVoiceEnabled(v: boolean): void {
  try {
    localStorage.setItem(LS_KEY, v ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function buildTtsWsUrl(token: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return `${proto}//${host}/ws/tts?token=${encodeURIComponent(token)}`;
}

class Pcm24kPlayer {
  private ctx: AudioContext | null = null;
  private nextTime = 0;

  async enqueueBase64Pcm(b64: string) {
    const ctx = this.ctx ?? new AudioContext({ sampleRate: 24000 });
    this.ctx = ctx;
    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => undefined);
    }

    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const sampleCount = bytes.byteLength / 2;
    const f32 = new Float32Array(sampleCount);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < sampleCount; i++) {
      f32[i] = dv.getInt16(i * 2, true) / 32768.0;
    }

    const buf = ctx.createBuffer(1, f32.length, 24000);
    buf.copyToChannel(f32, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const now = ctx.currentTime;
    const startAt = Math.max(now, this.nextTime);
    src.start(startAt);
    this.nextTime = startAt + buf.duration;
  }

  stop() {
    try {
      void this.ctx?.close();
    } catch {
      /* ignore */
    }
    this.ctx = null;
    this.nextTime = 0;
  }
}

export class ExecutiveTtsSession {
  private ws: WebSocket | null = null;
  private player = new Pcm24kPlayer();
  private gotReady = false;
  private lastText = '';

  async connect(getToken: () => string): Promise<void> {
    return new Promise((resolve, reject) => {
      const token = getToken();
      if (!token) {
        reject(new Error('未登录'));
        return;
      }
      const socket = new WebSocket(buildTtsWsUrl(token));
      this.ws = socket;

      const to = window.setTimeout(() => {
        reject(new Error('语音合成连接超时'));
        try {
          socket.close();
        } catch {
          /* ignore */
        }
      }, 20000);

      socket.onmessage = (ev: MessageEvent) => {
        let j: Record<string, unknown>;
        try {
          j = JSON.parse(ev.data as string) as Record<string, unknown>;
        } catch {
          return;
        }
        if (j.type === 'ready' && j.source === 'tot-tts-proxy') {
          window.clearTimeout(to);
          this.gotReady = true;
          resolve();
          return;
        }
        void this.onUpstreamEvent(j);
      };

      socket.onerror = () => {
        window.clearTimeout(to);
        reject(new Error('语音合成 WebSocket 错误'));
      };

      socket.onclose = () => {
        window.clearTimeout(to);
        if (!this.gotReady) {
          reject(new Error('语音连接已断开'));
        }
      };
    });
  }

  private async onUpstreamEvent(j: Record<string, unknown>) {
    if (j.type === 'response.audio.delta' && typeof j.delta === 'string') {
      await this.player.enqueueBase64Pcm(j.delta);
    }
  }

  /** 与气泡展示一致：使用结构化 partialReply 格式化后的全文，只追加新增后缀 */
  pushPartialReply(partial: ReplyContent | null | undefined) {
    const full = formatReplyContentText(partial ?? null);
    this.pushTextIncremental(full);
  }

  private pushTextIncremental(full: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (full.length < this.lastText.length) {
      this.lastText = full;
      return;
    }
    const chunk = full.slice(this.lastText.length);
    this.lastText = full;
    if (!chunk) return;
    this.ws.send(JSON.stringify({ type: 'append', text: chunk }));
  }

  finish() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'finish' }));
  }

  /** 发送 finish 后等待连接关闭（上游结束会话） */
  waitUntilClosed(maxMs = 120000): Promise<void> {
    return new Promise((resolve) => {
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }
      const done = () => {
        window.clearTimeout(to);
        resolve();
      };
      const to = window.setTimeout(done, maxMs);
      this.ws!.addEventListener('close', done, { once: true });
    });
  }

  dispose() {
    this.lastText = '';
    this.player.stop();
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.close(1000, 'client-done');
      }
    } catch {
      /* ignore */
    }
    this.ws = null;
  }
}

/** 非流式一整段朗读（如重新生成后） */
export async function speakReplyContent(
  getToken: () => string,
  reply: ReplyContent | null | undefined
): Promise<void> {
  const s = new ExecutiveTtsSession();
  try {
    await s.connect(getToken);
    s.pushPartialReply(reply ?? null);
    s.finish();
    await s.waitUntilClosed(60000);
  } finally {
    s.dispose();
  }
}
