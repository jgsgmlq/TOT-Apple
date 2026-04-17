import type { ReplyContent } from '@/api/chat';
import { repairJson } from './jsonRepair';

/**
 * 将 **正文 content 流**拆成：` ```json` 前的说明文字（展示在「分析说明」）与 JSON 片段。
 * 注意：与 API 的 `phase: reasoning`（思考过程）无关，二者在 UI 上分离。
 */
export function splitPreambleAndJson(raw: string): { preamble: string; jsonRaw: string } {
  const s = raw;
  const fenceRe = /```\s*json\s*\r?\n?/i;
  const idx = s.search(fenceRe);
  if (idx === -1) {
    const t = s.trimStart();
    if (t.startsWith('{') && /"(overview|keyNumbers)"/.test(t.slice(0, Math.min(400, t.length)))) {
      return { preamble: '', jsonRaw: s.trim() };
    }
    return { preamble: s, jsonRaw: '' };
  }
  const preamble = s.slice(0, idx).trim();
  let rest = s.slice(idx).replace(fenceRe, '');
  const close = rest.lastIndexOf('```');
  if (close !== -1) rest = rest.slice(0, close);
  return { preamble, jsonRaw: rest.trim() };
}

/** @deprecated 使用 splitPreambleAndJson */
export function splitThinkingAndJson(raw: string): { thinking: string; jsonRaw: string } {
  const { preamble, jsonRaw } = splitPreambleAndJson(raw);
  return { thinking: preamble, jsonRaw };
}

function normalizeKeyNumber(x: unknown): { label: string; value: string; unit?: string } {
  if (!x || typeof x !== 'object') return { label: '', value: '' };
  const o = x as Record<string, unknown>;
  const v = o.value;
  const valueStr = v === null || v === undefined ? '' : String(v);
  return {
    label: String(o.label ?? ''),
    value: valueStr,
    unit: o.unit != null ? String(o.unit) : undefined,
  };
}

/** 流式过程中若能解析完整 JSON，则用于卡片实时渲染 */
export function tryParseReplyContent(jsonRaw: string): ReplyContent | null {
  const t = jsonRaw.trim();
  if (!t.length) return null;

  let parsed: any = null;
  try {
    parsed = JSON.parse(t);
  } catch {
    try {
      const repaired = repairJson(t);
      parsed = JSON.parse(repaired);
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== 'object') return null;
  if (typeof parsed.overview !== 'string') return null;

  const keyNumbers = Array.isArray(parsed.keyNumbers)
    ? parsed.keyNumbers.map(normalizeKeyNumber).filter((k) => k.label || k.value)
    : [];
  const attentionPoints = Array.isArray(parsed.attentionPoints)
    ? parsed.attentionPoints.map((p) => String(p)).filter(Boolean)
    : [];
  const followUpSuggestions = Array.isArray(parsed.followUpSuggestions)
    ? parsed.followUpSuggestions.map((p) => String(p)).filter(Boolean)
    : [];

  return {
    overview: parsed.overview,
    keyNumbers,
    attentionPoints,
    followUpSuggestions,
    visualizationSummary: parsed.visualizationSummary ? String(parsed.visualizationSummary) : undefined,
    visualizations: Array.isArray(parsed.visualizations) ? parsed.visualizations : undefined,
    statisticsProvenance: parsed.statisticsProvenance,
    forecastDisclaimer: parsed.forecastDisclaimer ? String(parsed.forecastDisclaimer) : undefined,
  };
}

/** 从未闭合的 JSON 字符串中提取 `"overview":"..."`（支持流式未闭合引号） */
function extractStringFieldLoose(s: string, key: string): string {
  const esc = (txt: string) => txt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`"${esc(key)}"\\s*:\\s*"`, 'm');
  const m = s.match(re);
  if (!m || m.index === undefined) return '';
  let i = m.index + m[0].length;
  let out = '';
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\\') {
      out += ch + (s[i + 1] ?? '');
      i += 2;
      continue;
    }
    if (ch === '"') break;
    out += ch;
    i++;
  }
  return out;
}

/** 从数组字段中解析已完整的 `{ ... }` 元素（流式时逐条出现） */
function extractCompleteObjectsInArray(s: string, arrayKey: string): unknown[] {
  const esc = (txt: string) => txt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const head = new RegExp(`"${esc(arrayKey)}"\\s*:\\s*\\[`, 'm');
  const hm = s.match(head);
  if (!hm || hm.index === undefined) return [];
  let i = hm.index + hm[0].length;
  const out: unknown[] = [];
  let depth = 0;
  let objStart = -1;
  while (i < s.length) {
    const ch = s[i];
    if (depth === 0) {
      if (/\s|,/.test(ch)) {
        i++;
        continue;
      }
      if (ch === ']') break;
      if (ch === '{') {
        objStart = i;
        depth = 1;
        i++;
        continue;
      }
      i++;
      continue;
    }
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && objStart >= 0) {
        const chunk = s.slice(objStart, i + 1);
        try {
          out.push(JSON.parse(chunk));
        } catch {
          /* 半条对象 */
        }
        objStart = -1;
      }
    }
    i++;
  }
  return out;
}

function extractStringArrayLoose(s: string, key: string): string[] {
  const esc = (txt: string) => txt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const head = new RegExp(`"${esc(key)}"\\s*:\\s*\\[`, 'm');
  const hm = s.match(head);
  if (!hm || hm.index === undefined) return [];
  let i = hm.index + hm[0].length;
  const out: string[] = [];
  while (i < s.length) {
    while (i < s.length && /\s|,/.test(s[i])) i++;
    if (s[i] === ']') break;
    if (s[i] !== '"') break;
    i++;
    let str = '';
    while (i < s.length) {
      const ch = s[i];
      if (ch === '\\') {
        str += ch + (s[i + 1] ?? '');
        i += 2;
        continue;
      }
      if (ch === '"') {
        i++;
        break;
      }
      str += ch;
      i++;
    }
    if (str) out.push(str);
  }
  return out;
}

/**
 * 流式 JSON：优先完整 `JSON.parse`；失败则尽力提取已出现的字段，用于卡片渐进展示。
 */
export function parseReplyContentProgressive(jsonRaw: string): ReplyContent | null {
  const strict = tryParseReplyContent(jsonRaw);
  if (strict) return strict;

  const t = jsonRaw.trim();
  if (!t.length || !t.startsWith('{')) return null;

  const overview = extractStringFieldLoose(t, 'overview');
  const keyNumObjs = extractCompleteObjectsInArray(t, 'keyNumbers');
  const keyNumbers = keyNumObjs
    .map(normalizeKeyNumber)
    .filter((k) => k.label || k.value);

  const attentionPoints = extractStringArrayLoose(t, 'attentionPoints');
  const followUpSuggestions = extractStringArrayLoose(t, 'followUpSuggestions');

  const visualizations = extractCompleteObjectsInArray(t, 'visualizations') as any[];
  const forecastDisclaimer = extractStringFieldLoose(t, 'forecastDisclaimer');
  const visualizationSummary = extractStringFieldLoose(t, 'visualizationSummary');

  if (
    !overview &&
    keyNumbers.length === 0 &&
    attentionPoints.length === 0 &&
    followUpSuggestions.length === 0 &&
    visualizations.length === 0
  ) {
    return null;
  }

  return {
    overview: overview || '…',
    keyNumbers,
    attentionPoints,
    followUpSuggestions,
    visualizationSummary: visualizationSummary || undefined,
    visualizations: visualizations.length > 0 ? visualizations : undefined,
    forecastDisclaimer: forecastDisclaimer || undefined,
  };
}

/**
 * 从 Markdown 中提取特殊代码块 (echarts / suggestions)
 */
export function extractSpecialBlocks(markdown: string) {
  let cleanMarkdown = markdown || '';
  const echartsBlocks: any[] = [];
  const suggestions: string[] = [];

  // 提取 echarts 块
  const echartsRegex = /```echarts\s*([\s\S]*?)\s*```/g;
  cleanMarkdown = cleanMarkdown.replace(echartsRegex, (_, jsonStr) => {
    try {
      echartsBlocks.push(JSON.parse(jsonStr));
    } catch {
      /* ignore */
    }
    return '';
  });

  // 提取 suggestions 块
  const sugRegex = /```suggestions\s*([\s\S]*?)\s*```/g;
  cleanMarkdown = cleanMarkdown.replace(sugRegex, (_, jsonStr) => {
    try {
      const data = JSON.parse(jsonStr);
      if (Array.isArray(data)) suggestions.push(...data);
    } catch {
      /* ignore */
    }
    return '';
  });

  return {
    cleanMarkdown: cleanMarkdown.trim(),
    echartsBlocks,
    suggestions,
  };
}
