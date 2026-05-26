<template>
  <div v-if="items.length" class="key-grid">
    <div
      v-for="k in items" :key="k.label"
      class="key-cell"
    >
      <span class="key-value" :style="{ color: cellColor(k) }">
        {{ k.value }}<small v-if="k.unit" class="key-unit">&nbsp;{{ k.unit }}</small>
      </span>
      <span v-if="k.trend && k.trend !== 'flat'" class="key-trend" :class="'trend-' + k.trend">
        {{ trendIcon(k.trend) }} {{ k.trendValue || '' }}
      </span>
      <span class="key-label">{{ k.label }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  items: Array<{ label: string; value: string | number; unit?: string; trend?: 'up' | 'down' | 'flat'; trendValue?: string }>;
}>();

function trendIcon(t: string) {
  if (t === 'up') return '↑';
  if (t === 'down') return '↓';
  return '→';
}

function cellColor(k: { label: string; value: string | number }) {
  if (k.label.includes('完成') && !k.label.includes('未')) return '#059669';
  if (k.label.includes('未完成') || k.label.includes('预警')) return '#dc2626';
  return '#1a1f36';
}
</script>

<style lang="less" scoped>
.key-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
  gap: 8px;
  margin-bottom: 20px;
}
.key-cell {
  text-align: center;
  padding: 16px 12px;
  background: #f8f9fb;
  border-radius: 6px;
}
.key-value {
  display: block;
  font-size: 26px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.5px;
}
.key-unit {
  font-size: 13px;
  color: #8f99a8;
  font-weight: 400;
}
.key-trend {
  display: block;
  font-size: 12px;
  font-weight: 500;
  margin-top: 2px;
  &.trend-up { color: #059669; }
  &.trend-down { color: #dc2626; }
}
.key-label {
  display: block;
  font-size: 11px;
  color: #8f99a8;
  margin-top: 4px;
  font-weight: 500;
}
</style>
