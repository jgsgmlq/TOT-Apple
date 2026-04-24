<script setup lang="ts">
  import { ref, computed, watch, onMounted, nextTick, onUnmounted, defineComponent, h } from 'vue';
  import * as echarts from 'echarts';
  import { getTaskList } from '@/api/task';
  import { getDashboardOverview, getDashboardWarnings } from '@/api/dashboard';
  import { marked } from 'marked';
  import { createDashboardChatSession, streamDashboardChatMessage } from '@/api/chat';

  // ================= Mock Data =================
  const diagnosisData = ref<any[]>([
    {
      diagnosis_id: 'diag-004',
      priority_rank: 4,
      severity: 'green',
      summary_text: '其余任务按计划推进中，无需关注',
      related_task_id: null,
      task_title: null,
      related_region_id: null,
      related_store_id: null,
      suggested_action: null,
      action_type: 'none',
      action_status: 'pending',
      generated_at: '2026-04-20T08:00:00Z',
    },
  ]);

  const allTasks = ref<any[]>([]);

  const loadTasks = async () => {
    try {
      const rawTasks = await getTaskList().send();
      // 只要已下发的任务
      const dispatched = (rawTasks || []).filter((t: any) => t.status === 'dispatched');

      allTasks.value = dispatched.map((t: any) => {
        // 在没有请求 Overview 时先给个假进度，以免报错
        return {
          task_id: t.id,
          task_title: t.title,
          deadline: t.ddlAt ? t.ddlAt.substring(0, 10) : '无截止时间',
          completion_rate: 0.4,
          severity: 'yellow',
        };
      });

      if (allTasks.value.length > 0) {
        if (!currentTaskId.value) {
          currentTaskId.value = allTasks.value[0].task_id;
        }

        // 随机选取 3 个任务或现有所有任务作为异常卡片
        const issueTasks = allTasks.value.slice(0, 3);

        const newDiag = issueTasks.map((t, index) => {
          const isRed = index === 0;
          const sev = isRed ? 'red' : 'yellow';
          return {
            diagnosis_id: `diag-auto-${t.task_id}`,
            priority_rank: index + 1,
            severity: sev,
            summary_text: isRed
              ? `${t.task_title} 进度严重滞后，大量区域触达后未学习`
              : `${t.task_title} 存在转化异常，请重点跟进`,
            related_task_id: t.task_id,
            task_title: t.task_title,
            related_region_id: null,
            related_store_id: null,
            suggested_action: isRed ? '建议对未读门店发起批量催办' : '建议检查门店人员配置',
            action_type: isRed ? 'escalate' : 'remind',
            action_status: 'pending',
            generated_at: new Date().toISOString(),
          };
        });

        const restCount = Math.max(0, allTasks.value.length - issueTasks.length);
        newDiag.push({
          diagnosis_id: 'diag-ok',
          priority_rank: 99,
          severity: 'green',
          summary_text: `其余 ${restCount} 个任务按计划推进中，无需关注`,
          related_task_id: null,
          task_title: null,
          related_region_id: null,
          related_store_id: null,
          suggested_action: null,
          action_type: 'none',
          action_status: 'pending',
          generated_at: new Date().toISOString(),
        });

        diagnosisData.value = newDiag;
      }
    } catch (err) {
      console.error('获取任务列表失败', err);
    }
  };

  const funnelDataByTask = {
    'task-macbook': {
      task_id: 'task-macbook',
      funnel: [
        { stage: 'pushed', label: '推送', count: 19847 },
        { stage: 'delivered', label: '送达', count: 18458 },
        { stage: 'read', label: '已读', count: 16200 },
        { stage: 'in_progress', label: '学习中', count: 12890 },
        { stage: 'completed', label: '已完成', count: 10520 },
      ],
      worst_drop: { from_stage: 'read', to_stage: 'in_progress' },
      completion_rate: 0.06,
      completion_rate_delta: 0.023,
      confirmation_rate: 0.878,
      hours_remaining: 48,
    },
    'task-mano': {
      task_id: 'task-mano',
      funnel: [
        { stage: 'pushed', label: '推送', count: 15200 },
        { stage: 'delivered', label: '送达', count: 14500 },
        { stage: 'read', label: '已读', count: 13800 },
        { stage: 'in_progress', label: '学习中', count: 8900 },
        { stage: 'completed', label: '已完成', count: 6200 },
      ],
      worst_drop: { from_stage: 'read', to_stage: 'in_progress' },
      completion_rate: 0.34,
      completion_rate_delta: -0.01,
      confirmation_rate: 0.951,
      hours_remaining: 504,
    },
    'task-iphone17': {
      task_id: 'task-iphone17',
      funnel: [
        { stage: 'pushed', label: '推送', count: 22000 },
        { stage: 'delivered', label: '送达', count: 20900 },
        { stage: 'read', label: '已读', count: 12749 },
        { stage: 'in_progress', label: '学习中', count: 10500 },
        { stage: 'completed', label: '已完成', count: 9200 },
      ],
      worst_drop: { from_stage: 'delivered', to_stage: 'read' },
      completion_rate: 0.4,
      completion_rate_delta: 0.05,
      confirmation_rate: 0.61,
      hours_remaining: 744,
    },
    'task-ipad': {
      task_id: 'task-ipad',
      funnel: [
        { stage: 'pushed', label: '推送', count: 12000 },
        { stage: 'delivered', label: '送达', count: 11800 },
        { stage: 'read', label: '已读', count: 11000 },
        { stage: 'in_progress', label: '学习中', count: 9500 },
        { stage: 'completed', label: '已完成', count: 8640 },
      ],
      worst_drop: { from_stage: 'read', to_stage: 'in_progress' },
      completion_rate: 0.72,
      completion_rate_delta: 0.05,
      confirmation_rate: 0.93,
      hours_remaining: 120,
    },
    'task-watch': {
      task_id: 'task-watch',
      funnel: [
        { stage: 'pushed', label: '推送', count: 8000 },
        { stage: 'delivered', label: '送达', count: 7900 },
        { stage: 'read', label: '已读', count: 7800 },
        { stage: 'in_progress', label: '学习中', count: 7000 },
        { stage: 'completed', label: '已完成', count: 6800 },
      ],
      worst_drop: { from_stage: 'pushed', to_stage: 'delivered' },
      completion_rate: 0.85,
      completion_rate_delta: 0.08,
      confirmation_rate: 0.98,
      hours_remaining: 96,
    },
    'task-airpods': {
      task_id: 'task-airpods',
      funnel: [
        { stage: 'pushed', label: '推送', count: 15000 },
        { stage: 'delivered', label: '送达', count: 14800 },
        { stage: 'read', label: '已读', count: 13000 },
        { stage: 'in_progress', label: '学习中', count: 10000 },
        { stage: 'completed', label: '已完成', count: 9150 },
      ],
      worst_drop: { from_stage: 'read', to_stage: 'in_progress' },
      completion_rate: 0.61,
      completion_rate_delta: 0.04,
      confirmation_rate: 0.87,
      hours_remaining: 120,
    },
  };

  const regionRankingByTask = {
    'task-macbook': {
      regions: [
        {
          region_id: 'rtm-monobrand',
          region_name: 'Monobrand',
          employee_count: 5000,
          completed_count: 4200,
          completion_rate: 0.84,
          avg_time: '1.2h',
          children: [
            {
              region_id: 'rtm4-mono',
              region_name: 'MONO',
              employee_count: 5000,
              completed_count: 4200,
              completion_rate: 0.84,
              avg_time: '1.2h',
              children: [
                {
                  region_id: 'dlr-ds',
                  region_name: '鼎盛科技',
                  employee_count: 3000,
                  completed_count: 2700,
                  completion_rate: 0.9,
                  avg_time: '1.0h',
                  children: [
                    {
                      region_id: 'st-bj',
                      region_name: '北京国贸店',
                      employee_count: 15,
                      completed_count: 15,
                      completion_rate: 1.0,
                      avg_time: '0.8h',
                    },
                    {
                      region_id: 'st-sh',
                      region_name: '上海七宝店',
                      employee_count: 20,
                      completed_count: 18,
                      completion_rate: 0.9,
                      avg_time: '1.1h',
                    },
                  ],
                },
                {
                  region_id: 'dlr-xs',
                  region_name: '新时代电子',
                  employee_count: 2000,
                  completed_count: 1500,
                  completion_rate: 0.75,
                  avg_time: '1.5h',
                  children: [
                    {
                      region_id: 'st-gz',
                      region_name: '广州天环广场店',
                      employee_count: 25,
                      completed_count: 18,
                      completion_rate: 0.72,
                      avg_time: '1.6h',
                    },
                    {
                      region_id: 'st-sz',
                      region_name: '深圳万象城店',
                      employee_count: 18,
                      completed_count: 14,
                      completion_rate: 0.77,
                      avg_time: '1.4h',
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          region_id: 'rtm-multibrand',
          region_name: 'Multibrand',
          employee_count: 8000,
          completed_count: 5200,
          completion_rate: 0.65,
          avg_time: '1.8h',
          children: [
            {
              region_id: 'rtm4-ls',
              region_name: 'Lifestyle',
              employee_count: 4000,
              completed_count: 3200,
              completion_rate: 0.8,
              avg_time: '1.5h',
            },
            {
              region_id: 'rtm4-mm',
              region_name: 'Mass Merchant',
              employee_count: 4000,
              completed_count: 2000,
              completion_rate: 0.5,
              avg_time: '2.1h',
            },
          ],
        },
        {
          region_id: 'rtm-education',
          region_name: 'Education',
          employee_count: 1500,
          completed_count: 600,
          completion_rate: 0.4,
          avg_time: '2.5h',
        },
        {
          region_id: 'rtm-carrier',
          region_name: 'Carrier',
          employee_count: 20,
          completed_count: 0,
          completion_rate: 0.0,
          avg_time: '-',
          children: [
            {
              region_id: 'rtm4-cmm',
              region_name: 'Mass Merchant',
              employee_count: 20,
              completed_count: 0,
              completion_rate: 0.0,
              avg_time: '-',
            },
          ],
        },
      ],
    },
    'task-mano': {
      regions: [
        {
          region_id: 'rtm-multibrand',
          region_name: 'Multibrand',
          employee_count: 6000,
          completed_count: 4800,
          completion_rate: 0.8,
          avg_time: '45m',
        },
        {
          region_id: 'rtm-monobrand',
          region_name: 'Monobrand',
          employee_count: 4500,
          completed_count: 3150,
          completion_rate: 0.7,
          avg_time: '50m',
        },
        {
          region_id: 'rtm-carrier',
          region_name: 'Carrier',
          employee_count: 3000,
          completed_count: 1200,
          completion_rate: 0.4,
          avg_time: '1.5h',
        },
        {
          region_id: 'rtm-education',
          region_name: 'Education',
          employee_count: 1500,
          completed_count: 150,
          completion_rate: 0.1,
          avg_time: '3.2h',
        },
      ],
    },
    'task-iphone17': {
      regions: [
        {
          region_id: 'rtm-monobrand',
          region_name: 'Monobrand',
          employee_count: 7000,
          completed_count: 5950,
          completion_rate: 0.85,
          avg_time: '30m',
        },
        {
          region_id: 'rtm-carrier',
          region_name: 'Carrier',
          employee_count: 4000,
          completed_count: 3080,
          completion_rate: 0.77,
          avg_time: '35m',
        },
        {
          region_id: 'rtm-multibrand',
          region_name: 'Multibrand',
          employee_count: 9000,
          completed_count: 4500,
          completion_rate: 0.5,
          avg_time: '1.2h',
        },
        {
          region_id: 'rtm-education',
          region_name: 'Education',
          employee_count: 2000,
          completed_count: 200,
          completion_rate: 0.1,
          avg_time: '4.5h',
        },
      ],
    },
    'task-ipad': {
      regions: [
        {
          region_id: 'rtm-monobrand',
          region_name: 'Monobrand',
          employee_count: 4000,
          completed_count: 3200,
          completion_rate: 0.8,
          avg_time: '40m',
        },
        {
          region_id: 'rtm-multibrand',
          region_name: 'Multibrand',
          employee_count: 5000,
          completed_count: 3600,
          completion_rate: 0.72,
          avg_time: '45m',
        },
        {
          region_id: 'rtm-carrier',
          region_name: 'Carrier',
          employee_count: 2000,
          completed_count: 1300,
          completion_rate: 0.65,
          avg_time: '50m',
        },
        {
          region_id: 'rtm-education',
          region_name: 'Education',
          employee_count: 1000,
          completed_count: 540,
          completion_rate: 0.54,
          avg_time: '1.1h',
        },
      ],
    },
    'task-watch': {
      regions: [
        {
          region_id: 'rtm-monobrand',
          region_name: 'Monobrand',
          employee_count: 3000,
          completed_count: 2700,
          completion_rate: 0.9,
          avg_time: '25m',
        },
        {
          region_id: 'rtm-multibrand',
          region_name: 'Multibrand',
          employee_count: 3000,
          completed_count: 2550,
          completion_rate: 0.85,
          avg_time: '30m',
        },
        {
          region_id: 'rtm-carrier',
          region_name: 'Carrier',
          employee_count: 1500,
          completed_count: 1200,
          completion_rate: 0.8,
          avg_time: '35m',
        },
        {
          region_id: 'rtm-education',
          region_name: 'Education',
          employee_count: 500,
          completed_count: 350,
          completion_rate: 0.7,
          avg_time: '40m',
        },
      ],
    },
    'task-airpods': {
      regions: [
        {
          region_id: 'rtm-multibrand',
          region_name: 'Multibrand',
          employee_count: 6000,
          completed_count: 4200,
          completion_rate: 0.7,
          avg_time: '35m',
        },
        {
          region_id: 'rtm-monobrand',
          region_name: 'Monobrand',
          employee_count: 4000,
          completed_count: 2600,
          completion_rate: 0.65,
          avg_time: '30m',
        },
        {
          region_id: 'rtm-carrier',
          region_name: 'Carrier',
          employee_count: 3000,
          completed_count: 1650,
          completion_rate: 0.55,
          avg_time: '40m',
        },
        {
          region_id: 'rtm-education',
          region_name: 'Education',
          employee_count: 2000,
          completed_count: 700,
          completion_rate: 0.35,
          avg_time: '55m',
        },
      ],
    },
  };

  const alertSummaryByTask = {
    'task-macbook': {
      p0_count: 5,
      p1_count: 5,
      p2_count: 4,
      p0_breakdown: [{ category: '临期严重滞后', count: 5 }],
      p1_breakdown: [{ category: '进度落后区域均值', count: 5 }],
      p2_breakdown: [{ category: '起步转化异常', count: 4 }],
    },
    'task-mano': {
      p0_count: 2,
      p1_count: 2,
      p2_count: 2,
      p0_breakdown: [{ category: '距离截止 < 24h', count: 2 }],
      p1_breakdown: [{ category: '进度落后计划', count: 2 }],
      p2_breakdown: [{ category: '起步阶段低迷', count: 2 }],
    },
    'task-iphone17': {
      p0_count: 2,
      p1_count: 1,
      p2_count: 1,
      p0_breakdown: [{ category: '新品培训滞后', count: 2 }],
      p1_breakdown: [{ category: '进度大幅落后', count: 1 }],
      p2_breakdown: [{ category: '确认后未转化', count: 1 }],
    },
    'task-ipad': {
      p0_count: 0,
      p1_count: 1,
      p2_count: 1,
      p0_breakdown: [],
      p1_breakdown: [{ category: '周推进度滞后', count: 1 }],
      p2_breakdown: [{ category: '转化率异常', count: 1 }],
    },
    'task-watch': {
      p0_count: 0,
      p1_count: 0,
      p2_count: 1,
      p0_breakdown: [],
      p1_breakdown: [],
      p2_breakdown: [{ category: '旗舰店活跃度低', count: 1 }],
    },
    'task-airpods': {
      p0_count: 1,
      p1_count: 1,
      p2_count: 0,
      p0_breakdown: [{ category: '临期未读危机', count: 1 }],
      p1_breakdown: [{ category: '进度明显落后', count: 1 }],
      p2_breakdown: [],
    },
  };

  const generateTrendData = () => {
    const tasks = [
      'task-macbook',
      'task-mano',
      'task-iphone17',
      'task-ipad',
      'task-watch',
      'task-airpods',
    ];
    const baseCounts = [8931, 5168, 8800, 8640, 6800, 9150];
    const data: any = {};

    tasks.forEach((t, i) => {
      let base = baseCounts[i];
      data[t] = {
        daily: {
          '04.14 - 04.20': [
            {
              time: '04-14',
              increment: Math.round(base * 0.05),
              cumulative: Math.round(base * 0.05),
            },
            {
              time: '04-15',
              increment: Math.round(base * 0.1),
              cumulative: Math.round(base * 0.15),
            },
            {
              time: '04-16',
              increment: Math.round(base * 0.2),
              cumulative: Math.round(base * 0.35),
            },
            {
              time: '04-17',
              increment: Math.round(base * 0.3),
              cumulative: Math.round(base * 0.65),
            },
            {
              time: '04-18',
              increment: Math.round(base * 0.2),
              cumulative: Math.round(base * 0.85),
            },
            {
              time: '04-19',
              increment: Math.round(base * 0.1),
              cumulative: Math.round(base * 0.95),
            },
            { time: '04-20', increment: Math.round(base * 0.05), cumulative: base },
          ],
          '04.07 - 04.13': [
            {
              time: '04-07',
              increment: Math.round(base * 0.01),
              cumulative: Math.round(base * 0.01),
            },
            {
              time: '04-08',
              increment: Math.round(base * 0.02),
              cumulative: Math.round(base * 0.03),
            },
            {
              time: '04-09',
              increment: Math.round(base * 0.04),
              cumulative: Math.round(base * 0.07),
            },
            {
              time: '04-10',
              increment: Math.round(base * 0.05),
              cumulative: Math.round(base * 0.12),
            },
            {
              time: '04-11',
              increment: Math.round(base * 0.06),
              cumulative: Math.round(base * 0.18),
            },
            {
              time: '04-12',
              increment: Math.round(base * 0.03),
              cumulative: Math.round(base * 0.21),
            },
            {
              time: '04-13',
              increment: Math.round(base * 0.02),
              cumulative: Math.round(base * 0.23),
            },
          ],
        },
        hourly: {
          '2026-04-20': [
            { time: '09:00', increment: 120, cumulative: base - 1000 },
            { time: '10:00', increment: 250, cumulative: base - 750 },
            { time: '11:00', increment: 400, cumulative: base - 350 },
            { time: '12:00', increment: 100, cumulative: base - 250 },
            { time: '14:00', increment: 150, cumulative: base - 100 },
            { time: '15:00', increment: 100, cumulative: base },
          ],
          '2026-04-19': [
            { time: '09:00', increment: 50, cumulative: base - 1200 },
            { time: '10:00', increment: 120, cumulative: base - 1080 },
            { time: '11:00', increment: 80, cumulative: base - 1000 },
          ],
        },
      };
    });
    return data;
  };
  const trendDataByTask = generateTrendData();

  const alertFunnelByTask = {
    'task-macbook': [
      { stage: 'P2', label: 'P2', count: 850 },
      { stage: 'P1', label: 'P1', count: 480 },
      { stage: 'P0', label: 'P0', count: 210 },
      { stage: 'Unfinished', label: '未完成', count: 120 },
    ],
    'task-mano': [
      { stage: 'P2', label: 'P2', count: 600 },
      { stage: 'P1', label: 'P1', count: 240 },
      { stage: 'P0', label: 'P0', count: 95 },
      { stage: 'Unfinished', label: '未完成', count: 45 },
    ],
    'task-iphone17': [
      { stage: 'P2', label: 'P2', count: 1200 },
      { stage: 'P1', label: 'P1', count: 650 },
      { stage: 'P0', label: 'P0', count: 280 },
      { stage: 'Unfinished', label: '未完成', count: 150 },
    ],
    'task-ipad': [
      { stage: 'P2', label: 'P2', count: 400 },
      { stage: 'P1', label: 'P1', count: 120 },
      { stage: 'P0', label: 'P0', count: 35 },
      { stage: 'Unfinished', label: '未完成', count: 12 },
    ],
    'task-watch': [
      { stage: 'P2', label: 'P2', count: 200 },
      { stage: 'P1', label: 'P1', count: 45 },
      { stage: 'P0', label: 'P0', count: 15 },
      { stage: 'Unfinished', label: '未完成', count: 4 },
    ],
    'task-airpods': [
      { stage: 'P2', label: 'P2', count: 550 },
      { stage: 'P1', label: 'P1', count: 180 },
      { stage: 'P0', label: 'P0', count: 65 },
      { stage: 'Unfinished', label: '未完成', count: 28 },
    ],
  };

  const alertsByTask = {
    'task-macbook': {
      total: 47,
      alerts: [
        {
          alert_id: 'alert-001',
          level: 'P0',
          rtm3: 'Monobrand',
          rtm4: 'MONO',
          dealer: '鼎盛科技',
          store: '北京国贸店',
          description: '距截止 < 24h，完成进度严重滞后',
          related_entity: '北京国贸店',
          triggered_at: '2026-04-20T10:30:00Z',
          total_employees: 25,
          completed_count: 3,
          risk_rate: 0.88,
        },
        {
          alert_id: 'alert-005',
          level: 'P0',
          rtm3: 'Monobrand',
          rtm4: 'MONO',
          dealer: '华联商贸',
          store: '上海南京东路店',
          description: '完成率为 4.5%，面临交付风险',
          related_entity: '上海南京东路店',
          triggered_at: '2026-04-20T08:00:00Z',
          total_employees: 22,
          completed_count: 1,
          risk_rate: 0.955,
        },
        {
          alert_id: 'alert-006',
          level: 'P0',
          rtm3: 'Multibrand',
          rtm4: 'Lifestyle',
          dealer: '盛达通讯',
          store: '深圳万象天地店',
          description: '完成率 15.8%，进度远低于区域均值',
          related_entity: '深圳万象天地店',
          triggered_at: '2026-04-20T09:15:00Z',
          total_employees: 38,
          completed_count: 6,
          risk_rate: 0.842,
        },
        {
          alert_id: 'alert-007',
          level: 'P0',
          rtm3: 'Multibrand',
          rtm4: 'Lifestyle',
          dealer: '新时代电子',
          store: '广州天环广场店',
          description: '关键岗位员工尚未开始学习',
          related_entity: '广州天环广场店',
          triggered_at: '2026-04-20T11:45:00Z',
          total_employees: 15,
          completed_count: 1,
          risk_rate: 0.933,
        },
        {
          alert_id: 'alert-008',
          level: 'P0',
          rtm3: 'Multibrand',
          rtm4: 'Mass Merchant',
          dealer: '鼎盛科技',
          store: '杭州万象城店',
          description: '最后 24 小时冲刺力度不足',
          related_entity: '杭州万象城店',
          triggered_at: '2026-04-20T14:20:00Z',
          total_employees: 30,
          completed_count: 2,
          risk_rate: 0.933,
        },
        {
          alert_id: 'alert-002',
          level: 'P1',
          rtm3: 'Carrier',
          rtm4: 'Mass Merchant',
          dealer: '华联商贸',
          store: '重庆时代广场店',
          description: '距截止 < 48h，起步较晚',
          related_entity: '重庆时代广场店',
          triggered_at: '2026-04-19T09:15:00Z',
          total_employees: 45,
          completed_count: 12,
          risk_rate: 0.733,
        },
        {
          alert_id: 'alert-009',
          level: 'P1',
          rtm3: 'Multibrand',
          rtm4: 'Lifestyle',
          dealer: '盛达通讯',
          store: '武汉恒隆广场店',
          description: '完成率 28.5%，需加速推进',
          related_entity: '武汉恒隆广场店',
          triggered_at: '2026-04-19T10:30:00Z',
          total_employees: 28,
          completed_count: 8,
          risk_rate: 0.714,
        },
        {
          alert_id: 'alert-010',
          level: 'P1',
          rtm3: 'Monobrand',
          rtm4: 'MONO',
          dealer: '鼎盛科技',
          store: '成都太古里店',
          description: '进度落后大盘均值 15pp',
          related_entity: '成都太古里店',
          triggered_at: '2026-04-19T11:25:00Z',
          total_employees: 40,
          completed_count: 15,
          risk_rate: 0.625,
        },
        {
          alert_id: 'alert-011',
          level: 'P1',
          rtm3: 'Monobrand',
          rtm4: 'MONO',
          dealer: '新时代电子',
          store: '重庆万象城店',
          description: '周末活跃度低，进度停滞',
          related_entity: '重庆万象城店',
          triggered_at: '2026-04-19T13:10:00Z',
          total_employees: 18,
          completed_count: 6,
          risk_rate: 0.667,
        },
        {
          alert_id: 'alert-012',
          level: 'P1',
          rtm3: 'Multibrand',
          rtm4: 'Mass Merchant',
          dealer: '华联商贸',
          store: '南京景枫中心店',
          description: '触达确认率高但学习转化慢',
          related_entity: '南京景枫中心店',
          triggered_at: '2026-04-19T15:40:00Z',
          total_employees: 25,
          completed_count: 9,
          risk_rate: 0.64,
        },
        {
          alert_id: 'alert-003',
          level: 'P2',
          rtm3: 'Education',
          rtm4: 'Campus',
          dealer: '新时代电子',
          store: '清华大学体验店',
          description: '时间过半，完成率 2.5%',
          related_entity: '清华大学体验店',
          triggered_at: '2026-04-19T14:20:00Z',
          total_employees: 120,
          completed_count: 3,
          risk_rate: 0.975,
        },
        {
          alert_id: 'alert-004',
          level: 'P2',
          rtm3: 'Education',
          rtm4: 'Campus',
          dealer: '鼎盛科技',
          store: '复旦大学服务中心',
          description: '学习活跃人数占比不足 10%',
          related_entity: '复旦大学服务中心',
          triggered_at: '2026-04-19T11:00:00Z',
          total_employees: 80,
          completed_count: 5,
          risk_rate: 0.938,
        },
        {
          alert_id: 'alert-014',
          level: 'P2',
          rtm3: 'Carrier',
          rtm4: 'Mass Merchant',
          dealer: '华联商贸',
          store: '沈阳中街店',
          description: '推送后 48h 未有实质进展',
          related_entity: '沈阳中街店',
          triggered_at: '2026-04-18T09:30:00Z',
          total_employees: 55,
          completed_count: 4,
          risk_rate: 0.927,
        },
        {
          alert_id: 'alert-015',
          level: 'P2',
          rtm3: 'Carrier',
          rtm4: 'Mass Merchant',
          dealer: '盛达通讯',
          store: '西安钟楼店',
          description: '完成率 12.5%，落后预期',
          related_entity: '西安钟楼店',
          triggered_at: '2026-04-18T10:15:00Z',
          total_employees: 32,
          completed_count: 4,
          risk_rate: 0.875,
        },
      ],
    },
    'task-mano': {
      total: 23,
      alerts: [
        {
          alert_id: 'alert-101',
          level: 'P0',
          rtm3: 'Education',
          rtm4: 'Campus',
          dealer: '鼎盛科技',
          store: '北京大学直营店',
          description: '临期危机，完成率 12.4%',
          related_entity: '北京大学直营店',
          triggered_at: '2026-04-20T16:30:00Z',
          total_employees: 42,
          completed_count: 5,
          risk_rate: 0.881,
        },
        {
          alert_id: 'alert-104',
          level: 'P0',
          rtm3: 'Education',
          rtm4: 'Campus',
          dealer: '华联商贸',
          store: '华中科技大学门店',
          description: '完成率 8.5%，需立即干预',
          related_entity: '华中科技大学门店',
          triggered_at: '2026-04-20T17:15:00Z',
          total_employees: 35,
          completed_count: 3,
          risk_rate: 0.914,
        },
        {
          alert_id: 'alert-102',
          level: 'P1',
          rtm3: 'Carrier',
          rtm4: 'Mass Merchant',
          dealer: '新时代电子',
          store: '成都春熙路店',
          description: '完成率 34.2%，落后计划进度',
          related_entity: '成都春熙路店',
          triggered_at: '2026-04-19T12:00:00Z',
          total_employees: 60,
          completed_count: 20,
          risk_rate: 0.667,
        },
        {
          alert_id: 'alert-106',
          level: 'P1',
          rtm3: 'Multibrand',
          rtm4: 'Lifestyle',
          dealer: '鼎盛科技',
          store: '上海环贸广场店',
          description: '进度放缓，完成率 42.1%',
          related_entity: '上海环贸广场店',
          triggered_at: '2026-04-19T13:30:00Z',
          total_employees: 48,
          completed_count: 20,
          risk_rate: 0.583,
        },
        {
          alert_id: 'alert-103',
          level: 'P2',
          rtm3: 'Multibrand',
          rtm4: 'Mass Merchant',
          dealer: '盛达通讯',
          store: '广州珠江新城店',
          description: '起步异常，完成率 15.6%',
          related_entity: '广州珠江新城店',
          triggered_at: '2026-04-18T07:00:00Z',
          total_employees: 32,
          completed_count: 5,
          risk_rate: 0.844,
        },
        {
          alert_id: 'alert-108',
          level: 'P2',
          rtm3: 'Monobrand',
          rtm4: 'MONO',
          dealer: '新时代电子',
          store: '北京三里屯店',
          description: '时间过半，进度仅 20%',
          related_entity: '北京三里屯店',
          triggered_at: '2026-04-18T08:15:00Z',
          total_employees: 25,
          completed_count: 5,
          risk_rate: 0.8,
        },
      ],
    },
    'task-iphone17': {
      total: 18,
      alerts: [
        {
          alert_id: 'alert-203',
          level: 'P0',
          rtm3: 'Monobrand',
          rtm4: 'MONO',
          dealer: '盛达通讯',
          store: '杭州西湖店',
          description: '新品培训危机，完成率 5.2%',
          related_entity: '杭州西湖店',
          triggered_at: '2026-04-20T10:00:00Z',
          total_employees: 40,
          completed_count: 2,
          risk_rate: 0.95,
        },
        {
          alert_id: 'alert-204',
          level: 'P0',
          rtm3: 'Monobrand',
          rtm4: 'MONO',
          dealer: '新时代电子',
          store: '成都万象城店',
          description: '完成率 10.5%，剩余时间不足',
          related_entity: '成都万象城店',
          triggered_at: '2026-04-20T11:15:00Z',
          total_employees: 38,
          completed_count: 4,
          risk_rate: 0.895,
        },
        {
          alert_id: 'alert-205',
          level: 'P1',
          rtm3: 'Multibrand',
          rtm4: 'Mass Merchant',
          dealer: '鼎盛科技',
          store: '南京德基广场店',
          description: '进度落后大盘，完成率 35.5%',
          related_entity: '南京德基广场店',
          triggered_at: '2026-04-19T14:30:00Z',
          total_employees: 50,
          completed_count: 18,
          risk_rate: 0.64,
        },
        {
          alert_id: 'alert-201',
          level: 'P2',
          rtm3: 'Carrier',
          rtm4: 'Mass Merchant',
          dealer: '盛达通讯',
          store: '广州正佳广场店',
          description: '起步非常缓慢，完成率 8.2%',
          related_entity: '广州正佳广场店',
          triggered_at: '2026-04-19T18:00:00Z',
          total_employees: 85,
          completed_count: 7,
          risk_rate: 0.918,
        },
      ],
    },
    'task-ipad': {
      total: 3,
      alerts: [
        {
          alert_id: 'alert-301',
          level: 'P1',
          rtm3: 'Education',
          rtm4: 'Campus',
          dealer: '鼎盛科技',
          store: '华北高校门店',
          description: '完成率 42.8%，需在本周内拉齐进度',
          related_entity: '华北高校门店',
          triggered_at: '2026-04-20T10:00:00Z',
          total_employees: 35,
          completed_count: 15,
          risk_rate: 0.571,
        },
        {
          alert_id: 'alert-302',
          level: 'P2',
          rtm3: 'Carrier',
          rtm4: 'Mass Merchant',
          dealer: '华联商贸',
          store: '苏南区域店',
          description: '学习转化率异常偏低',
          related_entity: '苏南区域店',
          triggered_at: '2026-04-19T14:30:00Z',
          total_employees: 60,
          completed_count: 12,
          risk_rate: 0.8,
        },
      ],
    },
    'task-watch': {
      total: 2,
      alerts: [
        {
          alert_id: 'alert-401',
          level: 'P2',
          rtm3: 'Education',
          rtm4: 'Campus',
          dealer: '新时代电子',
          store: '西北大区旗舰店',
          description: '起步阶段活跃度不足，完成率 15.5%',
          related_entity: '西北大区旗舰店',
          triggered_at: '2026-04-18T09:00:00Z',
          total_employees: 110,
          completed_count: 17,
          risk_rate: 0.845,
        },
      ],
    },
    'task-airpods': {
      total: 3,
      alerts: [
        {
          alert_id: 'alert-501',
          level: 'P0',
          rtm3: 'Carrier',
          rtm4: 'Mass Merchant',
          dealer: '华联商贸',
          store: '华中中心店',
          description: '临期危机，大批员工未阅读推送',
          related_entity: '华中中心店',
          triggered_at: '2026-04-20T11:00:00Z',
          total_employees: 45,
          completed_count: 8,
          risk_rate: 0.822,
        },
        {
          alert_id: 'alert-502',
          level: 'P1',
          rtm3: 'Monobrand',
          rtm4: 'MONO',
          dealer: '新时代电子',
          store: '成都太古里店',
          description: '进度落后区域均值 22pp',
          related_entity: '成都太古里店',
          triggered_at: '2026-04-19T16:00:00Z',
          total_employees: 32,
          completed_count: 12,
          risk_rate: 0.625,
        },
      ],
    },
  };

  const getMockDrillData = (stageId: string, dimension: string, seed = '') => {
    const isPushed = stageId === 'pushed';
    const stageRates: Record<string, number> = {
      pushed: 1.0,
      delivered: 0.96,
      read: 0.82,
      in_progress: 0.55,
      completed: 0.35,
    };
    const baseRate = stageRates[stageId] || 0.5;

    const dims: Record<string, string[]> = {
      rtm3: ['Monobrand', 'Multibrand', 'Carrier', 'Education'],
      rtm4: ['MONO', 'Lifestyle', 'Mass Merchant', 'Campus'],
      dealer: [
        '鼎盛科技',
        '华联商贸',
        '盛达通讯',
        '新时代电子',
        '恒大通讯',
        '远方科技',
        '创世商贸',
        '蓝天数码',
      ],
      store: [
        '北京国贸店',
        '上海七宝店',
        '广州天环广场店',
        '深圳万象城店',
        '成都太古里店',
        '重庆万象城店',
        '武汉恒隆广场店',
        '杭州万象城店',
        '南京景枫中心店',
        '沈阳市府恒隆店',
        '苏州中心店',
        '宁波中心店',
        '青岛万象城店',
        '济南恒隆广场店',
        '天津大悦城店',
      ],
    };

    const list = dims[dimension] || dims.rtm3;
    return list
      .map((name) => {
        const hash = (name + seed).split('').reduce((a, b) => a + b.charCodeAt(0), 0);
        let baseTotal = 1000;
        if (dimension === 'rtm3') baseTotal = 4000;
        if (dimension === 'rtm4') baseTotal = 2500;
        if (dimension === 'dealer') baseTotal = 800;
        if (dimension === 'store') baseTotal = 20;

        const total = baseTotal + ((hash * 13) % (baseTotal * 0.8));

        let rate = 1.0;
        if (!isPushed) {
          const vary = ((hash * 7) % 20) / 100 - 0.1;
          rate = Math.min(1, Math.max(0, baseRate + vary));
          if (dimension === 'store') {
            const storeVary = ((hash * 11) % 30) / 100 - 0.15;
            rate = Math.min(1, Math.max(0, baseRate + storeVary));
          }
        }

        let count = Math.round(total * rate);
        if (count > total) count = total;

        return {
          name,
          total: Math.round(total),
          count: count,
          rate: count / total,
        };
      })
      .sort((a, b) => b.rate - a.rate);
  };

  // ================= Global State =================
  const currentTaskId = ref<string | null>(null);
  const isContentLoading = ref(false);
  const isDiagnosisCollapsed = ref(false);
  const lastUpdated = ref(new Date());
  const alertFilter = ref('P0');
  const isFullscreen = ref(false);
  const showFullscreenPrompt = ref(false);
  const isAiOpen = ref(false);
  const isFunnelModalOpen = ref(false);
  const isAlertModalOpen = ref(false);
  const selectedFunnelStage = ref<any>(null);
  let promptTimer: any = null;

  // ================= Dashboard Overview Data =================
  const currentAlerts = ref<any[]>([]);
  const currentAlertsLoading = ref(false);

  const fetchAlerts = async (taskId: string) => {
    currentAlertsLoading.value = true;
    try {
      const promises = [
        getDashboardWarnings({ taskId, warningLevel: 'startDelay', pageSize: 100 }).send(),
        getDashboardWarnings({ taskId, warningLevel: 'p1', pageSize: 100 }).send(),
        getDashboardWarnings({ taskId, warningLevel: 'p0', pageSize: 100 }).send(),
      ];
      const [p2Res, p1Res, p0Res] = await Promise.all(promises);

      let combinedAlerts = [];
      if (p2Res && p2Res.list) {
        combinedAlerts = combinedAlerts.concat(
          p2Res.list.map((a) => ({
            ...a,
            alert_id: a.storeId + '-p2',
            level: 'P2',
            description: a.triggerDesc || '起步异常',
            related_entity: a.storeName,
            total_employees: a.totalCount,
            completed_count: a.completedCount,
            risk_rate: a.warningRate,
          }))
        );
      }
      if (p1Res && p1Res.list) {
        combinedAlerts = combinedAlerts.concat(
          p1Res.list.map((a) => ({
            ...a,
            alert_id: a.storeId + '-p1',
            level: 'P1',
            description: a.triggerDesc || '临期 P1 预警',
            related_entity: a.storeName,
            total_employees: a.totalCount,
            completed_count: a.completedCount,
            risk_rate: a.warningRate,
          }))
        );
      }
      if (p0Res && p0Res.list) {
        combinedAlerts = combinedAlerts.concat(
          p0Res.list.map((a) => ({
            ...a,
            alert_id: a.storeId + '-p0',
            level: 'P0',
            description: a.triggerDesc || '高危 P0 预警',
            related_entity: a.storeName,
            total_employees: a.totalCount,
            completed_count: a.completedCount,
            risk_rate: a.warningRate,
          }))
        );
      }

      // Mock the required grouping fields if they don't exist on the backend response
      // So that the table's "rtm3", "rtm4", "dealer", "store" dimensions can still fallback nicely
      currentAlerts.value = combinedAlerts.map((a) => ({
        ...a,
        rtm3: a.rtm3 || '未分类 RTM3',
        rtm4: a.rtm4 || '未分类 RTM4',
        dealer: a.dealer || '默认经销商',
        store: a.storeName || a.related_entity || '默认门店',
      }));
    } catch (error) {
      console.error('获取预警列表失败', error);
    } finally {
      currentAlertsLoading.value = false;
    }
  };

  const currentOverview = ref<any>(null);

  const fetchOverview = async (taskId: string) => {
    try {
      const data = await getDashboardOverview({ taskId }).send();
      currentOverview.value = data;

      // 如果想要动态计算漏斗数据也可以在这里覆盖，但这里主要覆盖指标区域
    } catch (error) {
      console.error('获取 overview 失败', error);
    }
  };

  watch(currentTaskId, (newId) => {
    if (newId) {
      const hasSpecificDiagnosis = (diagnosisData.value || []).some(
        (d) => d.related_task_id === newId && d.severity !== 'green'
      );
      if (hasSpecificDiagnosis) {
        isAutoCollapsed.value = true;
      } else {
        isAutoCollapsed.value = false;
        isDiagnosisCollapsed.value = true;
      }
      fetchOverview(newId);
      fetchAlerts(newId);
    }
  });

  // ================= Computed Data =================

  const funnelData = computed(() => {
    if (currentOverview.value) {
      const o = currentOverview.value;
      const pushed = o.pushUserCount || o.totalAssignments || 0;
      const delivered = o.totalAssignments || 0;
      const read = o.totalReadCount || 0;
      const inProgress = o.inProgressCount || 0;
      const completed = o.completedCount || 0;
      return {
        funnel: [
          { stage: 'pushed', label: '推送', count: pushed },
          { stage: 'delivered', label: '送达', count: delivered },
          { stage: 'read', label: '已读', count: read },
          { stage: 'in_progress', label: '学习中', count: inProgress + completed }, // 注意，通常漏斗是包含下一步的
          { stage: 'completed', label: '已完成', count: completed },
        ],
      };
    }
    return currentTaskId.value ? (funnelDataByTask as any)[currentTaskId.value] : null;
  });

  const regionData = computed(() =>
    currentTaskId.value ? (regionRankingByTask as any)[currentTaskId.value] : null
  );

  const alertSummary = computed(() => {
    if (currentOverview.value) {
      const w = currentOverview.value.warningCount || { p0: 0, p1: 0, p2: 0 };
      return {
        p0_count: w.p0 || 0,
        p1_count: w.p1 || 0,
        p2_count: w.p2 || 0,
        // 后端如果有下钻数据，可以通过 currentAlerts 统计，或者暂时显示简要分类
        p0_breakdown: w.p0 > 0 ? [{ category: '距离截止 < 24h', count: w.p0 }] : [],
        p1_breakdown: w.p1 > 0 ? [{ category: '距离截止 < 48h', count: w.p1 }] : [],
        p2_breakdown: w.p2 > 0 ? [{ category: '起步转化异常', count: w.p2 }] : [],
      };
    }
    return currentTaskId.value ? (alertSummaryByTask as any)[currentTaskId.value] : null;
  });

  const alertFunnelData = computed(() => {
    if (currentOverview.value) {
      const w = currentOverview.value.warningCount || { p0: 0, p1: 0, p2: 0 };
      const p2 = w.p2 || 0;
      const p1 = w.p1 || 0;
      const p0 = w.p0 || 0;
      // 这里因为是风险“层级递进”，人数是包含关系（P2起步异常 -> 没起步最终变成了P1 -> P1最后变成了P0 -> P0最后变成了Unfinished过期）
      // 为了直观展示转化，我们假设：未完成人数 = overdueCount 或未完成总数
      const unfinished =
        currentOverview.value.overdueCount ||
        currentOverview.value.totalAssignments - currentOverview.value.completedCount ||
        0;

      // 如果没有风险，返回 null 或全0
      if (p2 === 0 && p1 === 0 && p0 === 0 && unfinished === 0) return null;

      return [
        { stage: 'P2', label: 'P2', count: Math.max(p2, p1, p0, unfinished) },
        { stage: 'P1', label: 'P1', count: Math.max(p1, p0, unfinished) },
        { stage: 'P0', label: 'P0', count: Math.max(p0, unfinished) },
        { stage: 'Unfinished', label: '未完成', count: unfinished },
      ];
    }
    return currentTaskId.value ? (alertFunnelByTask as any)[currentTaskId.value] : null;
  });

  const trendData = computed(() =>
    currentTaskId.value ? (trendDataByTask as any)[currentTaskId.value] : null
  );

  const alerts = computed(() => {
    if (currentAlerts.value && currentAlerts.value.length > 0) {
      return {
        total: currentAlerts.value.length,
        alerts: currentAlerts.value,
      };
    }
    return currentTaskId.value ? (alertsByTask as any)[currentTaskId.value] : null;
  });

  // ================= Methods =================
  const formatTime = (date: Date) => {
    if (!date) return '';
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  const triggerLoading = (cb: () => void) => {
    isContentLoading.value = true;
    setTimeout(() => {
      cb();
      isContentLoading.value = false;
    }, 250);
  };

  const handleRefresh = () => (lastUpdated.value = new Date());

  const toggleFullscreen = () => {
    const appElement = document.documentElement;
    if (!document.fullscreenElement) {
      appElement.requestFullscreen().catch((err) => {
        console.error(`Error attempting to enable full-screen mode: ${err.message}`);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  const handleFullscreenChange = () => {
    isFullscreen.value = !!document.fullscreenElement;
    if (isFullscreen.value) {
      showFullscreenPrompt.value = true;
      if (promptTimer) clearTimeout(promptTimer);
      promptTimer = setTimeout(() => {
        showFullscreenPrompt.value = false;
      }, 3000);
    } else {
      showFullscreenPrompt.value = false;
    }
  };

  // ... Diagnosis Flow
  const expandedTasks = ref(false);
  const isAutoCollapsed = ref(true);
  const currentTaskTitle = computed(() => {
    const task = (allTasks.value || []).find((t) => t.task_id === currentTaskId.value);
    return task ? task.task_title : '';
  });

  watch(currentTaskId, (newId) => {
    if (newId) {
      const hasSpecificDiagnosis = (diagnosisData.value || []).some(
        (d) => d.related_task_id === newId && d.severity !== 'green'
      );
      if (hasSpecificDiagnosis) {
        isAutoCollapsed.value = true;
      } else {
        isAutoCollapsed.value = false;
        isDiagnosisCollapsed.value = true;
      }
    }
  });

  const handleDiagnosisClick = (diagnosis: any) => {
    if (diagnosis.action_type === 'none') {
      expandedTasks.value = !expandedTasks.value;
    } else if (diagnosis.severity !== 'green') {
      isAutoCollapsed.value = true;
      if (diagnosis.related_task_id)
        triggerLoading(() => (currentTaskId.value = diagnosis.related_task_id));
    }
  };

  const handleTaskSelect = (taskId: string) => {
    if (taskId === currentTaskId.value) {
      const hasSpecificDiagnosis = (diagnosisData.value || []).some(
        (d) => d.related_task_id === taskId && d.severity !== 'green'
      );
      if (hasSpecificDiagnosis) {
        isAutoCollapsed.value = true;
      } else {
        isAutoCollapsed.value = false;
        isDiagnosisCollapsed.value = true;
      }
    }
    triggerLoading(() => (currentTaskId.value = taskId));
    expandedTasks.value = false;
  };

  const severityColors: Record<string, string> = {
    red: '#FF3B30',
    yellow: '#FF9500',
    green: '#34C759',
  };
  const redCount = computed(
    () => (diagnosisData.value || []).filter((d) => d.severity === 'red').length
  );
  const yellowCount = computed(
    () => (diagnosisData.value || []).filter((d) => d.severity === 'yellow').length
  );
  const greenCount = computed(() => {
    const alertTasksCount = redCount.value + yellowCount.value;
    return Math.max(0, (allTasks.value || []).length - alertTasksCount);
  });

  // ... Metrics
  const metricCompletionRate = computed(() => {
    if (currentOverview.value) {
      return currentOverview.value.completionRate / 100 || 0;
    }
    return funnelData.value?.completion_rate || 0;
  });
  // 假定较昨天的数据：如果后端没有直接返回，我们可以先 mock 一个合理的波动或返回0
  const metricCompletionRateDelta = computed(() => {
    return funnelData.value?.completion_rate_delta || 0.02; // 默认给一个+2%的增长演示
  });
  const metricConfirmationRate = computed(() => {
    if (currentOverview.value) {
      return currentOverview.value.taskReadRate / 100 || 0;
    }
    return funnelData.value?.confirmation_rate || 0;
  });
  const metricHoursRemaining = computed(() => {
    const currentTask = allTasks.value.find((t) => t.task_id === currentTaskId.value);
    if (currentTask && currentTask.deadline && currentTask.deadline !== '无截止时间') {
      const ddlDate = new Date(currentTask.deadline + 'T23:59:59'); // 假设截止到当天的23:59:59
      const diff = ddlDate.getTime() - new Date().getTime();
      if (diff > 0) {
        return Math.floor(diff / (1000 * 60 * 60));
      }
      return 0;
    }
    return funnelData.value?.hours_remaining || 0;
  });
  const metricReadCount = computed(() => currentOverview.value?.totalReadCount || 0);
  const metricDeliveredCount = computed(() => currentOverview.value?.totalAssignments || 0);
  const metricP0Count = computed(() => currentOverview.value?.warningCount?.p0 || 0);
  const metricP1Count = computed(() => currentOverview.value?.warningCount?.p1 || 0);
  const metricP2Count = computed(() => currentOverview.value?.warningCount?.p2 || 0);
  const metricTotalAlerts = computed(
    () => metricP0Count.value + metricP1Count.value + metricP2Count.value
  );

  const getTrendColor = (delta: number) =>
    delta > 0 ? '#34C759' : delta < 0 ? '#FF3B30' : '#86868B';

  // ... Funnel Chart
  const funnelAnimated = ref(false);
  const stageColors: Record<string, string> = {
    pushed: '#C8E1FF',
    delivered: '#99CEFF',
    read: '#64B5F6',
    in_progress: '#2997FF',
    completed: '#0071E3',
  };
  watch(
    funnelData,
    () => {
      funnelAnimated.value = false;
      setTimeout(() => (funnelAnimated.value = true), 50);
    },
    { immediate: true }
  );

  const funnelMaxCount = computed(() => funnelData.value?.funnel?.[0]?.count || 1);
  const getFunnelWidth = (stage: any) => (stage.count / funnelMaxCount.value) * 100;
  const getFunnelRate = (stage: any) => (stage.count / funnelMaxCount.value) * 100;
  const getFunnelDropRate = (index: number) => {
    if (index === 0 || !funnelData.value?.funnel) return 0;
    const prev = funnelData.value.funnel[index - 1].count;
    const curr = funnelData.value.funnel[index].count;
    return ((prev - curr) / prev) * 100;
  };
  const getFunnelDropWidth = (index: number) => {
    if (!funnelData.value?.funnel) return 0;
    const prev = funnelData.value.funnel[index - 1].count;
    const curr = funnelData.value.funnel[index].count;
    return ((prev - curr) / funnelMaxCount.value) * 100;
  };
  const handleFunnelDrillDown = (stage: any) => {
    selectedFunnelStage.value = stage;
    isFunnelModalOpen.value = true;
  };

  // ... Alert Summary
  const getAlertStageCount = (stage: string) => {
    if (!alertFunnelData.value) return 0;
    const s = alertFunnelData.value.find((f: any) => f.stage === stage);
    return s ? s.count : 0;
  };
  const alertTotalPeople = computed(
    () => getAlertStageCount('P0') + getAlertStageCount('P1') + getAlertStageCount('P2')
  );
  const getAlertPercentage = (stage: string) => {
    const count = getAlertStageCount(stage);
    if (!alertTotalPeople.value || alertTotalPeople.value === 0) return '0%';
    return Math.round((count / alertTotalPeople.value) * 100) + '%';
  };
  const handleSelectAlertFilter = (level: string) => {
    alertFilter.value = level;
  };

  // ... Alert Funnel
  const alertFunnelAnimated = ref(false);
  watch(
    alertFunnelData,
    () => {
      alertFunnelAnimated.value = false;
      setTimeout(() => (alertFunnelAnimated.value = true), 50);
    },
    { immediate: true }
  );
  const alertFunnelMaxCount = computed(() => alertFunnelData.value?.[0]?.count || 1);
  const getAlertFunnelWidth = (stage: any) => (stage.count / alertFunnelMaxCount.value) * 100;
  const getAlertConversionRate = (index: number) => {
    if (index === 0 || !alertFunnelData.value) return 0;
    const prev = alertFunnelData.value[index - 1].count;
    const curr = alertFunnelData.value[index].count;
    return (curr / prev) * 100;
  };
  const getOverallConversionRate = () => {
    if (!alertFunnelData.value || alertFunnelData.value.length < 2) return 0;
    const first = alertFunnelData.value[0].count;
    const last = alertFunnelData.value[alertFunnelData.value.length - 1].count;
    if (first === 0) return 0;
    return ((first - last) / first) * 100;
  };
  const getAlertBarColor = (stageId: string) => {
    switch (stageId) {
      case 'P2':
        return '#FFCC00';
      case 'P1':
        return '#FF9500';
      case 'P0':
        return '#FF3B30';
      case 'Unfinished':
        return '#86868B';
      default:
        return '#0071E3';
    }
  };
  const handleDrillDownAlerts = (level: string) => {
    alertFilter.value = level;
    isAlertModalOpen.value = true;
  };

  // ... Trend Chart
  const chartRef = ref<HTMLElement | null>(null);
  let chartInstance: echarts.ECharts | null = null;
  const currentDim = ref('daily');
  const currentSubPeriod = ref('');
  const subPeriodOptions = computed(() => {
    if (!trendData.value) return [];
    return Object.keys(trendData.value[currentDim.value] || {});
  });
  watch(
    trendData,
    (newData) => {
      if (!newData) return;
      const keys = Object.keys(newData[currentDim.value] || {});
      if (keys.length > 0) {
        if (!keys.includes(currentSubPeriod.value)) currentSubPeriod.value = keys[0];
        else nextTick(renderChart);
      }
    },
    { deep: true, immediate: true }
  );
  watch(currentDim, (newDim) => {
    if (!trendData.value) return;
    const keys = Object.keys(trendData.value[newDim] || {});
    if (keys.length > 0) currentSubPeriod.value = keys[0];
    else currentSubPeriod.value = '';
  });
  watch(currentSubPeriod, () => {
    nextTick(renderChart);
  });

  const renderChart = () => {
    if (!chartRef.value || !trendData.value) return;
    let activeData: any[] = [];
    if (currentSubPeriod.value && trendData.value[currentDim.value]) {
      activeData = trendData.value[currentDim.value][currentSubPeriod.value] || [];
    }
    if (chartInstance) chartInstance.dispose();

    chartInstance = echarts.init(chartRef.value);
    const xAxisData = activeData.map((d) => d.time);
    const incrementData = activeData.map((d) => d.increment);
    const cumulativeData = activeData.map((d) => d.cumulative);

    const option = {
      grid: { top: 30, right: 10, left: 10, bottom: 20, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(0, 0, 0, 0.03)' } },
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        borderColor: '#F3F4F6',
        borderWidth: 1,
        padding: [12, 16],
        textStyle: { color: '#111827' },
        formatter: (params: any) => {
          let res = `<div style="font-weight:600;margin-bottom:8px;color:#6B7280;font-size:12px;">${params[0].name}</div>`;
          params.forEach((p: any) => {
            const color = p.seriesName === '增量' ? '#8CC4FF' : '#0071E3';
            res += `<div style="display:flex;align-items:center;gap:12px;font-size:14px;margin-top:6px;">
                    <span style="width:8px;height:8px;border-radius:50%;background-color:${color}"></span>
                    <span style="color:#4B5563;font-weight:500;">${p.seriesName}</span>
                    <span style="font-weight:700;color:#111827;margin-left:auto;">${p.value.toLocaleString()}</span>
                  </div>`;
          });
          return res;
        },
      },
      xAxis: {
        type: 'category',
        boundaryGap: true,
        data: xAxisData,
        axisLine: { lineStyle: { color: '#E5E5E7' } },
        axisTick: { show: false },
        axisLabel: { color: '#86868B', fontSize: 11, margin: 12 },
      },
      yAxis: [
        {
          type: 'value',
          name: '累计完成',
          nameTextStyle: { color: '#86868B', fontSize: 11, align: 'right' },
          splitLine: { lineStyle: { color: '#F5F5F7', type: 'dashed' } },
          axisLabel: { color: '#86868B', fontSize: 11 },
        },
        {
          type: 'value',
          name: '单期增量',
          nameTextStyle: { color: '#86868B', fontSize: 11, align: 'left' },
          splitLine: { show: false },
          axisLabel: { color: '#86868B', fontSize: 11 },
        },
      ],
      series: [
        {
          name: '增量',
          data: incrementData,
          type: 'bar',
          yAxisIndex: 1,
          barMaxWidth: 32,
          itemStyle: { color: '#D0E2FF', borderRadius: [4, 4, 0, 0] },
          emphasis: { itemStyle: { color: '#A4D9FF' } },
        },
        {
          name: '累计',
          data: cumulativeData,
          type: 'line',
          yAxisIndex: 0,
          smooth: 0.3,
          itemStyle: { color: '#0071E3' },
          lineStyle: {
            width: 3,
            shadowColor: 'rgba(0,113,227,0.2)',
            shadowBlur: 8,
            shadowOffsetY: 4,
          },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(0, 113, 227, 0.15)' },
              { offset: 1, color: 'rgba(0, 113, 227, 0)' },
            ]),
          },
          symbolSize: 8,
          showSymbol: false,
          emphasis: { focus: 'series' },
        },
      ],
    };
    chartInstance.setOption(option);
  };

  // ... Region Ranking
  const rrExpandedMiddle = ref(false);
  const rrSearchQuery = ref('');
  const rrSelectedRTM3 = ref<any>(null);
  const rrSelectedRTM4 = ref<any>(null);
  const rrSelectedDealer = ref<any>(null);
  const rrCurrentDimension = ref('rtm3');
  const rrSortKey = ref('completion_rate');
  const rrSortOrder = ref('desc');

  const rrHandleSort = (key: string) => {
    if (rrSortKey.value === key) rrSortOrder.value = rrSortOrder.value === 'desc' ? 'asc' : 'desc';
    else {
      rrSortKey.value = key;
      rrSortOrder.value = 'desc';
    }
  };
  const rrParseTime = (str: string) => {
    if (!str || str === '-') return 999999;
    if (str.endsWith('h')) return parseFloat(str) * 60;
    if (str.endsWith('m')) return parseFloat(str);
    return 0;
  };
  const rrAvailableDimensions = computed(() => {
    if (!rrSelectedRTM3.value)
      return [
        { label: 'RTM3', value: 'rtm3' },
        { label: 'RTM4', value: 'rtm4' },
        { label: '经销商', value: 'dealer' },
        { label: '门店', value: 'store' },
      ];
    return [
      { label: 'RTM4', value: 'rtm4' },
      { label: '经销商', value: 'dealer' },
      { label: '门店', value: 'store' },
    ];
  });
  const rrDimensionLabel = computed(
    () =>
      rrAvailableDimensions.value.find((d) => d.value === rrCurrentDimension.value)?.label ||
      '节点名称'
  );

  const rrCurrentNodes = computed(() => {
    let nodes: any[] = [];
    if (rrCurrentDimension.value === 'rtm3') {
      nodes = regionData.value?.regions || [];
    } else if (rrCurrentDimension.value === 'rtm4') {
      if (rrSelectedRTM3.value && rrSelectedRTM3.value.children)
        nodes = rrSelectedRTM3.value.children;
      else
        nodes = [
          {
            region_id: 'r4-1',
            region_name: 'MONO',
            completion_rate: 0.85,
            completed_count: 8500,
            employee_count: 10000,
            avg_time: '1.0h',
          },
          {
            region_id: 'r4-2',
            region_name: 'Lifestyle',
            completion_rate: 0.7,
            completed_count: 5600,
            employee_count: 8000,
            avg_time: '1.5h',
          },
        ];
    } else if (rrCurrentDimension.value === 'dealer') {
      nodes = [
        {
          region_id: 'd1',
          region_name: '鼎盛科技',
          completion_rate: 0.95,
          completed_count: 950,
          employee_count: 1000,
          avg_time: '0.8h',
        },
        {
          region_id: 'd2',
          region_name: '华联商贸',
          completion_rate: 0.88,
          completed_count: 440,
          employee_count: 500,
          avg_time: '1.2h',
        },
      ];
    } else if (rrCurrentDimension.value === 'store') {
      nodes = [
        {
          region_id: 's1',
          region_name: '北京国贸店',
          completion_rate: 1.0,
          completed_count: 25,
          employee_count: 25,
          avg_time: '45m',
        },
        {
          region_id: 's2',
          region_name: '上海七宝店',
          completion_rate: 0.96,
          completed_count: 24,
          employee_count: 25,
          avg_time: '50m',
        },
      ];
    }

    if (rrSearchQuery.value.trim()) {
      const q = rrSearchQuery.value.trim().toLowerCase();
      nodes = nodes.filter((n) => (n.region_name || n.entity_name || '').toLowerCase().includes(q));
    }

    const sorted = [...nodes].sort((a, b) => {
      let valA = a[rrSortKey.value];
      let valB = b[rrSortKey.value];
      if (rrSortKey.value === 'avg_time_val') {
        valA = rrParseTime(a.avg_time);
        valB = rrParseTime(b.avg_time);
      } else {
        valA = valA || 0;
        valB = valB || 0;
      }
      if (valA < valB) return rrSortOrder.value === 'asc' ? -1 : 1;
      if (valA > valB) return rrSortOrder.value === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted.map((n, idx) => ({ ...n, rank: idx + 1 }));
  });

  const rrTopRegions = computed(() => {
    const count =
      rrCurrentDimension.value === 'dealer' || rrCurrentDimension.value === 'store' ? 3 : 2;
    return rrCurrentNodes.value.slice(0, count);
  });
  const rrBottomRegions = computed(() => {
    const count =
      rrCurrentDimension.value === 'dealer' || rrCurrentDimension.value === 'store' ? 3 : 2;
    return rrCurrentNodes.value.length > count * 2
      ? rrCurrentNodes.value.slice(-count)
      : rrCurrentNodes.value.slice(count);
  });
  const rrMiddleRegions = computed(() => {
    const count =
      rrCurrentDimension.value === 'dealer' || rrCurrentDimension.value === 'store' ? 3 : 2;
    return rrCurrentNodes.value.length > count * 2 ? rrCurrentNodes.value.slice(count, -count) : [];
  });

  const rrHandleDrillDown = (region: any) => {
    if (rrCurrentDimension.value === 'rtm3') {
      rrSelectedRTM3.value = region;
      rrSelectedRTM4.value = null;
      rrSelectedDealer.value = null;
      rrCurrentDimension.value = 'rtm4';
    } else if (rrCurrentDimension.value === 'rtm4') {
      rrSelectedRTM4.value = region;
      rrSelectedDealer.value = null;
      rrCurrentDimension.value = 'dealer';
    } else if (rrCurrentDimension.value === 'dealer') {
      rrSelectedDealer.value = region;
      rrCurrentDimension.value = 'store';
    }
    rrExpandedMiddle.value = false;
    rrSearchQuery.value = '';
  };

  const rrGoToBreadcrumb = (level: string) => {
    if (level === 'root') {
      rrSelectedRTM3.value = null;
      rrSelectedRTM4.value = null;
      rrSelectedDealer.value = null;
      rrCurrentDimension.value = 'rtm3';
    } else if (level === 'rtm3') {
      rrSelectedRTM4.value = null;
      rrSelectedDealer.value = null;
      rrCurrentDimension.value = 'rtm4';
    } else if (level === 'rtm4') {
      rrSelectedDealer.value = null;
      rrCurrentDimension.value = 'dealer';
    }
    rrExpandedMiddle.value = false;
    rrSearchQuery.value = '';
  };

  // ... AI Assistant
  const aiSessionId = ref<string | null>(null);
  const aiMessages = ref<any[]>([
    {
      role: 'ai',
      content:
        '您好！我是 **AI 数据助手**。我可以帮您分析当前任务看板的各项指标、解读预警数据或总结大盘趋势。请问有什么我可以帮您？',
    },
  ]);
  const aiInputText = ref('');
  const aiIsTyping = ref(false);
  let currentChatAbortController: AbortController | null = null;

  const AiChart = defineComponent({
    props: { config: Object },
    setup(props) {
      const chartRef = ref<HTMLElement | null>(null);
      let chartInstance: echarts.ECharts | null = null;
      let ro: ResizeObserver | null = null;

      const renderChart = () => {
        if (chartRef.value && props.config) {
          if (!chartInstance) {
            chartInstance = echarts.init(chartRef.value);
          }
          chartInstance.setOption(props.config, true);
        }
      };

      const downloadChart = () => {
        if (chartInstance) {
          const url = chartInstance.getDataURL({
            type: 'png',
            backgroundColor: '#fff',
            pixelRatio: 2,
          });
          const a = document.createElement('a');
          a.href = url;
          a.download = 'chart.png';
          a.click();
        }
      };

      onMounted(() => {
        renderChart();
        if (chartRef.value) {
          ro = new ResizeObserver(() => {
            chartInstance?.resize();
          });
          ro.observe(chartRef.value);
        }
      });
      watch(() => props.config, renderChart, { deep: true });
      onUnmounted(() => {
        ro?.disconnect();
        chartInstance?.dispose();
      });

      return () =>
        h(
          'div',
          {
            class:
              'relative mt-4 mb-2 border border-gray-200 rounded-xl p-2 bg-gray-50 flex flex-col shadow-sm',
          },
          [
            h(
              'div',
              {
                class: 'flex justify-between items-center px-2 pb-2 mb-2 border-b border-gray-200',
              },
              [
                h(
                  'span',
                  { class: 'text-xs text-gray-500 font-semibold' },
                  '📈 交互式图表 (可拖拽右下角缩放)'
                ),
                h(
                  'button',
                  {
                    onClick: downloadChart,
                    class:
                      'p-1.5 bg-white hover:bg-gray-100 rounded text-[#0071E3] text-xs transition-colors shadow-sm border border-gray-200',
                    title: '下载图表为图片',
                  },
                  '⬇️ 下载'
                ),
              ]
            ),
            h('div', {
              ref: chartRef,
              style: {
                width: '100%',
                height: '260px',
                resize: 'both',
                overflow: 'hidden',
                minHeight: '150px',
              },
            }),
          ]
        );
    },
  });

  // Configure marked with custom table renderer
  marked.setOptions({
    gfm: true,
    breaks: true,
  });

  marked.use({
    extensions: [
      {
        name: 'table',
        renderer(token) {
          let html = '';
          let header = '';
          for (const h of token.header) {
            let alignStr = h.align ? ` align="${h.align}"` : '';
            header += `<th${alignStr}>${this.parser.parseInline(h.tokens)}</th>`;
          }
          header = `<thead><tr>${header}</tr></thead>`;

          let body = '';
          for (const r of token.rows) {
            let cells = '';
            for (const c of r) {
              let alignStr = c.align ? ` align="${c.align}"` : '';
              cells += `<td${alignStr}>${this.parser.parseInline(c.tokens)}</td>`;
            }
            body += `<tr>${cells}</tr>`;
          }
          if (body) body = `<tbody>${body}</tbody>`;

          html = `<table>${header}${body}</table>`;

          // Generate CSV string
          let csvContent = '';
          if (token.header && token.header.length > 0) {
            csvContent +=
              token.header.map((h) => `"${(h.text || '').replace(/"/g, '""')}"`).join(',') + '\n';
          }
          if (token.rows && token.rows.length > 0) {
            token.rows.forEach((row) => {
              csvContent +=
                row.map((c) => `"${(c.text || '').replace(/"/g, '""')}"`).join(',') + '\n';
            });
          }

          const bom = '\uFEFF';
          const encodedUri = 'data:text/csv;charset=utf-8,' + encodeURIComponent(bom + csvContent);

          return `<div class="markdown-table-wrapper group" style="position: relative; resize: both; overflow: hidden; min-height: 80px; max-height: 400px; padding: 4px; border: 1px dashed #D1D1D6; border-radius: 8px; margin-top: 12px; margin-bottom: 12px; background: #fff; display: flex; flex-direction: column;">
        <a href="${encodedUri}" download="table_data.csv" title="导出 CSV" class="absolute top-2 right-2 p-1.5 bg-white/90 backdrop-blur border border-gray-200 rounded-md shadow-sm text-gray-500 hover:text-blue-600 hover:bg-blue-50 transition-all opacity-0 group-hover:opacity-100 cursor-pointer z-10">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </a>
        <div style="flex: 1; overflow: auto; padding-right: 4px;">
           ${html}
        </div>
      </div>`;
        },
      },
    ],
  });

  const parsedAiMessages = computed(() => {
    return aiMessages.value.map((msg) => {
      let text = msg.content || '';
      let suggestions = [];
      let echartsConfigs = [];
      let thinkingText = '';
      let hasThinking = false;

      if (msg.role === 'ai') {
        const suggRegex = /\`\`\`suggestions\s*([\s\S]*?)\s*\`\`\`/;
        const suggMatch = text.match(suggRegex);
        if (suggMatch) {
          try {
            suggestions = JSON.parse(suggMatch[1]);
            text = text.replace(suggRegex, '');
          } catch (e) {}
        } else {
          const rawArrayRegex = /\[\s*(?:"可追问：[^"]+",?\s*)+\s*\]$/;
          const rawMatch = text.match(rawArrayRegex);
          if (rawMatch) {
            try {
              suggestions = JSON.parse(rawMatch[0]);
              text = text.replace(rawArrayRegex, '');
            } catch (e) {}
          }
        }
        suggestions = suggestions.map((s) => s.replace(/^可追问：/, ''));

        const chartRegex = /\`\`\`echarts\s*([\s\S]*?)\s*\`\`\`/g;
        let match;
        while ((match = chartRegex.exec(text)) !== null) {
          try {
            echartsConfigs.push(JSON.parse(match[1]));
          } catch (e) {}
        }
        text = text.replace(chartRegex, '');

        // 提取 <think> 标签内容 (针对标准 DeepSeek Reasoning 格式)
        const thinkRegex = /<think>([\s\S]*?)<\/think>/;
        const thinkMatch = text.match(thinkRegex);
        if (thinkMatch) {
          thinkingText = thinkMatch[1].trim();
          text = text.replace(thinkRegex, '').trim();
          hasThinking = true;
        } else {
          // 软启发式截断规则：寻找 Markdown 结构化语法的起点
          let splitIndex = -1;
          const headingMatch = text.match(/\n(#|---|\|\s|- \*\*)/);
          if (headingMatch && headingMatch.index > 0) {
            splitIndex = headingMatch.index;
          } else {
            const doubleNewlineMatch = text.match(/\n\n/);
            if (doubleNewlineMatch && doubleNewlineMatch.index > 0) {
              splitIndex = doubleNewlineMatch.index;
            }
          }

          if (splitIndex > 0) {
            const preamble = text.substring(0, splitIndex).trim();
            // 如果前面的"非结构化"段落超过20个字符且不包含代码块，我们认为它是啰嗦的思考过程
            // 而且如果 preamble 以 "好的"、"首先"、"让我" 等开头，那就是典型的 AI 思考语言
            if (preamble.length > 20 && !preamble.includes('```')) {
              thinkingText = preamble;
              text = text.substring(splitIndex).trim();
              hasThinking = true;
            }
          }
        }
      }

      return {
        ...msg,
        parsedText: text,
        thinkingText,
        hasThinking,
        suggestions,
        echartsConfigs,
      };
    });
  });

  const renderMarkdown = (text: string) => {
    if (!text) return '';

    // 识别并美化大盘统计摘要行
    const summaryRegex =
      /当前时间：(.*?)\s*\|\s*整体完成率：(.*?)\s*\|\s*全平台\s*(\d+)\s*人，仅完成\s*(\d+)\s*人。/g;

    text = text.replace(summaryRegex, (match, time, rate, total, finished) => {
      return `<div class="my-4 p-4 bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 rounded-2xl flex flex-col gap-3 shadow-sm select-none no-prose">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <div class="p-1.5 bg-blue-500 rounded-lg shadow-blue-200 shadow-lg">
             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><path d="M12 2v20M2 12h20"/><path d="m17 7 5 5-5 5M7 7l-5 5 5 5"/></svg>
          </div>
          <span class="text-[13px] font-bold text-blue-800">实时大盘洞察</span>
        </div>
        <div class="text-[11px] font-medium text-blue-400 bg-white/60 px-2 py-0.5 rounded-full border border-blue-50">数据统计截止: ${time}</div>
      </div>
      
      <div class="flex items-center gap-6 mt-1">
        <div class="flex flex-col">
          <span class="text-[10px] text-blue-400 font-bold uppercase tracking-wider">完成进度</span>
          <div class="flex items-baseline gap-1">
            <span class="text-xl font-black text-blue-600 font-outfit">${rate}</span>
          </div>
        </div>
        <div class="h-8 w-px bg-blue-100/60"></div>
        <div class="flex flex-col flex-1">
          <div class="flex justify-between items-center mb-1.5">
            <span class="text-[10px] text-blue-400 font-bold uppercase tracking-wider">覆盖情况</span>
            <span class="text-[11px] font-bold text-blue-700">${finished} <span class="text-blue-300 font-normal">/ ${total} 人</span></span>
          </div>
          <div class="w-full h-1.5 bg-white rounded-full overflow-hidden border border-blue-50 shadow-inner">
            <div class="h-full bg-gradient-to-r from-blue-400 to-blue-600 rounded-full transition-all duration-1000" style="width: ${rate}"></div>
          </div>
        </div>
      </div>
    </div>`;
    });

    return marked(text) as string;
  };

  const initAiSession = async () => {
    try {
      const res = await createDashboardChatSession().send();
      if (res && res.sessionId) {
        aiSessionId.value = res.sessionId;
      }
    } catch (err) {
      console.error('Failed to init dashboard chat session', err);
    }
  };

  const aiScrollChatToBottom = () => {
    nextTick(() => {
      const container = document.getElementById('chat-container');
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    });
  };

  const aiSendMessage = async () => {
    const text = aiInputText.value.trim();
    if (!text || aiIsTyping.value) return;

    if (!aiSessionId.value) {
      await initAiSession();
      if (!aiSessionId.value) {
        aiMessages.value.push({ role: 'ai', content: '抱歉，无法初始化对话会话，请稍后再试。' });
        return;
      }
    }

    aiMessages.value.push({ role: 'user', content: text });
    aiInputText.value = '';
    aiIsTyping.value = true;
    aiScrollChatToBottom();

    const replyIndex = aiMessages.value.length;
    aiMessages.value.push({ role: 'ai', content: '' });

    currentChatAbortController = new AbortController();

    try {
      await streamDashboardChatMessage(
        aiSessionId.value,
        text,
        (chunk) => {
          if (chunk && chunk.text) {
            aiMessages.value[replyIndex].content += chunk.text;
            aiScrollChatToBottom();
          }
        },
        (data) => {
          aiIsTyping.value = false;
          currentChatAbortController = null;
          aiScrollChatToBottom();
        },
        (err) => {
          aiMessages.value[replyIndex].content +=
            '<br><span style="color:red">请求异常终止或超时</span>';
          aiIsTyping.value = false;
          currentChatAbortController = null;
          aiScrollChatToBottom();
        },
        { signal: currentChatAbortController.signal }
      );
    } catch (e) {
      //
    }
  };

  const aiSendSuggestion = (text: string) => {
    aiInputText.value = text;
    aiSendMessage();
  };
  watch(isAiOpen, (newVal) => {
    if (newVal) {
      if (!aiSessionId.value) initAiSession();
      aiScrollChatToBottom();
    }
  });

  // ... Funnel Modal
  const fmCurrentDimension = ref('rtm3');
  const fmSearchQuery = ref('');
  const fmSelectedRTM3 = ref<string | null>(null);
  const fmSelectedRTM4 = ref<string | null>(null);
  const fmSelectedDealer = ref<string | null>(null);

  const fmAvailableDimensions = computed(() => {
    if (!fmSelectedRTM3.value)
      return [
        { label: 'RTM3', value: 'rtm3' },
        { label: 'RTM4', value: 'rtm4' },
        { label: '经销商', value: 'dealer' },
        { label: '门店', value: 'store' },
      ];
    if (!fmSelectedRTM4.value)
      return [
        { label: 'RTM4', value: 'rtm4' },
        { label: '经销商', value: 'dealer' },
        { label: '门店', value: 'store' },
      ];
    if (!fmSelectedDealer.value)
      return [
        { label: '经销商', value: 'dealer' },
        { label: '门店', value: 'store' },
      ];
    return [{ label: '门店', value: 'store' }];
  });
  const fmGoToBreadcrumb = (level: string) => {
    if (level === 'root') {
      fmSelectedRTM3.value = null;
      fmSelectedRTM4.value = null;
      fmSelectedDealer.value = null;
      fmCurrentDimension.value = 'rtm3';
    } else if (level === 'rtm3') {
      fmSelectedRTM4.value = null;
      fmSelectedDealer.value = null;
      fmCurrentDimension.value = 'rtm4';
    } else if (level === 'rtm4') {
      fmSelectedDealer.value = null;
      fmCurrentDimension.value = 'dealer';
    }
    fmSearchQuery.value = '';
  };
  const fmHandleDrillDown = (row: any) => {
    if (fmCurrentDimension.value === 'rtm3') {
      fmSelectedRTM3.value = row.name;
      fmCurrentDimension.value = 'rtm4';
    } else if (fmCurrentDimension.value === 'rtm4') {
      fmSelectedRTM4.value = row.name;
      fmCurrentDimension.value = 'dealer';
    } else if (fmCurrentDimension.value === 'dealer') {
      fmSelectedDealer.value = row.name;
      fmCurrentDimension.value = 'store';
    }
    fmSearchQuery.value = '';
  };
  const fmSortKey = ref('rate');
  const fmSortOrder = ref('desc');
  const fmHandleSort = (key: string) => {
    if (fmSortKey.value === key) fmSortOrder.value = fmSortOrder.value === 'desc' ? 'asc' : 'desc';
    else {
      fmSortKey.value = key;
      fmSortOrder.value = 'desc';
    }
  };
  const fmTableData = computed(() => {
    if (!isFunnelModalOpen.value || !selectedFunnelStage.value) return [];
    const seed =
      (fmSelectedRTM3.value || '') + (fmSelectedRTM4.value || '') + (fmSelectedDealer.value || '');
    let data = getMockDrillData(selectedFunnelStage.value.stage, fmCurrentDimension.value, seed);
    if (fmSearchQuery.value.trim()) {
      const q = fmSearchQuery.value.trim().toLowerCase();
      data = data.filter((d) => d.name.toLowerCase().includes(q));
    }
    return data.sort((a, b) => {
      const valA = (a as any)[fmSortKey.value];
      const valB = (b as any)[fmSortKey.value];
      if (valA < valB) return fmSortOrder.value === 'asc' ? -1 : 1;
      if (valA > valB) return fmSortOrder.value === 'asc' ? 1 : -1;
      return 0;
    });
  });
  watch(isFunnelModalOpen, (v) => {
    if (v) {
      fmSelectedRTM3.value = null;
      fmSelectedRTM4.value = null;
      fmSelectedDealer.value = null;
      fmCurrentDimension.value = 'rtm3';
      fmSearchQuery.value = '';
    }
  });

  // ... Alert Modal / Table
  const amFilter = ref(alertFilter.value);
  const amShowMore = ref(false);
  const amCurrentDimension = ref('rtm3');
  const amSelectedRTM3 = ref<string | null>(null);
  const amSelectedRTM4 = ref<string | null>(null);
  const amSelectedDealer = ref<string | null>(null);
  const amSearchQuery = ref('');
  const amSortKey = ref('risk_rate');
  const amSortOrder = ref('desc');

  watch(
    alertFilter,
    (newVal) => {
      amFilter.value = newVal;
    },
    { immediate: true }
  );
  const amHandleSort = (key: string) => {
    if (amSortKey.value === key) amSortOrder.value = amSortOrder.value === 'desc' ? 'asc' : 'desc';
    else {
      amSortKey.value = key;
      amSortOrder.value = 'desc';
    }
  };
  const amAvailableDimensions = computed(() => {
    if (!amSelectedRTM3.value)
      return [
        { label: 'RTM3', value: 'rtm3' },
        { label: 'RTM4', value: 'rtm4' },
        { label: '经销商', value: 'dealer' },
        { label: '门店', value: 'store' },
      ];
    if (!amSelectedRTM4.value)
      return [
        { label: 'RTM4', value: 'rtm4' },
        { label: '经销商', value: 'dealer' },
        { label: '门店', value: 'store' },
      ];
    if (!amSelectedDealer.value)
      return [
        { label: '经销商', value: 'dealer' },
        { label: '门店', value: 'store' },
      ];
    return [{ label: '门店', value: 'store' }];
  });
  const amGoToBreadcrumb = (level: string) => {
    if (level === 'root') {
      amSelectedRTM3.value = null;
      amSelectedRTM4.value = null;
      amSelectedDealer.value = null;
      amCurrentDimension.value = 'rtm3';
    } else if (level === 'rtm3') {
      amSelectedRTM4.value = null;
      amSelectedDealer.value = null;
      amCurrentDimension.value = 'rtm4';
    } else if (level === 'rtm4') {
      amSelectedDealer.value = null;
      amCurrentDimension.value = 'dealer';
    }
    amSearchQuery.value = '';
  };
  const amHandleDrillDown = (row: any) => {
    if (amCurrentDimension.value === 'rtm3') {
      amSelectedRTM3.value = row.entity_name;
      amCurrentDimension.value = 'rtm4';
    } else if (amCurrentDimension.value === 'rtm4') {
      amSelectedRTM4.value = row.entity_name;
      amCurrentDimension.value = 'dealer';
    } else if (amCurrentDimension.value === 'dealer') {
      amSelectedDealer.value = row.entity_name;
      amCurrentDimension.value = 'store';
    }
    amSearchQuery.value = '';
  };
  const amFilteredAlerts = computed(() => {
    let alts = alerts.value?.alerts || [];
    if (amFilter.value === 'Unfinished') {
      alts = alts
        .filter((a: any) => a.completed_count < a.total_employees)
        .map((a: any) => ({
          ...a,
          level: 'Unfinished',
          risk_rate: 1 - (a.completed_count || 0) / (a.total_employees || 1),
        }));
    } else {
      alts = alts.filter((a: any) => a.level === amFilter.value);
    }
    if (amSelectedRTM3.value) alts = alts.filter((a: any) => a.rtm3 === amSelectedRTM3.value);
    if (amSelectedRTM4.value) alts = alts.filter((a: any) => a.rtm4 === amSelectedRTM4.value);
    if (amSelectedDealer.value) alts = alts.filter((a: any) => a.dealer === amSelectedDealer.value);
    return alts;
  });
  const amGroupedAlerts = computed(() => {
    const raw = amFilteredAlerts.value;
    let results: any[] = [];
    if (amCurrentDimension.value === 'store') {
      results = raw.map((a: any) => ({ ...a, entity_name: a.store || a.related_entity }));
    } else {
      const map: Record<string, any> = {};
      raw.forEach((a: any) => {
        const key = a[amCurrentDimension.value] || '未知';
        if (!map[key]) {
          map[key] = {
            alert_id: key + '-' + a.level,
            level: a.level,
            entity_name: key,
            total_employees: 0,
            completed_count: 0,
            risk_rate: 0,
            count: 0,
          };
        }
        map[key].total_employees += a.total_employees || 0;
        map[key].completed_count += a.completed_count || 0;
        map[key].risk_rate += a.risk_rate || 0;
        map[key].count += 1;
      });
      results = Object.values(map).map((g) => {
        g.risk_rate = g.count > 0 ? g.risk_rate / g.count : 0;
        return g;
      });
    }
    if (amSearchQuery.value.trim()) {
      const q = amSearchQuery.value.trim().toLowerCase();
      results = results.filter((r) => (r.entity_name || '').toLowerCase().includes(q));
    }
    return results.sort((a, b) => {
      const valA = a[amSortKey.value] || 0;
      const valB = b[amSortKey.value] || 0;
      if (valA < valB) return amSortOrder.value === 'asc' ? -1 : 1;
      if (valA > valB) return amSortOrder.value === 'asc' ? 1 : -1;
      return 0;
    });
  });
  const amDisplayedAlerts = computed(() =>
    amShowMore.value ? amGroupedAlerts.value : amGroupedAlerts.value.slice(0, 10)
  );

  const amLevelColors = computed(() => {
    switch (alertFilter.value) {
      case 'P0':
        return { bg: '#FFEAEA', text: '#FF3B30' };
      case 'P1':
        return { bg: '#FFF2D9', text: '#FF9500' };
      case 'P2':
        return { bg: '#FFF9CC', text: '#FFCC00' };
      case 'Unfinished':
        return { bg: '#F5F5F7', text: '#86868B' };
      default:
        return { bg: '#EBF5FF', text: '#0071E3' };
    }
  });

  onMounted(() => {
    loadTasks();
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    window.addEventListener('resize', () => {
      if (chartInstance) chartInstance.resize();
    });
  });
  onUnmounted(() => {
    document.removeEventListener('fullscreenchange', handleFullscreenChange);
    if (chartInstance) chartInstance.dispose();
  });
</script>

<template>
  <div id="app" class="h-screen flex flex-col bg-[#F9FAFB] overflow-hidden new-board-app">
    <!-- Header -->
    <div class="flex-shrink-0 w-full mx-auto px-6 sm:px-10 lg:px-12 xl:px-16 pt-8 pb-6">
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 class="text-[28px] leading-[1.15] font-semibold text-[#111827] font-outfit">
          实时任务看板
        </h1>
        <div class="flex items-center gap-4">
          <!-- 更新状态区合并 (无边框) -->
          <div class="flex items-center gap-2">
            <div class="text-[13px] text-[#86868B] font-medium"
              >最后更新：{{ formatTime(lastUpdated) }}</div
            >
            <button
              @click="handleRefresh"
              class="text-[#86868B] hover:text-[#0071E3] transition-colors duration-200 flex items-center justify-center p-1 rounded-md hover:bg-gray-100/50"
              title="手动刷新"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            </button>
          </div>

          <button
            @click="isAiOpen = true"
            class="p-2.5 rounded-full hover:bg-[#F5F5F7] transition-colors duration-200 relative group"
            title="AI 数据助手"
          >
            <div
              class="absolute inset-0 bg-blue-500/10 rounded-full scale-0 group-hover:scale-100 transition-transform duration-300"
            ></div>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="text-[#0071E3] relative z-10"
            >
              <path d="M12 8V4H8" />
              <rect width="16" height="12" x="4" y="8" rx="2" />
              <path d="M2 14h2" />
              <path d="M20 14h2" />
              <path d="M15 13v2" />
              <path d="M9 13v2" />
            </svg>
            <div
              class="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full border-2 border-[#F9FAFB]"
            ></div>
          </button>
          <button
            @click="toggleFullscreen"
            class="p-2.5 rounded-full hover:bg-[#F5F5F7] transition-colors duration-200"
            :title="isFullscreen ? '退出全屏' : '全屏显示'"
          >
            <svg
              v-if="isFullscreen"
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#0071E3"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M8 3v3a2 2 0 0 1-2 2H3" />
              <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
              <path d="M3 16h3a2 2 0 0 1 2 2v3" />
              <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
            </svg>
            <svg
              v-else
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#0071E3"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M8 3H5a2 2 0 0 0-2 2v3" />
              <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
              <path d="M3 16v3a2 2 0 0 0 2 2h3" />
              <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Toast Prompt -->
    <div
      :class="[
        'fixed top-6 left-1/2 -translate-x-1/2 z-[200] px-6 py-2.5 bg-gray-800/90 backdrop-blur-md text-white text-[14px] font-medium rounded-full shadow-2xl transition-all duration-500 pointer-events-none',
        showFullscreenPrompt ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-8',
      ]"
    >
      按 ESC 键退出全屏
    </div>

    <!-- Diagnosis Flow Section -->
    <div class="flex-shrink-0">
      <div
        class="sticky top-0 z-[100] bg-white border-b border-[#E5E5E7] transition-all duration-300"
      >
        <div class="w-full mx-auto px-6 sm:px-10 lg:px-12 xl:px-16">
          <div
            @click="isDiagnosisCollapsed = !isDiagnosisCollapsed"
            class="w-full flex items-center justify-between py-3 cursor-pointer group"
          >
            <div class="flex items-center gap-4">
              <div
                class="text-[14px] font-semibold text-[#1D1D1F] transition-colors group-hover:text-[#0071E3] flex items-center gap-1.5"
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="text-[#0071E3]"
                  style="animation: spin 8s linear infinite"
                >
                  <path
                    d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3Z"
                  />
                  <path d="M19 3v4" />
                  <path d="M21 5h-4" />
                </svg>
                Agent 诊断流
              </div>
              <div class="flex items-center gap-2">
                <div
                  v-if="redCount > 0"
                  class="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border border-[#FFEAEA] bg-[#FFF5F5]"
                >
                  <div
                    class="w-1.5 h-1.5 rounded-full bg-[#FF3B30] shadow-[0_0_4px_rgba(255,59,48,0.4)]"
                  ></div>
                  <span class="text-[11px] text-[#FF3B30] font-semibold leading-none"
                    >急需处理: {{ redCount }}</span
                  >
                </div>
                <div
                  v-if="yellowCount > 0"
                  class="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border border-[#FFF2D9] bg-[#FFF9F0]"
                >
                  <div
                    class="w-1.5 h-1.5 rounded-full bg-[#FF9500] shadow-[0_0_4px_rgba(255,149,0,0.4)]"
                  ></div>
                  <span class="text-[11px] text-[#FF9500] font-semibold leading-none"
                    >重点关注: {{ yellowCount }}</span
                  >
                </div>
                <div
                  v-if="greenCount > 0"
                  class="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border border-[#E1F7E9] bg-[#F0FFF4]"
                >
                  <div
                    class="w-1.5 h-1.5 rounded-full bg-[#34C759] shadow-[0_0_4px_rgba(52,199,89,0.4)]"
                  ></div>
                  <span class="text-[11px] text-[#34C759] font-semibold leading-none"
                    >暂无问题: {{ greenCount }}</span
                  >
                </div>
              </div>
              <div
                v-if="currentTaskTitle"
                class="flex items-center gap-2 ml-2 pl-4 border-l border-[#E5E5E7] transition-all duration-300"
              >
                <span class="text-[13px] text-[#6E6E73]">当前看板:</span>
                <span class="text-[13px] font-medium text-[#1D1D1F]">{{ currentTaskTitle }}</span>
              </div>
            </div>
            <div
              class="w-7 h-7 flex items-center justify-center rounded-full bg-transparent group-hover:bg-[#F5F5F7] transition-colors duration-200"
            >
              <svg
                v-if="isDiagnosisCollapsed"
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="text-[#86868B]"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
              <svg
                v-else
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="text-[#86868B]"
              >
                <path d="m18 15-6-6-6 6" />
              </svg>
            </div>
          </div>
        </div>

        <div
          v-show="!isDiagnosisCollapsed"
          class="w-full mx-auto px-6 sm:px-10 lg:px-12 xl:px-16 pb-6 pt-1 animate-in"
        >
          <div class="space-y-3">
            <div
              v-for="diagnosis in diagnosisData"
              :key="diagnosis.diagnosis_id"
              v-show="
                !isAutoCollapsed ||
                (diagnosis.related_task_id === currentTaskId && diagnosis.action_type !== 'none')
              "
              @click="handleDiagnosisClick(diagnosis)"
              :class="[
                'group flex items-center gap-4 p-4 pr-6 rounded-xl transition-all duration-300 cursor-pointer border-none outline-none select-none -webkit-tap-highlight-color-transparent',
                diagnosis.related_task_id !== currentTaskId
                  ? 'hover:shadow-md hover:bg-gray-50/50 hover:-translate-y-px active:shadow-sm active:translate-y-0'
                  : '',
                diagnosis.related_task_id === currentTaskId
                  ? 'bg-blue-50/30 shadow-md ring-1 ring-blue-500/10 relative after:absolute after:top-1/2 after:-translate-y-1/2 after:left-0 after:w-1 after:h-8 after:bg-[#0071E3] after:rounded-r-full'
                  : 'bg-white shadow-sm ring-1 ring-black/5',
              ]"
            >
              <div
                v-if="diagnosis.severity !== 'green'"
                class="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full ml-1 transition-colors duration-300"
                :class="
                  diagnosis.severity === 'red'
                    ? 'bg-red-50'
                    : diagnosis.severity === 'yellow'
                    ? 'bg-orange-50'
                    : 'bg-green-50'
                "
              >
                <div
                  class="w-2.5 h-2.5 rounded-full"
                  :class="
                    diagnosis.severity === 'red'
                      ? 'animate-alert-pulse-red'
                      : diagnosis.severity === 'yellow'
                      ? 'animate-alert-pulse-yellow'
                      : ''
                  "
                  :style="{ backgroundColor: severityColors[diagnosis.severity] }"
                ></div>
              </div>
              <div
                v-else
                class="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full ml-1 bg-green-50"
              >
                <div
                  class="w-2.5 h-2.5 rounded-full bg-[#34C759] shadow-[0_0_8px_rgba(52,199,89,0.4)]"
                ></div>
              </div>

              <div class="flex-1 ml-1">
                <div class="text-[15px] leading-[1.5] font-semibold font-outfit text-[#111827]">
                  <span v-if="diagnosis.severity === 'green'"
                    >其余 {{ greenCount }} 个任务按计划推进中，无严重异常</span
                  >
                  <span v-else>{{ diagnosis.summary_text }}</span>
                </div>
                <div
                  v-if="diagnosis.suggested_action"
                  class="text-[13px] leading-[1.5] mt-1 text-[#6B7280]"
                  >{{ diagnosis.suggested_action }}</div
                >
              </div>

              <div
                v-if="diagnosis.task_title && diagnosis.severity !== 'green'"
                class="px-3 py-1.5 rounded-full bg-[#F5F5F7] text-[12px] font-medium text-[#6E6E73] whitespace-nowrap"
              >
                {{ diagnosis.task_title }}
              </div>

              <div
                v-if="diagnosis.action_type === 'none'"
                class="text-[#86868B] text-[13px] font-medium flex items-center gap-1"
              >
                点击展开其他任务
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  :class="['transition-transform duration-200', expandedTasks ? 'rotate-180' : '']"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </div>
            </div>
          </div>

          <div v-if="isAutoCollapsed" class="mt-3 flex justify-center">
            <button
              @click="isAutoCollapsed = false"
              class="text-[13px] text-[#86868B] hover:text-[#1D1D1F] flex items-center gap-1 transition-colors duration-200"
            >
              展开其他诊断
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
          </div>

          <div
            v-if="expandedTasks"
            class="mt-4 glass-card overflow-hidden border-none shadow-lg ring-1 ring-black/5"
          >
            <div class="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
              <div class="text-[14px] font-bold font-outfit text-[#111827]"
                >全部任务（{{ allTasks.length }}）</div
              >
            </div>
            <div class="max-h-[360px] overflow-y-auto">
              <div
                v-for="task in allTasks"
                :key="task.task_id"
                @click="handleTaskSelect(task.task_id)"
                class="px-6 py-4 hover:bg-gray-50 cursor-pointer transition-colors duration-200 flex items-center gap-4 border-b border-gray-100 last:border-b-0"
              >
                <div
                  class="w-2 h-2 rounded-full flex-shrink-0 shadow-sm"
                  :style="{ backgroundColor: severityColors[task.severity] }"
                ></div>
                <div class="flex-1 text-[14px] text-[#111827] font-medium">{{
                  task.task_title
                }}</div>
                <div class="text-[12px] text-[#6B7280] whitespace-nowrap"
                  >截止 {{ task.deadline.slice(5) }}</div
                >
                <div class="flex items-center gap-2">
                  <div class="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      class="h-full rounded-full transition-all duration-300"
                      :style="{
                        width: task.completion_rate * 100 + '%',
                        backgroundColor: severityColors[task.severity],
                      }"
                    ></div>
                  </div>
                  <div class="text-[12px] text-[#6B7280] font-medium w-10 text-right"
                    >{{ Math.round(task.completion_rate * 100) }}%</div
                  >
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Dashboard Content -->
    <div class="flex-1 overflow-y-auto">
      <div
        :class="['transition-opacity duration-250', isContentLoading ? 'opacity-0' : 'opacity-100']"
      >
        <div class="w-full mx-auto px-6 sm:px-10 lg:px-12 xl:px-16">
          <!-- Layer 2: Core Metrics + Funnel -->
          <div class="mt-8 flex flex-col lg:flex-row gap-5 items-stretch">
            <div class="lg:w-[320px] flex-shrink-0 flex flex-col z-10">
              <!-- Metric Cards Component Inlined -->
              <div class="glass-card flex flex-col h-full w-full border-none flex-1">
                <div class="flex-1 p-5 flex flex-col items-center justify-center text-center">
                  <div
                    class="text-[12px] font-medium text-[#6B7280] mb-2 flex items-center gap-1.5 uppercase tracking-wide group relative cursor-help z-10"
                  >
                    按时完成率
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      class="text-[#9CA3AF] group-hover:text-[#6B7280] transition-colors"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                      <path d="M12 17h.01" />
                    </svg>
                    <div
                      class="absolute left-full ml-2 top-1/2 -translate-y-1/2 w-48 bg-gray-900 text-white text-[11px] font-normal leading-relaxed rounded-lg py-2 px-3 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-200 text-left shadow-lg z-[999]"
                    >
                      在截止时间前完成任务的员工比例。用于衡量大盘整体的推进效率。
                    </div>
                  </div>
                  <div
                    class="text-[36px] leading-none font-bold text-[#111827] font-outfit tracking-tight mb-3"
                    >{{ (metricCompletionRate * 100).toFixed(2) }}%</div
                  >
                  <div class="flex items-center gap-3">
                    <div
                      class="text-[12px] font-semibold flex items-center gap-0.5"
                      :style="{ color: getTrendColor(metricCompletionRateDelta) }"
                    >
                      <span>较昨天</span>
                      <span
                        >{{ metricCompletionRateDelta > 0 ? '+' : ''
                        }}{{ (metricCompletionRateDelta * 100).toFixed(1) }}pp</span
                      >
                      <svg
                        v-if="metricCompletionRateDelta > 0"
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
                        <polyline points="16 7 22 7 22 13" />
                      </svg>
                      <svg
                        v-else-if="metricCompletionRateDelta < 0"
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <polyline points="22 17 13.5 8.5 8.5 13.5 2 7" />
                        <polyline points="16 17 22 17 22 11" />
                      </svg>
                      <svg
                        v-else
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                    </div>
                    <div class="w-px h-3 bg-gray-200"></div>
                    <div class="text-[12px] text-[#6B7280]">剩 {{ metricHoursRemaining }}h</div>
                  </div>
                </div>
                <div class="h-px bg-gray-100 mx-6"></div>
                <div class="flex-1 p-5 flex flex-col items-center justify-center text-center">
                  <div
                    class="text-[12px] font-medium text-[#6B7280] mb-2 flex items-center gap-1.5 uppercase tracking-wide group relative cursor-help z-10"
                  >
                    触达确认率
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      class="text-[#9CA3AF] group-hover:text-[#6B7280] transition-colors"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                      <path d="M12 17h.01" />
                    </svg>
                    <div
                      class="absolute left-full ml-2 top-1/2 -translate-y-1/2 w-56 bg-gray-900 text-white text-[11px] font-normal leading-relaxed rounded-lg py-2 px-3 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-200 text-left shadow-lg z-[999]"
                    >
                      已阅读/确认任务的人数占成功送达总人数的比例，体现任务下发的触达质量。
                    </div>
                  </div>
                  <div
                    class="text-[36px] leading-none font-bold text-[#111827] font-outfit tracking-tight mb-3"
                    >{{ (metricConfirmationRate * 100).toFixed(1) }}%</div
                  >
                  <div class="flex items-center gap-3 text-[12px]">
                    <div class="text-[#111827] font-semibold"
                      >{{ metricReadCount.toLocaleString() }} 已确认</div
                    >
                    <div class="w-px h-3 bg-gray-200"></div>
                    <div class="text-[#6B7280]"
                      >{{ metricDeliveredCount.toLocaleString() }} 已送达</div
                    >
                  </div>
                </div>
                <div class="h-px bg-gray-100 mx-6"></div>
                <div class="flex-1 p-5 flex flex-col items-center justify-center text-center">
                  <div
                    class="text-[12px] font-medium text-[#6B7280] mb-2 flex items-center gap-1.5 uppercase tracking-wide group relative cursor-help z-10"
                  >
                    预警条数
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      class="text-[#9CA3AF] group-hover:text-[#6B7280] transition-colors"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                      <path d="M12 17h.01" />
                    </svg>
                    <div
                      class="absolute left-full ml-2 top-1/2 -translate-y-1/2 w-48 bg-gray-900 text-white text-[11px] font-normal leading-relaxed rounded-lg py-2 px-3 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-200 text-left shadow-lg z-[999]"
                    >
                      系统诊断出的异常状态总数。P0表示距ddl不足24h，P1表示距ddl不足48h，P2表示起步异常。
                    </div>
                  </div>
                  <div
                    class="text-[36px] leading-none font-bold font-outfit tracking-tight mb-3"
                    :style="{ color: metricTotalAlerts === 0 ? '#10B981' : '#EF4444' }"
                    >{{ metricTotalAlerts }}</div
                  >
                  <div
                    v-if="metricTotalAlerts === 0"
                    class="text-[12px] text-[#10B981] font-semibold"
                    >当前无风险</div
                  >
                  <div v-else class="flex items-center gap-2 text-[11px] font-bold">
                    <span
                      v-if="metricP0Count > 0"
                      class="px-2 py-0.5 rounded-full bg-red-50 text-red-500 ring-1 ring-inset ring-red-100"
                      >P0: {{ metricP0Count }}</span
                    >
                    <span
                      v-if="metricP1Count > 0"
                      class="px-2 py-0.5 rounded-full bg-orange-50 text-orange-500 ring-1 ring-inset ring-orange-100"
                      >P1: {{ metricP1Count }}</span
                    >
                    <span
                      v-if="metricP2Count > 0"
                      class="px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 ring-1 ring-inset ring-amber-100"
                      >P2: {{ metricP2Count }}</span
                    >
                  </div>
                </div>
              </div>
            </div>
            <div class="flex-1 glass-card p-5 md:p-6 flex flex-col min-w-0">
              <div class="flex items-center gap-1.5 mb-4 group relative w-fit cursor-help">
                <h3 class="text-[18px] leading-[1.3] font-semibold text-[#111827] font-outfit"
                  >转化漏斗</h3
                >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="text-[#9CA3AF] group-hover:text-[#6B7280] transition-colors"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                  <path d="M12 17h.01" />
                </svg>
                <div
                  class="absolute left-full ml-3 top-1/2 -translate-y-1/2 w-64 bg-gray-900 text-white text-[12px] font-normal leading-relaxed rounded-lg py-2.5 px-3.5 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-200 z-[999] text-left shadow-lg"
                >
                  展示任务生命周期各阶段的转化和流失情况。流失率达到 20% 时会触发系统自动标红预警。
                </div>
              </div>
              <div class="flex-1 flex flex-col justify-center">
                <div v-if="funnelData && funnelData.funnel" class="space-y-4 w-full">
                  <div v-for="(stage, index) in funnelData.funnel" :key="stage.stage">
                    <div
                      v-if="index > 0 && getFunnelDropRate(index) > 0"
                      class="flex justify-end items-center gap-2 py-1 pr-4"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        :style="{
                          color: getFunnelDropRate(index) >= 20 ? '#FF3B30' : '#86868B',
                          fontWeight: getFunnelDropRate(index) >= 20 ? 600 : 400,
                        }"
                      >
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                      <span
                        class="text-[12px]"
                        :style="{
                          color: getFunnelDropRate(index) >= 20 ? '#FF3B30' : '#86868B',
                          fontWeight: getFunnelDropRate(index) >= 20 ? 600 : 400,
                        }"
                      >
                        流失 {{ getFunnelDropRate(index).toFixed(0) }}%
                      </span>
                    </div>
                    <div
                      class="flex items-center gap-4 cursor-pointer hover:bg-gray-50 p-2 -mx-2 rounded-lg transition-colors group"
                      @click="handleFunnelDrillDown(stage)"
                    >
                      <div
                        class="w-[90px] text-right text-[14px] text-[#6E6E73] group-hover:text-[#0071E3] transition-colors font-medium flex items-center justify-end gap-1"
                      >
                        {{ stage.label }}
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          class="opacity-0 group-hover:opacity-100 transition-opacity text-[#0071E3]"
                        >
                          <path d="m9 18 6-6-6-6" />
                        </svg>
                      </div>
                      <div class="flex-1 relative">
                        <div
                          class="h-7 rounded-md transition-all duration-500 ease-out"
                          :style="{
                            width: funnelAnimated ? getFunnelWidth(stage) + '%' : '0%',
                            backgroundColor: stageColors[stage.stage],
                            transitionDelay: index * 80 + 'ms',
                          }"
                        ></div>
                        <div
                          v-if="getFunnelDropRate(index) >= 20"
                          class="absolute top-0 h-7 rounded-md pointer-events-none"
                          :style="{
                            left: getFunnelWidth(stage) + '%',
                            width: getFunnelDropWidth(index) + '%',
                            backgroundColor: 'rgba(255, 59, 48, 0.14)',
                            border: '1px solid rgba(255, 59, 48, 0.3)',
                          }"
                        ></div>
                      </div>
                      <div class="w-[120px] flex flex-col items-end">
                        <div class="text-[14px] font-semibold text-[#1D1D1F]">{{
                          stage.count.toLocaleString()
                        }}</div>
                        <div class="text-[13px] text-[#86868B]"
                          >{{ getFunnelRate(stage).toFixed(0) }}%</div
                        >
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Layer 3: Unified Alert Block -->
          <div class="mt-16">
            <div class="flex items-center gap-1.5 mb-6 group relative w-fit cursor-help">
              <h3 class="text-[18px] leading-[1.3] font-semibold text-[#111827] font-outfit"
                >预警中心</h3
              >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="text-[#9CA3AF] group-hover:text-[#6B7280] transition-colors"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <path d="M12 17h.01" />
              </svg>
              <div
                class="absolute left-full ml-3 top-1/2 -translate-y-1/2 w-56 bg-gray-900 text-white text-[12px] font-normal leading-relaxed rounded-lg py-2.5 px-3.5 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-200 z-[999] text-left shadow-lg"
              >
                实时展示诊断出的各层级业务风险项，漏斗图展示了高危风险逐步缩口的转化情况。
              </div>
            </div>
            <div class="flex flex-col lg:flex-row gap-5 items-stretch">
              <div class="lg:w-[320px] flex-shrink-0 flex flex-col z-10">
                <!-- Alert Summary Component Inlined -->
                <div
                  v-if="alertSummary"
                  class="glass-card flex flex-col h-full w-full border-none overflow-hidden flex-1"
                >
                  <!-- P2 Card -->
                  <div
                    @click="handleSelectAlertFilter('P2')"
                    class="flex-1 p-5 relative cursor-pointer hover:bg-gray-50/50 transition-colors duration-200 flex flex-col justify-center"
                    :style="{
                      backgroundColor: alertFilter === 'P2' ? '#FFFFF0' : '',
                      boxShadow: alertFilter === 'P2' ? 'inset 3px 0 0 0 #FFCC00' : '',
                    }"
                  >
                    <div class="flex items-start justify-between">
                      <div class="mb-2">
                        <div class="flex items-baseline gap-2">
                          <div
                            class="text-[32px] leading-[1] font-bold font-outfit"
                            :style="{ color: getAlertStageCount('P2') > 0 ? '#FFCC00' : '#D1D1D6' }"
                            >{{ getAlertPercentage('P2') }}</div
                          >
                        </div>
                        <div
                          class="text-[12px] text-[#6B7280] mt-1.5 font-semibold uppercase tracking-wide"
                          >P2 预警占比</div
                        >
                      </div>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        :class="[
                          'transition-colors mt-1',
                          alertFilter === 'P2' ? 'text-[#FFCC00]' : 'text-[#D1D1D6]',
                        ]"
                      >
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                    </div>
                    <div
                      v-if="alertSummary.p2_breakdown && alertSummary.p2_breakdown.length > 0"
                      class="space-y-1 mt-2"
                    >
                      <div
                        v-for="(item, idx) in alertSummary.p2_breakdown"
                        :key="idx"
                        class="text-[12px] text-[#111827] flex items-start gap-1"
                      >
                        <span class="text-[#9CA3AF] mt-0.5">•</span
                        ><span class="leading-relaxed"
                          >{{ item.category }}：<span class="font-bold">{{
                            getAlertStageCount('P2')
                          }}</span>
                          人</span
                        >
                      </div>
                    </div>
                    <div v-else class="text-[12px] text-[#9CA3AF] mt-2 font-medium"
                      >暂无 P2 风险</div
                    >
                  </div>

                  <div class="h-px bg-gray-100 mx-5"></div>

                  <!-- P1 Card -->
                  <div
                    @click="handleSelectAlertFilter('P1')"
                    class="flex-1 p-5 relative cursor-pointer hover:bg-gray-50/50 transition-colors duration-200 flex flex-col justify-center"
                    :style="{
                      backgroundColor: alertFilter === 'P1' ? '#FFF9F0' : '',
                      boxShadow: alertFilter === 'P1' ? 'inset 3px 0 0 0 #FF9500' : '',
                    }"
                  >
                    <div class="flex items-start justify-between">
                      <div class="mb-2">
                        <div class="flex items-baseline gap-2">
                          <div
                            class="text-[32px] leading-[1] font-bold font-outfit"
                            :style="{ color: getAlertStageCount('P1') > 0 ? '#FF9500' : '#D1D1D6' }"
                            >{{ getAlertPercentage('P1') }}</div
                          >
                        </div>
                        <div
                          class="text-[12px] text-[#6B7280] mt-1.5 font-semibold uppercase tracking-wide"
                          >P1 预警占比</div
                        >
                      </div>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        :class="[
                          'transition-colors mt-1',
                          alertFilter === 'P1' ? 'text-[#FF9500]' : 'text-[#D1D1D6]',
                        ]"
                      >
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                    </div>
                    <div
                      v-if="alertSummary.p1_breakdown && alertSummary.p1_breakdown.length > 0"
                      class="space-y-1 mt-2"
                    >
                      <div
                        v-for="(item, idx) in alertSummary.p1_breakdown"
                        :key="idx"
                        class="text-[12px] text-[#111827] flex items-start gap-1"
                      >
                        <span class="text-[#9CA3AF] mt-0.5">•</span
                        ><span class="leading-relaxed"
                          >{{ item.category }}：<span class="font-bold">{{
                            getAlertStageCount('P1')
                          }}</span>
                          人</span
                        >
                      </div>
                    </div>
                    <div v-else class="text-[12px] text-[#9CA3AF] mt-2 font-medium"
                      >暂无 P1 风险</div
                    >
                  </div>

                  <div class="h-px bg-gray-100 mx-5"></div>

                  <!-- P0 Card -->
                  <div
                    @click="handleSelectAlertFilter('P0')"
                    class="flex-1 p-5 relative cursor-pointer hover:bg-gray-50/50 transition-colors duration-200 flex flex-col justify-center"
                    :style="{
                      backgroundColor: alertFilter === 'P0' ? '#FFF5F5' : '',
                      boxShadow: alertFilter === 'P0' ? 'inset 3px 0 0 0 #FF3B30' : '',
                    }"
                  >
                    <div class="flex items-start justify-between">
                      <div class="mb-2">
                        <div class="flex items-baseline gap-2">
                          <div
                            class="text-[32px] leading-[1] font-bold font-outfit"
                            :style="{ color: getAlertStageCount('P0') > 0 ? '#FF3B30' : '#D1D1D6' }"
                            >{{ getAlertPercentage('P0') }}</div
                          >
                        </div>
                        <div
                          class="text-[12px] text-[#6B7280] mt-1.5 font-semibold uppercase tracking-wide"
                          >P0 预警占比</div
                        >
                      </div>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        :class="[
                          'transition-colors mt-1',
                          alertFilter === 'P0' ? 'text-[#FF3B30]' : 'text-[#D1D1D6]',
                        ]"
                      >
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                    </div>
                    <div
                      v-if="alertSummary.p0_breakdown && alertSummary.p0_breakdown.length > 0"
                      class="space-y-1 mt-2"
                    >
                      <div
                        v-for="(item, idx) in alertSummary.p0_breakdown"
                        :key="idx"
                        class="text-[12px] text-[#111827] flex items-start gap-1"
                      >
                        <span class="text-[#9CA3AF] mt-0.5">•</span
                        ><span class="leading-relaxed"
                          >{{ item.category }}：<span class="font-bold">{{
                            getAlertStageCount('P0')
                          }}</span>
                          人</span
                        >
                      </div>
                    </div>
                    <div v-else class="text-[12px] text-[#9CA3AF] mt-2 font-medium"
                      >暂无 P0 风险</div
                    >
                  </div>
                </div>
              </div>
              <div class="flex-1 glass-card p-5 md:p-6 flex flex-col min-w-0">
                <div class="flex items-center gap-1.5 mb-4 group relative w-fit cursor-help">
                  <h3 class="text-[18px] leading-[1.3] font-semibold text-[#111827] font-outfit"
                    >预警风险漏斗</h3
                  >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="text-[#9CA3AF] group-hover:text-[#6B7280] transition-colors"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                    <path d="M12 17h.01" />
                  </svg>
                  <div
                    class="absolute left-full ml-3 top-1/2 -translate-y-1/2 w-64 bg-gray-900 text-white text-[12px] font-normal leading-relaxed rounded-lg py-2.5 px-3.5 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-200 z-[999] text-left shadow-lg"
                  >
                    漏斗图展示了各阶段异常向更严重状态发展的转化情况。点击可下钻明细表。
                  </div>
                </div>
                <div class="flex-1 flex flex-col justify-center">
                  <!-- Alert Funnel Component Inlined -->
                  <div
                    v-if="alertFunnelData"
                    class="w-full flex flex-col justify-center h-full space-y-1.5 pt-2"
                  >
                    <div v-for="(stage, index) in alertFunnelData" :key="stage.stage">
                      <div
                        v-if="index > 0"
                        class="flex justify-end items-center gap-1.5 py-0.5 pr-[52px]"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="#FF9500"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                        <span class="text-[11px] font-medium text-[#FF9500]">
                          转化率 {{ getAlertConversionRate(index).toFixed(1) }}%
                        </span>
                      </div>
                      <div
                        :class="[
                          'flex items-center gap-3 cursor-pointer p-2 -mx-2 rounded-xl transition-all duration-200 group',
                          alertFilter === stage.stage
                            ? 'bg-blue-50 ring-1 ring-blue-200'
                            : 'hover:bg-gray-50',
                        ]"
                        @click="handleDrillDownAlerts(stage.stage)"
                      >
                        <div
                          :class="[
                            'w-[40px] text-right text-[13px] font-medium flex items-center justify-end gap-1 transition-colors',
                            alertFilter === stage.stage
                              ? 'text-[#0071E3]'
                              : 'text-[#6E6E73] group-hover:text-[#0071E3]',
                          ]"
                        >
                          {{ stage.label }}
                        </div>
                        <div class="flex-1 relative flex items-center">
                          <div
                            class="h-6 rounded-md transition-all duration-500 ease-out shadow-sm"
                            :style="{
                              width: alertFunnelAnimated ? getAlertFunnelWidth(stage) + '%' : '0%',
                              backgroundColor: getAlertBarColor(stage.stage),
                              transitionDelay: index * 80 + 'ms',
                            }"
                          ></div>
                        </div>
                        <div class="w-[45px] text-right flex items-center justify-end gap-1">
                          <div
                            :class="[
                              'text-[14px] font-bold font-outfit',
                              alertFilter === stage.stage ? 'text-[#0071E3]' : 'text-[#1D1D1F]',
                            ]"
                            >{{ stage.count.toLocaleString() }}</div
                          >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            :class="[
                              'transition-opacity flex-shrink-0',
                              alertFilter === stage.stage
                                ? 'text-[#0071E3] opacity-100'
                                : 'text-[#9CA3AF] opacity-0 group-hover:opacity-100',
                            ]"
                          >
                            <path d="m9 18 6-6-6-6" />
                          </svg>
                        </div>
                      </div>
                    </div>
                    <!-- Overall Conversion Summary -->
                    <div
                      class="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between"
                    >
                      <div class="flex items-center gap-2 group relative cursor-help">
                        <div
                          class="w-6 h-6 rounded-full bg-[#EBF5FF] flex items-center justify-center"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="#0071E3"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          >
                            <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
                            <polyline points="16 7 22 7 22 13" />
                          </svg>
                        </div>
                        <span class="text-[13px] font-semibold text-[#111827]">总催办转化率</span>
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          class="text-[#9CA3AF] group-hover:text-[#6B7280] transition-colors"
                        >
                          <circle cx="12" cy="12" r="10" />
                          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                          <path d="M12 17h.01" />
                        </svg>
                        <div
                          class="absolute bottom-full mb-2 left-0 w-56 bg-gray-900 text-white text-[11px] font-normal leading-relaxed rounded-lg py-2 px-3 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-200 text-left shadow-lg z-[999]"
                        >
                          预警转化率 = (最初进入P2风险人数 - 最终未完成人数) /
                          最初进入P2风险人数。衡量对风险人员的挽回效率。
                        </div>
                      </div>
                      <div class="flex items-baseline gap-1">
                        <span class="text-[20px] font-bold font-outfit text-[#0071E3]"
                          >{{ getOverallConversionRate().toFixed(1) }}%</span
                        >
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Layer 4: Trend Chart + Region Ranking -->
          <div class="mt-16 mb-16 flex flex-col lg:flex-row gap-6 items-stretch">
            <div class="lg:w-1/2 flex-shrink-0 min-w-0 flex flex-col glass-card p-6 md:p-8 z-10">
              <!-- Trend Chart Container -->
              <div class="w-full flex flex-col h-full">
                <div
                  class="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4 flex-shrink-0"
                >
                  <div class="flex items-center gap-1.5 group relative w-fit cursor-help">
                    <h3 class="text-[18px] leading-[1.3] font-semibold text-[#111827] font-outfit"
                      >完成趋势</h3
                    >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      class="text-[#9CA3AF] group-hover:text-[#6B7280] transition-colors"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                      <path d="M12 17h.01" />
                    </svg>
                    <div
                      class="absolute left-full ml-3 top-1/2 -translate-y-1/2 w-64 bg-gray-900 text-white text-[12px] font-normal leading-relaxed rounded-lg py-2.5 px-3.5 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-200 z-[999] text-left shadow-lg"
                    >
                      显示大盘在所选时间段内的推进情况。折线代表历史累计完成人数，柱状图代表各个节点的单日/单时新增完成人数。
                    </div>
                  </div>
                  <div class="flex items-center gap-3">
                    <!-- Select Week/Date -->
                    <select
                      v-model="currentSubPeriod"
                      class="h-8 pl-3 pr-8 py-0 text-[12px] text-[#111827] bg-[#F5F5F7] border border-transparent focus:border-[#0071E3] focus:bg-white rounded-md outline-none cursor-pointer transition-all duration-200 appearance-none"
                      style="
                        background-image: url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2214%22%20height%3D%2214%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2386868B%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E');
                        background-repeat: no-repeat;
                        background-position: right 8px center;
                      "
                    >
                      <option v-for="opt in subPeriodOptions" :key="opt" :value="opt">{{
                        opt
                      }}</option>
                    </select>

                    <!-- Toggle Dimension -->
                    <div class="flex items-center bg-[#F5F5F7] p-1 rounded-lg">
                      <button
                        @click="currentDim = 'daily'"
                        :class="[
                          'px-3 py-1 text-[12px] font-medium rounded-md transition-all duration-200',
                          currentDim === 'daily'
                            ? 'bg-white text-[#111827] shadow-sm'
                            : 'text-[#6B7280] hover:text-[#111827]',
                        ]"
                        >日</button
                      >
                      <button
                        @click="currentDim = 'hourly'"
                        :class="[
                          'px-3 py-1 text-[12px] font-medium rounded-md transition-all duration-200',
                          currentDim === 'hourly'
                            ? 'bg-white text-[#111827] shadow-sm'
                            : 'text-[#6B7280] hover:text-[#111827]',
                        ]"
                        >时</button
                      >
                    </div>
                  </div>
                </div>
                <div style="flex: 1; width: 100%; min-height: 280px; position: relative">
                  <div
                    ref="chartRef"
                    style="position: absolute; top: 0; left: 0; right: 0; bottom: 0"
                  ></div>
                </div>
              </div>
            </div>
            <div class="lg:w-1/2 flex-shrink-0 min-w-0 flex flex-col glass-card p-6 md:p-8">
              <!-- Region Ranking Component Inlined -->
              <div
                v-if="regionData && regionData.regions"
                class="w-full flex flex-col h-full min-h-[380px] flex-1"
              >
                <div class="mb-5 space-y-4 flex-shrink-0">
                  <div>
                    <h3
                      class="text-[18px] leading-[1.3] font-semibold text-[#1D1D1F] flex items-center gap-2 flex-wrap"
                    >
                      <div class="flex items-center gap-1.5 group relative w-fit cursor-help">
                        <span
                          @click="rrGoToBreadcrumb('root')"
                          :class="[
                            'cursor-pointer transition-colors duration-200',
                            rrSelectedRTM3
                              ? 'text-[#86868B] hover:text-[#0071E3]'
                              : 'text-[#1D1D1F]',
                          ]"
                          >RTM 进度排行</span
                        >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          class="text-[#9CA3AF] group-hover:text-[#6B7280] transition-colors"
                        >
                          <circle cx="12" cy="12" r="10" />
                          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                          <path d="M12 17h.01" />
                        </svg>
                        <div
                          class="absolute left-full ml-3 top-1/2 -translate-y-1/2 w-64 bg-gray-900 text-white text-[12px] font-normal leading-relaxed rounded-lg py-2.5 px-3.5 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-200 z-[999] text-left shadow-lg"
                        >
                          显示各级业务节点的任务完成进度排名。可切换查看 RTM / 经销商 /
                          门店层级，并支持下钻查看特定节点的详细分布。
                        </div>
                      </div>
                      <template v-if="rrSelectedRTM3">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          class="text-[#86868B] flex-shrink-0"
                        >
                          <path d="m9 18 6-6-6-6" />
                        </svg>
                        <span
                          @click="rrGoToBreadcrumb('rtm3')"
                          :class="[
                            'transition-colors duration-200',
                            rrSelectedRTM4
                              ? 'text-[#86868B] hover:text-[#0071E3] cursor-pointer'
                              : 'text-[#1D1D1F]',
                          ]"
                          >{{ rrSelectedRTM3.region_name || rrSelectedRTM3.entity_name }}</span
                        >
                      </template>
                      <template v-if="rrSelectedRTM4">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          class="text-[#86868B] flex-shrink-0"
                        >
                          <path d="m9 18 6-6-6-6" />
                        </svg>
                        <span
                          @click="rrGoToBreadcrumb('rtm4')"
                          :class="[
                            'transition-colors duration-200',
                            rrSelectedDealer
                              ? 'text-[#86868B] hover:text-[#0071E3] cursor-pointer'
                              : 'text-[#1D1D1F]',
                          ]"
                          >{{ rrSelectedRTM4.region_name || rrSelectedRTM4.entity_name }}</span
                        >
                      </template>
                      <template v-if="rrSelectedDealer">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          class="text-[#86868B] flex-shrink-0"
                        >
                          <path d="m9 18 6-6-6-6" />
                        </svg>
                        <span class="text-[#1D1D1F]">{{
                          rrSelectedDealer.region_name || rrSelectedDealer.entity_name
                        }}</span>
                      </template>
                    </h3>
                    <p class="text-[13px] text-[#86868B] mt-1.5">
                      {{
                        rrSelectedRTM3
                          ? '已下钻至: ' +
                            (rrSelectedDealer ? '经销商' : rrSelectedRTM4 ? 'RTM4' : 'RTM3')
                          : '全局大盘排行 · 点击行项可进行下钻'
                      }}
                    </p>
                  </div>
                  <div class="flex flex-row items-center justify-between gap-3 w-full">
                    <div
                      class="flex items-center bg-gray-100/80 p-1 rounded-lg flex-shrink-0 overflow-x-auto"
                    >
                      <button
                        v-for="dim in rrAvailableDimensions"
                        :key="dim.value"
                        @click="rrCurrentDimension = dim.value"
                        :class="[
                          'px-3 py-1.5 text-[12px] font-semibold rounded-md transition-all duration-200 whitespace-nowrap',
                          rrCurrentDimension === dim.value
                            ? 'bg-white text-[#111827] shadow-sm'
                            : 'text-[#6B7280] hover:text-[#111827]',
                        ]"
                      >
                        {{ dim.label }}
                      </button>
                    </div>
                    <div class="relative flex-1 min-w-[120px] max-w-[200px]">
                      <div
                        class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          color="#9CA3AF"
                        >
                          <circle cx="11" cy="11" r="8" />
                          <path d="m21 21-4.3-4.3" />
                        </svg>
                      </div>
                      <input
                        v-model="rrSearchQuery"
                        type="text"
                        placeholder="搜索名称..."
                        class="w-full h-8 pl-9 pr-3 text-[13px] text-[#111827] bg-gray-100/80 border border-transparent focus:border-[#0071E3] focus:bg-white rounded-md outline-none transition-all duration-200"
                      />
                    </div>
                  </div>
                </div>

                <div
                  class="flex items-center gap-3 px-4 pb-2 mb-2 text-[12px] font-medium text-[#86868B] border-b border-[#E5E5E7] flex-shrink-0"
                >
                  <div class="w-6 text-center flex-shrink-0">排名</div>
                  <div class="w-4 flex-shrink-0"></div>
                  <div class="w-20 flex-shrink-0 truncate">{{ rrDimensionLabel }}</div>
                  <div class="flex-1">完成进度</div>
                  <div
                    class="w-16 text-right flex-shrink-0 whitespace-nowrap cursor-pointer hover:text-[#111827] flex items-center justify-end select-none"
                    @click="rrHandleSort('completion_rate')"
                  >
                    比例
                    <div
                      class="inline-flex flex-col items-center justify-center w-3 h-3 ml-1 align-middle"
                    >
                      <svg
                        :class="[
                          'w-2.5 h-2.5 -mb-[4px] transition-colors',
                          rrSortKey === 'completion_rate' && rrSortOrder === 'asc'
                            ? 'text-[#0071E3]'
                            : 'text-[#9CA3AF]',
                        ]"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="3.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path d="m18 15-6-6-6 6" />
                      </svg>
                      <svg
                        :class="[
                          'w-2.5 h-2.5 transition-colors',
                          rrSortKey === 'completion_rate' && rrSortOrder === 'desc'
                            ? 'text-[#0071E3]'
                            : 'text-[#9CA3AF]',
                        ]"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="3.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </div>
                  </div>
                  <div
                    class="w-24 text-right flex-shrink-0 whitespace-nowrap cursor-pointer hover:text-[#111827] flex items-center justify-end select-none"
                    @click="rrHandleSort('completed_count')"
                  >
                    达成情况
                    <div
                      class="inline-flex flex-col items-center justify-center w-3 h-3 ml-1 align-middle"
                    >
                      <svg
                        :class="[
                          'w-2.5 h-2.5 -mb-[4px] transition-colors',
                          rrSortKey === 'completed_count' && rrSortOrder === 'asc'
                            ? 'text-[#0071E3]'
                            : 'text-[#9CA3AF]',
                        ]"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="3.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path d="m18 15-6-6-6 6" />
                      </svg>
                      <svg
                        :class="[
                          'w-2.5 h-2.5 transition-colors',
                          rrSortKey === 'completed_count' && rrSortOrder === 'desc'
                            ? 'text-[#0071E3]'
                            : 'text-[#9CA3AF]',
                        ]"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="3.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </div>
                  </div>
                  <div
                    class="w-24 text-right flex-shrink-0 whitespace-nowrap cursor-pointer hover:text-[#111827] flex items-center justify-end select-none"
                    @click="rrHandleSort('avg_time_val')"
                  >
                    人均耗时
                    <div
                      class="inline-flex flex-col items-center justify-center w-3 h-3 ml-1 align-middle"
                    >
                      <svg
                        :class="[
                          'w-2.5 h-2.5 -mb-[4px] transition-colors',
                          rrSortKey === 'avg_time_val' && rrSortOrder === 'asc'
                            ? 'text-[#0071E3]'
                            : 'text-[#9CA3AF]',
                        ]"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="3.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path d="m18 15-6-6-6 6" />
                      </svg>
                      <svg
                        :class="[
                          'w-2.5 h-2.5 transition-colors',
                          rrSortKey === 'avg_time_val' && rrSortOrder === 'desc'
                            ? 'text-[#0071E3]'
                            : 'text-[#9CA3AF]',
                        ]"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="3.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </div>
                  </div>
                </div>

                <div class="flex-1">
                  <div
                    v-if="rrCurrentNodes.length === 0"
                    class="py-12 text-center text-[#86868B] text-[13px] border border-dashed border-[#E5E5E7] rounded-lg mt-4"
                  >
                    该维度下暂无数据
                  </div>
                  <div v-else class="space-y-2 pb-2">
                    <!-- Region Row Inline -->
                    <template v-for="region in rrTopRegions" :key="region.id || region.region_id">
                      <div
                        @click="rrCurrentDimension !== 'store' && rrHandleDrillDown(region)"
                        :class="[
                          'flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 bg-[#F0FFF4]',
                          rrCurrentDimension !== 'store'
                            ? 'cursor-pointer hover:opacity-80 hover:bg-[#F5F5F7]'
                            : '',
                        ]"
                      >
                        <div
                          class="text-[15px] font-bold w-6 text-center flex items-center justify-center flex-shrink-0"
                          style="color: #34c759"
                          ><span>{{ region.rank }}</span></div
                        >
                        <div
                          class="w-4 flex items-center justify-center flex-shrink-0 text-[#86868B]"
                          ><svg
                            v-if="rrCurrentDimension !== 'store'"
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          >
                            <path d="m9 18 6-6-6-6" /></svg
                        ></div>
                        <div
                          class="text-[14px] font-semibold text-[#1D1D1F] w-20 truncate flex-shrink-0"
                          :title="region.region_name || region.entity_name"
                          >{{ region.region_name || region.entity_name }}</div
                        >
                        <div
                          class="flex-1 h-1.5 bg-[#E5E5E7] rounded-full overflow-hidden min-w-[50px]"
                        >
                          <div
                            class="h-full rounded-full transition-all duration-500"
                            :style="{
                              width: region.completion_rate * 100 + '%',
                              backgroundColor:
                                region.completion_rate === 0
                                  ? '#FF3B30'
                                  : region.completion_rate < 0.3
                                  ? '#FF9500'
                                  : '#34C759',
                            }"
                          ></div>
                        </div>
                        <div
                          class="text-[14px] font-bold text-[#1D1D1F] w-16 text-right flex-shrink-0"
                          >{{ Math.round(region.completion_rate * 100) }}%</div
                        >
                        <div class="text-[12px] text-[#86868B] w-24 text-right flex-shrink-0"
                          >{{ (region.completed_count || 0).toLocaleString() }}/{{
                            (region.employee_count || 0).toLocaleString()
                          }}</div
                        >
                        <div
                          class="text-[13px] text-[#1D1D1F] font-bold w-24 text-right flex-shrink-0"
                          >{{ region.avg_time || '-' }}</div
                        >
                      </div>
                    </template>

                    <div v-if="rrMiddleRegions.length > 0">
                      <div
                        class="w-full flex items-center justify-between px-4 py-3 bg-[#F5F5F7] rounded-lg transition-colors duration-200"
                      >
                        <span class="text-[13px] text-[#86868B]"
                          >其余 {{ rrMiddleRegions.length }} 个节点</span
                        >
                      </div>
                    </div>

                    <template
                      v-for="region in rrBottomRegions"
                      :key="region.id || region.region_id"
                    >
                      <div
                        @click="rrCurrentDimension !== 'store' && rrHandleDrillDown(region)"
                        :class="[
                          'flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 bg-[#FFF5F5]',
                          rrCurrentDimension !== 'store'
                            ? 'cursor-pointer hover:opacity-80 hover:bg-[#F5F5F7]'
                            : '',
                        ]"
                      >
                        <div
                          class="text-[15px] font-bold w-6 text-center flex items-center justify-center flex-shrink-0"
                          style="color: #ff3b30"
                          ><span>{{ region.rank }}</span></div
                        >
                        <div
                          class="w-4 flex items-center justify-center flex-shrink-0 text-[#86868B]"
                          ><svg
                            v-if="rrCurrentDimension !== 'store'"
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          >
                            <path d="m9 18 6-6-6-6" /></svg
                        ></div>
                        <div
                          class="text-[14px] font-semibold text-[#1D1D1F] w-20 truncate flex-shrink-0"
                          :title="region.region_name || region.entity_name"
                          >{{ region.region_name || region.entity_name }}</div
                        >
                        <div
                          class="flex-1 h-1.5 bg-[#E5E5E7] rounded-full overflow-hidden min-w-[50px]"
                        >
                          <div
                            class="h-full rounded-full transition-all duration-500"
                            :style="{
                              width: region.completion_rate * 100 + '%',
                              backgroundColor:
                                region.completion_rate === 0
                                  ? '#FF3B30'
                                  : region.completion_rate < 0.3
                                  ? '#FF9500'
                                  : '#34C759',
                            }"
                          ></div>
                        </div>
                        <div
                          class="text-[14px] font-bold text-[#1D1D1F] w-16 text-right flex-shrink-0"
                          >{{ Math.round(region.completion_rate * 100) }}%</div
                        >
                        <div class="text-[12px] text-[#86868B] w-24 text-right flex-shrink-0"
                          >{{ (region.completed_count || 0).toLocaleString() }}/{{
                            (region.employee_count || 0).toLocaleString()
                          }}</div
                        >
                        <div
                          class="text-[13px] text-[#1D1D1F] font-bold w-24 text-right flex-shrink-0"
                          >{{ region.avg_time || '-' }}</div
                        >
                      </div>
                    </template>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- AI Assistant Drawer Inline -->
    <div
      :class="[
        'fixed inset-0 z-[300] flex justify-end transition-all duration-300',
        isAiOpen ? 'visible pointer-events-auto' : 'invisible pointer-events-none',
      ]"
    >
      <!-- Backdrop -->
      <div
        :class="[
          'absolute inset-0 bg-black/20 backdrop-blur-sm transition-opacity duration-300',
          isAiOpen ? 'opacity-100' : 'opacity-0',
        ]"
        @click="isAiOpen = false"
      ></div>

      <!-- Drawer Panel -->
      <div
        :class="[
          'relative w-full max-w-[450px] h-full bg-[#FAFAFA] shadow-2xl flex flex-col transition-transform duration-300 ease-in-out',
          isAiOpen ? 'translate-x-0' : 'translate-x-full',
        ]"
      >
        <!-- Header -->
        <div
          class="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-100 flex-shrink-0"
        >
          <div class="flex items-center gap-3">
            <div
              class="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center border border-blue-100/50"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#0071E3"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M12 8V4H8" />
                <rect width="16" height="12" x="4" y="8" rx="2" />
                <path d="M2 14h2" />
                <path d="M20 14h2" />
                <path d="M15 13v2" />
                <path d="M9 13v2" />
              </svg>
            </div>
            <div>
              <h3 class="text-[16px] font-bold text-[#111827] font-outfit leading-tight"
                >AI 数据助手</h3
              >
              <p class="text-[12px] text-[#6B7280]">基于当前看板进行智能问答</p>
            </div>
          </div>
          <button
            @click="isAiOpen = false"
            class="p-2 rounded-full hover:bg-gray-100 transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#6B7280"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <!-- Chat Area -->
        <div class="flex-1 overflow-y-auto p-5 space-y-5" id="chat-container">
          <div
            v-for="(msg, index) in parsedAiMessages"
            :key="index"
            :class="['flex w-full', msg.role === 'user' ? 'justify-end' : 'justify-start']"
          >
            <div
              v-if="msg.role === 'ai'"
              class="w-8 h-8 rounded-full bg-white border border-gray-200 flex items-center justify-center flex-shrink-0 mr-3 mt-1 shadow-sm"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#0071E3"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M12 8V4H8" />
                <rect width="16" height="12" x="4" y="8" rx="2" />
                <path d="M2 14h2" />
                <path d="M20 14h2" />
                <path d="M15 13v2" />
                <path d="M9 13v2" />
              </svg>
            </div>
            <div
              :class="[
                'px-4 py-3 text-[14px] leading-relaxed shadow-sm markdown-body overflow-x-auto flex flex-col',
                msg.role === 'user'
                  ? 'max-w-[80%] bg-[#0071E3] text-white rounded-2xl rounded-tr-sm'
                  : 'max-w-[95%] bg-white text-[#111827] border border-gray-100 rounded-2xl rounded-tl-sm',
              ]"
            >
              <!-- 思考过程折叠面板 -->
              <details
                v-if="msg.hasThinking"
                class="mb-3 group bg-white rounded-xl overflow-hidden border border-[#D1D1D6] shadow-sm"
                :open="aiIsTyping && index === parsedAiMessages.length - 1"
              >
                <summary
                  class="flex items-center gap-2 px-4 py-2.5 cursor-pointer select-none text-[12px] font-semibold text-[#86868B] hover:bg-[#F5F5F7] transition-colors outline-none list-none [&::-webkit-details-marker]:hidden"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="transition-transform duration-300 group-open:rotate-90"
                  >
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                  <div class="flex items-center gap-1.5">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    思考过程
                  </div>
                  <div
                    v-if="aiIsTyping && index === parsedAiMessages.length - 1"
                    class="ml-auto flex items-center gap-1 opacity-60"
                  >
                    <span
                      class="w-1 h-1 bg-[#0071E3] rounded-full animate-bounce"
                      style="animation-delay: 0ms"
                    ></span>
                    <span
                      class="w-1 h-1 bg-[#0071E3] rounded-full animate-bounce"
                      style="animation-delay: 150ms"
                    ></span>
                    <span
                      class="w-1 h-1 bg-[#0071E3] rounded-full animate-bounce"
                      style="animation-delay: 300ms"
                    ></span>
                  </div>
                </summary>
                <div
                  class="px-4 pb-3 pt-0 text-[13px] leading-relaxed whitespace-pre-wrap border-t border-gray-100/50 bg-[#FAFAFA] markdown-body thinking-content"
                  v-html="renderMarkdown(msg.thinkingText)"
                ></div>
              </details>

              <div v-if="msg.parsedText" v-html="renderMarkdown(msg.parsedText)"></div>

              <template v-if="msg.role === 'ai'">
                <div
                  v-if="
                    aiIsTyping &&
                    index === parsedAiMessages.length - 1 &&
                    !msg.parsedText &&
                    !msg.hasThinking
                  "
                  class="flex items-center gap-1.5 h-5 px-1 opacity-60"
                >
                  <span
                    class="w-1.5 h-1.5 bg-[#0071E3] rounded-full animate-bounce"
                    style="animation-delay: 0ms"
                  ></span>
                  <span
                    class="w-1.5 h-1.5 bg-[#0071E3] rounded-full animate-bounce"
                    style="animation-delay: 150ms"
                  ></span>
                  <span
                    class="w-1.5 h-1.5 bg-[#0071E3] rounded-full animate-bounce"
                    style="animation-delay: 300ms"
                  ></span>
                </div>
                <AiChart
                  v-for="(cfg, cIdx) in msg.echartsConfigs"
                  :key="'chart-' + cIdx"
                  :config="cfg"
                />

                <div
                  v-if="msg.suggestions && msg.suggestions.length > 0"
                  class="mt-4 pt-3 border-t border-gray-100 flex flex-col gap-2"
                >
                  <span class="text-[12px] text-gray-400 font-semibold mb-1"
                    >💡 您还可以问我：</span
                  >
                  <div class="flex flex-wrap gap-2">
                    <button
                      v-for="(sugg, sIdx) in msg.suggestions"
                      :key="sIdx"
                      @click="aiSendSuggestion(sugg)"
                      class="px-3 py-1.5 bg-[#F5F5F7] hover:bg-[#EBF5FF] hover:text-[#0071E3] text-[#111827] text-[12px] rounded-lg transition-colors font-medium border border-gray-200 hover:border-blue-200 text-left shadow-sm"
                    >
                      {{ sugg }}
                    </button>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </div>

        <!-- Input Area -->
        <div class="p-4 bg-white border-t border-gray-100 flex-shrink-0">
          <div class="flex gap-2 overflow-x-auto pb-3 mb-1 no-scrollbar whitespace-nowrap">
            <button
              @click="aiSendSuggestion('分析一下当前的 P0 危机')"
              class="px-3 py-1.5 bg-[#F5F5F7] hover:bg-gray-200 text-[#111827] text-[12px] rounded-full transition-colors font-medium"
              >分析 P0 危机</button
            >
            <button
              @click="aiSendSuggestion('哪个任务进度最落后？')"
              class="px-3 py-1.5 bg-[#F5F5F7] hover:bg-gray-200 text-[#111827] text-[12px] rounded-full transition-colors font-medium"
              >哪个任务最落后？</button
            >
            <button
              @click="aiSendSuggestion('总结大盘整体情况')"
              class="px-3 py-1.5 bg-[#F5F5F7] hover:bg-gray-200 text-[#111827] text-[12px] rounded-full transition-colors font-medium"
              >总结大盘情况</button
            >
          </div>
          <div
            class="relative flex items-end gap-2 bg-[#F5F5F7] rounded-xl p-1.5 border border-transparent focus-within:border-blue-500 focus-within:bg-white transition-all duration-200"
          >
            <textarea
              v-model="aiInputText"
              @keydown.enter.prevent="aiSendMessage"
              placeholder="询问关于任务进度、预警详情..."
              rows="1"
              class="flex-1 max-h-24 bg-transparent border-none outline-none resize-none text-[14px] text-[#111827] py-2 px-3 placeholder:text-[#86868B]"
            ></textarea>
            <button
              @click="aiSendMessage"
              :disabled="!aiInputText.trim() || aiIsTyping"
              :class="[
                'p-2 rounded-lg flex-shrink-0 transition-colors duration-200 mb-0.5 mr-0.5',
                aiInputText.trim() && !aiIsTyping
                  ? 'bg-[#0071E3] text-white hover:bg-blue-600 shadow-md'
                  : 'bg-gray-200 text-gray-400',
              ]"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="m22 2-7 20-4-9-9-4Z" />
                <path d="M22 2 11 13" />
              </svg>
            </button>
          </div>
          <div class="text-center mt-3">
            <span class="text-[11px] text-[#9CA3AF]">AI 内容由模型生成，仅供辅助参考</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
<style scoped>
  @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');

  .new-board-app {
    font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'PingFang SC',
      'Helvetica Neue', sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  .font-outfit {
    font-family: 'Outfit', sans-serif;
    text-wrap: balance;
  }

  * {
    transition-timing-function: cubic-bezier(0.25, 0.1, 0.25, 1);
  }

  @keyframes slide-in-from-top-2 {
    from {
      opacity: 0;
      transform: translateY(-8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .animate-in {
    animation: slide-in-from-top-2 0.3s ease-out both;
  }

  .glass-card {
    background: #ffffff;
    box-shadow: 0 4px 24px -6px rgba(0, 0, 0, 0.04), 0 0 0 1px rgba(0, 0, 0, 0.03);
    border-radius: 1rem;
  }

  @keyframes alert-pulse {
    0% {
      transform: scale(0.85);
      box-shadow: 0 0 0 0 rgba(255, 59, 48, 0.8);
    }
    70% {
      transform: scale(1);
      box-shadow: 0 0 0 8px rgba(255, 59, 48, 0);
    }
    100% {
      transform: scale(0.85);
      box-shadow: 0 0 0 0 rgba(255, 59, 48, 0);
    }
  }
  @keyframes alert-pulse-yellow {
    0% {
      transform: scale(0.85);
      box-shadow: 0 0 0 0 rgba(255, 149, 0, 0.8);
    }
    70% {
      transform: scale(1);
      box-shadow: 0 0 0 8px rgba(255, 149, 0, 0);
    }
    100% {
      transform: scale(0.85);
      box-shadow: 0 0 0 0 rgba(255, 149, 0, 0);
    }
  }
  .animate-alert-pulse-red {
    animation: alert-pulse 1.5s infinite;
  }
  .animate-alert-pulse-yellow {
    animation: alert-pulse-yellow 1.5s infinite;
    animation-delay: 0.2s;
  }

  /* Hide scrollbar for Chrome, Safari and Opera */
  .no-scrollbar::-webkit-scrollbar {
    display: none;
  }
  /* Hide scrollbar for IE, Edge and Firefox */
  .no-scrollbar {
    -ms-overflow-style: none; /* IE and Edge */
    scrollbar-width: none; /* Firefox */
  }

  :deep(.markdown-body) {
    font-size: 14px;
    line-height: 1.6;
    word-wrap: break-word;
  }
  :deep(.markdown-body p) {
    margin-top: 0;
    margin-bottom: 0.8em;
  }
  :deep(.markdown-body p:last-child) {
    margin-bottom: 0;
  }
  :deep(.markdown-body strong),
  :deep(.markdown-body b) {
    font-weight: 600;
    color: inherit;
  }
  :deep(.markdown-body ul),
  :deep(.markdown-body ol) {
    padding-left: 1.5em;
    margin-top: 0.5em;
    margin-bottom: 0.5em;
  }
  :deep(.markdown-body li) {
    margin-bottom: 0.25em;
  }
  :deep(.markdown-body code) {
    padding: 0.2em 0.4em;
    margin: 0;
    font-size: 85%;
    background-color: rgba(175, 184, 193, 0.2);
    border-radius: 6px;
    font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace;
  }
  :deep(.markdown-body pre) {
    background-color: #f6f8fa;
    border-radius: 6px;
    padding: 16px;
    overflow: auto;
    font-size: 85%;
    line-height: 1.45;
  }
  :deep(.markdown-body pre code) {
    background-color: transparent;
    padding: 0;
  }
  :deep(.markdown-body table) {
    border-collapse: collapse;
    width: 100%;
    margin-top: 0.8em;
    margin-bottom: 0.8em;
    font-size: 13px;
    white-space: nowrap;
  }
  :deep(.markdown-body table th),
  :deep(.markdown-body table td) {
    padding: 6px 13px;
    border: 1px solid #d0d7de;
    min-width: 60px;
  }
  :deep(.markdown-body table tr:nth-child(2n)) {
    background-color: #f6f8fa;
  }
  :deep(.markdown-body blockquote) {
    padding: 0 1em;
    color: #656d76;
    border-left: 0.25em solid #d0d7de;
    margin-left: 0;
    margin-right: 0;
  }
  :deep(.markdown-body h1),
  :deep(.markdown-body h2),
  :deep(.markdown-body h3),
  :deep(.markdown-body h4) {
    margin-top: 1.5em;
    margin-bottom: 0.5em;
    font-weight: 600;
    line-height: 1.25;
  }
  :deep(.markdown-body h3) {
    font-size: 1.1em;
  }
  :deep(.markdown-body h4) {
    font-size: 1em;
  }

  /* User bubble adjustments to ensure contrast is fine */
  .bg-\[\#0071E3\] :deep(.markdown-body code) {
    background-color: rgba(255, 255, 255, 0.2);
    color: #fff;
  }
  .bg-\[\#0071E3\] :deep(.markdown-body pre) {
    background-color: rgba(0, 0, 0, 0.1);
    color: #fff;
  }
  .bg-\[\#0071E3\] :deep(.markdown-body table th),
  .bg-\[\#0071E3\] :deep(.markdown-body table td) {
    border-color: rgba(255, 255, 255, 0.3);
  }
  .bg-\[\#0071E3\] :deep(.markdown-body table tr:nth-child(2n)) {
    background-color: rgba(255, 255, 255, 0.1);
  }

  /* thinking box specific tweaks */
  details :deep(.markdown-body p) {
    margin-bottom: 0.5em;
    font-size: 13px;
    color: #6b7280;
  }
  details :deep(.markdown-body strong),
  details :deep(.markdown-body b) {
    color: #111827 !important;
    font-weight: 800 !important;
  }

  .thinking-content {
    color: #6e6e73 !important;
  }
  .thinking-content :deep(strong),
  .thinking-content :deep(b) {
    color: #111827 !important;
    font-weight: 800 !important;
  }
</style>
