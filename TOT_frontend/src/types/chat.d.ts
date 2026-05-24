export interface ChartData {
  type: 'bar' | 'line' | 'pie' | 'scatter' | 'funnel';
  title?: string;
  xAxis?: string[]; // 用于直角坐标系（Bar/Line/Scatter）
  series: {
    name: string;
    data: (number | number[])[]; // Scatter 图可能使用 [x, y] 数组
  }[];
  disclaimer?: string; // 预测或口径免责声明
}
