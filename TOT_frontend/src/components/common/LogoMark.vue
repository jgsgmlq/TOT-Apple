<template>
  <img src="@/assets/icons/opsforge-logo.png" alt="Ops Forge" class="logo-mark" :class="{ 'logo-mark--compact': compact }" />
</template>

<script setup lang="ts">
defineProps<{ compact?: boolean }>();
</script>

<style lang="less" scoped>
.logo-mark {
  width: 32px;
  height: 32px;
  object-fit: contain;
  user-select: none;

  &--compact {
    width: 28px;
    height: 28px;
  }
}
</style>
