/**
 * POST JSON 后读取 **标准 SSE**（与智能洞察、Executive Chat 后端一致）：
 * `event: delta` | `done` | `error`，`data` 为单行 JSON。
 */
export async function streamSsePostJson(options: {
  /** 如 `/dashboard/insights`，已含 `/api/v1` 前缀由 urlPrefix/apiUrl 拼接 */
  path: string;
  body: Record<string, unknown>;
  onDelta: (parsed: unknown) => void;
  onDone: (data: unknown) => void;
  onError: (error: unknown) => void;
  /** `event: error` 且 payload 无 `message` 时使用 */
  fallbackErrorMessage?: string;
}): Promise<void> {
  const {
    path,
    body,
    onDelta,
    onDone,
    onError,
    fallbackErrorMessage = '流式请求失败',
  } = options;

  const { useUserStore } = await import('@/store/modules/user');
  const token = useUserStore().getToken;
  const { useGlobSetting } = await import('@/hooks/setting');
  const { apiUrl, urlPrefix } = useGlobSetting();

  let url = path.startsWith('/') ? path : `/${path}`;
  if (urlPrefix) url = `${urlPrefix}${url}`;
  if (apiUrl) url = `${apiUrl}${url}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      onError(new Error('无法读取流式响应（body 为空）'));
      return;
    }

    const decoder = new TextDecoder();
    let partialMessage = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = (partialMessage + chunk).split('\n');
      partialMessage = lines.pop() || '';

      let currentEvent = 'message';
      for (let line of lines) {
        line = line.trim();
        if (!line) {
          currentEvent = 'message';
          continue;
        }

        if (line.startsWith('event:')) {
          currentEvent = line.replace(/^event:\s*/, '').trim();
        } else if (line.startsWith('data:')) {
          const dataStr = line.replace(/^data:\s*/, '').trim();
          if (dataStr === '[DONE]') continue;

          try {
            const parsed = JSON.parse(dataStr) as Record<string, unknown>;
            if (currentEvent === 'delta') {
              onDelta(parsed);
            } else if (currentEvent === 'done') {
              const resultData =
                parsed.data !== undefined ? parsed.data : parsed;
              onDone(resultData);
            } else if (currentEvent === 'error') {
              const msg =
                typeof parsed.message === 'string'
                  ? parsed.message
                  : fallbackErrorMessage;
              onError(new Error(msg));
              return;
            }
          } catch {
            /* 忽略不完整 JSON */
          }
        }
      }
    }
  } catch (error) {
    onError(error);
  }
}
