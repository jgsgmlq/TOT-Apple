'use strict';

// Setup mocks before requiring node modules
jest.mock('../../../utils/tracer', () => ({
  endSpan: jest.fn(),
  getClient: jest.fn(() => null),
  NOOP_TRACE: { generation: () => ({}) },
  maskPII: (s) => s,
  preview: (s) => (typeof s === 'string' ? s.slice(0, 200) : s),
  promptHash: () => 'mock-hash',
}));

jest.mock('../shared/spanHelper', () => ({
  startNodeSpan: jest.fn(() => null),
}));

jest.mock('../../../services/chatMemoryService', () => ({
  getMemories: jest.fn(),
}));

jest.mock('../../../services/chatToolsService', () => ({
  normalizeToolName: jest.fn((n) => n),
  getToolFreshnessBucketMs: jest.fn(() => 60000),
  executeByName: jest.fn(),
}));

jest.mock('../../../services/chatSessionStateService', () => ({
  buildScopeFingerprint: jest.fn(() => 'fp_mock'),
  getLatestBySignature: jest.fn(() => null),
  addRecord: jest.fn(),
}));

jest.mock('@langchain/langgraph', () => {
  const actual = jest.requireActual('@langchain/langgraph');
  return {
    ...actual,
    interrupt: jest.fn(),
  };
});

jest.mock('../toolCallUtils', () => {
  const actual = jest.requireActual('../toolCallUtils');
  return {
    ...actual,
    getLastAiToolCalls: jest.fn(() => ({ anchor: null, anchorIdx: -1, toolCalls: [] })),
    buildToolSignature: jest.fn(() => 'mock_sig'),
    safeJsonContent: jest.fn((v) => (typeof v === 'string' ? v : JSON.stringify(v))),
    makeToolMessage: jest.fn((tc, content) => ({
      _getType: () => 'tool',
      tool_call_id: tc?.id || 'unknown',
      name: tc?.name || 'unknown',
      content: typeof content === 'string' ? content : JSON.stringify(content),
    })),
  };
});

const { loadContext } = require('../nodes/loadContext');
const { fc_CheckDuplicate } = require('../nodes/fc_CheckDuplicate');
const { fc_MergeToolResults } = require('../nodes/fc_MergeToolResults');
const chatMemoryService = require('../../../services/chatMemoryService');
const chatToolsService = require('../../../services/chatToolsService');
const chatSessionStateService = require('../../../services/chatSessionStateService');

const { fc_ExecuteTool } = require('../nodes/fc_ExecuteTool');
const { humanInTheLoopGate } = require('../nodes/humanInTheLoopGate');
const { interrupt } = require('@langchain/langgraph');

describe('Node unit tests (mocked dependencies)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('loadContext', () => {
    test('returns long_term_memories from chatMemoryService', async () => {
      chatMemoryService.getMemories.mockResolvedValue('[user]\n- 偏好一\n- 偏好二\n');

      const state = { userId: 'u1', userMessage: 'hello' };
      const result = await loadContext(state);

      expect(chatMemoryService.getMemories).toHaveBeenCalledWith('u1');
      expect(result.long_term_memories).toBe('[user]\n- 偏好一\n- 偏好二\n');
      expect(result.messages).toHaveLength(1);
    });

    test('returns empty long_term on service error', async () => {
      chatMemoryService.getMemories.mockRejectedValue(new Error('DB down'));

      const state = { userId: 'u1', userMessage: 'hello' };
      const result = await loadContext(state);

      expect(result.long_term_memories).toBe('');
    });

    test('handles empty string from service', async () => {
      chatMemoryService.getMemories.mockResolvedValue('');

      const state = { userId: 'u1', userMessage: 'hello' };
      const result = await loadContext(state);

      expect(result.long_term_memories).toBe('');
    });
  });

  describe('fc_CheckDuplicate', () => {
    test('returns finalize when no tool_calls in last AI message', async () => {
      const state = { messages: [], toolResults: {} };
      const result = await fc_CheckDuplicate(state);
      expect(result.fc_next_action).toBe('finalize');
    });

    test('deduplicates same-batch duplicate tool calls', async () => {
      const toolCallUtils = require('../toolCallUtils');
      toolCallUtils.getLastAiToolCalls.mockReturnValue({
        anchor: {},
        anchorIdx: 0,
        toolCalls: [
          { id: 'c1', name: 'query_metric', args: {} },
          { id: 'c2', name: 'query_metric', args: {} },
        ],
      });
      toolCallUtils.buildToolSignature.mockReturnValue('same_sig');

      const state = { messages: [], toolResults: {}, sessionId: 's1', regionScope: { type: 'national' } };
      const result = await fc_CheckDuplicate(state);

      // Second call aliases the first
      expect(result.toolResults).toBeDefined();
      expect(result.toolResults.c2).toBeDefined();
      expect(result.toolResults.c2.alias_of).toBe('c1');
      expect(result.pending_tool_calls).toHaveLength(1);
    });

    test('uses session cache when available', async () => {
      const toolCallUtils = require('../toolCallUtils');
      toolCallUtils.getLastAiToolCalls.mockReturnValue({
        anchor: {},
        anchorIdx: 0,
        toolCalls: [{ id: 'c1', name: 'query_metric', args: {} }],
      });
      toolCallUtils.buildToolSignature.mockReturnValue('sig1');
      chatSessionStateService.getLatestBySignature.mockReturnValue({ data: 'cached_result' });

      const state = { messages: [], toolResults: {}, sessionId: 's1', regionScope: {} };
      const result = await fc_CheckDuplicate(state);

      expect(result.pending_tool_calls).toBeUndefined();
      expect(result.toolResults.c1.data).toBe('cached_result');
    });

    test('uses in-graph cache when available', async () => {
      const toolCallUtils = require('../toolCallUtils');
      toolCallUtils.getLastAiToolCalls.mockReturnValue({
        anchor: {},
        anchorIdx: 0,
        toolCalls: [{ id: 'c1', name: 'query_metric', args: {} }],
      });
      toolCallUtils.buildToolSignature.mockReturnValue('sig1');

      const state = {
        messages: [],
        toolResults: { old: { signature: 'sig1', data: 'old_data' } },
        sessionId: 's1',
        regionScope: {},
      };
      const result = await fc_CheckDuplicate(state);

      expect(result.toolResults.c1).toBeDefined();
      expect(result.toolResults.c1.data).toBe('old_data');
    });
  });

  describe('fc_MergeToolResults', () => {
    test('returns empty next_action when no anchor AI message found', async () => {
      const state = {
        messages: [
          { _getType: () => 'human', content: 'hello' },
        ],
        toolResults: {},
      };
      const result = await fc_MergeToolResults(state);
      expect(result.fc_next_action).toBe('');
    });

    test('generates ToolMessages for pending tool calls', async () => {
      const state = {
        messages: [
          {
            _getType: () => 'ai',
            tool_calls: [{ id: 'c1', name: 'query_metric', args: {} }],
          },
        ],
        toolResults: {
          c1: { data: '{"result": 42}', signature: null, error: false },
        },
        sessionId: 's1',
        regionScope: { type: 'national' },
      };
      const result = await fc_MergeToolResults(state);

      expect(result.messages).toHaveLength(1);
      expect(result.pending_tool_calls).toEqual([]);
    });

    test('skips already emitted tool messages', async () => {
      const state = {
        messages: [
          {
            _getType: () => 'ai',
            tool_calls: [{ id: 'c1', name: 'query_metric', args: {} }],
          },
          { _getType: () => 'tool', tool_call_id: 'c1' },
        ],
        toolResults: {
          c1: { data: '{"result": 1}', signature: null, error: false },
        },
        sessionId: 's1',
        regionScope: {},
      };
      const result = await fc_MergeToolResults(state);
      expect(result.messages).toHaveLength(0);
    });

    test('resolves alias_of references to sibling data', async () => {
      const state = {
        messages: [
          {
            _getType: () => 'ai',
            tool_calls: [
              { id: 'c1', name: 'query_metric', args: {} },
              { id: 'c2', name: 'query_metric', args: {} },
            ],
          },
        ],
        toolResults: {
          c1: { data: '{"result": 42}', signature: 'sig1', error: false },
          c2: { alias_of: 'c1', data: null, signature: 'sig1' },
        },
        sessionId: 's1',
        regionScope: {},
      };
      const result = await fc_MergeToolResults(state);
      expect(result.messages).toHaveLength(2);
    });

    test('bumps meta_fallback_count when NO_TOOL_RESULT', async () => {
      const state = {
        messages: [
          {
            _getType: () => 'ai',
            tool_calls: [{ id: 'c1', name: 'query_metric', args: {} }],
          },
        ],
        toolResults: {},
        sessionId: 's1',
        regionScope: {},
        meta_fallback_count: 0,
      };
      const result = await fc_MergeToolResults(state);
      expect(result.meta_fallback_count).toBe(1);
    });
  });

  describe('fc_ExecuteTool', () => {
    test('returns merge when no pending tool calls', async () => {
      const state = { pending_tool_calls: [] };
      const result = await fc_ExecuteTool(state);
      expect(result.fc_next_action).toBe('merge');
    });

    test('ask_user tool triggers HITL interrupt', async () => {
      chatToolsService.normalizeToolName.mockReturnValue('ask_user');

      const state = {
        pending_tool_calls: [{ id: 'ask1', name: 'ask_user', args: { question: '哪个任务?' } }],
      };
      const result = await fc_ExecuteTool(state);

      expect(result.fc_next_action).toBe('hitl');
      expect(result.hitl_status).toBe('pending_interrupt');
      expect(result.interrupt_payload.type).toBe('fc_clarification');
      expect(result.interrupt_payload.question).toBe('哪个任务?');
      expect(result.pending_tool_calls).toEqual([]);
    });

    test('executes tools and returns results', async () => {
      chatToolsService.normalizeToolName.mockImplementation((n) => n);
      chatToolsService.executeByName.mockResolvedValue({ data: [1, 2, 3] });

      const state = {
        pending_tool_calls: [{ id: 'c1', name: 'query_metric', args: { taskId: 'T1' } }],
        tool_namespace: 'ns',
        regionScope: {},
      };
      const result = await fc_ExecuteTool(state);

      expect(result.fc_next_action).toBe('merge');
      expect(result.toolResults).toBeDefined();
      expect(result.toolResults.c1).toBeDefined();
      expect(result.toolResults.c1.error).toBe(false);
      expect(result.calledTools).toContain('query_metric');
    });

    test('handles tool execution errors gracefully', async () => {
      chatToolsService.normalizeToolName.mockImplementation((n) => n);
      chatToolsService.executeByName.mockRejectedValue(new Error('Tool failed'));

      const state = {
        pending_tool_calls: [{ id: 'c1', name: 'bad_tool', args: {} }],
        tool_namespace: 'ns',
        regionScope: {},
      };
      const result = await fc_ExecuteTool(state);

      expect(result.toolResults.c1.error).toBe(true);
      expect(result.toolResults.c1.errorCode).toBe('EXECUTION_ERROR');
    });

    test('PERMISSION_DENIED short-circuits remaining tools', async () => {
      chatToolsService.normalizeToolName.mockImplementation((n) => n);
      chatToolsService.executeByName
        .mockResolvedValueOnce({ error: { code: 'PERMISSION_DENIED', message: 'denied' } });

      const state = {
        pending_tool_calls: [
          { id: 'c1', name: 'restricted_tool', args: {} },
          { id: 'c2', name: 'safe_tool', args: {} },
        ],
        tool_namespace: 'ns',
        regionScope: {},
      };
      const result = await fc_ExecuteTool(state);

      expect(result.toolResults.c2.error).toBe(true);
      const c2Data = JSON.parse(result.toolResults.c2.data);
      expect(c2Data.error.code).toBe('SKIPPED_AFTER_DENY');
    });
  });

  describe('humanInTheLoopGate', () => {
    test('fc_clarification continue: injects user reply into messages', async () => {
      interrupt.mockReturnValue({
        value: '任务 T1 的完成率',
        selected_option_id: 'opt_1',
      });

      const state = {
        hitl_status: 'pending_interrupt',
        ambiguity_payload: { type: 'fc_clarification', source: 'fc_loop', question: '哪个任务?' },
        userMessage: '查看完成率',
        toolResults: {},
      };
      const result = await humanInTheLoopGate(state);

      expect(result.hitl_status).toBe('resumed');
      expect(result.interrupt_payload).toBeNull();
      expect(result.fc_next_action).toBe('');
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toContain('任务 T1 的完成率');
    });

    test('fc_clarification cancel: finalizes with cancel message', async () => {
      interrupt.mockReturnValue({
        resume_type: 'cancel',
      });

      const state = {
        hitl_status: 'pending_interrupt',
        ambiguity_payload: { type: 'fc_clarification', source: 'fc_loop', question: '?' },
        userMessage: 'query',
      };
      const result = await humanInTheLoopGate(state);

      expect(result.hitl_status).toBe('resumed');
      expect(result.fc_next_action).toBe('finalize');
      expect(result.messages[0].content).toContain('取消');
    });

    test('cancel (non-FC): returns final cancel message', async () => {
      interrupt.mockReturnValue({ resume_type: 'cancel' });

      const state = {
        hitl_status: 'pending_interrupt',
        ambiguity_payload: { type: 'vague_task_ref', question: '哪个任务?' },
        userMessage: 'query',
      };
      const result = await humanInTheLoopGate(state);

      expect(result.hitl_status).toBe('resumed');
      expect(result.fc_next_action).toBe('finalize');
      expect(result.reply_markdown).toContain('已取消');
    });

    test('intent_shift: clears state and returns new user message', async () => {
      interrupt.mockReturnValue({
        resume_type: 'intent_shift',
        user_text: '换一个查询',
      });

      const state = {
        hitl_status: 'pending_interrupt',
        ambiguity_payload: { type: 'vague_task_ref' },
        userMessage: 'old query',
        pending_tool_calls: [{ id: 't1', name: 'old_tool' }],
      };
      const result = await humanInTheLoopGate(state);

      expect(result.hitl_status).toBe('resumed');
      expect(result.fc_next_action).toBe('re_route');
      expect(result.userMessage).toBe('换一个查询');
      expect(result.intent).toBe('');
      expect(result.pending_tool_calls).toEqual([]);
    });

    test('slot_fill default: creates HumanMessage with selected value', async () => {
      // use vague_task_ref type to skip inline require(taskCrud) inside HITL gate
      interrupt.mockReturnValue({
        selected_option_id: 'task_T1',
        label: '门店完成率排查',
      });

      const state = {
        hitl_status: 'pending_interrupt',
        ambiguity_payload: { type: 'vague_task_ref', question: '哪个任务?' },
        userMessage: '查看完成率',
      };
      const result = await humanInTheLoopGate(state);

      expect(result.hitl_status).toBe('resumed');
      expect(result.fc_next_action).toBe('validate');
      expect(result.messages[0].content).toContain('门店完成率排查');
      expect(result.messages[0].content).toContain('task_T1');
    });
  });
});
