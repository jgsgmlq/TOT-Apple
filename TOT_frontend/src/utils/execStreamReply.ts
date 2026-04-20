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

/** 与主气泡正文一致、供 TTS 朗读；不含 `thinking`（思考过程） */
export function speechTextForExecutiveTts(p: ExecStyleAiPayload): string {
  if (p.partialReply != null) {
    return formatReplyContentText(p.partialReply).trim();
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

export function execStreamStateToPayload(state: ExecStreamState): ExecStyleAiPayload {
  const split = splitPreambleAndJson(state.contentBuf);
  const jsonRawFull = split.jsonRaw;
  const jsonRawTrim = jsonRawFull.trim();
  const preamble = split.preamble.trim();
  const reasoningOnly = state.reasoningBuf.trim();
  const parsed = parseReplyContentProgressive(jsonRawFull);

  // FC / Markdown：无 ```json 围栏且正文在 preamble 时，必须进 MarkdownRenderer 的 content，不能并入 thinking 且不能把 content 置空
  if (!jsonRawTrim && preamble) {
    const snapshot = [reasoningOnly, preamble].filter(Boolean).join('\n\n').trim();
    return {
      thinking: reasoningOnly || undefined,
      content: preamble,
      partialReply: undefined,
      jsonStream: undefined,
      thinkingSnapshot: snapshot,
    };
  }

  const thinkingMerged = [reasoningOnly, preamble].filter(Boolean).join('\n\n').trim();
  const narrativeDone = Boolean(thinkingMerged || jsonRawTrim);
  return {
    thinking: thinkingMerged || undefined,
    content: parsed ? formatReplyContentText(parsed) : narrativeDone ? '' : '正在生成…',
    partialReply: parsed || undefined,
    jsonStream: !parsed && jsonRawFull ? jsonRawFull : undefined,
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
