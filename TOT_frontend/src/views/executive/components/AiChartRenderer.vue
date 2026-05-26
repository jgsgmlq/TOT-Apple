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
    const { type: rawType = 'bar', title = '', xAxis = [], series = [] } = props.data || {};

    // 后端可能返回 funnel/radar 等类型，前端 ECharts 降级到同类笛卡尔图
    const SUPPORTED = ['bar', 'line', 'pie', 'scatter', 'funnel'];
    const type = SUPPORTED.includes(rawType) ? rawType : 'bar';
    const isCartesian = type !== 'pie';

    const option: any = {
      title: {
        text: title,
        left: 'center',
        textStyle: { fontSize: 14, color: '#5f6b7a', fontWeight: 600 },
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
        textStyle: { fontSize: 12, color: '#5f6b7a' },
      },
      dataZoom: isCartesian ? [{ type: 'inside', start: 0, end: 100 }] : undefined,
    };

    if (isCartesian) {
      option.xAxis =
        type === 'scatter'
          ? {
              type: 'value',
              splitLine: { show: true, lineStyle: { type: 'dashed', color: '#f0f2f5' } },
              axisLine: { lineStyle: { color: '#e2e6ed' } },
            }
          : {
              type: 'category',
              data: xAxis,
              axisLabel: { interval: 'auto', rotate: 30, color: '#5f6b7a' },
              axisLine: { lineStyle: { color: '#e2e6ed' } },
            };

      option.yAxis = {
        type: 'value',
        splitLine: { show: true, lineStyle: { type: 'dashed', color: '#f0f2f5' } },
        axisLabel: { color: '#8f99a8' },
      };
    }

    // 漏斗 → 水平柱状图：数值绝对诚实，梯形不撒谎
    if (type === 'funnel') {
      option.yAxis = {
        type: 'category',
        data: xAxis,
        inverse: true,
        axisLabel: { color: '#5f6b7a', fontSize: 12 },
        axisLine: { show: false },
        axisTick: { show: false },
      };
      option.xAxis = {
        type: 'value',
        splitLine: { show: true, lineStyle: { type: 'dashed', color: '#f0f2f5' } },
        axisLabel: { color: '#8f99a8' },
      };
      option.grid = { left: '18%', right: '12%', bottom: '5%', top: '8%', containLabel: true };
      delete option.dataZoom;
      delete option.legend;
      const rawData = series[0]?.data || [];
      option.tooltip = {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params;
          if (!p) return '';
          const idx = p.dataIndex ?? 0;
          const name = p.name ?? '';
          const value = p.value ?? 0;
          let html = `<b>${name}</b><br/>人数: <b>${value}</b>`;
          if (idx > 0) {
            const prev = rawData[idx - 1];
            const rate = prev > 0 ? ((value / prev) * 100).toFixed(1) : '—';
            html += `<br/>相对「${xAxis[idx - 1]}」留存: <b>${rate}%</b>`;
          }
          return html;
        },
      };
    }

    const highlights = (props.data as any).highlights || [];

    // Precision Dashboard 色板（色盲友好）
    const SERIES_PALETTE = [
      '#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed',
      '#0891b2', '#db2777', '#4f46e5', '#65a30d', '#ea580c',
    ];

    // 检测是否需要双 Y 轴：series 中有不同的 yAxisIndex
    const hasDualAxis = series.some((s: any) => s.yAxisIndex === 1);

    if (hasDualAxis) {
      option.yAxis = [
        {
          type: 'value',
          name: '%',
          splitLine: { show: true, lineStyle: { type: 'dashed', color: '#f0f2f5' } },
          axisLabel: { color: '#5f6b7a' },
        },
        {
          type: 'value',
          name: '#',
          splitLine: { show: false },
          axisLabel: { color: '#8f99a8' },
        },
      ];
    }

    option.series = series.map((s, idx) => {
      const item: any = {
        name: s.name || '',
        type: type === 'funnel' ? 'bar' : (['bar', 'line', 'pie', 'scatter'].includes(type) ? type : 'bar'),
        data: s.data || [],
        itemStyle: { borderRadius: type === 'bar' || type === 'funnel' ? [4, 4, 0, 0] : 0 },
      };

      // 双 Y 轴：系列可指定使用右轴
      if (hasDualAxis && (s as any).yAxisIndex === 1) {
        item.yAxisIndex = 1;
      }

      // 颜色：优先用系列自己的颜色，其次调色板
      if (!type.includes('pie')) {
        const seriesColor = (s as any).color;
        item.itemStyle = {
          ...item.itemStyle,
          color: seriesColor || SERIES_PALETTE[idx % SERIES_PALETTE.length],
        };
      }

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

      if (type === 'funnel') {
        item.label = {
          show: true,
          position: 'right',
          fontSize: 11,
          color: '#5f6b7a',
          formatter: (params: any) => `${params.value}人`,
        };
        item.itemStyle = {
          borderRadius: [0, 4, 4, 0],
          color: '#2563eb',
        };
      }

      // 动态高亮：将高亮的 dataIndex 标为强调色
      if (highlights.length && type === 'bar') {
        const baseColor = (s as any).color || SERIES_PALETTE[idx % SERIES_PALETTE.length];
        item.itemStyle.color = (params: any) => {
          return highlights.includes(params.dataIndex) ? '#f59e0b' : baseColor;
        };
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
