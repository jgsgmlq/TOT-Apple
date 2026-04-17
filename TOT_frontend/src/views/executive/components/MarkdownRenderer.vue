<template>
  <div class="markdown-renderer">
    <!-- 思考过程 (DeepSeek reasoning) -->
    <div v-if="thinking" class="reasoning-box">
      <div class="reasoning-header" @click="showThinking = !showThinking">
        <n-icon :component="showThinking ? MenuFoldOutlined : MenuUnfoldOutlined" />
        <span>思考过程</span>
      </div>
      <n-collapse-transition :show="showThinking">
        <div class="reasoning-content">{{ thinking }}</div>
      </n-collapse-transition>
    </div>

    <!-- 正文渲染区 -->
    <div class="markdown-body" v-html="sanitizedHtml"></div>

    <!-- 图表渲染区 (根据占位符动态插入或在此处遍历) -->
    <div v-if="extractedCharts.length" class="exec-charts">
      <AiChartRenderer
        v-for="(chart, index) in extractedCharts"
        :key="index"
        :data="chart"
        class="exec-chart-item"
      />
    </div>

    <!-- 追问建议区 -->
    <div v-if="extractedSuggestions.length" class="exec-follow">
      <div class="exec-follow-title">💡 建议追问：</div>
      <div class="exec-follow-bubbles">
        <n-button
          v-for="(sug, si) in extractedSuggestions"
          :key="si"
          size="small"
          quaternary
          round
          class="exec-follow-chip"
          @click="$emit('suggestion-click', sug)"
        >
          {{ sug }}
        </n-button>
      </div>
    </div>

    <!-- 流式光标 -->
    <span v-if="streaming" class="streaming-cursor"></span>
  </div>
</template>

<script lang="ts" setup>
  import { ref, computed } from 'vue';
  import { MenuFoldOutlined, MenuUnfoldOutlined } from '@vicons/antd';
  // 注意：此处若未安装成功，可能会有编译错误，请手动运行 pnpm add markdown-it dompurify
  import MarkdownIt from 'markdown-it';
  import DOMPurify from 'dompurify';
  import AiChartRenderer from './AiChartRenderer.vue';
  import type { ChartData } from '@/types/chat';

  const props = defineProps<{
    content: string;
    thinking?: string;
    streaming?: boolean;
  }>();

  defineEmits<{
    (e: 'suggestion-click', text: string): void;
  }>();

  const showThinking = ref(false);

  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
  });

  // 1. 提取特殊代码块并清理 Markdown
  const processedData = computed(() => {
    let raw = props.content || '';
    const charts: ChartData[] = [];
    const suggestions: string[] = [];

    // 提取 echarts 块
    const echartsRegex = /```echarts\s*([\s\S]*?)\s*```/g;
    raw = raw.replace(echartsRegex, (_, jsonStr) => {
      try {
        const data = JSON.parse(jsonStr);
        charts.push(data);
      } catch (e) {
        console.warn('Failed to parse echarts JSON', e);
      }
      return ''; // 移除代码块，由单独的 div 渲染
    });

    // 提取 suggestions 块
    const sugRegex = /```suggestions\s*([\s\S]*?)\s*```/g;
    raw = raw.replace(sugRegex, (_, jsonStr) => {
      try {
        const data = JSON.parse(jsonStr);
        if (Array.isArray(data)) {
          suggestions.push(...data);
        }
      } catch (e) {
        console.warn('Failed to parse suggestions JSON', e);
      }
      return '';
    });

    return {
      cleanMarkdown: raw.trim(),
      charts,
      suggestions,
    };
  });

  const extractedCharts = computed(() => processedData.value.charts);
  const extractedSuggestions = computed(() => processedData.value.suggestions);

  const sanitizedHtml = computed(() => {
    const rawHtml = md.render(processedData.value.cleanMarkdown);
    return DOMPurify.sanitize(rawHtml);
  });
</script>

<style lang="less" scoped>
  .markdown-renderer {
    line-height: 1.6;
    word-break: break-word;

    .reasoning-box {
      margin-bottom: 12px;
      padding: 8px 12px;
      background: #f9fafb;
      border-radius: 8px;
      border: 1px solid #e5e7eb;

      .reasoning-header {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: #6b7280;
        cursor: pointer;
        user-select: none;

        &:hover {
          color: #2563eb;
        }
      }

      .reasoning-content {
        margin-top: 8px;
        font-size: 12px;
        color: #4b5563;
        white-space: pre-wrap;
        font-style: italic;
      }
    }

    .markdown-body {
      font-size: 15px;
      color: #1f2937;

      :deep(table) {
        width: 100%;
        border-collapse: collapse;
        margin: 12px 0;
        display: block;
        overflow-x: auto;

        th, td {
          border: 1px solid #e5e7eb;
          padding: 8px 12px;
          text-align: left;
        }

        th {
          background: #f3f4f6;
          font-weight: 600;
        }
      }

      :deep(p) { margin: 8px 0; }
      :deep(ul), :deep(ol) { padding-left: 20px; }
    }

    .exec-charts {
      margin: 16px 0;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .exec-chart-item {
      background: #ffffff;
      border-radius: 12px;
      padding: 12px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
      border: 1px solid #f3f4f6;
    }

    .exec-follow {
      margin-top: 16px;
      padding-top: 12px;
      border-top: 1px solid #f3f4f6;

      .exec-follow-title {
        font-size: 13px;
        color: #6b7280;
        margin-bottom: 8px;
      }

      .exec-follow-bubbles {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .exec-follow-chip {
        background: #f3f4f6;
        color: #2563eb;
        font-size: 13px;
      }
    }

    .streaming-cursor {
      display: inline-block;
      width: 2px;
      height: 1em;
      background: #2563eb;
      margin-left: 2px;
      vertical-align: middle;
      animation: blink 1s infinite;
    }
  }

  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }
</style>
