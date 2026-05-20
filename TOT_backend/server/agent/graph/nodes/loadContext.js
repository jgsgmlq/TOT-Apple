'use strict';

const { HumanMessage } = require("@langchain/core/messages");
const { startNodeSpan } = require('../shared/spanHelper');
const { endSpan } = require('../../../utils/tracer');
const chatMemoryService = require('../../../services/chatMemoryService');

const loadContext = async (state) => {
  const span = startNodeSpan(state, 'LoadContext', { userId: state.userId });
  // T4 阶段二：真实调用 Store API 读取 `mid_term` 等记忆
  let memorySnippets = [];
  try {
    const rawMemories = await chatMemoryService.getMemories(state.userId, state.userMessage);
    if (typeof rawMemories === 'string' && rawMemories.trim() !== '') {
      const lines = rawMemories.split('\n').filter(line => line.trim());
      memorySnippets = lines.map(line => ({ text: line.trim(), score: 1.0, source: 'user_memories' }));
      console.log(`[T4 记忆注入] 真实加载到 ${state.userId} 的长期偏好`);
    }
  } catch (err) {
    console.error("[LoadContext] 真实记忆注入失败，降级为空上下文:", err);
  }

  endSpan(span, { output: memorySnippets.length ? `${memorySnippets.length} snippets` : 'none' });
  return {
    memory_snippets: memorySnippets,
    messages: [new HumanMessage(state.userMessage)]
  };
};

module.exports = { loadContext };
