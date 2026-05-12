import { Alova } from '@/utils/http/alova/index';
import { streamSsePostJson } from '@/utils/http/ssePostStream';

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
  /** 触达率 */
  taskReachRate: number;
  /** 读取率：已读人数 / 总 assignment 数 */
  taskReadRate: number;
  /** 催办转化率：被催办且已开始或已完成 / 被催办总数 */
  nudgeConversionRate: number;
  /** 起步异常预警事件数 / 总人数 */
  startDelayRate: number;
  crisisP0Rate: number;
  crisisP1Rate: number;
  crisisP2Rate: number;
  inProgressCount: number;
  pendingCount: number;
  overdueCount: number;
  pushUserCount?: number;
  employeeReadCount?: number;
  managerReadCount?: number;
  totalReadCount?: number;
  warningCount?: { p2: number; p1: number; p0: number };
  /** 已确认人数 = inProgress + completed */
  confirmedCount: number;
  /** 确认率 = confirmedCount / totalAssignments × 100 */
  confirmationRate: number;
  /** 催办通知各严重级别的去重人头绝对数 */
  nudgeSeverityCounts: { p2: number; p1: number; p0: number };
  /** 较昨日的完成率变化（百分点），已含正负号 */
  completionRateDelta: number;
  /** 距离截止时间的剩余秒数；负值表示已过期 */
  remainingSeconds: number;
  updatedAt?: string;
}

export const getDashboardOverview = (params: {
  taskId?: string;
  platform?: string;
  rtm?: string;
  format?: string;
  dealerName?: string;
  storeId?: string;
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
  /** 预格式化的人均耗时展示字符串，如 "2.5h" / "< 0.1h" / "-" */
  avgTimeFormatted: string;
  color?: string;
  assignmentCount: number;
  completedCount: number;
}

/** GET /api/v1/dashboard/heatmap — 区域热力，含 avgCompletionTimeHours */
export const getDashboardHeatmap = (params: {
  taskId: string;
  platform?: string;
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
  platform?: string;
  type: 'daily' | 'hourly';
  date?: string;
  rtm?: string;
  format?: string;
  dealerName?: string;
  storeId?: string;
}) => {
  return Alova.Get<{ taskId: string; type: string; date: string; trendData: TrendPoint[] }>(
    '/dashboard/trend',
    { params, localCache: 0 }
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
  platform?: string;
  type: 'top' | 'bottom';
  limit?: number;
  rtm?: string;
  format?: string;
  dealerName?: string;
  storeId?: string;
}) => {
  return Alova.Get<{ rankList: StoreRankRow[] }>('/dashboard/store-rank', {
    params,
    localCache: 0,
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
  platform?: string;
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
    localCache: 0,
  });
};

export interface NudgeConversionRow {
  targetId: string;
  targetName: string;
  targetType: string;
  red: { nudged: number; converted: number; rate: number };
  orange: { nudged: number; converted: number; rate: number };
  yellow: { nudged: number; converted: number; rate: number };
  total: { nudged: number; converted: number; rate: number };
}

/** GET /api/v1/dashboard/nudge-conversion — 催办转化率统计报表 */
export const getDashboardNudgeConversion = (params: {
  taskId: string;
  platform?: string;
  pageNum?: number;
  pageSize?: number;
  level?: string;
  rtm?: string;
  format?: string;
  dealerName?: string;
  storeId?: string;
}) => {
  return Alova.Get<{
    list: NudgeConversionRow[];
    pagination: { pageNum: number; pageSize: number; total: number; totalPages: number };
  }>('/dashboard/nudge-conversion', {
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
  platform?: string;
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

/** Streaming wrapper for POST /api/v1/dashboard/insights（与 Executive Chat 共用 streamSsePostJson） */
export const streamDashboardInsight = async (
  data: CreateDashboardInsightBody,
  onMessage: (chunk: { text: string; phase?: string }) => void,
  onComplete: (fullData: DashboardInsightResult) => void,
  onError: (error: unknown) => void
) => {
  return streamSsePostJson({
    path: '/dashboard/insights',
    body: { ...data } as Record<string, unknown>,
    onDelta: onMessage,
    onDone: (d) => onComplete(d as DashboardInsightResult),
    onError,
    fallbackErrorMessage: '智能洞察流式生成失败',
  });
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

export interface DashboardAgentTaskInsight {
  taskId: string;
  title: string;
  severity: 'red' | 'orange' | 'green';
  insight: string;
  focusModule: string;
  progress: number;
}

export interface DashboardAgentInsightResult {
  redCount: number;
  orangeCount: number;
  greenCount: number;
  topTasks: DashboardAgentTaskInsight[];
  overallSummary: string;
  allTasks: DashboardAgentTaskInsight[];
  generatedAt: string;
}

export const getDashboardAgentInsight = (params?: { refresh?: boolean }) => {
  return Alova.Get<DashboardAgentInsightResult>('/dashboard/agent/diagnose', {
    params,
    meta: {
      skipAuthRedirect: true,
      skipGlobalErrorMessage: true,
    },
  });
};

/** ─── GET /api/v1/dashboard/funnel — 转化漏斗（大盘 + 下钻） ─── */

export interface FunnelStageData {
  stage: 'pushed' | 'delivered' | 'in_progress' | 'completed';
  label: string;
  count: number;
  /** 占首阶段百分比，0–100 */
  sharePercent: number;
  /** 较上一阶段流失百分比，0–100；首阶段为 0 */
  dropPercent: number;
  /** 与上一阶段的 sharePercent 差值，用于红色流失条宽度；首阶段为 0 */
  dropWidth: number;
}

export interface FunnelBoardResponse {
  taskId: string | null;
  platform: string | null;
  stages: FunnelStageData[];
  updatedAt: string;
}

export interface FunnelDrillDownRow {
  name: string;
  total: number;
  count: number;
  /** count / total，0–1 */
  rate: number;
}

export interface FunnelDrillDownResponse {
  taskId: string;
  funnelStage: string;
  rtmLevel: string;
  platform: string | null;
  rows: FunnelDrillDownRow[];
  updatedAt: string;
}

/** 大盘转化漏斗（不传 funnelStage） */
export const getDashboardFunnel = (params: {
  taskId?: string;
  platform?: string;
  rtm?: string;
  format?: string;
  dealerName?: string;
  storeId?: string;
}) => {
  return Alova.Get<FunnelBoardResponse>('/dashboard/funnel', {
    params,
    localCache: 0,
  });
};

/** 下钻明细（传 funnelStage + rtmLevel） */
export const getDashboardFunnelDrillDown = (params: {
  taskId: string;
  funnelStage: string;
  rtmLevel?: string;
  platform?: string;
  rtm?: string;
  format?: string;
  dealerName?: string;
  storeId?: string;
}) => {
  return Alova.Get<FunnelDrillDownResponse>('/dashboard/funnel', {
    params,
    localCache: 0,
  });
};

/** ─── GET /api/v1/dashboard/funnel?type=alert — 预警漏斗（大盘 + 下钻） ─── */

export interface AlertFunnelStageData {
  stage: 'P2' | 'P1' | 'P0' | 'Unfinished';
  label: string;
  /** 级联后人数（漏斗条用） */
  count: number;
  /** 原始带人数（卡片展示用，级联前） */
  rawCount: number;
  /** 占最宽阶段百分比，0–100（级联后，漏斗条用） */
  width: number;
  /** 本阶段转化率（被拯救比例），0–100；null 表示"未触发" */
  conversionRate: number | null;
  /** 占总人数百分比，0–100（级联后） */
  percentageOfTotal: number;
  /** 占总人数百分比，0–100（级联前，卡片展示用） */
  rawPercentageOfTotal: number;
}

export interface AlertFunnelResponse {
  taskId: string | null;
  platform: string | null;
  stages: AlertFunnelStageData[];
  /** 整体转化率（P2 → 当前最后触发阶段），0–100；null 表示未进入任何阶段 */
  overallConversionRate: number | null;
  maxCount: number;
  updatedAt: string;
}

export interface AlertDrillDownRow {
  name: string;
  totalEmployees: number;
  completedCount: number;
  riskCount: number;
  riskRate: number;
  nudged?: number;
  converted?: number;
  conversionRate?: number;
}

export interface AlertDrillDownResponse {
  taskId: string;
  alertLevel: string;
  dimension: string;
  platform: string | null;
  rows: AlertDrillDownRow[];
  updatedAt: string;
}

/** 预警漏斗大盘（type=alert，不传 alertLevel） */
export const getDashboardAlertFunnel = (params: { taskId?: string; platform?: string }) => {
  return Alova.Get<AlertFunnelResponse>('/dashboard/funnel', {
    params: { ...params, type: 'alert' },
    localCache: 0,
  });
};

/** 预警下钻（type=alert + alertLevel + rtmLevel） */
export const getDashboardAlertDrillDown = (params: {
  taskId: string;
  alertLevel: string;
  rtmLevel?: string;
  platform?: string;
  rtm?: string;
  format?: string;
  dealerName?: string;
}) => {
  return Alova.Get<AlertDrillDownResponse>('/dashboard/funnel', {
    params: { ...params, type: 'alert' },
    localCache: 0,
  });
};

/** ─── GET /api/v1/dashboard/alerts-unified — 预警列表四合一 ─── */

export interface UnifiedAlertRow {
  alert_id: string;
  level: string;
  description: string;
  related_entity: string;
  storeName: string;
  total_employees: number;
  completed_count: number;
  risk_rate: number;
  aiSuggestion?: string;
  rtm3: string;
  rtm4: string;
  dealer: string;
  store: string;
}

export interface UnifiedAlertsResponse {
  taskId: string | null;
  platform: string | null;
  list: UnifiedAlertRow[];
  total: number;
  updatedAt: string;
}

export const getUnifiedAlerts = (params: { taskId: string; platform?: string }) => {
  return Alova.Get<UnifiedAlertsResponse>('/dashboard/alerts-unified', {
    params,
    localCache: 0,
  });
};
