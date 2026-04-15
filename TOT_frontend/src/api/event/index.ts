import { Alova } from '@/utils/http/alova/index';

export interface EventItem {
  eventId: string;
  eventType: string; // task_assigned/nudge_yellow/nudge_red/task_updated
  taskId: string;
  assignmentId: string | null;
  targetUserId: string;
  storeId: string;
  severity: string | null;
  ruleType: string | null;
  isActive: boolean;
  resolvedAt: string | null;
  readStatus: boolean;
  readAt: string | null;
  initiatorId: string | null;
  initiatorRole: string | null;
  createdAt: string;
}

export const getEvents = (params?: any) => {
  return Alova.Get<{ list: EventItem[]; pagination: any; unreadCount: number }>('/events', {
    params,
    localCache: 0,
  });
};

export const getUnreadCount = () => {
  return Alova.Get<{ unreadCount: number }>('/events/unread-count', { localCache: 0 });
};
