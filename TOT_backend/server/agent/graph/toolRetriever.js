'use strict';

/**
 * 轻量 BM25 检索 — 用于 ToolRetrieve 节点的 Top-K 工具召回。
 *
 * 中文分词策略：字符 bigram（如 "完成率" → "完成", "成率"）。对长描述足够；
 * 不引入 jieba/nodejieba 这类需要本地词典或原生扩展的依赖。
 *
 * 用法：
 *   const idx = new BM25Index([{ id: 'getOverviewData', text: '查询...' }, ...]);
 *   const ranked = idx.score('查询完成率');  // [{ id, score }, ...] 降序
 */

const CHINESE_RE = /[一-龥]/;

const tokenize = (text) => {
  if (!text) return [];
  const lower = String(text).toLowerCase();
  const tokens = [];

  // ASCII 单词（保留下划线、数字）
  const wordRe = /[a-z][a-z0-9_]*/g;
  let m;
  while ((m = wordRe.exec(lower)) !== null) {
    if (m[0].length >= 2) tokens.push(m[0]);
  }

  // 中文：把非汉字字符替换成空白，然后对每个汉字段做 bigram
  const chineseChunks = lower.replace(/[^一-龥]+/g, ' ').split(/\s+/).filter(Boolean);
  for (const chunk of chineseChunks) {
    if (chunk.length === 1) {
      tokens.push(chunk);
    } else {
      for (let i = 0; i < chunk.length - 1; i++) tokens.push(chunk.slice(i, i + 2));
    }
  }
  return tokens;
};

class BM25Index {
  constructor(docs, opts = {}) {
    this.k1 = opts.k1 ?? 1.5;
    this.b = opts.b ?? 0.75;

    this.docs = (docs || []).map(d => {
      const tokens = tokenize(d.text);
      const tf = Object.create(null);
      for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
      return { id: d.id, len: tokens.length, tf };
    });

    this.N = this.docs.length;
    this.avgLen = this.N > 0
      ? this.docs.reduce((s, d) => s + d.len, 0) / this.N
      : 1;

    this.df = Object.create(null);
    for (const d of this.docs) {
      for (const t of Object.keys(d.tf)) this.df[t] = (this.df[t] || 0) + 1;
    }
  }

  score(query) {
    const qTokens = tokenize(query);
    if (qTokens.length === 0 || this.N === 0) return [];

    const results = this.docs.map(d => {
      let s = 0;
      for (const t of qTokens) {
        const tf = d.tf[t] || 0;
        if (tf === 0) continue;
        const df = this.df[t] || 0;
        const idf = Math.log(1 + (this.N - df + 0.5) / (df + 0.5));
        const denom = tf + this.k1 * (1 - this.b + this.b * (d.len / this.avgLen));
        s += idf * (tf * (this.k1 + 1)) / denom;
      }
      return { id: d.id, score: s };
    });

    return results.sort((a, b) => b.score - a.score);
  }
}

module.exports = { BM25Index, tokenize };
