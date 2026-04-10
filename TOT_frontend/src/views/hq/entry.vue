<template>
  <div class="hq-entry-fallback">
    <template v-if="showLoginError">
      <p class="hq-entry-title">无法进入总部看板</p>
      <p class="hq-entry-desc">
        静默登录未成功（请确认本机后端已启动，且已初始化 <code>central</code> 账号）。你可稍后重试。
      </p>
      <n-button type="primary" round @click="retry">重试</n-button>
    </template>
    <template v-else>正在进入总部…</template>
  </div>
</template>

<script lang="ts" setup>
  import { computed } from 'vue';
  import { useRoute, useRouter } from 'vue-router';

  const route = useRoute();
  const router = useRouter();

  const showLoginError = computed(() => {
    const q = route.query.hqError;
    return q === 'login' || q === '1' || q === 'true' || String(q || '') === 'session';
  });

  function retry() {
    router.replace({ path: '/hq' });
  }
</script>

<style scoped>
  .hq-entry-fallback {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 24px;
    text-align: center;
    color: #666;
    font-size: 14px;
  }

  .hq-entry-title {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: #1d1d1f;
  }

  .hq-entry-desc {
    margin: 0;
    max-width: 420px;
    line-height: 1.5;
    color: #6b7280;
  }

  .hq-entry-desc code {
    font-size: 12px;
    padding: 2px 6px;
    background: #f3f4f6;
    border-radius: 4px;
  }
</style>
