<template>
  <div class="gallery-container">
    <div class="gallery-header">
      <h2>Executive Chat 图表展厅 (Mock Gallery)</h2>
      <p>用于验证各种图表类型及其在极限数据下的表现</p>
    </div>

    <div class="gallery-content">
      <div v-for="(demo, index) in mockCharts" :key="index" class="demo-card">
        <h3>{{ demo.title }}</h3>
        <p class="demo-desc">{{ demo.description }}</p>
        <div class="chart-wrapper">
          <AiChartRenderer :data="demo.chartData" />
        </div>
        <div v-if="demo.chartData.highlights" class="demo-meta">
          高亮索引: {{ demo.chartData.highlights.join(', ') }}
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
  import AiChartRenderer from './components/AiChartRenderer.vue';
  import type { ChartData } from '@/types/chat';

  const mockCharts: { title: string; description: string; chartData: ChartData }[] = [
    {
      title: '柱状图 - 完成时间分布',
      description: '常规分析场景，展示不同时间段的完成人数。',
      chartData: {
        type: 'bar',
        title: '任务完成时刻分布',
        xAxis: ['0-4h', '4-8h', '8-24h', '24-48h', '48h+'],
        series: [{ name: '完成人数', data: [12, 45, 120, 30, 8] }],
        highlights: [2], // 高亮峰值
      },
    },
    {
      title: '折线图 - 达成率预测',
      description: '展示历史趋势并预测未来。',
      chartData: {
        type: 'line',
        title: '整体达成率趋势与预测',
        xAxis: ['10:00', '11:00', '12:00', '13:00', '14:00 (预估)', '15:00 (预估)'],
        series: [{ name: '达成率', data: [15, 28, 42, 60, 72, 85] }],
      },
    },
    {
      title: '散点图 - 相关性分析',
      description: '起步异常率 vs 最终完成率。',
      chartData: {
        type: 'scatter',
        title: '起步异常率 vs 完成率相关性',
        series: [
          {
            name: '门店数据',
            data: [
              [10, 85],
              [20, 70],
              [35, 50],
              [50, 40],
              [5, 95],
              [60, 20],
              [25, 65],
            ],
          },
        ],
      },
    },
    {
      title: '饼图 - 渠道占比',
      description: '各渠道培训人数占比。',
      chartData: {
        type: 'pie',
        title: '各渠道学习人数分布',
        series: [
          {
            name: '渠道',
            data: [
              { value: 1048, name: 'Education' },
              { value: 735, name: 'Lifestyle' },
              { value: 580, name: 'Mono' },
              { value: 484, name: 'OTC' },
            ],
          },
        ],
      },
    },
    {
      title: '极限数据测试 - 大量分类',
      description: '验证 30+ 个分类在移动端是否拥挤（应触发自适应旋转/DataZoom）。',
      chartData: {
        type: 'bar',
        title: '多门店完成率对比',
        xAxis: Array.from({ length: 30 }, (_, i) => `门店 ${i + 1}`),
        series: [
          {
            name: '完成率',
            data: Array.from({ length: 30 }, () => Math.floor(Math.random() * 100)),
          },
        ],
      },
    },
  ];
</script>

<style scoped>
  .gallery-container {
    padding: 20px;
    background: #f0f2f5;
    min-height: 100vh;
  }
  .gallery-header {
    text-align: center;
    margin-bottom: 30px;
  }
  .gallery-content {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
    gap: 20px;
  }
  @media (max-width: 600px) {
    .gallery-content {
      grid-template-columns: 1fr;
    }
  }
  .demo-card {
    background: #fff;
    border-radius: 8px;
    padding: 20px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }
  .demo-desc {
    font-size: 14px;
    color: #666;
    margin-bottom: 15px;
  }
  .chart-wrapper {
    border: 1px solid #eee;
    border-radius: 4px;
    margin-bottom: 10px;
  }
  .demo-meta {
    font-size: 12px;
    color: #999;
  }
</style>
