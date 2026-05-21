<template>
  <div v-if="items.length" class="insight-list">
    <div
      v-for="(p, i) in items" :key="i"
      class="insight-item"
      :class="'insight-' + getLevel(p)"
    >
      <span class="insight-marker"></span>
      <span class="insight-text">{{ getText(p) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  items: Array<string | { level: 'warning' | 'info' | 'positive'; text: string }>;
}>();

function getLevel(p: string | { level: string; text: string }) {
  return typeof p === 'string' ? 'info' : (p.level || 'info');
}
function getText(p: string | { level: string; text: string }) {
  return typeof p === 'string' ? p : (p.text || '');
}
</script>

<style lang="less" scoped>
.insight-list { margin-bottom: 16px; display: flex; flex-direction: column; gap: 6px; }
.insight-item {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 12px 16px; font-size: 13px; line-height: 1.5;
  border-radius: 6px;
  &.insight-warning { background: #fef4e6; }
  &.insight-info { background: #f8f9fb; }
  &.insight-positive { background: #ecfdf5; }
}
.insight-marker {
  flex-shrink: 0;
  width: 7px; height: 7px; border-radius: 50%; margin-top: 5px;
  .insight-warning & { background: #d97706; }
  .insight-info & { background: #2563eb; }
  .insight-positive & { background: #059669; }
}
.insight-text { color: #1a1f36; }
</style>
