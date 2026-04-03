<template>
  <div class="hq-board">
    <!-- 头部：标题与功能概述 + 已布置任务入口 -->
    <header class="board-header">
      <div class="board-header-main">
        <h1 class="title">实时任务看板</h1>
        <p class="desc">集中监控和管理总部下发的所有终端任务，实时追踪各门店执行进度与关键指标。</p>
      </div>
      <div class="board-header-actions">
        <n-space>
          <n-button type="primary" secondary @click="openDispatchedTasksDialog">
            <template #icon>
              <n-icon><UnorderedListOutlined /></n-icon>
            </template>
            已布置的任务
          </n-button>
          <n-button type="primary" secondary @click="openAlertRulesDialog">
            <template #icon>
              <n-icon><AlertOutlined /></n-icon>
            </template>
            任务预警规则
          </n-button>
        </n-space>
      </div>
    </header>

    <!-- 已下发任务列表（瀑布流） -->
    <n-modal
      v-model:show="showDispatchedListModal"
      preset="card"
      title="已布置的任务"
      :style="{ width: 'min(580px, 94vw)', maxHeight: '78vh' }"
      :segmented="{ content: 'soft', footer: 'soft' }"
      class="hq-dispatched-modal"
    >
      <div class="hq-dispatched-body">
        <n-spin :show="dispatchedListLoading">
          <n-empty v-if="!dispatchedListLoading && dispatchedTasksOnly.length === 0" description="暂无已下发的任务" />
          <div v-else class="hq-waterfall-list">
            <div
              v-for="task in dispatchedTasksOnly"
              :key="task.id"
              class="hq-waterfall-card"
              :class="{ 'is-expanded': expandedDispatchedTaskId === task.id }"
            >
              <div class="hq-wf-summary" @click="toggleDispatchedTaskDetail(task.id)">
                <div class="hq-wf-head">
                  <span class="hq-wf-tag">已下发</span>
                  <n-icon class="hq-wf-chevron" :class="{ 'is-open': expandedDispatchedTaskId === task.id }">
                    <DownOutlined />
                  </n-icon>
                </div>
                <h3 class="hq-wf-title">{{ task.name }}</h3>
                <p class="hq-wf-meta">截止：{{ task.deadline }}</p>
                <p v-if="task.createdAtLabel" class="hq-wf-time">{{ task.createdAtLabel }}</p>
                <p class="hq-wf-hint">
                  {{ expandedDispatchedTaskId === task.id ? '点击收起' : '点击展开查看详情' }}
                </p>
              </div>

              <div
                v-show="expandedDispatchedTaskId === task.id"
                class="hq-wf-expand"
                @click.stop
              >
                <n-spin :show="detailLoadingTaskId === task.id">
                  <div v-if="taskDetailById[task.id]" class="hq-detail-inner">
                    <n-descriptions label-placement="top" :column="2" bordered size="small" :label-style="{ color: '#6b7280' }">
                      <n-descriptions-item label="任务名称" :span="2">
                        {{ taskDetailById[task.id].title }}
                      </n-descriptions-item>
                      <n-descriptions-item label="开始时间" :span="1">
                        {{ formatHqDetailTime(taskDetailById[task.id].startAt) }}
                      </n-descriptions-item>
                      <n-descriptions-item label="截止时间" :span="1">
                        {{ formatHqDetailTime(taskDetailById[task.id].ddlAt) }}
                      </n-descriptions-item>
                      <n-descriptions-item label="达标分数" :span="1">
                        {{ taskDetailById[task.id].passScore ?? 100 }} 分
                      </n-descriptions-item>
                      <n-descriptions-item label="状态" :span="1">
                        <n-tag type="success" size="small" :bordered="false">已下发</n-tag>
                      </n-descriptions-item>
                      <n-descriptions-item label="学习平台" :span="2">
                        <n-space size="small">
                          <n-tag v-if="taskDetailById[task.id].hasMypal" :bordered="false" type="info" size="small">MyPal</n-tag>
                          <n-tag v-if="taskDetailById[task.id].hasSmartSell" :bordered="false" type="info" size="small">Sales Coach</n-tag>
                          <n-tag v-if="taskDetailById[task.id].hasAiDemo" :bordered="false" type="info" size="small">AI Coach</n-tag>
                          <n-tag v-if="taskDetailById[task.id].hasLiveBroadcast" :bordered="false" type="info" size="small">直播培训</n-tag>
                        </n-space>
                      </n-descriptions-item>
                    </n-descriptions>
                    <div class="hq-detail-desc-block">
                      <div class="hq-detail-desc-label">任务说明</div>
                      <div class="hq-detail-desc-text">{{ taskDetailById[task.id].description || '总部未填写详细说明' }}</div>
                    </div>
                    <n-button
                      type="primary"
                      block
                      class="hq-detail-edit-btn"
                      @click.stop="goEditDispatchedTask(task.id)"
                    >
                      前往任务管理编辑
                    </n-button>
                  </div>
                </n-spin>
              </div>
            </div>
          </div>
        </n-spin>
      </div>
    </n-modal>

    <!-- 各任务预警规则（与「已布置的任务」同交互：卡片展开） -->
    <n-modal
      v-model:show="showAlertRulesModal"
      preset="card"
      title="任务预警规则"
      :style="{ width: 'min(580px, 94vw)', maxHeight: '78vh' }"
      :segmented="{ content: 'soft', footer: 'soft' }"
      class="hq-rules-modal"
    >
      <div class="hq-dispatched-body">
        <n-spin :show="alertRulesListLoading">
          <n-empty v-if="!alertRulesListLoading && taskList.length === 0" description="暂无任务" />
          <div v-else class="hq-waterfall-list">
            <div
              v-for="task in taskList"
              :key="'rules-' + task.id"
              class="hq-waterfall-card hq-rules-card"
              :class="{ 'is-expanded': expandedRulesTaskId === task.id }"
            >
              <div class="hq-wf-summary" @click="toggleAlertRulesExpand(task.id)">
                <div class="hq-wf-head">
                  <n-tag :type="task.statusType" size="small" :bordered="false">{{ task.statusText }}</n-tag>
                  <n-icon class="hq-wf-chevron" :class="{ 'is-open': expandedRulesTaskId === task.id }">
                    <DownOutlined />
                  </n-icon>
                </div>
                <h3 class="hq-wf-title">{{ task.name }}</h3>
                <p class="hq-wf-meta">截止：{{ task.deadline }}</p>
                <p class="hq-wf-hint">
                  {{ expandedRulesTaskId === task.id ? '点击收起' : '点击展开查看预警规则' }}
                </p>
              </div>

              <div
                v-show="expandedRulesTaskId === task.id"
                class="hq-wf-expand hq-rules-expand"
                @click.stop
              >
                <div v-if="hasAutoNudgeRules(task)" class="hq-rules-body">
                  <div class="hq-rule-block">
                    <div class="hq-rule-block-title">进度掉队预警</div>
                    <p class="hq-rule-line">
                      Lifestyle：个人完成率处于门店最后 <strong>{{ task.autoNudgeRules.laggingLifestyle ?? '—' }}</strong> 位
                    </p>
                    <p class="hq-rule-line">
                      Mono：个人完成率处于门店最后 <strong>{{ task.autoNudgeRules.laggingMono ?? '—' }}</strong> 位
                    </p>
                  </div>
                  <div class="hq-rule-block">
                    <div class="hq-rule-block-title">起步异常预警</div>
                    <p class="hq-rule-line">
                      任务期限已度过 <strong>{{ task.autoNudgeRules.startDelayPercent ?? '—' }}</strong> % ，但个人进度仍为 0%
                    </p>
                  </div>
                  <div class="hq-rule-block">
                    <div class="hq-rule-block-title">临期危机（Deadline）</div>
                    <p class="hq-rule-line">
                      距 Deadline 不足 <strong>{{ task.autoNudgeRules.deadlineCrisisHours ?? '—' }}</strong> 小时（P0）
                    </p>
                    <p class="hq-rule-line">
                      距 Deadline 不足 <strong>{{ task.autoNudgeRules.deadlineCrisisHoursSecondary ?? '—' }}</strong> 小时（P1）
                    </p>
                  </div>
                </div>
                <n-empty v-else description="未配置预警规则" size="small" class="hq-rules-empty" />
                <n-button
                  type="primary"
                  block
                  class="hq-detail-edit-btn"
                  @click.stop="goEditRulesTask(task.id)"
                >
                  前往任务管理编辑
                </n-button>
              </div>
            </div>
          </div>
        </n-spin>
      </div>
    </n-modal>

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

    <!-- 已下发任务：手动触发预警扫描（与任务管理里配置的规则一致） -->
    <section v-if="taskList.length > 0 && activeTask?.dispatched" class="auto-nudge-bar">
      <div class="auto-nudge-inner">
        <span class="auto-nudge-hint">
          根据「任务管理」中的预警规则扫描未完成学员并推送催办（店员端 WebSocket 实时通知）。
        </span>
        <n-button
          type="warning"
          secondary
          size="small"
          :loading="autoNudgeLoading"
          @click="handleTriggerAutoNudge"
        >
          <template #icon>
            <n-icon><BellOutlined /></n-icon>
          </template>
          运行预警扫描
        </n-button>
      </div>
    </section>

    <!-- 核心看板内容区（统计接口加载中） -->
    <section class="dashboard-content" v-if="activeTask">
      <n-spin :show="boardStatsLoading" class="board-stats-spin">
      
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
                  style="width: 120px"
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
      </n-spin>
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
import { useRouter } from 'vue-router';
import * as echarts from 'echarts';
import { InfoCircleOutlined, ArrowRightOutlined, CloseOutlined, EditOutlined, BellOutlined, UnorderedListOutlined, DownOutlined, AlertOutlined } from '@vicons/antd';
import { getTaskList, getTaskDetail, deleteTask, triggerTaskAutoNudge } from '@/api/task';
import {
  getDashboardOverview,
  getDashboardHeatmap,
  getDashboardTrend,
  type TrendPoint,
} from '@/api/dashboard';
import { useMessage, useDialog } from 'naive-ui';
import { useUserStore } from '@/store/modules/user';
import { useGlobSetting } from '@/hooks/setting';

const message = useMessage();
const dialog = useDialog();
const router = useRouter();
const userStore = useUserStore();
const { apiUrl } = useGlobSetting();

/** 总部看板：已下发任务 PATCH 后 WS 推送 task_updated，同步列表/详情中的 ddl 与预警规则 */
let hqWs: WebSocket | null = null;
const HQ_WS_ROLES = ['central', 'admin', 'executive'];

function isHqWsRole(role?: string | null) {
  return !!role && HQ_WS_ROLES.includes(role);
}

function applyTaskUpdatedFromWs(data: {
  taskId: string;
  ddlAt?: string;
  autoNudgeRules?: Record<string, number> | null;
}) {
  const { taskId, ddlAt, autoNudgeRules } = data;
  const idx = taskList.value.findIndex((t) => t.id === taskId);
  if (idx >= 0) {
    const t = taskList.value[idx];
    taskList.value.splice(idx, 1, {
      ...t,
      deadline: ddlAt ? ddlAt.substring(0, 10) : t.deadline,
      autoNudgeRules: autoNudgeRules !== undefined ? autoNudgeRules : t.autoNudgeRules,
    });
  }
  const detail = taskDetailById.value[taskId];
  if (detail) {
    taskDetailById.value = {
      ...taskDetailById.value,
      [taskId]: {
        ...detail,
        ddlAt: ddlAt ?? detail.ddlAt,
        autoNudgeRules: autoNudgeRules !== undefined ? autoNudgeRules : detail.autoNudgeRules,
      },
    };
  }
}

function initHqBoardWebSocket() {
  closeHqBoardWebSocket();
  const token = userStore.getToken;
  if (!token || !isHqWsRole(userStore.getUserInfo?.role)) return;

  let wsHost = apiUrl as string;
  if (!wsHost || wsHost.startsWith('/')) {
    wsHost = window.location.origin;
  }
  const wsUrl = `${String(wsHost).replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`;

  try {
    hqWs = new WebSocket(wsUrl);
  } catch {
    return;
  }

  hqWs.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data);
      if (parsed.event === 'task_updated' && parsed.data?.taskId) {
        applyTaskUpdatedFromWs(parsed.data);
        const tid = parsed.data.taskId;
        const row = taskList.value.find((t) => t.id === tid);
        if (row?.dispatched) {
          void loadDashboardForTask(tid);
        }
      }
    } catch (e) {
      console.error('HQ board WebSocket message error', e);
    }
  };

  hqWs.onclose = () => {
    hqWs = null;
  };
}

function closeHqBoardWebSocket() {
  if (hqWs) {
    hqWs.close();
    hqWs = null;
  }
}

// --- 数据响应式结构 ---
const taskList = ref<any[]>([]);
const activeTaskId = ref<string>('');
const activeTask = computed(() => taskList.value.find(t => t.id === activeTaskId.value) || null);

const showDispatchedListModal = ref(false);
const dispatchedListLoading = ref(false);
const expandedDispatchedTaskId = ref<string | null>(null);
const detailLoadingTaskId = ref<string | null>(null);
const taskDetailById = ref<Record<string, any>>({});

const dispatchedTasksOnly = computed(() => taskList.value.filter((t) => t.dispatched));

const openDispatchedTasksDialog = async () => {
  dispatchedListLoading.value = true;
  try {
    await loadTasks();
    showDispatchedListModal.value = true;
  } finally {
    dispatchedListLoading.value = false;
  }
};

watch(showDispatchedListModal, (open) => {
  if (!open) {
    expandedDispatchedTaskId.value = null;
  }
});

const formatHqDetailTime = (isoStr: string) => {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const toggleDispatchedTaskDetail = async (taskId: string) => {
  if (expandedDispatchedTaskId.value === taskId) {
    expandedDispatchedTaskId.value = null;
    return;
  }
  expandedDispatchedTaskId.value = taskId;
  if (taskDetailById.value[taskId]) return;

  detailLoadingTaskId.value = taskId;
  try {
    const res = await getTaskDetail(taskId).send();
    taskDetailById.value = { ...taskDetailById.value, [taskId]: res };
  } catch (err: any) {
    message.error(err?.message || '加载任务详情失败');
    expandedDispatchedTaskId.value = null;
  } finally {
    detailLoadingTaskId.value = null;
  }
};

const goEditDispatchedTask = (taskId: string) => {
  showDispatchedListModal.value = false;
  router.push({ path: '/central/task/publish', query: { id: taskId } });
};

const showAlertRulesModal = ref(false);
const alertRulesListLoading = ref(false);
const expandedRulesTaskId = ref<string | null>(null);

const openAlertRulesDialog = async () => {
  alertRulesListLoading.value = true;
  try {
    await loadTasks();
    showAlertRulesModal.value = true;
  } finally {
    alertRulesListLoading.value = false;
  }
};

watch(showAlertRulesModal, (open) => {
  if (!open) {
    expandedRulesTaskId.value = null;
  }
});

const toggleAlertRulesExpand = (taskId: string) => {
  if (expandedRulesTaskId.value === taskId) {
    expandedRulesTaskId.value = null;
  } else {
    expandedRulesTaskId.value = taskId;
  }
};

const hasAutoNudgeRules = (task: any) => {
  const r = task?.autoNudgeRules;
  if (!r || typeof r !== 'object') return false;
  return Object.keys(r).length > 0;
};

const goEditRulesTask = (taskId: string) => {
  showAlertRulesModal.value = false;
  router.push({ path: '/central/task/publish', query: { id: taskId } });
};

/** 看板 KPI 加载（overview + heatmap + trend daily） */
const boardStatsLoading = ref(false);
/** 按小时趋势：当前选中日期的接口数据 */
const activeHourlyTrendRows = ref<TrendPoint[]>([]);
/** 缓存 key = `${taskId}::${date}` */
const hourlyTrendCache = ref<Record<string, TrendPoint[]>>({});

function formatTrendDateLabel(timeKey: string) {
  if (!timeKey) return '';
  const m = String(timeKey).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[2]}-${m[3]}`;
  return timeKey;
}

function emptyBoardStats() {
  return {
    northStar: { completionRate: '0', avgTime: '0' },
    trendDailyRows: [] as TrendPoint[],
    trendData: { xAxis: [] as string[], series: [] as number[] },
    rtmData: [{ name: '暂无数据', rate: 0, time: 0 }],
    linkData: { reachRate: 0, readRate: 0, nudgeRate: 0 },
    warningData: { startAbnormal: 0, p1Crisis: 0, p0Crisis: 0 },
  };
}

async function loadDashboardForTask(taskId: string) {
  const idx = taskList.value.findIndex((t) => t.id === taskId);
  if (idx < 0) return;
  const row = taskList.value[idx];
  if (!row.dispatched) {
    const empty = emptyBoardStats();
    taskList.value.splice(idx, 1, { ...row, ...empty });
    activeHourlyTrendRows.value = [];
    nextTick(() => renderChart());
    return;
  }

  boardStatsLoading.value = true;
  try {
    const [overview, heatmap, trendDailyRes] = await Promise.all([
      getDashboardOverview({ taskId }).send(),
      getDashboardHeatmap({ taskId }).send(),
      getDashboardTrend({ taskId, type: 'daily' }).send(),
    ]);

    const trendRows: TrendPoint[] = trendDailyRes?.trendData ?? [];
    const heatmapRows = heatmap?.heatmapData ?? [];
    const rtmData = heatmapRows.map((h) => ({
      name: h.rtmValue || '—',
      rate: Math.min(100, Math.max(0, h.completionRate ?? 0)),
      time: h.avgCompletionTimeHours ?? 0,
    }));
    if (rtmData.length === 0) {
      rtmData.push({ name: '暂无门店维度数据', rate: 0, time: 0 });
    }

    const xAxis = trendRows.map((r) => formatTrendDateLabel(r.timeKey));
    const series = trendRows.map((r) => r.cumulativeCompleted ?? 0);

    taskList.value.splice(idx, 1, {
      ...row,
      northStar: {
        completionRate: String(overview.onTimeCompletionRate ?? 0),
        avgTime: String(
          overview.avgCompletionTimeHours != null ? Number(overview.avgCompletionTimeHours).toFixed(1) : '0'
        ),
      },
      trendDailyRows: trendRows,
      trendData: { xAxis, series },
      rtmData,
      linkData: {
        reachRate: overview.taskReachRate ?? 0,
        readRate: overview.taskReadRate ?? 0,
        nudgeRate: overview.nudgeConversionRate ?? 0,
      },
      warningData: {
        startAbnormal: overview.startDelayRate ?? 0,
        p1Crisis: overview.crisisP1Rate ?? 0,
        p0Crisis: overview.crisisP0Rate ?? 0,
      },
      dashboardUpdatedAt: overview.updatedAt,
    });

    const dateKeys = trendRows.map((r) => r.timeKey).filter(Boolean);
    if (dateKeys.length) {
      if (!trendSelectedDay.value || !dateKeys.includes(trendSelectedDay.value)) {
        trendSelectedDay.value = dateKeys[dateKeys.length - 1];
      }
    } else {
      trendSelectedDay.value = '';
    }

    hourlyTrendCache.value = {};
    if (trendTimeDimension.value === 'hour' && trendSelectedDay.value) {
      await fetchHourlyTrendForActiveTask();
    } else {
      activeHourlyTrendRows.value = [];
    }

    nextTick(() => renderChart());
  } catch (err: any) {
    console.error(err);
    message.error(err?.message || '加载看板统计失败');
  } finally {
    boardStatsLoading.value = false;
  }
}

async function fetchHourlyTrendForActiveTask() {
  const taskId = activeTaskId.value;
  const date = trendSelectedDay.value;
  if (!taskId || !date) {
    activeHourlyTrendRows.value = [];
    return;
  }
  const task = taskList.value.find((t) => t.id === taskId);
  if (!task?.dispatched) {
    activeHourlyTrendRows.value = [];
    return;
  }
  const cacheKey = `${taskId}::${date}`;
  if (hourlyTrendCache.value[cacheKey]) {
    activeHourlyTrendRows.value = hourlyTrendCache.value[cacheKey];
    return;
  }
  try {
    const data = await getDashboardTrend({ taskId, type: 'hourly', date }).send();
    const list = data?.trendData ?? [];
    hourlyTrendCache.value[cacheKey] = list;
    activeHourlyTrendRows.value = list;
  } catch {
    activeHourlyTrendRows.value = [];
  }
}

// 提取加载任务列表的方法
const loadTasks = async () => {
  try {
    const res = await getTaskList().send();
    taskList.value = (res || []).map((t: any) => {
      const isDraft = t.status === 'draft';
      const createdRaw = t.createdAt || '';
      const createdAtLabel = createdRaw
        ? `创建 ${createdRaw.substring(0, 10)} ${createdRaw.substring(11, 16) || ''}`
        : '';
      const base = {
        id: t.id,
        name: t.title,
        dispatched: t.status === 'dispatched',
        statusType: isDraft ? 'default' : 'success',
        statusText: isDraft ? '草稿' : '已下发',
        deadline: t.ddlAt ? t.ddlAt.substring(0, 10) : '无截止时间',
        createdAtLabel,
        autoNudgeRules: t.autoNudgeRules ?? null,
        ...emptyBoardStats(),
      };
      return base;
    });

    if (taskList.value.length > 0 && (!activeTaskId.value || !taskList.value.find(t => t.id === activeTaskId.value))) {
      activeTaskId.value = taskList.value[0].id;
    }

    if (activeTaskId.value) {
      await loadDashboardForTask(activeTaskId.value);
    } else {
      nextTick(() => renderChart());
    }
  } catch (err: any) {
    message.error('获取任务列表失败');
    console.error(err);
  }
};

const selectTask = (id: string) => {
  activeTaskId.value = id;
  void loadDashboardForTask(id);
};

const autoNudgeLoading = ref(false);
const handleTriggerAutoNudge = async () => {
  if (!activeTaskId.value) return;
  autoNudgeLoading.value = true;
  try {
    const data = await triggerTaskAutoNudge(activeTaskId.value).send();
    const n = data?.nudgedCount ?? 0;
    const rules = data?.evaluatedRules?.length ? `（规则键：${data.evaluatedRules.join(', ')}）` : '';
    message.success(`扫描完成，本次触发 ${n} 人次催办${rules}`);
    if (activeTaskId.value) {
      await loadDashboardForTask(activeTaskId.value);
    }
  } catch (err: any) {
    message.error(err?.message || '触发失败');
  } finally {
    autoNudgeLoading.value = false;
  }
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
  const rows = activeTask.value?.trendDailyRows as TrendPoint[] | undefined;
  if (!rows?.length) return [];
  return rows.map((r) => ({
    label: formatTrendDateLabel(r.timeKey),
    value: r.timeKey,
  }));
});

const handleDimensionChange = () => {
  if (trendTimeDimension.value === 'hour') {
    if (!trendSelectedDay.value && trendDayOptions.value.length > 0) {
      trendSelectedDay.value = trendDayOptions.value[0].value;
    }
    void fetchHourlyTrendForActiveTask().then(() => nextTick(() => renderChart()));
    return;
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
    const rows = (activeTask.value.trendDailyRows || []) as TrendPoint[];
    if (rows.length === 0) {
      xAxisData = ['暂无完成数据'];
      const cumulativeData = [0];
      const dailyData = [0];
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
      xAxisData = rows.map((r) => formatTrendDateLabel(r.timeKey));
      const cumulativeData = rows.map((r) => r.cumulativeCompleted ?? 0);
      const dailyData = rows.map((r) => r.newCompleted ?? 0);

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
    }
  } else {
    xAxisData = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);
    const rows = activeHourlyTrendRows.value || [];
    const hourlyDelta = Array(24).fill(0);
    const hourlyCumulative = Array(24).fill(0);
    let prevCum = 0;
    for (let h = 0; h < 24; h++) {
      const hk = String(h).padStart(2, '0');
      const row = rows.find(
        (r) => String(r.timeKey).padStart(2, '0') === hk
      );
      if (row) {
        hourlyDelta[h] = row.newCompleted ?? 0;
        hourlyCumulative[h] = row.cumulativeCompleted ?? prevCum + hourlyDelta[h];
        prevCum = hourlyCumulative[h];
      } else {
        hourlyDelta[h] = 0;
        hourlyCumulative[h] = prevCum;
      }
    }

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

watch(trendSelectedDay, () => {
  if (trendTimeDimension.value !== 'hour' || !activeTaskId.value) return;
  void fetchHourlyTrendForActiveTask().then(() => nextTick(() => renderChart()));
});

watch(
  () => [userStore.getToken, userStore.getUserInfo?.role] as const,
  () => {
    if (!userStore.getToken || !isHqWsRole(userStore.getUserInfo?.role)) {
      closeHqBoardWebSocket();
      return;
    }
    initHqBoardWebSocket();
  },
  { immediate: true }
);

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
  closeHqBoardWebSocket();
});

onActivated(() => {
  loadTasks();
});
</script>

<style lang="less" scoped>
/* 商业级 SaaS 风格 - 实时看板 */
.board-stats-spin {
  display: block;
  width: 100%;
}

.hq-board {
  padding: 24px;
  min-height: 100%;
  background-color: #f0f2f5;
  font-family: "PingFang SC", "Helvetica Neue", Helvetica, Arial, "Hiragino Sans GB", "Microsoft Yahei", sans-serif;
}

.board-header {
  margin-bottom: 24px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;

  .board-header-main {
    flex: 1;
    min-width: 220px;
  }

  .board-header-actions {
    flex-shrink: 0;
    align-self: flex-start;
  }

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

.hq-dispatched-body {
  max-height: min(58vh, 520px);
  overflow-y: auto;
  padding-right: 4px;
}

.hq-waterfall-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.hq-waterfall-card {
  background: #ffffff;
  border-radius: 12px;
  padding: 0;
  border: 1px solid #e5e7eb;
  border-left: 4px solid #2563eb;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  transition: box-shadow 0.2s, border-color 0.2s;
  overflow: hidden;

  &.is-expanded {
    border-color: #bfdbfe;
    box-shadow: 0 4px 14px rgba(37, 99, 235, 0.1);
  }

  .hq-wf-summary {
    padding: 16px 18px;
    cursor: pointer;
    user-select: none;
    transition: background 0.15s;

    &:hover {
      background: #f8fafc;
    }
  }

  .hq-wf-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .hq-wf-chevron {
    color: #9ca3af;
    font-size: 14px;
    transition: transform 0.2s ease;

    &.is-open {
      transform: rotate(180deg);
      color: #2563eb;
    }
  }

  .hq-wf-tag {
    display: inline-block;
    font-size: 12px;
    font-weight: 600;
    color: #15803d;
    background: #dcfce7;
    padding: 2px 8px;
    border-radius: 4px;
  }

  .hq-wf-title {
    margin: 0 0 8px;
    font-size: 16px;
    font-weight: 600;
    color: #111827;
    line-height: 1.4;
  }

  .hq-wf-meta {
    margin: 0 0 4px;
    font-size: 13px;
    color: #6b7280;
  }

  .hq-wf-time {
    margin: 0 0 8px;
    font-size: 12px;
    color: #9ca3af;
  }

  .hq-wf-hint {
    margin: 0;
    font-size: 12px;
    color: #2563eb;
  }

  .hq-wf-expand {
    padding: 0 18px 16px;
    border-top: 1px solid #f3f4f6;
    background: #fafbfc;
  }
}

.hq-detail-inner {
  padding-top: 4px;
}

.hq-detail-desc-block {
  margin-top: 16px;
}

.hq-detail-desc-label {
  font-size: 13px;
  color: #6b7280;
  margin-bottom: 8px;
}

.hq-detail-desc-text {
  white-space: pre-wrap;
  line-height: 1.6;
  background: #f9fafb;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid #f3f4f6;
  font-size: 14px;
  color: #4b5563;
}

.hq-detail-edit-btn {
  margin-top: 16px;
}

.hq-rules-card {
  border-left-color: #f97316;

  &.is-expanded {
    border-color: #fed7aa;
  }
}

.hq-rules-expand {
  .hq-rules-body {
    margin-bottom: 12px;
  }

  .hq-rule-block {
    margin-bottom: 14px;

    &:last-of-type {
      margin-bottom: 0;
    }
  }

  .hq-rule-block-title {
    font-size: 13px;
    font-weight: 600;
    color: #9a3412;
    margin-bottom: 6px;
  }

  .hq-rule-line {
    margin: 0 0 4px;
    font-size: 13px;
    color: #4b5563;
    line-height: 1.5;

    strong {
      color: #c2410c;
      font-weight: 600;
    }
  }

  .hq-rules-empty {
    margin: 8px 0 12px;
  }
}

.task-nav-section {
  margin-bottom: 24px;
  overflow-x: auto;
  padding-bottom: 8px;
  &::-webkit-scrollbar { height: 6px; }
  &::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; }
}

.auto-nudge-bar {
  margin-bottom: 16px;
  .auto-nudge-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    padding: 12px 16px;
    background: #fffbeb;
    border: 1px solid #fde68a;
    border-radius: 4px;
  }
  .auto-nudge-hint {
    font-size: 13px;
    color: #92400e;
    line-height: 1.5;
    flex: 1;
    min-width: 200px;
  }
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
