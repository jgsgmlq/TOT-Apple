'use strict';

const { ChatOpenAI } = require("@langchain/openai");

const apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
const baseURL = process.env.DEEPSEEK_API_BASE_URL || "https://api.deepseek.com/v1";

const routerModel = new ChatOpenAI({
  modelName: "deepseek-chat",
  apiKey,
  configuration: { baseURL },
  temperature: 0.1,
  maxTokens: 512,
});

const fcModel = new ChatOpenAI({
  modelName: "deepseek-chat",
  apiKey,
  configuration: { baseURL },
  temperature: 0.1,
  maxTokens: 2048,
  streaming: true,
});

module.exports = { routerModel, fcModel };
