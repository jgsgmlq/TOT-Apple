function stripFromSectionMarkers(text: string): string {
  const markers = [
    /^\s*💡/m,
    /^\s*(建议追问|猜你想问|你可能还想问|推荐追问|可追问)\s*[:：]?/m,
    /^\s*(📊\s*)?(图表|图表信息|可视化|echarts)\s*[:：]?/m,
    /^\s*(思考过程|模型推理|推理过程)\s*[:：]?/m,
  ];
  let end = text.length;
  for (const marker of markers) {
    const m = marker.exec(text);
    if (m && m.index < end) end = m.index;
  }
  return text.slice(0, end);
}

function tableRowToCells(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return [];
  return trimmed
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
    .filter(Boolean);
}

function isMarkdownTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function normalizeMarkdownTablesForSpeech(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('|') || !lines[i + 1] || !isMarkdownTableSeparator(lines[i + 1])) {
      out.push(line);
      continue;
    }

    const tableLines: string[] = [];
    i += 2;
    while (i < lines.length && lines[i].includes('|')) {
      tableLines.push(lines[i]);
      i++;
    }
    i--;

    const spokenRows = tableLines
      .map(tableRowToCells)
      .filter((cells) => cells.length >= 2)
      .map((cells) => `${cells[0]} ${cells.slice(1).join(' ')}`);

    if (spokenRows.length) out.push(spokenRows.join('；'));
  }

  return out.join('\n');
}

export function sanitizeExecutiveSpeechText(raw: string): string {
  if (!raw) return '';
  let text = raw.replace(/\r\n/g, '\n');

  // 移除深度思考过程 <think>...</think>（支持未闭合状态）
  text = text.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '');
  // 移除结尾流式生成中可能被截断的 <think 标签前缀 (如 <, <t, <th)
  text = text.replace(/<(?:t(?:h(?:i(?:n(?:k)?)?)?)?)?$/i, '');

  text = text.replace(/```(?:echarts|json|javascript|js|ts)?[\s\S]*?```/gi, '');
  text = text.replace(/```(?:echarts|json|javascript|js|ts)?[\s\S]*$/gi, '');
  text = stripFromSectionMarkers(text);
  text = normalizeMarkdownTablesForSpeech(text);
  text = text
    .split('\n')
    .filter((line) => !line.includes('|'))
    .join('\n');

  text = text
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/[*_`~>#]/g, '')
    .replace(/^\s*[-+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/[|{}[\]\\]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s*([，。！？；：、,.!?;:])\s*/g, '$1')
    .trim();

  return text;
}
