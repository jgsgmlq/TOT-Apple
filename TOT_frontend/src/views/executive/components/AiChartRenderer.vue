<template>
  <div ref="chartRef" :style="{ height, width }"></div>
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

  const options = computed(() => {
    const { type = 'bar', title = '', xAxis = [], series = [] } = props.data || {};

    const isCartesian = ['bar', 'line', 'scatter'].includes(type);

    const option: any = {
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

      // 动态高亮逻辑 (Safely handle highlights array index)
      if (highlights.length && type === 'bar') {
        item.itemStyle.color = (params: any) => {
          return highlights.includes(params.dataIndex) ? '#f59e0b' : '#3b82f6';
        };
      } else if (type === 'bar') {
        // default uniform color for bars if no highlights
        item.itemStyle.color = '#3b82f6';
      }

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
    setOptions(options.value);
  });
</script>
