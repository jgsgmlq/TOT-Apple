<template>
  <div class="exec-chat-ai-root">
    <div v-if="thinking" class="exec-thinking-wrap">
      <n-collapse :default-expanded-names="['think']">
        <n-collapse-item title="思考过程" name="think">
          <div class="exec-thinking-body">{{ thinking }}</div>
        </n-collapse-item>
      </n-collapse>
    </div>

    <div
      v-if="replyContent || partialReply"
      class="exec-structured"
      :class="{ 'exec-structured--stream': !replyContent && !!partialReply }"
    >
      <p class="exec-overview">{{ (replyContent || partialReply)!.overview }}</p>
      <div v-if="(replyContent || partialReply)!.keyNumbers?.length" class="exec-keynums">
        <div
          v-for="(kn, ki) in (replyContent || partialReply)!.keyNumbers"
          :key="ki"
          class="exec-keynum-row"
        >
          <span class="exec-k-label">{{ kn.label }}</span>
          <span class="exec-k-value">{{ kn.value }}{{ kn.unit || '' }}</span>
        </div>
      </div>
      <ul v-if="(replyContent || partialReply)!.attentionPoints?.length" class="exec-attn">
        <li v-for="(ap, ai) in (replyContent || partialReply)!.attentionPoints" :key="ai">
          {{ ap }}
        </li>
      </ul>
      <div v-if="(replyContent || partialReply)!.followUpSuggestions?.length" class="exec-follow">
        💡 {{ (replyContent || partialReply)!.followUpSuggestions!.join(' / ') }}
      </div>
    </div>
    <pre v-else-if="jsonStream" class="exec-json-fallback">{{ jsonStream }}</pre>
    <div v-else-if="content" class="exec-plain">{{ content }}</div>
  </div>
</template>

<script lang="ts" setup>
  import type { ReplyContent } from '@/api/chat';

  defineProps<{
    thinking?: string;
    partialReply?: ReplyContent | null;
    replyContent?: ReplyContent | null;
    jsonStream?: string;
    content?: string;
  }>();
</script>

<style lang="less" scoped>
  .exec-chat-ai-root {
    width: 100%;
  }

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

    .exec-attn {
      margin: 0 0 12px;
      padding-left: 18px;
      color: #b45309;
      font-size: 14px;
    }

    .exec-follow {
      font-size: 13px;
      color: rgba(0, 0, 0, 0.55);
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
</style>
