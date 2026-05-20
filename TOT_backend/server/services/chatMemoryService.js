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

const MEMORY_SYSTEM_PROMPT = `你是一个记忆专家。分析对话，提取出用户长期的业务定义或偏好（例如"我不关注华北区数据"、"我偏好柱状图"）。

要求：
1. 仅提取事实性偏好。
2. 如果发现新记忆与已知冲突，标记为 UPDATE；否则标记为 ADD。
3. 输出格式必须是合法的 JSON 数组，如：[{ "type": "bias", "content": "...", "action": "ADD" }]
4. 如果没有值得记忆的内容，返回空数组 []。`;

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

  return rows.map(r => `- [${r.memory_type}] ${r.content}`).join('\n');
}

/**
 * 删除记忆
 */
async function deleteMemory(userId, memoryId) {
  return await run('DELETE FROM user_memory WHERE id = ? AND user_id = ?', [memoryId, userId]);
}

module.exports = { extract, getMemories, deleteMemory };
