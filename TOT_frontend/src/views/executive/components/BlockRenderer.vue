<template>
  <div class="exec-blocks">
    <template v-for="(block, i) in blocks" :key="i">
      <MarkdownRenderer
        v-if="block.type === 'markdown'"
        :content="block.content"
        :streaming="false"
      />
      <KeyGrid
        v-else-if="block.type === 'keyNumbers'"
        :items="block.items"
      />
      <AiChartRenderer
        v-else-if="block.type === 'chart'"
        :data="resolvedChart(block)"
      />
      <TableBlock
        v-else-if="block.type === 'table'"
        :table="resolvedTable(block)"
      />
      <InsightList
        v-else-if="block.type === 'insights'"
        :items="block.items"
      />
      <SuggestChips
        v-else-if="block.type === 'suggestions'"
        :items="block.items"
        @select="(text: string) => $emit('suggestion-click', text)"
      />
      <MarkdownRenderer
        v-else
        :content="block.content || block.markdown || ''"
        :streaming="false"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import MarkdownRenderer from './MarkdownRenderer.vue';
import KeyGrid from '@/components/chat/KeyGrid.vue';
import AiChartRenderer from './AiChartRenderer.vue';
import TableBlock from '@/components/chat/TableBlock.vue';
import InsightList from '@/components/chat/InsightList.vue';
import SuggestChips from '@/components/chat/SuggestChips.vue';

interface Block {
  type: string;
  datasetId?: string;
  chartType?: string;
  title?: string;
  content?: string;
  items?: unknown[];
  [key: string]: unknown;
}

const props = defineProps<{
  blocks: Block[];
  datasets?: Record<string, { chart?: unknown; table?: unknown }>;
}>();

defineEmits<{
  (e: 'suggestion-click', text: string): void;
}>();

function resolvedChart(block: Block) {
  if (!props.datasets || !block.datasetId) return null;
  const ds = props.datasets[block.datasetId];
  if (!ds?.chart) return null;
  return {
    ...(ds.chart as Record<string, unknown>),
    type: block.chartType || (ds.chart as Record<string, unknown>).type || 'bar',
  };
}

function resolvedTable(block: Block) {
  if (!props.datasets || !block.datasetId) return null;
  const ds = props.datasets[block.datasetId];
  return ds?.table || null;
}
</script>

<style lang="less" scoped>
.exec-blocks {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
</style>
