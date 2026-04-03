<template>
  <div class="emp-mobile-layout">
    <!-- 头部导航区 -->
    <header class="emp-header">
      <div class="emp-greeting">
        <h1 class="greet-text">Hi! {{ displayName }} 👋✨</h1>
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
        <span v-if="pendingBanners.length > 0" class="task-count">共 {{ pendingBanners.length }} 项</span>
      </h2>
      <div class="banner-scroll-wrapper" v-if="pendingBanners.length > 0">
        <div class="banner-list">
          <div class="banner-card" v-for="task in pendingBanners" :key="task.id" @click="scrollToTask(task.id)">
            <div class="banner-content">
              <div class="b-info" style="display: flex; flex-direction: column; gap: 6px;">
                <h3 class="b-title" style="margin: 0;">{{ task.title }}</h3>
                <div class="b-deadline" style="margin: 0;">
                  <!-- 动态倒计时 -->
                  <div style="display: flex; align-items: center; gap: 4px; color: #ef4444; font-weight: bold; font-size: 13px;">
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
      <h2 class="section-title">消息中心 📬</h2>
      <div class="waterfall-list">
        
        <transition-group name="fade-list">
          <div 
            class="waterfall-card" 
            :id="'msg-card-' + msg.id"
            v-for="msg in visibleMessages" 
            :key="msg.id"
            :class="[msg.type === 'warning' ? 'is-warning' : 'is-task']"
            @click="handleViewTask(msg)"
          >
            <!-- 卡片头部标签和关闭按钮 -->
            <div class="card-header">
              <span class="card-tag" :class="msg.type">
                {{ msg.type === 'warning' ? '预警通知' : '学习任务' }}
              </span>
              <!-- 仅预警信息允许被关闭 (叉掉) -->
              <n-button 
                v-if="msg.type === 'warning'" 
                quaternary 
                circle 
                size="small" 
                class="close-btn"
                @click.stop="closeMessage(msg.id)"
              >
                <template #icon>
                  <n-icon><CloseOutlined /></n-icon>
                </template>
              </n-button>
            </div>

            <!-- 卡片主要内容 -->
            <div class="card-body">
              <h3 class="c-title">{{ msg.title }}</h3>
              <p class="c-content">{{ msg.content }}</p>
              <div class="c-time">{{ msg.time }}</div>
            </div>

            <!-- 卡片底部操作按钮 -->
            <div class="card-actions">
              <n-button class="action-btn view-btn" secondary @click.stop="handleMarkComplete(msg)">
                标记完成
              </n-button>
              <n-button class="action-btn do-btn" type="primary" @click.stop="handleGoToMiniProgram">
                去完成
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
      :style="{ width: '90%', maxWidth: '400px', borderRadius: '16px', overflow: 'hidden', padding: '0', background: '#fff' }"
    >
      <div style="display: flex; flex-direction: column; max-height: 80vh;">
        <!-- 固定头部 -->
        <div style="padding: 16px 20px; border-bottom: 1px solid #f3f4f6; font-size: 18px; font-weight: 600; flex-shrink: 0; display: flex; justify-content: space-between; align-items: center;">
          <span>任务详情</span>
          <n-icon size="20" color="#9ca3af" style="cursor: pointer;" @click="showTaskModal = false"><CloseOutlined /></n-icon>
        </div>

        <!-- 滚动内容区 -->
        <div v-if="currentTaskDetail" class="td-container custom-scroll" style="padding: 20px; overflow-y: auto; flex: 1;">
          <n-descriptions label-placement="top" :column="2" bordered :label-style="{ color: '#6b7280', fontSize: '13px' }" :content-style="{ fontSize: '14px', fontWeight: '500', color: '#1f2937' }">
            <n-descriptions-item label="任务名称" :span="2">
              {{ currentTaskDetail.title }}
            </n-descriptions-item>
            <n-descriptions-item label="截止时间" :span="2">
              {{ formatDetailTime(currentTaskDetail.ddlAt) }}
            </n-descriptions-item>
            <n-descriptions-item label="学习平台" :span="1">
              <n-space size="small">
                <n-tag type="info" size="small" :bordered="false" v-if="currentTaskDetail.hasMypal">MyPal</n-tag>
                <n-tag type="info" size="small" :bordered="false" v-if="currentTaskDetail.hasSmartSell">Sales Coach</n-tag>
                <n-tag type="info" size="small" :bordered="false" v-if="currentTaskDetail.hasAiDemo">AI Coach</n-tag>
                <n-tag type="info" size="small" :bordered="false" v-if="currentTaskDetail.hasLiveBroadcast">直播培训</n-tag>
              </n-space>
            </n-descriptions-item>
            <n-descriptions-item label="达标分数" :span="1">
              100 分
            </n-descriptions-item>
          </n-descriptions>
          
          <div style="margin-top: 16px;">
            <div style="font-size: 13px; color: #6b7280; margin-bottom: 8px; padding-left: 4px;">任务详情</div>
            <div style="white-space: pre-wrap; line-height: 1.6; background: #f9fafb; padding: 12px; border-radius: 8px; border: 1px solid #f3f4f6; font-size: 14px; color: #4b5563;">
              {{ currentTaskDetail.description || '总部未提供详细描述' }}
            </div>
          </div>
        </div>

        <!-- 固定底部按钮 -->
        <div v-if="currentTaskDetail" style="padding: 16px 20px; border-top: 1px solid #f3f4f6; flex-shrink: 0; background: #fff;">
          <n-button type="primary" block size="large" class="td-btn" style="box-shadow: 0 4px 12px rgba(37, 99, 235, 0.2);" @click="handleGoToMiniProgram">
            进入学习平台去完成
          </n-button>
        </div>
      </div>
    </n-modal>

    <!-- 自动弹出的预警提醒灯箱 -->
    <n-modal
      v-model:show="showWarningModal"
      class="warning-detail-modal"
      :style="{ width: '90%', maxWidth: '380px', borderRadius: '24px', background: '#ffffff', overflow: 'hidden' }"
      :mask-closable="true"
      size="huge"
    >
      <div v-if="currentWarnings.length > 0" class="wd-container" style="position: relative;">
        <!-- 顶部设计：柔和的红色插画风渐变 -->
        <div style="background: linear-gradient(145deg, #fef2f2 0%, #fee2e2 100%); padding: 32px 24px 40px; text-align: center; position: relative;">
          <div style="width: 64px; height: 64px; background: #ef4444; border-radius: 20px; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; box-shadow: 0 8px 16px rgba(239, 68, 68, 0.25); transform: rotate(-5deg);">
            <n-icon size="36" color="#ffffff" style="transform: rotate(5deg);"><WarningOutlined /></n-icon>
          </div>
          <h2 style="margin: 0; font-size: 22px; font-weight: 800; color: #b91c1c;">
            {{ currentWarnings.length > 1 ? `您有 ${currentWarnings.length} 条预警通知` : currentWarnings[0].title }}
          </h2>
          <p style="margin: 8px 0 0; font-size: 14px; color: #ef4444; font-weight: 500;">
            请尽快查阅并处理以下学习任务
          </p>
        </div>

        <!-- 悬浮的白色卡片区域：营造层级感 -->
        <div style="padding: 0 24px 28px; position: relative; top: -20px;">
          <div style="max-height: 260px; overflow-y: auto; padding-right: 4px; margin-bottom: 24px;" class="custom-scroll">
            <div 
              v-for="(w, idx) in currentWarnings" 
              :key="w.id" 
              style="background: #ffffff; border: 1px solid #f3f4f6; border-radius: 16px; padding: 18px; margin-bottom: 12px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04); position: relative; overflow: hidden;"
            >
              <!-- 顶部的一丝丝红条装饰 -->
              <div style="position: absolute; top: 0; left: 0; right: 0; height: 3px; background: #ef4444;"></div>
              
              <h3 style="margin: 0 0 8px; font-size: 16px; font-weight: 700; color: #1f2937; display: flex; align-items: center; gap: 8px;">
                <n-tag type="error" size="small" :bordered="false" style="font-weight: 800; font-size: 12px; height: 20px;">{{ String(idx + 1).padStart(2, '0') }}</n-tag>
                {{ currentWarnings.length > 1 ? w.title : '预警详情' }}
              </h3>
              <p style="font-size: 14px; line-height: 1.6; color: #6b7280; margin: 0; text-align: justify;">
                {{ w.content }}
              </p>
              <div style="margin-top: 12px; font-size: 12px; color: #9ca3af; display: flex; align-items: center; gap: 4px;">
                <n-icon size="14"><ClockCircleOutlined /></n-icon>
                {{ w.time }}
              </div>
            </div>
          </div>

          <!-- 底部操作按钮 -->
          <n-button type="primary" block size="large" round style="height: 48px; font-size: 16px; font-weight: 600; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.2);" @click="handleGoToMiniProgram">
            进入学习平台处理
          </n-button>
          <n-button quaternary block size="large" round style="margin-top: 8px; font-size: 15px; color: #9ca3af; font-weight: 500;" @click="showWarningModal = false">
            稍后再说
          </n-button>
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
import { LogoutOutlined, CloseOutlined, ClockCircleOutlined, WarningOutlined } from '@vicons/antd';
import { getTaskList, getTaskDetail } from '@/api/task';

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

// --- 数据响应式结构 ---
const pendingBanners = ref<any[]>([]);
const waterfallMessages = ref<any[]>([]);
const showTaskModal = ref(false);
const currentTaskDetail = ref<any>(null);

const showWarningModal = ref(false);
const currentWarnings = ref<any[]>([]);

// 过滤掉被叉掉的预警信息
const visibleMessages = computed(() => waterfallMessages.value);

// 关闭消息的方法 (只针对预警)
const closeMessage = (id: string) => {
  const index = waterfallMessages.value.findIndex(m => m.id === id);
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

// 获取真实后端任务列表
const loadEmployeeTasks = async () => {
  try {
    const res = await getTaskList().send();
    const realTasks = res || [];
    
    // 映射后端 Task 对象到前端需要的格式
    const formattedTasks = realTasks.map((t: any) => {
      const ddl = new Date(t.ddlAt);
      const formattedDdl = `${ddl.getMonth() + 1}月${ddl.getDate()}日 ${String(ddl.getHours()).padStart(2, '0')}:${String(ddl.getMinutes()).padStart(2, '0')}`;
      
      return {
        id: t.id,
        type: 'task', // 标记为任务
        title: t.title,
        desc: t.description || '总部未提供详细描述',
        content: `总部下发了一项学习任务，要求在 ${formattedDdl} 前完成。`,
        deadline: formattedDdl,
        ddlTimestamp: ddl.getTime(), // 增加时间戳用于排序
        time: t.createdAt ? t.createdAt.substring(0, 10) : '刚刚'
      };
    });

    // 按照截止时间从早到晚进行排序（越紧急越靠前）
    formattedTasks.sort((a, b) => a.ddlTimestamp - b.ddlTimestamp);

    if (formattedTasks.length > 0) {
      // 展示所有待完成任务在横向 Banner
      pendingBanners.value = formattedTasks;
      
      // 瀑布流展示：全部任务也进入瀑布流
      const tasksForWaterfall = formattedTasks.map(t => ({
        ...t,
        title: `【待完成】${t.title}`
      }));
      
      const mockWarnings = [
        { 
          id: 'mock_w1', 
          type: 'warning', 
          title: '⚠️ 进度危机预警', 
          content: '距离部分任务截止不足 24 小时，您的当前进度仍为 0%，请尽快安排时间学习。',
          time: '1小时前'
        },
        { 
          id: 'mock_w2', 
          type: 'warning', 
          title: '⚠️ MyPal 测试不达标', 
          content: '您的上一期新员工培训 MyPal 模拟通关测试未能达到 80 分，系统已自动重置测试次数。',
          time: '3小时前'
        },
        { 
          id: 'mock_w3', 
          type: 'warning', 
          title: '⚠️ 门店均分落后', 
          content: '当前您所在门店的平均通过率低于全国 90% 的门店，总部已向您发出关注提醒！',
          time: '12小时前'
        }
      ];
      
      waterfallMessages.value = [...mockWarnings, ...tasksForWaterfall];
      
      // 如果有预警通知，自动弹出灯箱进行提示
      if (mockWarnings.length > 0) {
        currentWarnings.value = mockWarnings;
        showWarningModal.value = true;
      }
    } else {
      pendingBanners.value = [];
      waterfallMessages.value = [];
    }

  } catch (err: any) {
    console.error(err);
    message.error('获取任务列表失败，请稍后再试');
  }
};

onMounted(() => {
  timerInterval = setInterval(() => {
    currentTime.value = Date.now();
  }, 1000);
  loadEmployeeTasks();
});

onUnmounted(() => {
  if (timerInterval) {
    clearInterval(timerInterval);
  }
});

// --- 任务操作 ---

// 1. 跳转到微信小程序
const handleGoToMiniProgram = () => {
  const a = document.createElement('a');
  a.href = 'weixin://dl/business/?t=eS0Bza6c7I8No5g';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  
  setTimeout(() => {
    document.body.removeChild(a);
  }, 100);

  message.loading('正在尝试唤起微信小程序...', { duration: 1500 });
};

// 2. 查阅真实任务详情，调用后端 GET /tasks/:id
const handleViewTask = async (msg: any) => {
  if (msg.type === 'warning') {
    currentWarnings.value = [msg]; // 如果单独点击某个预警卡片，则只展示这一条
    showWarningModal.value = true;
    return;
  }
  
  const msgReactive = message.loading('加载任务详情中...', { duration: 0 });
  try {
    const res = await getTaskDetail(msg.id).send();
    currentTaskDetail.value = res;
    showTaskModal.value = true;
  } catch (err: any) {
    message.error(err.message || '获取任务详情失败');
  } finally {
    msgReactive.destroy();
  }
};

const formatDetailTime = (isoStr: string) => {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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

const handleMarkComplete = (msg: any) => {
  if (msg.type === 'warning') {
    message.warning('预警通知无法直接标记完成，请前去完成对应的任务！');
    return;
  }
  dialog.warning({
    title: '请您确认是否完成',
    content: '标记后即表示您已完成该学习任务，不可撤销。',
    positiveText: '确认完成',
    negativeText: '取消',
    onPositiveClick: () => {
      // 模拟前端完成逻辑：从可见消息流中移除
      const idx = visibleMessages.value.findIndex(m => m.id === msg.id);
      if (idx !== -1) {
        visibleMessages.value.splice(idx, 1);
      }
      
      // 同步移除顶部的 Banner 任务
      const bannerIdx = pendingBanners.value.findIndex(b => b.id === msg.id);
      if (bannerIdx !== -1) {
        pendingBanners.value.splice(bannerIdx, 1);
      }

      message.success('已标记完成！积分 +10 🎉');
    }
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
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
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
      margin: 0 0 8px;
      font-size: 26px;
      font-weight: 800;
      color: #111827;
      letter-spacing: -0.5px;
      line-height: 1.2;
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
        font-family: ui-rounded, "SF Pro Rounded", -apple-system, BlinkMacSystemFont, sans-serif;
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

  &:hover, &:active {
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

    /* 针对不同类型的轻微强调 */
    &.is-warning {
      border-left: 4px solid #ef4444; /* 红色左边框强调预警 */
      background: #fffcfc;
    }

    &.is-task {
      border-left: 4px solid #3b82f6; /* 蓝色左边框强调任务 */
    }

    /* 定位时的高亮闪烁动画 */
    &.highlight-pulse {
      animation: cardPulse 1.5s ease-out;
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;

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
          color: #dc2626;
          background: #fef2f2;
        }
      }

      .close-btn {
        margin-right: -8px;
        color: #9ca3af;
        &:active { color: #4b5563; }
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

.td-btn {
  margin-top: 8px;
  border-radius: 8px;
  font-weight: 600;
}

/* 高亮闪烁动画 */
@keyframes cardPulse {
  0% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.4); border-color: #93c5fd; background-color: #eff6ff; }
  50% { box-shadow: 0 0 0 8px rgba(59, 130, 246, 0); border-color: #3b82f6; background-color: #eff6ff; }
  100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); border-color: #f3f4f6; background-color: #ffffff; }
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
</style>
