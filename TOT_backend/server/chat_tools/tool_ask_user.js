'use strict';

module.exports = {
  schema: {
    type: 'function',
    function: {
      name: 'ask_user',
      description: '当你确实无法从上下文推断参数、且无法通过 list_task_progress 获取任务列表时，才调用此工具向用户提问。注意：类似"有哪些任务快过期了""哪些门店做得好""整体进度"这类泛查询，直接用 list_task_progress 即可回答，不要反问用户。',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: '向用户提出的问题，用中文，简洁明了' },
          options: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: '选项的显示名称' },
                value: { type: 'string', description: '选项的值' },
              },
              required: ['label', 'value'],
            },
            description: '可选的候选项列表。如果不需要选项可以不传',
          },
        },
        required: ['question'],
      },
    },
  },
  meta: {
    enabled: true,
    requiredRole: [],
    scopePolicy: 'public',
    timeoutMs: 1000,
  },
  handler: async (args) => {
    // handler 本身不执行——fc_ExecuteTool 会检测 ask_user 并走 interrupt 路径
    return { _ask_user: true, question: args.question, options: args.options || [] };
  },
};
