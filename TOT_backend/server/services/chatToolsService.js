'use strict';

const fs = require('fs');
const path = require('path');
const { db } = require('../db');
const logger = require('../utils/logger');

// ─── Dynamic Tool Loading ──────────────────────────────────────────────────────
const TOOL_SCHEMAS = [];
const toolHandlers = new Map();
const toolMetas = new Map(); // Store metadata for guardrails
const toolNamespace = 'executive_chat';

function normalizeToolName(toolName) {
  if (!toolName || typeof toolName !== 'string') return '';
  return toolName.includes('.') ? toolName.split('.').pop() : toolName;
}

function loadTools() {
  const toolsDir = path.join(__dirname, '..', 'chat_tools');
  logger.info('tools_loading', { dir: toolsDir });
  if (!fs.existsSync(toolsDir)) {
    logger.warn('tools_dir_missing', { dir: toolsDir });
    return;
  }

  const files = fs.readdirSync(toolsDir).filter(f => f.endsWith('.js'));
  let registered = 0;

  for (const file of files) {
    try {
      const toolModule = require(path.join(toolsDir, file));
      if (toolModule.schema && toolModule.schema.function && toolModule.schema.function.name) {
        // Allow disabling tools via meta flag
        const meta = toolModule.meta || {};
        if (meta.enabled === false) {
           logger.debug('tool_skipped_disabled', { file });
           continue;
        }
        const toolName = toolModule.schema.function.name;
        TOOL_SCHEMAS.push(toolModule.schema);
        toolHandlers.set(toolName, toolModule.handler);
        toolMetas.set(toolName, {
          name: toolName,
          namespaceName: `${toolNamespace}.${toolName}`,
          schema: toolModule.schema.function.parameters,
          requiredRole: meta.requiredRole || [],
          scopePolicy: (() => {
            const VALID_SCOPE_POLICIES = ['national_only', 'regional_scoped', 'public'];
            const p = meta.scopePolicy;
            if (!p || !VALID_SCOPE_POLICIES.includes(p)) {
              throw new Error(
                `[chatToolsService] tool '${toolName}' (${file}) must declare meta.scopePolicy ` +
                `as one of: ${VALID_SCOPE_POLICIES.join(', ')}. Got: ${JSON.stringify(p)}`
              );
            }
            return p;
          })(),
          timeoutMs: meta.timeoutMs || 5000,
          freshness: meta.freshness || 'realtime', // 'realtime' | 'daily' | 'static'
        });
        registered += 1;
        logger.debug('tool_registered', { toolName, file });
      } else {
        logger.warn('tool_schema_invalid', { file });
      }
    } catch (err) {
      logger.error('tool_load_failed', { file, error: err.message });
    }
  }

  logger.info('tools_loaded', { count: registered, files: files.length });
}

// Load tools on module init
loadTools();

// ─── Guardrails ──────────────────────────────────────────────────────────────

function getRegisteredToolNames() {
  return Array.from(toolHandlers.keys());
}

function getToolSchema(toolName) {
  const normalized = normalizeToolName(toolName);
  const schema = TOOL_SCHEMAS.find(item => item?.function?.name === normalized);
  return schema || null;
}

function getToolSchemasByNames(names = []) {
  if (!Array.isArray(names) || names.length === 0) return [];
  const wanted = names.map(normalizeToolName).filter(Boolean);
  const toolMap = new Map();
  TOOL_SCHEMAS.forEach(item => {
    if (item?.function?.name) toolMap.set(item.function.name, item);
  });
  
  return wanted.map(name => toolMap.get(name)).filter(Boolean);
}

// Violation 形状：{ field, code, message, repairable, repairValue?, requires_user_input? }
// 调用方（fc_ValidateParams）会自行 push tool_call_id，所以这里只输出 field 级信息。
function _typeOf(val) {
  if (val === null) return 'null';
  if (Array.isArray(val)) return 'array';
  return typeof val;
}

function _checkType(field, def, val, violations) {
  const expected = def.type;
  if (!expected) return;
  if (val === null && def.nullable === true) return;

  if (expected === 'string' && typeof val !== 'string') {
    violations.push({ field, code: 'INVALID_TYPE', message: `参数 '${field}' 应为 string，实际为 ${_typeOf(val)}`, repairable: true });
    return;
  }
  if (expected === 'number' && typeof val !== 'number') {
    violations.push({ field, code: 'INVALID_TYPE', message: `参数 '${field}' 应为 number，实际为 ${_typeOf(val)}`, repairable: true });
    return;
  }
  if (expected === 'boolean' && typeof val !== 'boolean') {
    violations.push({ field, code: 'INVALID_TYPE', message: `参数 '${field}' 应为 boolean，实际为 ${_typeOf(val)}`, repairable: true });
    return;
  }
  if (expected === 'array' && !Array.isArray(val)) {
    violations.push({ field, code: 'INVALID_TYPE', message: `参数 '${field}' 应为 array，实际为 ${_typeOf(val)}`, repairable: true });
    return;
  }
  if (expected === 'object' && (typeof val !== 'object' || Array.isArray(val) || val === null)) {
    violations.push({ field, code: 'INVALID_TYPE', message: `参数 '${field}' 应为 object，实际为 ${_typeOf(val)}`, repairable: true });
    return;
  }
}

function _validateField(field, def, val, violations) {
  if (val === undefined || val === null) {
    if (val === null && def.nullable === true) return;
    return; // undefined 由 required 检查在上层处理
  }

  _checkType(field, def, val, violations);

  // enum 校验：可修复（repairValue 给第一个枚举值作为提示）
  if (Array.isArray(def.enum) && !def.enum.includes(val)) {
    violations.push({
      field,
      code: 'INVALID_ENUM',
      message: `参数 '${field}' 必须是 [${def.enum.join(', ')}] 之一，实际为 ${JSON.stringify(val)}`,
      repairable: true,
      repairValue: def.enum[0],
    });
  }

  // array.items 校验：每个元素递归
  if (def.type === 'array' && Array.isArray(val) && def.items) {
    val.forEach((item, idx) => {
      const itemField = `${field}[${idx}]`;
      // items 也可能带 enum / properties
      _validateField(itemField, def.items, item, violations);
    });
  }

  // object.properties 校验：每个属性递归（required 在嵌套层也支持）
  if (def.type === 'object' && def.properties && typeof val === 'object' && !Array.isArray(val) && val !== null) {
    if (Array.isArray(def.required)) {
      for (const reqKey of def.required) {
        if (val[reqKey] === undefined) {
          violations.push({
            field: `${field}.${reqKey}`,
            code: 'MISSING_PARAM',
            message: `参数 '${field}.${reqKey}' 是必填的`,
            repairable: true,
          });
        }
      }
    }
    for (const [subKey, subDef] of Object.entries(def.properties)) {
      const subVal = val[subKey];
      if (subVal !== undefined) {
        _validateField(`${field}.${subKey}`, subDef, subVal, violations);
      }
    }
  }
}

/**
 * 校验工具参数。返回 { ok, violations }。
 * 不再 throw — 调用方决定如何处理（fc_ValidateParams 收集成 batch，executeByName 见下）。
 *
 * 支持 JSON Schema 子集：required / type / enum / items / properties / nullable。
 */
function validateToolArgs(toolName, schema, args) {
  const violations = [];
  if (!schema) return { ok: true, violations };

  const safeArgs = args && typeof args === 'object' ? args : {};

  // 顶层 required（缺失必填参数：标记 repairable=true 让 fc_ParamRepair 先试着从上下文推断；
  // 推断失败再升级到 HITL 让用户补。这是与 nodes.js 现有行为对齐的口径，不要随便改）
  if (Array.isArray(schema.required)) {
    for (const reqField of schema.required) {
      if (safeArgs[reqField] === undefined || safeArgs[reqField] === null) {
        violations.push({
          field: reqField,
          code: 'MISSING_PARAM',
          message: `参数 '${reqField}' 是必填的`,
          repairable: true,
        });
      }
    }
  }

  // 顶层 properties 递归
  if (schema.properties) {
    for (const [key, def] of Object.entries(schema.properties)) {
      const val = safeArgs[key];
      _validateField(key, def, val, violations);
    }
  }

  return { ok: violations.length === 0, violations };
}

/**
 * 角色 / scope 校验。返回 { ok, violations }（不再 throw）。
 * 当前规则两条：requiredRole 与 scopePolicy === 'national_only'。
 * 未来扩业务规则统一在这个函数内补，不要散落到 nodes.js。
 */
function authorizeToolCall(toolName, meta, sessionContext) {
  const violations = [];
  const { regionScope, userRoles = ['executive'] } = sessionContext || {};

  if (meta?.requiredRole && Array.isArray(meta.requiredRole) && meta.requiredRole.length > 0) {
    const hasRole = meta.requiredRole.some(role => userRoles.includes(role));
    if (!hasRole) {
      violations.push({
        field: 'role',
        code: 'PERMISSION_DENIED',
        message: `工具 ${toolName} 需要 [${meta.requiredRole.join(', ')}] 角色，当前用户角色为 [${userRoles.join(', ')}]`,
        repairable: false,
      });
    }
  }

  if (meta?.scopePolicy === 'national_only') {
    if (!regionScope || regionScope.type !== 'national') {
      violations.push({
        field: 'scope',
        code: 'PERMISSION_DENIED',
        message: `工具 ${toolName} 仅对全国权限用户开放（当前 scope=${regionScope?.type || 'none'}）`,
        repairable: false,
      });
    }
  }

  if (meta?.scopePolicy === 'regional_scoped') {
    // national 权限可访问所有区域，直接放行
    if (regionScope?.type === 'national') {
      // pass
    } else {
      const hasRegions = Array.isArray(regionScope?.regions) && regionScope.regions.length > 0;
      const hasRtm = typeof regionScope?.rtm === 'string' && regionScope.rtm.trim() !== '';
      if (!hasRegions && !hasRtm) {
        violations.push({
          field: 'scope',
          code: 'PERMISSION_DENIED',
          message: `工具 ${toolName} 需要区域范围限定，但当前 session 未提供有效的 regions 或 rtm`,
          repairable: false,
        });
      }
    }
  }

  // 'public' scopePolicy: no additional check

  return { ok: violations.length === 0, violations };
}

function summarizeArgs(args) {
  if (!args || typeof args !== 'object') return '(none)';
  const keys = Object.keys(args).filter((k) => args[k] != null);
  if (keys.length === 0) return '(empty)';
  return keys.map((k) => {
    const v = args[k];
    if (typeof v === 'string') return `${k}="${v.slice(0, 60)}${v.length > 60 ? '…' : ''}"`;
    if (typeof v === 'number' || typeof v === 'boolean') return `${k}=${v}`;
    if (Array.isArray(v)) return `${k}=[${v.length} items]`;
    if (typeof v === 'object') return `${k}={${Object.keys(v).length} keys}`;
    return `${k}=?`;
  }).join(', ');
}

function summarizeResult(result) {
  if (result === undefined || result === null) return '(void)';
  if (typeof result === 'string') {
    let parsed;
    try { parsed = JSON.parse(result); } catch { /* not JSON */ }
    if (parsed && typeof parsed === 'object') {
      const keys = Object.keys(parsed).filter((k) => !k.startsWith('_'));
      return `JSON{${keys.slice(0, 5).join(', ')}${keys.length > 5 ? ', …' : ''}} (${result.length}c)`;
    }
    return `text (${result.length}c)`;
  }
  if (Array.isArray(result)) return `array[${result.length}]`;
  if (typeof result === 'object') {
    const keys = Object.keys(result).filter((k) => !k.startsWith('_'));
    if (result.error) return `error: ${result.error.code || result.error.message || 'unknown'}`;
    return `object{${keys.slice(0, 5).join(', ')}${keys.length > 5 ? ', …' : ''}}`;
  }
  return String(result).slice(0, 80);
}

async function executeWithTimeout(promise, timeoutMs) {
  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`Tool execution timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([
    promise,
    timeoutPromise
  ]).finally(() => {
    clearTimeout(timeoutHandle);
  });
}

// ─── FC-ready unified dispatch entry point ────────────────────────────────────
/**
 * executeByName — single entry for both intent_routing and FC Loop.
 */
async function executeByName(toolName, params, regionScope) {
  // 1) 工具名白名单存在性校验
  const normalizedToolName = normalizeToolName(toolName);
  const handler = toolHandlers.get(normalizedToolName);
  const meta = toolMetas.get(normalizedToolName);
  if (!handler || !meta) {
    return {
      error: {
        code: 'TOOL_NOT_FOUND',
        message: `Unknown tool requested: ${toolName}.`,
        recommendation: 'Please verify the tool name.'
      }
    };
  }

  // Context wrapper (support passing user roles from upstream)
  const sessionContext = {
    regionScope,
    userRoles: regionScope?.userRoles || ['executive']
  };

  if (!regionScope?.userRoles || !Array.isArray(regionScope.userRoles) || regionScope.userRoles.length === 0) {
    logger.warn('tool_roles_fallback', { toolName, usingFallback: 'executive' });
  }

  const debugGraph = process.env.DEBUG_GRAPH === 'true' || process.env.LOG_LEVEL === 'debug';
  const t0 = Date.now();
  const argsPreview = debugGraph ? summarizeArgs(params) : undefined;
  if (debugGraph) {
    logger.debug('tool_call_start', { tool: normalizedToolName, args: argsPreview });
  }

  try {
    // 2) 参数 schema 校验（结构化 violations，不再 throw）
    const argCheck = validateToolArgs(toolName, meta.schema, params);
    if (!argCheck.ok) {
      return {
        error: {
          code: 'INVALID_PARAMETERS',
          message: `Invalid parameters: ${argCheck.violations[0].message}`,
          violations: argCheck.violations,
        }
      };
    }

    // 3) 角色/区域权限校验（结构化 violations，不再 throw）
    const authCheck = authorizeToolCall(toolName, meta, sessionContext);
    if (!authCheck.ok) {
      return {
        error: {
          code: 'PERMISSION_DENIED',
          message: authCheck.violations[0].message,
          violations: authCheck.violations,
        }
      };
    }

    // 4) 执行与超时保护
    const executionPromise = Promise.resolve(handler(params, regionScope));
    const result = await executeWithTimeout(executionPromise, meta.timeoutMs);

    if (debugGraph) {
      const elapsed = Date.now() - t0;
      logger.debug('tool_call_end', {
        tool: normalizedToolName,
        elapsed: elapsed < 1000 ? `${elapsed}ms` : `${(elapsed / 1000).toFixed(1)}s`,
        elapsedMs: elapsed,
        status: 'ok',
        result: summarizeResult(result),
      });
    }

    return result;
  } catch (err) {
    if (debugGraph) {
      const elapsed = Date.now() - t0;
      logger.error('tool_call_end', {
        tool: normalizedToolName,
        elapsed: elapsed < 1000 ? `${elapsed}ms` : `${(elapsed / 1000).toFixed(1)}s`,
        elapsedMs: elapsed,
        status: 'error',
        error: err.message,
        code: err.code || undefined,
      });
    }

    // 5) 统一错误包装。优先采用 err.code（来自结构化 violation），其次根据 message 推断（兼容超时/handler 抛错）
    let code = err.code || 'EXECUTION_ERROR';
    let recommendation = 'Please explain the limitation to the user.';
    if (code === 'INVALID_PARAMETERS') {
      recommendation = 'Please correct the parameters and try again.';
    } else if (code === 'PERMISSION_DENIED') {
      recommendation = 'Please tell the user they do not have permission to view this data.';
    } else if (err.message && err.message.includes('timed out')) {
      code = 'TIMEOUT_ERROR';
      recommendation = 'The query took too long. Try narrowing the date range or filtering by a specific store/region.';
    }

    logger.warn('tool_blocked', { toolName: normalizedToolName, error: err.message, code });

    return {
      error: {
        code,
        message: `Failed to execute ${normalizedToolName}: ${err.message}`,
        recommendation,
        violations: err.violations || undefined,
      }
    };
  }
}

function getToolMeta(toolName) {
  const normalized = normalizeToolName(toolName);
  return toolMetas.get(normalized);
}

/**
 * 根据工具 freshness 返回签名时间桶宽度（ms）。
 *   realtime → 60s   (同分钟去重)
 *   daily    → 3600s (同小时去重)
 *   static   → 86400s (同天去重)
 */
function getToolFreshnessBucketMs(toolName) {
  const DEFAULT_BUCKET_MS = 60_000;
  const BUCKETS = { realtime: 60_000, daily: 3_600_000, static: 86_400_000 };
  const meta = getToolMeta(toolName);
  return meta ? (BUCKETS[meta.freshness] || DEFAULT_BUCKET_MS) : DEFAULT_BUCKET_MS;
}

module.exports = {
  TOOL_SCHEMAS,
  executeByName,
  getToolMeta,
  getToolFreshnessBucketMs,
  getRegisteredToolNames,
  getToolSchema,
  getToolSchemasByNames,
  normalizeToolName,
  validateToolArgs,
  authorizeToolCall,
};
