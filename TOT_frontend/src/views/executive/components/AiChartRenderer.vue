<template>
  <div v-if="data.type === 'big_number'" class="big-number-card">
    <div class="bn-value">{{ displayValue }}<span class="bn-unit">{{ displayUnit }}</span></div>
    <div class="bn-label">{{ data.title || '' }}</div>
  </div>
  <div v-else ref="chartRef" :style="{ height, width }"></div>
</template>

<script lang="ts" setup>
  import { ref, onMounted, watch, computed } from 'vue';
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
  const { setOptions } = useECharts(chartRef as any);

  const displayValue = computed(() => props.data?.series?.[0]?.data?.[0] ?? '--');
  const displayUnit = computed(() => {
    const name = props.data?.series?.[0]?.name || '';
    const m = name.match(/\((.+)\)$/);
    return m ? m[1] : '';
  });

  const options = computed(() => {
    if (props.data?.type === 'big_number') return {};
    const { type = 'bar', title = '', xAxis = [], series = [] } = props.data || {};
    const isCartesian = ['bar', 'line', 'scatter'].includes(type);

    // 多系列配色（区分度好、色盲友好）
    const colorPalette = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#84cc16', '#ec4899'];

    const option: any = {
      color: colorPalette,
      title: {
        text: title,
        left: 'center',
        textStyle: { fontSize: 14, color: '#334155' },
      },
      tooltip: {
        trigger: type === 'pie' ? 'item' : 'axis',
        confine: true,
        position: (pos: any) => [pos[0], '10%'],
      },
      grid: {
        left: '4%',
        right: '4%',
        bottom: '15%',
        top: '18%',
        containLabel: true,
      },
      legend: {
        bottom: 0,
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { fontSize: 12, color: '#64748b' },
      },
      dataZoom: isCartesian ? [{ type: 'inside', start: 0, end: 100 }] : undefined,
    };

    if (isCartesian) {
      option.xAxis =
        type === 'scatter'
          ? {
              type: 'value',
              splitLine: { show: true, lineStyle: { type: 'dashed', color: '#f1f5f9' } },
              axisLine: { lineStyle: { color: '#cbd5e1' } },
            }
          : {
              type: 'category',
              data: xAxis,
              axisLabel: { interval: 'auto', rotate: 30, color: '#64748b' },
              axisLine: { lineStyle: { color: '#cbd5e1' } },
            };

      option.yAxis = {
        type: 'value',
        splitLine: { show: true, lineStyle: { type: 'dashed', color: '#f1f5f9' } },
        axisLabel: { color: '#64748b' },
      };
    }

    const highlights = (props.data as any).highlights || [];

    option.series = series.map((s) => {
      const item: any = {
        name: s.name || '',
        type: ['bar', 'line', 'pie', 'scatter'].includes(type) ? type : 'bar', // fallback
        data: s.data || [],
        itemStyle: { borderRadius: type === 'bar' ? [4, 4, 0, 0] : 0 }, // Add rounded top corners to bars
      };

      if (type === 'pie') {
        item.radius = ['40%', '70%'];
        item.avoidLabelOverlap = false;
        item.itemStyle = { borderRadius: 6, borderColor: '#fff', borderWidth: 2 };
        item.label = { show: false, position: 'center' };
        item.emphasis = { label: { show: true, fontSize: 16, fontWeight: 'bold' } };
      }

      if (type === 'line') {
        item.smooth = true;
        item.symbolSize = 6;
      }

      // 颜色策略：单系列→统一蓝，多系列→ECharts 内置调色板自动区分
      // 内置调色板: ['#5470c6','#91cc75','#fac858','#ee6666','#73c0de','#3ba272','#fc8452','#9a60b4','#ea7ccc']
      if (highlights.length && type === 'bar') {
        item.itemStyle.color = (params: any) => {
          return highlights.includes(params.dataIndex) ? '#f59e0b' : '#3b82f6';
        };
      } else if (type === 'bar' && series.length === 1) {
        item.itemStyle.color = '#3b82f6';
      }
      // 多系列不设 color，让 ECharts 内置调色板自动分配不同颜色

      return item;
    });

    // 允许后端 customOptions 覆盖
    if ((props.data as any).customOptions) {
      Object.assign(option, (props.data as any).customOptions);
    }

    return option;
  });

  watch(
    () => props.data,
    () => {
      setOptions(options.value);
    },
    { deep: true }
  );

  onMounted(() => {
    if (props.data?.type !== 'big_number') setOptions(options.value);
  });
</script>

<style lang="less" scoped>
.big-number-card {
  text-align: center;
  padding: 20px 24px;
  margin: 8px 0;
  background: linear-gradient(180deg, rgba(37, 99, 235, 0.04), rgba(37, 99, 235, 0.01));
  border-radius: 14px;
  border: 1px solid rgba(37, 99, 235, 0.08);
}
.bn-value {
  font-size: 42px;
  font-weight: 700;
  color: #2563eb;
  line-height: 1.2;
}
.bn-unit {
  font-size: 20px;
  font-weight: 500;
  margin-left: 2px;
}
.bn-label {
  font-size: 14px;
  color: #64748b;
  margin-top: 6px;
}
</style>
