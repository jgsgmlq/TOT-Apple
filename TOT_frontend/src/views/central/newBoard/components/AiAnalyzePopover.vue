<template>
  <div class="ai-hover-btn-container">
    <n-popover
      trigger="click"
      placement="bottom-end"
      style="
        border-radius: 12px;
        padding: 16px;
        width: 320px;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12);
      "
      @update:show="(v: boolean) => v && $emit('open')"
    >
      <template #trigger>
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors border border-blue-100 shadow-sm"
        >
          <n-icon size="14"><ColorWandOutline /></n-icon>
          <span class="text-[12px] font-semibold tracking-wide">智能分析</span>
        </button>
      </template>
      <div class="ai-analyze-content flex flex-col gap-3">
        <div
          class="ai-analyze-header flex items-center justify-between border-b border-gray-100 pb-3"
        >
          <div class="flex items-center gap-1.5 text-[#0071E3]">
            <n-icon size="18"><ColorWandOutline /></n-icon>
            <span class="font-semibold text-gray-900 text-[15px]">智能分析</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-[12px] text-gray-500 font-medium">深度思考</span>
            <n-switch
              :value="isReasoning"
              size="small"
              @update:value="(val: boolean) => $emit('toggleReasoning', val)"
            />
          </div>
        </div>
        <div class="ai-analyze-body max-h-[320px] overflow-y-auto overflow-x-hidden pr-1">
          <n-spin :show="loading" size="small">
            <div v-if="!loading && !content" class="text-center py-8 text-gray-400 text-[13px]"
              >暂无分析内容</div
            >
            <div
              v-else-if="content"
              class="prose prose-sm prose-blue text-[13px] leading-[1.6] text-gray-700 font-medium"
              v-html="renderMarkdown(content)"
            ></div>
          </n-spin>
        </div>
        <div
          class="ai-analyze-actions flex items-center justify-between pt-2 text-[12px] text-gray-400 border-t border-gray-100 mt-1"
        >
          <div v-if="generatedAt">分析生成时间：{{ formatTime(generatedAt) }}</div>
          <div v-else></div>
          <div class="flex items-center gap-3">
            <n-icon
              size="16"
              class="cursor-pointer hover:text-blue-600 transition-colors"
              :class="{ 'text-blue-600': userVote === 'up' }"
              @click="$emit('feedback', 'up')"
              ><LikeOutlined
            /></n-icon>
            <n-icon
              size="16"
              class="cursor-pointer hover:text-blue-600 transition-colors"
              :class="{ 'text-blue-600': userVote === 'down' }"
              @click="$emit('feedback', 'down')"
              ><DislikeOutlined
            /></n-icon>
            <n-icon
              size="16"
              class="cursor-pointer hover:text-blue-600 transition-colors"
              @click="$emit('copy')"
            >
              <CheckOutlined v-if="copied" style="color: #10b981" />
              <CopyOutlined v-else />
            </n-icon>
          </div>
        </div>
      </div>
    </n-popover>
  </div>
</template>

<script setup lang="ts">
  import { NPopover, NIcon, NSwitch, NSpin } from 'naive-ui';
  import { ColorWandOutline } from '@vicons/ionicons5';
  import { LikeOutlined, DislikeOutlined, CheckOutlined, CopyOutlined } from '@vicons/antd';

  defineProps<{
    loading: boolean;
    content: string;
    generatedAt: string | null;
    userVote: 'up' | 'down' | null;
    isReasoning: boolean;
    copied: boolean;
    renderMarkdown: (text: string) => string;
  }>();

  defineEmits(['open', 'toggleReasoning', 'feedback', 'copy']);

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  };
</script>

<style scoped>
  .prose :deep(p) {
    margin-top: 0.5em;
    margin-bottom: 0.5em;
  }
  .prose :deep(blockquote) {
    font-style: normal;
    color: #6b7280;
    border-left: 3px solid #e5e7eb;
    padding-left: 1em;
    background: #f9fafb;
    border-radius: 4px;
    padding: 0.5em 1em;
  }
  .prose :deep(strong) {
    color: #111827;
    font-weight: 600;
  }
  .prose :deep(table) {
    margin-top: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .prose :deep(th),
  .prose :deep(td) {
    padding: 0.5rem 1rem;
    border-bottom: 1px solid #e5e7eb;
  }
  .prose :deep(thead) {
    background-color: #f9fafb;
  }
  .ai-analyze-body::-webkit-scrollbar {
    width: 4px;
  }
  .ai-analyze-body::-webkit-scrollbar-thumb {
    background: #e5e7eb;
    border-radius: 4px;
  }
</style>
