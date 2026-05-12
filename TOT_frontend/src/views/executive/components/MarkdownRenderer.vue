<template>
  <div class="markdown-renderer">
    <!-- 思考过程 (DeepSeek reasoning) -->
    <div v-if="thinking" class="reasoning-box" :class="{ 'is-expanded': showThinking }">
      <div class="reasoning-header" @click="showThinking = !showThinking">
        <n-icon
          class="reasoning-icon"
          :class="{ 'is-rotating': streaming && !showThinking }"
          :component="showThinking ? DownOutlined : RightOutlined"
        />
        <span class="reasoning-title"> 已深度思考 {{ streaming ? '...' : '' }} </span>
      </div>
      <n-collapse-transition :show="showThinking">
        <div class="reasoning-content-wrapper">
          <div class="reasoning-content">{{ thinking }}</div>
        </div>
      </n-collapse-transition>
    </div>

    <!-- 正文渲染区 -->
    <div class="markdown-body" v-html="sanitizedHtml"></div>

    <!-- 流式光标 -->
    <span v-if="streaming" class="streaming-cursor"></span>

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
  </div>
</template>

<script lang="ts" setup>
  import { ref, computed, watch } from 'vue';
  import { DownOutlined, RightOutlined } from '@vicons/antd';
  // 注意：此处若未安装成功，可能会有编译错误，请手动运行 pnpm add markdown-it dompurify
  import MarkdownIt from 'markdown-it';
  import DOMPurify from 'dompurify';
  import AiChartRenderer from './AiChartRenderer.vue';
  import type { ChartData } from '@/types/chat';
  import { normalizeToChartData, parseEchartsBlockContent } from '@/utils/echartsBlockParse';

  const props = defineProps<{
    content: string;
    thinking?: string;
    streaming?: boolean;
  }>();

  defineEmits<{
    (e: 'suggestion-click', text: string): void;
  }>();

  // 默认折叠思考过程
  const showThinking = ref(false);

  watch(
    () => [props.streaming, props.thinking] as const,
    ([s, t]) => {
      if (s && t) showThinking.value = true;
    }
  );

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
      const parsed = parseEchartsBlockContent(jsonStr);
      const chart = normalizeToChartData(parsed);
      if (chart) {
        charts.push(chart);
      } else if (parsed != null) {
        console.warn('echarts 块已解析但无法映射为 ChartData，已跳过渲染', parsed);
      } else {
        console.warn('Failed to parse echarts block (非合法 JSON 或仍含无法剥离的 JS)');
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

    // 压缩多余空行：3+ 连续换行 → 最多保留一个空行（2 个换行）
    raw = raw.replace(/\n{3,}/g, '\n\n');

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
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Helvetica,
      Arial, sans-serif;
    color: #1d1d1f;
    font-size: 15px;
    padding: 4px 0;

    .reasoning-box {
      margin-bottom: 16px;
      background: transparent;
      border-radius: 8px;
      transition: all 0.3s ease;

      .reasoning-header {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 12px;
        background: #f1f5f9; /* Subtle gray background */
        border-radius: 6px;
        font-size: 13px;
        font-weight: 500;
        color: #64748b; /* Muted text color */
        cursor: pointer;
        user-select: none;
        transition: background 0.2s ease, color 0.2s ease;

        &:hover {
          background: #e2e8f0;
          color: #334155;
        }

        .reasoning-icon {
          font-size: 12px;
          transition: transform 0.2s ease;

          &.is-rotating {
            animation: softPulse 1.5s infinite alternate;
          }
        }

        .reasoning-title {
          letter-spacing: 0.3px;
        }
      }

      .reasoning-content-wrapper {
        margin-top: 8px;
        padding-left: 4px; /* Slight indent to align with header visual weight */
      }

      .reasoning-content {
        padding: 12px 16px;
        font-size: 13.5px;
        color: #64748b;
        background: #f8fafc;
        border-left: 3px solid #cbd5e1; /* Subtle blockquote style border */
        border-radius: 0 8px 8px 0;
        white-space: pre-wrap;
        line-height: 1.6;
        font-style: normal; /* Removed italic for better readability of long text */
      }
    }

    .markdown-body {
      :deep(hr) {
        margin: 0.3em 0;
        border: none;
        border-top: 1px solid #e5e7eb;
      }

      :deep(h1), :deep(h2), :deep(h3), :deep(h4) {
        margin-top: 0.4em;
        margin-bottom: 0.15em;
        font-weight: 600;
        color: #0f172a;
        line-height: 1.3;
        &:first-child { margin-top: 0; }
      }
      :deep(h1) { font-size: 1.3em; }
      :deep(h2) { font-size: 1.15em; }
      :deep(h3) { font-size: 1.05em; }

      :deep(p) {
        margin-top: 0;
        margin-bottom: 0.3em;
        &:last-child { margin-bottom: 0; }
        &:empty { display: none; }
      }

      // 段落紧跟列表/表格 → 标题与内容紧贴
      :deep(p:has(+ ul)), :deep(p:has(+ ol)), :deep(p:has(+ table)) {
        margin-bottom: 0.05em;
      }

      :deep(strong) {
        font-weight: 600;
        color: #0f172a;
      }

      :deep(ul),
      :deep(ol) {
        margin-top: 0;
        margin-bottom: 0.3em;
        padding-left: 24px;
      }
      :deep(li) {
        margin-bottom: 0.15em;
        line-height: 1.5;
        &::marker { color: #94a3b8; }
      }

      :deep(blockquote) {
        margin: 0.6em 0;
        padding: 10px 14px;
        color: #475569;
        background: #f8fafc;
        border-left: 4px solid #e2e8f0;
        border-radius: 0 8px 8px 0;

        p {
          margin-bottom: 0;
        }
      }

      :deep(code) {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
          'Courier New', monospace;
        font-size: 0.875em;
        padding: 0.2em 0.4em;
        background-color: #f1f5f9;
        color: #dc2626;
        border-radius: 4px;
      }

      :deep(pre) {
        margin: 0.6em 0;
        padding: 14px;
        background-color: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        overflow-x: auto;

        code {
          background-color: transparent;
          padding: 0;
          color: #334155;
          font-size: 0.85em;
        }
      }

      :deep(table) {
        width: 100%;
        margin: 0.6em 0;
        border-collapse: separate;
        border-spacing: 0;
        border-radius: 8px;
        overflow: hidden;
        border: 1px solid #e2e8f0;
        font-size: 0.95em;

        th,
        td {
          padding: 10px 14px;
          text-align: left;
          border-bottom: 1px solid #f1f5f9;
        }

        tr:last-child td {
          border-bottom: none;
        }

        th {
          background-color: #f8fafc;
          font-weight: 600;
          color: #475569;
          font-size: 0.9em;
        }

        tbody tr {
          background-color: #ffffff;
          &:nth-child(even) {
            background-color: #fafbfc;
          }
        }
      }
    }

    .exec-charts {
      margin: 8px 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .exec-chart-item {
      width: 100%;
      min-height: 300px;
    }

    .exec-follow {
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px solid #f1f5f9;

      .exec-follow-title {
        font-size: 13px;
        color: #64748b;
        margin-bottom: 12px;
        font-weight: 500;
      }

      .exec-follow-bubbles {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .exec-follow-chip {
        background: #ffffff;
        color: #0ea5e9;
        border: 1px solid #e0f2fe;
        font-size: 13px;
        transition: all 0.2s ease;

        &:hover {
          background: #f0f9ff;
          border-color: #bae6fd;
        }
      }
    }

    .streaming-cursor {
      display: inline-block;
      width: 6px;
      height: 15px;
      background: #3b82f6; /* Modern Blue */
      border-radius: 3px;
      margin-left: 4px;
      vertical-align: baseline;
      animation: smoothBlink 1s infinite;
      position: relative;
      top: 2px;
    }
  }

  @keyframes smoothBlink {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.1;
    }
  }

  @keyframes softPulse {
    0% {
      opacity: 0.6;
    }
    100% {
      opacity: 1;
    }
  }
</style>
