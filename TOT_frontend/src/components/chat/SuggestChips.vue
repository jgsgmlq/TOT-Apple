<template>
  <div v-if="items.length" class="suggest-chips">
    <span class="suggest-title">继续追问</span>
    <div class="chips-wrap">
      <span
        v-for="(s, i) in items" :key="i"
        class="chip"
        @click="$emit('select', s)"
      >{{ s }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ items: string[] }>();
defineEmits<{ select: [text: string] }>();
</script>

<style lang="less" scoped>
.suggest-chips { margin-top: 16px; }
.suggest-title { font-size: 11px; color: #8f99a8; margin-bottom: 8px; display: block; font-weight: 600; }
.chips-wrap { display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
  flex-shrink: 0; background: #f8f9fb; padding: 8px 16px; border-radius: 6px;
  font-size: 13px; cursor: pointer; transition: all .15s; color: #5f6b7a;
  border: 1px solid #e2e6ed;
  &:hover { background: #eff3ff; border-color: #2563eb; color: #2563eb; }
}
</style>
