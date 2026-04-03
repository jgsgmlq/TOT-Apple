import { Alova } from '@/utils/http/alova/index';

/**
 * 任务对象结构
 */
export interface TaskItem {
  id: string;
  title: string;
  description: string | null;
  hasMypal: boolean;
  hasSmartSell: boolean;
  hasAiDemo: boolean;
  hasLiveBroadcast: boolean;
  status: 'draft' | 'dispatched';
  rtmFilter: object[] | null;
  storeScope: 'all' | string[];
  ddlAt: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 创建培训任务
 */
export const createTask = (data: {
  title: string;
  description?: string;
  hasMypal?: boolean;
  hasSmartSell?: boolean;
  hasAiDemo?: boolean;
  hasLiveBroadcast?: boolean;
  ddlAt: string;
  rtmFilter?: any;
  storeScope?: string | string[];
}) => {
  return Alova.Post<TaskItem>('/tasks', data);
};

/**
 * 获取任务详情
 */
export const getTaskDetail = (id: string) => {
  return Alova.Get<TaskItem>(`/tasks/${id}`, { localCache: 0 });
};

/**
 * 更新任务字段
 */
export const updateTask = (id: string, data: Partial<TaskItem>) => {
  return Alova.Patch<TaskItem>(`/tasks/${id}`, data);
};

/**
 * 下发培训任务
 */
export const dispatchTask = (id: string) => {
  return Alova.Post<{
    task: TaskItem;
    matchedStoreCount: number;
    targetUserCount: number;
    assignmentCreated: number;
    notificationCreated: number;
  }>(`/tasks/${id}/dispatch`);
};

/**
 * 获取任务列表
 */
export const getTaskList = () => {
  // Alova 默认对 GET 请求有强缓存，这里强制关闭，保证每次拉取最新数据
  return Alova.Get<TaskItem[]>('/tasks', { localCache: 0 });
};

/**
 * 删除任务
 */
export const deleteTask = (id: string) => {
  return Alova.Delete(`/tasks/${id}`);
};

/**
 * AI 辅助生成任务下发说明
 */
export const aiGenerateTaskDescription = (data: {
  instruction: string;
  ddlAt?: string;
  platforms?: string[];
}) => {
  return Alova.Post<{ description: string }>('/tasks/ai-generate-description', data);
};
