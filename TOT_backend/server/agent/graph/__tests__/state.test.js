'use strict';

const { ExecChatGraphState } = require("../state");

describe("State definition", () => {
  test("ExecChatGraphState is defined with expected fields", () => {
    expect(ExecChatGraphState).toBeDefined();
    const fields = ExecChatGraphState.spec;
    expect(fields).toBeDefined();
    // Core fields must exist
    expect(fields.sessionId).toBeDefined();
    expect(fields.messages).toBeDefined();
    expect(fields.userMessage).toBeDefined();
    expect(fields.mode).toBeDefined();
    expect(fields.intent).toBeDefined();
    expect(fields.toolResults).toBeDefined();
    expect(fields.fc_super_step_count).toBeDefined();
    expect(fields.fc_next_action).toBeDefined();
    expect(fields.hitl_status).toBeDefined();
    expect(fields.reply_markdown).toBeDefined();
  });

  test("all 30+ state fields are present", () => {
    const count = Object.keys(ExecChatGraphState.spec).length;
    expect(count).toBeGreaterThanOrEqual(30);
  });

  test("messages field has an initial default of empty array", () => {
    const field = ExecChatGraphState.spec.messages;
    expect(field).toBeDefined();
    // initialValueFactory returns default
    if (field.initialValueFactory) {
      expect(field.initialValueFactory()).toEqual([]);
    }
  });
});
