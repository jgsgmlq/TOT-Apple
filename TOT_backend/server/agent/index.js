'use strict';

const Agent = require('./core');
const generateNudgeSkill = require('./skills/generateNudge');
const generateTaskDescriptionSkill = require('./skills/generateTaskDesc');
const { generateNudgeSkillDeepSeek } = require('./skills/generateNudge');
const { generateTaskDescriptionSkillDeepSeek } = require('./skills/generateTaskDesc');
const parseTaskSkillDeepSeek = require('./skills/parseTask');
const dashboardDiagnoseSkill = require('./skills/dashboardDiagnose');

// 实例化系统全局 AI Agent
const mainAgent = new Agent();

// 注册所有能力（Gemini / DeepSeek 各一套，execute 时用不同 name）
mainAgent.register(generateNudgeSkill);
mainAgent.register(generateTaskDescriptionSkill);
mainAgent.register(generateNudgeSkillDeepSeek);
mainAgent.register(generateTaskDescriptionSkillDeepSeek);
mainAgent.register(parseTaskSkillDeepSeek);
mainAgent.register(dashboardDiagnoseSkill);

module.exports = mainAgent;