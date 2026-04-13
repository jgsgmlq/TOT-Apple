<template>
  <div class="emp-mobile-layout">
    <!-- 头部导航区 -->
    <header class="emp-header">
      <div class="emp-greeting">
        <h1 class="greet-text">Hi! {{ displayName }} 👋✨</h1>
        <div v-if="storeName" class="store-tag">
          <n-icon size="14"><ShopOutlined /></n-icon>
          <span>{{ storeName }}</span>
        </div>
        <p class="greet-sub">今天也是元气满满的一天哦！</p>
      </div>

      <!-- 右上角用户头像 & 退出气泡 -->
      <div class="emp-user">
        <n-popover trigger="click" placement="bottom-end" :show-arrow="true">
          <template #trigger>
            <div class="avatar-circle">
              <span class="avatar-text">{{ avatarText }}</span>
            </div>
          </template>
          <div class="logout-bubble" @click="onLogout">
            <n-icon size="16"><LogoutOutlined /></n-icon>
            <span>退出登录</span>
          </div>
        </n-popover>
      </div>
    </header>

    <!-- 上半部分：横向滑动的任务 Banner -->
    <section class="emp-banner-section">
      <h2 class="section-title">
        待完成的紧急任务 🎯
        <span v-if="pendingBanners.length > 0" class="task-count"
          >共 {{ pendingBanners.length }} 项</span
        >
      </h2>
      <div class="banner-scroll-wrapper" v-if="pendingBanners.length > 0">
        <div class="banner-list">
          <div
            class="banner-card"
            v-for="task in pendingBanners"
            :key="task.id"
            @click="scrollToTask(task.id)"
          >
            <div class="banner-content">
              <div class="b-info" style="display: flex; flex-direction: column; gap: 6px">
                <h3 class="b-title" style="margin: 0">{{ task.title }}</h3>
                <div class="b-deadline" style="margin: 0">
                  <!-- 动态倒计时 -->
                  <div
                    style="
                      display: flex;
                      align-items: center;
                      gap: 4px;
                      color: #ef4444;
                      font-weight: bold;
                      font-size: 13px;
                    "
                  >
                    <n-icon size="14"><ClockCircleOutlined /></n-icon>
                    <span>{{ getCountdown(task.ddlTimestamp) }}</span>
                  </div>
                </div>
              </div>
              <div class="b-action">
                <n-button type="primary" size="small" round @click.stop="jumpToMiniProgram(task)">
                  一键学习
                </n-button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="empty-banner">
        <p>太棒啦！目前没有紧急待办任务哦 ~</p>
      </div>
    </section>

    <!-- 下半部分：信息瀑布流 -->
    <section class="emp-waterfall-section">
      <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 12px; padding: 0 20px;">
        <h2 class="section-title" style="margin-bottom: 0; padding: 0;">消息中心 📬</h2>
        <n-button text type="primary" style="font-size: 13px;" @click="showHistoryModal = true">
          已完成任务 >
        </n-button>
      </div>
      <div class="waterfall-list">
        <transition-group name="fade-list">
          <div
            class="waterfall-card"
            :id="'msg-card-' + msg.id"
            v-for="msg in visibleMessages"
            :key="msg.id"
            :class="[
              msg.type === 'warning'
                ? msg.severity === 'red'
                  ? 'is-warning-red'
                  : 'is-warning-yellow'
                : 'is-task',
              msg.isCompleted ? 'is-completed-task' : ''
            ]"
            @click="handleViewTask(msg)"
          >
            <!-- 若已完成，在最上方插入Apple风格的庆贺栏 -->
            <div v-if="msg.isCompleted" class="completed-banner">
              <n-icon size="16"><CheckCircleOutlined /></n-icon>
              <span>恭喜你完成任务</span>
            </div>

            <!-- 卡片头部：预警用红/黄警示图标区分，文案统一 -->
            <div class="card-header">
              <div class="card-header-left">
                <n-icon
                  v-if="msg.type === 'warning'"
                  class="card-warn-icon"
                  :class="msg.severity === 'red' ? 'card-warn-icon--red' : 'card-warn-icon--yellow'"
                >
                  <WarningOutlined />
                </n-icon>
                <span class="card-tag" :class="msg.type">
                  {{ msg.type === 'warning' ? '预警通知' : '学习任务' }}
                </span>
              </div>
            </div>

            <!-- 卡片主要内容 -->
            <div class="card-body">
              <h3 class="c-title">{{ msg.title }}</h3>
              <p class="c-content">{{ msg.content }}</p>
              <div class="c-time">{{ msg.time }}</div>
            </div>

            <!-- 卡片底部操作按钮 -->
            <div class="card-actions" v-if="msg.type === 'task' && msg.isRead && !msg.isCompleted" style="display: flex; justify-content: flex-end;">
              
              <n-button
                class="action-btn do-btn"
                type="primary"
                @click.stop="handleMarkComplete(msg)"
              >
                去完成(测试烟花)
              </n-button>
            </div>
          </div>
        </transition-group>

        <div v-if="visibleMessages.length === 0" class="empty-state">
          <p>太棒啦，目前没有待处理的消息 ~ 🎉</p>
        </div>
      </div>
    </section>

    <!-- 任务详情弹窗 -->
    <n-modal
      v-model:show="showTaskModal"
      class="task-detail-modal"
      @update:show="onTaskModalShowChange"
      :style="{
        width: '90%',
        maxWidth: '400px',
        borderRadius: '16px',
        overflow: 'hidden',
        padding: '0',
        background: '#fff',
      }"
    >
      <div style="display: flex; flex-direction: column; max-height: 80vh">
        <!-- 固定头部 -->
        <div
          style="
            padding: 16px 20px;
            border-bottom: 1px solid #f3f4f6;
            font-size: 18px;
            font-weight: 600;
            flex-shrink: 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
          "
        >
          <span>任务详情</span>
          <n-icon size="20" color="#9ca3af" style="cursor: pointer" @click="showTaskModal = false"
            ><CloseOutlined
          /></n-icon>
        </div>

        <!-- 滚动内容区 -->
        <div
          v-if="currentTaskDetail"
          class="td-container custom-scroll"
          style="padding: 20px; overflow-y: auto; flex: 1"
          @scroll="onTaskModalScroll"
        >
          <n-descriptions
            label-placement="top"
            :column="2"
            bordered
            :label-style="{ color: '#6b7280', fontSize: '13px' }"
            :content-style="{ fontSize: '14px', fontWeight: '500', color: '#1f2937' }"
          >
            <n-descriptions-item label="任务名称" :span="2">
              {{ currentTaskDetail.title }}
            </n-descriptions-item>
            <n-descriptions-item label="截止时间" :span="2">
              {{ formatDetailTime(currentTaskDetail.ddlAt) }}
            </n-descriptions-item>
            <n-descriptions-item label="学习平台" :span="1">
              <n-space size="small">
                <n-tag type="info" size="small" :bordered="false" v-if="currentTaskDetail.hasMypal"
                  >MyPal</n-tag
                >
                <n-tag
                  type="info"
                  size="small"
                  :bordered="false"
                  v-if="currentTaskDetail.hasSmartSell"
                  >Sales Coach</n-tag
                >
                <n-tag type="info" size="small" :bordered="false" v-if="currentTaskDetail.hasAiDemo"
                  >AI Coach</n-tag
                >
                <n-tag
                  type="info"
                  size="small"
                  :bordered="false"
                  v-if="currentTaskDetail.hasLiveBroadcast"
                  >直播培训</n-tag
                >
              </n-space>
            </n-descriptions-item>
            <n-descriptions-item label="达标分数" :span="1">
              {{ currentTaskDetail.passScore ?? 100 }} 分
            </n-descriptions-item>
          </n-descriptions>

          <div style="margin-top: 16px">
            <div style="font-size: 13px; color: #6b7280; margin-bottom: 8px; padding-left: 4px"
              >任务详情</div
            >
            <div
              style="
                white-space: pre-wrap;
                line-height: 1.6;
                background: #f9fafb;
                padding: 12px;
                border-radius: 8px;
                border: 1px solid #f3f4f6;
                font-size: 14px;
                color: #4b5563;
              "
            >
              {{ currentTaskDetail.description || '总部未提供详细描述' }}
            </div>
          </div>
        </div>

        <!-- 固定底部：已读状态 + 去完成 -->
        <div v-if="currentTaskDetail && !currentTaskDetail.isCompleted" class="td-footer-actions" style="flex-direction: column; align-items: stretch; gap: 8px;">
          <div style="text-align: center; margin-bottom: 4px;">
            <span v-if="readConfirmDone" style="color: #10b981; font-size: 14px; font-weight: 500; display: inline-flex; align-items: center; gap: 4px;">
               <n-icon><CheckCircleOutlined /></n-icon> 已读
            </span>
            <span v-else style="color: #9ca3af; font-size: 13px;">请下滑阅读全部内容以标记已读</span>
          </div>
          <n-button
            v-if="readConfirmDone"
            type="primary"
            block
            size="large"
            class="td-btn"
            style="box-shadow: 0 4px 12px rgba(37, 99, 235, 0.2)"
            @click="handleGoToMiniProgram"
          >
            去完成
          </n-button>
        </div>
        <div v-else-if="currentTaskDetail && currentTaskDetail.isCompleted" class="td-footer-actions" style="padding: 16px 20px; text-align: center; background: #fafafa; border-top: 1px solid #f3f4f6;">
          <span style="color: #34c759; font-size: 16px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px;">
             <n-icon size="18"><CheckCircleOutlined /></n-icon> 任务已完成
          </span>
        </div>
      </div>
    </n-modal>

    <!-- 自动弹出的预警提醒灯箱 -->
    <n-modal
      v-model:show="showWarningModal"
      class="warning-detail-modal"
      :style="{
        width: '90%',
        maxWidth: '380px',
        borderRadius: '24px',
        background: '#ffffff',
        overflow: 'hidden',
      }"
      :mask-closable="true"
      size="huge"
    >
      <div v-if="currentWarnings.length > 0" class="wd-container" style="position: relative">
        <!-- 顶部：红色=紧急，黄色=催办（与 severity 一致） -->
        <div class="wd-hero" :class="warningModalTone === 'red' ? 'wd-hero--red' : 'wd-hero--yellow'">
          <div class="wd-icon-box" :class="warningModalTone === 'red' ? 'wd-icon-box--red' : 'wd-icon-box--yellow'">
            <n-icon size="36" color="#ffffff" style="transform: rotate(5deg)"
              ><WarningOutlined
            /></n-icon>
          </div>
          <h2 class="wd-hero-title" :class="warningModalTone === 'red' ? 'wd-hero-title--red' : 'wd-hero-title--yellow'">
            {{
              currentWarnings.length > 1
                ? `您有 ${currentWarnings.length} 条预警通知`
                : currentWarnings[0].title
            }}
          </h2>
          <p
            class="wd-hero-sub"
            :class="warningModalTone === 'red' ? 'wd-hero-sub--red' : 'wd-hero-sub--yellow'"
          >
            {{
              warningModalTone === 'red'
                ? '请优先处理以下学习任务'
                : '请关注并尽快完成以下学习任务'
            }}
          </p>
        </div>

        <!-- 悬浮的白色卡片区域：营造层级感 -->
        <div style="padding: 0 24px 28px; position: relative; top: -20px">
          <div
            style="max-height: 260px; overflow-y: auto; padding-right: 4px; margin-bottom: 24px"
            class="custom-scroll"
          >
            <div
              v-for="(w, idx) in currentWarnings"
              :key="w.id"
              class="wd-item-card"
            >
              <div
                class="wd-item-stripe"
                :class="w.severity === 'red' ? 'wd-item-stripe--red' : 'wd-item-stripe--yellow'"
              ></div>

              <h3 class="wd-item-title">
                <n-icon
                  size="20"
                  class="wd-item-warn-icon"
                  :class="w.severity === 'red' ? 'wd-item-warn-icon--red' : 'wd-item-warn-icon--yellow'"
                >
                  <WarningOutlined />
                </n-icon>
                <n-tag
                  size="small"
                  :bordered="false"
                  style="font-weight: 800; font-size: 12px; height: 20px"
                  >{{ String(idx + 1).padStart(2, '0') }}</n-tag
                >
                {{ currentWarnings.length > 1 ? w.title : '预警详情' }}
              </h3>
              <p
                style="
                  font-size: 14px;
                  line-height: 1.6;
                  color: #6b7280;
                  margin: 0;
                  text-align: justify;
                "
              >
                {{ w.content }}
              </p>
              <div
                style="
                  margin-top: 12px;
                  font-size: 12px;
                  color: #9ca3af;
                  display: flex;
                  align-items: center;
                  gap: 4px;
                "
              >
                <n-icon size="14"><ClockCircleOutlined /></n-icon>
                {{ w.time }}
              </div>
            </div>
          </div>

          <!-- 底部操作按钮 -->
          <n-button
            v-if="currentWarnings.length === 1"
            type="primary"
            block
            size="large"
            round
            style="
              height: 48px;
              font-size: 16px;
              font-weight: 600;
              box-shadow: 0 4px 12px rgba(37, 99, 235, 0.2);
            "
            @click="handleWarningAction"
          >
            {{ currentWarnings[0].readStatus ? '去完成' : '查看任务详情' }}
          </n-button>
          
          <n-button
            v-else
            type="primary"
            block
            size="large"
            round
            style="
              height: 48px;
              font-size: 16px;
              font-weight: 600;
              box-shadow: 0 4px 12px rgba(37, 99, 235, 0.2);
            "
            @click="showWarningModal = false"
          >
            我知道了
          </n-button>
        </div>
      </div>
    </n-modal>
    <!-- 历史记录 Modal -->
    <n-modal v-model:show="showHistoryModal" preset="card" title="已完成任务记录" class="history-modal" style="width: 90%; max-width: 400px; border-radius: 16px;">
      <div v-if="completedTasksData.length === 0" style="text-align: center; color: #999; padding: 40px 0;">
        暂无已完成的任务哦 ~
      </div>
      <div v-else class="history-list">
        <div v-for="task in completedTasksData" :key="task.id" class="history-card" @click="handleViewTask(task)">
          <div class="h-title">{{ task.title }}</div>
          <div class="h-time" style="color: #999; font-size: 12px; margin-top: 6px;">
            完成时间: {{ formatCompleteTime(task.assignment?.completedAt) }}
          </div>
        </div>
      </div>
    </n-modal>
  </div>
</template>

<script lang="ts" setup>
  import { computed, ref, onMounted, onUnmounted } from 'vue';
  import { useRouter } from 'vue-router';
  import { useMessage, useDialog } from 'naive-ui';
  import { useUserStore } from '@/store/modules/user';
  import { PageEnum } from '@/enums/pageEnum';
  import {
    LogoutOutlined,
    CloseOutlined,
    ClockCircleOutlined,
    WarningOutlined,
    CheckCircleOutlined,
    ShopOutlined,
  } from '@vicons/antd';
  import { getTaskList, getTaskDetail } from '@/api/task';
  import { getEvents, markEventRead, type EventItem } from '@/api/event/index';
  import { putAssignmentStatus, postAssignmentViewed } from '@/api/assignment';
  import { Alova } from '@/utils/http/alova/index';

  import { useGlobSetting } from '@/hooks/setting';
  const { apiUrl } = useGlobSetting();

  const userStore = useUserStore();
  const router = useRouter();
  const message = useMessage();
  const dialog = useDialog();

  const displayName = computed(() => {
    const u = userStore.getUserInfo;
    return u?.username || u?.email || '店员伙伴';
  });

  const avatarText = computed(() => {
    const name = displayName.value;
    return name ? Array.from(name)[0].toUpperCase() : 'U';
  });

  const storeName = ref<string>('');

  const loadStoreName = async () => {
    const u = userStore.getUserInfo;
    if (u?.storeId) {
      try {
        const res: any = await Alova.Get(`/stores/${u.storeId}`).send();
        storeName.value = res?.data?.name || res?.name || '未知门店';
      } catch (e) {
        console.error('Failed to load store info:', e);
        storeName.value = '未知门店';
      }
    } else {
      storeName.value = '未分配门店';
    }
  };

  // --- 数据响应式结构 ---
  const pendingBanners = ref<any[]>([]);
  const waterfallMessages = ref<any[]>([]);
  const completedTasksData = ref<any[]>([]);
  const showHistoryModal = ref(false);

  function formatCompleteTime(iso: string | null | undefined): string {
    if (!iso) return '未知';
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  const showTaskModal = ref(false);
  const currentTaskDetail = ref<any>(null);
  /** 当前弹窗对应 assignment，用于 POST /assignments/:id/viewed（task_detail_open） */
  const currentTaskModalAssignmentId = ref<string | undefined>(undefined);
  const readConfirmSending = ref(false);
  const readConfirmDone = ref(false);

  const showWarningModal = ref(false);
  const currentWarnings = ref<any[]>([]);

  /** 弹窗顶区主色调：含任一条红色预警则用红色，否则黄色 */
  const warningModalTone = computed(() => {
    const list = currentWarnings.value;
    if (!list.length) return 'yellow';
    return list.some((w: any) => w.severity === 'red') ? 'red' : 'yellow';
  });

  let ws: WebSocket | null = null;
  const NUDGE_COPY_CACHE_KEY = 'tot_employee_nudge_copy_cache_v1';

  function readNudgeCopyCache(): Record<string, string> {
    try {
      const raw = localStorage.getItem(NUDGE_COPY_CACHE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeNudgeCopyCache(cache: Record<string, string>) {
    try {
      localStorage.setItem(NUDGE_COPY_CACHE_KEY, JSON.stringify(cache));
    } catch {
      // ignore
    }
  }

  function cacheNudgeCopy(eventId: string | undefined, content: string | undefined) {
    const id = String(eventId || '').trim();
    const text = String(content || '').trim();
    if (!id || !text) return;
    const cache = readNudgeCopyCache();
    cache[id] = text;
    writeNudgeCopyCache(cache);
  }

  const initWebSocket = () => {
    const token = userStore.getToken;
    if (!token) return;

    let wsHost = apiUrl;
    if (!wsHost || wsHost.startsWith('/')) {
      wsHost = window.location.origin;
    }
    const wsUrl = `${wsHost.replace(/^http/, 'ws')}/ws?token=${token}`;

    ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.event === 'task_assigned') {
          message.info('📬 你有新的培训任务');
          loadEmployeeTasks();
        } else if (parsed.event === 'task_updated') {
          message.info('🔄 你的培训任务有更新');
          loadEmployeeTasks();
        } else if (parsed.event === 'task_deleted') {
          message.info('🗑️ 你有一个培训任务已被撤回/删除');
          loadEmployeeTasks();
        } else if (parsed.event === 'assignment_completed') {
          triggerConfetti(0.5, 0.8);
          loadEmployeeTasks();
        } else if (parsed.event === 'nudge_sent') {
          message.warning('你收到一条催办提醒');
          const nid = parsed.data.eventId || parsed.data.nudgeRecordId || Date.now().toString();
          cacheNudgeCopy(parsed.data.eventId, parsed.data.content);
          const sev = parsed.data.severity === 'red' ? 'red' : 'yellow';
          const newWarning = {
            id: nid,
            eventId: parsed.data.eventId,
            type: 'warning',
            severity: sev,
            readStatus: false,
            title: parsed.data.severity === 'red' ? '⚠️ 紧急预警' : '⚠️ 催办提醒',
            content: parsed.data.content || '您有任务需要尽快处理。',
            time: '刚刚',
          };
          waterfallMessages.value.unshift(newWarning);
          currentWarnings.value = [newWarning];
          showWarningModal.value = true;
        }
      } catch (e) {
        console.error('Failed to parse WebSocket message', e);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket closed');
    };
  };

  // 过滤掉被叉掉的预警信息
  const visibleMessages = computed(() => waterfallMessages.value);

  function formatRuleTypeLabel(ruleType: string | null | undefined): string {
    if (!ruleType) return '';
    const map: Record<string, string> = {
      progressLag: '进度掉队',
      startDelay: '起步异常',
      deadlineCrisisP0: '临期危机 (P0)',
      deadlineCrisisP1: '临期危机 (P1)',
    };
    return map[ruleType] || ruleType;
  }

  function formatRelativeTime(iso: string): string {
    if (!iso) return '';
    const t = new Date(iso).getTime();
    const diff = Date.now() - t;
    const m = Math.floor(diff / 60000);
    if (m < 1) return '刚刚';
    if (m < 60) return `${m} 分钟前`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} 小时前`;
    const d = Math.floor(h / 24);
    return `${d} 天前`;
  }

  // 关闭消息的方法 (只针对预警)；有 eventId 时同步标记已读
  const closeMessage = async (id: string) => {
    const msg = waterfallMessages.value.find((m) => m.id === id);
    if (msg?.type === 'warning' && msg.eventId) {
      try {
        await markEventRead(msg.eventId).send();
      } catch (e) {
        console.warn('markEventRead failed', e);
      }
    }
    const index = waterfallMessages.value.findIndex((m) => m.id === id);
    if (index > -1) {
      waterfallMessages.value.splice(index, 1);
    }
  };

  // 点击 Banner 定位到下方的任务卡片
  const jumpToMiniProgram = (task: any) => {
    message.success(`🚀 即将跳转: ${task.title}`, { duration: 2000 });
    handleGoToMiniProgram();
  };

  const scrollToTask = (id: string) => {
    const targetEl = document.getElementById(`msg-card-${id}`);
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // 添加一个短暂的高亮提示动画，提升用户体验
      targetEl.classList.add('highlight-pulse');
      setTimeout(() => {
        targetEl.classList.remove('highlight-pulse');
      }, 1500);
    }
  };

  // --- 动态倒计时逻辑 ---
  const currentTime = ref(Date.now());
  let timerInterval: any = null;

  const getCountdown = (ddlTimestamp: number) => {
    const diff = ddlTimestamp - currentTime.value;
    if (diff <= 0) return '已超时';
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const minutes = Math.floor((diff / (1000 * 60)) % 60);
    const seconds = Math.floor((diff / 1000) % 60);

    if (days > 0) {
      return `剩 ${days}天 ${hours}时 ${minutes}分 ${seconds}秒`;
    }
    if (hours > 0) {
      return `剩 ${hours}时 ${minutes}分 ${seconds}秒`;
    }
    return `剩 ${minutes}分 ${seconds}秒`;
  };

  // 获取真实任务列表 + 通知事件中的催办/预警（nudge_yellow / nudge_red）
  const loadEmployeeTasks = async (isInitialLoad = false) => {
    try {
      const [taskRes, eventsPayload] = await Promise.all([
        getTaskList().send(),
        getEvents({ pageSize: 50, isActive: 'true' })
          .send()
          .catch(() => ({ list: [] as EventItem[] })),
      ]);

      const realTasks = taskRes || [];
      const eventList: EventItem[] = eventsPayload?.list || [];

      const taskTitleById = new Map<string, string>(realTasks.map((t: any) => [t.id, t.title]));

      const nudgeEvents = eventList.filter(
        (e) => (e.eventType === 'nudge_yellow' || e.eventType === 'nudge_red') && e.isActive
      );
      const nudgeCopyCache = readNudgeCopyCache();

      const warningsFromApi = nudgeEvents.map((ev) => {
        const taskTitle = taskTitleById.get(ev.taskId) || '学习任务';
        const prefix = ev.severity === 'red' ? '⚠️ 紧急预警' : '⚠️ 催办提醒';
        // 将任务名称与后端的具体预警原因拼接起来
        let rawContent = ev.content || nudgeCopyCache[ev.eventId];
        let nudgeContent = rawContent ? `【${taskTitle}】触发了预警：${rawContent}` : `【${taskTitle}】您有任务需要尽快处理。`;
        
        const severity = ev.severity === 'red' ? 'red' : 'yellow';
        return {
          id: ev.eventId,
          eventId: ev.eventId,
          type: 'warning' as const,
          severity,
          taskId: ev.taskId,
          readStatus: ev.readStatus,
          title: prefix,
          content: nudgeContent,
          time: formatRelativeTime(ev.createdAt),
        };
      });

      const doneTasks = realTasks.filter(
        (t: any) => t.assignment && t.assignment.status === 'completed'
      );
      completedTasksData.value = doneTasks.sort((a, b) => {
        const tA = new Date(a.assignment.completedAt || a.updatedAt).getTime();
        const tB = new Date(b.assignment.completedAt || b.updatedAt).getTime();
        return tB - tA; // newest completed first
      });

      // 提取未完成任务 (用于横幅)
      const openTasks = realTasks.filter(
        (t: any) => !t.assignment || t.assignment.status !== 'completed'
      );

      // 提取24小时内完成的任务 (用于瀑布流展示)
      const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
      const now = Date.now();
      const recentDoneTasks = doneTasks.filter((t: any) => {
        const completedAt = new Date(t.assignment.completedAt || t.updatedAt).getTime();
        return (now - completedAt) <= TWENTY_FOUR_HOURS;
      });

      // 组装要在瀑布流和横幅展示的数据
      const displayTasks = [...openTasks, ...recentDoneTasks];

      const formattedTasks = displayTasks.map((t: any) => {
        const ddl = new Date(t.ddlAt);
        const formattedDdl = `${ddl.getMonth() + 1}月${ddl.getDate()}日 ${String(
          ddl.getHours()
        ).padStart(2, '0')}:${String(ddl.getMinutes()).padStart(2, '0')}`;
        
        const isCompleted = t.assignment?.status === 'completed';

        return {
          id: t.id,
          assignmentId: t.assignment?.id as string | undefined,
          isRead: !!t.assignment?.receivedAt,
          type: 'task' as const,
          title: t.title,
          desc: t.description || '总部未提供详细描述',
          content: isCompleted ? `恭喜！你已于 ${t.assignment?.completedAt ? new Date(t.assignment.completedAt).toLocaleString('zh-CN', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : '最近'} 完成该任务。` : `总部下发了一项学习任务，要求在 ${formattedDdl} 前完成。`,
          deadline: formattedDdl,
          ddlTimestamp: ddl.getTime(),
          time: t.createdAt ? t.createdAt.substring(0, 10) : '刚刚',
          isCompleted: isCompleted,
        };
      });

      // 瀑布流任务按截止时间排序（也可以考虑把已完成的排在下面，这里暂保持原状）
      formattedTasks.sort((a, b) => a.ddlTimestamp - b.ddlTimestamp);

      // 横幅只展示未完成的任务
      pendingBanners.value = formattedTasks.filter(t => !t.isCompleted);

      const tasksForWaterfall = formattedTasks.map((t) => ({
        ...t,
        title: t.isCompleted ? `🎉 【已完成】${t.title}` : `【待完成】${t.title}`,
      }));

      // === [临时测试代码] 注入一条已经完成的假数据 ===
      const mockCompletedTask = {
        id: 'mock-999',
        type: 'task',
        title: '🎉 【已完成】苹果生态产品基础规范 (UI测试)',
        content: '恭喜！你已于 刚刚 完成该任务。',
        deadline: '今天 23:59',
        time: '刚刚',
        isCompleted: true,
        isRead: true
      };

      waterfallMessages.value = [...warningsFromApi, mockCompletedTask, ...tasksForWaterfall];
      // === [临时测试代码结束] ===

      // 彻底解耦逻辑：只在页面首次加载时检查并弹出积压的预警
      if (isInitialLoad) {
        const unreadWarnings = warningsFromApi.filter((w) => !w.readStatus);
        if (unreadWarnings.length > 0) {
          currentWarnings.value = unreadWarnings;
          showWarningModal.value = true;
        } else {
          currentWarnings.value = [];
          showWarningModal.value = false;
        }
      }
    } catch (err: any) {
      console.error(err);
      message.error('获取任务列表失败，请稍后再试');
    }
  };

  // --- 烟花动画函数 (原生实现，轻量级) ---
  const triggerConfetti = (x: number = 0.5, y: number = 0.5) => {
    const canvas = document.createElement('canvas');
    canvas.style.position = 'fixed';
    canvas.style.inset = '0';
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '9999';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles: any[] = [];
    const colors = ['#0071e3', '#34c759', '#ff9f0a', '#ff3b30', '#af52de'];
    
    for (let i = 0; i < 100; i++) {
      particles.push({
        x: canvas.width * x,
        y: canvas.height * y,
        r: Math.random() * 6 + 2,
        dx: Math.random() * 10 - 5,
        dy: Math.random() * -10 - 5,
        color: colors[Math.floor(Math.random() * colors.length)],
        tilt: Math.floor(Math.random() * 10) - 10,
        tiltAngleInc: (Math.random() * 0.07) + 0.05,
        tiltAngle: 0
      });
    }

    let animationFrame: number;
    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let remaining = false;
      particles.forEach((p, i) => {
        p.tiltAngle += p.tiltAngleInc;
        p.y += (Math.cos(p.tiltAngle) + 1 + p.r / 2) / 2;
        p.x += Math.sin(p.tiltAngle) * 2;
        p.dy += 0.1; // gravity
        p.x += p.dx;
        p.y += p.dy;
        
        if (p.y <= canvas.height) remaining = true;
        
        ctx.beginPath();
        ctx.lineWidth = p.r;
        ctx.strokeStyle = p.color;
        ctx.moveTo(p.x + p.tilt + p.r, p.y);
        ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r);
        ctx.stroke();
      });
      if (remaining) {
        animationFrame = requestAnimationFrame(render);
      } else {
        document.body.removeChild(canvas);
      }
    };
    render();
    setTimeout(() => {
      cancelAnimationFrame(animationFrame);
      if (document.body.contains(canvas)) document.body.removeChild(canvas);
    }, 4000);
  };

  onMounted(() => {
    initWebSocket();
    timerInterval = setInterval(() => {
      currentTime.value = Date.now();
    }, 1000);
    loadStoreName();
    loadEmployeeTasks(true);
  });

  onUnmounted(() => {
    if (timerInterval) {
      clearInterval(timerInterval);
    }
    if (ws) {
      ws.close();
      ws = null;
    }
  });

  // --- 任务操作 ---

  // 1. 跳转到微信小程序
  const handleGoToMiniProgram = () => {
    const a = document.createElement('a');
    a.href = 'weixin://dl/business/?appid=wx8490a792205aecda&path=pages/login/login&query=&env_version=release';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      document.body.removeChild(a);
    }, 100);

    message.loading('正在尝试唤起微信小程序...', { duration: 1500 });
  };

  const handleWarningAction = () => {
    const allRead = currentWarnings.value.every(w => w.readStatus);
    
    if (allRead) {
      handleGoToMiniProgram();
    } else {
      // 找到第一条预警对应的任务详情并打开
      if (currentWarnings.value.length > 0) {
        const warning = currentWarnings.value[0];
        showWarningModal.value = false; // 关闭预警弹窗
        
        // 从现有消息流中找出对应的真实任务卡片数据，获取 assignmentId
        const realTaskMsg = waterfallMessages.value.find(m => m.type === 'task' && m.id === warning.taskId);

        // 构造一个临时的 msg 对象传给 handleViewTask (模拟点击真实任务卡片)
        const mockTaskMsg = {
          id: warning.taskId, // 任务 ID
          type: 'task', // 伪装成任务卡片点击
          isRead: realTaskMsg ? realTaskMsg.isRead : false,
          isCompleted: realTaskMsg ? realTaskMsg.isCompleted : false,
          assignmentId: realTaskMsg ? realTaskMsg.assignmentId : undefined
        };
        handleViewTask(mockTaskMsg);
        
        // 顺便把该预警消息设为已读
        closeMessage(warning.id);
      }
    }
  };

  const onTaskModalShowChange = (show: boolean) => {
    if (!show) {
      currentTaskDetail.value = null;
      currentTaskModalAssignmentId.value = undefined;
      readConfirmDone.value = false;
      readConfirmSending.value = false;
    }
  };

  /** 确认已读：写入 read_receipts（task_detail_open），计入总部看板「任务读取率」 */
  const handleConfirmTaskRead = async (silent = false) => {
    const aid = currentTaskModalAssignmentId.value;
    if (!aid) return;
    if (readConfirmDone.value || readConfirmSending.value) return;
    readConfirmSending.value = true;
    try {
      await postAssignmentViewed(aid).send();
      readConfirmDone.value = true;
      
      // 更新外层瀑布流中的状态
      const t = waterfallMessages.value.find(m => m.assignmentId === aid);
      if (t) t.isRead = true;
    } catch (err: any) {
      if (!silent) console.error(err);
    } finally {
      readConfirmSending.value = false;
    }
  };

  const onTaskModalScroll = (e: Event) => {
    const target = e.target as HTMLElement;
    // 到底部留点容差（例如10px）
    if (target.scrollHeight - target.scrollTop - target.clientHeight <= 10) {
      handleConfirmTaskRead(true);
    }
  };

  const checkScrollToBottom = () => {
    const el = document.querySelector('.td-container');
    if (el) {
      if (el.scrollHeight - el.scrollTop - el.clientHeight <= 10) {
         handleConfirmTaskRead(true);
      }
    }
  };

  // 2. 查阅真实任务详情，调用后端 GET /tasks/:id（已读由弹窗内「确认已读」触发）
  const handleViewTask = async (msg: any) => {
    if (msg.type === 'warning') {
      currentWarnings.value = [msg]; // 如果单独点击某个预警卡片，则只展示这一条
      showWarningModal.value = true;
      return;
    }

    readConfirmDone.value = !!msg.isRead;
    currentTaskModalAssignmentId.value = msg.assignmentId as string | undefined;

    const msgReactive = message.loading('加载任务详情中...', { duration: 0 });
    try {
      const res = await getTaskDetail(msg.id).send();
      currentTaskDetail.value = { ...res, isCompleted: msg.isCompleted };
      showTaskModal.value = true;
      setTimeout(checkScrollToBottom, 100);
    } catch (err: any) {
      message.error(err.message || '获取任务详情失败');
    } finally {
      msgReactive.destroy();
    }
  };

  const formatDetailTime = (isoStr: string) => {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(
      d.getHours()
    ).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const getCountdownText = (isoStr: string) => {
    if (!isoStr) return '';
    const diff = new Date(isoStr).getTime() - Date.now();
    if (diff <= 0) return '已逾期';
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const minutes = Math.floor((diff / (1000 * 60)) % 60);
    const seconds = Math.floor((diff / 1000) % 60);

    if (days > 0) return `剩 ${days}天 ${hours}时 ${minutes}分 ${seconds}秒`;
    if (hours > 0) return `剩 ${hours}时 ${minutes}分 ${seconds}秒`;
    return `剩 ${minutes}分 ${seconds}秒`;
  };

  const handleMarkRead = async (msg: any) => {
    try {
      if (msg.eventId) {
        await markEventRead(msg.eventId).send();
      }
      closeMessage(msg.id);
      message.success('已标记为已读');
    } catch (e) {
      console.error('标记已读失败', e);
      message.error('标记已读失败');
    }
  };

  const handleMarkComplete = (msg: any) => {
    if (msg.type === 'warning') {
      message.warning('预警通知无法直接标记完成，请前去完成对应的任务！');
      return;
    }
    dialog.warning({
      title: '请您确认是否完成',
      content: '确认后将同步到服务器：标记整单学习任务为已完成，且不可撤销。',
      positiveText: '确认完成',
      negativeText: '取消',
      onPositiveClick: async () => {
        const assignmentId = msg.assignmentId as string | undefined;
        if (!assignmentId) {
          message.error('无法获取任务分配信息，请刷新页面后重试');
          return false;
        }
        const loading = message.loading('正在提交…', { duration: 0 });
        try {
          // === [临时测试代码] 屏蔽真实请求，改用定时器模拟 ===
          await new Promise(resolve => setTimeout(resolve, 500));
          // await putAssignmentStatus(assignmentId, { operationType: 'complete_task' }).send();
        } catch (err: any) {
          message.error(err?.message || '标记完成失败，请稍后重试');
          return false;
        } finally {
          loading.destroy();
        }

        // 修改为24小时留存逻辑：不再直接 splice 删除，而是标记为已完成并保留在原位
        const idx = waterfallMessages.value.findIndex((m) => m.id === msg.id);
        if (idx !== -1) {
          const currentMsg = waterfallMessages.value[idx];
          currentMsg.isCompleted = true;
          currentMsg.title = `🎉 【已完成】${currentMsg.title.replace('【待完成】', '')}`;
          currentMsg.content = `恭喜！你已于 刚刚 完成该任务。`;
        }

        const bannerIdx = pendingBanners.value.findIndex((b) => b.id === msg.id);
        if (bannerIdx !== -1) {
          pendingBanners.value.splice(bannerIdx, 1);
        }

        triggerConfetti(0.5, 0.8); // 屏幕中下方位置发射烟花
        message.success('任务已完成');
      },
    });
  };

  // 退出登录
  const onLogout = () => {
    dialog.warning({
      title: '退出登录',
      content: '确定退出当前账号？',
      positiveText: '确定',
      negativeText: '取消',
      onPositiveClick: () => {
        userStore.logout().then(() => {
          message.success('已退出');
          router.replace({ path: PageEnum.BASE_LOGIN });
        });
      },
    });
  };
</script>

<style lang="less" scoped>
  /* 移动端页面容器底座 */
  .emp-mobile-layout {
    min-height: 100vh;
    min-height: 100dvh;
    background-color: #f7f8fa; /* 柔和干净的移动端底色 */
    padding-bottom: max(40px, env(safe-area-inset-bottom));
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    max-width: 600px; /* 在电脑上居中显示手机尺寸，手机上100%宽 */
    margin: 0 auto;
    box-shadow: 0 0 20px rgba(0, 0, 0, 0.05); /* 在电脑端有边界感 */
    position: relative;
    overflow-x: hidden;
  }

  /* 1. 头部导航区 */
  .emp-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 32px 20px 20px;
    background: #ffffff;
    border-bottom-left-radius: 24px;
    border-bottom-right-radius: 24px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.03);
    position: relative;
    z-index: 10;

    .emp-greeting {
      flex: 1;
      .greet-text {
        margin: 0 0 6px;
        font-size: 26px;
        font-weight: 800;
        color: #111827;
        letter-spacing: -0.5px;
        line-height: 1.2;
      }
      .store-tag {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 13px;
        color: #2563eb;
        background: rgba(37, 99, 235, 0.08);
        padding: 4px 10px;
        border-radius: 12px;
        margin-bottom: 10px;
        font-weight: 600;
      }
      .greet-sub {
        margin: 0;
        font-size: 14px;
        color: #6b7280;
      }
    }

    .emp-user {
      margin-left: 16px;
      flex-shrink: 0;

      .avatar-circle {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
        border: 2px solid #ffffff;
        box-shadow: 0 4px 12px rgba(37, 99, 235, 0.15);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: transform 0.2s, box-shadow 0.2s;

        &:hover {
          box-shadow: 0 6px 16px rgba(37, 99, 235, 0.25);
        }

        &:active {
          transform: scale(0.95);
        }

        .avatar-text {
          font-size: 22px;
          font-weight: 800;
          color: #2563eb;
          font-family: ui-rounded, 'SF Pro Rounded', -apple-system, BlinkMacSystemFont, sans-serif;
          user-select: none;
        }
      }
    }
  }

  /* 退出登录气泡样式 */
  .logout-bubble {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    color: #dc2626;
    font-weight: 500;
    cursor: pointer;
    border-radius: 8px;
    transition: background 0.2s;

    &:hover,
    &:active {
      background: #fef2f2;
    }
  }

  /* 公共标题 */
  .section-title {
    margin: 0 0 16px;
    padding: 0 20px;
    font-size: 18px;
    font-weight: 700;
    color: #1f2937;
    display: flex;
    align-items: center;

    .task-count {
      margin-left: 8px;
      font-size: 12px;
      font-weight: 500;
      color: #2563eb;
      background: #eff6ff;
      padding: 2px 8px;
      border-radius: 12px;
    }
  }

  /* 2. 上半部分：横向 Banner */
  .emp-banner-section {
    margin-top: 24px;

    .banner-scroll-wrapper {
      padding: 0 20px 16px;
    }

    .banner-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .banner-card {
      border-radius: 12px;
      background: #ffffff;
      padding: 16px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;

      &:active {
        transform: scale(0.98);
        background-color: #f9fafb;
      }

      .banner-content {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;

        .b-info {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .b-title {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
          color: #1f2937;
          line-height: 1.4;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .b-deadline {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 13px;
          color: #9ca3af;
        }

        .b-action {
          flex-shrink: 0;
        }
      }
    }
  }

  .empty-banner {
    padding: 30px 20px;
    text-align: center;
    color: #9ca3af;
    font-size: 14px;
    background: #ffffff;
    border-radius: 16px;
    margin: 0 20px;
    border: 1px dashed #e5e7eb;
  }

  /* 3. 下半部分：瀑布流 */
  .emp-waterfall-section {
    margin-top: 16px;

    .waterfall-list {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 0 20px;
    }

    .waterfall-card {
      background: #ffffff;
      border-radius: 16px;
      padding: 20px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.04);
      position: relative;
      border: 1px solid #f3f4f6;
      scroll-margin-top: 24px; /* 定位时距离顶部留出间隙 */
      transition: all 0.3s ease;
      cursor: pointer;

      /* 预警：浅色底 + 柔和左边框（红/黄再浅一档） */
      &.is-warning-red {
        border-left: 4px solid #fca5a5;
        background: #fffafa;
      }

      &.is-warning-yellow {
        border-left: 4px solid #fcd34d;
        background: #fffef6;
      }

      &.is-task {
        border-left: 4px solid #3b82f6; /* 蓝色左边框强调任务 */
      }

      /* 已完成任务的柔和过渡效果 */
      &.is-completed-task {
        opacity: 0.8;
        background: linear-gradient(135deg, #f5f5f7, #ffffff);
        border-left-color: #34c759;
        box-shadow: inset 0 0 0 1px rgba(52, 199, 89, 0.1), 0 2px 8px rgba(0, 0, 0, 0.02);
      }

      .completed-banner {
        display: flex;
        align-items: center;
        gap: 6px;
        color: #34c759;
        font-size: 13px;
        font-weight: 600;
        margin: -20px -20px 16px -20px;
        padding: 10px 20px;
        background: rgba(52, 199, 89, 0.1);
        border-top-left-radius: 16px;
        border-top-right-radius: 16px;
        letter-spacing: -0.3px;
      }

      /* 定位时的高亮闪烁动画 */
      &.highlight-pulse {
        animation: cardPulse 1.5s ease-out;
      }
      @keyframes warningPulse {
        0% { 
          opacity: 0.4; 
          transform: scale(0.9); 
          filter: drop-shadow(0 0 0px currentColor);
        }
        50% { 
          opacity: 1; 
          transform: scale(1.25); 
          filter: drop-shadow(0 0 12px currentColor) brightness(1.2); 
        }
        100% { 
          opacity: 0.4; 
          transform: scale(0.9); 
          filter: drop-shadow(0 0 0px currentColor);
        }
      }

      .card-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;

        .card-header-left {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }

        .card-warn-icon {
          flex-shrink: 0;
          font-size: 22px; /* 稍微调大一点基础尺寸 */
          animation: warningPulse 0.8s infinite cubic-bezier(0.4, 0, 0.6, 1);
          will-change: transform, opacity, filter;
        }

        .card-warn-icon--red {
          color: #f87171;
        }

        .card-warn-icon--yellow {
          color: #fbbf24;
        }

        .card-tag {
          font-size: 12px;
          font-weight: 600;
          padding: 4px 10px;
          border-radius: 8px;

          &.task {
            color: #2563eb;
            background: #eff6ff;
          }

          &.warning {
            color: #4b5563;
            background: #f3f4f6;
          }
        }

        .close-btn {
          margin-right: -8px;
          color: #9ca3af;
          &:active {
            color: #4b5563;
          }
        }
      }

      .card-body {
        margin-bottom: 16px;

        .c-title {
          margin: 0 0 8px;
          font-size: 16px;
          font-weight: 700;
          color: #111827;
          line-height: 1.4;
        }

        .c-content {
          margin: 0 0 12px;
          font-size: 14px;
          color: #4b5563;
          line-height: 1.5;
        }

        .c-time {
          font-size: 12px;
          color: #9ca3af;
        }
      }

      .card-actions {
        display: flex;
        gap: 12px;

        .action-btn {
          flex: 1;
          border-radius: 12px;
          font-weight: 600;
          height: 40px;
        }

        .view-btn {
          background: #f3f4f6;
          color: #4b5563;
          border: none;
        }

        .do-btn {
          background: #2563eb;
          color: #ffffff;
          border: none;
          box-shadow: 0 4px 12px rgba(37, 99, 235, 0.2);
        }
      }
    }
  }

  .empty-state {
    text-align: center;
    padding: 40px 0;
    color: #9ca3af;
    font-size: 14px;
  }

  /* 列表动画 */
  .fade-list-move,
  .fade-list-enter-active,
  .fade-list-leave-active {
    transition: all 0.4s ease;
  }
  .fade-list-enter-from,
  .fade-list-leave-to {
    opacity: 0;
    transform: translateX(30px);
  }
  .fade-list-leave-active {
    position: absolute; /* 使移除的元素不占据空间，保证平滑过渡 */
  }

  /* 弹窗内容样式 */
  .td-container {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .td-title {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
    color: #111827;
    line-height: 1.4;
  }

  .td-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .td-desc {
    background: #f9fafb;
    padding: 16px;
    border-radius: 8px;
    font-size: 14px;
    color: #4b5563;
    max-height: 200px;
    overflow-y: auto;
  }

  .td-meta {
    display: flex;
    flex-direction: column;
    gap: 8px;
    color: #6b7280;
    font-size: 13px;

    .meta-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }
  }

  .td-footer-actions {
    padding: 16px 20px;
    border-top: 1px solid #f3f4f6;
    flex-shrink: 0;
    background: #fff;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .td-read-hint {
    margin: -4px 0 0;
    font-size: 12px;
    color: #9ca3af;
    text-align: center;
    line-height: 1.45;
  }

  .td-btn {
    margin-top: 8px;
    border-radius: 8px;
    font-weight: 600;
  }

  .td-footer-actions .td-btn {
    margin-top: 0;
  }

  /* 高亮闪烁动画 */
  @keyframes cardPulse {
    0% {
      box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.4);
      border-color: #93c5fd;
      background-color: #eff6ff;
    }
    50% {
      box-shadow: 0 0 0 8px rgba(59, 130, 246, 0);
      border-color: #3b82f6;
      background-color: #eff6ff;
    }
    100% {
      box-shadow: 0 0 0 0 rgba(59, 130, 246, 0);
      border-color: #f3f4f6;
      background-color: #ffffff;
    }
  }
  /* 自定义滚动条 */
  .custom-scroll::-webkit-scrollbar {
    width: 4px;
  }
  .custom-scroll::-webkit-scrollbar-thumb {
    background: #cbd5e1;
    border-radius: 4px;
  }
  .custom-scroll::-webkit-scrollbar-track {
    background: transparent;
  }

  /* 预警弹窗：红 / 黄两套顶区与条目装饰 */
  .wd-hero {
    padding: 32px 24px 40px;
    text-align: center;
    position: relative;
  }

  .wd-hero--red {
    background: linear-gradient(145deg, #fffbfb 0%, #fef2f2 100%);
  }

  .wd-hero--yellow {
    background: linear-gradient(145deg, #fffef9 0%, #fffbeb 100%);
  }

  .wd-icon-box {
    width: 64px;
    height: 64px;
    border-radius: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 16px;
    transform: rotate(-5deg);
  }

  .wd-icon-box--red {
    background: #fca5a5;
    box-shadow: 0 8px 16px rgba(252, 165, 165, 0.35);
  }

  .wd-icon-box--yellow {
    background: #fcd34d;
    box-shadow: 0 8px 16px rgba(252, 211, 77, 0.35);
  }

  .wd-hero-title {
    margin: 0;
    font-size: 22px;
    font-weight: 800;
  }

  .wd-hero-title--red {
    color: #ef4444;
  }

  .wd-hero-title--yellow {
    color: #b45309;
  }

  .wd-hero-sub {
    margin: 8px 0 0;
    font-size: 14px;
    font-weight: 500;
  }

  .wd-hero-sub--red {
    color: #f87171;
  }

  .wd-hero-sub--yellow {
    color: #f59e0b;
  }

  .wd-item-card {
    background: #ffffff;
    border: 1px solid #f3f4f6;
    border-radius: 16px;
    padding: 18px;
    margin-bottom: 12px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04);
    position: relative;
    overflow: hidden;
  }

  .wd-item-stripe {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
  }

  .wd-item-stripe--red {
    background: #fca5a5;
  }

  .wd-item-stripe--yellow {
    background: #fcd34d;
  }

  .wd-item-title {
    margin: 0 0 8px;
    font-size: 16px;
    font-weight: 700;
    color: #1f2937;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }

  .wd-item-warn-icon {
    flex-shrink: 0;
  }

  .wd-item-warn-icon--red {
    color: #f87171;
  }

  .wd-item-warn-icon--yellow {
    color: #fbbf24;
  }

.history-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 60vh;
  overflow-y: auto;
  padding: 4px;
}
.history-card {
  padding: 12px 16px;
  background: #f9f9fb;
  border-radius: 12px;
  cursor: pointer;
  transition: background 0.2s;
}
.history-card:active {
  background: #f0f0f5;
}
.h-title {
  font-size: 15px;
  font-weight: 600;
  color: #1d1d1f;
}
</style>
