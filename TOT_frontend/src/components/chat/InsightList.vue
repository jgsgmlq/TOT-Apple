<template>
  <div v-if="items.length" class="insight-list">
    <div
      v-for="(p, i) in items" :key="i"
      class="insight-item"
      :class="'insight-' + getLevel(p)"
    >
      <span class="insight-icon">{{ getIcon(p) }}</span>
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
function getIcon(p: string | { level: string; text: string }) {
  const l = getLevel(p);
  return l === 'warning' ? '⚠️' : l === 'positive' ? '✅' : 'ℹ️';
}
function getText(p: string | { level: string; text: string }) {
  return typeof p === 'string' ? p : (p.text || '');
}
</script>

<style lang="less" scoped>
.insight-list { margin-bottom: 12px; }
.insight-item {
  padding: 8px 10px; margin-bottom: 4px; border-radius: 6px; font-size: 13px;
  border-left: 3px solid;
  &.insight-warning { background: #fff3e0; border-color: #e65100; }
  &.insight-info { background: #e3f2fd; border-color: #1565c0; }
  &.insight-positive { background: #e8f5e9; border-color: #2e7d32; }
}
.insight-icon { margin-right: 6px; }
</style>
