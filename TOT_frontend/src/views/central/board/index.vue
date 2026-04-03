<template>
  <div class="hq-board">
    <!-- 头部：标题与功能概述 -->
    <header class="board-header">
      <h1 class="title">实时任务看板</h1>
      <p class="desc">集中监控和管理总部下发的所有终端任务，实时追踪各门店执行进度与关键指标。</p>
    </header>

    <!-- 任务导航栏 -->
    <section class="task-nav-section" v-if="taskList.length > 0">
      <div class="task-list">
        <div
          v-for="task in taskList"
          :key="task.id"
          class="task-card"
          :class="{ 'is-active': activeTaskId === task.id }"
          @click="selectTask(task.id)"
        >
          <div class="task-card-header">
            <span class="task-name" :title="task.name">{{ task.name }}</span>
            <div class="header-right">
              <n-tag :type="task.statusType" size="small" :bordered="false" class="status-tag">{{ task.statusText }}</n-tag>
              <n-button 
                quaternary 
                circle 
                size="tiny" 
                class="action-btn edit-btn" 
                @click.stop="$router.push({ path: '/central/task/publish', query: { id: task.id } })"
              >
                <template #icon>
                  <n-icon size="14"><EditOutlined /></n-icon>
                </template>
              </n-button>
              <n-button 
                quaternary 
                circle 
                size="tiny" 
                class="action-btn del-btn" 
                @click.stop="handleDeleteTask(task.id, task.name)"
              >
                <template #icon>
                  <n-icon size="14"><CloseOutlined /></n-icon>
                </template>
              </n-button>
            </div>
          </div>
          <div class="task-card-time">截止: {{ task.deadline }}</div>
        </div>
      </div>
    </section>

    <div v-else class="empty-board">
      <n-empty description="暂无任何培训任务，请先前往左侧【任务管理】发布任务">
        <template #extra>
          <n-button type="primary" @click="$router.push('/central/task/publish')">去发布任务</n-button>
        </template>
      </n-empty>
    </div>

    <!-- 核心看板内容区 -->
    <section class="dashboard-content" v-if="activeTask">
      
      <!-- 1. 北极星指标（居中置顶） -->
      <div class="north-star-container">
        <div class="ns-card">
          <div class="ns-label">整体任务按时完成率</div>
          <div class="ns-value highlight">{{ activeTask.northStar.completionRate }}<span class="unit">%</span></div>
          <div class="ns-sub">任务 Deadline 前完成的人数 / 应完成总人数</div>
        </div>
        <div class="divider"></div>
        <div class="ns-card">
          <div class="ns-label">人均完成时间</div>
          <div class="ns-value">{{ activeTask.northStar.avgTime }}<span class="unit">小时</span></div>
          <div class="ns-sub">从任务下发到标记完成的平均耗时</div>
        </div>
      </div>

      <!-- 2. 图表与区域拆解 -->
      <div class="middle-section">
        <!-- 趋势折线图 -->
        <n-card :bordered="false" class="chart-card">
          <template #header>
            <div style="display: flex; align-items: center; gap: 8px">
              <span>完成人数趋势</span>
            </div>
          </template>
          <template #header-extra>
            <n-space align="center" :size="16">
              <!-- 下拉筛选日期：仅在按小时维度显示 -->
              <div v-if="trendTimeDimension === 'hour'" style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 13px; color: #6b7280;">日期</span>
                <n-select
                  v-model:value="trendSelectedDay"
                  :options="trendDayOptions"
                  size="small"
                  style="width: 100px"
                  @update:value="renderChart"
                />
              </div>

              <!-- 维度和指标类型切换区：通过 Segmented 控制块统一风格 -->
              <div style="display: flex; align-items: center; background: #f3f4f6; padding: 2px; border-radius: 6px;">
                <n-radio-group v-model:value="trendTimeDimension" size="small" style="background: transparent;" @update:value="handleDimensionChange">
                  <n-radio-button value="day" style="border: none; box-shadow: none;">日</n-radio-button>
                  <n-radio-button value="hour" style="border: none; box-shadow: none;">时</n-radio-button>
                </n-radio-group>
              </div>
            </n-space>
          </template>
          <div class="chart-container" ref="trendChartRef"></div>
        </n-card>

        <!-- RTM L3 拆解 -->
        <n-card :bordered="false" class="rtm-card" title="分 RTM L3 进度拆解">
          <div class="rtm-list">
            <div class="rtm-item header">
              <span>类别 (L3)</span>
              <span>完成率</span>
              <span>人均耗时</span>
            </div>
            <div class="rtm-item" v-for="(item, index) in activeTask.rtmData" :key="index">
              <span class="rtm-name">{{ item.name }}</span>
              <span class="rtm-rate">
                <n-progress type="line" :percentage="item.rate" :indicator-placement="'inside'" processing />
              </span>
              <span class="rtm-time">{{ item.time }}h</span>
            </div>
          </div>
        </n-card>
      </div>

      <!-- 3. 链路与预警数据 -->
      <div class="bottom-section">
        <!-- 链路数据 -->
        <n-card :bordered="false" class="metrics-card link-card" title="漏斗链路数据">
          <div class="metrics-grid funnel-grid">
            <div class="metric-box info-style">
              <div class="m-label">任务触达率 <n-tooltip trigger="hover"><span>成功收到任务的人员数 / 总人员数</span><template #trigger><n-icon class="icon"><info-circle-outlined/></n-icon></template></n-tooltip></div>
              <div class="m-value">{{ activeTask.linkData.reachRate }}%</div>
            </div>
            
            <div class="funnel-arrow">
              <n-icon size="24" color="#9ca3af"><ArrowRightOutlined /></n-icon>
            </div>

            <div class="metric-box info-style">
              <div class="m-label">任务读取率 <n-tooltip trigger="hover"><span>已读任务消息占总任务消息比重</span><template #trigger><n-icon class="icon"><info-circle-outlined/></n-icon></template></n-tooltip></div>
              <div class="m-value">{{ activeTask.linkData.readRate }}%</div>
            </div>

            <div class="funnel-arrow">
              <n-icon size="24" color="#9ca3af"><ArrowRightOutlined /></n-icon>
            </div>

            <div class="metric-box info-style">
              <div class="m-label">催办转化率 <n-tooltip trigger="hover"><span>点击任务开始学习任务数 / 总任务数</span><template #trigger><n-icon class="icon"><info-circle-outlined/></n-icon></template></n-tooltip></div>
              <div class="m-value">{{ activeTask.linkData.nudgeRate }}%</div>
            </div>
          </div>
        </n-card>

        <!-- 预警数据 -->
        <n-card :bordered="false" class="metrics-card warning-card" title="执行异常预警">
          <div class="metrics-grid">
            <div class="metric-box warn-style">
              <div class="m-label">起步异常率 <n-tooltip trigger="hover"><span>起步异常预警数 / 总员工数比重</span><template #trigger><n-icon class="icon"><info-circle-outlined/></n-icon></template></n-tooltip></div>
              <div class="m-value">{{ activeTask.warningData.startAbnormal }}%</div>
            </div>
            <div class="metric-box danger-style">
              <div class="m-label">进度危机 (P1) <n-tooltip trigger="hover"><span>距离deadline<48h未完成比重</span><template #trigger><n-icon class="icon"><info-circle-outlined/></n-icon></template></n-tooltip></div>
              <div class="m-value">{{ activeTask.warningData.p1Crisis }}%</div>
            </div>
            <div class="metric-box fatal-style">
              <div class="m-label">进度危机 (P0) <n-tooltip trigger="hover"><span>距离deadline<24h未完成比重</span><template #trigger><n-icon class="icon"><info-circle-outlined/></n-icon></template></n-tooltip></div>
              <div class="m-value">{{ activeTask.warningData.p0Crisis }}%</div>
            </div>
          </div>
        </n-card>
      </div>

    </section>
  </div>
</template>

<script lang="ts">
  import { defineComponent } from 'vue';
  export default defineComponent({
    name: 'central_board',
  });
</script>

<script lang="ts" setup>
import { ref, computed, onMounted, watch, onBeforeUnmount, nextTick, shallowRef, onActivated } from 'vue';
import * as echarts from 'echarts';
import { InfoCircleOutlined, ArrowRightOutlined, CloseOutlined, EditOutlined } from '@vicons/antd';
import { getTaskList, deleteTask } from '@/api/task';
import { useMessage, useDialog } from 'naive-ui';

const message = useMessage();
const dialog = useDialog();

// --- 数据响应式结构 ---
const taskList = ref<any[]>([]);
const activeTaskId = ref<string>('');
const activeTask = computed(() => taskList.value.find(t => t.id === activeTaskId.value) || null);

// 提取加载任务列表的方法
const loadTasks = async () => {
  try {
    const res = await getTaskList().send();
    // 映射后端 Task 对象到前端看板需要的数据格式
    taskList.value = (res || []).map((t: any) => {
      const isDraft = t.status === 'draft';
      // 生成一些基础图表占位数据，确保图表渲染不报错
      return {
        id: t.id,
        name: t.title,
        statusType: isDraft ? 'default' : 'success',
        statusText: isDraft ? '草稿' : '已下发',
        deadline: t.ddlAt ? t.ddlAt.substring(0, 10) : '无截止时间',
        northStar: isDraft 
          ? { completionRate: 0, avgTime: 0 } 
          : { completionRate: (Math.random() * 20 + 70).toFixed(1), avgTime: (Math.random() * 2 + 1).toFixed(1) },
        trendData: {
          xAxis: ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7'],
          series: isDraft ? [0,0,0,0,0,0,0] : [10, 50, 120, 240, 300, 450, 500]
        },
        rtmData: [
          { name: 'Education', rate: isDraft ? 0 : 85.2, time: 2.1 },
          { name: 'Monobrand', rate: isDraft ? 0 : 79.0, time: 2.5 },
          { name: 'Multibrand', rate: isDraft ? 0 : 72.5, time: 2.8 }
        ],
        linkData: isDraft
          ? { reachRate: 0, readRate: 0, nudgeRate: 0 }
          : { reachRate: 98.5, readRate: 85.2, nudgeRate: 42.1 },
        warningData: isDraft
          ? { startAbnormal: 0, p1Crisis: 0, p0Crisis: 0 }
          : { startAbnormal: 3.2, p1Crisis: 8.5, p0Crisis: 2.1 }
      };
    });

    if (taskList.value.length > 0 && (!activeTaskId.value || !taskList.value.find(t => t.id === activeTaskId.value))) {
      activeTaskId.value = taskList.value[0].id;
    }
    
    // 强制触发一次图表重绘，以防当前选中的任务数据发生了变化
    nextTick(() => {
      renderChart();
    });
  } catch (err: any) {
    message.error('获取任务列表失败');
    console.error(err);
  }
};

const selectTask = (id: string) => {
  activeTaskId.value = id;
};

// 删除任务的方法
const handleDeleteTask = (id: string, name: string) => {
  dialog.warning({
    title: '确认删除任务',
    content: `确定要将任务 "${name}" 及其所有的下发记录和数据从系统中彻底删除吗？此操作不可恢复。`,
    positiveText: '确认删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      const msgReactive = message.loading('正在删除中...', { duration: 0 });
      try {
        await deleteTask(id).send();
        msgReactive.destroy();
        message.success('删除成功');
        
        // 重新加载列表
        await loadTasks();
        
        // 如果全删光了，清空 activeTask，图表会自动销毁隐藏
        if (taskList.value.length === 0) {
          activeTaskId.value = '';
        }
      } catch (err: any) {
        msgReactive.destroy();
        message.error(err.message || '删除失败');
      }
    }
  });
};

// --- ECharts 渲染逻辑 ---
const trendChartRef = ref<HTMLElement | null>(null);
const chartInstance = shallowRef<echarts.ECharts | null>(null);
const trendTimeDimension = ref<'day' | 'hour'>('day');
const trendSelectedDay = ref<string>('');

const trendDayOptions = computed(() => {
  if (!activeTask.value) return [];
  return activeTask.value.trendData.xAxis.map((day: string) => ({ label: day, value: day }));
});

const handleDimensionChange = () => {
  if (trendTimeDimension.value === 'hour') {
    if (!trendSelectedDay.value && trendDayOptions.value.length > 0) {
      trendSelectedDay.value = trendDayOptions.value[0].value;
    }
  }
  renderChart();
};

const renderChart = () => {
  if (!trendChartRef.value || !activeTask.value) return;
  
  if (!chartInstance.value) {
    chartInstance.value = echarts.init(trendChartRef.value);
  }

  const isHour = trendTimeDimension.value === 'hour';
  
  let xAxisData: string[] = [];
  let seriesList: any[] = [];
  let legendData: string[] = [];

  if (!isHour) {
    // 每日模式：叠加累计和增量
    xAxisData = activeTask.value.trendData.xAxis;
    const cumulativeData = activeTask.value.trendData.series;
    const dailyData = cumulativeData.map((val: number, idx: number, arr: number[]) => {
      if (idx === 0) return val;
      return Math.max(0, val - arr[idx - 1]);
    });

    legendData = ['单日增量', '累计完成'];
    
    seriesList = [
      {
        name: '单日增量',
        type: 'bar',
        barMaxWidth: 28,
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: '#60a5fa' },
            { offset: 1, color: '#2563eb' }
          ]),
          borderRadius: [6, 6, 0, 0],
        },
        data: dailyData
      },
      {
        name: '累计完成',
        type: 'line',
        smooth: 0.4,
        symbol: 'circle',
        symbolSize: 8,
        showSymbol: false,
        itemStyle: { color: '#1e40af', borderColor: '#ffffff', borderWidth: 2 },
        lineStyle: { width: 3, color: '#1e40af', shadowColor: 'rgba(30, 64, 175, 0.25)', shadowBlur: 10, shadowOffsetY: 6 },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(30, 64, 175, 0.15)' },
            { offset: 1, color: 'rgba(30, 64, 175, 0.01)' }
          ])
        },
        data: cumulativeData
      }
    ];
  } else {
    // 每小时模式：同样叠加单时增量和累计完成 (基于选中的日期 mock 数据)
    const days = activeTask.value.trendData.xAxis;
    if (!trendSelectedDay.value || !days.includes(trendSelectedDay.value)) {
      trendSelectedDay.value = days[0] || '';
    }
    const dayIdx = days.indexOf(trendSelectedDay.value);
    const rawSeries = activeTask.value.trendData.series;
    const dailyTotal = dayIdx === 0 ? rawSeries[0] : Math.max(0, rawSeries[dayIdx] - rawSeries[dayIdx - 1]);
    
    // 假设上一天的总量为当天的累计起点
    let previousCumulative = dayIdx === 0 ? 0 : rawSeries[dayIdx - 1];

    xAxisData = Array.from({ length: 24 }, (_, i) => `${i}:00`);
    
    const hourlyDelta = Array(24).fill(0);
    let remaining = dailyTotal;
    for (let i = 9; i <= 20; i++) {
       if (remaining <= 0) break;
       const alloc = Math.min(remaining, Math.ceil(dailyTotal / 8) + (i * 7 % 5));
       hourlyDelta[i] = alloc;
       remaining -= alloc;
    }
    if (remaining > 0) hourlyDelta[14] += remaining;

    let hourlyCumulative = [];
    let currentSum = previousCumulative;
    hourlyDelta.forEach(val => {
       currentSum += val;
       hourlyCumulative.push(currentSum);
    });

    legendData = ['单时增量', '累计完成'];

    seriesList = [
      {
        name: '单时增量',
        type: 'bar',
        barMaxWidth: 28,
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: '#60a5fa' },
            { offset: 1, color: '#2563eb' }
          ]),
          borderRadius: [6, 6, 0, 0],
        },
        data: hourlyDelta
      },
      {
        name: '累计完成',
        type: 'line',
        smooth: 0.4,
        symbol: 'circle',
        symbolSize: 8,
        showSymbol: false,
        itemStyle: { color: '#1e40af', borderColor: '#ffffff', borderWidth: 2 },
        lineStyle: { width: 3, color: '#1e40af', shadowColor: 'rgba(30, 64, 175, 0.25)', shadowBlur: 10, shadowOffsetY: 6 },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(30, 64, 175, 0.15)' },
            { offset: 1, color: 'rgba(30, 64, 175, 0.01)' }
          ])
        },
        data: hourlyCumulative
      }
    ];
  }

  chartInstance.value.clear();

  const option = {
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255, 255, 255, 0.95)',
      borderColor: '#e5e7eb',
      borderWidth: 1,
      padding: [10, 14],
      textStyle: { color: '#1f2937', fontSize: 13, fontWeight: 500 },
      axisPointer: {
        type: 'shadow',
        lineStyle: { color: '#cbd5e1', type: 'dashed' },
        shadowStyle: { color: 'rgba(243, 244, 246, 0.5)' }
      }
    },
    legend: {
      data: legendData,
      icon: 'circle',
      right: '4%',
      top: 0,
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: '#6b7280', fontSize: 12 }
    },
    grid: { left: '3%', right: '4%', bottom: '5%', top: '15%', containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: true, // Bar charts usually need boundaryGap: true to look aligned
      data: xAxisData,
      axisLine: { lineStyle: { color: '#e5e7eb', width: 1.5 } },
      axisTick: { show: false },
      axisLabel: { color: '#6b7280', margin: 12 }
    },
    yAxis: {
      type: 'value',
      name: '完成人数',
      nameTextStyle: { color: '#9ca3af', padding: [0, 0, 0, 20], fontSize: 12 },
      splitLine: { lineStyle: { type: 'dashed', color: '#f3f4f6' } },
      axisLabel: { color: '#6b7280' }
    },
    series: seriesList
  };
  
  chartInstance.value.setOption(option);
};

const resizeChart = () => {
  chartInstance.value?.resize();
};

watch(activeTaskId, () => {
  nextTick(() => {
    if (trendTimeDimension.value === 'hour' && trendDayOptions.value.length > 0) {
      trendSelectedDay.value = trendDayOptions.value[0].value;
    }
    renderChart();
  });
});

onMounted(() => {
  loadTasks();
  nextTick(() => {
    if (activeTask.value) {
      renderChart();
    }
    window.addEventListener('resize', resizeChart);
  });
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', resizeChart);
  chartInstance.value?.dispose();
});

onActivated(() => {
  loadTasks();
});
</script>

<style lang="less" scoped>
/* 商业级 SaaS 风格 - 实时看板 */
.hq-board {
  padding: 24px;
  min-height: 100%;
  background-color: #f0f2f5;
  font-family: "PingFang SC", "Helvetica Neue", Helvetica, Arial, "Hiragino Sans GB", "Microsoft Yahei", sans-serif;
}

.board-header {
  margin-bottom: 24px;
  .title { 
    font-size: 20px; 
    font-weight: 600; 
    color: #1f2937; 
    margin: 0 0 8px 0; 
  }
  .desc { 
    font-size: 14px; 
    color: #6b7280; 
    margin: 0; 
  }
}

.task-nav-section {
  margin-bottom: 24px;
  overflow-x: auto;
  padding-bottom: 8px;
  &::-webkit-scrollbar { height: 6px; }
  &::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; }
}

.empty-board {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 400px;
  background: #ffffff;
  border-radius: 4px;
  border: 1px solid #e5e7eb;
}

.task-list {
  display: flex;
  gap: 16px;
  width: max-content;
}

.task-card {
  width: 280px;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 4px; /* 商业级硬朗风格 */
  padding: 16px;
  cursor: pointer;
  transition: all 0.2s ease;
  flex-shrink: 0;
  position: relative;
  overflow: hidden;

  &:hover { 
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05); 
    border-color: #d1d5db;
  }
  
  &.is-active { 
    border-color: #2563eb;
    background: #f8fafc;
    
    &::before {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      width: 4px;
      height: 100%;
      background-color: #2563eb;
    }
  }

  .task-card-header { 
    display: flex; 
    justify-content: space-between; 
    align-items: center; 
    margin-bottom: 12px; 
    
    .header-right {
      display: flex;
      align-items: center;
      gap: 6px;
    }
  }
  .task-name { 
    font-size: 14px; 
    font-weight: 600; 
    color: #111827; 
    white-space: nowrap; 
    overflow: hidden; 
    text-overflow: ellipsis; 
    max-width: 140px; /* 给删除按钮多留点空间 */
  }
  .action-btn {
    opacity: 0; /* 默认隐藏操作按钮 */
    transition: opacity 0.2s ease, color 0.2s ease, background 0.2s ease;
    color: #9ca3af;
  }

  .edit-btn:hover {
    color: #2563eb;
    background: #eff6ff;
  }
  
  .del-btn:hover {
    color: #ef4444;
    background: #fee2e2;
  }
  
  &:hover .action-btn {
    opacity: 1; /* 鼠标悬浮卡片时显示操作按钮 */
  }
  .task-card-time { 
    font-size: 12px; 
    color: #6b7280; 
  }
}

/* 核心看板区结构 */
.dashboard-content {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* 全局卡片统一样式 */
:deep(.n-card) {
  border-radius: 4px;
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  background: #ffffff;
  border: 1px solid #e5e7eb;
}

:deep(.n-card-header) {
  border-bottom: 1px solid #f3f4f6;
  padding: 16px 24px !important;
}

:deep(.n-card-header__main) {
  font-weight: 600 !important;
  font-size: 16px !important;
  color: #111827 !important;
  position: relative;
  padding-left: 12px;

  &::before {
    content: "";
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 4px;
    height: 16px;
    background-color: #2563eb;
    border-radius: 2px;
  }
}

/* 1. 北极星指标 */
.north-star-container {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  padding: 32px 0;
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  
  .divider {
    width: 1px;
    height: 60px;
    background: #e5e7eb;
    margin: 0 80px;
  }

  .ns-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  .ns-label { 
    font-size: 14px; 
    font-weight: 500; 
    color: #4b5563; 
    margin-bottom: 12px; 
  }
  
  .ns-value {
    font-size: 40px;
    font-weight: 600;
    line-height: 1;
    color: #111827;
    font-family: Arial, sans-serif;
    
    &.highlight { color: #2563eb; } 
    
    .unit { 
      font-size: 16px; 
      font-weight: 400; 
      color: #6b7280; 
      margin-left: 4px; 
    }
  }
  
  .ns-sub { 
    font-size: 12px; 
    color: #9ca3af; 
    margin-top: 12px; 
  }
}

/* 2. 中间图表区 */
.middle-section {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 24px;

  .chart-container {
    height: 320px;
    width: 100%;
  }

  .rtm-list {
    display: flex;
    flex-direction: column;
    height: 320px;
    overflow-y: auto;

    &::-webkit-scrollbar { width: 6px; }
    &::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; }

    .rtm-item {
      display: grid;
      grid-template-columns: 90px 1fr 60px;
      align-items: center;
      gap: 16px;
      padding: 12px 16px;
      border-bottom: 1px solid #f3f4f6;
      
      &:hover { background-color: #f9fafb; }
      
      &.header {
        font-weight: 600;
        color: #4b5563;
        background-color: #f9fafb;
        border-bottom: 1px solid #e5e7eb;
        font-size: 13px;
        &:hover { background-color: #f9fafb; }
      }

      .rtm-name { font-size: 13px; color: #111827; }
      .rtm-time { font-size: 13px; color: #6b7280; text-align: right; }
      
      /* 进度条恢复为主题蓝 */
      :deep(.n-progress .n-progress-graph-line-fill) {
        background-color: #2563eb !important;
      }
    }
  }
}

/* 3. 底部详细数据区 */
.bottom-section {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.funnel-grid {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  
  .metric-box {
    flex: 1;
    min-width: 0;
  }
}

.funnel-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.metric-box {
  padding: 16px;
  border-radius: 4px;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  display: flex;
  flex-direction: column;
  gap: 8px;
  
  .m-label { 
    font-size: 12px; 
    color: #4b5563; 
    display: flex; 
    align-items: center; 
    gap: 4px;
    .icon { color: #9ca3af; cursor: help; }
  }
  
  .m-value { 
    font-size: 24px; 
    font-weight: 600; 
    color: #111827; 
    font-family: Arial, sans-serif;
  }

  &.info-style { 
    background: #eff6ff; 
    border-color: #bfdbfe;
    .m-value { color: #1d4ed8; } 
  }
  
  /* 预警数据 */
  &.warn-style { 
    background: #fefce8; 
    border-color: #fef08a;
    .m-value { color: #a16207; }
  }
  &.danger-style { 
    background: #fff7ed; 
    border-color: #fed7aa;
    .m-value { color: #c2410c; }
  }
  &.fatal-style { 
    background: #fef2f2; 
    border-color: #fecaca;
    .m-value { color: #b91c1c; } 
  }
}
.chart-card :deep(.n-radio-button) {
  border-radius: 4px !important;
}
.chart-card :deep(.n-radio-button.n-radio-button--checked) {
  background-color: #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1) !important;
  color: #1f2937;
  font-weight: 500;
}
.chart-card :deep(.n-radio-group .n-radio-button:not(.n-radio-button--checked):hover) {
  color: #4b5563;
}
.chart-card :deep(.n-radio-group) {
  border: none;
}
.chart-card :deep(.n-radio-group .n-radio-button::before) {
  display: none !important; /* Hide the separator lines between buttons */
}
</style>
