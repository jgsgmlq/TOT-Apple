<template>
  <div class="chart-root">
    <div ref="chartRef" :style="{ height, width }"></div>
    <button type="button" class="chart-download-btn" title="下载PNG" @click.stop="handleDownload">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
    </button>
  </div>
</template>

<script lang="ts" setup>
  import { ref, onMounted, watch, computed, nextTick } from 'vue';
  import { useECharts } from '@/hooks/web/useECharts';
  import type { ChartData } from '@/types/chat';

  const props = withDefaults(
    defineProps<{
      data: ChartData;
      width?: string;
      height?: string;
    }>(),
    {
      width: '100%',
      height: '300px',
    }
  );

  const chartRef = ref<HTMLDivElement | null>(null);
  const { setOptions, getInstance, resize } = useECharts(chartRef as any);

  const options = computed(() => {
    const { type = 'bar', title = '', xAxis = [], series = [] } = props.data || {};
    const isCartesian = ['bar', 'line', 'scatter'].includes(type);

    const option: any = {
      title: { text: title, left: 'center', textStyle: { fontSize: 14, color: '#334155' } },
      tooltip: { trigger: type === 'pie' ? 'item' : 'axis', confine: true, position: (pos: any) => [pos[0], '10%'] },
      grid: { left: '4%', right: '8%', bottom: '15%', top: '18%', containLabel: true },
      legend: { bottom: 0, itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 12, color: '#64748b' } },
      dataZoom: isCartesian ? [{ type: 'inside', start: 0, end: 100 }] : undefined,
    };

    if (type === 'bar' && xAxis.length > 0) {
      option.barMaxWidth = Math.max(30, Math.min(60, Math.floor(600 / Math.max(xAxis.length, 1))));
      option.barCategoryGap = '30%';
    }

    if (isCartesian) {
      option.xAxis = type === 'scatter'
        ? { type: 'value', splitLine: { show: true, lineStyle: { type: 'dashed', color: '#f1f5f9' } } }
        : { type: 'category', data: xAxis, axisLabel: { rotate: 30, color: '#64748b' } };
      option.yAxis = { type: 'value', splitLine: { show: true, lineStyle: { type: 'dashed', color: '#f1f5f9' } } };
    }

    option.series = series.map((s: any) => ({
      name: s.name || '',
      type: ['bar', 'line', 'pie', 'scatter'].includes(type) ? type : 'bar',
      data: s.data || [],
      ...(type === 'bar' ? { itemStyle: { borderRadius: [4, 4, 0, 0], color: '#3b82f6' } } : {}),
      ...(type === 'line' ? { smooth: true, symbolSize: 6 } : {}),
      ...(type === 'pie' ? { radius: ['40%', '70%'], itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 } } : {}),
    }));

    return option;
  });

  const handleDownload = () => {
    const instance = getInstance();
    if (!instance) return;
    const dataUrl = instance.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#fff' });
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = ((props.data?.title || 'chart').replace(/[\\/:*?"<>|\\s]+/g, '_')) + '.png';
    link.click();
  };

  watch(() => props.data, () => setOptions(options.value), { deep: true });
  onMounted(() => {
    setOptions(options.value);
    nextTick(() => { setTimeout(() => resize?.(), 200); setTimeout(() => resize?.(), 600); });
  });
</script>

<style scoped>
  .chart-root { position: relative; width: 100%; min-height: 300px; }
  .chart-download-btn {
    position: absolute; top: 4px; right: 4px;
    display: flex; align-items: center; justify-content: center;
    width: 28px; height: 28px; border: none; border-radius: 6px;
    background: rgba(255,255,255,0.85); color: #94a3b8; cursor: pointer;
    z-index: 2;
  }
  .chart-download-btn:hover { background: #f1f5f9; color: #475569; }
</style>
