<script setup lang="ts">
  import { ref, computed, watch, onMounted, nextTick, onUnmounted, defineComponent, h } from 'vue';
  import * as echarts from 'echarts';
  import { getTaskList } from '@/api/task';
  import {
    getDashboardOverview,
    getDashboardWarnings,
    getDashboardTrend,
    getDashboardHeatmap,
    getDashboardAgentInsight,
    streamDashboardInsight,
    postDashboardInsightVote,
    type CreateDashboardInsightBody
  } from '@/api/dashboard';
  import { marked } from 'marked';
  import { createDashboardChatSession, streamDashboardChatMessage } from '@/api/chat';
  import { useMessage } from 'naive-ui';
  import { ColorWandOutline } from '@vicons/ionicons5';
  import { LikeOutlined, DislikeOutlined, CheckOutlined, CopyOutlined } from '@vicons/antd';
  import { renderInsightMarkdown } from '@/utils/markdownRender';
  import AiAnalyzePopover from './components/AiAnalyzePopover.vue';

  const message = useMessage();

  // ================= AI Insight (Intelligent Analysis) =================
  const diagnosisData = ref<any[]>([]);
  const isAgentLoading = ref(false);

  const allTasks = ref<any[]>([]);

  const loadTasks = async () => {
    try {
      const rawTasks = await getTaskList().send();
      // 只要已下发的任务
      const dispatched = (rawTasks || []).filter((t: any) => t.status === 'dispatched');

      allTasks.value = dispatched.map((t: any) => {
        return {
          task_id: t.id,
          task_title: t.title,
          deadline: t.ddlAt ? t.ddlAt.substring(0, 10) : '无截止时间',
          fullDeadline: t.ddlAt,
          completion_rate: null,
          severity: 'green', // Will be dynamically updated by background fetch
        };
      });

      if (allTasks.value.length > 0) {
        // Asynchronously fetch and fill completion rates for all tasks
        Promise.all(
          allTasks.value.map(async (task) => {
            try {
              const res = await getDashboardOverview({ taskId: task.task_id }).send();
              if (res && typeof res.completionRate !== 'undefined') {
                const rate = res.completionRate / 100;
                task.completion_rate = rate;
                
                // Dynamically update severity based on fetched rate
                if (rate < 0.5) task.severity = 'red';
                else if (rate < 0.8) task.severity = 'yellow';
                else task.severity = 'green';
              }
            } catch (err) {
              console.warn(`Failed to fetch overview for task ${task.task_id}`, err);
            }
          })
        );
      }

      await loadAgentInsights();
      if (allTasks.value.length > 0 && !currentTaskId.value) {
        // Pick the very first actionable diagnosis task from the agent's flow
        const firstActionableDiag = diagnosisData.value?.find(
          (d) => d.action_type !== 'none' && d.related_task_id
        );
        if (firstActionableDiag) {
          currentTaskId.value = firstActionableDiag.related_task_id;
          isAutoCollapsed.value = true;
        } else {
          currentTaskId.value = allTasks.value[0].task_id;
          isAutoCollapsed.value = true;
        }
      }
    } catch (err) {
      console.error('获取任务列表失败', err);
    }
  };

  const loadAgentInsights = async () => {
    isAgentLoading.value = true;
    try {
      const agentRes = await getDashboardAgentInsight().send();
      if (agentRes && agentRes.topTasks) {
        const newDiag = agentRes.topTasks.map((t: any, index: number) => {
          let sev = 'green';
          if (t.severity === 'red') sev = 'red';
          if (t.severity === 'orange') sev = 'yellow';

          let actionText = '查看明细';
          if (sev === 'red') {
            if (t.focusModule === 'funnel_alerts') actionText = '紧急干预流失';
            else if (t.focusModule === 'completion_daily') actionText = '追赶执行进度';
            else actionText = '立即介入风险';
          } else if (sev === 'yellow') {
            if (t.focusModule === 'funnel_alerts') actionText = '分析流失卡点';
            else if (t.focusModule === 'north_star') actionText = '洞察核心瓶颈';
            else actionText = '洞察数据异动';
          }

          return {
            diagnosis_id: `diag-auto-${t.taskId}`,
            priority_rank: index + 1,
            severity: sev,
            summary_text: t.insight || `${t.title} 存在异常，请关注`,
            related_task_id: t.taskId,
            task_title: t.title,
            related_region_id: null,
            related_store_id: null,
            suggested_action: actionText,
            action_type: sev === 'red' ? 'escalate' : 'remind',
            action_status: 'pending',
            generated_at: agentRes.generatedAt || new Date().toISOString(),
          };
        });

        if (allTasks.value.length > 0) {
          newDiag.push({
            diagnosis_id: 'diag-ok',
            priority_rank: 99,
            severity: 'green',
            summary_text: agentRes.overallSummary || `其余任务按计划推进中，无需关注`,
            related_task_id: null,
            task_title: null,
            related_region_id: null,
            related_store_id: null,
            suggested_action: null,
            action_type: 'none',
            action_status: 'pending',
            generated_at: agentRes.generatedAt || new Date().toISOString(),
          });
        }
        diagnosisData.value = newDiag;
      }
    } catch (err) {
      console.error('获取 Agent 洞察失败', err);
    } finally {
      isAgentLoading.value = false;
    }
  };

  // ================= Global State =================
  const metricCompletionRateDelta = ref<number>(0);
  const currentTaskId = ref<string | null>(null);
  const isContentLoading = ref(false);
  const isDiagnosisCollapsed = ref(false);
  const lastUpdated = ref(new Date());
  const alertFilter = ref('P0');
  const isAiOpen = ref(false);
  const isFunnelModalOpen = ref(false);
  const isAlertModalOpen = ref(false);
  const selectedFunnelStage = ref<any>(null);

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
        getDashboardHeatmap({ taskId, rtmLevel: 'store' }).send(),
      ];
      const [p2Res, p1Res, p0Res, heatmapRes] = await Promise.all(promises);

      let combinedAlerts = [];
      if (p2Res && p2Res.list) {
        combinedAlerts = combinedAlerts.concat(
          p2Res.list.map((a: any) => ({
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
          p1Res.list.map((a: any) => ({
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
          p0Res.list.map((a: any) => ({
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

      // Synthesize 'Unfinished' list from heatmap data for overdue/uncompleted items
      // Note: Heatmap has assignmentCount and completedCount.
      // Unfinished count = assignmentCount - completedCount.
      // We will only add it if the task is overdue (determined globally) OR if we just want to list all uncompleted.
      // Since it's 'Unfinished', we show stores with unfinished > 0.
      if (heatmapRes && (heatmapRes as any).heatmapData) {
        const heatmapData = (heatmapRes as any).heatmapData;
        const unfinishedStores = heatmapData.filter((h: any) => {
           const uncompleted = (h.assignmentCount || 0) - (h.completedCount || 0);
           return uncompleted > 0;
        });

        // Check if global task is overdue to provide better description
        const currentTaskInfo = (allTasks.value || []).find((t: any) => t.task_id === taskId);
        let isTaskOverdue = false;
        if (currentTaskInfo && currentTaskInfo.deadline && currentTaskInfo.deadline !== '无截止时间') {
           const todayStr = new Date().toISOString().split('T')[0];
           if (currentTaskInfo.deadline < todayStr) isTaskOverdue = true;
        }

        combinedAlerts = combinedAlerts.concat(
          unfinishedStores.map((h: any) => {
            const uncompleted = (h.assignmentCount || 0) - (h.completedCount || 0);
            const riskRate = h.assignmentCount > 0 ? (uncompleted / h.assignmentCount) * 100 : 0;
            return {
              alert_id: h.rtmValue + '-unfinished',
              level: 'Unfinished',
              description: isTaskOverdue ? `任务已逾期，仍有 ${uncompleted} 人未完成` : `目前仍有 ${uncompleted} 人未完成任务`,
              related_entity: h.rtmValue || '未知门店',
              storeName: h.rtmValue,
              total_employees: h.assignmentCount || 0,
              completed_count: h.completedCount || 0,
              risk_rate: parseFloat(riskRate.toFixed(2)),
              aiSuggestion: '建议及时督促对应门店/区域进行学习',
            };
          })
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
      const today = new Date();
      const yest = new Date(today);
      yest.setDate(yest.getDate() - 1);
      const todayStr = today.toISOString().split('T')[0];
      const yestStr = yest.toISOString().split('T')[0];

      const [overviewData, trendDataRes, trendHourlyResToday, trendHourlyResYest] = await Promise.all([
        getDashboardOverview({ taskId }).send(),
        getDashboardTrend({ taskId, type: 'daily' })
          .send()
          .catch(() => null),
        getDashboardTrend({ taskId, type: 'hourly', date: todayStr })
          .send()
          .catch(() => null),
        getDashboardTrend({ taskId, type: 'hourly', date: yestStr })
          .send()
          .catch(() => null),
      ]);
      currentOverview.value = overviewData;

      if (overviewData) {
        // Sync rate back to the allTasks object for UI presentation
        const currentTaskInList = allTasks.value.find(t => t.task_id === taskId);
        if (currentTaskInList) {
          const rate = overviewData.completionRate / 100;
          currentTaskInList.completion_rate = rate;
          if (rate < 0.5) currentTaskInList.severity = 'red';
          else if (rate < 0.8) currentTaskInList.severity = 'yellow';
          else currentTaskInList.severity = 'green';
        }
      }

      if (
        trendDataRes &&
        trendDataRes.trendData &&
        trendDataRes.trendData.length > 0 &&
        overviewData.totalAssignments > 0
      ) {
        let cumulativeYesterday = 0;
        for (const point of trendDataRes.trendData) {
          if (point.timeKey <= yestStr) {
            cumulativeYesterday = point.cumulativeCompleted;
          } else {
            break;
          }
        }

        const yesterdayRate = cumulativeYesterday / overviewData.totalAssignments;
        const todayRate = overviewData.completionRate / 100;
        metricCompletionRateDelta.value = todayRate - yesterdayRate;
      } else {
        metricCompletionRateDelta.value = 0;
      }

      const newTrend: any = { daily: {}, hourly: {} };

      if (trendDataRes && trendDataRes.trendData && trendDataRes.trendData.length > 0) {
        // Group by weeks backwards (latest 7 days, then previous 7 days...)
        const dataReversed = [...trendDataRes.trendData].reverse();
        const weeklyGroups: Record<string, any[]> = {};
        
        let chunkIndex = 0;
        for (let i = 0; i < dataReversed.length; i += 7) {
          const chunk = dataReversed.slice(i, i + 7).reverse(); // reverse back to chronological order
          const startDateStr = chunk[0].timeKey.substring(5).replace('-', '.');
          const endDateStr = chunk[chunk.length - 1].timeKey.substring(5).replace('-', '.');
          
          let label = `${startDateStr} - ${endDateStr}`;
          if (chunkIndex === 0) label += ' (本周)';
          else if (chunkIndex === 1) label += ' (上周)';
          else label += ` (-${chunkIndex}周)`;
          
          weeklyGroups[label] = chunk.map((d: any) => ({
            time: d.timeKey.substring(5),
            increment: d.newCompleted || 0,
            cumulative: d.cumulativeCompleted || 0,
          }));
          chunkIndex++;
        }
        
        Object.assign(newTrend.daily, weeklyGroups);
      } else {
        newTrend.daily['所有时间段'] = [];
      }

      const processHourly = (hourlyRes: any, label: string) => {
        if (hourlyRes && hourlyRes.trendData) {
          const hourlyArr: any[] = [];
          let cumulative = 0;
          for (let h = 0; h < 24; h++) {
            const hStr = h.toString().padStart(2, '0');
            const found = hourlyRes.trendData.find((d: any) => d.timeKey === hStr);
            if (found) {
              cumulative = found.cumulativeCompleted;
              hourlyArr.push({
                time: `${hStr}:00`,
                increment: found.newCompleted || 0,
                cumulative: cumulative,
              });
            } else {
              hourlyArr.push({
                time: `${hStr}:00`,
                increment: 0,
                cumulative: cumulative,
              });
            }
          }
          newTrend.hourly[label] = hourlyArr;
        }
      };

      processHourly(trendHourlyResToday, `${todayStr} (今日)`);
      processHourly(trendHourlyResYest, `${yestStr} (昨日)`);
      
      if (Object.keys(newTrend.hourly).length === 0) {
        newTrend.hourly['今日走势'] = [];
      }

      trendData.value = newTrend;
    } catch (error) {
      console.error('获取 overview 失败', error);
      metricCompletionRateDelta.value = 0;
      trendData.value = { daily: {}, hourly: {} };
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
      const inProgress = o.inProgressCount || 0;
      const completed = o.completedCount || 0;
      return {
        funnel: [
          { stage: 'pushed', label: '推送', count: pushed },
          { stage: 'delivered', label: '送达', count: delivered },
          { stage: 'in_progress', label: '学习中', count: inProgress + completed },
          { stage: 'completed', label: '已完成', count: completed },
        ],
      };
    }
    return {
      funnel: [
        { stage: 'pushed', label: '推送', count: 0 },
        { stage: 'delivered', label: '送达', count: 0 },
        { stage: 'in_progress', label: '学习中', count: 0 },
        { stage: 'completed', label: '已完成', count: 0 },
      ],
    };
  });

  // obsolete, removed usage

  const alertSummary = computed(() => {
    if (currentOverview.value) {
      const total = currentOverview.value.totalAssignments || 0;
      const p0 = Math.round(total * (currentOverview.value.crisisP0Rate || 0) / 100);
      const p1 = Math.round(total * (currentOverview.value.crisisP1Rate || 0) / 100);
      const p2 = Math.round(total * (currentOverview.value.crisisP2Rate || 0) / 100);

      return {
        p0_count: p0,
        p1_count: p1,
        p2_count: p2,
        p0_breakdown: p0 > 0 ? [{ category: '距离截止 < 24h', count: p0 }] : [],
        p1_breakdown: p1 > 0 ? [{ category: '距离截止 < 48h', count: p1 }] : [],
        p2_breakdown: p2 > 0 ? [{ category: '起步转化异常', count: p2 }] : [],
      };
    }
    return {
      p0_count: 0,
      p1_count: 0,
      p2_count: 0,
      p0_breakdown: [],
      p1_breakdown: [],
      p2_breakdown: [],
    };
  });

  const alertFunnelData = computed(() => {
    if (currentOverview.value) {
      const o = currentOverview.value;
      const total = o.totalAssignments || 0;

      // Calculate people count accurately from the percentage returned by the backend
      const p0 = Math.round(total * (o.crisisP0Rate || 0) / 100);
      const p1 = Math.round(total * (o.crisisP1Rate || 0) / 100);
      const p2 = Math.round(total * (o.crisisP2Rate || 0) / 100);
      
      const unfinished = o.overdueCount || 0;

      return [
        { stage: 'P2', label: 'P2', count: p2 },
        { stage: 'P1', label: 'P1', count: p1 },
        { stage: 'P0', label: 'P0', count: p0 },
        { stage: 'Unfinished', label: '未完成', count: unfinished },
      ];
    }
    return [
      { stage: 'P2', label: 'P2', count: 0 },
      { stage: 'P1', label: 'P1', count: 0 },
      { stage: 'P0', label: 'P0', count: 0 },
      { stage: 'Unfinished', label: '未完成', count: 0 },
    ];
  });
  const trendData = ref<any>(null);

  const alerts = computed(() => {
    return {
      total: currentAlerts.value ? currentAlerts.value.length : 0,
      alerts: currentAlerts.value || [],
    };
  });

  // ================= AI Insight (Intelligent Analysis) =================
  type BoardInsightSection = 'northStar' | 'funnel' | 'warning' | 'trend' | 'rtm';
  interface BoardInsightCardState {
    content: string;
    loading: boolean;
    insightId: string | null;
    generatedAt: string | null;
    up: number;
    down: number;
    userVote: 'up' | 'down' | null;
    fetchedKey: string;
  }

  const globalReasoningEnabled = ref(false);
  const INSIGHT_VOTE_STORAGE_PREFIX = 'tot_insight_vote_new_';

  const readStoredInsightVote = (insightId: string): 'up' | 'down' | null => {
    try {
      const v = sessionStorage.getItem(INSIGHT_VOTE_STORAGE_PREFIX + insightId);
      if (v === 'up' || v === 'down') return v;
    } catch {}
    return null;
  };

  const writeStoredInsightVote = (insightId: string, v: 'up' | 'down' | null) => {
    try {
      const key = INSIGHT_VOTE_STORAGE_PREFIX + insightId;
      if (v == null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, v);
    } catch {}
  };

  const emptyBoardInsightCard = (): BoardInsightCardState => ({
    content: '',
    loading: false,
    insightId: null,
    generatedAt: null,
    up: 0,
    down: 0,
    userVote: null,
    fetchedKey: '',
  });

  const boardInsightCard = ref<Record<BoardInsightSection, BoardInsightCardState>>({
    northStar: emptyBoardInsightCard(),
    funnel: emptyBoardInsightCard(),
    warning: emptyBoardInsightCard(),
    trend: emptyBoardInsightCard(),
    rtm: emptyBoardInsightCard(),
  });

  const copiedStates = ref<Record<string, boolean>>({
    northStar: false,
    funnel: false,
    warning: false,
    trend: false,
    rtm: false,
  });

  const handleCopyAiInsight = (text: string, section: string) => {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => {
        message.success('已复制到剪贴板');
        copiedStates.value[section] = true;
        setTimeout(() => (copiedStates.value[section] = false), 2000);
      });
    }
  };

  const formatInsightGeneratedTime = (isoString: string) => {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  };

  const insightVotePending = ref<Record<BoardInsightSection, boolean>>({
    northStar: false,
    funnel: false,
    warning: false,
    trend: false,
    rtm: false,
  });

  const handleAiFeedback = async (section: BoardInsightSection, vote: 'up' | 'down') => {
    const card = boardInsightCard.value[section];
    const id = card.insightId;
    if (!id) return;
    if (insightVotePending.value[section]) return;
    insightVotePending.value[section] = true;
    try {
      const prev = card.userVote;
      if (prev === vote) {
        await postDashboardInsightVote(id, { vote, action: 'remove' }).send();
        if (vote === 'up') card.up = Math.max(0, card.up - 1);
        else card.down = Math.max(0, card.down - 1);
        card.userVote = null;
        writeStoredInsightVote(id, null);
      } else {
        if (prev) {
          await postDashboardInsightVote(id, { vote: prev, action: 'remove' }).send();
          if (prev === 'up') card.up = Math.max(0, card.up - 1);
          else card.down = Math.max(0, card.down - 1);
        }
        await postDashboardInsightVote(id, { vote, action: 'add' }).send();
        if (vote === 'up') card.up++;
        else card.down++;
        card.userVote = vote;
        writeStoredInsightVote(id, vote);
      }
    } catch {
      message.error('反馈提交失败');
    } finally {
      insightVotePending.value[section] = false;
    }
  };

  const buildBoardInsightRequestKey = (section: BoardInsightSection): string => {
    const tid = currentTaskId.value || '';
    const r = globalReasoningEnabled.value ? 'R1' : 'V3';
    if (section === 'northStar') return `north_star_kpi::${tid}::${r}`;
    if (section === 'funnel') return `north_star::${tid}::${r}`;
    if (section === 'warning') return `funnel_alerts::${tid}::${r}`;
    if (section === 'trend') return `trend::${tid}::${currentDim.value}::${currentSubPeriod.value}::${r}`;
    if (section === 'rtm') return `channel_north_star::${tid}::${rrCurrentDimension.value}::${r}`;
    return `default::${tid}`;
  };

  const buildBoardInsightPayload = (section: BoardInsightSection): CreateDashboardInsightBody | null => {
    const tid = currentTaskId.value;
    if (!tid) return null;
    const base = { reasoning: globalReasoningEnabled.value };
    if (section === 'northStar') return { ...base, insightType: 'north_star', taskId: tid };
    if (section === 'funnel') return { ...base, insightType: 'north_star', taskId: tid };
    if (section === 'warning') return { ...base, insightType: 'funnel_alerts', taskId: tid };
    if (section === 'trend') {
      if (currentDim.value === 'hourly') {
        return { ...base, insightType: 'completion_daily', taskId: tid, trendType: 'hourly' };
      }
      return { ...base, insightType: 'completion_weekly', taskId: tid, trendType: 'daily' };
    }
    if (section === 'rtm') return { ...base, insightType: 'channel_north_star', taskId: tid, rtmLevel: 'rtm' };
    return null;
  };

  const ensureBoardInsightOnOpen = async (section: BoardInsightSection) => {
    if (!currentTaskId.value) {
      message.warning('请先选择一个任务');
      return;
    }
    const key = buildBoardInsightRequestKey(section);
    const cur = boardInsightCard.value[section];
    if (cur.fetchedKey === key && cur.content) return;

    const payload = buildBoardInsightPayload(section);
    if (!payload) return;

    boardInsightCard.value[section] = {
      ...cur,
      loading: true,
      content: '',
      insightId: null,
      generatedAt: null,
      userVote: null,
      fetchedKey: key,
    };

    let isFirstChunk = true;
    let wasReasoning = false;
    let didReasoning = false;

    try {
      await streamDashboardInsight(
        payload,
        (deltaData) => {
          if (isFirstChunk) {
            boardInsightCard.value[section].loading = false;
            isFirstChunk = false;
            if (deltaData.phase === 'reasoning') {
              boardInsightCard.value[section].content += '> **思考过程：**\n> ';
              wasReasoning = true;
              didReasoning = true;
            }
          }
          if (deltaData && deltaData.text) {
            if (deltaData.phase === 'reasoning') {
              const formattedText = deltaData.text.replace(/\n/g, '\n> ');
              boardInsightCard.value[section].content += formattedText;
              wasReasoning = true;
              didReasoning = true;
            } else {
              if (wasReasoning) {
                boardInsightCard.value[section].content += '\n\n---\n\n';
                wasReasoning = false;
              }
              boardInsightCard.value[section].content += deltaData.text;
            }
          }
        },
        (fullData) => {
          boardInsightCard.value[section] = {
            ...boardInsightCard.value[section],
            loading: false,
            content: didReasoning ? boardInsightCard.value[section].content : fullData.content,
            insightId: fullData.insightId,
            generatedAt: fullData.createdAt || null,
            up: fullData.voteSummary?.up ?? 0,
            down: fullData.voteSummary?.down ?? 0,
            userVote: readStoredInsightVote(fullData.insightId),
          };
        },
        () => {
          boardInsightCard.value[section].loading = false;
          if (!boardInsightCard.value[section].content) {
            boardInsightCard.value[section].content = '获取智能分析失败';
          }
        }
      );
    } catch {
      boardInsightCard.value[section].loading = false;
    }
  };

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

  // ... Diagnosis Flow
  const expandedTasks = ref(false);

  const isAutoCollapsed = ref(true);

  watch(isAutoCollapsed, (newVal) => {
    if (newVal) {
      expandedTasks.value = false;
    }
  });

  const visibleDiagnoses = computed(() => {
    return (diagnosisData.value || []).filter(
      (diagnosis) =>
        !isAutoCollapsed.value ||
        (diagnosis.related_task_id === currentTaskId.value && diagnosis.action_type !== 'none')
    );
  });

  const currentTaskTitle = computed(() => {
    const task = (allTasks.value || []).find((t) => t.task_id === currentTaskId.value);
    return task ? task.task_title : '';
  });

  const handleDiagnosisClick = (diagnosis: any) => {
    if (diagnosis.action_type === 'none') {
      expandedTasks.value = !expandedTasks.value;
    } else if (diagnosis.severity !== 'green') {
      isAutoCollapsed.value = true;
      if (diagnosis.related_task_id) {
        triggerLoading(() => (currentTaskId.value = diagnosis.related_task_id));
      }
    }
  };

  const handleTaskSelect = (taskId: string) => {
    const hasSpecificDiagnosis = (diagnosisData.value || []).some(
      (d) => d.related_task_id === taskId && d.severity !== 'green'
    );
    if (hasSpecificDiagnosis) {
      isAutoCollapsed.value = true;
    } else {
      isAutoCollapsed.value = false;
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
    return 0;
  });

  const metricHoursRemaining = computed(() => {
    const task = (allTasks.value || []).find((t) => t.task_id === currentTaskId.value);
    if (!task || !task.fullDeadline) return 0;
    
    // Replace '-' with '/' for safe parsing in all browsers, e.g. "2026/04/20 23:59:59"
    const ddlTime = new Date(task.fullDeadline.replace(/-/g, '/')).getTime();
    const nowTime = new Date().getTime();
    const diffMs = ddlTime - nowTime;
    
    if (diffMs <= 0) return 0;
    return Math.floor(diffMs / (1000 * 60 * 60));
  });

  const metricReadCount = computed(() => {
    return (
      (currentOverview.value?.inProgressCount || 0) + (currentOverview.value?.completedCount || 0)
    );
  });

  const metricConfirmationRate = computed(() => {
    if (currentOverview.value && currentOverview.value.totalAssignments > 0) {
      const confirmed =
        (currentOverview.value.inProgressCount || 0) + (currentOverview.value.completedCount || 0);
      return confirmed / currentOverview.value.totalAssignments;
    }
    return 0;
  });
  const metricDeliveredCount = computed(() => currentOverview.value?.totalAssignments || 0);
  const metricP0Count = computed(() => {
    if (!currentOverview.value) return 0;
    return Math.round((currentOverview.value.totalAssignments || 0) * (currentOverview.value.crisisP0Rate || 0) / 100);
  });
  const metricP1Count = computed(() => {
    if (!currentOverview.value) return 0;
    return Math.round((currentOverview.value.totalAssignments || 0) * (currentOverview.value.crisisP1Rate || 0) / 100);
  });
  const metricP2Count = computed(() => {
    if (!currentOverview.value) return 0;
    return Math.round((currentOverview.value.totalAssignments || 0) * (currentOverview.value.crisisP2Rate || 0) / 100);
  });
  const metricTotalAlerts = computed(
    () => metricP0Count.value + metricP1Count.value + metricP2Count.value
  );

  const getTrendColor = (delta: number) =>
    delta > 0 ? '#34C759' : delta < 0 ? '#FF3B30' : '#86868B';

  const safeFormatRate = (rate: number, decimals = 0, suffix = '%') => {
    if (rate === null || rate === undefined || isNaN(rate) || !isFinite(rate)) return '-';
    return rate.toFixed(decimals) + suffix;
  };

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
  const alertTotalPeople = computed(() => currentOverview.value?.totalAssignments || 0);
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
  const alertFunnelMaxCount = computed(() => {
    if (!alertFunnelData.value || alertFunnelData.value.length === 0) return 1;
    const max = Math.max(...alertFunnelData.value.map(s => s.count));
    return max > 0 ? max : 1;
  });
  const getAlertFunnelWidth = (stage: any) => (stage.count / alertFunnelMaxCount.value) * 100;
  const getAlertConversionRate = (index: number) => {
    return null as any;
  };
  const getOverallConversionRate = () => {
    return null as any;
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

  const rrRawNodes = ref<any[]>([]);
  const isRtmLoading = ref(false);

  const fetchRegionRanking = async () => {
    if (!currentTaskId.value) return;
    isRtmLoading.value = true;
    try {
      const params: any = {
        taskId: currentTaskId.value,
        rtmLevel:
          rrCurrentDimension.value === 'rtm3'
            ? 'rtm'
            : rrCurrentDimension.value === 'rtm4'
            ? 'format'
            : rrCurrentDimension.value === 'dealer'
            ? 'dealerName'
            : 'store',
      };
      if (rrSelectedRTM3.value)
        params.rtm = rrSelectedRTM3.value.region_name || rrSelectedRTM3.value.entity_name;
      if (rrSelectedRTM4.value)
        params.format = rrSelectedRTM4.value.region_name || rrSelectedRTM4.value.entity_name;
      
      const dName = rrSelectedDealer.value?.region_name || rrSelectedDealer.value?.entity_name || '';
      if (rrSelectedDealer.value && dName !== '(未知)' && dName !== '(未知实体)' && dName !== '(未知门店)') {
        params.dealerName = dName;
      }

      const res = await getDashboardHeatmap(params).send();
      const heatmapData = (res as any)?.heatmapData || (res as any)?.data?.heatmapData || [];
      rrRawNodes.value = heatmapData.map((h: any, idx: number) => ({
        id: h.rtmValue || `empty-${idx}`,
        region_id: h.rtmValue || `empty-${idx}`,
        region_name: h.rtmValue || '未知',
        entity_name: h.rtmValue || '未知',
        completion_rate: h.completionRate ? h.completionRate / 100 : 0,
        completed_count: h.completedCount || 0,
        employee_count: h.assignmentCount || 0,
        avg_time: h.avgCompletionTimeHours ? `${h.avgCompletionTimeHours.toFixed(1)}h` : '-',
      }));
    } catch (e) {
      console.error('Fetch RTM Ranking Failed', e);
      rrRawNodes.value = [];
    } finally {
      isRtmLoading.value = false;
    }
  };

  watch(
    [currentTaskId, rrCurrentDimension, rrSelectedRTM3, rrSelectedRTM4, rrSelectedDealer],
    () => {
      fetchRegionRanking();
    },
    { immediate: true }
  );

  const rrCurrentNodes = computed(() => {
    let nodes = [...(rrRawNodes.value || [])];

    if (rrSearchQuery.value.trim()) {
      const q = rrSearchQuery.value.trim().toLowerCase();
      nodes = nodes.filter((n) => (n.region_name || n.entity_name || '').toLowerCase().includes(q));
    }

    const sorted = [...nodes].sort((a, b) => {
      let valA = a[rrSortKey.value];
      let valB = b[rrSortKey.value];
      if (rrSortKey.value === 'avg_time_val' || rrSortKey.value === 'avg_time') {
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
      const dealer = region.region_name || region.entity_name || '';
      if (dealer === '(未知)' || dealer === '(未知实体)' || dealer === '(未知门店)') {
        rrSelectedDealer.value = null;
      } else {
        rrSelectedDealer.value = region;
      }
      rrCurrentDimension.value = 'store';
    }
    rrExpandedMiddle.value = false;
    rrSearchQuery.value = '';
  };

  const rrChangeDimension = (dim: string) => {
    if (dim === 'rtm3') {
      rrSelectedRTM3.value = null;
      rrSelectedRTM4.value = null;
      rrSelectedDealer.value = null;
    } else if (dim === 'rtm4') {
      rrSelectedRTM4.value = null;
      rrSelectedDealer.value = null;
    } else if (dim === 'dealer') {
      rrSelectedDealer.value = null;
    }
    rrCurrentDimension.value = dim;
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
              'relative mt-4 mb-2 border border-gray-200 rounded-xl bg-white shadow-sm overflow-hidden group/chart',
            style: { minHeight: '260px' }
          },
          [
            h(
              'div',
              {
                class: 'absolute top-3 right-3 z-[900] opacity-0 group-hover/chart:opacity-100 transition-opacity duration-200',
              },
              [
                h(
                  'button',
                  {
                    onClick: downloadChart,
                    class:
                      'px-3 py-1.5 bg-white/90 hover:bg-white backdrop-blur-sm rounded-md text-[#0071E3] font-medium text-[12px] transition-colors shadow-sm border border-gray-200 flex items-center gap-1.5',
                    title: '下载图表为图片',
                  },
                  [
                    h('span', null, '⬇️'),
                    h('span', null, '下载')
                  ]
                ),
              ]
            ),
            h('div', {
              ref: chartRef,
              class: 'w-full h-full p-2',
              style: {
                minHeight: '260px',
                resize: 'both',
                overflow: 'hidden',
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

  
  // ... Funnel Modal Logic
  const fmCurrentDimension = ref('rtm3');
  const fmSearchQuery = ref('');
  const fmSelectedRTM3 = ref<string | null>(null);
  const fmSelectedRTM4 = ref<string | null>(null);
  const fmSelectedDealer = ref<string | null>(null);
  const fmSortKey = ref('rate');
  const fmSortOrder = ref('desc');
  const fmTableData = ref<any[]>([]);
  const fmTableLoading = ref(false);

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

  const fmDimensionLabel = computed(() => {
    return fmAvailableDimensions.value.find((d) => d.value === fmCurrentDimension.value)?.label || 'RTM3';
  });

  const fmHandleSort = (key: string) => {
    if (fmSortKey.value === key) fmSortOrder.value = fmSortOrder.value === 'desc' ? 'asc' : 'desc';
    else {
      fmSortKey.value = key;
      fmSortOrder.value = 'desc';
    }
  };

  const fmChangeDimension = (dim: string) => {
    if (dim === 'rtm3') {
      fmSelectedRTM3.value = null;
      fmSelectedRTM4.value = null;
      fmSelectedDealer.value = null;
    } else if (dim === 'rtm4') {
      fmSelectedRTM4.value = null;
      fmSelectedDealer.value = null;
    } else if (dim === 'dealer') {
      fmSelectedDealer.value = null;
    }
    fmCurrentDimension.value = dim;
    fmSearchQuery.value = '';
  };

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
      const dealer = row.name || '';
      if (dealer === '(未知)' || dealer === '(未知实体)' || dealer === '(未知门店)') {
        fmSelectedDealer.value = '';
      } else {
        fmSelectedDealer.value = row.name;
      }
      fmCurrentDimension.value = 'store';
    }
    fmSearchQuery.value = '';
  };

  const loadFunnelModalData = async () => {
    if (!selectedFunnelStage.value) return;
    fmTableLoading.value = true;
    try {
      const heatParams: any = {
        taskId: currentTaskId.value,
        rtmLevel: fmCurrentDimension.value === 'rtm3' ? 'rtm' :
                  fmCurrentDimension.value === 'rtm4' ? 'format' :
                  fmCurrentDimension.value === 'dealer' ? 'dealerName' : 'store',
      };
      if (fmSelectedRTM3.value) heatParams.rtm = fmSelectedRTM3.value;
      if (fmSelectedRTM4.value) heatParams.format = fmSelectedRTM4.value;
      if (fmSelectedDealer.value) heatParams.dealerName = fmSelectedDealer.value;

      const heatRes = await getDashboardHeatmap(heatParams).send();
      const entities = heatRes?.heatmapData || [];

      // Only fetch overview concurrently if we really need "read" or "in_progress"
      // Wait, heatmap doesn't return 'in_progress'. 
      // But let's check what the overview endpoints need:
      // For each entity, we need its specific data
      
      const promises = entities.map(async (h: any) => {
        const ovParams = { ...heatParams };
        if (fmCurrentDimension.value === 'rtm3') ovParams.rtm = h.rtmValue;
        else if (fmCurrentDimension.value === 'rtm4') ovParams.format = h.rtmValue;
        else if (fmCurrentDimension.value === 'dealer') ovParams.dealerName = h.rtmValue;
        else if (fmCurrentDimension.value === 'store') {
          // Heatmap API returns store name in rtmValue. Overview API only accepts storeId.
          // Wait, heatmap API doesn't return storeId! Actually, if level=store, heatmap groups by s.id but returns MAX(s.name) AS rtm_value. 
          // Since we can't reliably map store name to storeId on the fly, for store level we might have to use only the heatmap data!
          // Heatmap provides assignmentCount and completedCount.
        }

        // If it's just 'pushed' or 'completed', heatmap data already has it!
        // We can save API calls.
        const st = selectedFunnelStage.value.stage;
        let count = 0;
        let total = h.assignmentCount || 1;
        
        if (st === 'pushed' || st === 'delivered') {
          return { name: h.rtmValue, total, count: total, rate: 1 };
        } else if (st === 'completed') {
          return { name: h.rtmValue, total, count: h.completedCount, rate: h.completionRate / 100 };
        } else if (st === 'in_progress') {
          // Heatmap now returns inProgressCount! 
          // Funnel "in_progress" logic is inProgressCount + completedCount
          count = (h.inProgressCount || 0) + (h.completedCount || 0);
          return { name: h.rtmValue, total, count, rate: total > 0 ? count/total : 0 };
        } else {
          // 'read' - fallback to overview if possible, else 0.
          // For safety, let's just make the overview call if NOT store level
          if (fmCurrentDimension.value !== 'store') {
             try {
                const ov = await getDashboardOverview(ovParams).send();
                if (st === 'read') count = ov.employeeReadCount || ov.totalReadCount || 0;
             } catch(e){}
          }
          return { name: h.rtmValue, total, count, rate: total > 0 ? count/total : 0 };
        }
      });

      const rawList = await Promise.all(promises);
      fmTableData.value = rawList;

    } catch (e) {
      fmTableData.value = [];
    } finally {
      fmTableLoading.value = false;
    }
  };

  const fmGroupedData = computed(() => {
    let results = [...fmTableData.value];
    if (fmSearchQuery.value.trim()) {
      const q = fmSearchQuery.value.trim().toLowerCase();
      results = results.filter((r) => (r.name || '').toLowerCase().includes(q));
    }
    return results.sort((a, b) => {
      const valA = a[fmSortKey.value] || 0;
      const valB = b[fmSortKey.value] || 0;
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
      loadFunnelModalData();
    }
  });

  watch([fmCurrentDimension, currentTaskId], () => {
    if (isFunnelModalOpen.value) {
      loadFunnelModalData();
    }
  });

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

  watch(isAlertModalOpen, (v) => {
    if (v) {
      amFilter.value = alertFilter.value;
      amSelectedRTM3.value = null;
      amSelectedRTM4.value = null;
      amSelectedDealer.value = null;
      amCurrentDimension.value = 'rtm3';
      amSearchQuery.value = '';
      loadAlertModalData();
    } else {
      amShowMore.value = false;
    }
  });

  watch([amCurrentDimension, alertFilter, currentTaskId], () => {
    if (isAlertModalOpen.value) {
      loadAlertModalData();
    }
  });

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
  const amChangeDimension = (dim: string) => {
    if (dim === 'rtm3') {
      amSelectedRTM3.value = null;
      amSelectedRTM4.value = null;
      amSelectedDealer.value = null;
    } else if (dim === 'rtm4') {
      amSelectedRTM4.value = null;
      amSelectedDealer.value = null;
    } else if (dim === 'dealer') {
      amSelectedDealer.value = null;
    }
    amCurrentDimension.value = dim;
    amSearchQuery.value = '';
  };

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
      const dealer = row.entity_name || '';
      if (dealer === '(未知)' || dealer === '(未知实体)' || dealer === '(未知门店)') {
        amSelectedDealer.value = '';
      } else {
        amSelectedDealer.value = row.entity_name;
      }
      amCurrentDimension.value = 'store';
    }
    amSearchQuery.value = '';
  };
  const amTableData = ref<any[]>([]);
  const amTableLoading = ref(false);

  const loadAlertModalData = async () => {
    amTableLoading.value = true;
    try {
      if (alertFilter.value === 'Unfinished') {
        const heatmapParams: any = {
          taskId: currentTaskId.value,
          rtmLevel: amCurrentDimension.value === 'rtm3' ? 'rtm' : amCurrentDimension.value === 'rtm4' ? 'format' : amCurrentDimension.value,
        };
        // Heatmap API handles rtm, format, dealerName differently.
        if (amSelectedRTM3.value) heatmapParams.rtm = amSelectedRTM3.value;
        if (amSelectedRTM4.value) heatmapParams.format = amSelectedRTM4.value;
        if (amSelectedDealer.value) heatmapParams.dealerName = amSelectedDealer.value;

        const res = await getDashboardHeatmap(heatmapParams).send();
        const heatmapData = (res as any)?.heatmapData || (res as any)?.data?.heatmapData || [];

        const unfinishedNodes = heatmapData.filter((h: any) => {
           const uncompleted = (h.assignmentCount || 0) - (h.completedCount || 0);
           return uncompleted > 0;
        });

        amTableData.value = unfinishedNodes.map((h: any) => {
          const uncompleted = (h.assignmentCount || 0) - (h.completedCount || 0);
          const riskRate = h.assignmentCount > 0 ? (uncompleted / h.assignmentCount) : 0;
          return {
            alert_id: h.rtmValue + '-unfinished',
            level: 'Unfinished',
            entity_name: h.rtmValue || '未知实体',
            total_employees: h.assignmentCount || 0,
            completed_count: h.completedCount || 0,
            risk_count: uncompleted,
            risk_rate: riskRate,
          };
        });

      } else {
        const params: any = {
          taskId: currentTaskId.value,
          warningLevel: alertFilter.value.toLowerCase(),
          level: amCurrentDimension.value === 'rtm3' ? 'rtm' : amCurrentDimension.value === 'rtm4' ? 'format' : amCurrentDimension.value,
          pageSize: 100,
        };
        if (amSelectedRTM3.value) params.rtm = amSelectedRTM3.value;
        if (amSelectedRTM4.value) params.format = amSelectedRTM4.value;
        if (amSelectedDealer.value) params.dealerName = amSelectedDealer.value;

        const res = await getDashboardWarnings(params).send();
        let rawList = res?.list || [];

        amTableData.value = rawList.map((a: any) => {
          const riskCount = (a.totalCount || 0) - (a.completedCount || 0);
          return {
            alert_id: a.targetId + '-' + a.warningLevel,
            level: a.warningLevel ? a.warningLevel.toUpperCase() : 'Unfinished',
            entity_name: a.targetName,
            total_employees: a.totalCount,
            completed_count: a.completedCount,
            risk_count: riskCount,
            risk_rate: a.warningRate / 100,
          };
        });
      }
    } catch (e) {
      console.error('Fetch Alert Modal Data Failed', e);
      amTableData.value = [];
    } finally {
      amTableLoading.value = false;
    }
  };

  const amFilteredAlerts = computed(() => {
    return amTableData.value;
  });

  const amGroupedAlerts = computed(() => {
    let results = [...amFilteredAlerts.value];
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
    window.addEventListener('resize', () => {
      if (chartInstance) chartInstance.resize();
    });
  });
  onUnmounted(() => {
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
        </div>
      </div>
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
              v-for="diagnosis in visibleDiagnoses"
              :key="diagnosis.diagnosis_id"
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
                        width: task.completion_rate !== null ? task.completion_rate * 100 + '%' : '0%',
                        backgroundColor: severityColors[task.severity],
                      }"
                    ></div>
                  </div>
                  <div class="text-[12px] text-[#6B7280] font-medium w-10 text-right"
                    >{{ task.completion_rate !== null ? Math.round(task.completion_rate * 100) + '%' : '-' }}</div
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
            <div class="lg:w-[320px] flex-shrink-0 flex flex-col z-10 group/card relative">
              <!-- Metric Cards Component Inlined -->
              <div class="glass-card flex flex-col h-full w-full border-none flex-1 relative">
                <AiAnalyzePopover
                  class="absolute right-4 top-4 z-50 group-hover/card:opacity-100 opacity-0 transition-opacity duration-200"
                  :loading="boardInsightCard.northStar.loading"                  :content="boardInsightCard.northStar.content"
                  :generated-at="boardInsightCard.northStar.generatedAt"
                  :user-vote="boardInsightCard.northStar.userVote"
                  :is-reasoning="globalReasoningEnabled"
                  :copied="copiedStates.northStar"
                  :render-markdown="renderInsightMarkdown"
                  @open="ensureBoardInsightOnOpen('northStar')"
                  @toggle-reasoning="globalReasoningEnabled = $event; ensureBoardInsightOnOpen('northStar')"
                  @feedback="handleAiFeedback('northStar', $event)"
                  @copy="handleCopyAiInsight(boardInsightCard.northStar.content, 'northStar')"
                />
                <div class="flex-1 p-5 flex flex-col items-center justify-center text-center">
                  <div
                    class="text-[12px] font-medium text-[#6B7280] mb-2 flex items-center gap-1.5 uppercase tracking-wide relative cursor-help z-10"
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
                      class="text-[#9CA3AF] hover:text-[#6B7280] transition-colors peer"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                      <path d="M12 17h.01" />
                    </svg>
                    <div
                      class="absolute left-full ml-2 top-1/2 -translate-y-1/2 w-48 bg-gray-900 text-white text-[11px] font-normal leading-relaxed rounded-lg py-2 px-3 opacity-0 peer-hover:opacity-100 pointer-events-none transition-opacity duration-200 text-left shadow-lg z-[999]"
                    >
                      在截止时间前完成任务的员工比例。用于衡量大盘整体的推进效率。
                    </div>
                  </div>
                  <div
                    class="text-[36px] leading-none font-bold text-[#111827] font-outfit tracking-tight mb-3"
                    >{{ safeFormatRate(metricCompletionRate * 100, 2) }}</div
                  >
                  <div class="flex items-center gap-3">
                    <div
                      class="text-[12px] font-semibold flex items-center gap-0.5"
                      :style="{ color: getTrendColor(metricCompletionRateDelta) }"
                    >
                      <span>较昨天</span>
                      <span
                        >{{ metricCompletionRateDelta > 0 ? '+' : ''
                        }}{{
                          safeFormatRate(Math.abs(metricCompletionRateDelta * 100), 1, 'pp')
                        }}</span
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
                    class="text-[12px] font-medium text-[#6B7280] mb-2 flex items-center gap-1.5 uppercase tracking-wide relative cursor-help z-10"
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
                      class="text-[#9CA3AF] hover:text-[#6B7280] transition-colors peer"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                      <path d="M12 17h.01" />
                    </svg>
                    <div
                      class="absolute left-full ml-2 top-1/2 -translate-y-1/2 w-56 bg-gray-900 text-white text-[11px] font-normal leading-relaxed rounded-lg py-2 px-3 opacity-0 peer-hover:opacity-100 pointer-events-none transition-opacity duration-200 text-left shadow-lg z-[999]"
                    >
                      已阅读/确认任务的人数占成功送达总人数的比例，体现任务下发的触达质量。
                    </div>
                  </div>
                  <div
                    class="text-[36px] leading-none font-bold text-[#111827] font-outfit tracking-tight mb-3"
                    >{{ safeFormatRate(metricConfirmationRate * 100, 1) }}</div
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
                    class="text-[12px] font-medium text-[#6B7280] mb-2 flex items-center gap-1.5 uppercase tracking-wide relative cursor-help z-10"
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
                      class="text-[#9CA3AF] hover:text-[#6B7280] transition-colors peer"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                      <path d="M12 17h.01" />
                    </svg>
                    <div
                      class="absolute left-full ml-2 top-1/2 -translate-y-1/2 w-48 bg-gray-900 text-white text-[11px] font-normal leading-relaxed rounded-lg py-2 px-3 opacity-0 peer-hover:opacity-100 pointer-events-none transition-opacity duration-200 text-left shadow-lg z-[999]"
                    >
                      系统诊断出的异常状态总数。P0表示距ddl不足24h，P1表示距ddl不足48h，P2表示起步异常。
                    </div>
                  </div>
                  <div
                    class="text-[36px] leading-none font-bold font-outfit tracking-tight mb-3"
                    :style="{ color: metricTotalAlerts === 0 ? '#10B981' : '#EF4444' }"
                    >{{ metricTotalAlerts }}</div
                  >
                  <div class="flex items-center gap-2 text-[11px] font-bold">
                    <span
                      class="px-2 py-0.5 rounded-full ring-1 ring-inset"
                      :class="
                        metricP0Count > 0
                          ? 'bg-red-50 text-red-500 ring-red-100'
                          : 'bg-gray-50 text-gray-400 ring-gray-200'
                      "
                      >P0: {{ metricP0Count }}</span
                    >
                    <span
                      class="px-2 py-0.5 rounded-full ring-1 ring-inset"
                      :class="
                        metricP1Count > 0
                          ? 'bg-orange-50 text-orange-500 ring-orange-100'
                          : 'bg-gray-50 text-gray-400 ring-gray-200'
                      "
                      >P1: {{ metricP1Count }}</span
                    >
                    <span
                      class="px-2 py-0.5 rounded-full ring-1 ring-inset"
                      :class="
                        metricP2Count > 0
                          ? 'bg-amber-50 text-amber-600 ring-amber-100'
                          : 'bg-gray-50 text-gray-400 ring-gray-200'
                      "
                      >P2: {{ metricP2Count }}</span
                    >
                  </div>
                </div>
              </div>
            </div>
            <div class="flex-1 glass-card p-5 md:p-6 flex flex-col min-w-0 relative group/card">
              <AiAnalyzePopover
                class="absolute right-4 top-4 z-50 group-hover/card:opacity-100 opacity-0 transition-opacity duration-200"
                :loading="boardInsightCard.funnel.loading"
                :content="boardInsightCard.funnel.content"
                :generated-at="boardInsightCard.funnel.generatedAt"
                :user-vote="boardInsightCard.funnel.userVote"
                :is-reasoning="globalReasoningEnabled"
                :copied="copiedStates.funnel"
                :render-markdown="renderInsightMarkdown"
                @open="ensureBoardInsightOnOpen('funnel')"
                @toggle-reasoning="globalReasoningEnabled = $event; ensureBoardInsightOnOpen('funnel')"
                @feedback="handleAiFeedback('funnel', $event)"
                @copy="handleCopyAiInsight(boardInsightCard.funnel.content, 'funnel')"
              />
              <div class="flex items-center gap-1.5 mb-4 relative w-fit cursor-help z-10">
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
                  class="text-[#9CA3AF] hover:text-[#6B7280] transition-colors peer"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                  <path d="M12 17h.01" />
                </svg>
                <div
                  class="absolute left-full ml-3 top-1/2 -translate-y-1/2 w-64 bg-gray-900 text-white text-[12px] font-normal leading-relaxed rounded-lg py-2.5 px-3.5 opacity-0 peer-hover:opacity-100 pointer-events-none transition-opacity duration-200 z-[999] text-left shadow-lg"
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
                        流失 {{ safeFormatRate(getFunnelDropRate(index), 0) }}
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
                        <div class="text-[13px] text-[#86868B]">{{
                          safeFormatRate(getFunnelRate(stage), 0)
                        }}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Layer 3: Unified Alert Block -->
          <div class="mt-16 relative group">
            <div class="flex items-center justify-between mb-6 relative z-10">
              <div class="flex items-center gap-1.5 w-fit cursor-help">
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
                  class="text-[#9CA3AF] hover:text-[#6B7280] transition-colors peer"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                  <path d="M12 17h.01" />
                </svg>
                <div
                  class="absolute left-full ml-3 top-1/2 -translate-y-1/2 w-56 bg-gray-900 text-white text-[12px] font-normal leading-relaxed rounded-lg py-2.5 px-3.5 opacity-0 peer-hover:opacity-100 pointer-events-none transition-opacity duration-200 z-[999] text-left shadow-lg"
                >
                  实时展示诊断出的各层级业务风险项，漏斗图展示了高危风险逐步缩口的转化情况。
                </div>
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
              <div class="flex-1 glass-card p-5 md:p-6 flex flex-col min-w-0 relative group/card">
                <AiAnalyzePopover
                  class="absolute right-4 top-4 z-50 group-hover/card:opacity-100 opacity-0 transition-opacity duration-200"
                  :loading="boardInsightCard.warning.loading"
                  :content="boardInsightCard.warning.content"
                  :generated-at="boardInsightCard.warning.generatedAt"
                  :user-vote="boardInsightCard.warning.userVote"
                  :is-reasoning="globalReasoningEnabled"
                  :copied="copiedStates.warning"
                  :render-markdown="renderInsightMarkdown"
                  @open="ensureBoardInsightOnOpen('warning')"
                  @toggle-reasoning="globalReasoningEnabled = $event; ensureBoardInsightOnOpen('warning')"
                  @feedback="handleAiFeedback('warning', $event)"
                  @copy="handleCopyAiInsight(boardInsightCard.warning.content, 'warning')"
                />
                <div class="flex items-center gap-1.5 mb-4 relative w-fit cursor-help z-10">
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
                    class="text-[#9CA3AF] hover:text-[#6B7280] transition-colors peer"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                    <path d="M12 17h.01" />
                  </svg>
                  <div
                    class="absolute left-full ml-3 top-1/2 -translate-y-1/2 w-64 bg-gray-900 text-white text-[12px] font-normal leading-relaxed rounded-lg py-2.5 px-3.5 opacity-0 peer-hover:opacity-100 pointer-events-none transition-opacity duration-200 z-[999] text-left shadow-lg"
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
                          转化率 {{ safeFormatRate(getAlertConversionRate(index), 1) }}
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
                      <div class="flex items-center gap-2 relative cursor-help">
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
                          class="text-[#9CA3AF] hover:text-[#6B7280] transition-colors peer"
                        >
                          <circle cx="12" cy="12" r="10" />
                          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                          <path d="M12 17h.01" />
                        </svg>
                        <div
                          class="absolute bottom-full mb-2 left-0 w-56 bg-gray-900 text-white text-[11px] font-normal leading-relaxed rounded-lg py-2 px-3 opacity-0 peer-hover:opacity-100 pointer-events-none transition-opacity duration-200 text-left shadow-lg z-[999]"
                        >
                          预警转化率 = (最初进入P2风险人数 - 最终未完成人数) /
                          最初进入P2风险人数。衡量对风险人员的挽回效率。
                        </div>
                      </div>
                      <div class="flex items-baseline gap-1">
                        <span class="text-[20px] font-bold font-outfit text-[#0071E3]">{{
                          safeFormatRate(getOverallConversionRate(), 1)
                        }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Layer 4: Trend Chart + Region Ranking -->
          <div class="mt-16 mb-16 flex flex-col lg:flex-row gap-5 items-stretch">
            <div class="flex-1 min-w-0 flex flex-col glass-card p-6 md:p-8 z-10 relative group/card">
              <!-- Trend Chart Container -->
              <div class="w-full flex flex-col h-full z-10">
                <div
                  class="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4 flex-shrink-0"
                >
                  <div class="flex items-center gap-3 relative w-fit z-10">
                    <div class="flex items-center gap-1.5 relative w-fit cursor-help">
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
                        class="text-[#9CA3AF] hover:text-[#6B7280] transition-colors peer"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                        <path d="M12 17h.01" />
                      </svg>
                      <div
                        class="absolute left-full ml-3 top-1/2 -translate-y-1/2 w-64 bg-gray-900 text-white text-[12px] font-normal leading-relaxed rounded-lg py-2.5 px-3.5 opacity-0 peer-hover:opacity-100 pointer-events-none transition-opacity duration-200 z-[999] text-left shadow-lg"
                      >
                        显示大盘在所选时间段内的推进情况。折线代表历史累计完成人数，柱状图代表各个节点的单日/单时新增完成人数。
                      </div>
                    </div>
                    <AiAnalyzePopover
                      class="relative opacity-0 group-hover/card:opacity-100 transition-opacity duration-200"
                      :loading="boardInsightCard.trend.loading"
                      :content="boardInsightCard.trend.content"
                      :generated-at="boardInsightCard.trend.generatedAt"
                      :user-vote="boardInsightCard.trend.userVote"
                      :is-reasoning="globalReasoningEnabled"
                      :copied="copiedStates.trend"
                      :render-markdown="renderInsightMarkdown"
                      @open="ensureBoardInsightOnOpen('trend')"
                      @toggle-reasoning="globalReasoningEnabled = $event; ensureBoardInsightOnOpen('trend')"
                      @feedback="handleAiFeedback('trend', $event)"
                      @copy="handleCopyAiInsight(boardInsightCard.trend.content, 'trend')"
                    />
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
            <div class="flex-1 min-w-0 flex flex-col glass-card p-6 md:p-8 relative group/card">
              <!-- Region Ranking Component Inlined -->
              <div v-if="true" class="w-full flex flex-col h-full min-h-[380px] flex-1 relative z-10">
                <!-- Loading Overlay -->
                <div
                  v-if="isRtmLoading"
                  class="absolute inset-0 z-50 flex items-center justify-center bg-white/60 backdrop-blur-sm rounded-xl"
                >
                  <div
                    class="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"
                  ></div>
                </div>
                <div class="mb-5 space-y-4 flex-shrink-0">
                  <div>
                    <h3
                      class="text-[18px] leading-[1.3] font-semibold text-[#1D1D1F] flex items-center gap-2 flex-wrap"
                    >
                      <div class="flex items-center gap-3 relative w-fit z-10">
                        <div class="flex items-center gap-1.5 relative w-fit cursor-help">
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
                            class="text-[#9CA3AF] hover:text-[#6B7280] transition-colors peer"
                          >
                            <circle cx="12" cy="12" r="10" />
                            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                            <path d="M12 17h.01" />
                          </svg>
                          <div
                            class="absolute left-full ml-3 top-1/2 -translate-y-1/2 w-64 bg-gray-900 text-white text-[12px] font-normal leading-relaxed rounded-lg py-2.5 px-3.5 opacity-0 peer-hover:opacity-100 pointer-events-none transition-opacity duration-200 z-[999] text-left shadow-lg"
                          >
                            显示各级业务节点的任务完成进度排名。可切换查看 RTM / 经销商 /
                            门店层级，并支持下钻查看特定节点的详细分布。
                          </div>
                        </div>
                        <AiAnalyzePopover
                          class="relative opacity-0 group-hover/card:opacity-100 transition-opacity duration-200"
                          :loading="boardInsightCard.rtm.loading"
                          :content="boardInsightCard.rtm.content"
                          :generated-at="boardInsightCard.rtm.generatedAt"
                          :user-vote="boardInsightCard.rtm.userVote"
                          :is-reasoning="globalReasoningEnabled"
                          :copied="copiedStates.rtm"
                          :render-markdown="renderInsightMarkdown"
                          @open="ensureBoardInsightOnOpen('rtm')"
                          @toggle-reasoning="globalReasoningEnabled = $event; ensureBoardInsightOnOpen('rtm')"
                          @feedback="handleAiFeedback('rtm', $event)"
                          @copy="handleCopyAiInsight(boardInsightCard.rtm.content, 'rtm')"
                        />
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
                        @click="rrChangeDimension(dim.value)"
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

                <div class="flex-1 overflow-x-auto">
                  <div class="min-w-[480px]">
                    <div
                      class="flex items-center gap-2 lg:gap-3 px-2 lg:px-4 pb-2 mb-2 text-[12px] font-medium text-[#86868B] border-b border-[#E5E5E7] flex-shrink-0 min-w-max"
                    >
                      <div class="w-5 lg:w-6 text-center flex-shrink-0">排名</div>
                      <div class="w-3 lg:w-4 flex-shrink-0"></div>
                      <div class="w-24 lg:w-32 flex-shrink-0 truncate">{{ rrDimensionLabel }}</div>
                      <div class="flex-1 min-w-[60px] hidden sm:block">完成进度</div>
                      <div
                        class="w-12 lg:w-16 text-right flex-shrink-0 whitespace-nowrap cursor-pointer hover:text-[#111827] flex items-center justify-end select-none"
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
                        class="w-20 lg:w-24 text-right flex-shrink-0 whitespace-nowrap cursor-pointer hover:text-[#111827] flex items-center justify-end select-none"
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
                        class="w-16 lg:w-24 text-right flex-shrink-0 whitespace-nowrap cursor-pointer hover:text-[#111827] flex items-center justify-end select-none"
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
                          'flex items-center gap-2 lg:gap-3 px-2 lg:px-4 py-2 lg:py-3 rounded-lg transition-all duration-200 bg-[#F0FFF4] min-w-max',
                          rrCurrentDimension !== 'store'
                            ? 'cursor-pointer hover:opacity-80 hover:bg-[#F5F5F7]'
                            : '',
                        ]"
                      >
                        <div
                          class="text-[14px] lg:text-[15px] font-bold w-5 lg:w-6 text-center flex items-center justify-center flex-shrink-0"
                          style="color: #34c759"
                          ><span>{{ region.rank }}</span></div
                        >
                        <div
                          class="w-3 lg:w-4 flex items-center justify-center flex-shrink-0 text-[#86868B]"
                          ><svg
                            v-if="rrCurrentDimension !== 'store'"
                            xmlns="http://www.w3.org/2000/svg"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            class="lg:w-4 lg:h-4"
                          >
                            <path d="m9 18 6-6-6-6" /></svg
                        ></div>
                        <div
                          class="text-[13px] lg:text-[14px] font-semibold text-[#1D1D1F] w-24 lg:w-32 truncate flex-shrink-0"
                          :title="region.region_name || region.entity_name"
                          >{{ region.region_name || region.entity_name }}</div
                        >
                        <div
                          class="flex-1 min-w-[60px] h-1.5 bg-[#E5E5E7] rounded-full overflow-hidden hidden sm:block"
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
                          class="text-[14px] font-bold text-[#1D1D1F] w-12 lg:w-16 text-right flex-shrink-0"
                          >{{ Math.round(region.completion_rate * 100) }}%</div
                        >
                        <div class="text-[12px] text-[#86868B] w-20 lg:w-24 text-right flex-shrink-0"
                          >{{ (region.completed_count || 0).toLocaleString() }}/{{
                            (region.employee_count || 0).toLocaleString()
                          }}</div
                        >
                        <div
                          class="text-[13px] text-[#1D1D1F] font-bold w-16 lg:w-24 text-right flex-shrink-0"
                          >{{ region.avg_time || '-' }}</div
                        >
                      </div>
                    </template>

                    <div v-if="rrMiddleRegions.length > 0">
                      <div
                        @click="rrExpandedMiddle = !rrExpandedMiddle"
                        class="w-full flex items-center justify-between px-4 py-3 bg-[#F5F5F7] hover:bg-[#E5E5E7] cursor-pointer rounded-lg transition-colors duration-200 min-w-max"
                      >
                        <span class="text-[13px] text-[#86868B] font-medium"
                          >{{ rrExpandedMiddle ? '收起' : '展开' }}其余 {{ rrMiddleRegions.length }} 个节点</span
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
                          :class="['text-[#86868B] transition-transform duration-200', rrExpandedMiddle ? 'rotate-180' : '']"
                        >
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </div>

                      <!-- Expanded Middle Regions -->
                      <div v-if="rrExpandedMiddle" class="mt-2 space-y-2">
                        <template v-for="region in rrMiddleRegions" :key="region.id || region.region_id">
                          <div
                            @click="rrCurrentDimension !== 'store' && rrHandleDrillDown(region)"
                            :class="[
                              'flex items-center gap-2 lg:gap-3 px-2 lg:px-4 py-2 lg:py-3 rounded-lg transition-all duration-200 bg-white border border-gray-100 min-w-max',
                              rrCurrentDimension !== 'store' ? 'cursor-pointer hover:bg-blue-50/30' : 'hover:bg-gray-50/50',
                            ]"
                          >
                            <div
                              class="text-[14px] lg:text-[15px] font-bold w-5 lg:w-6 text-center flex items-center justify-center flex-shrink-0 text-[#86868B]"
                              ><span>{{ region.rank }}</span></div
                            >
                            <div
                              class="w-3 lg:w-4 flex items-center justify-center flex-shrink-0 text-[#86868B]"
                              ><svg
                                v-if="rrCurrentDimension !== 'store'"
                                xmlns="http://www.w3.org/2000/svg"
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                class="opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <path d="m9 18 6-6-6-6" />
                              </svg></div
                            >
                            <div
                              class="w-24 lg:w-32 text-[14px] font-semibold text-[#111827] truncate flex-shrink-0"
                              :title="region.region_name || region.entity_name"
                              >{{ region.region_name || region.entity_name }}</div
                            >
                            <div class="flex-1 min-w-[60px] hidden sm:flex items-center gap-3">
                              <div class="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div
                                  class="h-full rounded-full transition-all duration-500 bg-[#86868B]"
                                  :style="{ width: region.completion_rate * 100 + '%' }"
                                ></div>
                              </div>
                            </div>
                            <div
                              class="w-12 lg:w-16 text-right text-[14px] lg:text-[15px] font-bold font-outfit text-[#111827] flex-shrink-0"
                              >{{ Math.round(region.completion_rate * 100) }}%</div
                            >
                            <div
                              class="text-[13px] text-[#6B7280] font-medium w-16 lg:w-20 text-right flex-shrink-0"
                              >{{ (region.completed_count || 0).toLocaleString() }} /
                              {{
                                (region.employee_count || 0).toLocaleString()
                              }}</div
                            >
                            <div
                              class="text-[13px] text-[#1D1D1F] font-bold w-16 lg:w-24 text-right flex-shrink-0"
                              >{{ region.avg_time || '-' }}</div
                            >
                          </div>
                        </template>
                      </div>
                    </div>

                    <template
                      v-for="region in rrBottomRegions"
                      :key="region.id || region.region_id"
                    >
                      <div
                        @click="rrCurrentDimension !== 'store' && rrHandleDrillDown(region)"
                        :class="[
                          'flex items-center gap-2 lg:gap-3 px-2 lg:px-4 py-2 lg:py-3 rounded-lg transition-all duration-200 bg-[#FFF5F5] min-w-max',
                          rrCurrentDimension !== 'store'
                            ? 'cursor-pointer hover:opacity-80 hover:bg-[#F5F5F7]'
                            : '',
                        ]"
                      >
                        <div
                          class="text-[14px] lg:text-[15px] font-bold w-5 lg:w-6 text-center flex items-center justify-center flex-shrink-0"
                          style="color: #ff3b30"
                          ><span>{{ region.rank }}</span></div
                        >
                        <div
                          class="w-3 lg:w-4 flex items-center justify-center flex-shrink-0 text-[#86868B]"
                          ><svg
                            v-if="rrCurrentDimension !== 'store'"
                            xmlns="http://www.w3.org/2000/svg"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            class="lg:w-4 lg:h-4"
                          >
                            <path d="m9 18 6-6-6-6" /></svg
                        ></div>
                        <div
                          class="text-[13px] lg:text-[14px] font-semibold text-[#1D1D1F] w-24 lg:w-32 truncate flex-shrink-0"
                          :title="region.region_name || region.entity_name"
                          >{{ region.region_name || region.entity_name }}</div
                        >
                        <div
                          class="flex-1 min-w-[60px] h-1.5 bg-[#E5E5E7] rounded-full overflow-hidden hidden sm:block"
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
                          class="text-[14px] font-bold text-[#1D1D1F] w-12 lg:w-16 text-right flex-shrink-0"
                          >{{ Math.round(region.completion_rate * 100) }}%</div
                        >
                        <div class="text-[12px] text-[#86868B] w-20 lg:w-24 text-right flex-shrink-0"
                          >{{ (region.completed_count || 0).toLocaleString() }}/{{
                            (region.employee_count || 0).toLocaleString()
                          }}</div
                        >
                        <div
                          class="text-[13px] text-[#1D1D1F] font-bold w-16 lg:w-24 text-right flex-shrink-0"
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
    </div>

    
    <!-- Funnel Modal -->
    <div
      v-if="isFunnelModalOpen"
      :class="[
        'fixed inset-0 z-[400] flex items-center justify-center transition-opacity duration-300',
        isFunnelModalOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
      ]"
    >
      <!-- Backdrop -->
      <div
        class="absolute inset-0 bg-black/30 backdrop-blur-sm"
        @click="isFunnelModalOpen = false"
      ></div>

      <!-- Modal Content -->
      <div
        :class="[
          'relative w-full max-w-4xl max-h-[85vh] bg-white rounded-2xl shadow-2xl flex flex-col mx-4 md:mx-auto transition-transform duration-300 delay-75',
          isFunnelModalOpen ? 'scale-100 translate-y-0' : 'scale-95 translate-y-4',
        ]"
      >
        <div
          class="flex items-center justify-between px-6 py-5 border-b border-gray-100 flex-shrink-0"
        >
          <div class="flex items-center gap-3">
            <div
              class="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center text-[#0071E3]"
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
                <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
                <polyline points="16 7 22 7 22 13" />
              </svg>
            </div>
            <div>
              <h3 class="text-[18px] font-bold text-[#111827] font-outfit"
                >{{ selectedFunnelStage?.label || '' }}阶段 - 数据下钻</h3
              >
              <p class="text-[13px] text-[#6B7280] mt-0.5">查看各层级在当前链路节点的转化情况</p>
            </div>
          </div>
          <button
            @click="isFunnelModalOpen = false"
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
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div class="flex-1 p-6 overflow-hidden flex flex-col min-h-0 bg-[#F9FAFB]/50 rounded-b-2xl">
          <div class="flex flex-col mb-4 gap-3 flex-shrink-0">
            <div>
              <h3
                class="text-[16px] leading-[1.3] font-semibold text-[#111827] flex items-center flex-wrap gap-2"
              >
                <span
                  @click="fmGoToBreadcrumb('root')"
                  :class="[
                    'cursor-pointer transition-colors duration-200',
                    fmSelectedRTM3 ? 'text-[#86868B] hover:text-[#0071E3]' : 'text-[#111827]',
                  ]"
                  >全局大盘</span
                >
                <template v-if="fmSelectedRTM3">
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
                    class="text-[#86868B] flex-shrink-0"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                  <span
                    @click="fmGoToBreadcrumb('rtm3')"
                    :class="[
                      'transition-colors duration-200',
                      fmSelectedRTM4
                        ? 'text-[#86868B] hover:text-[#0071E3] cursor-pointer'
                        : 'text-[#111827]',
                    ]"
                    >{{ fmSelectedRTM3 }}</span
                  >
                </template>
                <template v-if="fmSelectedRTM4">
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
                    class="text-[#86868B] flex-shrink-0"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                  <span
                    @click="fmGoToBreadcrumb('rtm4')"
                    :class="[
                      'transition-colors duration-200',
                      fmSelectedDealer
                        ? 'text-[#86868B] hover:text-[#0071E3] cursor-pointer'
                        : 'text-[#111827]',
                    ]"
                    >{{ fmSelectedRTM4 }}</span
                  >
                </template>
                <template v-if="fmSelectedDealer">
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
                    class="text-[#86868B] flex-shrink-0"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                  <span class="text-[#111827]">{{ fmSelectedDealer }}</span>
                </template>
              </h3>
              <p class="text-[12px] text-[#86868B] mt-1">
                {{
                  fmSelectedRTM3
                    ? '已下钻至: ' +
                      (fmSelectedDealer ? '门店' : fmSelectedRTM4 ? '经销商' : 'RTM4')
                    : '点击行项可向下钻取数据'
                }}
              </p>
            </div>
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div
                class="flex items-center bg-gray-100/80 p-1 rounded-lg flex-shrink-0 overflow-x-auto"
              >
                <button
                  v-for="dim in fmAvailableDimensions"
                  :key="dim.value"
                  @click="fmChangeDimension(dim.value)"
                  :class="[                    'px-4 py-1.5 text-[13px] font-semibold rounded-md transition-all duration-200 whitespace-nowrap',
                    fmCurrentDimension === dim.value
                      ? 'bg-white text-[#111827] shadow-sm'
                      : 'text-[#6B7280] hover:text-[#111827]',
                  ]"
                >
                  {{ dim.label }}
                </button>
              </div>
              <div class="relative flex-1 sm:max-w-[240px]">
                <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#9CA3AF"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                </div>
                <input
                  v-model="fmSearchQuery"
                  type="text"
                  placeholder="搜索名称..."
                  class="w-full h-9 pl-9 pr-3 text-[13px] text-[#111827] bg-white border border-gray-200 focus:border-[#0071E3] focus:ring-1 focus:ring-[#0071E3] rounded-lg outline-none transition-all duration-200 shadow-sm"
                />
              </div>
            </div>
          </div>

          <div
            class="border border-[#E5E5E7] bg-white rounded-xl overflow-hidden flex-1 flex flex-col shadow-sm relative"
          >
            <!-- Loading Overlay -->
            <div
              v-if="fmTableLoading"
              class="absolute inset-0 z-50 flex items-center justify-center bg-white/60 backdrop-blur-sm"
            >
              <div
                class="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"
              ></div>
            </div>
            <div class="overflow-y-auto flex-1">
              <table class="w-full border-collapse relative">
                <thead class="sticky top-0 z-10 bg-[#FAFAFA] shadow-[0_1px_0_#E5E5E7]">
                  <tr>
                    <th
                      class="w-40 text-left py-3 px-6 text-[13px] font-medium text-[#6E6E73] whitespace-nowrap"
                      >{{ fmDimensionLabel }}名称</th
                    >
                    <th
                      class="w-32 text-right py-3 px-6 text-[13px] font-medium text-[#6E6E73] cursor-pointer hover:text-[#111827] select-none"
                      @click="fmHandleSort('total')"
                      ><div class="flex items-center justify-end">大盘总人数</div></th
                    >
                    <th
                      class="w-32 text-right py-3 px-6 text-[13px] font-medium text-[#6E6E73] cursor-pointer hover:text-[#111827] select-none"
                      @click="fmHandleSort('count')"
                      ><div class="flex items-center justify-end"
                        >{{ selectedFunnelStage?.label || '' }}人数</div
                      ></th
                    >
                    <th
                      class="w-32 text-right py-3 px-6 text-[13px] font-medium text-[#6E6E73] cursor-pointer hover:text-[#111827] select-none"
                      @click="fmHandleSort('rate')"
                      ><div class="flex items-center justify-end"
                        >{{ selectedFunnelStage?.label || '' }}率</div
                      ></th
                    >
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="fmGroupedData.length === 0 && !fmTableLoading">
                    <td colspan="4" class="py-12 text-center text-[13px] text-[#86868B]"
                      >暂无匹配数据</td
                    >
                  </tr>
                  <tr
                    v-for="(item, index) in fmGroupedData"
                    :key="index"
                    @click="fmCurrentDimension !== 'store' && fmHandleDrillDown(item)"
                    :class="[
                      'border-b border-gray-50 transition-colors duration-150',
                      fmCurrentDimension !== 'store'
                        ? 'cursor-pointer hover:bg-blue-50/30'
                        : 'hover:bg-gray-50/50',
                    ]"
                  >
                    <td
                      class="w-40 py-3.5 px-6 text-[14px] font-semibold text-[#111827] truncate max-w-[160px]"
                      :title="item.name"
                    >
                      <div class="flex items-center gap-1.5">
                        {{ item.name }}
                        <svg
                          v-if="fmCurrentDimension !== 'store'"
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          class="text-[#9CA3AF] flex-shrink-0"
                        >
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </div>
                    </td>
                    <td class="py-3.5 px-6 text-right text-[14px] text-[#6B7280]">{{
                      (item.total || 0).toLocaleString()
                    }}</td>
                    <td class="py-3.5 px-6 text-right text-[14px] font-bold text-[#111827]">{{
                      (item.count || 0).toLocaleString()
                    }}</td>
                    <td
                      class="py-3.5 px-6 text-right text-[14px] font-medium"
                      :style="{
                        color:
                          item.rate < 0.3 ? '#FF3B30' : item.rate < 0.6 ? '#FF9500' : '#34C759',
                      }"
                    >
                      {{ (item.rate * 100).toFixed(1) }}%
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Alert Modal -->
    <div
      v-if="isAlertModalOpen"
      :class="[
        'fixed inset-0 z-[400] flex items-center justify-center transition-opacity duration-300',
        isAlertModalOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
      ]"
    >
      <!-- Backdrop -->
      <div
        class="absolute inset-0 bg-black/30 backdrop-blur-sm"
        @click="isAlertModalOpen = false"
      ></div>

      <!-- Modal Content -->
      <div
        :class="[
          'relative w-full max-w-5xl max-h-[85vh] bg-white rounded-2xl shadow-2xl flex flex-col mx-4 md:mx-auto transition-transform duration-300 delay-75',
          isAlertModalOpen ? 'scale-100 translate-y-0' : 'scale-95 translate-y-4',
        ]"
      >
        <div
          class="flex items-center justify-between px-6 py-5 border-b border-gray-100 flex-shrink-0"
        >
          <div class="flex items-center gap-3">
            <div
              class="w-8 h-8 rounded-full flex items-center justify-center"
              :style="{ backgroundColor: amLevelColors.bg }"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                :stroke="amLevelColors.text"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path
                  d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"
                />
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
              </svg>
            </div>
            <div>
              <h3 class="text-[18px] font-bold text-[#111827] font-outfit">
                <span v-if="alertFilter === 'Unfinished'">未完成人员 明细</span>
                <span v-else>{{ alertFilter }} 预警明细</span>
              </h3>
              <p class="text-[13px] text-[#6B7280] mt-0.5"
                >查看该风险层级下的具体受影响人员及门店明细</p
              >
            </div>
          </div>
          <button
            @click="isAlertModalOpen = false"
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
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div class="flex-1 p-6 overflow-hidden flex flex-col min-h-0 bg-[#F9FAFB]/50 rounded-b-2xl">
          <div v-if="alerts && alerts.alerts && alertFilter" class="flex flex-col flex-1 min-h-0">
            <div class="flex flex-col mb-4 gap-3 flex-shrink-0">
              <div>
                <h3
                  class="text-[16px] leading-[1.3] font-semibold text-[#111827] flex items-center flex-wrap gap-2"
                >
                  <span
                    @click="amGoToBreadcrumb('root')"
                    :class="[
                      'cursor-pointer transition-colors duration-200',
                      amSelectedRTM3 ? 'text-[#86868B] hover:text-[#0071E3]' : 'text-[#111827]',
                    ]"
                    >全局大盘</span
                  >
                  <template v-if="amSelectedRTM3">
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
                      class="text-[#86868B] flex-shrink-0"
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                    <span
                      @click="amGoToBreadcrumb('rtm3')"
                      :class="[
                        'transition-colors duration-200',
                        amSelectedRTM4
                          ? 'text-[#86868B] hover:text-[#0071E3] cursor-pointer'
                          : 'text-[#111827]',
                      ]"
                      >{{ amSelectedRTM3 }}</span
                    >
                  </template>
                  <template v-if="amSelectedRTM4">
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
                      class="text-[#86868B] flex-shrink-0"
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                    <span
                      @click="amGoToBreadcrumb('rtm4')"
                      :class="[
                        'transition-colors duration-200',
                        amSelectedDealer
                          ? 'text-[#86868B] hover:text-[#0071E3] cursor-pointer'
                          : 'text-[#111827]',
                      ]"
                      >{{ amSelectedRTM4 }}</span
                    >
                  </template>
                  <template v-if="amSelectedDealer">
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
                      class="text-[#86868B] flex-shrink-0"
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                    <span class="text-[#111827]">{{ amSelectedDealer }}</span>
                  </template>
                </h3>
                <p class="text-[12px] text-[#86868B] mt-1">
                  {{
                    amSelectedRTM3
                      ? '已下钻至: ' +
                        (amSelectedDealer ? '门店' : amSelectedRTM4 ? '经销商' : 'RTM4')
                      : '点击行项可向下钻取数据'
                  }}
                </p>
              </div>
              <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div
                  class="flex items-center bg-gray-100/80 p-1 rounded-lg flex-shrink-0 overflow-x-auto"
                >
                  <button
                    v-for="dim in amAvailableDimensions"
                    :key="dim.value"
                    @click="amChangeDimension(dim.value)"
                    :class="[                      'px-3 py-1.5 text-[12px] font-semibold rounded-md transition-all duration-200 whitespace-nowrap',
                      amCurrentDimension === dim.value
                        ? 'bg-white text-[#111827] shadow-sm'
                        : 'text-[#6B7280] hover:text-[#111827]',
                    ]"
                  >
                    {{ dim.label }}
                  </button>
                </div>
                <div class="relative flex-1 min-w-[120px] max-w-[200px]">
                  <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#9CA3AF"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                  </div>
                  <input
                    v-model="amSearchQuery"
                    type="text"
                    placeholder="搜索名称..."
                    class="w-full h-8 pl-9 pr-3 text-[13px] text-[#111827] bg-gray-100/80 border border-transparent focus:border-[#0071E3] focus:bg-white rounded-md outline-none transition-all duration-200"
                  />
                </div>
              </div>
            </div>

            <div
              v-if="amDisplayedAlerts.length > 0 || amTableLoading"
              class="border border-[#E5E5E7] rounded-xl overflow-hidden overflow-x-auto flex flex-col flex-1 min-h-0 relative"
            >
              <!-- Loading Overlay -->
              <div
                v-if="amTableLoading"
                class="absolute inset-0 z-50 flex items-center justify-center bg-white/60 backdrop-blur-sm"
              >
                <div
                  class="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"
                ></div>
              </div>
              <div class="overflow-y-auto max-h-full pr-1 flex-1">
                <table class="w-full border-collapse relative">
                  <thead class="sticky top-0 z-10 bg-[#FAFAFA] shadow-[0_1px_0_#E5E5E7]">
                    <tr class="border-b border-[#E5E5E7]">
                      <th class="w-12 text-center py-3 text-[13px] font-medium text-[#6E6E73]"
                        >级别</th
                      >
                      <th
                        class="w-32 text-left py-3 px-4 text-[13px] font-medium text-[#6E6E73] whitespace-nowrap"
                        >{{ amDimensionLabel }}</th
                      >
                      <th
                        class="w-20 text-right py-3 px-4 text-[13px] font-medium text-[#6E6E73] cursor-pointer hover:text-[#111827] select-none"
                        @click="amHandleSort('total_employees')"
                        ><div class="flex items-center justify-end">总人数</div></th
                      >
                      <th
                        class="w-20 text-right py-3 px-4 text-[13px] font-medium text-[#6E6E73] cursor-pointer hover:text-[#111827] select-none"
                        @click="amHandleSort('completed_count')"
                        ><div class="flex items-center justify-end">已完成</div></th
                      >
                      <th
                        class="w-24 text-right py-3 px-4 text-[13px] font-medium text-[#6E6E73] cursor-pointer hover:text-[#111827] select-none whitespace-nowrap"
                        @click="amHandleSort('risk_count')"
                        ><div class="flex items-center justify-end">预警人数</div></th
                      >
                      <th
                        v-if="alertFilter === 'P0'"
                        class="w-36 whitespace-nowrap text-right py-3 px-4 text-[13px] font-medium text-[#6E6E73] cursor-pointer hover:text-[#111827] select-none"
                        @click="amHandleSort('risk_rate')"
                        ><div class="flex items-center justify-end">临期危机(P0)率</div></th
                      >
                      <th
                        v-else-if="alertFilter === 'P1'"
                        class="w-36 whitespace-nowrap text-right py-3 px-4 text-[13px] font-medium text-[#6E6E73] cursor-pointer hover:text-[#111827] select-none"
                        @click="amHandleSort('risk_rate')"
                        ><div class="flex items-center justify-end">临期危机(P1)率</div></th
                      >
                      <th
                        v-else-if="alertFilter === 'P2'"
                        class="w-36 whitespace-nowrap text-right py-3 px-4 text-[13px] font-medium text-[#6E6E73] cursor-pointer hover:text-[#111827] select-none"
                        @click="amHandleSort('risk_rate')"
                        ><div class="flex items-center justify-end">起步异常率</div></th
                      >
                      <th
                        v-else
                        class="w-36 whitespace-nowrap text-right py-3 px-4 text-[13px] font-medium text-[#6E6E73] cursor-pointer hover:text-[#111827] select-none"
                        @click="amHandleSort('risk_rate')"
                        ><div class="flex items-center justify-end">未完成率</div></th
                      >
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="alert in amDisplayedAlerts"
                      :key="alert.alert_id"
                      @click="amCurrentDimension !== 'store' && amHandleDrillDown(alert)"
                      :class="[
                        'border-b border-gray-50 transition-colors duration-200',
                        amCurrentDimension !== 'store'
                          ? 'cursor-pointer hover:bg-blue-50/30'
                          : 'hover:bg-gray-50/50',
                      ]"
                    >
                      <td
                        :class="[
                          'text-center py-4',
                          alert.level === 'P0' || alert.level === 'P1' || alert.level === 'P2'
                            ? 'relative'
                            : '',
                        ]"
                      >
                        <span
                          v-if="alert.level === 'P0'"
                          class="absolute left-0 top-0 bottom-0 w-0.5 bg-[#FF3B30]"
                        ></span>
                        <span
                          v-else-if="alert.level === 'P1'"
                          class="absolute left-0 top-0 bottom-0 w-0.5 bg-[#FF9500]"
                        ></span>
                        <span
                          v-else-if="alert.level === 'P2'"
                          class="absolute left-0 top-0 bottom-0 w-0.5 bg-[#FFCC00]"
                        ></span>
                        <span
                          v-else
                          class="absolute left-0 top-0 bottom-0 w-0.5 bg-[#86868B]"
                        ></span>
                        <div
                          class="w-2 h-2 rounded-full mx-auto shadow-sm"
                          :style="{
                            backgroundColor:
                              alert.level === 'P0'
                                ? '#FF3B30'
                                : alert.level === 'P1'
                                ? '#FF9500'
                                : alert.level === 'P2'
                                ? '#FFCC00'
                                : '#86868B',
                          }"
                        ></div>
                      </td>
                      <td
                        class="w-32 py-4 px-4 text-[14px] font-semibold text-[#111827] truncate max-w-[128px]"
                        :title="alert.entity_name"
                      >
                        <div class="flex items-center gap-1">
                          {{ alert.entity_name }}
                          <svg
                            v-if="amCurrentDimension !== 'store'"
                            xmlns="http://www.w3.org/2000/svg"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            class="text-[#9CA3AF] flex-shrink-0"
                          >
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </div>
                      </td>
                      <td class="py-4 px-4 text-right text-[14px] text-[#6B7280]">{{
                        (alert.total_employees || 0).toLocaleString()
                      }}</td>
                      <td class="py-4 px-4 text-right text-[14px] font-bold text-[#111827]">{{
                        (alert.completed_count || 0).toLocaleString()
                      }}</td>
                      <td class="py-4 px-4 text-right text-[14px] font-bold"
                          :style="{ color: alert.total_employees - alert.completed_count > 0 ? '#FF3B30' : '#111827' }">
                        {{ ((alert.total_employees || 0) - (alert.completed_count || 0)).toLocaleString() }}
                      </td>
                      <td
                        class="py-4 px-4 text-right text-[14px] font-medium"
                        :style="{
                          color:
                            alert.risk_rate > 0.5
                              ? '#FF3B30'
                              : alert.risk_rate > 0.2
                              ? '#FF9500'
                              : '#34C759',
                        }"
                      >
                        {{ (alert.risk_rate * 100).toFixed(1) }}%
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div
              v-else-if="!amTableLoading"
              class="flex-1 flex flex-col items-center justify-center min-h-[300px] bg-white rounded-xl border border-[#E5E5E7]"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#D1D1D6"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                style="margin-bottom: 12px"
              >
                <path
                  d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"
                />
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
              </svg>
              <span class="text-[14px]">暂无 {{ alertFilter }} 级别预警数据</span>
            </div>

            <button
              v-if="amGroupedAlerts.length > 10 && !amShowMore"
              @click="amShowMore = true"
              class="w-full mt-4 py-3 rounded-lg border border-gray-100 bg-gray-50/50 text-[13px] text-[#0071E3] font-semibold hover:bg-gray-100 transition-colors duration-200"
            >
              查看更多 ({{ amGroupedAlerts.length - 10 }} 条)
            </button>
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
