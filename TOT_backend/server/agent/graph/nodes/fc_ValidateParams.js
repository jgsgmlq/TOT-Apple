'use strict';

const { AIMessage } = require("@langchain/core/messages");
const { startNodeSpan } = require('../shared/spanHelper');
const { endSpan } = require('../../../utils/tracer');
const chatToolsService = require('../../../services/chatToolsService');
const RoutingPolicy = require('../routingPolicy');
const decisionRules = require('../decisionRules');
const { db } = require('../../db');

// T3 阶段二：真实的参数校验
// 因为我们无法穷举所有工具的 schema，实际业务中应该读取 toolModule.schema.function.parameters
// 然后动态转换为 Ajv 验证，或者如果是 Zod 定义的则直接执行 z.parse()
// 在这里为了 PoC，我们对核心工具（例如 queryExecutiveMetrics）应用明确的 Zod 约束

const fc_ValidateParams = async (state) => {
  const span = startNodeSpan(state, 'FC_ValidateParams', { toolCount: (state.pending_tool_calls || []).length, repairAttempts: state.fc_repair_attempts });
  const pendingToolCalls = state.pending_tool_calls || [];

  // ── HITL resume consumption ─────────────────────────────────────────
  // 防止死循环：HumanInTheLoopGate 恢复后路由回这里时，必须吸收 resume，
  // 否则会再次基于同样的 entities_confidence 触发 HITL，造成无限循环。
  const confidenceThreshold = RoutingPolicy.thresholds.ner_confidence ?? 0.85;
  const justResumed = state.hitl_status === 'resumed';
  const resumePatch = justResumed ? (state.hitl_resume_payload || {}) : null;

  // resume 后的 entities_confidence：对所有低置信项强制提升到 1.0（视为已澄清）
  let entitiesConfidence = state.entities_confidence || {};
  if (justResumed) {
    entitiesConfidence = Object.fromEntries(
      Object.entries(entitiesConfidence).map(([k, v]) => [k, v < confidenceThreshold ? 1.0 : v])
    );
  }
  // 若 resume payload 显式给了 entity patch，覆盖之
  let entitiesPatch = null;
  if (resumePatch && typeof resumePatch === 'object') {
    if (resumePatch.entities && typeof resumePatch.entities === 'object') {
      entitiesPatch = resumePatch.entities;
    }
    if (resumePatch.entities_confidence && typeof resumePatch.entities_confidence === 'object') {
      entitiesConfidence = { ...entitiesConfidence, ...resumePatch.entities_confidence };
    }
  }

  // 若 resume payload 显式给了 args 补丁，按 toolCallId 合并到 pending tool calls
  let resolvedToolCalls = pendingToolCalls;
  if (resumePatch && resumePatch.toolArgsPatch && typeof resumePatch.toolArgsPatch === 'object') {
    resolvedToolCalls = pendingToolCalls.map(tc => {
      const patch = resumePatch.toolArgsPatch[tc.id];
      if (!patch || typeof patch !== 'object') return tc;
      return { ...tc, args: { ...(tc.args || {}), ...patch } };
    });
  }

  // resume 副作用：所有 return 路径都要清空 hitl 状态
  const hitlReset = justResumed ? { hitl_status: 'idle', hitl_resume_payload: null } : {};

  if (resolvedToolCalls.length === 0) return { ...hitlReset, fc_next_action: 'finalize' };

  const validatedToolCalls = [];
  const toolResults = { ...(state.toolResults || {}) };
  const violationsByToolCall = {};
  const lowConfidenceEntities = decisionRules.getLowConfidenceEntities(entitiesConfidence);

  // 实体置信度过低 — 在所有 tool call 校验之前统一走澄清。
  // payload 必须基于真实的低置信实体生成，不能再用 O1/O2 占位。
  if (lowConfidenceEntities.length > 0) {
    const firstField = lowConfidenceEntities[0][0];
    const entityObj = (state.entities || {})[firstField] || {};
    const raw = entityObj.raw || '';
    const canonical = entityObj.canonical || '';
    const options = [];

    // 从数据库查候选项 —— 不猜正则，直接查 stores/tasks 表
    const seen = new Set();
    try {
      if (firstField === 'storeId' || firstField === 'store') {
        const stores = db.all('SELECT id, name, region FROM stores ORDER BY name LIMIT 8');
        for (const s of stores) {
          const label = `${s.name} (${s.region}, ${s.id})`;
          options.push({ id: `db_${firstField}_${s.id}`, label, value: s.id, meta: { field: firstField, value: s.id } });
        }
      } else if (firstField === 'taskName' || firstField === 'productName' || firstField === 'task') {
        const tasks = db.all("SELECT id, title FROM tasks WHERE status = 'dispatched' ORDER BY created_at DESC LIMIT 8");
        for (const t of tasks) {
          options.push({ id: `db_${firstField}_${t.id}`, label: t.title, value: t.title, meta: { field: firstField, value: t.title } });
        }
      } else if (firstField === 'region') {
        const regions = db.all('SELECT DISTINCT region FROM stores WHERE region IS NOT NULL ORDER BY region LIMIT 8');
        for (const r of regions) {
          options.push({ id: `db_${firstField}_${r.region}`, label: r.region, value: r.region, meta: { field: firstField, value: r.region } });
        }
      }
    } catch (e) {
      console.warn('[fc_ValidateParams] 数据库候选查询失败，降级为纯输入:', e.message);
    }
    if (options.length > 6) options.length = 6;

    // entity 有名字面/规范值 → 优先用
    if (canonical) {
      options.unshift({ id: `confirm_${firstField}_${canonical}`, label: `就是「${canonical}」`, meta: { field: firstField, value: canonical } });
    }
    if (raw && raw !== canonical) {
      options.unshift({ id: `confirm_${firstField}_raw`, label: `按字面理解「${raw}」`, meta: { field: firstField, value: raw } });
    }

    // 始终提供"其他"
    options.push({ id: `clarify_${firstField}_other`, label: '都不是，我重新描述', meta: { field: firstField, intent_shift: true } });

    // 如果连对话历史里也提取不到候选项，不弹 HITL——走闲聊处理
    const hasRealOptions = options.some(o => !o.meta?.intent_shift);
    if (!hasRealOptions) {
      console.log(`[fc_ValidateParams] 低置信实体无可用候选项，跳过 HITL → finalize`);
      return {
        ...hitlReset,
        ...entitiesUpdate,
        mode: 'chat_only',
        intent: 'chat_only',
        fc_next_action: 'finalize',
        messages: [new AIMessage({ content: '' })]
      };
    }

    const payload = {
      type: options.length > 1 ? 'select' : 'input',
      prompt: raw
        ? `我对「${raw}」的理解还不够确定，能帮我确认下是指什么吗？`
        : '您的消息比较简短，能帮我确认一下具体想查什么吗？以下是一些可能相关的内容：',
      options,
      agent_id: 'executive_chat',
      reason: 'low_confidence_entity',
      resume_token: resolvedToolCalls[0]?.id || `lc_${firstField}`,
      context: { field: firstField, raw, canonical, confidence: entitiesConfidence[firstField] }
    };
    return {
      ...hitlReset,
      hitl_status: 'pending_interrupt',
      interrupt_payload: payload,
      pending_tool_calls: resolvedToolCalls,
      fc_next_action: 'hitl'
    };
  }

  for (const toolCall of resolvedToolCalls) {
    const toolName = chatToolsService.normalizeToolName(toolCall.name);
    const args = typeof toolCall.args === 'object' && toolCall.args ? toolCall.args : (toolCall.args || {});
    const meta = chatToolsService.getToolMeta(toolName);
    const violations = [];

    console.log(`[fc_ValidateParams] 正在校验工具 ${toolName} 的参数...`);

    if (!meta) {
      violations.push({ tool_call_id: toolCall.id, field: 'toolName', code: 'INVALID_TOOL', message: `工具 ${toolName} 不存在或不可用，请使用候选工具列表中的工具。`, repairable: false });
    } else {
      // 参数 schema 校验：所有 enum/array.items/object.properties/nullable 等深度规则
      // 都收口到 chatToolsService.validateToolArgs，这里只需要把每条 violation 加 tool_call_id。
      // 不要再在节点内手写 type/enum/required 检查 — 维护成本高且容易和 service 层口径漂移。
      if (meta.schema) {
        const argCheck = chatToolsService.validateToolArgs(toolName, meta.schema, args);
        for (const v of argCheck.violations) {
          violations.push({ tool_call_id: toolCall.id, ...v });
        }
      }

      // 角色 / scope 校验：同样收口到 service 层 authorizeToolCall。
      // 不再在 nodes.js 里硬编码 scopePolicy === 'national_only' 之类业务规则；
      // 后续新增业务规则统一加在 service 层，不要散落到 graph 节点。
      const sessionContext = {
        regionScope: state.regionScope,
        userRoles: state.regionScope?.userRoles || ['executive'],
      };
      const authCheck = chatToolsService.authorizeToolCall(toolName, meta, sessionContext);
      for (const v of authCheck.violations) {
        violations.push({ tool_call_id: toolCall.id, ...v });
      }
    }

    if (violations.length > 0) {
      violationsByToolCall[toolCall.id] = violations;
      continue;
    }

    validatedToolCalls.push(toolCall);
  }

  // 持久化 entities 补丁（仅在 resume 路径上触发，常态返回为空）
  const entitiesUpdate = (justResumed || entitiesPatch)
    ? {
        entities_confidence: entitiesConfidence,
        ...(entitiesPatch ? { entities: { ...(state.entities || {}), ...entitiesPatch } } : {}),
      }
    : {};

  if (Object.keys(violationsByToolCall).length > 0) {
    const allViolations = Object.values(violationsByToolCall).flat();
    const hasUnrepairable = allViolations.some(v => !v.repairable);
    const maxRepairAttempts = RoutingPolicy.tiers[state.selected_tier]?.max_repair_attempts ?? 2;
    const reachedRepairCap = state.fc_repair_attempts >= maxRepairAttempts;

    if (hasUnrepairable || reachedRepairCap) {
      // 命中上限时，如果剩下的全是「缺失必填参数」这种用户能补充的错，
      // 就升级到 HITL，让用户直接补；其它（类型错误等）才走兜底文案。
      const missingParams = allViolations.filter(v => v.repairable && v.code === 'MISSING_PARAM' && v.field);
      const onlyMissingRepairable = !hasUnrepairable && reachedRepairCap && missingParams.length > 0;

      if (onlyMissingRepairable) {
        const fields = Array.from(new Set(missingParams.map(v => v.field)));
        const firstViolation = missingParams[0];
        const hitlToolName = resolvedToolCalls[0]?.name || '';
        const toolMeta = chatToolsService.getToolMeta(hitlToolName);

        // 为每个缺失字段收集候选项：
        //   1. schema 中的 enum 值（如 dimensions: ['channel_l3', 'channel_l4', ...]）
        //   2. 对话历史中提到的候选值（门店名、任务名、区域名等）
        const fieldOptions = {};
        for (const field of fields) {
          const opts = [];
          // 1) schema enum 值
          const fieldSchema = toolMeta?.schema?.properties?.[field];
          if (fieldSchema?.items?.enum) {
            for (const ev of fieldSchema.items.enum) {
              opts.push({ id: `enum_${field}_${ev}`, label: ev, value: ev, meta: { field } });
            }
          } else if (fieldSchema?.enum) {
            for (const ev of fieldSchema.enum) {
              opts.push({ id: `enum_${field}_${ev}`, label: ev, value: ev, meta: { field } });
            }
          }
          // 2) 数据库查询候选项（替代正则）
          if (opts.length === 0) {
            try {
              if (field === 'storeId') {
                const stores = db.all('SELECT id, name, region FROM stores ORDER BY name LIMIT 8');
                for (const s of stores) {
                  opts.push({ id: `db_${field}_${s.id}`, label: `${s.name} (${s.region}, ${s.id})`, value: s.id, meta: { field } });
                }
              } else if (field === 'taskName' || field === 'productName') {
                const tasks = db.all("SELECT id, title FROM tasks WHERE status = 'dispatched' ORDER BY created_at DESC LIMIT 8");
                for (const t of tasks) {
                  opts.push({ id: `db_${field}_${t.id}`, label: t.title, value: t.title, meta: { field } });
                }
              } else if (field === 'region') {
                const regions = db.all('SELECT DISTINCT region FROM stores WHERE region IS NOT NULL ORDER BY region LIMIT 8');
                for (const r of regions) {
                  opts.push({ id: `db_${field}_${r.region}`, label: r.region, value: r.region, meta: { field } });
                }
              }
            } catch (e) {
              console.warn('[fc_ValidateParams] missing-param DB query failed:', e.message);
            }
            if (opts.length > 6) opts.length = 6;
          }
          // 3) "其他" 选项始终在最后
          opts.push({ id: `other_${field}`, label: '都不是，我重新描述', value: null, meta: { field, intent_shift: true } });
          fieldOptions[field] = opts;
        }

        const allOptions = Object.values(fieldOptions).flat();
        const hasOptions = allOptions.some(o => !o.meta?.intent_shift); // 除了"其他"之外还有选项

        const payload = {
          type: hasOptions ? 'select' : 'input',
          prompt: hasOptions
            ? `请选择或补充 ${fields.join('、')}：`
            : `还需要您补充：${fields.join('、')}。请直接告诉我具体值。`,
          options: hasOptions ? allOptions : [],
          agent_id: 'executive_chat',
          reason: 'missing_required_param',
          resume_token: firstViolation.tool_call_id || resolvedToolCalls[0]?.id || `mp_${fields[0]}`,
          context: { missingFields: fields, fieldOptions }
        };
        return {
          ...hitlReset,
          ...entitiesUpdate,
          hitl_status: 'pending_interrupt',
          interrupt_payload: payload,
          pending_tool_calls: resolvedToolCalls,
          fc_next_action: 'hitl'
        };
      }

      const errorMsg = allViolations.map(v => v.message).join('; ');
      return {
        ...hitlReset,
        ...entitiesUpdate,
        mode: 'chat_only',
        intent: 'chat_only',
        finalResponse: `SYSTEM_ERROR: 工具参数校验失败。${errorMsg}`,
        messages: [new AIMessage({ content: `很抱歉，我无法执行该操作：${errorMsg}。建议您提供更准确的信息。` })],
        fc_next_action: 'finalize'
      };
    }
    return {
      ...hitlReset,
      ...entitiesUpdate,
      fc_repair_attempts: state.fc_repair_attempts + 1,
      repair_error_reason: JSON.stringify(violationsByToolCall),
      pending_tool_calls: resolvedToolCalls,
      fc_next_action: 'repair'
    };
  }

  return {
    ...hitlReset,
    ...entitiesUpdate,
    pending_tool_calls: validatedToolCalls,
    toolResults,
    fc_next_action: 'execute'
  };
  endSpan(span, { output: `execute ${validatedToolCalls.length} tools` });
};

module.exports = { fc_ValidateParams };
