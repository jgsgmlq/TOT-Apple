import DOMPurify from 'dompurify';
import { marked } from 'marked';

marked.setOptions({
  gfm: true,
  breaks: true,
});

/**
 * 将 LLM 返回的 Markdown 转为可安全用于 v-html 的 HTML。
 */
export function renderInsightMarkdown(md: string): string {
  if (!md?.trim()) return '';
  const html = marked.parse(md, { async: false }) as string;
  return DOMPurify.sanitize(html);
}
