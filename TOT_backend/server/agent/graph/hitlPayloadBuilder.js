'use strict';

/**
 * HITL (Human-in-the-Loop) payload 构建器。
 *
 * 从 fc_ValidateParams 抽取两个 HITL 触发场景：
 *   1. buildLowConfidenceInterrupt — 实体置信度过低，需要用户澄清
 *   2. buildMissingParamInterrupt — 参数修复次数耗尽，需要用户补充必填字段
 *
 * 共享 helper queryEntityCandidates 封装三路数据库查询（store/task/region），
 * 消除 fc_ValidateParams 中的重复代码。
 */

const { db } = require('../../db');
const chatToolsService = require('../../services/chatToolsService');
const decisionRules = require('./decisionRules');

// ─── Shared: database candidate lookup ─────────────────────────────────

/**
 * 根据字段名从 stores/tasks 表查询候选项。
 * 返回最多 6 条 { id, label, value, meta } 记录。
 */
function queryEntityCandidates(field) {
  const opts = [];
  try {
    if (field === 'storeId' || field === 'store') {
      const stores = db.all('SELECT id, name, region FROM stores ORDER BY name LIMIT 8');
      for (const s of stores) {
        opts.push({
          id: `db_${field}_${s.id}`,
          label: `${s.name} (${s.region}, ${s.id})`,
          value: s.id,
          meta: { field, value: s.id },
        });
      }
    } else if (field === 'taskName' || field === 'productName' || field === 'task') {
      const tasks = db.all("SELECT id, title FROM tasks WHERE status = 'dispatched' ORDER BY created_at DESC LIMIT 8");
      for (const t of tasks) {
        opts.push({
          id: `db_${field}_${t.id}`,
          label: t.title,
          value: t.title,
          meta: { field, value: t.title },
        });
      }
    } else if (field === 'region') {
      const regions = db.all('SELECT DISTINCT region FROM stores WHERE region IS NOT NULL ORDER BY region LIMIT 8');
      for (const r of regions) {
        opts.push({
          id: `db_${field}_${r.region}`,
          label: r.region,
          value: r.region,
          meta: { field, value: r.region },
        });
      }
    }
  } catch (e) {
    console.warn('[fc_ValidateParams] 数据库候选查询失败:', e.message);
  }
  if (opts.length > 6) opts.length = 6;
  return opts;
}

// ─── Schema enum candidate extraction ───────────────────────────────────

function _extractEnumOptions(field, toolMeta) {
  const opts = [];
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
  return opts;
}

// ─── Low-confidence entity interrupt ────────────────────────────────────

/**
 * 检查 entities_confidence，若有低于阈值的实体则构建 HITL 澄清 payload。
 *
 * @param {object} state — 当前 state（需要 entities / entities_confidence）
 * @param {object[]} resolvedToolCalls — 当前 pending tool calls
 * @returns {object|null}
 *   - 返回 state partial（含 interrupt_payload + fc_next_action:'hitl'）需要 HITL
 *   - 返回 { mode:'chat_only', fc_next_action:'finalize' } 无可用候选项，走闲聊
 *   - 返回 null 无低置信实体，继续正常流程
 */
function buildLowConfidenceInterrupt(state, resolvedToolCalls, entitiesConfidenceOverride) {
  // 使用调用方传入的 entitiesConfidence（可能已被 resume 路径提升），
  // 而非直接取 state.entities_confidence，否则 resume 后 HITL 会误触发。
  const entitiesConfidence = entitiesConfidenceOverride || state.entities_confidence || {};
  const lowConfidenceEntities = decisionRules.getLowConfidenceEntities(entitiesConfidence, state.entities);
  if (lowConfidenceEntities.length === 0) return null;

  const firstField = lowConfidenceEntities[0][0];
  const entityObj = (state.entities || {})[firstField] || {};
  const raw = entityObj.raw || '';
  const canonical = entityObj.canonical || '';

  // DB 查询候选
  const options = queryEntityCandidates(firstField);

  // entity 有名字面/规范值 → 优先用
  if (canonical) {
    options.unshift({
      id: `confirm_${firstField}_${canonical}`,
      label: `就是「${canonical}」`,
      meta: { field: firstField, value: canonical },
    });
  }
  if (raw && raw !== canonical) {
    options.unshift({
      id: `confirm_${firstField}_raw`,
      label: `按字面理解「${raw}」`,
      meta: { field: firstField, value: raw },
    });
  }

  // 始终提供"其他"
  options.push({
    id: `clarify_${firstField}_other`,
    label: '都不是，我重新描述',
    meta: { field: firstField, intent_shift: true },
  });

  // 如果连对话历史里也提取不到候选项，不弹 HITL——走闲聊处理
  const hasRealOptions = options.some(o => !o.meta?.intent_shift);
  if (!hasRealOptions) {
    return { mode: 'chat_only', intent: 'chat_only', fc_next_action: 'finalize' };
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
    context: { field: firstField, raw, canonical, confidence: entitiesConfidence[firstField] },
  };

  return {
    hitl_status: 'pending_interrupt',
    interrupt_payload: payload,
    pending_tool_calls: resolvedToolCalls,
    fc_next_action: 'hitl',
  };
}

// ─── Missing-required-param interrupt ───────────────────────────────────

/**
 * 参数修复次数耗尽且所有违规都是可修复的 MISSING_PARAM → 升级到 HITL。
 *
 * @param {string[]} fields — 缺失的必填字段列表
 * @param {object} firstViolation — violations[0]（取 tool_call_id 用作 resume_token）
 * @param {object[]} resolvedToolCalls — 当前 pending tool calls
 * @param {object} toolMeta — 第一个 tool call 的 meta（查 schema enum）
 * @returns {object} state partial（含 interrupt_payload + fc_next_action:'hitl'）
 */
function buildMissingParamInterrupt(fields, firstViolation, resolvedToolCalls, toolMeta) {
  const fieldOptions = {};

  for (const field of fields) {
    const opts = [];

    // 1) schema enum 值
    const enumOpts = _extractEnumOptions(field, toolMeta);
    opts.push(...enumOpts);

    // 2) 数据库查询候选项
    if (opts.length === 0) {
      const dbOpts = queryEntityCandidates(field);
      opts.push(...dbOpts);
    }

    // 3) "其他" 选项始终在最后
    opts.push({
      id: `other_${field}`,
      label: '都不是，我重新描述',
      value: null,
      meta: { field, intent_shift: true },
    });

    fieldOptions[field] = opts;
  }

  const allOptions = Object.values(fieldOptions).flat();
  const hasOptions = allOptions.some(o => !o.meta?.intent_shift);

  const payload = {
    type: hasOptions ? 'select' : 'input',
    prompt: hasOptions
      ? `请选择或补充 ${fields.join('、')}：`
      : `还需要您补充：${fields.join('、')}。请直接告诉我具体值。`,
    options: hasOptions ? allOptions : [],
    agent_id: 'executive_chat',
    reason: 'missing_required_param',
    resume_token: firstViolation.tool_call_id || resolvedToolCalls[0]?.id || `mp_${fields[0]}`,
    context: { missingFields: fields, fieldOptions },
  };

  return {
    hitl_status: 'pending_interrupt',
    interrupt_payload: payload,
    pending_tool_calls: resolvedToolCalls,
    fc_next_action: 'hitl',
  };
}

module.exports = {
  queryEntityCandidates,
  buildLowConfidenceInterrupt,
  buildMissingParamInterrupt,
};
