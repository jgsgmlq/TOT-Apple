const { contextAnalyzerRouter } = require('../agent/graph/nodes/routerNode');
const modelFactory = require('../agent/graph/modelFactory');

async function test() {
  const mockState = {
    userMessage: "现在有哪些进行中的培训任务？",
    memory_snippets: []
  };

  // Mock getRouterModel to simulate the bad LLM response
  const oldGetRouterModel = modelFactory.getRouterModel;
  
  modelFactory.getRouterModel = () => ({
    invoke: async () => ({
      content: JSON.stringify({
        mode: "chat_only",
        intent: "project_status",
        entities: {},
        entities_confidence: {},
        complexity_score: 0.3,
        risk_flags: false
      })
    })
  });

  const res = await contextAnalyzerRouter(mockState);
  console.log("Final mode:", res.mode); // Should be "tool_action"
  
  modelFactory.getRouterModel = oldGetRouterModel;
}
test();
