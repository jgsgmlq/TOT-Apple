<template>
  <div class="executive-container">
    <n-layout has-sider style="height: 100vh;">
      <n-layout-sider
        v-show="!isMobile"
        bordered
        collapse-mode="width"
        :collapsed-width="64"
        :width="260"
        show-trigger
        class="executive-sider"
      >
        <div class="sider-logo">
          <img :src="websiteConfig.logo" alt="logo" class="logo-img" />
          <span class="logo-text">TOT</span>
        </div>

        <div class="sider-header">
          <n-button block type="primary" class="new-chat-btn" @click="handleNewChat">
            <template #icon>
              <n-icon><PlusOutlined /></n-icon>
            </template>
            新对话
          </n-button>
        </div>
        
        <div class="sider-content custom-scroll">
          <div class="history-title">历史记录</div>
          <div class="chat-list">
            <div 
              class="chat-item" 
              v-for="item in historyList" 
              :key="item.id"
              :class="{ active: currentChatId === item.id }"
              @click="selectChat(item)"
            >
              <n-icon size="16" class="chat-icon"><MessageOutlined /></n-icon>
              <span class="chat-title">{{ item.title }}</span>
            </div>
          </div>
        </div>
      </n-layout-sider>

      <!-- 移动端侧边栏抽屉 -->
      <n-drawer v-model:show="showMobileSidebar" placement="left" :width="280">
        <div class="executive-sider mobile-sider-inner">
          <div class="sider-logo">
            <img :src="websiteConfig.logo" alt="logo" class="logo-img" />
            <span class="logo-text">Executive Chat</span>
          </div>
          <div class="sider-header">
            <n-button block type="primary" class="new-chat-btn" @click="handleNewChat">
              <template #icon>
                <n-icon><PlusOutlined /></n-icon>
              </template>
              新对话
            </n-button>
          </div>
          <div class="sider-content custom-scroll">
            <div class="history-title">历史记录</div>
            <div class="chat-list">
              <div 
                class="chat-item" 
                v-for="item in historyList" 
                :key="item.id"
                :class="{ active: currentChatId === item.id }"
                @click="selectChat(item)"
              >
                <n-icon size="16" class="chat-icon"><MessageOutlined /></n-icon>
                <span class="chat-title">{{ item.title }}</span>
              </div>
            </div>
          </div>
        </div>
      </n-drawer>


      <n-layout-content content-style="display: flex; flex-direction: column; height: 100%; background-color: #f9fafb;">
        <div class="chat-header">
          <div class="header-left">
            <n-icon v-if="isMobile" size="24" class="menu-icon" @click="showMobileSidebar = true"><MenuOutlined /></n-icon>
            <h2 class="header-title">Executive Chat</h2>
          </div>
          <div class="header-actions">
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
        </div>

        <div class="chat-body custom-scroll" ref="chatBodyRef">
          <div v-if="messages.length === 0" class="empty-chat">
            <div class="empty-icon-wrap">
              <n-icon size="48" color="#3b82f6"><RobotOutlined /></n-icon>
            </div>
            <h3>你好，主管</h3>
            <p>我是您的专属 AI 助理，随时为您提供数据洞察与业务支持。</p>
          </div>
          
          <div 
            v-for="(msg, index) in messages" 
            :key="index" 
            class="message-row"
            :class="msg.role === 'user' ? 'is-user' : 'is-ai'"
          >
            <div class="message-avatar">
              <template v-if="msg.role === 'user'">
                <div class="avatar-circle chat-avatar" style="cursor: default; transform: none; box-shadow: 0 2px 8px rgba(37,99,235,0.1);">
                  <span class="avatar-text">{{ avatarText }}</span>
                </div>
              </template>
              <template v-else>
                <n-avatar round size="medium" :src="executiveAIIcon" />
              </template>
            </div>
            <div class="message-content">
              {{ msg.content }}
            </div>
          </div>
        </div>

        <div class="chat-footer">
          <div class="input-wrapper">
            <n-input
              v-model:value="inputValue"
              type="textarea"
              placeholder="输入消息，Shift + Enter 换行，Enter 发送..."
              :autosize="{ minRows: 1, maxRows: 5 }"
              @keydown.enter.prevent="handleSend"
            />
            <n-button type="primary" :disabled="!inputValue.trim()" @click="handleSend" class="send-btn">
              发送
            </n-button>
          </div>
          <div class="footer-tip">AI 生成的内容仅供参考，请结合业务实际情况判断。</div>
        </div>
      </n-layout-content>
    </n-layout>
  </div>
</template>

<script lang="ts" setup>
import { ref, nextTick, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useMessage, useDialog } from 'naive-ui';
import { debounce } from 'lodash-es';
import { PlusOutlined, MessageOutlined, RobotOutlined, LogoutOutlined, MenuOutlined } from '@vicons/antd';
import executiveAIIcon from '@/assets/images/ExecutiveAI.png';
import { websiteConfig } from '@/config/website.config';
import { useUserStore } from '@/store/modules/user';
import { PageEnum } from '@/enums/pageEnum';

interface ChatHistory {
  id: string;
  title: string;
}

interface ChatMessage {
  role: 'user' | 'ai';
  content: string;
}

const userStore = useUserStore();
const router = useRouter();
const message = useMessage();
const dialog = useDialog();

const displayName = computed(() => {
  const u = userStore.getUserInfo;
  return u?.username || u?.email || '主管';
});

const avatarText = computed(() => {
  const name = displayName.value;
  return name ? Array.from(name)[0].toUpperCase() : '主';
});

const onLogout = () => {
  dialog.warning({
    title: '退出登录',
    content: '确定退出当前账号？',
    positiveText: '确定',
    negativeText: '取消',
    onPositiveClick: () => {
      userStore.logout().then(() => {
        message.success('已退出');
        router.replace({ path: '/executive/login' });
      });
    },
  });
};

const historyList = ref<ChatHistory[]>([
  { id: '1', title: '分析昨日门店数据' },
  { id: '2', title: '华东区培训达标率报告' },
  { id: '3', title: '关于 MyPal 的优化建议' }
]);

const currentChatId = ref<string>('1');

const messages = ref<ChatMessage[]>([
  { role: 'user', content: '分析昨日门店数据' },
  { role: 'ai', content: '您好！昨天的整体出勤率为98%，全国门店销售达成率为85%。其中华东区表现最为优异，华南区 Lifestyle 门店在新品陈列任务中进度稍显落后。' }
]);

const inputValue = ref('');
const chatBodyRef = ref<HTMLElement | null>(null);


const isMobile = ref(false);
const showMobileSidebar = ref(false);


// 抑制常见的 ResizeObserver 报错 (UI 渲染重流警告，通常无害)
const _ResizeObserver = window.ResizeObserver;
window.ResizeObserver = class ResizeObserver extends _ResizeObserver {
  constructor(callback) {
    super(debounce(callback, 20));
  }
};

const checkMobile = debounce(() => {
  isMobile.value = window.innerWidth <= 768;
}, 100);

onMounted(() => {
  checkMobile();
  window.addEventListener('resize', checkMobile);
});

onUnmounted(() => {
  window.removeEventListener('resize', checkMobile);
});

const handleNewChat = () => {
  currentChatId.value = Date.now().toString();
  messages.value = [];
  showMobileSidebar.value = false;
};

const selectChat = (chat: ChatHistory) => {
  currentChatId.value = chat.id;
  messages.value = [
    { role: 'user', content: chat.title },
    { role: 'ai', content: `关于 "${chat.title}" 的详细分析和历史记录如下...` }
  ];
  showMobileSidebar.value = false;
};


const scrollToBottom = () => {
  nextTick(() => {
    if (chatBodyRef.value) {
      chatBodyRef.value.scrollTop = chatBodyRef.value.scrollHeight;
    }
  });
};

const handleSend = () => {
  if (!inputValue.value.trim()) return;
  
  messages.value.push({
    role: 'user',
    content: inputValue.value
  });
  
  const question = inputValue.value;
  inputValue.value = '';
  scrollToBottom();
  
  setTimeout(() => {
    messages.value.push({
      role: 'ai',
      content: `收到您的指令：\n\n"${question}"\n\n我是您的AI助手，正在进行数据聚合和分析处理。未来我将直接接入底层数据库并实时响应您的提问！`
    });
    scrollToBottom();
  }, 800);
};
</script>

<style lang="less" scoped>
.executive-container {
  height: 100vh;
  width: 100vw;
  background-color: #f9fafb;
  overflow: hidden;
}

.executive-sider {
  background: #ffffff;
  
  :deep(.n-layout-sider-scroll-container) {
    background: #ffffff;
  }
  
  .sider-logo {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 64px;
    gap: 12px;
    border-bottom: 1px solid #f3f4f6;
    
    .logo-img {
      width: 32px;
      height: 32px;
      object-fit: contain;
    }
    
    .logo-text {
      font-size: 18px;
      font-weight: 700;
      color: #1f2937;
      letter-spacing: 0.5px;
    }
  }

  .sider-header {
    padding: 20px 16px 12px;
  }

  .new-chat-btn {
    border-radius: 8px;
    font-weight: 600;
    height: 40px;
    box-shadow: 0 4px 10px rgba(37, 99, 235, 0.2);
  }

  .sider-content {
    padding: 8px 16px;
    height: calc(100vh - 140px);
    overflow-y: auto;
  }

  .history-title {
    font-size: 12px;
    color: #6b7280;
    margin-bottom: 12px;
    padding-left: 4px;
    font-weight: 600;
  }

  .chat-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    
    .chat-item {
      display: flex;
      align-items: center;
      padding: 10px 12px;
      border-radius: 8px;
      cursor: pointer;
      color: #4b5563;
      transition: all 0.2s ease;
      gap: 12px;
      
      &:hover {
        background: #f3f4f6;
        color: #111827;
      }
      
      &.active {
        background: #eff6ff;
        color: #1d4ed8;
        font-weight: 500;
      }
      
      .chat-title {
        font-size: 14px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    }
  }
}

.chat-header {
  height: 64px;
  padding: 0 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #ffffff;
  border-bottom: 1px solid #e5e7eb;
  
  .header-title {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: #1f2937;
  }
}

.avatar-circle {
    width: 40px;
    height: 40px;
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
      font-size: 16px;
      font-weight: 800;
      color: #2563eb;
      user-select: none;
    }
  }

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

.chat-body {
  flex: 1;
  padding: 32px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 24px;
  scroll-behavior: smooth;
  
  .empty-chat {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #6b7280;
    
    .empty-icon-wrap {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      background: #eff6ff;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 16px;
    }

    h3 {
      margin: 0 0 8px;
      font-size: 24px;
      font-weight: 600;
      color: #1f2937;
    }
    
    p {
      color: #6b7280;
      font-size: 15px;
    }
  }
  
  .message-row {
    display: flex;
    gap: 16px;
    max-width: 85%;
    
    &.is-user {
      align-self: flex-end;
      flex-direction: row-reverse;
      
      .message-content {
        background: #2563eb;
        color: #ffffff;
        border-radius: 16px 4px 16px 16px;
        box-shadow: 0 4px 12px rgba(37, 99, 235, 0.15);
      }
    }
    
    &.is-ai {
      align-self: flex-start;
      
      .message-content {
        background: #ffffff;
        color: #1f2937;
        border-radius: 4px 16px 16px 16px;
        border: 1px solid #e5e7eb;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
      }
    }
    
    .message-content {
      padding: 14px 18px;
      font-size: 15px;
      line-height: 1.6;
      word-wrap: break-word;
      white-space: pre-wrap;
    }
  }
}

.chat-footer {
  padding: 20px 32px;
  background: #ffffff;
  border-top: 1px solid #e5e7eb;
  
  .input-wrapper {
    position: relative;
    max-width: 860px;
    margin: 0 auto;
    display: flex;
    gap: 16px;
    align-items: flex-end;
    
    :deep(.n-input) {
      border-radius: 12px;
      padding: 6px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.02);
      
      &:hover, &.n-input--focus {
        box-shadow: 0 2px 12px rgba(37, 99, 235, 0.1);
      }
    }
    
    .send-btn {
      border-radius: 12px;
      height: 44px;
      padding: 0 24px;
      font-weight: 600;
      box-shadow: 0 4px 10px rgba(37, 99, 235, 0.2);
    }
  }
  
  .footer-tip {
    text-align: center;
    font-size: 13px;
    color: #9ca3af;
    margin-top: 16px;
  }
}

.custom-scroll {
  &::-webkit-scrollbar {
    width: 6px;
  }
  &::-webkit-scrollbar-thumb {
    background-color: rgba(156, 163, 175, 0.4);
    border-radius: 3px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.menu-icon {
  cursor: pointer;
  color: #4b5563;
  display: flex;
  align-items: center;
}

.mobile-sider-inner {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #ffffff;
}

/* 移动端响应式适配 */
@media (max-width: 768px) {
  .chat-header {
    padding: 0 16px;
  }
  
  .chat-body {
    padding: 20px 16px;
    gap: 20px;
    
    .message-row {
      max-width: 100%;
      gap: 10px;
      
      .message-content {
        padding: 10px 14px;
        font-size: 14px;
      }
    }
  }
  
  .chat-footer {
    padding: 12px 16px;
    
    .input-wrapper {
      gap: 10px;
      
      .send-btn {
        padding: 0 16px;
      }
    }
    
    .footer-tip {
      font-size: 11px;
      margin-top: 8px;
    }
  }
  
  .avatar-circle {
    width: 36px;
    height: 36px;
    
    .avatar-text {
      font-size: 14px;
    }
  }
}


.chat-avatar {
  width: 34px !important;
  height: 34px !important;
  
  .avatar-text {
    font-size: 14px !important;
  }
  
  &:hover, &:active {
    box-shadow: 0 2px 8px rgba(37,99,235,0.1) !important;
  }
}




</style>