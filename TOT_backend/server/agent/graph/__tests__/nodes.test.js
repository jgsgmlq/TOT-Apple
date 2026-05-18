'use strict';

const { fc_CheckSteps } = require("../nodes/fc_CheckSteps");
const { fc_ParamRepair } = require("../nodes/fc_ParamRepair");

describe("Non-LLM node functions", () => {
  // ─── fc_CheckSteps ──────────────────────────────────────────

  describe("fc_CheckSteps", () => {
    test("increments step counter from 0 to 1 on first call", async () => {
      const state = {
        fc_super_step_count: 0,
        selected_tier: "L3_fc_guarded",
        meta_trace_id: "",
      };
      const result = await fc_CheckSteps(state);
      expect(result.fc_super_step_count).toBe(1);
      expect(result.fc_next_action).toBe("");
    });

    test("increments from 2 to 3", async () => {
      const state = {
        fc_super_step_count: 2,
        selected_tier: "L3_fc_guarded",
        meta_trace_id: "",
      };
      const result = await fc_CheckSteps(state);
      expect(result.fc_super_step_count).toBe(3);
    });

    test("handles undefined fc_super_step_count as 1", async () => {
      const state = { meta_trace_id: "" };
      const result = await fc_CheckSteps(state);
      expect(result.fc_super_step_count).toBe(1);
    });
  });

  // ─── fc_ParamRepair ─────────────────────────────────────────

  describe("fc_ParamRepair", () => {
    test("returns validate when no pending tool calls", async () => {
      const state = {
        pending_tool_calls: [],
        fc_repair_attempts: 0,
        repair_error_reason: "",
        entities: {},
        meta_trace_id: "",
      };
      const result = await fc_ParamRepair(state);
      expect(result.fc_next_action).toBe("validate");
    });

    test("fills missing param from entities", async () => {
      const state = {
        pending_tool_calls: [
          { id: "call_1", name: "getRegionDetailData", args: {} },
        ],
        fc_repair_attempts: 0,
        repair_error_reason: JSON.stringify({
          call_1: [
            { field: "region", code: "MISSING_PARAM", message: "region is required" },
          ],
        }),
        entities: {
          region: { canonical: "华东", raw: "华东", confidence: 0.9 },
        },
        meta_trace_id: "",
      };
      const result = await fc_ParamRepair(state);
      expect(result.fc_next_action).toBe("validate");
      expect(result.pending_tool_calls[0].args.region).toBe("华东");
    });

    test("uses repairValue from validation layer when provided", async () => {
      const state = {
        pending_tool_calls: [
          { id: "call_1", name: "queryExecutiveMetrics", args: {} },
        ],
        fc_repair_attempts: 1,
        repair_error_reason: JSON.stringify({
          call_1: [
            { field: "dimensions", code: "INVALID_ENUM", repairValue: "channel_l3" },
          ],
        }),
        entities: {},
        meta_trace_id: "",
      };
      const result = await fc_ParamRepair(state);
      expect(result.pending_tool_calls[0].args.dimensions).toBe("channel_l3");
    });
  });
});
