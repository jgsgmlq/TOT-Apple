<template>
  <n-dialog-provider :to="overlayTeleportTarget">
    <n-notification-provider :to="overlayTeleportTarget">
      <n-message-provider :to="overlayTeleportTarget">
        <slot name="default"></slot>
      </n-message-provider>
    </n-notification-provider>
  </n-dialog-provider>
</template>

<script lang="ts" setup>
  import { onMounted, onBeforeUnmount, watch } from 'vue';
  import { useRoute } from 'vue-router';
  import { NDialogProvider, NNotificationProvider, NMessageProvider } from 'naive-ui';
  import { overlayTeleportTarget, resolveOverlayTeleportTarget } from '@/utils/overlayTeleport';

  const route = useRoute();

  onMounted(() => {
    resolveOverlayTeleportTarget();
    document.addEventListener('fullscreenchange', resolveOverlayTeleportTarget);
  });

  watch(() => route.fullPath, resolveOverlayTeleportTarget);

  onBeforeUnmount(() => {
    document.removeEventListener('fullscreenchange', resolveOverlayTeleportTarget);
  });
</script>
