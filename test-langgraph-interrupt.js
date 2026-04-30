const { StateGraph, Annotation } = require("@langchain/langgraph");
const { interrupt } = require("@langchain/langgraph");
const { MemorySaver } = require("@langchain/langgraph-checkpoint");

const State = Annotation.Root({
  count: Annotation({ reducer: (x, y) => x + y, default: () => 0 }),
});

const node1 = (state) => {
  console.log("In node1");
  const response = interrupt("please clarify");
  console.log("Received:", response);
  return { count: 1 };
};

const graph = new StateGraph(State)
  .addNode("node1", node1)
  .addEdge("__start__", "node1")
  .addEdge("node1", "__end__")
  .compile({ checkpointer: new MemorySaver() });

async function run() {
  try {
    const res = await graph.invoke({ count: 0 }, { configurable: { thread_id: "1" } });
    console.log("Invoke returned:", res);
  } catch (e) {
    console.error("Invoke threw:", e.name, e.message);
  }
}
run();
