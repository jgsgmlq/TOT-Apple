<template>
  <div class="executive-container">
    <n-layout has-sider style="height: 100vh">
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
          <n-button v-else type="primary" circle class="new-chat-btn-icon" @click="handleNewChat">
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
              <div class="chat-item-delete" @click.stop>
                <n-popconfirm
                  placement="left"
                  positive-text="删除"
                  negative-text="取消"
                  @positive-click="removeChatFromSidebar(item)"
                >
                  <template #trigger>
                    <n-button
                      quaternary
                      circle
                      size="tiny"
                      type="error"
                      :focusable="false"
                      aria-label="删除对话"
                    >
                      <template #icon>
                        <n-icon size="14"><DeleteOutlined /></n-icon>
                      </template>
                    </n-button>
                  </template>
                  确定删除该对话？服务端将删除该会话及消息记录，并从侧栏移除。若删除的是当前对话，将进入新的空白会话。
                </n-popconfirm>
              </div>
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
                <div class="chat-item-delete chat-item-delete--mobile" @click.stop>
                  <n-popconfirm
                    placement="right"
                    positive-text="删除"
                    negative-text="取消"
                    @positive-click="removeChatFromSidebar(item)"
                  >
                    <template #trigger>
                      <n-button
                        quaternary
                        circle
                        size="tiny"
                        type="error"
                        :focusable="false"
                        aria-label="删除对话"
                      >
                        <template #icon>
                          <n-icon size="14"><DeleteOutlined /></n-icon>
                        </template>
                      </n-button>
                    </template>
                    确定删除该对话？服务端将删除该会话及消息记录，并从侧栏移除。若删除的是当前对话，将进入新的空白会话。
                  </n-popconfirm>
                </div>
              </div>
            </div>
          </div>
        </div>
      </n-drawer>

      <n-layout-content
        content-style="display: flex; flex-direction: column; height: 100%; background-color: #f9fafb;"
      >
        <div class="chat-header">
          <div class="header-left">
            <div class="executive-header-trigger" @click="toggleSidebar">
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
          <n-spin :show="isLoadingHistory" style="min-height: 120px">
            <div v-if="messages.length === 0 && !isLoadingHistory" class="empty-chat">
              <h3>Hi! {{ displayName }} 👋✨</h3>
              <p>作为你的智能助手，我可以为你答疑解惑～</p>

              <div class="preset-questions">
                <div
                  v-for="(q, qi) in presetQuestions"
                  :key="qi"
                  class="preset-bubble"
                  @click="fillInput(q)"
                >
                  {{ q }}
                </div>
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
                  <div
                    class="avatar-circle chat-avatar"
                    style="
                      cursor: default;
                      transform: none;
                      box-shadow: 0 2px 8px rgba(37, 99, 235, 0.1);
                    "
                  >
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
                <template v-if="msg.role === 'user'">{{ msg.content }}</template>
                <template v-else>
                  <ExecChatAiBubbleContent
                    :thinking="msg.thinking"
                    :partial-reply="msg.partialReply"
                    :reply-content="msg.replyContent"
                    :json-stream="msg.jsonStream"
                    :content="msg.content"
                  />
                </template>

                <!-- AI Feedback Actions -->
                <div v-if="msg.role === 'ai' && msg.id" class="message-actions">
                  <n-space size="small" align="center">
                    <n-button
                      v-if="index === messages.length - 1"
                      quaternary
                      size="small"
                      @click="handleRegenerate(msg, index)"
                      :loading="msg.isRegenerating"
                      :disabled="isSending"
                      class="action-btn"
                    >
                      <template #icon>
                        <SyncOutlined />
                      </template>
                      重新生成
                    </n-button>

                    <n-button
                      quaternary
                      size="small"
                      @click="handleFeedback(msg, 'like')"
                      :loading="msg.isFeedbackLoading"
                      class="action-btn"
                    >
                      <template #icon>
                        <LikeFilled v-if="msg.userFeedback === 'like'" style="color: #18a058" />
                        <LikeOutlined v-else />
                      </template>
                    </n-button>

                    <n-button
                      quaternary
                      size="small"
                      @click="handleFeedback(msg, 'dislike')"
                      :loading="msg.isFeedbackLoading"
                      class="action-btn"
                    >
                      <template #icon>
                        <DislikeFilled
                          v-if="msg.userFeedback === 'dislike'"
                          style="color: #d03050"
                        />
                        <DislikeOutlined v-else />
                      </template>
                    </n-button>
                  </n-space>
                </div>
              </div>
            </div>
          </n-spin>
        </div>

        <div class="chat-footer">
          <div class="input-wrapper">
            <n-input
              v-model:value="inputValue"
              type="textarea"
              placeholder="输入消息，Shift + Enter 换行，Enter 发送..."
              :autosize="{ minRows: 1, maxRows: 5 }"
              @keydown.enter="onInputEnter"
            />
            <n-button
              type="primary"
              :disabled="!inputValue.trim() || isSending || isLoadingHistory"
              :loading="isSending"
              @click="handleSend"
              class="send-btn"
            >
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
    DeleteOutlined,
    LogoutOutlined,
    MenuOutlined,
    MenuFoldOutlined,
    MenuUnfoldOutlined,
    RobotOutlined,
  } from '@vicons/antd';
  import { websiteConfig } from '@/config/website.config';
  import { useUserStore } from '@/store/modules/user';
  import {
    createChatSession,
    streamExecutiveChatMessage,
    getChatHistory,
    deleteChatSession,
    formatReplyContentText,
    submitChatFeedback,
    regenerateChatMessage,
    type ChatHistoryItem,
    type SendMessageResult,
    type ReplyContent,
  } from '@/api/chat';
  import ExecChatAiBubbleContent from '@/components/chat/ExecChatAiBubbleContent.vue';
  import { runExecStyleSseChat, finalizeExecStyleMessage } from '@/utils/execStreamReply';
  import {
    LikeOutlined,
    LikeFilled,
    DislikeOutlined,
    DislikeFilled,
    SyncOutlined,
  } from '@vicons/antd';

  interface ChatHistory {
    id: string;
    title: string;
  }

  interface ChatMessage {
    id?: string;
    role: 'user' | 'ai';
    content: string;
    /** 思考过程：reasoning 流 + ` ```json` 前说明，不在正文重复 */
    thinking?: string;
    /** 流式阶段 JSON 尚未解析成功时的原始片段 */
    jsonStream?: string;
    /** 流式过程中已成功 parse 的结构化预览 */
    partialReply?: ReplyContent | null;
    /** 服务端落库后的最终结构化回答 */
    replyContent?: ReplyContent | null;
    userFeedback?: 'like' | 'dislike' | null;
    isRegenerating?: boolean;
    isFeedbackLoading?: boolean;
  }

  const FALLBACK_PRESETS = [
    'Q1新品培训完成率？',
    '现在有什么问题需要关注？',
    '最差的5家门店是哪些？',
  ];

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

  const historyList = ref<ChatHistory[]>([]);
  const presetQuestions = ref<string[]>([...FALLBACK_PRESETS]);

  const currentChatId = ref<string>('');
  const sessionId = ref<string>('');
  const isSending = ref(false);
  const isLoadingHistory = ref(false);

  const messages = ref<ChatMessage[]>([]);

  function sidebarStorageKey(): string {
    const u = userStore.getUserInfo?.username || 'guest';
    return `tot_executive_chat_sidebar_${u}`;
  }

  function presetsStorageKey(): string {
    const u = userStore.getUserInfo?.username || 'guest';
    return `tot_executive_chat_presets_${u}`;
  }

  function loadStoredPresets(): string[] | undefined {
    try {
      const raw = localStorage.getItem(presetsStorageKey());
      if (!raw) return undefined;
      const arr = JSON.parse(raw) as unknown;
      if (Array.isArray(arr) && arr.length > 0 && arr.every((x) => typeof x === 'string')) {
        return arr as string[];
      }
    } catch {
      /* ignore */
    }
    return undefined;
  }

  function saveStoredPresets(questions: string[] | undefined | null) {
    if (!questions?.length) return;
    try {
      localStorage.setItem(presetsStorageKey(), JSON.stringify(questions));
    } catch {
      /* ignore */
    }
  }

  /** 侧栏最多保留一条「新对话」：合并重复项，返回保留的那条（列表最前视为最新） */
  function takeSingleDraftChat(): ChatHistory | null {
    const drafts = historyList.value.filter((h) => h.title === '新对话');
    if (drafts.length === 0) return null;
    const keep = drafts[0];
    if (drafts.length > 1) {
      historyList.value = historyList.value.filter((h) => h.title !== '新对话' || h.id === keep.id);
      persistSidebar();
    }
    return keep;
  }

  function loadSidebarFromStorage() {
    try {
      const raw = localStorage.getItem(sidebarStorageKey());
      if (!raw) return;
      const arr = JSON.parse(raw) as unknown;
      if (Array.isArray(arr)) {
        historyList.value = arr.filter((x): x is ChatHistory =>
          Boolean(
            x &&
              typeof (x as ChatHistory).id === 'string' &&
              typeof (x as ChatHistory).title === 'string'
          )
        );
      }
    } catch {
      historyList.value = [];
    }
  }

  function persistSidebar() {
    try {
      localStorage.setItem(sidebarStorageKey(), JSON.stringify(historyList.value.slice(0, 50)));
    } catch {
      /* quota / private mode */
    }
  }

  function applySessionApiResult(result: { sessionId: string; exampleQuestions?: string[] }) {
    sessionId.value = result.sessionId;
    currentChatId.value = result.sessionId;
    presetQuestions.value =
      result.exampleQuestions && result.exampleQuestions.length > 0
        ? [...result.exampleQuestions]
        : [...FALLBACK_PRESETS];
  }

  /** 将当前会话挂到侧栏顶部；若标题为「新对话」则移除侧栏中其它「新对话」，保证至多一条空白会话 */
  function ensureSidebarSession(id: string, title: string) {
    let rest = historyList.value.filter((h) => h.id !== id);
    if (title === '新对话') {
      rest = rest.filter((h) => h.title !== '新对话');
    }
    historyList.value = [{ id, title }, ...rest];
    persistSidebar();
  }

  function historyItemsToMessages(list: ChatHistoryItem[]): ChatMessage[] {
    const out: ChatMessage[] = [];
    for (const item of list) {
      if (item.role === 'user' && item.content) {
        out.push({ id: item.messageId, role: 'user', content: item.content });
      } else if (item.role === 'assistant') {
        out.push({
          id: item.messageId,
          role: 'ai',
          content: formatReplyContentText(item.replyContent ?? undefined),
          replyContent: item.replyContent ?? undefined,
          userFeedback: item.userFeedback,
        });
      }
    }
    return out;
  }

  async function loadFullHistoryMessages(chatId: string): Promise<ChatMessage[]> {
    const pageSize = 500;
    let pageNum = 1;
    const acc: ChatHistoryItem[] = [];
    for (;;) {
      const data = await getChatHistory(chatId, pageNum, pageSize, {
        skipGlobalErrorMessage: true,
      }).send();
      acc.push(...(data.historyList || []));
      const totalPages = data.pagination?.totalPages ?? 1;
      if (pageNum >= totalPages) break;
      pageNum += 1;
    }
    return historyItemsToMessages(acc);
  }

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

  onMounted(async () => {
    checkMobile();
    window.addEventListener('resize', checkMobile);
    loadSidebarFromStorage();
    const draft = takeSingleDraftChat();
    if (draft) {
      applySessionApiResult({
        sessionId: draft.id,
        exampleQuestions: loadStoredPresets(),
      });
      // 本地侧栏 id 可能在服务端已不存在（例如执行过 seed 清空 chat_sessions）
      try {
        await getChatHistory(draft.id, 1, 1, { skipGlobalErrorMessage: true }).send();
        return;
      } catch (e) {
        if (isStaleExecutiveSessionError(e)) {
          historyList.value = historyList.value.filter((h) => h.id !== draft.id);
          persistSidebar();
          // 继续向下创建新会话
        } else {
          // 网络等：保留本地草稿与 sessionId，发送/重试时再走失败逻辑
          return;
        }
      }
    }
    try {
      const result = await createChatSession().send();
      applySessionApiResult(result);
      saveStoredPresets(result.exampleQuestions);
      ensureSidebarSession(result.sessionId, '新对话');
    } catch {
      /* 发送首条消息时会再创建会话 */
    }
  });

  onUnmounted(() => {
    window.removeEventListener('resize', checkMobile);
  });

  /** 新建服务端会话并进入空白「新对话」（侧栏置顶一条「新对话」） */
  async function openFreshDraftSession(): Promise<boolean> {
    try {
      const result = await createChatSession().send();
      applySessionApiResult(result);
      saveStoredPresets(result.exampleQuestions);
      ensureSidebarSession(result.sessionId, '新对话');
      return true;
    } catch {
      return false;
    }
  }

  const handleNewChat = async () => {
    showMobileSidebar.value = false;
    messages.value = [];
    inputValue.value = '';
    const ok = await openFreshDraftSession();
    if (!ok) message.error('创建会话失败，请刷新重试');
  };

  /** 服务端已无该会话（如重新 seed 清空 chat_sessions、或侧栏 id 过期） */
  function isStaleExecutiveSessionError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return /404|会话不存在|CHAT_003|Not Found/i.test(msg);
  }

  /**
   * 先请求服务端删除会话，成功（或会话已不存在）后再更新侧栏。
   * 若删除的是当前会话，清空消息并新建空白「新对话」。
   */
  async function removeChatFromSidebar(item: ChatHistory) {
    if (isLoadingHistory.value) {
      message.warning('正在加载历史，请稍候再试');
      return;
    }
    const wasCurrent = item.id === currentChatId.value || item.id === sessionId.value;

    try {
      await deleteChatSession(item.id, { skipGlobalErrorMessage: true }).send();
    } catch (e) {
      if (!isStaleExecutiveSessionError(e)) {
        message.error('删除失败，请稍后重试');
        return;
      }
      /* 幂等：服务端已无该会话时仍同步侧栏 */
    }

    historyList.value = historyList.value.filter((h) => h.id !== item.id);
    persistSidebar();

    if (!wasCurrent) {
      message.success('已删除该对话');
      return;
    }

    messages.value = [];
    inputValue.value = '';
    const ok = await openFreshDraftSession();
    if (ok) {
      message.success('已删除当前对话，已进入新对话');
      showMobileSidebar.value = false;
      scrollToBottom();
    } else {
      message.error('会话已从服务端删除，但新建空白会话失败，发送消息时将尝试自动创建会话');
      sessionId.value = '';
      currentChatId.value = '';
      presetQuestions.value = [...FALLBACK_PRESETS];
    }
  }

  const selectChat = async (chat: ChatHistory) => {
    if (isLoadingHistory.value) return;
    currentChatId.value = chat.id;
    sessionId.value = chat.id;
    showMobileSidebar.value = false;
    isLoadingHistory.value = true;
    messages.value = [];
    try {
      messages.value = await loadFullHistoryMessages(chat.id);
    } catch {
      message.error('加载历史失败，会话可能已失效');
      messages.value = [];
      historyList.value = historyList.value.filter((h) => h.id !== chat.id);
      persistSidebar();
    } finally {
      isLoadingHistory.value = false;
      scrollToBottom();
    }
  };

  const scrollToBottom = () => {
    nextTick(() => {
      if (chatBodyRef.value) {
        chatBodyRef.value.scrollTop = chatBodyRef.value.scrollHeight;
      }
    });
  };

  function onInputEnter(e: KeyboardEvent) {
    if (e.shiftKey) return;
    e.preventDefault();
    handleSend();
  }

  const handleSend = async () => {
    if (!inputValue.value.trim() || isSending.value || isLoadingHistory.value) return;

    // 确保有会话
    if (!sessionId.value) {
      try {
        const result = await createChatSession().send();
        applySessionApiResult(result);
        saveStoredPresets(result.exampleQuestions);
        ensureSidebarSession(result.sessionId, '新对话');
      } catch {
        message.error('创建会话失败，请重试');
        return;
      }
    }

    const question = inputValue.value.trim();
    messages.value.push({ role: 'user', content: question });
    inputValue.value = '';
    scrollToBottom();

    // 占位（流式开始后由 delta 覆盖）
    messages.value.push({ role: 'ai', content: '正在生成…' });
    const loadingIndex = messages.value.length - 1;
    isSending.value = true;
    scrollToBottom();

    const applySendSuccess = (sid: string, result: SendMessageResult, thinkingSnapshot: string) => {
      const finalized = finalizeExecStyleMessage(result, thinkingSnapshot);
      messages.value[loadingIndex] = {
        ...finalized,
        userFeedback: null,
      };
      const titleShort = question.length > 28 ? `${question.slice(0, 28)}…` : question;
      const existing = historyList.value.find((h) => h.id === sid);
      if (existing) {
        if (existing.title === '新对话' || !existing.title.trim()) {
          existing.title = titleShort;
        }
      } else {
        historyList.value.unshift({ id: sid, title: titleShort });
      }
      persistSidebar();
    };

    const runStreamSend = (sid: string) =>
      new Promise<void>((resolve, reject) => {
        void runExecStyleSseChat(streamExecutiveChatMessage, sid, question, (p) => {
          messages.value[loadingIndex] = {
            role: 'ai',
            content: p.content,
            thinking: p.thinking,
            jsonStream: p.jsonStream,
            partialReply: p.partialReply ?? undefined,
          };
          scrollToBottom();
        })
          .then(({ result, thinkingSnapshot }) => {
            applySendSuccess(sid, result, thinkingSnapshot);
            resolve();
          })
          .catch(reject);
      });

    try {
      await runStreamSend(sessionId.value);
    } catch (e) {
      if (isStaleExecutiveSessionError(e) && sessionId.value) {
        const staleId = sessionId.value;
        historyList.value = historyList.value.filter((h) => h.id !== staleId);
        persistSidebar();
        try {
          const created = await createChatSession().send();
          applySessionApiResult(created);
          saveStoredPresets(created.exampleQuestions);
          ensureSidebarSession(created.sessionId, '新对话');
          await runStreamSend(sessionId.value);
        } catch {
          messages.value[loadingIndex] = {
            role: 'ai',
            content:
              '本地会话已失效（例如数据库已重新 seed），已尝试新建会话但仍失败，请刷新页面。',
          };
          message.error('会话恢复失败，请刷新页面后重试');
        }
      } else {
        messages.value[loadingIndex] = { role: 'ai', content: '查询失败，请稍后重试。' };
        message.error('查询失败，请稍后重试');
      }
    } finally {
      isSending.value = false;
      scrollToBottom();
    }
  };
  const handleFeedback = async (msg: ChatMessage, type: 'like' | 'dislike') => {
    if (!msg.id || msg.isFeedbackLoading) return;
    msg.isFeedbackLoading = true;

    const targetType = msg.userFeedback === type ? 'none' : type;

    try {
      const res = await submitChatFeedback(sessionId.value, msg.id, targetType).send();
      msg.userFeedback = res.userFeedback;
    } catch (error) {
      message.error('反馈提交失败');
    } finally {
      msg.isFeedbackLoading = false;
    }
  };

  const handleRegenerate = async (msg: ChatMessage, index: number) => {
    if (!msg.id || msg.isRegenerating) return;

    msg.isRegenerating = true;
    isSending.value = true;

    try {
      const result = await regenerateChatMessage(sessionId.value, msg.id).send();
      const text = formatReplyContentText(result.replyContent);

      // Replace the old message with the new one
      messages.value[index] = {
        id: result.messageId,
        role: 'ai',
        content: text,
        replyContent: result.replyContent,
        thinking: undefined,
        jsonStream: undefined,
        partialReply: undefined,
        userFeedback: null,
      };
      scrollToBottom();
    } catch (error) {
      message.error('重新生成失败，请重试');
    } finally {
      if (messages.value[index]) {
        messages.value[index].isRegenerating = false;
      }
      isSending.value = false;
    }
  };
</script>

<style lang="less" scoped>
  .executive-container {
    height: 100vh;
    width: 100vw;
    background-color: #ffffff;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Helvetica,
      Arial, sans-serif;
  }

  .executive-sider {
    background: #f5f5f7;
    border-right: 1px solid rgba(0, 0, 0, 0.05);

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
          flex: 1;
          min-width: 0;
          font-size: 14px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .chat-item-delete {
          flex-shrink: 0;
          opacity: 0;
          transition: opacity 0.15s ease;
          display: flex;
          align-items: center;
        }

        &:hover .chat-item-delete,
        &.active .chat-item-delete {
          opacity: 1;
        }

        .chat-item-delete--mobile {
          opacity: 1;
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

    &:hover,
    &:active {
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
        font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue',
          Helvetica, Arial, sans-serif;
      }

      p {
        color: rgba(0, 0, 0, 0.48);
        font-size: 15px;
        line-height: 1.47;
        letter-spacing: -0.374px;
        margin: 0 0 40px;
        font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Helvetica,
          Arial, sans-serif;
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
          font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Helvetica,
            Arial, sans-serif;

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
        font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Helvetica,
          Arial, sans-serif;
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
        font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Helvetica,
          Arial, sans-serif;
        box-shadow: none;

        &:hover,
        &.n-input--focus {
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
        font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Helvetica,
          Arial, sans-serif;
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
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Helvetica,
        Arial, sans-serif;
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

    &:hover,
    &:active {
      box-shadow: 0 2px 8px rgba(37, 99, 235, 0.1) !important;
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

  .message-actions {
    margin-top: 8px;
    border-top: 1px solid rgba(0, 0, 0, 0.05);
    padding-top: 8px;
  }

  .action-btn {
    font-size: 13px;
    color: #6b7280;

    &:hover {
      color: #374151;
      background: transparent;
    }
  }
</style>
