import { Alova } from '@/utils/http/alova/index';

/** PUT /assignments/:id/status 成功响应 */
export interface AssignmentStatusResponse {
  assignmentId: string;
  status: string;
  progress: number;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  resolvedNudgeCount?: number;
  platformStatus: {
    mypalCompleted: boolean;
    smartsellCompleted: boolean;
    aiDemoCompleted: boolean;
    liveBroadcastCompleted: boolean;
  };
}

/**
 * 更新 assignment 状态（开始任务 / 完成平台 / 整单完成）
 */
export const putAssignmentStatus = (
  assignmentId: string,
  body: {
    operationType: 'start_task' | 'complete_platform' | 'complete_task';
    platform?: string;
  }
) => {
  return Alova.Put<AssignmentStatusResponse>(`/assignments/${assignmentId}/status`, body);
};
