'use strict';

const { fc_CheckSteps } = require("../nodes/fc_CheckSteps");

describe("Non-LLM node functions", () => {
  describe("fc_CheckSteps", () => {
    test("increments step counter from 0 to 1 on first call", async () => {
      const state = { fc_super_step_count: 0, meta_trace_id: "" };
      const result = await fc_CheckSteps(state);
      expect(result.fc_super_step_count).toBe(1);
      expect(result.fc_next_action).toBe("");
    });

    test("increments from 2 to 3", async () => {
      const state = { fc_super_step_count: 2, meta_trace_id: "" };
      const result = await fc_CheckSteps(state);
      expect(result.fc_super_step_count).toBe(3);
    });

    test("handles undefined fc_super_step_count as 1", async () => {
      const state = { meta_trace_id: "" };
      const result = await fc_CheckSteps(state);
      expect(result.fc_super_step_count).toBe(1);
    });
  });
});
