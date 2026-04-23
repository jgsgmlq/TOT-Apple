'use strict';

const { generateDashboardAgentInsight } = require('../services/dashboardAgentService');
const { broadcastToDashboard } = require('../ws/manager');

const ONE_HOUR_MS = 60 * 60 * 1000;

async function runScheduledDashboardAgentInsight() {
  try {
    // 传递 null 标识由系统触发（或者也可以传一个特定的 system userId）
    const data = await generateDashboardAgentInsight(null);
    console.log('[dashboard-agent scheduler] Insight generated successfully.');
    
    // 生成完之后推送消息，通知前端更新状态或直接拉取最新诊断
    broadcastToDashboard({
      event: 'dashboard_agent_updated',
      data: { generatedAt: data.generatedAt }
    });
  } catch (err) {
    console.error('[dashboard-agent scheduler] Error generating insight:', err.message || err);
  }
}

function startDashboardAgentScheduler() {
  if (process.env.DASHBOARD_AGENT_SCHEDULER === '0') {
    console.log('[dashboard-agent scheduler] disabled (DASHBOARD_AGENT_SCHEDULER=0)');
    return;
  }
  const intervalMs = Number(process.env.DASHBOARD_AGENT_INTERVAL_MS) || ONE_HOUR_MS;
  
  // 初次启动后延迟 5 秒先执行一次生成，防止没缓存
  setTimeout(() => {
    runScheduledDashboardAgentInsight();
  }, 5000);
  
  setInterval(() => {
    runScheduledDashboardAgentInsight();
  }, intervalMs);
  
  console.log(`[dashboard-agent scheduler] Started, runs every ${intervalMs / 1000}s`);
}

module.exports = { startDashboardAgentScheduler, runScheduledDashboardAgentInsight };
