'use strict';

/**
 * 核心 Agent 类
 * 负责注册和调度各个领域的 Skill（技能）
 */
class Agent {
  constructor() {
    this.skills = new Map();
  }

  /**
   * 注册一个新的技能
   * @param {Object} skill 技能对象，需包含 name, description 和 handler
   */
  register(skill) {
    if (!skill || !skill.name || typeof skill.handler !== 'function') {
      throw new Error('Invalid Skill: Must provide name and handler function');
    }
    this.skills.set(skill.name, skill);
    console.log(`[Agent] Skill registered: ${skill.name}`);
  }

  /**
   * 调度并执行指定的技能
   * @param {string} skillName 技能名称
   * @param {Object} context 运行该技能所需的上下文参数
   * @returns {Promise<any>} 技能的执行结果
   */
  async execute(skillName, context = {}) {
    const skill = this.skills.get(skillName);
    if (!skill) {
      throw new Error(`[Agent] Skill not found: ${skillName}`);
    }
    try {
      console.log(`[Agent] Executing skill: ${skillName}`);
      return await skill.handler(context);
    } catch (err) {
      console.error(`[Agent] Error executing skill ${skillName}:`, err.message);
      throw err;
    }
  }
}

module.exports = Agent;