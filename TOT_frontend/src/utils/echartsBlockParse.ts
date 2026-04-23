/**
 * LLM 在 ```echarts 围栏内常输出「类 JSON」：含 function / => 等，JSON.parse 会失败。
 * 在字符串字面量外将属性值里的 function / 箭头函数替换为 null，再交给 repairJson + JSON.parse。
 */

import type { ChartData } from '@/types/chat';

import { repairJson } from './jsonRepair';

function stripFunctionExpressionsFromJsonLike(raw: string): string {
  const s = raw;
  let out = '';
  let i = 0;
  let inString = false;
  let stringChar = '';

  const skipString = (start: number): number => {
    const q = s[start];
    let k = start + 1;
    while (k < s.length) {
      const c = s[k];
      if (c === '\\' && k + 1 < s.length) {
        k += 2;
        continue;
      }
      if (c === q) return k + 1;
      k++;
    }
    return s.length;
  };

  while (i < s.length) {
    const ch = s[i];

    if (!inString && (ch === '"' || ch === "'")) {
      inString = true;
      stringChar = ch;
      out += ch;
      i++;
      continue;
    }

    if (inString) {
      if (ch === '\\' && i + 1 < s.length) {
        out += ch + s[i + 1];
        i += 2;
        continue;
      }
      out += ch;
      if (ch === stringChar) {
        inString = false;
      }
      i++;
      continue;
    }

    const rest = s.slice(i);

    const fnMatch = rest.match(/^:\s*(async\s+)?function\s*\(/);
    if (fnMatch) {
      let j = i + fnMatch[0].length;
      while (j < s.length && s[j] !== ')') j++;
      if (j >= s.length || s[j] !== ')') {
        out += ch;
        i++;
        continue;
      }
      j++;
      while (j < s.length && /\s/.test(s[j])) j++;
      if (j >= s.length || s[j] !== '{') {
        out += ch;
        i++;
        continue;
      }
      let depth = 0;
      let k = j;
      for (; k < s.length; k++) {
        const c = s[k];
        if (c === '"' || c === "'") {
          k = skipString(k) - 1;
          continue;
        }
        if (c === '{') depth++;
        else if (c === '}') {
          depth--;
          if (depth === 0) {
            k++;
            break;
          }
        }
      }
      out += ': null';
      i = k;
      continue;
    }

    const arrowBlock = rest.match(/^:\s*(\([^)]*\)|[a-zA-Z_$][\w$]*)\s*=>\s*/);
    if (arrowBlock) {
      let j = i + arrowBlock[0].length;
      while (j < s.length && /\s/.test(s[j])) j++;
      if (j < s.length && s[j] === '{') {
        let depth = 0;
        let k = j;
        for (; k < s.length; k++) {
          const c = s[k];
          if (c === '"' || c === "'") {
            k = skipString(k) - 1;
            continue;
          }
          if (c === '{') depth++;
          else if (c === '}') {
            depth--;
            if (depth === 0) {
              k++;
              break;
            }
          }
        }
        out += ': null';
        i = k;
        continue;
      }
      let k = j;
      while (k < s.length && s[k] !== ',' && s[k] !== '}' && s[k] !== ']' && s[k] !== '\n') k++;
      out += ': null';
      i = k;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

export function parseEchartsBlockContent(jsonStr: string): unknown | null {
  const trimmed = (jsonStr || '').trim();
  if (!trimmed) return null;

  const tryParse = (s: string) => JSON.parse(repairJson(s));

  try {
    return tryParse(trimmed);
  } catch {
    try {
      return tryParse(stripFunctionExpressionsFromJsonLike(trimmed));
    } catch {
      return null;
    }
  }
}

const ALLOWED_TYPES = new Set<ChartData['type']>(['bar', 'line', 'pie', 'scatter']);

/** 将 LLM 输出的简化 ChartData 或原生 ECharts option 规范化为 AiChartRenderer 所需结构 */
export function normalizeToChartData(parsed: unknown): ChartData | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;

  if (typeof o.type === 'string' && ALLOWED_TYPES.has(o.type as ChartData['type']) && Array.isArray(o.series)) {
    return o as ChartData;
  }

  if (!Array.isArray(o.series) || o.series.length === 0) return null;

  const first = o.series[0] as Record<string, unknown>;
  const seriesType = first?.type;
  if (typeof seriesType !== 'string' || !ALLOWED_TYPES.has(seriesType as ChartData['type'])) return null;

  const titleRaw = o.title;
  let title: string | undefined;
  if (typeof titleRaw === 'string') title = titleRaw;
  else if (titleRaw && typeof titleRaw === 'object' && titleRaw !== null && 'text' in titleRaw) {
    const t = (titleRaw as { text?: unknown }).text;
    title = typeof t === 'string' ? t : undefined;
  }

  let xAxis: string[] | undefined;
  const xa = o.xAxis;
  if (xa && typeof xa === 'object' && !Array.isArray(xa) && 'data' in xa) {
    const d = (xa as { data?: unknown }).data;
    if (Array.isArray(d) && d.every((x) => typeof x === 'string')) xAxis = d as string[];
  } else if (Array.isArray(xa) && xa.every((x) => typeof x === 'string')) {
    xAxis = xa as string[];
  }

  const series = (o.series as unknown[]).map((item) => {
    const si = item as Record<string, unknown>;
    return {
      name: typeof si.name === 'string' ? si.name : '',
      data: Array.isArray(si.data) ? (si.data as (number | number[])[]) : [],
    };
  });

  return {
    type: seriesType as ChartData['type'],
    title,
    xAxis,
    series,
    disclaimer: typeof o.disclaimer === 'string' ? o.disclaimer : undefined,
  };
}
