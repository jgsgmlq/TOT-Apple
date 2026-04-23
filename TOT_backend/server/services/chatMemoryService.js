'use strict';

const { db } = require('../db');
const { simpleChat } = require('../utils/ai');
const { nanoid } = require('nanoid');
const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * 全局记忆服务 (v4.0 Core Memory)
 */

/**
 * 提取对话中的长期记忆
 * @param {string} sessionId 
 */
async function extract(sessionId) {
  try {
    const session = db.get('SELECT user_id FROM chat_sessions WHERE id = ?', [sessionId]);
    if (!session) return;

    // 捞取最近一轮问答
    const messages = db.all(
      'SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 2',
      [sessionId]
    ).reverse();

    if (messages.length < 2) return;

    const conversationText = messages.map(m => `${m.role}: ${m.content}`).join('\n');
    
    // 获取现有记忆以判断冲突
    const existingMemories = db.all('SELECT memory_type, content FROM user_memories WHERE user_id = ?', [session.user_id]);
    const memoryListStr = existingMemories.map(m => `[${m.memory_type}] ${m.content}`).join('\n');

    const prompt = `你是一个记忆专家。分析这段对话，提取出用户长期的业务定义或偏好（例如“我不关注华北区数据”、“我偏好柱状图”）。
已知记忆：
${memoryListStr || '无'}

当前对话：
${conversationText}

要求：
1. 仅提取事实性偏好。
2. 如果发现新记忆与已知冲突，标记为 UPDATE；否则标记为 ADD。
3. 输出格式必须是合法的 JSON 数组，如：[{ "type": "bias", "content": "...", "action": "ADD" }]
4. 如果没有值得记忆的内容，返回空数组 []。`;

    const response = await simpleChat([{ role: 'user', content: prompt }], { maxTokens: 512 });
    
    let extracted;
    try {
      // 提取 JSON
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      extracted = JSON.parse(jsonMatch ? jsonMatch[0] : '[]');
    } catch (e) {
      logger.warn('memory_extraction_parse_failed', { sessionId, response });
      return;
    }

    if (!Array.isArray(extracted) || extracted.length === 0) return;

    for (const item of extracted) {
      if (!item.content || !item.type) continue;
      
      const hash = crypto.createHash('md5').update(item.content).digest('hex');
      const now = new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-');
      
      db.run(`
        INSERT INTO user_memories (id, user_id, memory_hash, memory_type, content, confidence_score, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, memory_hash) DO UPDATE SET
          memory_type = excluded.memory_type,
          content = excluded.content,
          confidence_score = excluded.confidence_score,
          updated_at = excluded.updated_at
      `, [nanoid(), session.user_id, hash, item.type, item.content, 0.8, now, now]);
    }
    
    logger.info('memory_extracted', { sessionId, count: extracted.length });
  } catch (err) {
    logger.error('memory_extraction_failed', { sessionId, error: err.message });
  }
}

/**
 * 获取用户的所有记忆，用于注入 System Prompt
 * @param {number} userId 
 */
function getMemories(userId) {
  const rows = db.all('SELECT memory_type, content FROM user_memories WHERE user_id = ?', [userId]);
  if (!rows.length) return '';
  
  return rows.map(r => `- [${r.memory_type}] ${r.content}`).join('\n');
}

/**
 * 删除记忆
 */
function deleteMemory(userId, memoryId) {
  return db.run('DELETE FROM user_memories WHERE id = ? AND user_id = ?', [memoryId, userId]);
}

module.exports = { extract, getMemories, deleteMemory };
