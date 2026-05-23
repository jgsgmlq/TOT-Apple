'use strict';

const { get, all, run } = require('../modules/common/db/mysql');
const { simpleChat } = require('../utils/ai');
const { nanoid } = require('nanoid');
const crypto = require('crypto');
const logger = require('../utils/logger');
const {
  createMemoryTrace,
  endGeneration,
  maskPII,
  preview,
  promptHash,
} = require('../utils/tracer');

// Trace 更新包装（Langfuse v3 trace 只有 `.update()` 无 `.end()`；NoopTrace 亦同）。
function finishTrace(trace, opts = {}) {
  if (!trace || typeof trace.update !== 'function') return;
  try {
    const payload = {};
    if ('output' in opts) payload.output = maskPII(opts.output);
    if (opts.metadata && typeof opts.metadata === 'object') payload.metadata = opts.metadata;
    if (opts.level) payload.level = opts.level;
    if (opts.statusMessage) payload.statusMessage = String(opts.statusMessage).slice(0, 400);
    trace.update(payload);
  } catch (e) {
    logger.warn('langfuse_trace_update_failed', { message: e.message });
  }
}

/**
 * 全局记忆服务 (v4.0 Core Memory)
 */

// §5.10：Prompt 版本标识，升级 System Prompt 时同步 bump。
const MEMORY_PROMPT_VERSION = 'executive-chat-memory/v4.0';

const MEMORY_SYSTEM_PROMPT = `你是一个记忆专家。分析对话内容，提取值得长期保留的信息。

【三类记忆】
1. user（用户偏好）：用户的个人习惯和偏好
   - "偏好柱状图展示数据"
   - "默认关注华东区域的数据"
   - "习惯按门店粒度查看结果"

2. feedback（行为反馈）：用户明确表达的对 Agent 行为的纠正或期望
   - "对比分析时要自动给出排名"
   - "P3级别的预警不需要提醒我"
   - "不要每次都列Top5，有时需要全量名单"

3. project（业务上下文）：关于当前培训业务的客观事实
   - "iPhone 17 新品培训是P0重点任务"
   - "华东区域包含直营店"
   - "Q2考核重点是学习率而非完成率"

【规则】
- 仅提取事实性偏好和明确的业务信息
- 如果发现新记忆与已知冲突，标记 action=UPDATE，否则 ADD
- 输出格式必须是合法 JSON 数组，每项包含 type(user/feedback/project)、content、action(ADD/UPDATE)
- 如没有值得记忆的内容，返回空数组 []

输出示例：
[{"type":"user","content":"偏好柱状图而非饼图","action":"ADD"},{"type":"project","content":"iPhone 17 培训是P0任务","action":"ADD"}]`;

const MEMORY_PROMPT_HASH = promptHash(MEMORY_SYSTEM_PROMPT);

/**
 * 提取对话中的长期记忆
 * @param {string} sessionId
 */
async function extract(sessionId) {
  // 独立 Memory_Extract Trace：原请求 trace 已结束，这里 setImmediate 后另起一条。
  // 主链路一切异常都应 no-op 降级，所以这里所有 Langfuse 调用都走 NoopTrace 安全路径。
  const session = await get('SELECT user_id FROM chat_session WHERE id = ? AND deleted_at IS NULL', [sessionId]);
  if (!session) return;

  const messages = await all(
    'SELECT role, content_text FROM chat_message WHERE session_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 2',
    [sessionId]
  );
  const reversed = [...messages].reverse();
  if (reversed.length < 2) return;

  const conversationText = reversed.map((m) => `${m.role}: ${m.content_text}`).join('\n');

  const existingMemories = await all('SELECT memory_type, content FROM user_memory WHERE user_id = ?', [session.user_id]);
  const memoryListStr = existingMemories.map((m) => `[${m.memory_type}] ${m.content}`).join('\n');

  const userPrompt = `已知记忆：
${memoryListStr || '无'}

当前对话：
${conversationText}`;

  const memoryTrace = createMemoryTrace({
    sessionId,
    userId: session.user_id,
    summary: conversationText,
    turnCount: reversed.length,
    triggeredBy: 'setImmediate',
  });

  const llmGen = memoryTrace.generation({
    name: 'Memory_LLM',
    model: 'deepseek-chat',
    input: maskPII(preview(userPrompt)),
    metadata: {
      promptVersion: MEMORY_PROMPT_VERSION,
      promptHash: MEMORY_PROMPT_HASH,
      existingMemoriesCount: existingMemories.length,
    },
  });

  const llmStart = Date.now();
  let llmResp;
  try {
    llmResp = await simpleChat(
      [
        { role: 'system', content: MEMORY_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      { maxTokens: 512, returnUsage: true }
    );
  } catch (err) {
    endGeneration(llmGen, {
      output: null,
      level: 'ERROR',
      statusMessage: err.message,
      metadata: { durationMs: Date.now() - llmStart },
    });
    finishTrace(memoryTrace, {
      output: null,
      level: 'ERROR',
      metadata: { status: 'llm_error', written: 0, conflicts: 0 },
    });
    logger.error('memory_extraction_failed', { sessionId, error: err.message });
    return;
  }

  const response = llmResp.content || '';
  endGeneration(llmGen, {
    output: preview(response),
    usage: llmResp.usage || undefined,
    model: llmResp.model || undefined,
    metadata: { durationMs: Date.now() - llmStart },
  });

  let extracted;
  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    extracted = JSON.parse(jsonMatch ? jsonMatch[0] : '[]');
  } catch (e) {
    logger.warn('memory_extraction_parse_failed', { sessionId, response });
    finishTrace(memoryTrace, {
      output: null,
      level: 'WARNING',
      metadata: { status: 'parse_error', written: 0, conflicts: 0 },
    });
    return;
  }

  if (!Array.isArray(extracted) || extracted.length === 0) {
    finishTrace(memoryTrace, {
      output: 'no_memories',
      metadata: { status: 'empty', written: 0, conflicts: 0 },
    });
    return;
  }

  let written = 0;
  let conflicts = 0;
  try {
    for (const item of extracted) {
      if (!item.content || !item.type) continue;

      const hash = crypto.createHash('sha256').update(item.content).digest('hex');

      const result = await run(
        `INSERT INTO user_memory (id, user_id, memory_hash, memory_type, content, confidence_score, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW(3), NOW(3))
         ON DUPLICATE KEY UPDATE
           memory_type = VALUES(memory_type),
           content = VALUES(content),
           confidence_score = VALUES(confidence_score),
           updated_at = NOW(3)`,
        [nanoid(), session.user_id, hash, item.type, item.content, 0.8]
      );
      if (result && result.affectedRows) written += 1;
      if (String(item.action).toUpperCase() === 'UPDATE') conflicts += 1;
    }
  } catch (err) {
    finishTrace(memoryTrace, {
      output: null,
      level: 'ERROR',
      statusMessage: err.message,
      metadata: { status: 'db_error', written, conflicts },
    });
    logger.error('memory_extraction_failed', { sessionId, error: err.message });
    return;
  }

  logger.info('memory_extracted', { sessionId, count: extracted.length });
  finishTrace(memoryTrace, {
    output: `written=${written} conflicts=${conflicts}`,
    metadata: {
      status: 'ok',
      extractedCount: extracted.length,
      written,
      conflicts,
    },
  });
}

/**
 * 获取用户的所有记忆，用于注入 System Prompt
 * @param {number} userId
 */
async function getMemories(userId) {
  const rows = await all(`
    SELECT memory_type, content
    FROM user_memory
    WHERE user_id = ?
      AND (expires_at IS NULL OR expires_at > NOW(3))
      AND (
        memory_type != 'mid_term'
        OR (memory_type = 'mid_term' AND updated_at > NOW(3) - INTERVAL 14 DAY)
      )
  `, [userId]);
  if (!rows || !rows.length) return '';

  // 按类型分组
  const groups = { user: [], feedback: [], project: [], other: [] };
  for (const r of rows) {
    const type = r.memory_type || 'other';
    if (groups[type]) {
      groups[type].push(r.content);
    } else {
      groups.other.push(`[${type}] ${r.content}`);
    }
  }

  const parts = [];
  if (groups.user.length) parts.push('[user]\n' + groups.user.map(s => '- ' + s).join('\n'));
  if (groups.feedback.length) parts.push('[feedback]\n' + groups.feedback.map(s => '- ' + s).join('\n'));
  if (groups.project.length) parts.push('[project]\n' + groups.project.map(s => '- ' + s).join('\n'));
  if (groups.other.length) parts.push('[other]\n' + groups.other.join('\n'));

  return parts.join('\n\n');
}

/**
 * 删除记忆
 */
async function deleteMemory(userId, memoryId) {
  return await run('DELETE FROM user_memory WHERE id = ? AND user_id = ?', [memoryId, userId]);
}

module.exports = { extract, getMemories, deleteMemory };
