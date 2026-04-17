import type { ReplyContent, SendMessageResult } from '@/api/chat';
import { formatReplyContentText } from '@/api/chat';
import { splitPreambleAndJson, parseReplyContentProgressive } from '@/utils/execChatStreamParts';

/** 与 Executive Chat `runStreamSend` 内逻辑一致，供总部看板等复用 */
export type ExecStreamState = {
  reasoningBuf: string;
  contentBuf: string;
  isFirstChunk: boolean;
  wasReasoning: boolean;
};

export function initExecStreamState(): ExecStreamState {
  return { reasoningBuf: '', contentBuf: '', isFirstChunk: true, wasReasoning: false };
}

export function feedExecStreamDelta(
  state: ExecStreamState,
  deltaData: { text?: string; phase?: string }
): void {
  if (state.isFirstChunk) {
    state.isFirstChunk = false;
    if (deltaData.phase === 'reasoning') {
      state.reasoningBuf += '> **模型推理：**\n> ';
      state.wasReasoning = true;
    }
  }
  if (deltaData?.text) {
    if (deltaData.phase === 'reasoning') {
      state.reasoningBuf += deltaData.text.replace(/\n/g, '\n> ');
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
  /** 与 `thinking` 同步，供 done 后落库展示 */
  thinkingSnapshot: string;
}

export function execStreamStateToPayload(state: ExecStreamState): ExecStyleAiPayload {
  const split = splitPreambleAndJson(state.contentBuf);
  const jsonRaw = split.jsonRaw;
  const preamble = split.preamble.trim();
  const thinkingMerged = [state.reasoningBuf.trim(), preamble].filter(Boolean).join('\n\n').trim();
  const parsed = parseReplyContentProgressive(jsonRaw);
  const narrativeDone = Boolean(thinkingMerged || jsonRaw);
  return {
    thinking: thinkingMerged || undefined,
    content: parsed ? formatReplyContentText(parsed) : narrativeDone ? '' : '正在生成…',
    partialReply: parsed || undefined,
    jsonStream: !parsed && jsonRaw ? jsonRaw : undefined,
    thinkingSnapshot: thinkingMerged,
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
  return {
    role: 'ai' as const,
    id: opts?.messageId ?? result.messageId,
    content: formatReplyContentText(result.replyContent),
    replyContent: result.replyContent,
    thinking: thinkingSnapshot || undefined,
    jsonStream: undefined,
    partialReply: undefined,
  };
}

/**
 * SSE 流式对话（delta/done），将增量映射为与 Executive 一致的 payload。
 */
export function runExecStyleSseChat(
  streamFn: (
    sessionId: string,
    content: string,
    onDelta: (chunk: { text: string; phase?: string }) => void,
    onComplete: (data: SendMessageResult) => void,
    onError: (error: unknown) => void,
    streamOptions?: { signal?: AbortSignal }
  ) => Promise<void>,
  sessionId: string,
  userContent: string,
  onStreamingPatch: (payload: ExecStyleAiPayload) => void,
  options?: { signal?: AbortSignal }
): Promise<{ result: SendMessageResult; thinkingSnapshot: string }> {
  const state = initExecStreamState();
  let lastSnapshot = '';
  return new Promise((resolve, reject) => {
    void streamFn(
      sessionId,
      userContent,
      (deltaData) => {
        feedExecStreamDelta(state, deltaData);
        const p = execStreamStateToPayload(state);
        lastSnapshot = p.thinkingSnapshot;
        onStreamingPatch(p);
      },
      (result) => {
        resolve({ result, thinkingSnapshot: lastSnapshot });
      },
      (err) => reject(err),
      { signal: options?.signal }
    );
  });
}
