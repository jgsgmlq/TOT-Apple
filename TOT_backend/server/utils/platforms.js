'use strict';

const PLATFORM_DEFS = [
  {
    key: 'mypal',
    sourceLabel: 'MyPAL',
    completedColumn: 'mypal_completed',
    taskFlagColumn: 'has_mypal',
    aliases: ['mypal', 'my pal'],
  },
  {
    key: 'smartsell',
    sourceLabel: 'SmartSales',
    completedColumn: 'smartsell_completed',
    taskFlagColumn: 'has_smartsell',
    aliases: ['smartsell', 'smart sell', 'smartsales', 'smart sales'],
  },
  {
    key: 'ai_demo',
    sourceLabel: 'AiDemo',
    completedColumn: 'ai_demo_completed',
    taskFlagColumn: 'has_ai_demo',
    aliases: ['ai_demo', 'ai demo', 'aidemo', 'ai coach', 'aicoach'],
  },
  {
    key: 'live_broadcast',
    sourceLabel: 'LiveBroadcast',
    completedColumn: 'live_broadcast_completed',
    taskFlagColumn: 'has_live_broadcast',
    aliases: ['live_broadcast', 'live broadcast', 'livebroadcast', '直播培训'],
  },
];

function normalizePlatformInput(platform) {
  return String(platform || '')
    .trim()
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function getPlatformDefinition(platform) {
  const normalized = normalizePlatformInput(platform);
  if (!normalized) return null;
  return (
    PLATFORM_DEFS.find((def) =>
      def.aliases.some((alias) => normalizePlatformInput(alias) === normalized)
    ) || null
  );
}

function getPlatformReadReceiptSource(platform) {
  const def = getPlatformDefinition(platform);
  return def ? `task_detail_open:${def.sourceLabel}` : null;
}

module.exports = {
  PLATFORM_DEFS,
  getPlatformDefinition,
  getPlatformReadReceiptSource,
};
