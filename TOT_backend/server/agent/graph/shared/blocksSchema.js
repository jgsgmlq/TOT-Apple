'use strict';

const { z } = require('zod');

const keyNumberItem = z.object({
  label: z.string(),
  value: z.union([z.string(), z.number()]),
  unit: z.string().optional(),
  trend: z.enum(['up', 'down', 'flat']).optional(),
  trendValue: z.string().optional(),
});

const insightItem = z.object({
  level: z.enum(['warning', 'info', 'positive']),
  text: z.string(),
});

const BlockSchemas = {
  markdown:    z.object({ type: z.literal('markdown'), content: z.string() }).passthrough(),
  keyNumbers:  z.object({ type: z.literal('keyNumbers'), items: z.array(keyNumberItem) }).passthrough(),
  chart:       z.object({ type: z.literal('chart'), datasetId: z.string(), chartType: z.enum(['bar','line','pie','scatter','funnel','radar']).optional(), title: z.string().optional() }).passthrough(),
  table:       z.object({ type: z.literal('table'), datasetId: z.string(), title: z.string().optional() }).passthrough(),
  insights:    z.object({ type: z.literal('insights'), items: z.array(insightItem) }).passthrough(),
  suggestions: z.object({ type: z.literal('suggestions'), items: z.array(z.string()) }).passthrough(),
};

const BlocksOutput = z.object({
  blocks: z.array(z.discriminatedUnion('type', [
    BlockSchemas.markdown,
    BlockSchemas.keyNumbers,
    BlockSchemas.chart,
    BlockSchemas.table,
    BlockSchemas.insights,
    BlockSchemas.suggestions,
  ])),
}).passthrough();

const PlannerOutput = z.object({
  questionType: z.enum(["list", "comparison", "trend", "diagnosis", "comprehensive"]),
  analysis: z.string(),
  selectedDatasets: z.array(z.string()),
  suggestedApproach: z.string(),
});

module.exports = { BlocksOutput, BlockSchemas, PlannerOutput };
