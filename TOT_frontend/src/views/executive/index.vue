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
            <div class="voice-switch-wrap" title="开启后与回答同步朗读（百炼 TTS）">
              <span class="voice-label">语音</span>
              <n-switch v-model:value="voiceEnabled" size="small" />
            </div>
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
                  <div v-if="msg.activeToolName" class="exec-tool-indicator">
                    <n-spin size="small" />
                    <span>{{ TOOL_DISPLAY_NAMES[msg.activeToolName] || '正在查询…' }}</span>
                  </div>

                  <!-- headline 置顶 -->
                  <div v-if="msg.headline && !msg.streaming" class="exec-headline-banner">
                    {{ msg.headline }}
                  </div>

                  <!-- 新版：Markdown 渲染器 -->
                  <MarkdownRenderer
                    v-if="!msg.replyContent && (msg.streamContent || msg.content || msg.thinking)"
                    :content="msg.content || msg.streamContent"
                    :thinking="msg.thinking"
                    :streaming="!msg.done"
                    @suggestion-click="fillComposerWithSuggestion"
                  />

                  <!-- 大数字卡片 / 图表渲染 -->
                  <AiChartRenderer
                    v-if="msg.chartPayload && msg.done"
                    :data="msg.chartPayload"
                    class="exec-chart-item"
                  />

                  <!-- 旧版/兼容模式：结构化卡片渲染（流式结束后仍保留思考过程，与 Markdown 分支一致） -->
                  <template v-else-if="msg.replyContent">
                    <div v-if="msg.thinking" class="exec-thinking-wrap">
                      <n-collapse :default-expanded-names="['think']">
                        <n-collapse-item title="思考过程" name="think">
                          <div class="exec-thinking-body">{{ msg.thinking }}</div>
                        </n-collapse-item>
                      </n-collapse>
                    </div>
                    <div class="exec-structured">
                      <p class="exec-overview">
                        {{ msg.replyContent.overview }}
                      </p>

                      <div
                        v-if="msg.replyContent.visualizations?.length"
                        class="exec-charts"
                        :class="{
                          'exec-charts--multiple': msg.replyContent.visualizations.length > 1,
                        }"
                      >
                        <AiChartRenderer
                          v-for="(chart, ci) in msg.replyContent.visualizations"
                          :key="ci"
                          :data="chart"
                          class="exec-chart-item"
                        />
                      </div>

                      <div v-if="msg.replyContent.forecastDisclaimer" class="exec-disclaimer">
                        {{ msg.replyContent.forecastDisclaimer }}
                      </div>

                      <div v-if="msg.replyContent.statisticsProvenance" class="exec-provenance">
                        <n-collapse :default-expanded-names="[]">
                          <n-collapse-item title="数据溯源与统计口径" name="prov">
                            <div class="exec-prov-content">
                              <div
                                v-for="(val, key) in msg.replyContent.statisticsProvenance"
                                :key="key"
                                class="exec-prov-item"
                              >
                                <span class="prov-k">{{ key }}:</span>
                                <span class="prov-v">{{ val }}</span>
                              </div>
                            </div>
                          </n-collapse-item>
                        </n-collapse>
                      </div>

                      <div v-if="msg.replyContent.keyNumbers?.length" class="exec-keynums">
                        <div
                          v-for="(kn, ki) in msg.replyContent.keyNumbers"
                          :key="ki"
                          class="exec-keynum-row"
                        >
                          <span class="exec-k-label">{{ kn.label }}</span>
                          <span class="exec-k-value">{{ kn.value }}{{ kn.unit || '' }}</span>
                        </div>
                      </div>
                      <ul v-if="msg.replyContent.attentionPoints?.length" class="exec-attn">
                        <li v-for="(ap, ai) in msg.replyContent.attentionPoints" :key="ai">
                          {{ ap }}
                        </li>
                      </ul>
                      <div v-if="msg.replyContent.followUpSuggestions?.length" class="exec-follow">
                        <div class="exec-follow-title">💡 建议追问：</div>
                        <div class="exec-follow-bubbles">
                          <n-button
                            v-for="(sug, si) in msg.replyContent.followUpSuggestions"
                            :key="si"
                            size="small"
                            quaternary
                            round
                            class="exec-follow-chip"
                            @click="fillComposerWithSuggestion(sug)"
                          >
                            {{ sug }}
                          </n-button>
                        </div>
                      </div>
                    </div>
                  </template>

                  <!-- AI Feedback Actions -->
                  <div v-if="msg.role === 'ai' && msg.id" class="message-actions">
                    <n-space size="small" align="center">
                      <n-button
                        quaternary
                        size="small"
                        @click="handleCopy(msg)"
                        class="action-btn"
                      >
                        <template #icon>
                          <CheckOutlined v-if="msg._copied" style="color: #18a058" />
                          <CopyOutlined v-else />
                        </template>
                        {{ msg._copied ? '已复制' : '复制' }}
                      </n-button>

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
                </template>
              </div>
            </div>
          </n-spin>
        </div>

        <div class="chat-footer">
          <div v-if="pendingClarification" class="clarify-panel">
            <div class="clarify-header">
              <span class="clarify-icon">🔍</span>
              <span class="clarify-title">{{ pendingClarification.message || pendingClarification.data?.prompt || '请选择一个选项继续' }}</span>
            </div>
            <div class="clarify-options">
              <div
                v-for="(opt, idx) in (pendingClarification.data?.options || [])"
                :key="opt.id"
                class="clarify-option-card"
                :style="{ animationDelay: `${idx * 60}ms` }"
                @click="sendClarificationResponse(pendingClarification, { action: 'select_option', value: opt })"
              >
                <div class="option-index">{{ idx + 1 }}</div>
                <div class="option-body">
                  <div class="option-label">{{ opt.label }}</div>
                  <div class="option-sub" v-if="opt.value?.taskId">{{ opt.value.taskId }}</div>
                </div>
                <div class="option-arrow">→</div>
              </div>
            </div>
          </div>
          <div class="input-wrapper">
            <n-input
              v-model:value="inputValue"
              type="textarea"
              placeholder="输入消息，Shift + Enter 换行，Enter 发送..."
              :autosize="{ minRows: 1, maxRows: 5 }"
              @keydown.enter="onInputEnter"
            />
            <n-button
              v-if="!isSending"
              type="primary"
              :disabled="!inputValue.trim() || isLoadingHistory"
              @click="handleSend"
              class="send-btn"
            >
              发送
            </n-button>
            <n-button v-else type="default" @click="handleStop" class="send-btn send-btn--stop">
              <template #icon>
                <n-icon><StopOutlined /></n-icon>
              </template>
              停止生成
            </n-button>
          </div>
          <div class="footer-tip">AI 生成的内容仅供参考，请结合业务实际情况判断。</div>
        </div>
      </n-layout-content>
    </n-layout>
  </div>
</template>

<script lang="ts" setup>
  import { ref, nextTick, computed, onMounted, onUnmounted, watch } from 'vue';
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
    StopOutlined,
  } from '@vicons/antd';
  import { websiteConfig } from '@/config/website.config';
  import { useUserStore } from '@/store/modules/user';
  import AiChartRenderer from './components/AiChartRenderer.vue';
  import MarkdownRenderer from './components/MarkdownRenderer.vue';
  import {
    createChatSession,
    streamExecutiveChatMessage,
    streamResumeExecutiveChatMessage,
    getChatHistory,
    deleteChatSession,
    formatReplyContentText,
    submitChatFeedback,
    regenerateChatMessage,
    streamRegenerateChatMessage,
    type ChatHistoryItem,
    type SendMessageResult,
    type ReplyContent,
    type ClarifyPayload,
  } from '@/api/chat';
  import {
    runExecStyleSseChat,
    runExecRegenerateSseChat,
    isStreamAbortError,
    speechTextForExecutiveTts,
    speechTextForSendResult,
  } from '@/utils/execStreamReply';

  const TOOL_DISPLAY_NAMES: Record<string, string> = {
    getOverviewData: '查询培训进度总览',
    getTaskListData: '查询任务列表',
    getWarningsData: '查询预警门店',
    getRegionDetailData: '查询区域详情',
    getStoreDetailData: '查询门店详情',
    runAnalytics: '分析数据',
  };
  import {
    ExecutiveTtsSession,
    getExecutiveVoiceEnabled,
    setExecutiveVoiceEnabled,
    speakReplyContent,
  } from '@/utils/execVoiceTts';
  import {
    LikeOutlined,
    LikeFilled,
    DislikeOutlined,
    DislikeFilled,
    SyncOutlined,
    CopyOutlined,
    CheckOutlined,
  } from '@vicons/antd';

  interface ChatHistory {
    id: string;
    title: string;
  }

  interface ChatMessage {
    id?: string;
    role: 'user' | 'ai';
    content: string;
    /** 流式过程中的 Markdown 累积文本 */
    streamContent?: string;
    /** 流式是否完成 */
    done?: boolean;
    /** 当前正在执行的工具名 */
    activeToolName?: string;
    /** 思考过程 */
    thinking?: string;
    /** 旧版结构化回答（仅用于历史兼容） */
    replyContent?: ReplyContent | null;
    /** HITL / clarify 交互态 */
    pendingClarification?: ClarifyPayload | null;
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
  const abortController = ref<AbortController | null>(null);

  /** 与 SSE 并行：百炼实时 TTS（localStorage 持久化） */
  const voiceEnabled = ref(getExecutiveVoiceEnabled());
  watch(voiceEnabled, (v) => setExecutiveVoiceEnabled(v));

  const messages = ref<ChatMessage[]>([]);
  const pendingClarification = ref<ClarifyPayload | null>(null);

  const handleStop = () => {
    abortController.value?.abort();
    abortController.value = null;
    isSending.value = false;
    const lastMsg = messages.value[messages.value.length - 1];
    if (lastMsg?.role === 'ai') {
      lastMsg.content = lastMsg.streamContent || lastMsg.content || '';
      lastMsg.done = true;
      lastMsg.activeToolName = undefined;
      lastMsg.streamContent = undefined;
    }
  };

  const clearClarification = () => {
    pendingClarification.value = null;
  };

  const buildClarifyMessage = (payload: ClarifyPayload) => {
    const d = payload.data || {};
    const prompt = typeof d.prompt === 'string' ? d.prompt : payload.message || payload.prompt || '需要你进一步确认';
    return {
      id: `clarify-${Date.now()}`,
      role: 'ai' as const,
      content: prompt,
      done: true,
      pendingClarification: payload,
      streamContent: prompt,
    };
  };

  const sendClarificationResponse = async (payload: ClarifyPayload, chosen?: { action: string; value: unknown }) => {
    console.log('[sendClarificationResponse] 被调用, sessionId:', sessionId.value, 'chosen:', chosen);
    if (!sessionId.value) return;
    const resumePayload = {
      ...(payload.data?.payload && typeof payload.data.payload === 'object' ? (payload.data.payload as Record<string, unknown>) : {}),
      action: chosen?.action || 'select_option',
      value: chosen?.value ?? payload.data?.payload ?? null,
      resume_type: 'slot_fill',
      toolCallId: payload.data?.toolCallId || payload.data?.resumeToken || payload.toolCallId,
    };
    pendingClarification.value = null;
    messages.value.push({ role: 'user', content: typeof chosen?.value === 'string' ? chosen.value : '已确认补充信息' });
    messages.value.push({ role: 'ai', content: '已提交补充信息，正在继续处理…', done: true });
    scrollToBottom();
    try {
      const { result, thinkingSnapshot } = await runExecStyleSseChat(
        streamResumeExecutiveChatMessage,
        sessionId.value,
        resumePayload,
        (p) => {
          messages.value[messages.value.length - 1] = {
            role: 'ai',
            content: p.content,
            thinking: p.thinking,
            jsonStream: p.jsonStream,
            partialReply: p.partialReply ?? undefined,
          };
          scrollToBottom();
        },
        async (clarify) => {
          pendingClarification.value = clarify;
          messages.value[messages.value.length - 1] = buildClarifyMessage(clarify);
          scrollToBottom();
        },
        { signal: abortController.value?.signal }
      );
      // 直接更新最后一条占位消息，避免 applySendSuccess 的 loadingIndex 指向旧消息
      const lastMsg = messages.value[messages.value.length - 1];
      if (lastMsg) {
        lastMsg.id = result.messageId;
        lastMsg.done = true;
        lastMsg.activeToolName = undefined;
        lastMsg.content = result.markdownContent || '';
        lastMsg.streamContent = undefined;
        lastMsg.thinking = thinkingSnapshot?.trim() || undefined;
        lastMsg.headline = result.headline || '';
        lastMsg.chartPayload = result.chartPayload || null;
      }
    } catch (e) {
      console.error('[sendClarificationResponse] 错误详情:', e);
      message.error('恢复对话失败，请重试');
    }
    return resumePayload;
  };

  async function fillComposerWithSuggestion(text: string) {
    inputValue.value = text;
    // 如果包含 [绘图]，直接触发发送
    if (text.includes('[绘图]')) {
      await nextTick();
      handleSend();
      return;
    }
    nextTick(() => {
      const el = document.querySelector('.chat-footer textarea') as HTMLTextAreaElement;
      el?.focus();
    });
  }

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
        const structured = item.replyContent ?? undefined;
        const fromStructured = formatReplyContentText(structured);
        const raw = typeof item.content === 'string' ? item.content : '';
        // FC / Markdown 落库时 history 里 replyContent 为空，必须用 content（原始 Markdown）
        const displayText = fromStructured.trim() !== '' ? fromStructured : raw;
        out.push({
          id: item.messageId,
          role: 'ai',
          content: displayText,
          replyContent: structured,
          chartPayload: (item.chartPayload as any) || null,
          userFeedback: item.userFeedback,
          done: true,
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

    // 占位
    messages.value.push({
      role: 'ai',
      content: '',
      streamContent: '',
      done: false,
    });
    const loadingIndex = messages.value.length - 1;
    isSending.value = true;
    abortController.value = new AbortController();
    scrollToBottom();

    const applySendSuccess = (
      sid: string,
      result: SendMessageResult,
      thinkingSnapshot?: string
    ) => {
      const lastMsg = messages.value[loadingIndex];
      if (lastMsg) {
        lastMsg.id = result.messageId;
        lastMsg.done = true;
        lastMsg.activeToolName = undefined;
        // FC 模式用 markdownContent，旧模式格式化 replyContent
        lastMsg.content = result.markdownContent || formatReplyContentText(result.replyContent);
        lastMsg.streamContent = undefined;
        lastMsg.thinking = thinkingSnapshot?.trim() ? thinkingSnapshot.trim() : undefined;
        lastMsg.replyContent = result.replyContent;
        lastMsg.headline = result.headline || '';
        lastMsg.chartPayload = result.chartPayload || null;
      }
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

    const runStreamSend = async (sid: string) => {
      let tts: ExecutiveTtsSession | null = null;
      if (voiceEnabled.value) {
        tts = new ExecutiveTtsSession();
        try {
          await tts.connect(() => userStore.getToken);
        } catch {
          tts.dispose();
          tts = null;
          message.warning('语音朗读连接失败，本次仅显示文字');
        }
      }
      try {
        const { result, thinkingSnapshot } = await runExecStyleSseChat(
          streamExecutiveChatMessage,
          sid,
          question,
          (p) => {
            messages.value[loadingIndex] = {
              role: 'ai',
              content: p.content,
              thinking: p.thinking,
              jsonStream: p.jsonStream,
              partialReply: p.partialReply ?? undefined,
            };
            scrollToBottom();
            if (tts) {
              const spoken = speechTextForExecutiveTts(p);
              if (spoken) tts.pushSpokenPlainText(spoken);
            }
          },
          async (clarify) => {
            pendingClarification.value = clarify;
            messages.value[loadingIndex] = buildClarifyMessage(clarify);
            scrollToBottom();
          },
          { signal: abortController.value?.signal }
        );
        if (tts) {
          const spoken = speechTextForSendResult(result);
          if (spoken) tts.pushSpokenPlainText(spoken);
        }
        applySendSuccess(sid, result, thinkingSnapshot);
      } finally {
        if (tts) {
          try {
            tts.finish();
            await tts.waitUntilClosed(120000);
          } finally {
            tts.dispose();
          }
        }
      }
    };

    try {
      await runStreamSend(sessionId.value);
    } catch (e) {
      if (isStreamAbortError(e)) {
        return;
      }
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
  const handleCopy = async (msg: ChatMessage) => {
    const text = msg.content || (msg.replyContent ? formatReplyContentText(msg.replyContent) : '');
    if (!text) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        // 降级：非 HTTPS 环境（内网 IP 访问）
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      msg._copied = true;
      setTimeout(() => { msg._copied = false; }, 2000);
    } catch {
      message.error('复制失败');
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

    // Clear old content for stream replacement
    messages.value[index] = {
      ...msg,
      content: '',
      thinking: '',
      replyContent: null,
      userFeedback: null,
      done: false,
    };

    abortController.value = new AbortController();

    try {
      const result = await runExecRegenerateSseChat(
        streamRegenerateChatMessage,
        sessionId.value,
        msg.id,
        (payload) => {
          const currentMsg = messages.value[index];
          if (payload.type === 'streaming') {
            currentMsg.content = payload.partialReply || '';
            currentMsg.thinking = payload.thinking;
          } else if (payload.type === 'done') {
            const data = payload.result!;
            const isMarkdown = !data.replyContent && !!data.markdownContent;

            currentMsg.id = data.messageId;
            currentMsg.content = isMarkdown
              ? data.markdownContent!
              : formatReplyContentText(data.replyContent);
            currentMsg.thinking = payload.thinking || undefined;
            currentMsg.done = true;
            currentMsg.replyContent = data.replyContent ?? null;
          }
          scrollToBottom();
        },
        (clarify) => {
          pendingClarification.value = clarify;
          messages.value[index] = buildClarifyMessage(clarify);
          scrollToBottom();
        },
        { signal: abortController.value.signal }
      );

      if (voiceEnabled.value) {
        void speakReplyContent(() => userStore.getToken, result).catch(() => undefined);
      }
    } catch (error) {
      if (!isStreamAbortError(error)) {
        message.error('重新生成失败，请重试');
        messages.value[index].content = '*(请求失败)*';
        messages.value[index].done = true;
      }
    } finally {
      if (messages.value[index]) {
        messages.value[index].isRegenerating = false;
      }
      isSending.value = false;
      abortController.value = null;
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

    .header-actions {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .voice-switch-wrap {
      display: flex;
      align-items: center;
      gap: 8px;

      .voice-label {
        font-size: 13px;
        color: #64748b;
        user-select: none;
      }
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
    gap: 32px;
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

    .exec-headline-banner {
      margin: 0 0 14px;
      padding: 12px 16px;
      background: linear-gradient(135deg, #eff6ff, #f0f9ff);
      border: 1px solid #bfdbfe;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 700;
      color: #1e40af;
      line-height: 1.5;
      text-align: center;
      box-shadow: 0 1px 3px rgba(37, 99, 235, 0.08);
      white-space: pre-wrap;
    }

    .message-row {
      display: flex;
      gap: 16px;
      max-width: 85%;
      margin-bottom: 28px;

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
          white-space: normal;
        }
      }

      .message-content {
        padding: 16px 18px;
        font-size: 15px;
        line-height: 1.65;
        letter-spacing: 0;
        font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Helvetica,
          Arial, sans-serif;
        word-wrap: break-word;
        white-space: pre-wrap;

        .exec-thinking-wrap {
          margin-bottom: 12px;

          :deep(.n-collapse-item__header) {
            font-size: 13px;
            font-weight: 600;
            color: rgba(0, 0, 0, 0.55);
          }

          .exec-thinking-body {
            font-size: 14px;
            color: rgba(0, 0, 0, 0.72);
            white-space: pre-wrap;
            line-height: 1.5;
          }
        }

        .exec-structured {
          .exec-overview {
            margin: 0 0 12px;
            font-size: 15px;
          }

          &.exec-structured--stream {
            opacity: 0.92;
          }

          .exec-keynums {
            display: grid;
            gap: 8px;
            margin-bottom: 12px;
          }

          .exec-keynum-row {
            display: flex;
            justify-content: space-between;
            gap: 12px;
            padding: 8px 10px;
            background: rgba(255, 255, 255, 0.65);
            border-radius: 8px;
            font-size: 14px;
          }

          .exec-k-label {
            color: rgba(0, 0, 0, 0.55);
          }

          .exec-k-value {
            font-weight: 600;
            color: #1d1d1f;
          }

          

          

          .exec-big-number {
            text-align: center;
            padding: 16px 24px;
            margin: 8px 0;
            background: linear-gradient(180deg, rgba(37, 99, 235, 0.03), rgba(37, 99, 235, 0.01));
            border-radius: 12px;

            .big-number-value {
              font-size: 36px;
              font-weight: 700;
              color: #2563eb;
              line-height: 1.2;
            }
            .big-number-unit {
              font-size: 18px;
              font-weight: 500;
            }
            .big-number-label {
              font-size: 13px;
              color: #64748b;
              margin-top: 4px;
            }
          }

          .exec-attn {
            margin: 0 0 12px;
            padding-left: 18px;
            color: #b45309;
            font-size: 14px;
          }

          .exec-follow {
            font-size: 13px;
            color: rgba(0, 0, 0, 0.55);

            .exec-follow-title {
              margin-bottom: 8px;
            }

            .exec-follow-bubbles {
              display: flex;
              flex-wrap: wrap;
              gap: 8px;
            }

            .exec-follow-chip {
              background: #ffffff;
              border: 1px solid rgba(0, 0, 0, 0.08);
              font-size: 13px;
              height: 32px;
              padding: 0 12px;
              color: #0071e3;

              &:hover {
                background: #f5f5f7;
                border-color: #0071e3;
              }
            }
          }

          .exec-charts {
            margin: 12px 0;
            display: flex;
            flex-direction: column;
            gap: 16px;

            &.exec-charts--multiple {
              flex-direction: row;
              overflow-x: auto;
              scroll-snap-type: x mandatory;
              gap: 12px;
              padding-bottom: 8px;
              -webkit-overflow-scrolling: touch;

              .exec-chart-item {
                flex: 0 0 90%;
                scroll-snap-align: start;
              }

              &::-webkit-scrollbar {
                height: 4px;
              }
              &::-webkit-scrollbar-thumb {
                background: rgba(0, 0, 0, 0.1);
                border-radius: 2px;
              }
            }
          }

          .exec-chart-item {
            background: #ffffff;
            border-radius: 12px;
            padding: 12px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
          }

          .exec-chart-loading {
            padding: 24px;
            display: flex;
            justify-content: center;
            align-items: center;
            background: rgba(255, 255, 255, 0.4);
            border-radius: 12px;
            margin: 12px 0;
          }

          .exec-disclaimer {
            margin: 8px 0;
            padding: 8px 12px;
            background: #fff9db;
            color: #f08c00;
            border-radius: 6px;
            font-size: 12px;
            border-left: 3px solid #f08c00;
          }

          .exec-provenance {
            margin: 8px 0;

            :deep(.n-collapse-item__header) {
              font-size: 12px;
              font-weight: 500;
              color: rgba(0, 0, 0, 0.45);
            }

            .exec-prov-content {
              padding: 8px;
              background: rgba(0, 0, 0, 0.02);
              border-radius: 4px;
            }

            .exec-prov-item {
              display: flex;
              gap: 8px;
              font-size: 11px;
              color: rgba(0, 0, 0, 0.45);
              margin-bottom: 2px;

              .prov-k {
                font-weight: 600;
              }
            }
          }
        }


        .exec-json-fallback {
          margin: 0;
          padding: 10px;
          background: rgba(0, 0, 0, 0.04);
          border-radius: 8px;
          font-size: 12px;
          overflow-x: auto;
          white-space: pre-wrap;
        }

        .exec-plain {
          white-space: pre-wrap;
        }
      }
    }
  }

  .chat-footer {
    padding: 20px 32px;
    background: #ffffff;
    border-top: 1px solid rgba(0, 0, 0, 0.05);

    .clarify-panel {
      margin-bottom: 16px;
      padding: 0;
      border: 1px solid rgba(37, 99, 235, 0.15);
      background: #fff;
      border-radius: 14px;
      overflow: hidden;
      box-shadow: 0 2px 12px rgba(37, 99, 235, 0.06);
    }

    .clarify-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 14px 16px;
      background: linear-gradient(135deg, rgba(37, 99, 235, 0.04), rgba(99, 102, 241, 0.02));
      border-bottom: 1px solid rgba(37, 99, 235, 0.08);
    }

    .clarify-icon {
      font-size: 18px;
      flex-shrink: 0;
    }

    .clarify-title {
      font-size: 14px;
      font-weight: 600;
      color: #1e3a5f;
      line-height: 1.5;
    }

    .clarify-options {
      display: flex;
      flex-direction: column;
      padding: 8px;
      gap: 4px;
      max-height: 320px;
      overflow-y: auto;
    }

    .clarify-option-card {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      border-radius: 10px;
      cursor: pointer;
      transition: all 0.2s ease;
      animation: optionFadeIn 0.3s ease both;
      border: 1px solid transparent;
      background: rgba(37, 99, 235, 0.02);

      &:hover {
        background: rgba(37, 99, 235, 0.08);
        border-color: rgba(37, 99, 235, 0.2);
        transform: translateX(4px);
      }

      &:active {
        transform: translateX(2px);
        background: rgba(37, 99, 235, 0.12);
      }

      .option-index {
        width: 26px;
        height: 26px;
        border-radius: 8px;
        background: rgba(37, 99, 235, 0.1);
        color: #2563eb;
        font-size: 12px;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .option-body {
        flex: 1;
        min-width: 0;

        .option-label {
          font-size: 14px;
          font-weight: 500;
          color: #1e293b;
          line-height: 1.4;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .option-sub {
          font-size: 11px;
          color: #94a3b8;
          margin-top: 2px;
          font-family: 'SF Mono', 'Menlo', monospace;
        }
      }

      .option-arrow {
        font-size: 16px;
        color: #cbd5e1;
        flex-shrink: 0;
        transition: color 0.2s;
      }

      &:hover .option-arrow {
        color: #2563eb;
      }
    }

    @keyframes optionFadeIn {
      from {
        opacity: 0;
        transform: translateY(8px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .input-wrapper {
      position: relative;
      max-width: 860px;
      margin: 0 auto;
      display: flex;
      gap: 16px;
      align-items: flex-end;

      > :deep(.n-input) {
        flex: 1;
        min-width: 0;
      }

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
        flex-shrink: 0;
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

      .send-btn--stop {
        background-color: #f5f5f7;
        color: #1f2937;
        border: 1px solid rgba(0, 0, 0, 0.1);
        box-shadow: none;

        &:hover {
          background-color: #e8e8ed;
          color: #0f172a;
        }

        &:active {
          background-color: #d2d2d7;
          color: #0f172a;
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
      gap: 28px;

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

  .exec-tool-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
    color: #2563eb;
    font-size: 13px;
    font-weight: 500;
    background: rgba(37, 99, 235, 0.05);
    padding: 6px 12px;
    border-radius: 6px;
    width: fit-content;
  }
</style>
