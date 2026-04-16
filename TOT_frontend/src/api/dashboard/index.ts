import { Alova } from '@/utils/http/alova/index';

/** GET /api/v1/dashboard/overview — 概览 KPI（人均完成时间、按时完成率、预警率、触达/读取/催办转化等） */
export interface DashboardOverview {
  totalAssignments: number;
  /** 整体完成人数占比（已完成/总人数），0–100，保留两位小数 */
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
  dealerName?: string;
  storeId?: string;
}) => {
  return Alova.Get<DashboardOverview>('/dashboard/overview', {
    params,
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
export const getDashboardHeatmap = (params: { 
  taskId: string; 
  rtmLevel?: string;
  rtm?: string;
  format?: string;
  dealerName?: string;
  storeId?: string;
}) => {
  return Alova.Get<{
    taskId: string;
    rtmLevel: string;
    heatmapData: HeatmapRow[];
    updatedAt: string;
  }>('/dashboard/heatmap', {
    params: { ...params, rtmLevel: params.rtmLevel ?? 'rtm' },
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
  rtm?: string;
  format?: string;
  dealerName?: string;
  storeId?: string;
}) => {
  return Alova.Get<{ taskId: string; type: string; date: string; trendData: TrendPoint[] }>(
    '/dashboard/trend',
    { params }
  );
};

export interface StoreRankRow {
  storeId: string;
  storeName: string;
  completionRate: number;
  assignmentCount: number;
  completedCount: number;
}

/** GET /api/v1/dashboard/store-rank — 门店排名下钻 */
export const getDashboardStoreRank = (params: {
  taskId: string;
  type: 'top' | 'bottom';
  limit?: number;
  rtm?: string;
  format?: string;
  dealerName?: string;
  storeId?: string;
}) => {
  return Alova.Get<{ rankList: StoreRankRow[] }>('/dashboard/store-rank', {
    params,
  });
};

export interface WarningStoreRow {
  taskId: string;
  storeId: string;
  storeName: string;
  warningLevel: 'p1' | 'p0' | 'startDelay';
  /** 与 GET /dashboard/overview 预警率同公式（单店范围）：起步异常=进度0未完成人数/店人数；临期=未完成人数/店人数（任务须在对应临期带） */
  warningRate: number;
  completionRate: number;
  completedCount: number;
  totalCount: number;
  overdueCount: number;
  triggerDesc?: string;
  aiSuggestion?: string;
  calculatedAt: string;
}

/** GET /api/v1/dashboard/warnings — 预警门店下钻（临期 p0/p1 或起步异常 startDelay） */
export const getDashboardWarnings = (params: {
  taskId: string;
  warningLevel?: 'p0' | 'p1' | 'startDelay';
  pageNum?: number;
  pageSize?: number;
  rtm?: string;
  format?: string;
  dealerName?: string;
  storeId?: string;
}) => {
  return Alova.Get<{
    list: WarningStoreRow[];
    pagination: { pageNum: number; pageSize: number; total: number; totalPages: number };
  }>('/dashboard/warnings', {
    params,
  });
};

/** POST /api/v1/dashboard/insights — 看板模块 AI 洞察 */
export type DashboardInsightType =
  | 'north_star'
  | 'completion_weekly'
  | 'completion_daily'
  | 'channel_north_star'
  | 'funnel_alerts';

export interface CreateDashboardInsightBody {
  insightType: DashboardInsightType;
  taskId?: string | null;
  rtm?: string;
  format?: string;
  dealerName?: string;
  storeId?: string;
  /** completion_daily 建议 YYYY-MM-DD */
  date?: string;
  trendType?: string;
  rtmLevel?: string;
  /** 是否使用深度思考 (deepseek-reasoner) */
  reasoning?: boolean;
  /** 旧版兼容 */
  module?: string;
}

export interface DashboardInsightResult {
  insightId: string;
  insightType: string;
  module: string;
  taskId: string | null;
  filters: {
    rtm: string | null;
    format: string | null;
    dealerName: string | null;
    storeId: string | null;
  };
  content: string;
  createdAt: string;
  voteSummary: { up: number; down: number };
}

export const postDashboardInsight = (data: CreateDashboardInsightBody) => {
  return Alova.Post<DashboardInsightResult>('/dashboard/insights', data);
};

/** Streaming wrapper for POST /api/v1/dashboard/insights */
export const streamDashboardInsight = async (
  data: CreateDashboardInsightBody,
  onMessage: (chunk: string) => void,
  onComplete: (fullData: DashboardInsightResult) => void,
  onError: (error: any) => void
) => {
  const { useUserStore } = await import('@/store/modules/user');
  const token = useUserStore().getToken;
  const { useGlobSetting } = await import('@/hooks/setting');
  const { apiUrl, urlPrefix } = useGlobSetting();
  
  let url = '/dashboard/insights';
  if (urlPrefix) url = `${urlPrefix}${url}`;
  if (apiUrl) url = `${apiUrl}${url}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let partialMessage = '';
    
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = (partialMessage + chunk).split('\n');
        partialMessage = lines.pop() || '';

        let currentEvent = 'message';
        for (let line of lines) {
          line = line.trim();
          if (!line) {
            currentEvent = 'message'; // reset after empty line
            continue;
          }

          if (line.startsWith('event:')) {
            currentEvent = line.replace(/^event:\s*/, '').trim();
          } else if (line.startsWith('data:')) {
            const dataStr = line.replace(/^data:\s*/, '').trim();
            if (dataStr === '[DONE]') continue;

            try {
              const parsed = JSON.parse(dataStr);
              if (currentEvent === 'delta') {
                onMessage(parsed);
              } else if (currentEvent === 'done') {
                const resultData = parsed.data !== undefined ? parsed.data : parsed;
                onComplete(resultData);
              }
            } catch (e) {
              // Ignore parse errors for incomplete JSON or weird chunks
            }
          }
        }
      }
    }
  } catch (error) {
    onError(error);
  }
};

/** POST /api/v1/dashboard/insights/{insightId}/vote — action 缺省为 add；remove 为取消对应计数 */
export const postDashboardInsightVote = (
  insightId: string,
  payload: { vote: 'up' | 'down'; action?: 'add' | 'remove' }
) => {
  return Alova.Post<{ insightId: string; up: number; down: number }>(
    `/dashboard/insights/${insightId}/vote`,
    payload
  );
};
