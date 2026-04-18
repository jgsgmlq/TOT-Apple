import type { UserConfig, ConfigEnv, Plugin } from 'vite';
import { loadEnv } from 'vite';
import { resolve } from 'path';

/** 开发时提醒：必须用终端里 Network 行显示的 IP，否则会连错机器无响应 */
function devLanAccessHint(): Plugin {
  return {
    name: 'tot-dev-lan-hint',
    apply: 'serve',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        console.log(
          '\n\x1b[33m[TOT]\x1b[0m 手机/其它设备请使用上面 \x1b[32mNetwork\x1b[0m 行的地址（含端口）。\x1b[31m不要使用未在终端显示的 IP\x1b[0m，否则会一直加载、无报错。\n'
        );
      });
    },
  };
}
import { wrapperEnv } from './build/utils';
import { createVitePlugins } from './build/vite/plugin';
import { OUTPUT_DIR } from './build/constant';
import { createProxy, quietWebSocketProxyErrors } from './build/vite/proxy';
import pkg from './package.json';
import { format } from 'date-fns';
const { dependencies, devDependencies, name, version } = pkg;

const __APP_INFO__ = {
  pkg: { dependencies, devDependencies, name, version },
  lastBuildTime: format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
};

function pathResolve(dir: string) {
  return resolve(process.cwd(), '.', dir);
}

export default ({ command, mode }: ConfigEnv): UserConfig => {
  const root = process.cwd();
  const env = loadEnv(mode, root);
  const viteEnv = wrapperEnv(env);
  const { VITE_PUBLIC_PATH, VITE_PORT, VITE_PROXY } = viteEnv;
  const funnelDev =
    env.VITE_FUNNEL_MODE === 'true' || env.VITE_FUNNEL_MODE === '1';
  const isBuild = command === 'build';
  const plugins = [...createVitePlugins(viteEnv, isBuild), ...(isBuild ? [] : [devLanAccessHint()])];
  /** 与 dev 一致；preview（build + preview:dist + Funnel）也必须代理 API，否则 /api/v1 会打到静态服务器 404 */
  const apiProxy = {
    ...createProxy(VITE_PROXY),
    '/api/v1': {
      target: 'http://127.0.0.1:3000',
      changeOrigin: true,
      ws: true,
    },
    '/ws/tts': {
      target: 'http://127.0.0.1:3000',
      changeOrigin: true,
      ws: true,
      configure: quietWebSocketProxyErrors(),
    },
    '/ws': {
      target: 'http://127.0.0.1:3000',
      changeOrigin: true,
      ws: true,
      configure: quietWebSocketProxyErrors(),
    },
  };
  return {
    base: VITE_PUBLIC_PATH,
    esbuild: {},
    resolve: {
      alias: [
        {
          find: /\/#\//,
          replacement: pathResolve('types') + '/',
        },
        {
          find: '@',
          replacement: pathResolve('src') + '/',
        },
      ],
      dedupe: ['vue'],
    },
    plugins,
    define: {
      __APP_ENV__: JSON.stringify(env.APP_ENV),
      __APP_INFO__: JSON.stringify(__APP_INFO__),
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
    },
    server: {
      host: true,
      port: VITE_PORT,
      // 经 Tailscale Funnel（HTTPS 公网 → 本机 8001）时，Vite HMR 的 WebSocket 常无法对齐端口/协议，首屏会长时间卡在 loading；关闭 HMR 只影响热更新
      hmr: funnelDev ? false : undefined,
      proxy: apiProxy,
      // 开发环境允许任意 Host（localhost、127.0.0.1、局域网 IP、*.ts.net Funnel、*.local 机器名等），避免误拦
      allowedHosts: true,
    },
    preview: {
      host: true,
      allowedHosts: true,
      proxy: apiProxy,
    },
    optimizeDeps: {
      include: [],
      exclude: ['vue-demi'],
    },
    build: {
      target: 'es2020',
      cssTarget: 'chrome80',
      outDir: OUTPUT_DIR,
      reportCompressedSize: false,
      chunkSizeWarningLimit: 2000,
      // 构建分包策略
      rollupOptions: {
        output: {
          manualChunks: {
            'naive-ui': ['naive-ui'],
            'lodash-es': ['lodash-es'],
            'vue-router': ['vue-router'],
            'vue-quill': ['@vueup/vue-quill'],
            'vicons-antd': ['@vicons/antd'],
            'vicons-ionicons5': ['@vicons/ionicons5'],
            vuedraggable: ['vuedraggable'],
            echarts: ['echarts'],
            vueuse: ['@vueuse/core'],
            vue: ['vue'],
            pinia: ['pinia'],
          },
        },
      },
    },
  };
};
