<template>
  <div v-if="items.length" class="suggest-chips">
    <span class="suggest-title">💡 建议追问：</span>
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
.suggest-chips { margin-top: 8px; }
.suggest-title { font-size: 12px; color: #888; margin-bottom: 6px; display: block; }
.chips-wrap { display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
  flex-shrink: 0; background: #e8eaf6; padding: 6px 14px; border-radius: 16px;
  font-size: 12px; cursor: pointer; transition: background .15s;
  &:hover { background: #c5cae9; }
}
</style>
