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
          <LogoMark />
          <span v-show="!desktopSidebarCollapsed" class="logo-text">Ops Forge</span>
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
            <LogoMark />
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
            <h2 class="header-title">{{ headerTitle }}</h2>
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
              <h3>{{ displayName }}，有什么可以帮你？</h3>
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

                  <!-- 决策链（工具调用序列，调试用） -->
                  <div v-if="msg.done && msg._toolCalls?.length" class="exec-chain-wrap">
                    <div class="exec-chain-title">Agent 决策链</div>
                    <div class="exec-chain-items">
                      <span v-for="(t, i) in msg._toolCalls" :key="i" class="exec-chain-step">
                        {{ TOOL_DISPLAY_NAMES[t] || t }}
                        <span v-if="i < msg._toolCalls.length - 1" class="exec-chain-arrow">→</span>
                      </span>
                    </div>
                  </div>

                  <!-- 思考过程 -->
                  <div v-if="msg.thinking" class="exec-thinking-wrap">
                    <n-collapse>
                      <n-collapse-item title="思考过程" name="think">
                        <div class="exec-thinking-body">
                          {{ msg.thinking }}
                        </div>
                      </n-collapse-item>
                    </n-collapse>
                  </div>

                  <!-- ===== 模板分支渲染 ===== -->
                  <!-- General 模板：纯 Markdown -->
                  <MarkdownRenderer
                    v-if="msg.replyContent?.template === 'general' && msg.replyContent?.markdown"
                    :content="msg.replyContent.markdown"
                    :thinking="undefined"
                    :streaming="false"
                    @suggestion-click="fillComposerWithSuggestion"
                  />

                  <!-- 新 blocks 组件化格式 -->
                  <BlockRenderer
                    v-if="msg.replyContent?.blocks"
                    :blocks="msg.replyContent.blocks"
                    :datasets="msg.replyContent._datasets"
                    @suggestion-click="fillComposerWithSuggestion"
                  />
                  <AgentTracePanel v-if="msg.done && msg.traceSteps?.length" :steps="msg.traceSteps" />

                  <!-- 结构化模板（一个 release cycle 后删除） -->
                  <template v-else-if="msg.replyContent?.template && msg.replyContent.template !== 'general'">
                    <!-- Overview — 警告模板用更醒目的样式 -->
                    <div v-if="msg.replyContent.overview"
                      :class="msg.replyContent.template === 'warning' ? 'hero-card hero-card--warning' : 'hero-card'"
                      v-html="renderMarkdown(msg.replyContent.overview)" />

                    <!-- 图表 -->
                    <div v-if="msg.replyContent.visualizations?.length" class="exec-charts"
                      :class="{ 'exec-charts--multiple': msg.replyContent.visualizations.length > 1 }">
                      <AiChartRenderer v-for="(chart, ci) in msg.replyContent.visualizations" :key="ci" :data="chart" class="exec-chart-item" />
                    </div>

                    <div v-if="msg.replyContent.forecastDisclaimer" class="exec-disclaimer">{{ msg.replyContent.forecastDisclaimer }}</div>

                    <!-- KeyNumbers — 简单指标模板大字展示 -->
                    <KeyGrid v-if="msg.replyContent.keyNumbers?.length" :items="msg.replyContent.keyNumbers"
                      :large="msg.replyContent.template === 'simple_metric'" />

                    <!-- 表格 -->
                    <template v-if="msg.replyContent.tables?.length">
                      <TableBlock v-for="(tbl, ti) in msg.replyContent.tables" :key="ti" :table="tbl" />
                    </template>
                    <TableBlock v-else-if="msg.replyContent.table" :table="msg.replyContent.table" />

                    <!-- 洞察 → warning/diagnosis 模板突出 -->
                    <InsightList v-if="msg.replyContent.attentionPoints?.length" :items="msg.replyContent.attentionPoints"
                      :prominent="msg.replyContent.template === 'warning' || msg.replyContent.template === 'diagnosis'" />

                    <!-- 追问 -->
                    <SuggestChips v-if="msg.replyContent.followUpSuggestions?.length" :items="msg.replyContent.followUpSuggestions" @select="fillComposerWithSuggestion" />

                    <!-- Agent 运行追踪 -->
                    <AgentTracePanel v-if="msg.done && msg.traceSteps?.length" :steps="msg.traceSteps" />
                  </template>

                  <!-- 流式中的 Markdown 渲染（无 replyContent 时） -->
                  <MarkdownRenderer
                    v-else-if="!msg.replyContent && (msg.streamContent || msg.content)"
                    :content="msg.streamContent || msg.content"
                    :thinking="undefined"
                    :streaming="!msg.done"
                    @suggestion-click="fillComposerWithSuggestion"
                  />

                  <!-- Agent 运行追踪（无结构化卡片时也显示） -->
                  <AgentTracePanel v-if="msg.done && !msg.replyContent && msg.traceSteps?.length" :steps="msg.traceSteps" />

                  <!-- 数据溯源 -->
                  <div v-if="provFooterContent(msg.replyContent?.statisticsProvenance) || provFooterContent(msg.replyContent?._provenance)" class="exec-prov-footer">
                    {{ provFooterContent(msg.replyContent?.statisticsProvenance) || provFooterContent(msg.replyContent?._provenance) }}
                    </div>

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
                </template>
              </div>
            </div>
          </n-spin>
        </div>

        <div class="chat-footer">
          <div v-if="pendingClarification" class="clarify-panel">
            <div class="clarify-title">{{ pendingClarification.data?.prompt || pendingClarification.message || pendingClarification.prompt || '请补充信息' }}</div>
            <div class="clarify-cards" v-if="(pendingClarification.data?.options || pendingClarification.options || []).length">
              <div
                v-for="opt in (pendingClarification.data?.options || pendingClarification.options || [])"
                :key="opt.id"
                class="clarify-card"
                @click="sendClarificationResponse(pendingClarification!, { action: 'select_option', option: opt })"
              >
                <div class="clarify-card-title">{{ opt.label }}</div>
                <div class="clarify-card-meta">
                  <span v-if="opt.completionRate != null">完成率 {{ opt.completionRate }}%</span>
                  <span v-if="opt.subtitle">{{ opt.subtitle }}</span>
                </div>
              </div>
            </div>
            <div class="clarify-actions">
              <n-button size="small" quaternary @click="cancelClarification">取消</n-button>
            </div>
          </div>

          
          <div class="input-wrapper flex items-end gap-2">
            <n-input
              v-model:value="inputValue"
              type="textarea"
              placeholder="输入消息，Shift + Enter 换行，Enter 发送..."
              :autosize="{ minRows: 1, maxRows: 5 }"
              @keydown.enter="onInputEnter"
              class="flex-1"
            />
            <div class="flex items-center gap-2 flex-shrink-0 mb-1">
              <n-button 
                circle 
                strong 
                secondary
                :type="isRecording ? 'error' : 'default'"
                @click="toggleRecording"
                :loading="isTranscribing"
                class="voice-btn"
              >
                <template #icon>
                  <n-icon><AudioOutlined /></n-icon>
                </template>
              </n-button>
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
  import { useVoiceInput } from '@/hooks/useVoiceInput';
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
    AudioOutlined,
    LoadingOutlined,
  } from '@vicons/antd';
  
  import { useUserStore } from '@/store/modules/user';
  import AiChartRenderer from './components/AiChartRenderer.vue';
  import BlockRenderer from './components/BlockRenderer.vue';
  import MarkdownRenderer from './components/MarkdownRenderer.vue';
  import { renderInsightMarkdown } from '@/utils/markdownRender';
  import KeyGrid from '@/components/chat/KeyGrid.vue';
  import InsightList from '@/components/chat/InsightList.vue';
  import TableBlock from '@/components/chat/TableBlock.vue';
  import SuggestChips from '@/components/chat/SuggestChips.vue';
  import AgentTracePanel from '@/components/chat/AgentTracePanel.vue';
import LogoMark from '@/components/common/LogoMark.vue';
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

  // 将 Agent 回复中的 **bold** 等 Markdown 语法渲染为 HTML
  const renderMarkdown = (text: string): string => {
    if (!text) return '';
    return renderInsightMarkdown(text);
  };

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
    /** Agent 运行追踪步骤 */
    traceSteps?: import('@/utils/execStreamReply').TraceEvent[] | null;
    userFeedback?: 'like' | 'dislike' | null;
    isRegenerating?: boolean;
    isFeedbackLoading?: boolean;
  }

  /** 将 statisticsProvenance 对象转为脚注风格的标注文字 */
  function provFooterContent(sp: Record<string, string> | null | undefined): string {
    if (!sp || typeof sp !== 'object') return '';
    const parts: string[] = [];
    if (sp['统计口径']?.trim()) parts.push(`统计口径：${sp['统计口径'].trim()}`);
    if (sp['数据来源']?.trim()) parts.push(`数据来源：${sp['数据来源'].trim()}`);
    if (sp['数据截止']?.trim()) parts.push(`数据截止：${sp['数据截止'].trim()}`);
    return parts.join('  ');
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

  const headerTitle = computed(() => {
    const cur = historyList.value.find((h) => h.id === sessionId.value);
    return cur?.title || 'Executive Chat';
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
    // 守卫：regenerate 用的是本地 controller，跟全局 abortController.value 完全隔离。
    // 如果当前有任何消息正在 regenerate，stop 按钮被误触发（如 v-else 切换瞬间事件冒泡到刚切出来的
    // stop 按钮）会破坏 regenerate 流：误把流式中的 streamContent 当 content、清掉 isSending。
    // 这种情况下 stop 应该是 no-op，让 regenerate 自己跑完或失败。
    const isAnyRegenerating = messages.value.some((m) => m.isRegenerating);
    if (isAnyRegenerating) return;
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
    clarifyInputDraft.value = '';
  };

  const cancelClarification = async () => {
    const payload = pendingClarification.value;
    if (!payload) return;
    // 仅清空本地视图会让后端 graph 持续挂在 interrupt 上，必须显式发 cancel 回 /resume，
    // 让 humanInTheLoopGate 走 cancel 分支安全收尾。
    try {
      await sendClarificationResponse(payload, { resumeType: 'cancel' });
    } catch {
      /* sendClarificationResponse 内部已处理错误提示 */
    } finally {
      clearClarification();
    }
  };

  const submitClarifyInput = async () => {
    const payload = pendingClarification.value;
    if (!payload) return;
    const text = clarifyInputDraft.value.trim();
    if (!text) return;
    await sendClarificationResponse(payload, { resumeType: 'slot_fill', value: text, userText: text });
    clarifyInputDraft.value = '';
  };

  const clarifyInputDraft = ref('');

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

  const sendClarificationResponse = async (
    payload: ClarifyPayload,
    chosen?: {
      action?: string;
      option?: { id?: string; label?: string; value?: unknown; meta?: Record<string, unknown> };
      value?: unknown;
      resumeType?: 'slot_fill' | 'intent_shift' | 'cancel';
      userText?: string;
    }
  ) => {
    if (!sessionId.value) return;

    // 1) 决定 resume_type：
    //    - 显式 chosen.resumeType 优先
    //    - 选项的 meta.intent_shift === true → intent_shift
    //    - 否则 slot_fill
    const optMeta = (chosen?.option?.meta || {}) as Record<string, unknown>;
    const isIntentShift =
      chosen?.resumeType === 'intent_shift' || optMeta.intent_shift === true;
    const isCancel = chosen?.resumeType === 'cancel';
    const resumeType: 'slot_fill' | 'intent_shift' | 'cancel' = isCancel
      ? 'cancel'
      : isIntentShift
      ? 'intent_shift'
      : 'slot_fill';

    // 2) 真正回传给后端的 value：优先 meta.value（我们后端 Fix 1 写的就是它），
    //    再退到 option.value，再退到 chosen.value，再退到 option.label。
    const resolvedValue =
      optMeta.value !== undefined
        ? optMeta.value
        : chosen?.option?.value !== undefined
        ? chosen.option.value
        : chosen?.value !== undefined
        ? chosen.value
        : chosen?.option?.label;

    const resumePayload: Record<string, unknown> = {
      resume_type: resumeType,
      value: resolvedValue,
      label: chosen?.option?.label ?? (typeof resolvedValue === 'string' ? resolvedValue : ''),
      selected_option_id: chosen?.option?.id,
      action: chosen?.action || (isCancel ? 'cancel' : 'select_option'),
      toolCallId:
        payload.data?.toolCallId || payload.data?.resumeToken || payload.toolCallId,
    };
    if (isIntentShift) {
      // 后端 humanInTheLoopGate 会优先读 user_text 写回 userMessage 让 router 重跑
      resumePayload.user_text =
        chosen?.userText ??
        (typeof resolvedValue === 'string' ? resolvedValue : '') ??
        '';
    }

    pendingClarification.value = null;
    if (!isCancel) {
      messages.value.push({
        role: 'user',
        content:
          typeof resolvedValue === 'string'
            ? resolvedValue
            : chosen?.option?.label || '已确认补充信息',
      });
      messages.value.push({ role: 'ai', content: '已提交补充信息，正在继续处理…', done: true });
      scrollToBottom();
    }

    try {
      const threadId = (payload.data?.threadId || payload.threadId) as string;
      if (!threadId) {
        message.error('缺少 threadId，无法恢复对话');
        return;
      }

      // Adapter: bridge the extra threadId param into streamResumeExecutiveChatMessage
      const streamWithThreadId = (
        sid: string,
        rp: unknown,
        onDelta: (chunk: { text: string; phase?: string; toolName?: string }) => void,
        onDone: (data: SendMessageResult) => void,
        onClarify: (cp: ClarifyPayload) => void,
        onError: (error: unknown) => void,
        opts?: { signal?: AbortSignal },
        onTrace?: (parsed: unknown) => void,
      ) =>
        streamResumeExecutiveChatMessage(
          sid,
          rp as Record<string, unknown>,
          threadId,
          onDelta,
          onDone,
          onClarify,
          onError,
          opts,
          onTrace,
        );

      const { result, thinkingSnapshot, traceSteps } = await runExecStyleSseChat(
        streamWithThreadId,
        sessionId.value,
        resumePayload,
        (p) => {
          if (isCancel) return;
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
      // 内联 applySendSuccess 逻辑（避免跨函数作用域的 hoisting 问题）
      const sid = sessionId.value;
      const lastIdx = messages.value.length - 1;
      const lastMsg2 = messages.value[lastIdx];
      if (lastMsg2) {
        lastMsg2.id = result.messageId;
        lastMsg2.done = true;
        lastMsg2.activeToolName = undefined;
        lastMsg2.content = result.markdownContent || formatReplyContentText(result.replyContent);
        lastMsg2.thinking = thinkingSnapshot?.trim() ? thinkingSnapshot.trim() : undefined;
        lastMsg2.replyContent = result.replyContent;
        lastMsg2.traceSteps = traceSteps?.length ? traceSteps : null;
        (lastMsg2 as any)._toolCalls = (result as any)._toolMeta?.toolNames || [];
      }
      const aiTitle2 = (result as any).sessionTitle as string | undefined;
      const titleShort2 = aiTitle2 || (typeof resolvedValue === 'string' ? resolvedValue : String(resolvedValue || '查询')).slice(0, 28);
      const existing2 = historyList.value.find((h) => h.id === sid);
      if (existing2) {
        existing2.title = titleShort2;
      } else {
        historyList.value.unshift({ id: sid, title: titleShort2 });
      }
      persistSidebar();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[resume error]', msg, e);
      message.error('恢复对话失败: ' + msg);
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
          userFeedback: item.userFeedback,
          done: true,
          traceSteps: (structured as any)?._trace || null,
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

  let executiveVoiceInitialText = '';
  const { isRecording, isTranscribing, toggleRecording } = useVoiceInput((text, isFinal) => {
    if (!executiveVoiceInitialText && inputValue.value) {
      // 记录开始录音前，输入框里原本已经有的话
      executiveVoiceInitialText = inputValue.value + ' ';
    }
    // 即时更新：原来有的话 + 当前识别出的话
    inputValue.value = executiveVoiceInitialText + text;
    if (isFinal) {
      // 录音结束，重置锚点
      executiveVoiceInitialText = '';
    }
  });

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

    function applySendSuccess(
      sid: string,
      result: SendMessageResult,
      thinkingSnapshot?: string,
      traceSteps?: import('@/utils/execStreamReply').TraceEvent[]
    ) {
      const lastMsg = messages.value[loadingIndex];
      if (lastMsg) {
        lastMsg.id = result.messageId;
        lastMsg.done = true;
        lastMsg.activeToolName = undefined;
        // FC 模式用 markdownContent，旧模式格式化 replyContent
        lastMsg.content = result.markdownContent || formatReplyContentText(result.replyContent);
        lastMsg.thinking = thinkingSnapshot?.trim() ? thinkingSnapshot.trim() : undefined;
        lastMsg.replyContent = result.replyContent;
        lastMsg.traceSteps = traceSteps?.length ? traceSteps : null;
        // 保存工具调用链（调试用）
        (lastMsg as any)._toolCalls = (result as any)._toolMeta?.toolNames || [];
      }
      const aiTitle = (result as any).sessionTitle as string | undefined;
      const titleShort = aiTitle || (question.length > 28 ? `${question.slice(0, 28)}…` : question);
      const existing = historyList.value.find((h) => h.id === sid);
      if (existing) {
        existing.title = titleShort;
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
        const { result, thinkingSnapshot, traceSteps } = await runExecStyleSseChat(
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
              activeToolName: p.activeToolName,
              traceSteps: p.traceSteps,
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
        applySendSuccess(sid, result, thinkingSnapshot, traceSteps);
      } finally {
        if (tts) {
          tts.finish();
          void tts.waitUntilClosed(120000).finally(() => tts?.dispose());
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
      abortController.value = null;
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

    // Clear old content for stream replacement
    messages.value[index] = {
      ...msg,
      content: '',
      thinking: '',
      replyContent: null,
      userFeedback: null,
      done: false,
    };

    // regenerate 用本地 controller，**不暴露给全局 abortController.value ref**。
    // 否则当用户点重新生成时，isSending.value=true 会让 send 按钮切到 stop 状态，
    // 同一个 click 的事件落到刚切出来的 stop 按钮上 → handleStop 触发 abort →
    // server 端 ~4ms 内收到 socket close → AbortError。诊断 stack 印证：
    //   regenAbort.abort() called → handleStop → naive-ui handleClick2 → HTMLButtonElement
    // trade-off：regenerate 期间 stop 按钮无效（无法中途取消），可接受。
    const regenAbort = new AbortController();

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
            // 更新侧栏标题
            const sid = sessionId.value;
            const aiTitle = (data as any).sessionTitle as string | undefined;
            if (aiTitle && sid) {
              const existing = historyList.value.find((h) => h.id === sid);
              if (existing) { existing.title = aiTitle; persistSidebar(); }
            }
          }
          scrollToBottom();
        },
        (clarify) => {
          pendingClarification.value = clarify;
          messages.value[index] = buildClarifyMessage(clarify);
          scrollToBottom();
        },
        { signal: regenAbort.signal }
      );

      if (voiceEnabled.value) {
        void speakReplyContent(() => userStore.getToken, result).catch(() => undefined);
      }
    } catch (error) {
      if (!isStreamAbortError(error)) {
        message.error('重新生成失败，请重试');
        const errIdx = messages.value.findIndex((m) => m.id === msg.id);
        const target = errIdx >= 0 ? messages.value[errIdx] : messages.value[index];
        if (target) {
          target.content = '*(请求失败)*';
          target.done = true;
        }
      }
    } finally {
      // 用 messageId 重新定位消息：如果中间被 buildClarifyMessage 等替换或数组变长/变短，
      // 直接拿原 index 会清错对象，留下 isRegenerating=true 卡住按钮。
      const finalIdx = messages.value.findIndex((m) => m.id === msg.id);
      const target = finalIdx >= 0 ? messages.value[finalIdx] : messages.value[index];
      if (target) target.isRegenerating = false;
      isSending.value = false;
      // regenAbort 没暴露给全局 ref，无需清理 abortController.value
    }
  };
</script>

<style lang="less" scoped>
  .executive-container {
    height: 100vh;
    width: 100vw;
    background-color: var(--bg-1);
    overflow: hidden;
    font-family: var(--font-sans);
  }

  .executive-sider {
    background: var(--bg-1);
    border-right: 1px solid var(--border-0);

    :deep(.n-layout-sider-scroll-container) {
      background: var(--bg-1);
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
        color: var(--text-0);
        letter-spacing: 0.5px;
        font-family: var(--font-sans);
      }
    }

    .sider-header {
      padding: 20px 16px 12px;
    }

    .new-chat-btn {
      border-radius: var(--radius-md);
      font-weight: 600;
      height: 40px;
      background: var(--text-0) !important;
      border-color: var(--text-0) !important;
      color: var(--bg-0) !important;

      &:hover {
        background: #3d3830 !important;
        border-color: #3d3830 !important;
      }
    }

    .new-chat-btn-icon {
      background: var(--text-0) !important;
      border-color: var(--text-0) !important;
      color: var(--bg-0) !important;
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
      font-size: 11px;
      color: var(--text-2);
      margin-bottom: 12px;
      padding-left: 4px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .chat-list {
      display: flex;
      flex-direction: column;
      gap: 2px;

      .chat-item {
        display: flex;
        align-items: center;
        padding: 10px 12px;
        border-radius: var(--radius-md);
        cursor: pointer;
        color: var(--text-1);
        transition: all 0.2s ease;
        gap: 12px;

        &:hover {
          background: var(--accent-muted);
          color: var(--text-0);
        }

        &.active {
          background: var(--accent-muted);
          color: var(--accent);
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
    background: rgba(250,247,242,0.85);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--border-0);
    position: sticky;
    top: 0;
    z-index: 10;

    .header-title {
      margin: 0;
      font-size: 17px;
      font-weight: 600;
      color: var(--text-0);
      font-family: var(--font-sans);
      letter-spacing: -0.2px;
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
    background: var(--bg-0);
    border: 1.5px solid var(--border-1);
    box-shadow: var(--shadow-card);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: transform 0.2s, box-shadow 0.2s;

    &:hover {
      box-shadow: var(--shadow-md);
    }

    &:active {
      transform: scale(0.95);
    }

    .avatar-text {
      font-size: 16px;
      font-weight: 700;
      color: var(--accent);
      user-select: none;
    }
  }

  .logout-bubble {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    color: var(--text-1);
    font-weight: 500;
    cursor: pointer;
    border-radius: var(--radius-md);
    transition: background 0.2s;

    &:hover,
    &:active {
      background: var(--accent-muted);
      color: var(--accent);
    }
  }

  .chat-body {
    flex: 1;
    padding: 32px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 36px;
    scroll-behavior: smooth;

    .empty-chat {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: var(--text-0);
      text-align: center;
      padding-top: 6vh;

      h3 {
        line-height: 1.47;
        margin: 0 0 16px;
        font-family: var(--font-sans);
        font-weight: 400;
        font-size: 28px;
        color: var(--text-0);
      }

      p {
        margin: 0 0 40px;
        color: var(--text-1);
        font-size: 15px;
      }

      .preset-questions {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 14px;
        width: fit-content;

        .preset-bubble {
          padding: 10px 20px;
          background: var(--bg-0);
          border: 1px solid var(--border-0);
          border-radius: var(--radius-lg);
          font-size: 14px;
          font-weight: 400;
          color: var(--text-1);
          cursor: pointer;
          transition: all 0.2s ease;
          font-family: var(--font-sans);

          &:hover {
            border-color: var(--accent);
            color: var(--accent);
            background: var(--accent-muted);
          }

          &:active {
            background: var(--accent-muted);
          }
        }
      }
    }

    .message-row {
      display: flex;
      gap: 16px;
      max-width: 90%;
      margin-bottom: 36px;

      &.is-user {
        align-self: flex-end;
        flex-direction: row-reverse;

        .message-content {
          background: var(--accent);
          color: #ffffff;
          border-radius: 6px;
          padding: 10px 16px;
          font-size: 14px;
        }
      }

      &.is-ai {
        align-self: flex-start;

        .message-content {
          background: var(--bg-0);
          color: var(--text-0);
          border-radius: 6px;
          border: 1px solid var(--border-0);
          padding: 20px 24px;
        }
      }

      .message-content {
        font-size: 15px;
        line-height: 1.6;
        font-family: var(--font-sans);
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

        .exec-prov-footer {
        font-size: 11px; color: #94a3b8; text-align: right; margin-top: 10px;
      }

      .exec-structured {
          .hero-card {
            background: linear-gradient(135deg, rgba(250,251,252,1) 0%, rgba(247,249,250,1) 100%);
            color: var(--text-0);
            padding: 22px 28px;
            margin-bottom: 24px;
            font-size: 15px;
            line-height: 1.72;
            border-radius: 10px;
            border: 1px solid rgba(0,0,0,0.06);
            box-shadow: 0 1px 2px rgba(0,0,0,0.03), 0 2px 8px rgba(0,0,0,0.04);
            position: relative;
            overflow: hidden;

            // 顶部微妙的彩色渐变线 — 替代原来的深色左边框
            &::before {
              content: '';
              position: absolute;
              top: 0; left: 0; right: 0;
              height: 2px;
              background: linear-gradient(90deg, #2563eb 0%, #7c3aed 60%, transparent 100%);
              opacity: 0.55;
            }

            // 弱化左侧装饰 — 原来这里是 border-left 的位置
            // 改为一个极淡的光晕点
            &::after {
              content: '';
              position: absolute;
              top: 18px;
              left: 16px;
              width: 4px;
              height: 4px;
              border-radius: 50%;
              background: #2563eb;
              opacity: 0.35;
            }

            strong { font-weight: 650; color: #1e293b; }
            em { font-style: normal; color: #64748b; }
          }

          .hero-card--warning {
            background: linear-gradient(135deg, #fffbf5 0%, #fff7ed 100%) !important;
            border-color: rgba(234,160,40,0.12) !important;

            &::before {
              background: linear-gradient(90deg, #d97706 0%, #ea580c 70%, transparent 100%) !important;
              opacity: 0.6 !important;
            }

            &::after {
              background: #d97706 !important;
            }

            strong { color: #92400e !important; }
            em { color: #b45309 !important; }
          }

          &.exec-structured--stream {
            opacity: 0.92;
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
            background: var(--bg-0);
            border-radius: var(--radius-md);
            padding: 20px;
            border: 1px solid var(--border-0);
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
            background: var(--accent-muted);
            color: #b45309;
            font-size: 12px;
            font-style: italic;
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


                .clarify-panel {
          margin-bottom: 8px;
          padding: 12px 14px;
          border: 1px solid #e0e0e0;
          background: #fff;
          border-radius: 12px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.04);
        }
        .clarify-title {
          font-size: 13px;
          font-weight: 600;
          color: #333;
          margin-bottom: 8px;
        }
        .clarify-cards {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-bottom: 8px;
        }
        .clarify-card {
          padding: 8px 12px;
          border: 1px solid #e0e0e0;
          border-radius: 8px;
          cursor: pointer;
          background: #f8f9fa;
          transition: all .15s;
        }
        .clarify-card:hover {
          border-color: #667eea;
          background: #f0f2ff;
        }
        .clarify-card-title {
          font-size: 13px;
          font-weight: 600;
        }
        .clarify-card-meta {
          font-size: 11px;
          color: #888;
          margin-top: 2px;
          display: flex;
          gap: 12px;
        }
        .clarify-actions {
          display: flex;
          justify-content: flex-end;
        }
        .clarify-textonly {
          padding: 8px 12px;
          font-size: 13px;
          color: #555;
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
    background: var(--bg-0);
    border-top: 1px solid var(--border-0);

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
        border-radius: var(--radius-lg);
        padding: 6px;
        background: var(--bg-1);
        border: 1px solid var(--border-0);
        font-size: 15px;
        font-family: var(--font-sans);
        box-shadow: none;

        &:hover,
        &.n-input--focus {
          background: var(--bg-0);
          border-color: var(--accent);
          box-shadow: 0 0 0 2px rgba(194,65,12,0.12);
        }
      }

      .send-btn {
        flex-shrink: 0;
        border-radius: var(--radius-md);
        height: 44px;
        padding: 0 24px;
        font-weight: 600;
        background-color: var(--text-0);
        color: var(--bg-0);
        border: none;
        font-size: 14px;
        font-family: var(--font-sans);
        transition: background-color 0.2s ease;

        &:hover {
          background-color: #3d3830;
        }

        &:active {
          background-color: var(--bg-1);
          color: var(--text-0);
          border: 1px solid var(--border-0);
        }

        &.n-button--disabled {
          background-color: var(--bg-1);
          color: var(--text-2);
          border: 1px solid var(--border-0);
        }
      }

      .send-btn--stop {
        background-color: var(--bg-1);
        color: var(--text-0);
        border: 1px solid var(--border-0);
        box-shadow: none;

        &:hover {
          background-color: var(--border-0);
          color: var(--text-0);
        }

        &:active {
          background-color: var(--border-1);
          color: var(--text-0);
        }
      }
    }

    .footer-tip {
      text-align: center;
      font-size: 12px;
      color: var(--text-2);
      margin-top: 16px;
      font-family: var(--font-sans);
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
    background: var(--bg-0);
    border: 1.5px solid var(--border-1);
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
    display: flex; align-items: center; gap: 8px; margin-bottom: 12px;
    color: #2563eb; font-size: 13px; font-weight: 500;
    background: rgba(37, 99, 235, 0.05); padding: 6px 12px; border-radius: 6px; width: fit-content;
  }

  .exec-chain-wrap { margin-bottom: 12px; }
  .exec-chain-title { font-size: 11px; color: #94a3b8; margin-bottom: 4px; }
  .exec-chain-items { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; font-size: 12px; color: #64748b; }
  .exec-chain-step { background: #f8fafc; padding: 2px 8px; border-radius: 4px; border: 1px solid #e2e8f0; }
  .exec-chain-arrow { color: #cbd5e1; margin: 0 2px; }

</style>

<style>
:root {
  /* Background */
  --bg-0: #ffffff;
  --bg-1: #f8f9fb;
  --bg-2: #f1f3f6;
  /* Text */
  --text-0: #1a1f36;
  --text-1: #5f6b7a;
  --text-2: #8f99a8;
  --text-inv: #ffffff;
  /* Accent — trust blue,只在行动元素出现 */
  --accent: #2563eb;
  --accent-hover: #1d4ed8;
  --accent-muted: #eff3ff;
  /* Semantic — 数据状态，精准投放 */
  --positive: #059669;
  --caution: #d97706;
  --negative: #dc2626;
  --info: #0891b2;
  /* Border */
  --border-0: #e2e6ed;
  --border-1: #f0f2f5;
  /* Chart — 色盲友好10色板 */
  --chart-0: #2563eb;
  --chart-1: #059669;
  --chart-2: #d97706;
  --chart-3: #dc2626;
  --chart-4: #7c3aed;
  --chart-5: #0891b2;
  --chart-6: #db2777;
  --chart-7: #4f46e5;
  --chart-8: #65a30d;
  --chart-9: #ea580c;
  /* Shadow */
  --shadow-card: 0 1px 3px rgba(26,31,54,0.06);
  --shadow-md: 0 4px 12px rgba(26,31,54,0.08);
  /* Radius */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  /* Font */
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono: 'SF Mono', 'Fira Code', 'Consolas', monospace;
}

.clarify-panel { margin-bottom: 12px !important; padding: 16px 20px !important; border: 1px solid var(--border-0) !important; background: var(--bg-0) !important; border-radius: var(--radius-md) !important; box-shadow: var(--shadow-card) !important; }
.clarify-title { font-size: 14px !important; font-weight: 600 !important; color: var(--text-0) !important; margin-bottom: 14px !important; }
.clarify-cards { display: flex !important; flex-direction: column !important; gap: 8px !important; margin-bottom: 14px !important; }
.clarify-card { padding: 12px 16px !important; border: 1px solid var(--border-0) !important; border-radius: var(--radius-md) !important; cursor: pointer !important; background: var(--bg-1) !important; transition: all 0.15s !important; }
.clarify-card:hover { border-color: var(--accent) !important; background: var(--accent-muted) !important; }
.clarify-card-title { font-size: 13px !important; font-weight: 600 !important; color: var(--text-0) !important; }
.clarify-card-meta { font-size: 11px !important; color: var(--text-1) !important; margin-top: 6px !important; display: flex !important; gap: 12px !important; }
.clarify-actions { display: flex !important; justify-content: flex-end !important; }
</style>

