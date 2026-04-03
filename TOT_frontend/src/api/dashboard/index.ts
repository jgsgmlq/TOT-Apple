import { Alova } from '@/utils/http/alova/index';

export const getDashboardOverview = (params?: any) => {
  return Alova.Get<any>('/dashboard/overview', { params, localCache: 0 });
};

export const getDashboardHeatmap = (params?: any) => {
  return Alova.Get<any>('/dashboard/heatmap', { params, localCache: 0 });
};

export const getDashboardWarnings = (params?: any) => {
  return Alova.Get<any>('/dashboard/warnings', { params, localCache: 0 });
};
