<template>
  <div v-if="items.length" class="key-grid">
    <div
      v-for="k in items" :key="k.label"
      class="key-cell"
    >
      <span class="key-value" :style="{ color: cellColor(k) }">
        {{ k.value }}<small v-if="k.unit" style="font-size:12px;color:#888;font-weight:400;">&nbsp;{{ k.unit }}</small>
      </span>
      <span class="key-label">{{ k.label }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  items: Array<{ label: string; value: string | number; unit?: string }>;
}>();

function cellColor(k: { label: string; value: string | number }) {
  if (k.label.includes('完成') && !k.label.includes('未')) return '#2e7d32';
  if (k.label.includes('未完成')) return '#c62828';
  return '#1a1a2e';
}
</script>

<style lang="less" scoped>
.key-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
  gap: 6px;
  margin-bottom: 12px;
}
.key-cell {
  text-align: center;
  padding: 10px 4px;
  border-radius: 8px;
  background: #f8f9fa;
}
.key-value {
  display: block;
  font-size: 18px;
  font-weight: 700;
}
.key-label {
  font-size: 11px;
  color: #888;
  margin-top: 2px;
}
</style>
