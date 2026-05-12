'use strict';

const { AIMessage, ToolMessage } = require("@langchain/core/messages");
const crypto = require('crypto');
const chatToolsService = require('../../../services/chatToolsService');
const chatSessionStateService = require('../../../services/chatSessionStateService');
const RoutingPolicy = require('../routingPolicy');
const { buildToolSignature, getLastAiToolCalls, safeParseJson, safeJsonContent, makeToolMessage } = require('../toolCallUtils');
const { buildLowConfidenceInterrupt, buildMissingParamInterrupt } = require('../hitlPayloadBuilder');
const { getClient, endSpan, argsHash, keyedFields, maskPII, preview } = require("../../../utils/tracer");

const computeToolCallSignature = buildToolSignature;

const startNodeSpan = (state, name, input) => {
  const traceId = state.meta_trace_id;
  if (!traceId) return null;
  try { const client = getClient(); return client ? client.span({ traceId, name, input }) : null; }
  catch { return null; }
};

const fc_CheckDuplicate = async (state) => {
  const span = startNodeSpan(state, 'FC_CheckDuplicate', {});
  const { toolCalls } = getLastAiToolCalls(state);
  if (toolCalls.length === 0) return { fc_next_action: 'finalize' };

  const scopeFp = chatSessionStateService.buildScopeFingerprint(state.regionScope);
  const pendingToolCalls = [];
  const toolResults = {};
  const sigToToolCallId = new Map();

  for (const toolCall of toolCalls) {
    const toolName = toolCall.name;
    const freshnessBucketMs = chatToolsService.getToolFreshnessBucketMs(toolName);
    const signature = buildToolSignature(toolName, toolCall.args, scopeFp, { bucketMs: freshnessBucketMs });

    const dupId = sigToToolCallId.get(signature);
    if (dupId) { toolResults[toolCall.id] = { signature, data: null, alias_of: dupId }; continue; }
    sigToToolCallId.set(signature, toolCall.id);

    const existingResult = Object.values(state.toolResults || {}).find(r => r?.signature === signature && r?.data);
    if (existingResult) { toolResults[toolCall.id] = { signature, data: existingResult.data }; continue; }

    const sessionCached = chatSessionStateService.getLatestBySignature(state.sessionId, signature, state.regionScope);
    if (sessionCached) { toolResults[toolCall.id] = { signature, data: sessionCached.data }; continue; }

    pendingToolCalls.push(toolCall);
  }

  if (pendingToolCalls.length === 0) { endSpan(span, { output: 'all deduped' }); return { toolResults, fc_next_action: 'merge' }; }
  endSpan(span, { output: `${pendingToolCalls.length} new calls` });
  return { toolResults, pending_tool_calls: pendingToolCalls, fc_next_action: 'validate' };
};

const flattenEntitiesForRepair = (entities) => {
  const out = {};
  for (const [k, v] of Object.entries(entities || {})) {
    if (v == null) continue;
    if (typeof v === 'object' && !Array.isArray(v)) {
      if (v.canonical !== undefined && v.canonical !== null && v.canonical !== '') out[k] = v.canonical;
      else if (v.raw !== undefined && v.raw !== null && v.raw !== '') out[k] = v.raw;
    } else out[k] = v;
  }
  return out;
};

const fc_ValidateParams = async (state) => {
  const span = startNodeSpan(state, 'FC_ValidateParams', { toolCount: (state.pending_tool_calls || []).length });
  const pendingToolCalls = state.pending_tool_calls || [];
  const confidenceThreshold = RoutingPolicy.thresholds.ner_confidence ?? 0.85;
  const justResumed = state.hitl_status === 'resumed';
  const resumePatch = justResumed ? (state.hitl_resume_payload || {}) : null;

  let entitiesConfidence = state.entities_confidence || {};
  if (justResumed) entitiesConfidence = Object.fromEntries(Object.entries(entitiesConfidence).map(([k, v]) => [k, v < confidenceThreshold ? 1.0 : v]));
  let entitiesPatch = null;
  if (resumePatch?.entities) entitiesPatch = resumePatch.entities;
  if (resumePatch?.entities_confidence) entitiesConfidence = { ...entitiesConfidence, ...resumePatch.entities_confidence };

  let resolvedToolCalls = pendingToolCalls;
  if (resumePatch?.toolArgsPatch) resolvedToolCalls = pendingToolCalls.map(tc => { const patch = resumePatch.toolArgsPatch[tc.id]; return patch ? { ...tc, args: { ...(tc.args || {}), ...patch } } : tc; });

  const hitlReset = justResumed ? { hitl_status: 'idle', hitl_resume_payload: null } : {};
  const entitiesUpdate = (justResumed || entitiesPatch) ? { entities_confidence: entitiesConfidence, ...(entitiesPatch ? { entities: { ...(state.entities || {}), ...entitiesPatch } } : {}) } : {};

  if (resolvedToolCalls.length === 0) return { ...hitlReset, ...entitiesUpdate, fc_next_action: 'finalize' };

  const validatedToolCalls = [];
  const toolResults = { ...(state.toolResults || {}) };
  const violationsByToolCall = {};

  const lcInterrupt = buildLowConfidenceInterrupt(state, resolvedToolCalls, entitiesConfidence);
  if (lcInterrupt) {
    if (lcInterrupt.fc_next_action === 'finalize') return { ...hitlReset, ...entitiesUpdate, ...lcInterrupt, messages: [new AIMessage({ content: '' })] };
    return { ...hitlReset, ...entitiesUpdate, ...lcInterrupt };
  }

  for (const toolCall of resolvedToolCalls) {
    const toolName = chatToolsService.normalizeToolName(toolCall.name);
    const args = typeof toolCall.args === 'object' && toolCall.args ? toolCall.args : (toolCall.args || {});
    const meta = chatToolsService.getToolMeta(toolName);
    const violations = [];

    if (!meta) {
      violations.push({ tool_call_id: toolCall.id, field: 'toolName', code: 'INVALID_TOOL', message: `工具 ${toolName} 不存在`, repairable: false });
    } else {
      if (meta.schema) {
        const argCheck = chatToolsService.validateToolArgs(toolName, meta.schema, args);
        for (const v of argCheck.violations) violations.push({ tool_call_id: toolCall.id, ...v });
      }
      const authCheck = chatToolsService.authorizeToolCall(toolName, meta, { regionScope: state.regionScope, userRoles: state.regionScope?.userRoles || ['executive'] });
      for (const v of authCheck.violations) violations.push({ tool_call_id: toolCall.id, ...v });
    }

    if (violations.length > 0) { violationsByToolCall[toolCall.id] = violations; continue; }
    validatedToolCalls.push(toolCall);
  }

  if (Object.keys(violationsByToolCall).length > 0) {
    const allViolations = Object.values(violationsByToolCall).flat();
    const hasUnrepairable = allViolations.some(v => !v.repairable);
    const maxRepairAttempts = RoutingPolicy.tiers[state.selected_tier]?.max_repair_attempts ?? 2;
    const reachedRepairCap = state.fc_repair_attempts >= maxRepairAttempts;

    if (hasUnrepairable || reachedRepairCap) {
      const missingParams = allViolations.filter(v => v.repairable && v.code === 'MISSING_PARAM' && v.field);
      const onlyMissingRepairable = !hasUnrepairable && reachedRepairCap && missingParams.length > 0;
      if (onlyMissingRepairable) {
        const fields = Array.from(new Set(missingParams.map(v => v.field)));
        const mpInterrupt = buildMissingParamInterrupt(fields, missingParams[0], resolvedToolCalls, chatToolsService.getToolMeta(resolvedToolCalls[0]?.name || ''));
        return { ...hitlReset, ...entitiesUpdate, ...mpInterrupt };
      }
      const errorMsg = allViolations.map(v => v.message).join('; ');
      return { ...hitlReset, ...entitiesUpdate, mode: 'chat_only', intent: 'chat_only', finalResponse: `SYSTEM_ERROR: 工具参数校验失败。${errorMsg}`, messages: [new AIMessage({ content: `很抱歉，我无法执行该操作：${errorMsg}` })], fc_next_action: 'finalize' };
    }
    return { ...hitlReset, ...entitiesUpdate, fc_repair_attempts: state.fc_repair_attempts + 1, repair_error_reason: JSON.stringify(violationsByToolCall), pending_tool_calls: resolvedToolCalls, fc_next_action: 'repair' };
  }

  endSpan(span, { output: `execute ${validatedToolCalls.length} tools` });
  return { ...hitlReset, ...entitiesUpdate, pending_tool_calls: validatedToolCalls, toolResults, fc_next_action: 'execute' };
};

const fc_ParamRepair = async (state) => {
  const span = startNodeSpan(state, 'FC_ParamRepair', { attempts: state.fc_repair_attempts });
  const pendingToolCalls = state.pending_tool_calls || [];
  if (pendingToolCalls.length === 0) { endSpan(span, { output: 'skip' }); return { fc_next_action: 'validate' }; }

  let violationsByToolCall = {};
  try { violationsByToolCall = JSON.parse(state.repair_error_reason || '{}'); } catch { violationsByToolCall = {}; }
  const entityMap = flattenEntitiesForRepair(state.entities);

  const repaired = pendingToolCalls.map(toolCall => {
    const violations = Array.isArray(violationsByToolCall[toolCall.id]) ? violationsByToolCall[toolCall.id] : [];
    const args = typeof toolCall.args === 'object' && toolCall.args ? { ...toolCall.args } : {};
    for (const v of violations) {
      if (!v?.field) continue;
      if (v.repairValue !== undefined) { args[v.field] = v.repairValue; continue; }
      if (v.code === 'MISSING_PARAM' && entityMap[v.field] !== undefined) { args[v.field] = entityMap[v.field]; continue; }
    }
    return { ...toolCall, args };
  });

  endSpan(span, { output: `repaired ${repaired.length}` });
  return { pending_tool_calls: repaired, fc_next_action: 'validate' };
};

const inspectToolResult = (rawResult) => {
  if (rawResult && typeof rawResult === 'object') {
    if (rawResult.error && typeof rawResult.error === 'object') return { ok: false, errorCode: rawResult.error.code || 'EXECUTION_ERROR', errorMessage: rawResult.error.message || '工具执行失败' };
    if (rawResult.success === false) return { ok: false, errorCode: rawResult.errorCode || 'EXECUTION_ERROR', errorMessage: rawResult.message || '工具执行失败' };
  }
  return { ok: true, errorCode: null, errorMessage: null };
};

const fc_ExecuteTool = async (state, config) => {
  const emitter = config?.configurable?.sseEmitter;
  const traceId = config?.configurable?.traceId;
  const pendingToolCalls = state.pending_tool_calls || [];
  if (pendingToolCalls.length === 0) return { fc_next_action: 'merge' };

  const toolResults = {};
  const calledTools = [];
  let denyShortCircuit = null;

  for (const toolCall of pendingToolCalls) {
    const toolName = chatToolsService.normalizeToolName(toolCall.name);
    const internalToolName = toolName.startsWith(`${state.tool_namespace}.`) ? toolName.replace(`${state.tool_namespace}.`, '') : toolName;

    if (denyShortCircuit) {
      const skipResult = JSON.stringify({ error: { code: 'SKIPPED_AFTER_DENY', message: '前序工具被拒绝，本工具未执行' } });
      toolResults[toolCall.id] = { data: skipResult, signature: null, error: true };
      if (emitter?.handleToolStart) emitter.handleToolStart({ name: internalToolName, status: 'skipped' });
      if (emitter?.handleToolEnd) emitter.handleToolEnd(skipResult, { status: 'skipped' });
      continue;
    }

    if (emitter?.handleToolStart) emitter.handleToolStart({ name: internalToolName });

    let toolSpan = null;
    if (traceId) try { const lf = getClient(); if (lf) toolSpan = lf.trace({ id: traceId }).span({ name: `Tool_Call:${internalToolName}`, input: { toolCallId: toolCall.id, toolName: internalToolName, argsHash: argsHash(toolCall.args || {}), argFields: keyedFields(toolCall.args || {}) }, metadata: { namespace: state.tool_namespace, selectedTier: state.selected_tier } }); } catch {}

    let finalResult, inspect = { ok: true, errorCode: null, errorMessage: null };
    try {
      const rawResult = await chatToolsService.executeByName(internalToolName, toolCall.args || {}, state.regionScope);
      inspect = inspectToolResult(rawResult);
      finalResult = typeof rawResult === 'object' ? JSON.stringify(rawResult) : String(rawResult);
      endSpan(toolSpan, { output: maskPII(preview(finalResult, 500)), level: inspect.ok ? undefined : 'ERROR', statusMessage: inspect.ok ? undefined : inspect.errorMessage, metadata: { status: inspect.ok ? 'success' : 'error', toolCallId: toolCall.id, errorCode: inspect.errorCode || undefined } });
    } catch (err) {
      inspect = { ok: false, errorCode: 'EXECUTION_ERROR', errorMessage: err.message };
      finalResult = JSON.stringify({ error: { code: 'EXECUTION_ERROR', message: err.message } });
      endSpan(toolSpan, { output: preview(finalResult, 500), level: 'ERROR', statusMessage: err.message, metadata: { status: 'error', toolCallId: toolCall.id, errorCode: 'EXECUTION_ERROR' } });
    }

    if (emitter?.handleToolEnd) emitter.handleToolEnd(finalResult, { status: inspect.ok ? 'success' : 'error', errorCode: inspect.errorCode || undefined });
    toolResults[toolCall.id] = { data: finalResult, signature: null, error: !inspect.ok, errorCode: inspect.errorCode || null };
    calledTools.push(internalToolName);
    if (!inspect.ok && inspect.errorCode === 'PERMISSION_DENIED') denyShortCircuit = { toolCallId: toolCall.id, errorCode: inspect.errorCode };
  }

  return { toolResults, calledTools, fc_next_action: 'merge' };
};

const fc_MergeToolResults = async (state) => {
  const span = startNodeSpan(state, 'FC_MergeToolResults', { toolResultKeys: Object.keys(state.toolResults || {}) });
  let anchor = null;
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const m = state.messages[i];
    if (m?._getType?.() === 'ai' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) { anchor = m; break; }
  }
  if (!anchor) return { fc_next_action: '' };

  const anchorIdx = state.messages.lastIndexOf(anchor);
  const alreadyEmitted = new Set();
  for (let i = anchorIdx + 1; i < state.messages.length; i++) { const m = state.messages[i]; if (m?._getType?.() === 'tool' && m.tool_call_id) alreadyEmitted.add(m.tool_call_id); }

  const newMessages = [];
  const scopeFp = chatSessionStateService.buildScopeFingerprint(state.regionScope);
  let fallbackBump = 0;

  const isErrorPayload = (data) => { if (typeof data !== 'string') return false; try { return !!(JSON.parse(data)?.error?.code); } catch { return false; } };

  for (const toolCall of anchor.tool_calls) {
    if (alreadyEmitted.has(toolCall.id)) continue;
    let resultObj = state.toolResults?.[toolCall.id];
    if (resultObj?.alias_of && !resultObj.data) { const sibling = state.toolResults?.[resultObj.alias_of]; if (sibling?.data) resultObj = { signature: resultObj.signature, data: sibling.data, error: !!sibling.error }; }
    let resultData = resultObj?.data, isError = !!resultObj?.error;
    if (!resultData) { resultData = JSON.stringify({ error: { code: 'NO_TOOL_RESULT', message: 'No data returned' } }); isError = true; fallbackBump += 1; }
    else if (!isError && isErrorPayload(resultData)) isError = true;

    newMessages.push(makeToolMessage(toolCall, resultData));
    if (resultObj && !resultObj.signature && !isError) {
      const freshnessBucketMs = chatToolsService.getToolFreshnessBucketMs(toolCall.name);
      const signature = computeToolCallSignature(toolCall.name, toolCall.args, scopeFp, { bucketMs: freshnessBucketMs });
      chatSessionStateService.addRecord(state.sessionId, { signature, data: resultData }, state.regionScope);
    }
  }

  const updates = { messages: newMessages, pending_tool_calls: [], fc_next_action: '' };
  if (fallbackBump > 0) updates.meta_fallback_count = (state.meta_fallback_count || 0) + fallbackBump;
  endSpan(span, { output: `${newMessages.length} messages merged` });
  return updates;
};

module.exports = { fc_CheckDuplicate, fc_ValidateParams, flattenEntitiesForRepair, fc_ParamRepair, inspectToolResult, fc_ExecuteTool, fc_MergeToolResults };
