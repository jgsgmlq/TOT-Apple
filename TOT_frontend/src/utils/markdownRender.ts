import DOMPurify from 'dompurify';
import { marked } from 'marked';

// Configure marked with GitHub Flavored Markdown (GFM)
marked.setOptions({
  gfm: true,
  breaks: true,
});

const renderer = {
  table(token: any) {
    const header = token.header.map((cell: any) => this.tablecell(cell)).join('');
    const body = token.rows.map((row: any) => this.tablerow({ text: row.map((cell: any) => this.tablecell(cell)).join('') })).join('');
    
    return `<div class="table-wrapper relative overflow-x-auto my-4 border border-gray-200 rounded-lg shadow-sm">
      <table class="w-full text-left text-sm text-gray-500">
        <thead class="text-xs text-gray-700 uppercase bg-gray-50 border-b border-gray-200">
          <tr>${header}</tr>
        </thead>
        <tbody>
          ${body}
        </tbody>
      </table>
    </div>`;
  },
  tablerow(token: any) {
    return `<tr class="bg-white border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition-colors">${token.text}</tr>`;
  },
  tablecell(token: any) {
    const content = this.parser.parseInline(token.tokens);
    const type = token.header ? 'th' : 'td';
    const tag = token.header ? `<th scope="col" class="px-4 py-3 font-semibold whitespace-nowrap"` : `<td class="px-4 py-2.5"`;
    const align = token.align ? ` style="text-align:${token.align}"` : '';
    return `${tag}${align}>${content}</${type}>`;
  }
};

marked.use({ renderer });

/**
 * 将 LLM 返回的 Markdown 转为可安全用于 v-html 的 HTML。
 */
export function renderInsightMarkdown(md: string): string {
  if (!md?.trim()) return '';
  
  let preprocessedMd = md;

  // 1. Fix missing empty line before a table (AI sometimes outputs text directly followed by a table)
  // Matches a non-newline character, followed by \n, followed by a table header and a table separator line.
  preprocessedMd = preprocessedMd.replace(/([^\n])\n([ \t]*\|[^\n]+\|[ \t]*\n[ \t]*\|[-:| \t]+\|[ \t]*)/g, '$1\n\n$2');

  // 2. Fix malformed table separators like `|::---:|` which invalidates the entire table
  preprocessedMd = preprocessedMd.replace(/\|([-: ]+)\|/g, (match) => {
    return match.replace(/:+/g, ':');
  });

  // 3. Fix mismatched column counts between the table header and the separator line
  // (AI sometimes generates |---|---|---| for a 4-column header)
  const tableRegex = /^([ \t]*\|[^\n]+\|[ \t]*)\n([ \t]*\|[-:| \t]+\|[ \t]*)/gm;
  preprocessedMd = preprocessedMd.replace(tableRegex, (match, headerLine, sepLine) => {
    const headerCols = (headerLine.match(/\|/g) || []).length;
    const sepCols = (sepLine.match(/\|/g) || []).length;
    if (headerCols > 1 && headerCols !== sepCols) {
      // Rebuild separator to match header column count
      const newSep = '|' + Array(headerCols - 1).fill('---').join('|') + '|';
      return headerLine + '\n' + newSep;
    }
    return match;
  });
  
  const html = marked.parse(preprocessedMd, { async: false }) as string;
  
  // Customize DOMPurify to allow our new structure and classes
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['div', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'p', 'strong', 'em', 'ul', 'ol', 'li', 'br', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'code', 'pre', 'blockquote'],
    ALLOWED_ATTR: ['class', 'scope', 'style', 'href', 'target', 'rel'],
  });
}
