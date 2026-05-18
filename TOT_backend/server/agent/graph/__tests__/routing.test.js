'use strict';

const {
  routeAfterSafetyGateway,
  routeAfterFcCheckSteps,
  routeAfterFcLlm,
  routeAfterCheckDuplicate,
  routeAfterExecute,
  routeAfterMerge,
} = require("../graph");

const aiMsg = (content, opts = {}) => ({
  _getType: () => "ai",
  content,
  tool_calls: opts.tool_calls || [],
  ...opts,
});

describe("Route functions (v2)", () => {
  describe("routeAfterSafetyGateway", () => {
    test("deny → FinalResponseStep", () => {
      expect(routeAfterSafetyGateway({ mode: "deny" })).toBe("deny");
    });
    test("chat → FinalResponseStep", () => {
      expect(routeAfterSafetyGateway({ mode: "chat", ambiguity_payload: null })).toBe("chat");
    });
    test("tool + ambiguity → HITL", () => {
      expect(routeAfterSafetyGateway({
        mode: "tool", ambiguity_payload: { type: "missing_task_ref", question: "哪个任务？" }
      })).toBe("hitl");
    });
    test("tool + no ambiguity → FC", () => {
      expect(routeAfterSafetyGateway({ mode: "tool", ambiguity_payload: null })).toBe("fc");
    });
  });

  describe("routeAfterFcCheckSteps", () => {
    test("under max steps → fc_LlmToolCallStep", () => {
      expect(routeAfterFcCheckSteps({ fc_super_step_count: 1 })).toBe("fc_LlmToolCallStep");
    });
    test("at max default (3) → FinalResponseStep", () => {
      expect(routeAfterFcCheckSteps({ fc_super_step_count: 3 })).toBe("FinalResponseStep");
    });
    test("respects MAX_FC_ROUNDS env var when set to 5", () => {
      process.env.MAX_FC_ROUNDS = "5";
      expect(routeAfterFcCheckSteps({ fc_super_step_count: 4 })).toBe("fc_LlmToolCallStep");
      expect(routeAfterFcCheckSteps({ fc_super_step_count: 5 })).toBe("FinalResponseStep");
      delete process.env.MAX_FC_ROUNDS;
    });
  });

  describe("routeAfterFcLlm", () => {
    test("has tool_calls → fc_CheckDuplicate", () => {
      expect(routeAfterFcLlm({
        messages: [aiMsg("", { tool_calls: [{ name: "query_metric" }] })]
      })).toBe("fc_CheckDuplicate");
    });
    test("no tool_calls → FinalResponseStep", () => {
      expect(routeAfterFcLlm({ messages: [aiMsg("总结回复")] })).toBe("FinalResponseStep");
    });
  });

  describe("routeAfterCheckDuplicate", () => {
    test("pending calls → execute", () => {
      expect(routeAfterCheckDuplicate({ pending_tool_calls: [{ id: "1" }] })).toBe("fc_ExecuteTool");
    });
    test("no pending → merge", () => {
      expect(routeAfterCheckDuplicate({ pending_tool_calls: [] })).toBe("fc_MergeToolResults");
    });
  });

  describe("routeAfterExecute", () => {
    test("escalate_count < 1 → merge", () => {
      expect(routeAfterExecute({ escalate_count: 0 })).toBe("fc_MergeToolResults");
    });
    test("escalate_count >= 1 → escalate", () => {
      expect(routeAfterExecute({ escalate_count: 1 })).toBe("fc_Escalate");
    });
  });

  describe("routeAfterMerge", () => {
    test("under max → back to CheckSteps", () => {
      expect(routeAfterMerge({ fc_super_step_count: 1 })).toBe("fc_CheckSteps");
    });
    test("at max → FinalResponseStep", () => {
      expect(routeAfterMerge({ fc_super_step_count: 3 })).toBe("FinalResponseStep");
    });
  });
});
