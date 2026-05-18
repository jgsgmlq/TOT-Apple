'use strict';

const {
  routeAfterRouter,
  routeAfterFcCheckSteps,
  routeAfterFcLlm,
  routeAfterValidateParams,
  routeAfterMerge,
  routeAfterHumanInTheLoop,
  routeAfterCheckDuplicate,
} = require("../graph");

// Mock message with _getType
const aiMsg = (content, opts = {}) => ({
  _getType: () => "ai",
  content,
  tool_calls: opts.tool_calls || [],
  ...opts,
});
const toolMsg = (content) => ({
  _getType: () => "tool",
  content,
});

describe("Route functions (pure unit tests)", () => {
  // ─── routeAfterRouter ──────────────────────────────────────

  describe("routeAfterRouter", () => {
    test("deny mode → deny (to FinalResponseStep)", () => {
      expect(routeAfterRouter({ mode: "deny" })).toBe("deny");
    });

    test("chat_only + very short message (<5 chars) → chat_only", () => {
      expect(routeAfterRouter({
        mode: "chat_only",
        userMessage: "你好",
        messages: [],
      })).toBe("chat_only");
    });

    test("chat_only + medium message (5-9 chars) without data context → chat_only", () => {
      expect(routeAfterRouter({
        mode: "chat_only",
        userMessage: "能帮我吗",
        messages: [],
      })).toBe("chat_only");
    });

    test("chat_only + medium message with data context → tool_action", () => {
      expect(routeAfterRouter({
        mode: "chat_only",
        userMessage: "能帮我查吗",
        messages: [aiMsg("完成率: | 80% | 20% |")],
      })).toBe("tool_action");
    });

    test("chat_only + long message (>=10 chars) → tool_action", () => {
      expect(routeAfterRouter({
        mode: "chat_only",
        userMessage: "华东区的完成率是多少",
        messages: [],
      })).toBe("tool_action");
    });

    test("default (no deny, no chat_only) → tool_action", () => {
      expect(routeAfterRouter({
        mode: "tool_action",
        userMessage: "查询数据",
        messages: [],
      })).toBe("tool_action");
    });
  });

  // ─── routeAfterFcLlm ───────────────────────────────────────

  describe("routeAfterFcLlm", () => {
    test("last message has tool_calls → fc_CheckDuplicate", () => {
      expect(routeAfterFcLlm({
        messages: [aiMsg("", { tool_calls: [{ name: "getOverviewData" }] })],
      })).toBe("fc_CheckDuplicate");
    });

    test("last message has no tool_calls → FinalResponseStep", () => {
      expect(routeAfterFcLlm({
        messages: [aiMsg("这是回复内容")],
      })).toBe("FinalResponseStep");
    });

    test("empty messages → FinalResponseStep", () => {
      expect(routeAfterFcLlm({ messages: [] })).toBe("FinalResponseStep");
    });
  });

  // ─── routeAfterCheckDuplicate ──────────────────────────────

  describe("routeAfterCheckDuplicate", () => {
    test("fc_next_action merge → fc_MergeToolResults", () => {
      expect(routeAfterCheckDuplicate({ fc_next_action: "merge" }))
        .toBe("fc_MergeToolResults");
    });

    test("fc_next_action validate → fc_ValidateParams", () => {
      expect(routeAfterCheckDuplicate({ fc_next_action: "validate" }))
        .toBe("fc_ValidateParams");
    });

    test("default → fc_ValidateParams", () => {
      expect(routeAfterCheckDuplicate({})).toBe("fc_ValidateParams");
    });
  });

  // ─── routeAfterValidateParams ──────────────────────────────

  describe("routeAfterValidateParams", () => {
    test("finalize → FinalResponseStep", () => {
      expect(routeAfterValidateParams({ fc_next_action: "finalize" })).toBe("FinalResponseStep");
    });

    test("hitl → HumanInTheLoopGate", () => {
      expect(routeAfterValidateParams({ fc_next_action: "hitl" })).toBe("HumanInTheLoopGate");
    });

    test("repair → fc_ParamRepair", () => {
      expect(routeAfterValidateParams({ fc_next_action: "repair" })).toBe("fc_ParamRepair");
    });

    test("execute → fc_ExecuteTool", () => {
      expect(routeAfterValidateParams({ fc_next_action: "execute" })).toBe("fc_ExecuteTool");
    });

    test("re_route → ContextAnalyzerRouter", () => {
      expect(routeAfterValidateParams({ fc_next_action: "re_route" })).toBe("ContextAnalyzerRouter");
    });

    test("unknown action → FinalResponseStep (safe fallback)", () => {
      expect(routeAfterValidateParams({ fc_next_action: "unknown" })).toBe("FinalResponseStep");
    });
  });

  // ─── routeAfterMerge ───────────────────────────────────────

  describe("routeAfterMerge", () => {
    test("finalize → FinalResponseStep", () => {
      expect(routeAfterMerge({ fc_next_action: "finalize" })).toBe("FinalResponseStep");
    });

    test("default → fc_CheckSteps (loop back)", () => {
      expect(routeAfterMerge({ fc_next_action: "" })).toBe("fc_CheckSteps");
    });
  });

  // ─── routeAfterHumanInTheLoop ──────────────────────────────

  describe("routeAfterHumanInTheLoop", () => {
    test("re_route → ContextAnalyzerRouter", () => {
      expect(routeAfterHumanInTheLoop({ fc_next_action: "re_route" })).toBe("ContextAnalyzerRouter");
    });

    test("validate → fc_ValidateParams", () => {
      expect(routeAfterHumanInTheLoop({ fc_next_action: "validate" })).toBe("fc_ValidateParams");
    });

    test("finalize → FinalResponseStep", () => {
      expect(routeAfterHumanInTheLoop({ fc_next_action: "finalize" })).toBe("FinalResponseStep");
    });

    test("default → fc_CheckSteps", () => {
      expect(routeAfterHumanInTheLoop({ fc_next_action: "" })).toBe("fc_CheckSteps");
    });
  });
});
