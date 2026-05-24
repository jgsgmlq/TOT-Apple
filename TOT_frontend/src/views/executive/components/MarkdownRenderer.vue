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
      <div class="exec-follow-title">继续追问</div>
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
    line-height: 1.65;
    word-break: break-word;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    color: #1a1f36;

    .reasoning-box {
      margin-bottom: 16px;
      background: transparent;

      .reasoning-header {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 4px 10px;
        background: #f1f3f6;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 500;
        color: #8f99a8;
        cursor: pointer;
        user-select: none;
        transition: background 0.2s ease, color 0.2s ease;

        &:hover {
          background: #e2e6ed;
          color: #5f6b7a;
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
        padding-left: 4px;
      }

      .reasoning-content {
        padding: 12px 16px;
        font-size: 13px;
        color: #5f6b7a;
        background: #f8f9fb;
        white-space: pre-wrap;
        line-height: 1.6;
        border-radius: 6px;
        margin-top: 8px;
      }
    }

    .markdown-body {
      font-size: 15px;
      line-height: 1.7;

      :deep(p) {
        margin-top: 0;
        margin-bottom: 0.75em;
        line-height: 1.7;
        &:last-child { margin-bottom: 0; }
      }

      :deep(strong) {
        font-weight: 600;
        color: #1a1f36;
      }

      :deep(h1), :deep(h2), :deep(h3), :deep(h4) {
        color: #1a1f36;
        line-height: 1.4;
      }

      /* Lists */
      :deep(ul), :deep(ol) {
        margin-top: 0; margin-bottom: 0.75em; padding-left: 24px;
        line-height: 1.7;
        li { margin-bottom: 0.25em; line-height: 1.7;
          &::marker { color: #8f99a8; }
        }
      }

      /* Blockquotes */
      :deep(blockquote) {
        margin: 1em 0; padding: 12px 16px;
        color: #5f6b7a; background: #f8f9fb;
        border-radius: 6px;
        p { margin-bottom: 0; }
      }

      /* Inline Code & Code Blocks */
      :deep(code) {
        font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
        font-size: 0.9em;
        padding: 0.05em 0.3em;
        vertical-align: baseline;
        background-color: #f1f3f6;
        color: #dc2626;
        border-radius: 3px;
      }

      :deep(pre) {
        margin: 1em 0; padding: 16px;
        background-color: #f8f9fb;
        border: 1px solid #e2e6ed;
        border-radius: 6px; overflow-x: auto;
        code {
          background-color: transparent; padding: 0;
          color: #1a1f36; font-size: 0.85em;
        }
      }

      /* Tables */
      :deep(table) {
        width: 100%; margin: 1.5em 0;
        border-collapse: separate; border-spacing: 0;
        border-radius: 6px; overflow: hidden;
        border: 1px solid #e2e6ed;

        th, td {
          padding: 10px 16px; text-align: left;
          line-height: 1.6; font-size: 14px;
          border-bottom: 1px solid #e2e6ed;
          border-right: 1px solid #e2e6ed;
          &:last-child { border-right: none; }
        }
        tr:last-child td { border-bottom: none; }
        th {
          background-color: #f8f9fb;
          font-weight: 600; color: #5f6b7a;
          font-size: 11px;
        }
        tbody tr {
          background-color: #ffffff;
          &:nth-child(even) { background-color: #fafbfc; }
        }
      }
    }

    .exec-charts {
      margin: 20px 0;
      display: flex; flex-direction: column; gap: 16px;
    }

    .exec-chart-item {
      background: #ffffff;
      border-radius: 6px; padding: 20px;
      border: 1px solid #e2e6ed;
    }

    .exec-follow {
      margin-top: 24px; padding-top: 16px;
      border-top: 1px solid #e2e6ed;

      .exec-follow-title {
        font-size: 12px; color: #5f6b7a;
        margin-bottom: 12px; font-weight: 600;
      }

      .exec-follow-bubbles {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .exec-follow-chip {
        background: #f8f9fb;
        color: #5f6b7a;
        border: 1px solid #e2e6ed;
        font-size: 13px;
        transition: all 0.2s ease;
        &:hover { background: #eff3ff; border-color: #2563eb; color: #2563eb; }
      }
    }

    .streaming-cursor {
      display: inline-block;
      width: 6px; height: 15px;
      background: #2563eb;
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
