# AI Agent 架构说明 (P2 前瞻落地)

**版本:** 1.0.0 | **更新日期:** 2026-04-01

---

## 1. 架构定位

在 `04-API-SPEC.md` 中，AI Agent 核心被定义为 P2 阶段的功能集。为了让当前的 AI 生成任务（如：任务下发文案生成、催办提醒文案生成）更具备扩展性和规范性，我们在后端实现了一套基础的 **Agent-Skill 调度框架**。

通过这一层抽象，API 路由层不再直接组装提示词并调用 LLM 接口，而是作为“指令下发方”，由 `Agent` 基于注册的 `Skill` （技能）来完成具体数据的聚合与内容生成。

## 2. 核心概念

### 2.1 Agent (智能体)
代码位置：`server/agent/core.js` 与 `server/agent/index.js`
Agent 是整个 AI 能力的调度中枢。它维护了一个可用的 `skills` 注册表，负责接受上层业务的意图（如：执行某个技能），并自动路由给相应的处理单元。

### 2.2 Skill (技能)
代码位置：`server/agent/skills/`
每个 Skill 代表一项独立、原子化的 AI 能力。Skill 需要定义自己需要的上下文（Context），并在 `handler` 方法中完成：
1. **意图对齐与数据准备**：从 SQLite 中查询关联数据（如：任务状态、员工进度）。
2. **提示词组装**：通过业务模板与获取到的事实数据，组装发送给大模型的 Prompt。
3. **大模型调用与结果返回**：调用 `utils/ai.js` 获取结果并结构化输出。

## 3. 当前已落地的技能

| 技能名称 (name) | 技能描述 (description) | 调用接口 | 对应的 Skill 文件 |
| --- | --- | --- | --- |
| `generate_task_description` | 自动基于指令、时间和平台生成任务下发长说明 | `/api/v1/tasks/ai-generate-description` | `generateTaskDesc.js` |
| `generate_nudge_message` | 基于进度、截止时间、门店完成率生成带紧迫感的催办文案 | `/api/v1/nudges/ai-generate` | `generateNudge.js` |

## 4. 调用示例

路由层不再关注大模型细节，只负责传参：

```javascript
// server/routes/nudge.js
const mainAgent = require('../agent');

router.post('/ai-generate', async (req, res, next) => {
  const result = await mainAgent.execute('generate_nudge_message', {
    taskId: req.body.taskId,
    userId: req.body.userId,
    severity: req.body.severity
  });
  
  res.json({ code: 200, message: 'success', data: result });
});
```

## 5. 演进路线

目前，框架处于基础阶段（人工触发的单次调用）。在未来的 P2 迭代中，Agent 框架将支持：
1. **自动意图识别**：由大模型决定调用哪个 Skill（Function Calling）。
2. **上下文长程记忆**：打通 `Executive Chat Agent` 实现多轮问答。