'use strict';

/**
 * DSML (DeepSeek Markup Language) 流式过滤缓冲。
 *
 * DeepSeek 偶尔会把 tool_calls 编码成 <｜tool_calls>...</...> 的乱码段。
 * 直接 emit 给前端会让用户看到一段乱码闪现，之后被聚合 aiMessage.content
 * 的清理代码擦掉，体验很差。
 *
 * 这里在流式 emit 阶段做 sliding-window 过滤：
 *   1. 已经收齐一对 OPEN/CLOSE → 直接从缓冲里删整段
 *   2. 看到 OPEN 但没看到 CLOSE → 只 emit OPEN 之前，OPEN 之后全留在缓冲等
 *   3. 缓冲末尾是 OPEN 的 partial 前缀（如 "<｜"）→ 留住等下一帧
 *   4. 都不是 → 整段 emit
 */

const DSML_OPEN = '<｜tool_calls>';
const DSML_CLOSE = '</｜tool_calls>';

class DsmlFilter {
  constructor() {
    this._buffer = '';
  }

  /**
   * 喂入一段增量文本，返回可安全发给前端的文本（DSML 段已移除）。
   * 可能返回空字符串（当前增量全被过滤或 hold 住）。
   */
  feed(deltaText) {
    if (typeof deltaText !== 'string' || !deltaText) return '';
    this._buffer += deltaText;
    return this._flushSafe();
  }

  /**
   * 流结束调用：排出缓冲中剩余内容。
   * 即使有未闭合的 DSML 残片也会排出（下游聚合代码会清掉）。
   */
  drain() {
    const rest = this._buffer;
    this._buffer = '';
    return rest;
  }

  // ── private ──

  _flushSafe() {
    // 1. 移除已闭合的整段（可能多段）
    while (true) {
      const o = this._buffer.indexOf(DSML_OPEN);
      if (o === -1) break;
      const c = this._buffer.indexOf(DSML_CLOSE, o);
      if (c === -1) break;
      this._buffer = this._buffer.slice(0, o) + this._buffer.slice(c + DSML_CLOSE.length);
    }
    // 2. 仅有未闭合 OPEN，flush OPEN 之前
    const dangling = this._buffer.indexOf(DSML_OPEN);
    if (dangling !== -1) {
      const safe = this._buffer.slice(0, dangling);
      this._buffer = this._buffer.slice(dangling);
      return safe;
    }
    // 3. 缓冲末尾可能是 OPEN 的 partial 前缀，hold 住
    for (let len = Math.min(DSML_OPEN.length - 1, this._buffer.length); len > 0; len--) {
      if (DSML_OPEN.startsWith(this._buffer.slice(-len))) {
        const safe = this._buffer.slice(0, -len);
        this._buffer = this._buffer.slice(-len);
        return safe;
      }
    }
    // 4. 全部 safe
    const safe = this._buffer;
    this._buffer = '';
    return safe;
  }
}

module.exports = { DsmlFilter };
