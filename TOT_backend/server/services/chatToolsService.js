'use strict';

const fs = require('fs');
const path = require('path');
const { db } = require('../db');

// ─── Dynamic Tool Loading ──────────────────────────────────────────────────────
const TOOL_SCHEMAS = [];
const toolHandlers = new Map();
const toolMetas = new Map(); // Store metadata for guardrails

function loadTools() {
  const toolsDir = path.join(__dirname, '..', 'chat_tools');
  console.log(`[chatToolsService] Loading tools from: ${toolsDir}`);
  if (!fs.existsSync(toolsDir)) {
    console.warn(`[chatToolsService] Tools directory not found: ${toolsDir}`);
    return;
  }

  const files = fs.readdirSync(toolsDir).filter(f => f.endsWith('.js'));
  console.log(`[chatToolsService] Found ${files.length} tool files: ${files.join(', ')}`);

  for (const file of files) {
    try {
      const toolModule = require(path.join(toolsDir, file));
      if (toolModule.schema && toolModule.schema.function && toolModule.schema.function.name) {
        // Allow disabling tools via meta flag
        const meta = toolModule.meta || {};
        if (meta.enabled === false) {
           console.log(`[chatToolsService] Skipping disabled tool in ${file}`);
           continue;
        }
        const toolName = toolModule.schema.function.name;
        TOOL_SCHEMAS.push(toolModule.schema);
        toolHandlers.set(toolName, toolModule.handler);
        toolMetas.set(toolName, {
          schema: toolModule.schema.function.parameters,
          requiredRole: meta.requiredRole || [],
          scopePolicy: meta.scopePolicy || 'any', // 'any', 'national_only'
          timeoutMs: meta.timeoutMs || 5000,
        });
        console.log(`[chatToolsService] Registered tool: ${toolName}`);
      } else {
        console.warn(`[chatToolsService] Invalid tool schema in ${file}`);
      }
    } catch (err) {
      console.error(`[chatToolsService] Failed to load tool ${file}:`, err.message);
    }
  }
}

// Load tools on module init
loadTools();

// ─── Guardrails ──────────────────────────────────────────────────────────────

function validateToolArgs(toolName, schema, args) {
  // Basic required fields validation based on JSON schema
  if (schema && schema.required && Array.isArray(schema.required)) {
    for (const reqField of schema.required) {
      if (args[reqField] === undefined || args[reqField] === null) {
        throw new Error(`Missing required parameter: ${reqField}`);
      }
    }
  }
  // Basic type checking based on schema.properties
  if (schema && schema.properties) {
    for (const [key, def] of Object.entries(schema.properties)) {
      const val = args[key];
      if (val !== undefined && val !== null) {
        if (def.type === 'string' && typeof val !== 'string') {
           throw new Error(`Parameter '${key}' must be a string.`);
        }
        if (def.type === 'number' && typeof val !== 'number') {
           throw new Error(`Parameter '${key}' must be a number.`);
        }
        if (def.type === 'boolean' && typeof val !== 'boolean') {
           throw new Error(`Parameter '${key}' must be a boolean.`);
        }
      }
    }
  }
}

function authorizeToolCall(toolName, meta, sessionContext) {
  const { regionScope, userRoles = ['executive'] } = sessionContext;

  // 1. Check requiredRole
  if (meta.requiredRole && meta.requiredRole.length > 0) {
    const hasRole = meta.requiredRole.some(role => userRoles.includes(role));
    if (!hasRole) {
      throw new Error(`Tool ${toolName} requires one of these roles: ${meta.requiredRole.join(', ')}. Current roles: ${userRoles.join(', ')}`);
    }
  }

  // 2. Check scopePolicy (e.g., if a tool is strictly for national data, block regional users)
  if (meta.scopePolicy === 'national_only') {
    if (!regionScope || regionScope.type !== 'national') {
      throw new Error(`Tool ${toolName} requires national data access scope. Current scope: ${regionScope ? regionScope.type : 'none'}`);
    }
  }
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
  const handler = toolHandlers.get(toolName);
  const meta = toolMetas.get(toolName);
  if (!handler || !meta) {
    return { 
      error: {
        code: 'TOOL_NOT_FOUND',
        message: `Unknown tool requested: ${toolName}.`,
        recommendation: 'Please verify the tool name.'
      }
    };
  }

  // Temporary session context wrapper (will be passed from above in future refactor)
  const sessionContext = {
    regionScope,
    userRoles: ['executive'] // Executive chat defaults to executive role
  };

  try {
    // 2) 参数 schema 校验
    validateToolArgs(toolName, meta.schema, params);

    // 3) 角色/区域权限校验
    authorizeToolCall(toolName, meta, sessionContext);

    // 4) 执行与超时保护
    const executionPromise = Promise.resolve(handler(params, regionScope));
    const result = await executeWithTimeout(executionPromise, meta.timeoutMs);

    return result;
  } catch (err) {
    // 5) 统一错误包装（避免裸栈信息泄漏给 LLM）
    console.warn(`[chatToolsService] Tool execution blocked/failed (${toolName}):`, err.message);
    
    // Determine error type based on error message (naive approach without custom error classes)
    let code = 'EXECUTION_ERROR';
    let recommendation = 'Please explain the limitation to the user.';
    if (err.message.includes('Missing required parameter') || err.message.includes('must be a')) {
      code = 'INVALID_PARAMETERS';
      recommendation = 'Please correct the parameters and try again.';
    } else if (err.message.includes('requires one of these roles') || err.message.includes('requires national data access')) {
      code = 'PERMISSION_DENIED';
      recommendation = 'Please tell the user they do not have permission to view this data.';
    } else if (err.message.includes('timed out')) {
      code = 'TIMEOUT_ERROR';
      recommendation = 'The query took too long. Try narrowing the date range or filtering by a specific store/region.';
    }

    return { 
      error: {
        code,
        message: `Failed to execute ${toolName}: ${err.message}`,
        recommendation
      }
    };
  }
}

module.exports = {
  TOOL_SCHEMAS,
  executeByName,
};
