'use strict';

const { ChatOpenAI } = require("@langchain/openai");

const apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
const baseURL = process.env.DEEPSEEK_API_BASE_URL || "https://api.deepseek.com/v1";

// 共享 base 配置，各模型只覆写差异参数
const baseConfig = { modelName: "deepseek-chat", apiKey, configuration: { baseURL } };

const routerModel = new ChatOpenAI({ ...baseConfig, temperature: 0.1, maxTokens: 512 });

const fcModel = new ChatOpenAI({ ...baseConfig, temperature: 0.1, maxTokens: process.env.DEEPSEEK_REASONER === 'true' ? 4096 : 2048, streaming: true, ...(process.env.DEEPSEEK_REASONER === 'true' ? { modelName: "deepseek-reasoner" } : {}) });

const structuredModel = new ChatOpenAI({ ...baseConfig, temperature: 0.1, maxTokens: 2048, streaming: true, modelKwargs: { response_format: { type: "json_object" } } });

const titleModel = new ChatOpenAI({ ...baseConfig, temperature: 0, maxTokens: 32 });

const memoryModel = new ChatOpenAI({ ...baseConfig, temperature: 0.1, maxTokens: 512 });

function getStructuredModel() { return structuredModel; }
function getTitleModel() { return titleModel; }
function getMemoryModel() { return memoryModel; }

module.exports = { routerModel, fcModel, getStructuredModel, getTitleModel, getMemoryModel };
