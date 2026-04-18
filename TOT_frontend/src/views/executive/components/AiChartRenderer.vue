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
    const { type, title, xAxis, series } = props.data;

    const isCartesian = ['bar', 'line', 'scatter'].includes(type);

    const option: any = {
      title: {
        text: title,
        left: 'center',
        textStyle: { fontSize: 14 },
      },
      tooltip: {
        trigger: type === 'pie' ? 'item' : 'axis',
        confine: true,
        position: (pos: any) => [pos[0], '10%'],
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '15%',
        containLabel: true,
      },
      legend: {
        bottom: 0,
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { fontSize: 12 },
      },
      dataZoom: isCartesian ? [{ type: 'inside', start: 0, end: 100 }] : undefined,
    };

    if (isCartesian) {
      option.xAxis =
        type === 'scatter'
          ? { type: 'value', splitLine: { show: true } }
          : { type: 'category', data: xAxis || [], axisLabel: { interval: 'auto', rotate: 30 } };

      option.yAxis = { type: 'value' };
    }

    option.series = series.map((s) => {
      const item: any = {
        name: s.name,
        type: type,
        data: s.data,
      };

      if (type === 'pie') {
        item.radius = ['40%', '70%'];
        item.avoidLabelOverlap = false;
        item.itemStyle = { borderRadius: 10, borderColor: '#fff', borderWidth: 2 };
        item.label = { show: false, position: 'center' };
        item.emphasis = { label: { show: true, fontSize: 16, fontWeight: 'bold' } };
      }

      if (type === 'line') {
        item.smooth = true;
      }

      // 动态高亮逻辑
      if (props.data.highlights?.length && type === 'bar') {
        item.itemStyle = {
          color: (params: any) => {
            return props.data.highlights!.includes(params.dataIndex) ? '#f08c00' : undefined;
          },
        };
      }

      return item;
    });

    // 允许后端 customOptions 覆盖
    if (props.data.customOptions) {
      Object.assign(option, props.data.customOptions);
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
