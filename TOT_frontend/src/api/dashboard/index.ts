import { Alova } from '@/utils/http/alova/index';

/** GET /api/v1/dashboard/overview — 概览 KPI（人均完成时间、按时完成率、预警率、触达/读取/催办转化等） */
export interface DashboardOverview {
  totalAssignments: number;
  /** 整体完成人数占比（已完成/总人数） */
  completionRate: number;
  completedCount: number;
  /** 在 ddl 前完成的人数占比 */
  onTimeCompletionRate: number;
  /** 人均完成时间（小时），仅统计已完成 assignment */
  avgCompletionTimeHours: number;
  /** 触达率：后端当前实现为「有下发即视为触达」时常为 100 */
  taskReachRate: number;
  /** 读取率：已读人数 / 总 assignment 数 */
  taskReadRate: number;
  /** 催办转化率：被催办且已开始或已完成 / 被催办总数 */
  nudgeConversionRate: number;
  /** 起步异常预警事件数 / 总人数 */
  startDelayRate: number;
  crisisP0Rate: number;
  crisisP1Rate: number;
  inProgressCount: number;
  pendingCount: number;
  overdueCount: number;
  pushUserCount?: number;
  employeeReadCount?: number;
  managerReadCount?: number;
  totalReadCount?: number;
  warningCount?: { p1: number; p2: number };
  updatedAt?: string;
}

export const getDashboardOverview = (params: {
  taskId?: string;
  rtm?: string;
  format?: string;
}) => {
  return Alova.Get<DashboardOverview>('/dashboard/overview', {
    params,
    localCache: 0,
  });
};

export interface HeatmapRow {
  rtmValue: string;
  completionRate: number;
  /** 区域维度人均完成耗时（小时），仅已完成样本 */
  avgCompletionTimeHours: number;
  color?: string;
  assignmentCount: number;
  completedCount: number;
}

/** GET /api/v1/dashboard/heatmap — 区域热力，含 avgCompletionTimeHours */
export const getDashboardHeatmap = (params: { taskId: string; rtmLevel?: string }) => {
  return Alova.Get<{
    taskId: string;
    rtmLevel: string;
    heatmapData: HeatmapRow[];
    updatedAt: string;
  }>('/dashboard/heatmap', {
    params: { ...params, rtmLevel: params.rtmLevel ?? 'rtm' },
    localCache: 0,
  });
};

export interface TrendPoint {
  timeKey: string;
  newCompleted: number;
  cumulativeCompleted: number;
}

/** GET /api/v1/dashboard/trend — 按日/按小时完成人数趋势 */
export const getDashboardTrend = (params: {
  taskId: string;
  type: 'daily' | 'hourly';
  date?: string;
}) => {
  return Alova.Get<{ taskId: string; type: string; date: string; trendData: TrendPoint[] }>(
    '/dashboard/trend',
    { params, localCache: 0 }
  );
};
