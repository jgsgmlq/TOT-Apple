import { Alova } from '@/utils/http/alova/index';
import { streamSsePostJson } from '@/utils/http/ssePostStream';
import type { ChartData } from '@/types/chat';

export interface ReplyContent {
  overview: string;
  keyNumbers: Array<{ label: string; value: string; unit?: string }>;
  attentionPoints: string[];
  followUpSuggestions: string[];
  visualizations?: ChartData[];
  statisticsProvenance?: any;
  forecastDisclaimer?: string;
}

export interface CreateSessionResult {
  sessionId: string;
  contextId: string;
  exampleQuestions: string[];
}

export interface SendMessageResult {
  messageId: string;
  replyContent: ReplyContent | null;
  markdownContent?: string;
  responseTime: number;
  contextId: string;
  timestamp: string;
}

export interface ChatHistoryItem {
  messageId: string;
  role: 'user' | 'assistant';
  content?: string;
  replyContent?: ReplyContent | null;
  intentType?: string | null;
  userFeedback?: 'like' | 'dislike' | null;
  timestamp: string;
}

export interface ChatHistoryResult {
  sessionId: string;
  historyList: ChatHistoryItem[];
  pagination: {
    pageNum: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface SubmitFeedbackResult {
  sessionId: string;
  messageId: string;
  userFeedback: 'like' | 'dislike' | null;
}

/** 将后端 replyContent 格式化为气泡内展示文本 */
export function formatReplyContentText(rc: ReplyContent | null | undefined): string {
  if (!rc) return '';
  let text = rc.overview || '';
  if (rc.keyNumbers?.length) {
    text +=
      '\n\n📊 关键数据：\n' +
      rc.keyNumbers.map((k) => `• ${k.label}：${k.value}${k.unit || ''}`).join('\n');
  }
  if (rc.attentionPoints?.length) {
    text += '\n\n⚠️ 关注点：\n' + rc.attentionPoints.map((p) => `• ${p}`).join('\n');
  }
  if (rc.followUpSuggestions?.length) {
    text += '\n\n💡 ' + rc.followUpSuggestions.join(' / ');
  }
  return text.trim() || '（暂无摘要）';
}

/** 总部看板机器人：路径前缀（与 Executive Chat 共用请求/响应类型） */
const CHAT_DASHBOARD_SESSIONS = '/chat/dashboard/sessions';

/**
 * 创建 Executive Chat 会话
 */
export const createChatSession = () => {
  return Alova.Post<CreateSessionResult>('/chat/executive/sessions');
};

/** 创建总部看板机器人会话（central / admin） */
export const createDashboardChatSession = () => {
  return Alova.Post<CreateSessionResult>(CHAT_DASHBOARD_SESSIONS);
};

/**
 * 发送消息并获取 AI 回复
 * @param options.skipGlobalErrorMessage 为 true 时不弹全局 Message（由页面自行提示 / 或内部重试）
 */
export const sendChatMessage = (
  sessionId: string,
  content: string,
  options?: { skipGlobalErrorMessage?: boolean }
) => {
  return Alova.Post<SendMessageResult>(
    `/chat/executive/sessions/${sessionId}/messages`,
    { content },
    options?.skipGlobalErrorMessage ? { meta: { skipGlobalErrorMessage: true } } : undefined
  );
};

/**
 * Executive Chat 流式发送（SSE：`delta` / `done` / `error`），与智能洞察共用 {@link streamSsePostJson}。
 * @param onMessage `event: delta` 的 JSON：`{ text, phase?: 'content'|'reasoning' }`
 * @param onComplete `event: done` 的 `data` 字段，即 SendMessageResult
 */
export const streamExecutiveChatMessage = async (
  sessionId: string,
  content: string,
  onMessage: (chunk: { text: string; phase?: string }) => void,
  onComplete: (data: SendMessageResult) => void,
  onError: (error: unknown) => void,
  streamOptions?: { signal?: AbortSignal }
) => {
  return streamSsePostJson({
    path: `/chat/executive/sessions/${sessionId}/messages`,
    body: { content, stream: true },
    onDelta: (p) => onMessage(p as { text: string; phase?: string }),
    onDone: (d) => onComplete(d as SendMessageResult),
    onError,
    fallbackErrorMessage: 'Executive Chat 处理失败',
    signal: streamOptions?.signal,
  });
};

/**
 * 分页拉取会话消息（默认单页 200 条，覆盖典型联调长度）
 * @param options.skipGlobalErrorMessage 为 true 时不走全局 Message.error（用于静默探测会话是否存在）
 */
export const getChatHistory = (
  sessionId: string,
  pageNum = 1,
  pageSize = 200,
  options?: { skipGlobalErrorMessage?: boolean }
) => {
  return Alova.Get<ChatHistoryResult>(`/chat/executive/sessions/${sessionId}/history`, {
    params: { pageNum, pageSize },
    meta: options?.skipGlobalErrorMessage ? { skipGlobalErrorMessage: true } : undefined,
  });
};

/** 删除 Executive Chat 会话（服务端同时删除该会话下全部消息） */
export const deleteChatSession = (
  sessionId: string,
  options?: { skipGlobalErrorMessage?: boolean }
) => {
  return Alova.Delete<{ sessionId: string }>(
    `/chat/executive/sessions/${sessionId}`,
    undefined,
    options?.skipGlobalErrorMessage ? { meta: { skipGlobalErrorMessage: true } } : undefined
  );
};

/**
 * 提交针对 AI 回复的反馈
 * @param feedback 'like' | 'dislike' | 'none'
 */
export const submitChatFeedback = (
  sessionId: string,
  messageId: string,
  feedback: 'like' | 'dislike' | 'none'
) => {
  return Alova.Post<SubmitFeedbackResult>(
    `/chat/executive/sessions/${sessionId}/messages/${messageId}/feedback`,
    { feedback }
  );
};

/**
 * 重新生成 AI 的最后一条回复
 */
export const regenerateChatMessage = (sessionId: string, messageId: string) => {
  return Alova.Post<SendMessageResult>(
    `/chat/executive/sessions/${sessionId}/messages/${messageId}/regenerate`
  );
};

// ─── 总部看板机器人（与上列方法对称，仅路径为 /chat/dashboard/sessions）────────

export const sendDashboardChatMessage = (
  sessionId: string,
  content: string,
  options?: { skipGlobalErrorMessage?: boolean }
) => {
  return Alova.Post<SendMessageResult>(
    `${CHAT_DASHBOARD_SESSIONS}/${sessionId}/messages`,
    { content },
    options?.skipGlobalErrorMessage ? { meta: { skipGlobalErrorMessage: true } } : undefined
  );
};

export const streamDashboardChatMessage = async (
  sessionId: string,
  content: string,
  onMessage: (chunk: { text: string; phase?: string }) => void,
  onComplete: (data: SendMessageResult) => void,
  onError: (error: unknown) => void,
  streamOptions?: { signal?: AbortSignal }
) => {
  return streamSsePostJson({
    path: `${CHAT_DASHBOARD_SESSIONS}/${sessionId}/messages`,
    body: { content, stream: true },
    onDelta: (p) => onMessage(p as { text: string; phase?: string }),
    onDone: (d) => onComplete(d as SendMessageResult),
    onError,
    fallbackErrorMessage: '看板机器人对话处理失败',
    signal: streamOptions?.signal,
  });
};

export const getDashboardChatHistory = (
  sessionId: string,
  pageNum = 1,
  pageSize = 200,
  options?: { skipGlobalErrorMessage?: boolean }
) => {
  return Alova.Get<ChatHistoryResult>(`${CHAT_DASHBOARD_SESSIONS}/${sessionId}/history`, {
    params: { pageNum, pageSize },
    meta: options?.skipGlobalErrorMessage ? { skipGlobalErrorMessage: true } : undefined,
  });
};

export const deleteDashboardChatSession = (
  sessionId: string,
  options?: { skipGlobalErrorMessage?: boolean }
) => {
  return Alova.Delete<{ sessionId: string }>(
    `${CHAT_DASHBOARD_SESSIONS}/${sessionId}`,
    undefined,
    options?.skipGlobalErrorMessage ? { meta: { skipGlobalErrorMessage: true } } : undefined
  );
};

export const submitDashboardChatFeedback = (
  sessionId: string,
  messageId: string,
  feedback: 'like' | 'dislike' | 'none'
) => {
  return Alova.Post<SubmitFeedbackResult>(
    `${CHAT_DASHBOARD_SESSIONS}/${sessionId}/messages/${messageId}/feedback`,
    { feedback }
  );
};

export const regenerateDashboardChatMessage = (sessionId: string, messageId: string) => {
  return Alova.Post<SendMessageResult>(
    `${CHAT_DASHBOARD_SESSIONS}/${sessionId}/messages/${messageId}/regenerate`
  );
};
