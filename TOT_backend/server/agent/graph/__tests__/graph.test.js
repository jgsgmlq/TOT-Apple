'use strict';

const { buildGraph } = require("../graph");
const { MemorySaver } = require("@langchain/langgraph");

describe("Executive Chat Graph", () => {
  test("buildGraph compiles and returns a graph", () => {
    const graph = buildGraph();
    expect(graph).toBeDefined();
  });

  test("graph compiles with MemorySaver checkpointer", () => {
    const graph = buildGraph();
    const app = graph.compile({ checkpointer: new MemorySaver() });
    expect(app).toBeDefined();
    expect(typeof app.invoke).toBe("function");
  });

  test("all 13 node modules load independently", () => {
    const nodes = [
      "loadContext",
      "contextAnalyzerRouter",
      "toolRetrieve",
      "fc_CheckSteps",
      "fc_LlmToolCallStep",
      "fc_CheckDuplicate",
      "fc_ValidateParams",
      "fc_ParamRepair",
      "fc_ExecuteTool",
      "fc_MergeToolResults",
      "humanInTheLoopGate",
      "finalResponseStep",
      "persistAndEmit",
    ];
    for (const name of nodes) {
      const mod = require(`../nodes/${name}`);
      expect(mod).toBeDefined();
      expect(Object.keys(mod).length).toBeGreaterThan(0);
    }
  });
});
