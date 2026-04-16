import { ref, nextTick } from 'vue';

/** 与 layout 内 #layout-fullscreen-teleport 同步；全屏 content 时弹层必须挂在此节点内，否则不可见 */
export const overlayTeleportTarget = ref<string | HTMLElement>('body');

export function resolveOverlayTeleportTarget() {
  nextTick(() => {
    const el = document.getElementById('layout-fullscreen-teleport');
    overlayTeleportTarget.value = el ?? document.body;
  });
}
