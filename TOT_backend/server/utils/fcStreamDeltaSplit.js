'use strict';

/**
 * FC 流式：依据如下优先级找出「思考前言 → 正文」的分界：
 * 1) `` ```json ``（结构化回复）围栏位置；
 * 2) 裸 `replyContent` JSON 起始 `{`；
 * 3) 正文直接以 Markdown 标记起始（`#` / `|` / `` ``` ``（非 json）/ `- *` / 有序列表）；
 * 4) 前言段后首次 **空行**（视为段落分隔）即分界。
 *
 * 分界前为 **思考**（`phase: reasoning`），分界及之后为 **正文**（`phase: content`）。
 * 与前端 {@link splitPreambleAndJson}、{@link execStreamStateToPayload} 协同工作。
 */

function findFcPreambleSplitIndex(s) {
  if (!s || typeof s !== 'string') return -1;

  // 1) 结构化 JSON 围栏
  const jsonFenceIdx = s.search(/```\s*json/i);
  if (jsonFenceIdx !== -1) return jsonFenceIdx;

  const tLead = s.trimStart();
  const leadingOffset = s.length - tLead.length;

  // 2) 裸 replyContent 形 JSON
  if (tLead.startsWith('{') && /"(overview|keyNumbers)"/.test(tLead.slice(0, 400))) {
    return leadingOffset;
  }

  // 3) 正文直接以 Markdown 标记起始
  if (/^(#{1,6}\s|\||```[a-z]*\s|[-*]\s|\d+\.\s)/i.test(tLead)) {
    return leadingOffset;
  }
  // 3b) 流式传输中开头可能是孤立的 #/##/###（还没收到空格和后续文本），不切分
  if (/^#{1,6}$/.test(tLead.trim())) {
    return -1;
  }

  // 4) 思考前言后首个空行
  const blank = s.match(/\n[ \t]*\n/);
  if (blank && typeof blank.index === 'number') {
    return blank.index + blank[0].length;
  }

  return -1;
}

/**
 * 把 `delta.content` 流按 `findFcPreambleSplitIndex` 的分界拆成两段并分别以 `phase: reasoning`/`content` 转发。
 * 已找到过分界后 **不再回退**（即使后续又出现新的空行，也一律视作正文）。
 *
 * @param {(text: string, meta?: { phase?: string, text?: string }) => void} onDelta
 */
function createFcStreamDeltaSplitter(onDelta) {
  let acc = '';
  let forwarded = 0;
  let splitIdx = -1;

  return (chunk, meta) => {
    if (!onDelta) return;
    const ph = meta && meta.phase;
    if (ph === 'reasoning') {
      onDelta(chunk, meta);
      return;
    }
    if (ph === 'tool_start' || ph === 'tool_end') {
      onDelta(chunk, meta);
      return;
    }
    if (chunk == null || chunk === '') {
      onDelta(chunk, meta);
      return;
    }

    acc += chunk;
    if (splitIdx === -1) {
      splitIdx = findFcPreambleSplitIndex(acc);
    }

    if (splitIdx === -1) {
      // 未找到分界时，向前 emit；但保留尾部可能是 markdown 标题前缀的片段（如 #、##）
      const pending = acc.slice(forwarded);
      const lastLine = pending.split(/\n/).pop();
      const trailMatch = lastLine.match(/^\s*#{1,6}$/);
      if (trailMatch) {
        const idx = pending.length - trailMatch[0].length;
        if (idx > 0) {
          onDelta(pending.slice(0, idx), { phase: 'reasoning' });
          forwarded += idx;
        }
      } else {
        if (pending) onDelta(pending, { phase: 'reasoning' });
        forwarded = acc.length;
      }
      return;
    }

    if (forwarded < splitIdx) {
      const piece = acc.slice(forwarded, splitIdx);
      if (piece) onDelta(piece, { phase: 'reasoning' });
      forwarded = splitIdx;
    }
    if (forwarded < acc.length) {
      const piece = acc.slice(forwarded);
      if (piece) onDelta(piece, { phase: 'content' });
      forwarded = acc.length;
    }
  };
}

module.exports = { findFcPreambleSplitIndex, createFcStreamDeltaSplitter };
