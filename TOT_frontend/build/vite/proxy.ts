/**
 * Used to parse the .env.development proxy configuration
 */
import type { ProxyOptions } from 'vite';
import type { Server as HttpProxyServer } from 'http-proxy';

/**
 * Vite 开发代理在 WebSocket 正常关闭时仍常打印 `read ECONNRESET`，属 TCP 半关闭噪声。
 * 对常见可恢复错误静默，其它错误仍输出。
 */
export function quietWebSocketProxyErrors(): NonNullable<ProxyOptions['configure']> {
  return (proxy: HttpProxyServer) => {
    proxy.on('error', (err: NodeJS.ErrnoException) => {
      const c = err?.code;
      if (c === 'ECONNRESET' || c === 'EPIPE' || c === 'ECONNABORTED') return;
      console.error('[vite-proxy]', err);
    });
    proxy.on('proxyReqWs', (_proxyReq, _req, socket) => {
      socket?.on?.('error', (err: NodeJS.ErrnoException) => {
        const c = err?.code;
        if (c === 'ECONNRESET' || c === 'EPIPE' || c === 'ECONNABORTED') return;
        console.error('[vite-proxy] ws socket', err);
      });
    });
  };
}

type ProxyItem = [string, string];

type ProxyList = ProxyItem[];

type ProxyTargetList = Record<string, ProxyOptions & { rewrite: (path: string) => string }>;

const httpsRE = /^https:\/\//;

/**
 * Generate proxy
 * @param list
 */
export function createProxy(list: ProxyList = []) {
  const ret: ProxyTargetList = {};
  for (const [prefix, target] of list) {
    const isHttps = httpsRE.test(target);

    // https://github.com/http-party/node-http-proxy#options
    ret[prefix] = {
      target: target,
      changeOrigin: true,
      ws: true,
      rewrite: (path) => path.replace(new RegExp(`^${prefix}`), ''),
      // https is require secure=false
      ...(isHttps ? { secure: false } : {}),
    };
  }
  return ret;
}
