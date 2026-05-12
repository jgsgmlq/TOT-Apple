'use strict';

const { ChatOpenAI } = require("@langchain/openai");
const chatToolsService = require('../../services/chatToolsService');
const { FALLBACK_TOOL_NAMES } = require('./toolIndex');

const getRouterModel = () => new ChatOpenAI({
  modelName: "deepseek-chat",
  apiKey: process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: process.env.DEEPSEEK_API_BASE_URL || "https://api.deepseek.com/v1"
  },
  temperature: 0.1,
  maxTokens: 512,
  modelKwargs: {
    response_format: { type: "json_object" }
  }
});

const getFcModel = () => new ChatOpenAI({
  modelName: "deepseek-chat",
  apiKey: process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: process.env.DEEPSEEK_API_BASE_URL || "https://api.deepseek.com/v1"
  },
  temperature: 0.1,
  maxTokens: 2048,
  streaming: true
});

const getLlmWithTools = (candidateTools = null) => {
  const wantedTools = Array.isArray(candidateTools) && candidateTools.length > 0
    ? candidateTools
    : chatToolsService.getRegisteredToolNames();
  let finalTools = chatToolsService.getToolSchemasByNames(wantedTools).map((schema) => ({
    type: "function",
    function: {
      name: schema.function.name,
      description: schema.function.description,
      parameters: schema.function.parameters
    }
  }));

  if (finalTools.length === 0) {
    finalTools = chatToolsService.getToolSchemasByNames(FALLBACK_TOOL_NAMES).map((schema) => ({
      type: "function",
      function: {
        name: schema.function.name,
        description: schema.function.description,
        parameters: schema.function.parameters
      }
    }));
  }

  return finalTools.length > 0 ? getFcModel().bindTools(finalTools) : getFcModel();
};

module.exports = { getRouterModel, getFcModel, getLlmWithTools };
