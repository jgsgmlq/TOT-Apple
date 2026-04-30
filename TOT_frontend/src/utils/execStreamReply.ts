import type { ReplyContent, SendMessageResult, ClarifyPayload } from '@/api/chat';
import { formatReplyContentText } from '@/api/chat';
import { splitPreambleAndJson, parseReplyContentProgressive } from '@/utils/execChatStreamParts';

/** 与 Executive Chat `runStreamSend` 内逻辑一致，供总部看板等复用 */
export type ExecStreamState = {
  reasoningBuf: string;
  contentBuf: string;
  isFirstChunk: boolean;
  wasReasoning: boolean;
  activeToolName?: string;
};

export function initExecStreamState(): ExecStreamState {
  return { reasoningBuf: '', contentBuf: '', isFirstChunk: true, wasReasoning: false };
}

/** 归一化 SSE `delta` JSON（兼容字段名差异） */
export function normalizeStreamDelta(raw: unknown): {
  text?: string;
  phase?: string;
  toolName?: string;
} {
  if (!raw || typeof raw !== 'object') return {};
  const o = raw as Record<string, unknown>;
  const text =
    typeof o.text === 'string'
      ? o.text
      : typeof o.delta === 'string'
      ? o.delta
      : typeof o.content === 'string'
      ? o.content
      : '';
  const phase = typeof o.phase === 'string' ? o.phase : undefined;
  const toolName = typeof o.toolName === 'string' ? o.toolName : undefined;
  return { text, phase, toolName };
}

/** 流式 delta 分流：与仓库 c1cc69a63050b5c7e679c0c20ba584a9e9101c67 中 `execStreamReply` 一致 */
export function feedExecStreamDelta(
  state: ExecStreamState,
  deltaData: { text?: string; phase?: string; toolName?: string }
): void {
  if (deltaData.phase === 'tool_start') {
    const preamble = state.contentBuf.trim();
    if (preamble) {
      state.reasoningBuf += `${state.reasoningBuf.trim() ? '\n\n' : ''}${preamble}`;
      state.contentBuf = '';
    }
    if (deltaData.toolName) {
      state.reasoningBuf += `${state.reasoningBuf.trim() ? '\n\n' : ''}调用工具：${
        deltaData.toolName
      }`;
      state.activeToolName = deltaData.toolName;
    }
    state.wasReasoning = false;
    return;
  }

  if (deltaData.phase === 'tool_end') {
    state.activeToolName = undefined;
    state.wasReasoning = false;
    return;
  }

  if (state.isFirstChunk) {
    state.isFirstChunk = false;
    if (deltaData.phase === 'reasoning') {
      // state.reasoningBuf += '> **模型推理：**\n> ';
      state.wasReasoning = true;
    }
  }
  if (deltaData?.text) {
    if (deltaData.phase === 'reasoning') {
      state.reasoningBuf += deltaData.text.replace(/\n/g, '\n ');
      state.wasReasoning = true;
    } else {
      if (state.wasReasoning) {
        state.reasoningBuf += '\n\n';
        state.wasReasoning = false;
      }
      state.contentBuf += deltaData.text;
    }
  }
}

export interface ExecStyleAiPayload {
  thinking?: string;
  content: string;
  partialReply?: ReplyContent | null;
  jsonStream?: string;
  activeToolName?: string;
  /** 与 `thinking` 同步，供 done 后落库展示 */
  thinkingSnapshot: string;
}

/** 与主气泡正文一致、供 TTS 朗读；不含 `thinking`（思考过程） */
export function speechTextForExecutiveTts(p: ExecStyleAiPayload): string {
  if (p.partialReply != null) {
    return formatReplyContentText(p.partialReply).trim();
  }
  if (p.jsonStream) {
    return '';
  }
  const c = (p.content || '').trim();
  if (!c || c === '正在生成…') return '';
  return c;
}

/** SSE `done` 后与主气泡 `markdownContent | formatReplyContentText` 对齐的朗读文本 */
export function speechTextForSendResult(result: SendMessageResult): string {
  const fromCard = formatReplyContentText(result.replyContent ?? null).trim();
  if (fromCard) return fromCard;
  return (result.markdownContent || '').trim();
}

/**
 * 「思考过程」= `phase: reasoning` 累积的 `reasoningBuf`；正文 = `contentBuf`
 * （未解析时原样 Markdown/JSON 流，解析成功后为 `formatReplyContentText` 摘要）。
 * 依赖后端 `server/utils/fcStreamDeltaSplit.js` 正确拆分 FC 下的 `delta.content`。
 */
export function execStreamStateToPayload(state: ExecStreamState): ExecStyleAiPayload {
  const reasoningTrim = state.reasoningBuf.trim();
  const contentBufTrim = state.contentBuf.trim();
  const split = splitPreambleAndJson(state.contentBuf);
  const jsonRaw = split.jsonRaw;
  const parsed = parseReplyContentProgressive(jsonRaw);

  const thinking = reasoningTrim || undefined;
  const thinkingSnapshot = reasoningTrim;

  let content: string;
  if (parsed) {
    content = formatReplyContentText(parsed);
  } else if (contentBufTrim) {
    content = contentBufTrim;
  } else {
    const narrativeDone = Boolean(reasoningTrim || jsonRaw.trim());
    content = narrativeDone ? '' : '正在生成…';
  }

  return {
    thinking,
    content,
    partialReply: parsed || undefined,
    jsonStream: !parsed && jsonRaw ? jsonRaw : undefined,
    activeToolName: state.activeToolName,
    thinkingSnapshot,
  };
}

/** SSE 被 AbortController 中止时，fetch 会抛出 AbortError */
export function isStreamAbortError(e: unknown): boolean {
  return (
    (typeof DOMException !== 'undefined' && e instanceof DOMException && e.name === 'AbortError') ||
    (e instanceof Error && e.name === 'AbortError')
  );
}

export function finalizeExecStyleMessage(
  result: SendMessageResult,
  thinkingSnapshot: string,
  opts?: { messageId?: string }
) {
  const finalContent = result.markdownContent || formatReplyContentText(result.replyContent);
  return {
    role: 'ai' as const,
    id: opts?.messageId ?? result.messageId,
    content: finalContent,
    replyContent: result.replyContent,
    thinking: thinkingSnapshot || undefined,
    jsonStream: undefined,
    partialReply: undefined,
  };
}

/**
 * SSE 流式重新生成（由于 API 参数不同，这里单独封装）
 */
export type ExecStreamPayload =
  | { id: string; type: 'streaming'; partialReply: string; thinking: string }
  | { id: string; type: 'done'; result: SendMessageResult; thinking: string }
  | { id: string; type: 'clarify'; clarify: ClarifyPayload; thinking: string }
  | { id: string; type: 'error'; error: unknown };

export function runExecRegenerateSseChat(
  streamFn: (
    sessionId: string,
    messageId: string,
    onDelta: (chunk: { text: string; phase?: string; toolName?: string }) => void,
    onComplete: (data: SendMessageResult) => void,
    onClarify: (payload: ClarifyPayload) => void,
    onError: (error: unknown) => void,
    streamOptions?: { signal?: AbortSignal }
  ) => Promise<void>,
  sessionId: string,
  messageId: string,
  onUpdate: (payload: ExecStreamPayload) => void,
  onClarify?: (payload: ClarifyPayload) => void,
  options?: { signal?: AbortSignal }
): Promise<SendMessageResult> {
  return new Promise((resolve, reject) => {
    let partialReply = '';
    let thinkingSnapshot = '';

    void streamFn(
      sessionId,
      messageId,
      (chunk) => {
        if (chunk.phase === 'reasoning') {
          thinkingSnapshot += chunk.text;
        } else {
          partialReply += chunk.text;
        }

        onUpdate({
          id: messageId,
          type: 'streaming',
          partialReply,
          thinking: thinkingSnapshot,
        });
      },
      (data) => {
        onUpdate({
          id: data.messageId || messageId,
          type: 'done',
          result: data,
          thinking: thinkingSnapshot,
        });
        resolve(data);
      },
      (clarify) => {
        onClarify?.(clarify);
        onUpdate({
          id: messageId,
          type: 'clarify',
          clarify,
          thinking: thinkingSnapshot,
        });
      },
      (err) => {
        onUpdate({ id: messageId, type: 'error', error: err });
        reject(err);
      },
      { signal: options?.signal }
    );
  });
}

/**
 * SSE 流式对话（delta/done），将增量映射为与 Executive 一致的 payload。
 * `done` 时 `thinkingSnapshot` 取最后一帧 delta 的快照。
 */
export function runExecStyleSseChat<TInput = string>(
  streamFn: (
    sessionId: string,
    content: string,
    onDelta: (chunk: { text: string; phase?: string; toolName?: string }) => void,
    onComplete: (data: SendMessageResult) => void,
    onClarify: (payload: ClarifyPayload) => void,
    onError: (error: unknown) => void,
    streamOptions?: { signal?: AbortSignal }
  ) => Promise<void>,
  sessionId: string,
  userContent: TInput,
  onStreamingPatch: (payload: ExecStyleAiPayload) => void,
  onClarify?: (payload: ClarifyPayload) => void,
  options?: { signal?: AbortSignal }
): Promise<{ result: SendMessageResult; thinkingSnapshot: string }> {
  const state = initExecStreamState();
  let lastSnapshot = '';
  return new Promise((resolve, reject) => {
    void streamFn(
      sessionId,
      userContent,
      (deltaData) => {
        feedExecStreamDelta(state, normalizeStreamDelta(deltaData));
        const p = execStreamStateToPayload(state);
        lastSnapshot = p.thinkingSnapshot;
        onStreamingPatch(p);
      },
      (result) => {
        resolve({ result, thinkingSnapshot: lastSnapshot });
      },
      (clarify) => {
        onClarify?.(clarify);
      },
      (err) => reject(err),
      { signal: options?.signal }
    );
  });
}
