<!-- 保留占位：/hq 在路由守卫中即写入 HQ 标记并跳转 /central/board，通常不会渲染到此组件 -->
<template>
  <div class="hq-entry-fallback">正在进入总部…</div>
</template>

<script lang="ts" setup></script>

<style scoped>
  .hq-entry-fallback {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #666;
    font-size: 14px;
  }
</style>
