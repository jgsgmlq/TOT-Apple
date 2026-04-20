/**
 * 极其轻量级的 JSON 修复工具，用于处理 LLM 输出常见的语法错误。
 * 解决问题：多余逗号、属性名缺失引号、未闭合的字符串/对象/数组。
 */
export function repairJson(raw: string): string {
  if (!raw || !raw.trim()) return '';

  let repaired = raw.trim();

  // 1. 处理 Markdown Fences (如果没被之前的逻辑剥离干净)
  repaired = repaired.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

  // 2. 修复末尾逗号: [1, 2,] -> [1, 2] 或 {"a":1,} -> {"a":1}
  repaired = repaired.replace(/,\s*([\]}])/g, '$1');

  // 3. 修复缺失引号的键名: {name: "val"} -> {"name": "val"}
  // 注意：这个正则比较保守，只处理字母开头的简单键名
  repaired = repaired.replace(/([{,]\s*)([a-zA-Z0-9_]+)(\s*):/g, '$1"$2"$3:');

  // 4. 处理未闭合的对象或数组 (流式传输中断常见)
  let braceCount = 0;
  let bracketCount = 0;
  let inString = false;

  for (let i = 0; i < repaired.length; i++) {
    const char = repaired[i];
    if (char === '"' && repaired[i - 1] !== '\\') {
      inString = !inString;
    }
    if (!inString) {
      if (char === '{') braceCount++;
      if (char === '}') braceCount--;
      if (char === '[') bracketCount++;
      if (char === ']') bracketCount--;
    }
  }

  // 如果字符串未闭合，补全它
  if (inString) {
    repaired += '"';
  }

  // 补全未闭合的括号
  while (braceCount > 0) {
    repaired += '}';
    braceCount--;
  }
  while (bracketCount > 0) {
    repaired += ']';
    bracketCount--;
  }

  return repaired;
}
