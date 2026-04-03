import { Alova } from '@/utils/http/alova/index';

/** GET /api/v1/dashboard/overview */
export interface DashboardOverview {
  totalAssignments: number;
  completionRate: number;
  completedCount: number;
  onTimeCompletionRate: number;
  avgCompletionTimeHours: number;
  taskReachRate: number;
  taskReadRate: number;
  nudgeConversionRate: number;
  startDelayRate: number;
  crisisP0Rate: number;
  crisisP1Rate: number;
  inProgressCount: number;
  pendingCount: number;
  overdueCount: number;
  updatedAt?: string;
}

export const getDashboardOverview = (params: { taskId?: string; rtm?: string; format?: string }) => {
  return Alova.Get<DashboardOverview>('/dashboard/overview', {
    params,
    localCache: 0,
  });
};

export interface HeatmapRow {
  rtmValue: string;
  completionRate: number;
  avgCompletionTimeHours: number;
  color?: string;
  assignmentCount: number;
  completedCount: number;
}

/** GET /api/v1/dashboard/heatmap */
export const getDashboardHeatmap = (params: { taskId: string; rtmLevel?: string }) => {
  return Alova.Get<{ taskId: string; rtmLevel: string; heatmapData: HeatmapRow[]; updatedAt: string }>(
    '/dashboard/heatmap',
    { params: { ...params, rtmLevel: params.rtmLevel ?? 'rtm' }, localCache: 0 }
  );
};

export interface TrendPoint {
  timeKey: string;
  newCompleted: number;
  cumulativeCompleted: number;
}

/** GET /api/v1/dashboard/trend */
export const getDashboardTrend = (params: { taskId: string; type: 'daily' | 'hourly'; date?: string }) => {
  return Alova.Get<{ taskId: string; type: string; date: string; trendData: TrendPoint[] }>(
    '/dashboard/trend',
    { params, localCache: 0 }
  );
};
