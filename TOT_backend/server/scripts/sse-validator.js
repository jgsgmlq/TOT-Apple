'use strict';

/**
 * SSE 响应结构验证器
 *
 * 在终端验证 Agent SSE 流的结构完整性——前端收到的到底是什么。
 * 用法：
 *   # 直接调用 chatService 的 SSE pipe（需要 .env + DB）
 *   node scripts/sse-validator.js --message "整体培训完成率是多少？"
 *
 *   # 指定后端 URL（通过 HTTP 发送请求）
 *   node scripts/sse-validator.js --url http://localhost:3000/api/v1/chat/sendMessageStream --token <JWT> --message "查数据"
 */

const path = require('path');
const fs = require('fs');

const serverDir = path.join(__dirname, '..');
const envFiles = [
  path.join(serverDir, '.env'),
  path.join(path.dirname(serverDir), '.env'),
];
for (const f of envFiles) {
  if (fs.existsSync(f)) require('dotenv').config({ path: f });
}

process.env.DEBUG_GRAPH = 'true';
process.env.LOG_LEVEL = 'debug';

const args = process.argv.slice(2);
const opts = {
  message: '',
  url: '',
  token: '',
  help: args.includes('--help') || args.includes('-h'),
};
const msgIdx = args.indexOf('--message');
if (msgIdx !== -1 && args[msgIdx + 1]) opts.message = args[msgIdx + 1];
const urlIdx = args.indexOf('--url');
if (urlIdx !== -1 && args[urlIdx + 1]) opts.url = args[urlIdx + 1];
const tokIdx = args.indexOf('--token');
if (tokIdx !== -1 && args[tokIdx + 1]) opts.token = args[tokIdx + 1];

if (opts.help) {
  console.log(`
SSE 响应结构验证器

用法:
  node scripts/sse-validator.js [选项]

选项:
  --message <text>  测试消息
  --url <url>        后端 HTTP URL（远程模式）
  --token <jwt>      认证 token（远程模式需要）

示例:
  # 远程模式
  node scripts/sse-validator.js --url http://localhost:3000/api/v1/chat/sendMessageStream --token \$TOKEN --message "查下培训完成率"

  # 本地模式（直接调用 chatService）
  node scripts/sse-validator.js --message "整体培训完成率是多少？"
  `);
  process.exit(0);
}

// ─── SSE 事件收集与验证 ────────────────────────────────────────────────

const events = [];
const warnings = [];
const errors = [];

function recordEvent(type, payload) {
  events.push({ ts: Date.now(), type, payload: summarizePayload(type, payload), _raw: payload });
}

function summarizePayload(type, payload) {
  if (!payload) return '(null)';
  if (type === 'delta') {
    const phase = payload.phase || 'content';
    const text = typeof payload.text === 'string' ? payload.text.slice(0, 80) : JSON.stringify(payload);
    return { phase, text };
  }
  if (type === 'done') {
    const keys = Object.keys(payload).filter((k) => k !== 'replyStructured');
    return { keys };
  }
  if (type === 'clarify') {
    return { type: payload.type, question: payload.question?.slice(0, 60) };
  }
  if (type === 'error') {
    return { message: payload.message?.slice(0, 80), code: payload.code };
  }
  return Object.keys(payload || {});
}

/**
 * 验证 replyContent 结构与前端 ReplyContent / ChartData 类型一致。
 * 这层校验捕获 labels↔xAxis 这种字段名不匹配。
 */
function validateReplyContent(replyContent) {
  const checks = [];
  if (!replyContent || typeof replyContent !== 'object') {
    checks.push({ name: 'replyContent_exists', ok: false, detail: 'replyContent is null/undefined' });
    return checks;
  }
  checks.push({ name: 'replyContent_exists', ok: true });

  checks.push({ name: 'overview_is_string', ok: typeof replyContent.overview === 'string' });
  checks.push({ name: 'keyNumbers_is_array', ok: Array.isArray(replyContent.keyNumbers) });
  checks.push({ name: 'attentionPoints_is_array', ok: Array.isArray(replyContent.attentionPoints) });
  checks.push({ name: 'followUpSuggestions_is_array', ok: Array.isArray(replyContent.followUpSuggestions) });

  // ChartData 字段校验
  const viz = replyContent.visualizations;
  if (viz && Array.isArray(viz)) {
    viz.forEach((c, i) => {
      const prefix = `visualizations[${i}]`;
      checks.push({ name: `${prefix}.type`, ok: typeof c.type === 'string' });
      checks.push({
        name: `${prefix}.xAxis`,
        ok: c.xAxis === undefined || Array.isArray(c.xAxis),
        detail: c.xAxis === undefined ? 'undefined (pie 图可无)' : Array.isArray(c.xAxis) ? `[${c.xAxis.length} items]` : `错误: ${typeof c.xAxis}`,
      });
      // 检测旧版 labels 字段（应为 xAxis）
      if (c.labels !== undefined) {
        checks.push({ name: `${prefix}.labels→xAxis`, ok: false, detail: '旧字段名 labels，前端期望 xAxis，会导致 ECharts 报错' });
      }
      checks.push({
        name: `${prefix}.series`,
        ok: Array.isArray(c.series),
        detail: Array.isArray(c.series) ? `${c.series.length} 条` : '缺失',
      });
    });
  }

  // Table 校验
  if (replyContent.table) {
    checks.push({ name: 'table.title', ok: typeof replyContent.table.title === 'string' });
    checks.push({ name: 'table.columns', ok: Array.isArray(replyContent.table.columns) });
    checks.push({ name: 'table.rows', ok: Array.isArray(replyContent.table.rows) });
  }

  return checks;
}

function validateSequence() {
  const checks = [];

  const types = events.map((e) => e.type);
  const hasDelta = types.includes('delta');
  const hasDone = types.includes('done');
  const hasClarify = types.includes('clarify');
  const hasError = types.includes('error');

  // 1. 必须有 delta 或 clarify 或 error
  checks.push({
    name: 'has_meaningful_event',
    ok: hasDelta || hasClarify || hasError,
    detail: `delta=${hasDelta} clarify=${hasClarify} error=${hasError}`,
  });

  // 2. 如果没 error，必须有 done
  if (!hasError) {
    checks.push({ name: 'has_done_event', ok: hasDone, detail: '' });
  }

  // 3. delta phases 序列检查
  const deltaPhases = events.filter((e) => e.type === 'delta').map((e) => e.payload.phase);
  let toolStartIdx = -1;
  let toolEndIdx = -1;
  for (let i = 0; i < deltaPhases.length; i++) {
    if (deltaPhases[i] === 'tool_start' && toolStartIdx === -1) toolStartIdx = i;
    if (deltaPhases[i] === 'tool_end') toolEndIdx = i;
  }
  if (toolStartIdx !== -1 && toolEndIdx === -1) {
    checks.push({ name: 'tool_start_without_end', ok: false, detail: 'tool_start 存在但 tool_end 缺失' });
  }

  // 4. done 事件应包含 replyContent
  const doneEvent = events.find((e) => e.type === 'done');
  if (doneEvent) {
    checks.push({ name: 'done_has_reply', ok: !!doneEvent.payload?.keys?.includes('replyContent'), detail: '' });
  }

  // 5. 事件数量合理性检查
  if (hasDone && !hasDelta && !hasClarify && !hasError) {
    checks.push({ name: 'done_without_preceding_event', ok: false, detail: 'done 事件前没有 delta/clarify' });
  }

  return checks;
}

// ─── 远程模式（HTTP SSE） ──────────────────────────────────────────────

async function runRemote() {
  if (!opts.message) {
    console.error('需要 --message 参数');
    process.exit(1);
  }
  if (!opts.token) {
    console.error('需要 --token 参数（JWT）');
    process.exit(1);
  }

  const http = opts.url.startsWith('https') ? require('https') : require('http');
  console.log(`=== SSE 验证 (远程模式) ===`);
  console.log(`URL: ${opts.url}`);
  console.log(`消息: ${opts.message}`);

  const postData = JSON.stringify({ userMessage: opts.message });
  const url = new URL(opts.url);
  const options = {
    hostname: url.hostname,
    port: url.port,
    path: url.pathname + url.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${opts.token}`,
      'Accept': 'text/event-stream',
      'Content-Length': Buffer.byteLength(postData),
    },
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      if (res.statusCode !== 200) {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${body}`)));
        return;
      }

      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            const type = line.slice(7).trim();
            const dataLine = lines[lines.indexOf(line) + 1];
            if (dataLine && dataLine.startsWith('data: ')) {
              try {
                const payload = JSON.parse(dataLine.slice(6));
                recordEvent(type, payload);
                console.log(`  [SSE] ${type}: ${JSON.stringify(summarizePayload(type, payload))}`);
              } catch {
                recordEvent(type, { raw: dataLine.slice(6).slice(0, 100) });
                console.log(`  [SSE] ${type}: (parse error)`);
              }
            }
          }
        }
      });

      res.on('end', () => {
        console.log('\n── SSE 序列验证 ──');
        const checks = validateSequence();
        let passed = 0;
        for (const c of checks) {
          const icon = c.ok ? '✅' : '❌';
          console.log(`  ${icon} ${c.name}${c.detail ? ': ' + c.detail : ''}`);
          if (c.ok) passed++;
        }
        console.log(`\n总计: ${events.length} 个事件 | 验证: ${passed}/${checks.length} 通过`);
        resolve(passed === checks.length ? 0 : 1);
      });

      res.on('error', reject);
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// ─── 本地模式（直接调用 chatService） ──────────────────────────────────

async function runLocal() {
  if (!opts.message) {
    console.error('需要 --message 参数');
    process.exit(1);
  }
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error('错误: 未设置 DEEPSEEK_API_KEY');
    process.exit(1);
  }

  console.log('=== SSE 验证 (本地模式) ===');
  console.log(`消息: ${opts.message}`);

  const { SqliteSaver } = require('@langchain/langgraph-checkpoint-sqlite');
  const { getDb } = require('../db');
  const { buildGraph } = require('../agent/graph/graph');
  const { resetStepCounter } = require('../agent/graph/shared/graphDebugger');

  resetStepCounter();
  const sqliteDb = getDb();
  const checkpointer = new SqliteSaver(sqliteDb);
  const app = buildGraph().compile({ checkpointer });

  // 模拟 SSE emitter 来收集事件
  const sseEmitter = {
    handleLLMNewToken(token, info = {}) {
      const phase = info.isReasoning ? 'reasoning' : 'content';
      recordEvent('delta', { text: token, phase });
    },
    handleToolStart(toolInfo) {
      recordEvent('delta', { text: toolInfo?.name || '', phase: 'tool_start', toolName: toolInfo?.name });
    },
    handleToolEnd(result) {
      recordEvent('delta', { text: '', phase: 'tool_end' });
    },
    handleError(message) {
      recordEvent('error', { message, code: 'CHAT_500' });
    },
  };

  const inputState = {
    userMessage: opts.message,
    sessionId: `sse-validate-${Date.now()}`,
    userId: 'test_user',
    regionScope: { type: 'national' },
  };
  const thread = {
    configurable: { thread_id: inputState.sessionId, sseEmitter },
    recursionLimit: 60,
  };

  const t0 = Date.now();
  try {
    const finalState = await app.invoke(inputState, thread);
    const elapsed = Date.now() - t0;

    // 如果是 HITL interrupt
    const interruptPayload = finalState.__interrupt__ || finalState.interrupt_payload;
    if (interruptPayload && interruptPayload.question) {
      recordEvent('clarify', { type: interruptPayload.type, question: interruptPayload.question });
      recordEvent('done', { replyContent: null, interrupted: true });
    } else {
      const rawResponse = finalState.reply_markdown || finalState.finalResponse || '';
      // 尝试解析 FinalResponseStep 的 JSON 输出
      let replyContent = null;
      try { replyContent = JSON.parse(rawResponse); } catch { /* plain text */ }
      recordEvent('done', { replyContent });
    }

    console.log(`\n总耗时: ${formatElapsed(elapsed)}`);
    console.log(`事件数: ${events.length}`);

    // 打印事件序列
    console.log('\n── SSE 事件序列 ──');
    for (const e of events) {
      if (e.type === 'delta' && e.payload.phase === 'reasoning') continue; // 跳过思考过程
      console.log(`  [${e.type}] ${JSON.stringify(e.payload).slice(0, 120)}`);
    }

    // 验证
    console.log('\n── SSE 序列验证 ──');
    const checks = validateSequence();
    let passed = 0;
    for (const c of checks) {
      const icon = c.ok ? '✅' : '❌';
      console.log(`  ${icon} ${c.name}${c.detail ? ': ' + c.detail : ''}`);
      if (c.ok) passed++;
    }
    console.log(`\n总计: ${events.length} 个事件 | SSE验证: ${passed}/${checks.length}`);
    console.log(`mode=${finalState.mode}  intent=${finalState.intent || '(none)'}`);
    if (finalState.calledTools?.length > 0) {
      console.log(`调用工具: ${finalState.calledTools.join(', ')}`);
    }

    // ── 数据契约校验 ──
    const doneEvent = events.find((e) => e.type === 'done');
    if (doneEvent && doneEvent._raw && doneEvent._raw.replyContent) {
      console.log('\n── 数据契约校验 (ReplyContent ↔ 前端 ChartData/ReplyContent 类型) ──');
      const rcPassed = validateReplyContent(doneEvent._raw.replyContent);
      let rcOk = 0;
      for (const c of rcPassed) {
        const icon = c.ok ? '✅' : '❌';
        console.log(`  ${icon} ${c.name}${c.detail ? ': ' + c.detail : ''}`);
        if (c.ok) rcOk++;
      }
      if (rcOk < rcPassed.length) passed = 0;
    }

    process.exit(passed === checks.length ? 0 : 1);
  } catch (err) {
    const elapsed = Date.now() - t0;
    recordEvent('error', { message: err.message, code: err.code || 'CHAT_500' });
    console.error(`\n总耗时: ${formatElapsed(elapsed)}`);
    console.error(`错误: ${err.message}`);

    console.log('\n── SSE 序列验证 ──');
    const checks = validateSequence();
    for (const c of checks) {
      const icon = c.ok ? '✅' : '❌';
      console.log(`  ${icon} ${c.name}${c.detail ? ': ' + c.detail : ''}`);
    }
    process.exit(1);
  }
}

function formatElapsed(ms) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

// ─── Main ──────────────────────────────────────────────────────────────

if (opts.url) {
  runRemote().then((code) => process.exit(code)).catch((err) => {
    console.error('远程模式错误:', err.message);
    process.exit(1);
  });
} else {
  runLocal();
}
