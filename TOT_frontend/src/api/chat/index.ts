import { Alova } from '@/utils/http/alova/index';

export interface ReplyContent {
  overview: string;
  keyNumbers: Array<{ label: string; value: string; unit?: string }>;
  attentionPoints: string[];
  followUpSuggestions: string[];
}

export interface CreateSessionResult {
  sessionId: string;
  contextId: string;
  exampleQuestions: string[];
}

export interface SendMessageResult {
  messageId: string;
  replyContent: ReplyContent;
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

/** 将后端 replyContent 格式化为气泡内展示文本 */
export function formatReplyContentText(rc: ReplyContent | null | undefined): string {
  if (!rc) return '';
  let text = rc.overview || '';
  if (rc.keyNumbers?.length) {
    text += '\n\n📊 关键数据：\n' + rc.keyNumbers.map((k) => `• ${k.label}：${k.value}${k.unit || ''}`).join('\n');
  }
  if (rc.attentionPoints?.length) {
    text += '\n\n⚠️ 关注点：\n' + rc.attentionPoints.map((p) => `• ${p}`).join('\n');
  }
  if (rc.followUpSuggestions?.length) {
    text += '\n\n💡 ' + rc.followUpSuggestions.join(' / ');
  }
  return text.trim() || '（暂无摘要）';
}

/**
 * 创建 Executive Chat 会话
 */
export const createChatSession = () => {
  return Alova.Post<CreateSessionResult>('/chat/executive/sessions');
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
