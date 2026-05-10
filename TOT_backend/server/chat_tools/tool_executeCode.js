'use strict';

/**
 * tool_executeCode.js (v4.0 Code Interpreter)
 * 代码解释器工具：支持在沙盒中运行 Python (Pandas/Matplotlib) 进行高阶数据分析。
 */

const { Sandbox } = require('@e2b/code-interpreter');
const logger = require('../utils/logger');

const schema = {
  type: 'function',
  function: {
    name: 'executeCode',
    description: '在安全沙盒中执行 Python 代码进行高阶统计分析（如相关性、分布、拟合等）。输入必须是 Python 代码。数据已预装在 `/data/input.csv`。',
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: '要执行的 Python 代码。使用 pandas 读取 /data/input.csv。'
        },
        description: {
          type: 'string',
          description: '正在进行的分析步骤描述，用于思维链展示。'
        },
        dataRef: {
          type: 'string',
          description: '原始数据 CSV 字符串（由前端或另一个工具传入）。'
        }
      },
      required: ['code']
    }
  }
};

const meta = {
  enabled: true,
  requiredRole: ['executive', 'central', 'admin'],
  scopePolicy: 'regional_scoped',
  timeoutMs: 15000 // 云沙盒执行通常需要更长超时时间
};

/**
 * Handler
 */
async function handler(args, regionScope) {
  const { code, description, dataRef } = args;
  
  if (!process.env.E2B_API_KEY) {
    logger.warn('e2b_api_key_missing', { tool: 'executeCode' });
    return {
      success: false,
      errorCode: 'CONFIGURATION_ERROR',
      message: '系统未配置 E2B_API_KEY，无法启动代码沙盒。',
      appliedParams: args
    };
  }

  let sandbox;
  try {
    // 1. 安全预检查（虽然 E2B 是安全的，但作为防御性编程仍保留）
    if (/(os\.|subprocess|sys\.|__import__|open\()/.test(code)) {
       logger.warn('code_execution_blocked_by_regex', { code });
      return {
        success: false,
        errorCode: 'SECURITY_VIOLATION',
        message: '检测到潜在的系统调用意图，执行被拒绝。请仅使用 pandas/numpy/matplotlib 等数据分析库。'
      };
    }

    logger.info('e2b_sandbox_starting', { description });
    
    // 2. 创建并连接 E2B 云端沙盒
    // 参考: https://e2b.dev/docs/code-interpreter/execution
    sandbox = await Sandbox.create();

    // 3. 如果有提供原始数据，注入到沙盒的文件系统中
    if (dataRef) {
      await sandbox.files.write('/data/input.csv', dataRef);
      logger.debug('e2b_sandbox_data_injected', { bytes: dataRef.length });
    }

    // 4. 执行大模型生成的 Python 代码
    logger.info('e2b_sandbox_executing', { code });
    const execution = await sandbox.runCode(code);

    // 5. 整理执行结果
    const textOutput = (execution.logs?.stdout || []).join('') || '';
    const errorOutput = execution.error || null;
    
    // 提取图表 (Base64)
    const plots = execution.results
      .filter(r => r.png)
      .map(r => `data:image/png;base64,${r.png}`);

    if (errorOutput) {
       logger.warn('e2b_sandbox_execution_error', { errorOutput });
       return {
         success: false,
         errorCode: 'RUNTIME_ERROR',
         message: `代码执行失败:\n${errorOutput.name}: ${errorOutput.value}\n${errorOutput.traceback}`,
         appliedParams: args
       };
    }

    logger.info('e2b_sandbox_execution_success', { textOutputLength: textOutput.length, plotsCount: plots.length });

    return {
      success: true,
      result: {
        text: textOutput,
        plots: plots
      },
      appliedParams: args
    };
  } catch (err) {
    logger.error('e2b_sandbox_failed', { error: err.message, stack: err.stack });
    return {
      success: false,
      errorCode: 'SYSTEM_ERROR',
      message: `沙盒服务连接或执行发生系统异常: ${err.message}`,
      appliedParams: args
    };
  } finally {
    // 6. 务必清理并关闭云端沙盒实例，防止持续计费
    if (sandbox) {
      await sandbox.kill().catch(e => logger.error('e2b_sandbox_kill_failed', { error: e.message }));
      logger.debug('e2b_sandbox_killed');
    }
  }
}

module.exports = {
  schema,
  meta,
  handler
};
