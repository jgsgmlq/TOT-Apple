<template>
  <div class="executive-container">
    <n-layout has-sider style="height: 100vh;">
      <n-layout-sider
        v-show="!isMobile"
        :collapsed="desktopSidebarCollapsed"
        collapse-mode="width"
        :collapsed-width="64"
        :width="260"
        bordered
        show-trigger="bar"
        :native-scrollbar="false"
        class="executive-sider"
        :class="{ 'executive-sider--narrow': desktopSidebarCollapsed }"
        @collapse="desktopSidebarCollapsed = true"
        @expand="desktopSidebarCollapsed = false"
      >
        <div class="sider-logo">
          <img :src="websiteConfig.logo" alt="logo" class="logo-img" />
          <span v-show="!desktopSidebarCollapsed" class="logo-text">TOT</span>
        </div>

        <div class="sider-header">
          <n-button
            v-if="!desktopSidebarCollapsed"
            block
            type="primary"
            class="new-chat-btn"
            @click="handleNewChat"
          >
            <template #icon>
              <n-icon><PlusOutlined /></n-icon>
            </template>
            新对话
          </n-button>
          <n-button
            v-else
            type="primary"
            circle
            class="new-chat-btn-icon"
            @click="handleNewChat"
          >
            <template #icon>
              <n-icon><PlusOutlined /></n-icon>
            </template>
          </n-button>
        </div>

        <div v-show="!desktopSidebarCollapsed" class="sider-content custom-scroll">
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
            <div 
              class="executive-header-trigger"
              @click="toggleSidebar"
            >
              <n-icon size="18" v-if="isMobile" class="menu-icon">
                <MenuOutlined />
              </n-icon>
              <template v-else>
                <n-icon size="18" v-if="desktopSidebarCollapsed" class="menu-icon">
                  <MenuUnfoldOutlined />
                </n-icon>
                <n-icon size="18" v-else class="menu-icon">
                  <MenuFoldOutlined />
                </n-icon>
              </template>
            </div>
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
            <h3>Hi! {{ displayName }} 👋✨</h3>
            <p>作为你的智能助手，我可以为你答疑解惑～</p>
            
            <div class="preset-questions">
              <div class="preset-bubble" @click="fillInput('Q1新品培训完成率？')">Q1新品培训完成率？</div>
              <div class="preset-bubble" @click="fillInput('现在有什么问题需要关注？')">现在有什么问题需要关注？</div>
              <div class="preset-bubble" @click="fillInput('最差的5家门店是哪些？')">最差的5家门店是哪些？</div>
            </div>
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
                <div class="ai-bot-avatar">
                  <n-icon size="20" color="#2563eb"><RobotOutlined /></n-icon>
                </div>
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
import {
  PlusOutlined,
  MessageOutlined,
  LogoutOutlined,
  MenuOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  RobotOutlined,
} from '@vicons/antd';
import { websiteConfig } from '@/config/website.config';
import { useUserStore } from '@/store/modules/user';

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

const currentChatId = ref<string>('');

const messages = ref<ChatMessage[]>([]);

const fillInput = (text: string) => {
  inputValue.value = text;
};

const inputValue = ref('');
const chatBodyRef = ref<HTMLElement | null>(null);


const isMobile = ref(false);
const showMobileSidebar = ref(false);
const desktopSidebarCollapsed = ref(false);

const toggleSidebar = () => {
  if (isMobile.value) {
    showMobileSidebar.value = true;
  } else {
    desktopSidebarCollapsed.value = !desktopSidebarCollapsed.value;
  }
};


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
  background-color: #ffffff;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
}

.executive-sider {
  background: #f5f5f7;
  border-right: 1px solid rgba(0,0,0,0.05);
  
  :deep(.n-layout-sider-scroll-container) {
    background: #f5f5f7;
  }
  
  .sider-logo {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 64px;
    gap: 12px;
    border-bottom: 1px solid transparent;
    
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

  .new-chat-btn-icon {
    box-shadow: 0 4px 10px rgba(37, 99, 235, 0.2);
  }

  &.executive-sider--narrow {
    .sider-logo {
      gap: 0;
      padding: 0 8px;
    }

    .sider-header {
      padding: 16px 8px 12px;
      display: flex;
      justify-content: center;
    }
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
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: saturate(180%) blur(20px);
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  position: sticky;
  top: 0;
  z-index: 10;
  
  .header-title {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
    color: #1d1d1f;
    letter-spacing: -0.374px;
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
    color: #1d1d1f;
    text-align: center;

    h3 {
      margin: 0 0 12px;
      font-size: 28px;
      font-weight: 600;
      color: #1d1d1f;
      letter-spacing: -0.28px;
      line-height: 1.1;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Helvetica, Arial, sans-serif;
    }

    p {
      color: rgba(0, 0, 0, 0.48);
      font-size: 15px;
      line-height: 1.47;
      letter-spacing: -0.374px;
      margin: 0 0 40px;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
    }

    .preset-questions {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 12px;
      width: fit-content;

      .preset-bubble {
        padding: 10px 20px;
        background: #f5f5f7;
        border: 1px solid transparent;
        border-radius: 980px;
        font-size: 14px;
        font-weight: 400;
        color: #1d1d1f;
        cursor: pointer;
        transition: all 0.2s ease;
        letter-spacing: -0.374px;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;

        &:hover {
          background: #ededf2;
          color: #0071e3;
        }

        &:active {
          background: #e5e5ea;
        }
      }
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
        background: #0071e3;
        color: #ffffff;
        border-radius: 18px 4px 18px 18px;
      }
    }

    &.is-ai {
      align-self: flex-start;

      .message-content {
        background: #f5f5f7;
        color: #1d1d1f;
        border-radius: 4px 18px 18px 18px;
        border: none;
      }
    }

    .message-content {
      padding: 12px 16px;
      font-size: 15px;
      line-height: 1.47;
      letter-spacing: -0.374px;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
      word-wrap: break-word;
      white-space: pre-wrap;
    }
  }
}

.chat-footer {
  padding: 20px 32px;
  background: #ffffff;
  border-top: 1px solid rgba(0, 0, 0, 0.05);
  
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
      background: #fafafc;
      border: 1px solid rgba(0, 0, 0, 0.08);
      font-size: 15px;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
      box-shadow: none;
      
      &:hover, &.n-input--focus {
        background: #ffffff;
        border-color: #0071e3;
        box-shadow: 0 0 0 2px rgba(0, 113, 227, 0.2);
      }
    }
    
    .send-btn {
      border-radius: 980px;
      height: 44px;
      padding: 0 24px;
      font-weight: 600;
      background-color: #0071e3;
      color: #ffffff;
      border: none;
      font-size: 15px;
      letter-spacing: -0.374px;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
      transition: background-color 0.2s ease;
      
      &:hover {
        background-color: #0077ed;
      }
      
      &:active {
        background-color: #ededf2;
        color: #0071e3;
      }
      
      &.n-button--disabled {
        background-color: #fafafc;
        color: rgba(0, 0, 0, 0.48);
        border: 1px solid rgba(0, 0, 0, 0.04);
      }
    }
  }
  
  .footer-tip {
    text-align: center;
    font-size: 12px;
    color: rgba(0, 0, 0, 0.48);
    margin-top: 16px;
    letter-spacing: -0.12px;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
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

.executive-header-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 12px;
  margin-left: -12px;
  height: 64px;
  cursor: pointer;
  transition: background 0.2s ease-in-out;
  border-radius: 4px;

  &:hover {
    background: #f8f8f9;
  }

  .menu-icon {
    color: #515a6e;
  }
}

.menu-icon {
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

/* AI 机器人图标头像 */
.ai-bot-avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
  border: 1px solid rgba(37, 99, 235, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}



</style>