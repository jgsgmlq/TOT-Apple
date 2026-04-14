<template>
  <div class="hq-board">
    <!-- 头部：标题与功能概述 + 已布置任务入口 -->
    <header class="board-header">
      <div class="board-header-main">
        <h1 class="title">实时任务看板</h1>
        <p class="desc">集中监控和管理总部下发的所有终端任务，实时追踪各门店执行进度与关键指标。</p>
      </div>
      <div class="board-header-actions">
        <n-space align="center">
          <n-button type="primary" secondary @click="openDispatchedTasksDialog">
            <template #icon>
              <n-icon><UnorderedListOutlined /></n-icon>
            </template>
            已布置的任务
          </n-button>
          <n-button type="primary" secondary @click="openAlertRulesDialog">
            <template #icon>
              <n-icon><AlertOutlined /></n-icon>
            </template>
            统一预警规则
          </n-button>
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-button
                quaternary
                circle
                class="hq-ai-robot-btn"
                aria-label="AI洞察"
                @click="openAiInsightWithAnalysis"
              >
                <img :src="aiWatchIcon" alt="" class="hq-ai-robot-img" />
              </n-button>
            </template>
            AI洞察
          </n-tooltip>
        </n-space>
      </div>
    </header>

    <n-drawer
      v-model:show="showAiInsightDrawer"
      :width="472"
      placement="right"
      :trap-focus="false"
      content-class="hq-ai-floating-panel"
      class="hq-ai-insight-drawer"
    >
      <n-drawer-content
        closable
        :native-scrollbar="true"
        class="hq-ai-drawer-content"
        body-class="hq-ai-drawer-body"
        body-content-class="hq-ai-drawer-body-inner"
        :body-content-style="{
          padding: 0,
          height: '100%',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
        }"
        header-class="hq-ai-drawer-header-wrap"
      >
        <template #header>
          <div class="hq-ai-drawer-header">
            <div class="hq-ai-drawer-header-brand">
              <div class="hq-ai-drawer-header-avatar">
                <n-icon size="28" color="#2563eb" class="hq-ai-header-icon"
                  ><RobotOutlined
                /></n-icon>
              </div>
              <div class="hq-ai-drawer-header-titles">
                <span class="hq-ai-drawer-header-title">AI 洞察</span>
                <span class="hq-ai-drawer-header-sub">看板数据 · 智能解读</span>
              </div>
            </div>
          </div>
        </template>

        <div class="hq-ai-insight-body">
          <div ref="aiInsightChatRef" class="hq-ai-insight-messages custom-scroll-ai">
            <div v-if="aiInsightMessages.length === 0" class="hq-ai-insight-empty">
              <div class="hq-ai-insight-empty-card">
                <p class="hq-ai-insight-kicker">智能助手</p>
                <h3 class="hq-ai-insight-hi">Hi，{{ hqDisplayName }}</h3>
                <p class="hq-ai-insight-desc">
                  基于当前看板，可解读完成率、区域对比与链路触达；试试下方快捷问题。
                </p>
                <div class="hq-ai-insight-presets">
                  <button
                    v-for="(q, i) in aiInsightPresets"
                    :key="i"
                    type="button"
                    class="hq-ai-preset-chip"
                    @click="triggerPresetQuestion(q)"
                  >
                    {{ q }}
                  </button>
                </div>
              </div>
            </div>
            <div
              v-for="(msg, idx) in aiInsightMessages"
              :key="idx"
              class="hq-ai-msg-row"
              :class="msg.role === 'user' ? 'is-user' : 'is-ai'"
            >
              <div class="hq-ai-msg-avatar">
                <template v-if="msg.role === 'user'">
                  <div class="hq-ai-user-avatar">{{ hqAvatarLetter }}</div>
                </template>
                <template v-else>
                  <div class="hq-ai-bot-icon">
                    <n-icon size="18" color="#2563eb"><ColorWandOutline /></n-icon>
                  </div>
                </template>
              </div>
              <div class="hq-ai-msg-bubble">{{ msg.content }}</div>
            </div>
          </div>

          <div class="hq-ai-insight-footer">
            <div class="hq-ai-insight-composer">
              <n-input
                v-model:value="aiInsightInput"
                type="textarea"
                placeholder="问问当前任务或指标…"
                :autosize="{ minRows: 2, maxRows: 5 }"
                class="hq-ai-insight-input"
                @keydown="onAiInsightKeydown"
              />
              <n-button
                type="primary"
                round
                :disabled="!aiInsightInput.trim()"
                class="hq-ai-insight-send"
                @click="handleAiInsightSend"
              >
                发送
              </n-button>
            </div>
            <p class="hq-ai-insight-tip">AI 生成内容仅供参考，请结合业务实际情况判断。</p>
          </div>
        </div>
      </n-drawer-content>
    </n-drawer>

    <!-- 已下发任务列表（瀑布流） -->
    <n-modal
      v-model:show="showDispatchedListModal"
      preset="card"
      title="已布置的任务"
      :style="{ width: 'min(580px, 94vw)', maxHeight: '78vh' }"
      :segmented="{ content: 'soft', footer: 'soft' }"
      class="hq-dispatched-modal"
    >
      <div class="hq-dispatched-body">
        <n-spin :show="dispatchedListLoading">
          <n-empty
            v-if="!dispatchedListLoading && dispatchedTasksOnly.length === 0"
            description="暂无已下发的任务"
          />
          <div v-else class="hq-waterfall-list">
            <div
              v-for="task in dispatchedTasksOnly"
              :key="task.id"
              class="hq-waterfall-card"
              :class="{ 'is-expanded': expandedDispatchedTaskId === task.id }"
            >
              <div class="hq-wf-summary" @click="toggleDispatchedTaskDetail(task.id)">
                <div class="hq-wf-head">
                  <span class="hq-wf-tag">已下发</span>
                  <n-icon
                    class="hq-wf-chevron"
                    :class="{ 'is-open': expandedDispatchedTaskId === task.id }"
                  >
                    <DownOutlined />
                  </n-icon>
                </div>
                <h3 class="hq-wf-title">{{ task.name }}</h3>
                <p class="hq-wf-meta">截止：{{ task.deadline }}</p>
                <p v-if="task.createdAtLabel" class="hq-wf-time">{{ task.createdAtLabel }}</p>
                <p class="hq-wf-hint">
                  {{ expandedDispatchedTaskId === task.id ? '点击收起' : '点击展开查看详情' }}
                </p>
              </div>

              <div v-show="expandedDispatchedTaskId === task.id" class="hq-wf-expand" @click.stop>
                <n-spin :show="detailLoadingTaskId === task.id">
                  <div v-if="taskDetailById[task.id]" class="hq-detail-inner">
                    <n-descriptions
                      label-placement="top"
                      :column="2"
                      bordered
                      size="small"
                      :label-style="{ color: '#6b7280' }"
                    >
                      <n-descriptions-item label="任务名称" :span="2">
                        {{ taskDetailById[task.id].title }}
                      </n-descriptions-item>
                      <n-descriptions-item label="开始时间" :span="1">
                        {{ formatHqDetailTime(taskDetailById[task.id].startAt) }}
                      </n-descriptions-item>
                      <n-descriptions-item label="截止时间" :span="1">
                        {{ formatHqDetailTime(taskDetailById[task.id].ddlAt) }}
                      </n-descriptions-item>
                      <n-descriptions-item label="达标分数" :span="1">
                        {{ taskDetailById[task.id].passScore ?? 100 }} 分
                      </n-descriptions-item>
                      <n-descriptions-item label="状态" :span="1">
                        <n-tag type="success" size="small" :bordered="false">已下发</n-tag>
                      </n-descriptions-item>
                      <n-descriptions-item label="学习平台" :span="2">
                        <n-space size="small">
                          <n-tag
                            v-if="taskDetailById[task.id].hasMypal"
                            :bordered="false"
                            type="info"
                            size="small"
                            >MyPal</n-tag
                          >
                          <n-tag
                            v-if="taskDetailById[task.id].hasSmartSell"
                            :bordered="false"
                            type="info"
                            size="small"
                            >Sales Coach</n-tag
                          >
                          <n-tag
                            v-if="taskDetailById[task.id].hasAiDemo"
                            :bordered="false"
                            type="info"
                            size="small"
                            >AI Coach</n-tag
                          >
                          <n-tag
                            v-if="taskDetailById[task.id].hasLiveBroadcast"
                            :bordered="false"
                            type="info"
                            size="small"
                            >直播培训</n-tag
                          >
                        </n-space>
                      </n-descriptions-item>
                    </n-descriptions>
                    <div class="hq-detail-desc-block">
                      <div class="hq-detail-desc-label">任务说明</div>
                      <div class="hq-detail-desc-text">{{
                        taskDetailById[task.id].description || '总部未填写详细说明'
                      }}</div>
                    </div>
                    <n-button
                      type="primary"
                      block
                      class="hq-detail-edit-btn"
                      @click.stop="goEditDispatchedTask(task.id)"
                    >
                      前往任务管理编辑
                    </n-button>
                  </div>
                </n-spin>
              </div>
            </div>
          </div>
        </n-spin>
      </div>
    </n-modal>

    <!-- 统一任务预警规则 -->
    <n-modal
      v-model:show="showAlertRulesModal"
      preset="card"
      title="统一预警规则"
      :style="{ width: 'min(480px, 90vw)', maxHeight: '80vh' }"
      :segmented="{ content: 'soft', footer: 'soft' }"
      class="hq-rules-modal"
    >
      <div
        class="hq-rules-body static-rules"
        style="padding: 16px 8px; font-size: 14px; color: #374151; line-height: 1.6"
      >
        <p style="margin-bottom: 24px; color: #6b7280; font-size: 13px">
          总部已针对所有培训任务应用以下统一预警标准，暂不支持针对单个任务进行修改。
        </p>

        <div class="hq-rule-block" style="margin-bottom: 20px">
          <div
            class="hq-rule-block-title"
            style="font-weight: 600; font-size: 15px; margin-bottom: 8px; color: #111827"
          >
            进度掉队预警
            <n-tag
              size="small"
              type="info"
              :bordered="false"
              style="margin-left: 6px; font-weight: normal"
              >仅 Monobrand</n-tag
            >
          </div>
          <p
            class="hq-rule-line"
            style="margin: 0 0 4px 12px; display: flex; align-items: center; gap: 8px"
          >
            <span style="color: #f59e0b; font-size: 18px">•</span> Lifestyle：个人完成率处于门店最后
            <strong>3</strong> 位
          </p>
          <p
            class="hq-rule-line"
            style="margin: 0 0 4px 12px; display: flex; align-items: center; gap: 8px"
          >
            <span style="color: #f59e0b; font-size: 18px">•</span> Mono：个人完成率处于门店最后
            <strong>1</strong> 位
          </p>
        </div>

        <div class="hq-rule-block" style="margin-bottom: 20px">
          <div
            class="hq-rule-block-title"
            style="font-weight: 600; font-size: 15px; margin-bottom: 8px; color: #111827"
            >起步异常预警</div
          >
          <p
            class="hq-rule-line"
            style="margin: 0 0 4px 12px; display: flex; align-items: center; gap: 8px"
          >
            <span style="color: #ef4444; font-size: 18px">•</span> 任务期限已度过
            <strong>50</strong>%，但个人进度仍为 0%
          </p>
        </div>

        <div class="hq-rule-block" style="margin-bottom: 20px">
          <div
            class="hq-rule-block-title"
            style="font-weight: 600; font-size: 15px; margin-bottom: 8px; color: #111827"
            >临期危机预警 (Deadline)</div
          >
          <p
            class="hq-rule-line"
            style="margin: 0 0 4px 12px; display: flex; align-items: center; gap: 8px"
          >
            <span style="color: #ef4444; font-size: 18px">•</span> 距 Deadline 不足
            <strong>24</strong> 小时，仍未完成 (P0 级)
          </p>
          <p
            class="hq-rule-line"
            style="margin: 0 0 4px 12px; display: flex; align-items: center; gap: 8px"
          >
            <span style="color: #f97316; font-size: 18px">•</span> 距 Deadline 不足
            <strong>48</strong> 小时，仍未完成 (P1 级)
          </p>
        </div>
      </div>
    </n-modal>

    <!-- 下钻详情列表弹窗 (门店明细) -->
    <n-modal
      v-model:show="showDrillDownModal"
      preset="card"
      :title="drillDownTitle"
      :style="{ width: 'min(640px, 94vw)', maxHeight: '80vh' }"
      :segmented="{ content: 'soft', footer: 'soft' }"
      class="hq-drilldown-modal"
    >
      <n-spin :show="drillDownLoading">
        <div
          class="drilldown-body custom-scroll"
          style="max-height: 60vh; overflow-y: auto; padding: 4px"
        >
          <n-empty
            v-if="!drillDownLoading && drillDownList.length === 0"
            description="暂无符合条件的门店记录"
          />

          <div v-else class="drilldown-list">
            <!-- 列表项：每一行代表一个门店 -->
            <div
              v-for="item in drillDownList"
              :key="item.storeId"
              class="dd-item"
              style="
                display: flex;
                align-items: center;
                padding: 16px;
                border-bottom: 1px solid #f3f4f6;
                transition: background 0.2s;
              "
            >
              <!-- 1. 🧍‍♂️ 图标与门店名称 -->
              <div
                class="dd-col-info"
                style="flex: 1; display: flex; align-items: center; gap: 12px"
              >
                <div
                  class="dd-avatar"
                  style="
                    background: #f5f5f7;
                    width: 36px;
                    height: 36px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: #86868b;
                  "
                >
                  <n-icon size="20"><UserOutlined /></n-icon>
                </div>
                <div style="display: flex; flex-direction: column">
                  <span style="font-weight: 600; color: #1d1d1f; font-size: 14px">{{
                    item.storeName
                  }}</span>
                  <span style="font-size: 12px; color: #86868b">ID: {{ item.storeId }}</span>
                </div>
              </div>

              <!-- 2. 进度信息 -->
              <div class="dd-col-progress" style="width: 240px; text-align: right">
                <div
                  style="
                    margin-bottom: 4px;
                    display: flex;
                    justify-content: space-between;
                    align-items: baseline;
                  "
                >
                  <span style="font-size: 12px; color: #6b7280">
                    已完成: <strong>{{ item.completedCount }}</strong> /
                    {{ item.assignmentCount || item.totalCount }}
                  </span>
                  <span style="font-weight: 700; color: #0071e3; font-size: 15px"
                    >{{ formatPct2(item.completionRate) }}%</span
                  >
                </div>
                <n-progress
                  type="line"
                  :percentage="pctForBar(item.completionRate)"
                  :indicator-placement="'hide'"
                  :color="item.completionRate >= 100 ? '#34c759' : '#0071e3'"
                  processing
                  style="height: 8px"
                />
                <!-- 预警模式下额外显示逾期数 -->
                <div
                  v-if="drillDownType === 'warning' && item.overdueCount > 0"
                  style="margin-top: 4px; font-size: 11px; color: #ef4444"
                >
                  ⚠️ {{ item.overdueCount }} 人已逾期
                </div>
              </div>
            </div>
          </div>
        </div>
      </n-spin>
      <template #footer>
        <div style="text-align: right; color: #86868b; font-size: 12px">
          * 数据更新于 {{ formatOverviewTime(activeTask?.overviewSummary?.updatedAt) }}
        </div>
      </template>
    </n-modal>

    <!-- 任务导航栏 -->
    <section class="task-nav-section" v-if="taskList.length > 0">
      <div class="task-list">
        <div
          v-for="task in taskList"
          :key="task.id"
          class="task-card"
          :class="{ 'is-active': activeTaskId === task.id }"
          @click="selectTask(task.id)"
        >
          <div class="task-card-header">
            <span class="task-name" :title="task.name">{{ task.name }}</span>
            <div class="header-right">
              <n-tag :type="task.statusType" size="small" :bordered="false" class="status-tag">{{
                task.statusText
              }}</n-tag>
              <n-button
                quaternary
                circle
                size="tiny"
                class="action-btn edit-btn"
                @click.stop="
                  $router.push({ path: '/central/task/publish', query: { id: task.id } })
                "
              >
                <template #icon>
                  <n-icon size="14"><EditOutlined /></n-icon>
                </template>
              </n-button>
              <n-button
                quaternary
                circle
                size="tiny"
                class="action-btn del-btn"
                @click.stop="handleDeleteTask(task.id, task.name)"
              >
                <template #icon>
                  <n-icon size="14"><CloseOutlined /></n-icon>
                </template>
              </n-button>
            </div>
          </div>
          <div class="task-card-time">截止: {{ task.deadline }}</div>
        </div>
      </div>
    </section>

    <div v-else class="empty-board">
      <n-empty description="暂无任何培训任务，请先前往左侧【任务管理】发布任务">
        <template #extra>
          <n-button type="primary" @click="$router.push('/central/task/publish')"
            >去发布任务</n-button
          >
        </template>
      </n-empty>
    </div>

    <!-- 替换原“运行预警扫描”：新增页面级别的自动 AI 洞察框 -->
    <section
      v-if="taskList.length > 0 && activeTask?.dispatched"
      class="ai-auto-insight-bar"
      style="margin: 0 0px 16px"
    >
      <n-collapse :default-expanded-names="['1']" :key="activeTask.id">
        <n-collapse-item name="1" style="border-top: none">
          <template #header>
            <div
              style="
                font-size: 14px;
                font-weight: 400;
                color: rgb(62, 64, 66);
                letter-spacing: -0.3px;
                padding: 4px 0;
                font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue',
                  Helvetica, Arial, sans-serif;
              "
            >
              AI洞察
            </div>
          </template>
          <div
            style="
              white-space: pre-wrap;
              line-height: 1.6;
              font-size: 14px;
              color: #4b5563;
              background: #f5f5f7;
              padding: 16px 20px;
              border-radius: 12px;
              margin-top: 4px;
              margin-bottom: 8px;
            "
          >
            {{ autoAiInsightContent }}
          </div>
        </n-collapse-item>
      </n-collapse>
    </section>

    <!-- [原功能已注释] 手动触发预警扫描
    <section v-if="taskList.length > 0 && activeTask?.dispatched" class="auto-nudge-bar">
      <div class="auto-nudge-inner">
        <span class="auto-nudge-hint">
          根据「任务管理」中的预警规则扫描未完成学员并推送催办（店员端 WebSocket 实时通知）。
        </span>
        <n-button
          type="warning"
          secondary
          size="small"
          :loading="autoNudgeLoading"
          @click="handleTriggerAutoNudge"
        >
          <template #icon>
            <n-icon><BellOutlined /></n-icon>
          </template>
          运行预警扫描
        </n-button>
      </div>
    </section>
    -->

    <!-- 核心看板内容区（统计接口加载中） -->
    <section class="dashboard-content" v-if="activeTask">
      <n-spin :show="boardStatsLoading" class="board-stats-spin">
        <!-- 1. 概览 KPI（/dashboard/overview） -->
        <div class="north-star-container ai-hover-trigger" style="position: relative;">
          <!-- 智能分析浮动按钮 -->
          <div class="ai-hover-btn-container" style="position: absolute; right: 24px; top: 24px;">
            <n-popover
              trigger="click"
              placement="bottom"
              style="border-radius: 12px; padding: 16px; width: 320px; box-shadow: 0 8px 30px rgba(0,0,0,0.12);"
              @update:show="(v: boolean) => v && ensureBoardInsightOnOpen('northStar')"
            >
              <template #trigger>
                <n-button size="small" class="ai-analyze-btn">
                  <template #icon><n-icon><ColorWandOutline /></n-icon></template>
                  智能分析
                </n-button>
              </template>
              <div class="ai-analyze-content">
                <div class="ai-analyze-header">
                  <n-icon color="#0071e3" size="18"><ColorWandOutline /></n-icon>
                  <span style="font-weight: 600; margin-left: 6px; color: #1d1d1f; font-size: 15px;">智能分析</span>
                </div>
                <div class="ai-analyze-body custom-scroll-ai">
                  <n-spin :show="boardInsightCard.northStar.loading" size="small">
                    <div
                      v-if="!boardInsightCard.northStar.loading && !boardInsightCard.northStar.content"
                      class="ai-insight-md-empty"
                    >
                      暂无内容
                    </div>
                    <div
                      v-else-if="boardInsightCard.northStar.content"
                      class="ai-insight-md"
                      v-html="renderInsightMarkdown(boardInsightCard.northStar.content)"
                    />
                  </n-spin>
                </div>
              <div class="ai-analyze-actions">
                          <n-icon
                            size="16"
                            class="ai-action-icon"
                            :class="{ 'is-active-up': boardInsightCard.northStar.userVote === 'up' }"
                            @click="handleAiFeedback('northStar', 'up')"
                          ><LikeOutlined /></n-icon>
                          <span style="font-size: 12px; color: #9ca3af; min-width: 16px;">{{ boardInsightCard.northStar.up }}</span>
                          <n-icon
                            size="16"
                            class="ai-action-icon"
                            :class="{ 'is-active-down': boardInsightCard.northStar.userVote === 'down' }"
                            @click="handleAiFeedback('northStar', 'down')"
                          ><DislikeOutlined /></n-icon>
                          <span style="font-size: 12px; color: #9ca3af; min-width: 16px;">{{ boardInsightCard.northStar.down }}</span>
                          <n-icon size="16" class="ai-action-icon" style="transition: color 0.2s" @click="handleCopyAiInsight(boardInsightCard.northStar.content, 'northStar')"><CheckOutlined v-if="copiedStates['northStar']" style="color: #10b981;" /><CopyOutlined v-else /></n-icon>
                        </div>
                      </div>
            </n-popover>
          </div>

          <div class="ns-card">
            <div class="ns-label">按时完成率</div>
            <div class="ns-value highlight"
              >{{ formatPct2(activeTask.northStar.onTimeRate) }}<span class="unit">%</span></div
            >
            <div class="ns-sub">在 Deadline 前完成的人数 / 应完成总人数</div>
          </div>
          <div class="divider"></div>
          <div class="ns-card">
            <div class="ns-label">人均完成时间</div>
            <div class="ns-value"
              >{{ activeTask.northStar.avgTime }}<span class="unit">小时</span></div
            >
            <div class="ns-sub">已完成学员从任务创建到标记完成的平均耗时</div>
          </div>
        </div>

        <div v-if="activeTask.overviewSummary" class="overview-kpi-strip">
          <span class="kpi-chip"
            >总人数 <strong>{{ activeTask.overviewSummary.totalAssignments }}</strong></span
          >
          <span class="kpi-dot">·</span>
          <span class="kpi-chip"
            >已完成 <strong>{{ activeTask.overviewSummary.completedCount }}</strong></span
          >
          <span class="kpi-dot">·</span>
          <span class="kpi-chip"
            >进行中 <strong>{{ activeTask.overviewSummary.inProgressCount }}</strong></span
          >
          <span class="kpi-dot">·</span>
          <span class="kpi-chip"
            >待开始 <strong>{{ activeTask.overviewSummary.pendingCount }}</strong></span
          >
          <span class="kpi-dot">·</span>
          <span class="kpi-chip warn"
            >逾期 <strong>{{ activeTask.overviewSummary.overdueCount }}</strong></span
          >
          <span class="kpi-dot">·</span>
          <span class="kpi-chip"
            >推送覆盖 <strong>{{ activeTask.overviewSummary.pushUserCount }}</strong> 人</span
          >
          <span v-if="activeTask.overviewSummary.updatedAt" class="kpi-updated">
            更新 {{ formatOverviewTime(activeTask.overviewSummary.updatedAt) }}
          </span>
        </div>

        <!-- 2. 图表与区域拆解 -->
        <div class="middle-section">
          <!-- 趋势折线图 -->
          <n-card :bordered="false" class="chart-card ai-hover-trigger">
            <template #header>
              <div class="chart-card-head" style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                <div>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <div class="chart-title">完成人数趋势</div>
                    <div class="ai-hover-btn-container">
                      <n-popover
                        trigger="click"
                        placement="bottom"
                        style="border-radius: 12px; padding: 16px; width: 320px; box-shadow: 0 8px 30px rgba(0,0,0,0.12);"
                        @update:show="(v: boolean) => v && ensureBoardInsightOnOpen('trend')"
                      >
                        <template #trigger>
                          <n-button size="small" class="ai-analyze-btn">
                            <template #icon><n-icon><ColorWandOutline /></n-icon></template>
                            智能分析
                          </n-button>
                        </template>
                        <div class="ai-analyze-content">
                          <div class="ai-analyze-header">
                            <n-icon color="#0071e3" size="18"><ColorWandOutline /></n-icon>
                            <span style="font-weight: 600; margin-left: 6px; color: #1d1d1f; font-size: 15px;">智能分析</span>
                          </div>
                          <div class="ai-analyze-body custom-scroll-ai">
                            <n-spin :show="boardInsightCard.trend.loading" size="small">
                              <div
                                v-if="!boardInsightCard.trend.loading && !boardInsightCard.trend.content"
                                class="ai-insight-md-empty"
                              >
                                暂无内容
                              </div>
                              <div
                                v-else-if="boardInsightCard.trend.content"
                                class="ai-insight-md"
                                v-html="renderInsightMarkdown(boardInsightCard.trend.content)"
                              />
                            </n-spin>
                          </div>
                        <div class="ai-analyze-actions">
                          <n-icon
                            size="16"
                            class="ai-action-icon"
                            :class="{ 'is-active-up': boardInsightCard.trend.userVote === 'up' }"
                            @click="handleAiFeedback('trend', 'up')"
                          ><LikeOutlined /></n-icon>
                          <span style="font-size: 12px; color: #9ca3af; min-width: 16px;">{{ boardInsightCard.trend.up }}</span>
                          <n-icon
                            size="16"
                            class="ai-action-icon"
                            :class="{ 'is-active-down': boardInsightCard.trend.userVote === 'down' }"
                            @click="handleAiFeedback('trend', 'down')"
                          ><DislikeOutlined /></n-icon>
                          <span style="font-size: 12px; color: #9ca3af; min-width: 16px;">{{ boardInsightCard.trend.down }}</span>
                          <n-icon size="16" class="ai-action-icon" style="transition: color 0.2s" @click="handleCopyAiInsight(boardInsightCard.trend.content, 'trend')"><CheckOutlined v-if="copiedStates['trend']" style="color: #10b981;" /><CopyOutlined v-else /></n-icon>
                        </div>
                      </div>
                      </n-popover>
                    </div>
                  </div>
                  <div class="chart-sub">日维度为累计完成 · 时维度为所选日期的按小时完成</div>
                </div>
              </div>
            </template>
            <template #header-extra>
              <n-space align="center" :size="16">
                <!-- 下拉筛选任务周：仅在按天维度显示 -->
                <div
                  v-if="trendTimeDimension === 'day'"
                  style="display: flex; align-items: center; gap: 8px"
                >
                  <span style="font-size: 13px; color: #6b7280">任务周</span>
                  <n-select
                    v-model:value="trendSelectedWeek"
                    :options="trendWeekOptions"
                    size="small"
                    style="width: 110px"
                    @update:value="renderChart"
                  />
                </div>

                <!-- 下拉筛选日期：仅在按小时维度显示 -->
                <div
                  v-if="trendTimeDimension === 'hour'"
                  style="display: flex; align-items: center; gap: 8px"
                >
                  <span style="font-size: 13px; color: #6b7280">日期</span>
                  <n-select
                    v-model:value="trendSelectedDay"
                    :options="trendDayOptions"
                    size="small"
                    style="width: 120px"
                  />
                </div>

                <!-- 维度和指标类型切换区：通过 Segmented 控制块统一风格 -->
                <div
                  style="
                    display: flex;
                    align-items: center;
                    background: #f3f4f6;
                    padding: 2px;
                    border-radius: 6px;
                  "
                >
                  <n-radio-group
                    v-model:value="trendTimeDimension"
                    size="small"
                    style="background: transparent"
                    @update:value="handleDimensionChange"
                  >
                    <n-radio-button value="day" style="border: none; box-shadow: none"
                      >日</n-radio-button
                    >
                    <n-radio-button value="hour" style="border: none; box-shadow: none"
                      >时</n-radio-button
                    >
                  </n-radio-group>
                </div>
              </n-space>
            </template>
            <div class="chart-container" ref="trendChartRef"></div>
          </n-card>

          <!-- RTM L3 拆解 -->
          <n-card :bordered="false" class="rtm-card ai-hover-trigger">
            <template #header>
              <div style="display: flex; justify-content: space-between; align-items: center">
                <div>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <div class="chart-title">区域进度与门店排行</div>
                    <div class="ai-hover-btn-container">
                      <n-popover
                        trigger="click"
                        placement="bottom"
                        style="border-radius: 12px; padding: 16px; width: 320px; box-shadow: 0 8px 30px rgba(0,0,0,0.12);"
                        @update:show="(v: boolean) => v && ensureBoardInsightOnOpen('rtm')"
                      >
                        <template #trigger>
                          <n-button size="small" class="ai-analyze-btn">
                            <template #icon><n-icon><ColorWandOutline /></n-icon></template>
                            智能分析
                          </n-button>
                        </template>
                        <div class="ai-analyze-content">
                          <div class="ai-analyze-header">
                            <n-icon color="#0071e3" size="18"><ColorWandOutline /></n-icon>
                            <span style="font-weight: 600; margin-left: 6px; color: #1d1d1f; font-size: 15px;">智能分析</span>
                          </div>
                          <div class="ai-analyze-body custom-scroll-ai">
                            <n-spin :show="boardInsightCard.rtm.loading" size="small">
                              <div
                                v-if="!boardInsightCard.rtm.loading && !boardInsightCard.rtm.content"
                                class="ai-insight-md-empty"
                              >
                                暂无内容
                              </div>
                              <div
                                v-else-if="boardInsightCard.rtm.content"
                                class="ai-insight-md"
                                v-html="renderInsightMarkdown(boardInsightCard.rtm.content)"
                              />
                            </n-spin>
                          </div>
                        <div class="ai-analyze-actions">
                          <n-icon
                            size="16"
                            class="ai-action-icon"
                            :class="{ 'is-active-up': boardInsightCard.rtm.userVote === 'up' }"
                            @click="handleAiFeedback('rtm', 'up')"
                          ><LikeOutlined /></n-icon>
                          <span style="font-size: 12px; color: #9ca3af; min-width: 16px;">{{ boardInsightCard.rtm.up }}</span>
                          <n-icon
                            size="16"
                            class="ai-action-icon"
                            :class="{ 'is-active-down': boardInsightCard.rtm.userVote === 'down' }"
                            @click="handleAiFeedback('rtm', 'down')"
                          ><DislikeOutlined /></n-icon>
                          <span style="font-size: 12px; color: #9ca3af; min-width: 16px;">{{ boardInsightCard.rtm.down }}</span>
                          <n-icon size="16" class="ai-action-icon" style="transition: color 0.2s" @click="handleCopyAiInsight(boardInsightCard.rtm.content, 'rtm')"><CheckOutlined v-if="copiedStates['rtm']" style="color: #10b981;" /><CopyOutlined v-else /></n-icon>
                        </div>
                      </div>
                      </n-popover>
                    </div>
                  </div>
                  <div class="chart-sub">按区域/业态热力拆解及各门店具体排行明细</div>
                </div>
                <n-space :size="8">
                  <n-button
                    type="primary"
                    secondary
                    size="small"
                    @click="openStoreRankDrillDown('top')"
                    style="font-weight: 600; padding: 0 10px"
                  >
                    Top 20 门店
                  </n-button>
                  <n-button
                    type="error"
                    secondary
                    size="small"
                    @click="openStoreRankDrillDown('bottom')"
                    style="font-weight: 600; padding: 0 10px"
                  >
                    Bottom 20 门店
                  </n-button>
                </n-space>
              </div>
            </template>
            <div class="rtm-list">
              <div class="rtm-item header">
                <span>维度</span>
                <span class="rtm-col-num">人数</span>
                <span class="rtm-col-num">已完成</span>
                <span>完成率</span>
                <span class="rtm-col-time">人均耗时</span>
              </div>
              <div class="rtm-item" v-for="(item, index) in activeTask.rtmData" :key="index">
                <span class="rtm-name">{{ item.name }}</span>
                <span class="rtm-col-num">{{ item.assignmentCount ?? '—' }}</span>
                <span class="rtm-col-num">{{ item.completedCount ?? '—' }}</span>
                <span class="rtm-rate">
                  <span class="rtm-pct-label">{{ formatPct2(item.rate) }}%</span>
                  <n-progress
                    type="line"
                    :percentage="pctForBar(item.rate)"
                    :indicator-placement="'inside'"
                    processing
                  />
                </span>
                <span class="rtm-time">{{ item.time }}h</span>
              </div>
            </div>
          </n-card>
        </div>

        <!-- 3. 链路与预警数据 -->
        <div class="bottom-section" style="grid-template-columns: 1fr;">
          <!-- 漏斗链路与预警数据合并 -->
          <n-card :bordered="false" class="metrics-card link-warning-card ai-hover-trigger">
            <template #header>
              <div>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <div class="chart-title">漏斗链路与预警监控</div>
                  <div class="ai-hover-btn-container">
                    <n-popover
                      trigger="click"
                      placement="bottom"
                      style="border-radius: 12px; padding: 16px; width: 320px; box-shadow: 0 8px 30px rgba(0,0,0,0.12);"
                      @update:show="(v: boolean) => v && ensureBoardInsightOnOpen('linkAndWarning')"
                    >
                      <template #trigger>
                        <n-button size="small" class="ai-analyze-btn">
                          <template #icon><n-icon><ColorWandOutline /></n-icon></template>
                          智能分析
                        </n-button>
                      </template>
                      <div class="ai-analyze-content">
                        <div class="ai-analyze-header">
                          <n-icon color="#0071e3" size="18"><ColorWandOutline /></n-icon>
                          <span style="font-weight: 600; margin-left: 6px; color: #1d1d1f; font-size: 15px;">智能分析</span>
                        </div>
                        <div class="ai-analyze-body custom-scroll-ai">
                          <n-spin :show="boardInsightCard.linkAndWarning.loading" size="small">
                            <div
                              v-if="!boardInsightCard.linkAndWarning.loading && !boardInsightCard.linkAndWarning.content"
                              class="ai-insight-md-empty"
                            >
                              暂无内容
                            </div>
                            <div
                              v-else-if="boardInsightCard.linkAndWarning.content"
                              class="ai-insight-md"
                              v-html="renderInsightMarkdown(boardInsightCard.linkAndWarning.content)"
                            />
                          </n-spin>
                        </div>
                        <div class="ai-analyze-actions">
                          <n-icon
                            size="16"
                            class="ai-action-icon"
                            :class="{ 'is-active-up': boardInsightCard.linkAndWarning.userVote === 'up' }"
                            @click="handleAiFeedback('linkAndWarning', 'up')"
                          ><LikeOutlined /></n-icon>
                          <span style="font-size: 12px; color: #9ca3af; min-width: 16px;">{{ boardInsightCard.linkAndWarning.up }}</span>
                          <n-icon
                            size="16"
                            class="ai-action-icon"
                            :class="{ 'is-active-down': boardInsightCard.linkAndWarning.userVote === 'down' }"
                            @click="handleAiFeedback('linkAndWarning', 'down')"
                          ><DislikeOutlined /></n-icon>
                          <span style="font-size: 12px; color: #9ca3af; min-width: 16px;">{{ boardInsightCard.linkAndWarning.down }}</span>
                          <n-icon size="16" class="ai-action-icon" style="transition: color 0.2s" @click="handleCopyAiInsight(boardInsightCard.linkAndWarning.content, 'linkAndWarning')"><CheckOutlined v-if="copiedStates['linkAndWarning']" style="color: #10b981;" /><CopyOutlined v-else /></n-icon>
                        </div>
                      </div>
                    </n-popover>
                  </div>
                </div>
                <div class="chart-sub">全链路转化追踪与各维度预警指标综合看板</div>
              </div>
            </template>
            <div class="combined-metrics-container">
              <!-- 左侧：链路数据 -->
              <div class="metrics-grid funnel-grid" style="flex: 1;">
                <div class="metric-box info-style">
                  <div class="m-label"
                    >任务触达率
                    <n-tooltip trigger="hover"
                      ><span
                        >后端当前口径：有下发 assignment 即视为可触达；有任务时多为
                        100%。推送覆盖人数见上方「推送覆盖」</span
                      ><template #trigger
                        ><n-icon class="icon"><info-circle-outlined /></n-icon></template></n-tooltip
                  ></div>
                  <div class="m-value">{{ formatPct2(activeTask.linkData.reachRate) }}%</div>
                </div>

                <div class="funnel-arrow">
                  <n-icon size="24" color="#9ca3af"><ArrowRightOutlined /></n-icon>
                </div>

                <div class="metric-box info-style">
                  <div class="m-label"
                    >任务读取率
                    <n-tooltip trigger="hover"
                      ><span>已读人数（task_detail_open）/ 总 assignment 数</span
                      ><template #trigger
                        ><n-icon class="icon"><info-circle-outlined /></n-icon></template></n-tooltip
                  ></div>
                  <div class="m-value">{{ formatPct2(activeTask.linkData.readRate) }}%</div>
                </div>

                <div class="funnel-arrow">
                  <n-icon size="24" color="#9ca3af"><ArrowRightOutlined /></n-icon>
                </div>

                <div class="metric-box info-style">
                  <div class="m-label"
                    >催办转化率
                    <n-tooltip trigger="hover"
                      ><span
                        >曾被催办（nudge_count 大于 0）且已开始或已完成的 assignment 数 / 被催办
                        assignment 总数</span
                      ><template #trigger
                        ><n-icon class="icon"><info-circle-outlined /></n-icon></template></n-tooltip
                  ></div>
                  <div class="m-value">{{ formatPct2(activeTask.linkData.nudgeRate) }}%</div>
                </div>
              </div>

              <div class="vertical-divider"></div>

              <!-- 预警数据 -->
              <n-card :bordered="false" class="metrics-card warning-card" style="flex: 1;">
            <div class="metrics-grid">
              <div
                class="metric-box warn-style is-clickable"
                @click="openWarningDrillDown('p2', '起步异常')"
              >
                <div class="m-label"
                  >起步异常
                  <n-tooltip trigger="hover"
                    ><span>自动预警事件中 dedupe 含 startDelay 的条数 / 总 assignment 数</span
                    ><template #trigger
                      ><n-icon class="icon"><info-circle-outlined /></n-icon></template></n-tooltip
                ></div>
                <div class="m-value">{{ formatPct2(activeTask.warningData.startAbnormal) }}%</div>
                <div class="m-click-hint">点击下钻</div>
              </div>
              <div
                class="metric-box danger-style is-clickable"
                @click="openWarningDrillDown('p2', '临期危机 (P1)')"
              >
                <div class="m-label"
                  >临期危机 (P1)
                  <n-tooltip trigger="hover"
                    ><span>自动预警事件中 dedupe 含 deadlineCrisisP1 的条数 / 总 assignment 数</span
                    ><template #trigger
                      ><n-icon class="icon"><info-circle-outlined /></n-icon></template></n-tooltip
                ></div>
                <div class="m-value">{{ formatPct2(activeTask.warningData.p1Crisis) }}%</div>
                <div class="m-click-hint">点击下钻</div>
              </div>
              <div
                class="metric-box fatal-style is-clickable"
                @click="openWarningDrillDown('p1', '临期危机 (P0)')"
              >
                <div class="m-label"
                  >临期危机 (P0)
                  <n-tooltip trigger="hover"
                    ><span>自动预警事件中 dedupe 含 deadlineCrisisP0 的条数 / 总 assignment 数</span
                    ><template #trigger
                      ><n-icon class="icon"><info-circle-outlined /></n-icon></template></n-tooltip
                ></div>
                <div class="m-value">{{ formatPct2(activeTask.warningData.p0Crisis) }}%</div>
                <div class="m-click-hint">点击下钻</div>
              </div>
            </div>
          </n-card>
            </div>
          </n-card>
        </div>
      </n-spin>
    </section>
  </div>
</template>

<script lang="ts">
  import { defineComponent } from 'vue';
  export default defineComponent({
    name: 'CentralBoard',
  });
</script>

<script lang="ts" setup>
  import {
    ref,
    computed,
    onMounted,
    watch,
    onBeforeUnmount,
    nextTick,
    shallowRef,
    onActivated,
  } from 'vue';
  import { useRouter } from 'vue-router';
  import * as echarts from 'echarts';
  import {
    InfoCircleOutlined,
    ArrowRightOutlined,
    CloseOutlined,
    EditOutlined,
    BellOutlined,
    UnorderedListOutlined,
    DownOutlined,
    AlertOutlined,
    UserOutlined,
    LikeOutlined,
    DislikeOutlined,
    CopyOutlined,
    CheckOutlined,
  } from '@vicons/antd';
  import { ColorWandOutline } from '@vicons/ionicons5';
  import aiWatchIcon from '@/assets/icons/AI_watch.png';
  import executiveAIIcon from '@/assets/images/ExecutiveAI.png';
  import { getTaskList, getTaskDetail, deleteTask, triggerTaskAutoNudge } from '@/api/task';
  import {
    getDashboardOverview,
    getDashboardHeatmap,
    getDashboardTrend,
    getDashboardStoreRank,
    getDashboardWarnings,
    postDashboardInsight,
    postDashboardInsightVote,
    type TrendPoint,
    type CreateDashboardInsightBody,
  } from '@/api/dashboard';
  import { useMessage, useDialog } from 'naive-ui';
  import { useUserStore } from '@/store/modules/user';
  import { useGlobSetting } from '@/hooks/setting';
  import {
    displayAutoNudgeRules,
    hasAutoNudgeRulesConfigured,
  } from '@/utils/autoNudgeRules';
  import { renderInsightMarkdown } from '@/utils/markdownRender';

  const message = useMessage();
  const dialog = useDialog();
  const router = useRouter();
  const userStore = useUserStore();
  const { apiUrl } = useGlobSetting();

  // --- 下钻弹窗相关状态 ---
  const showDrillDownModal = ref(false);
  const drillDownTitle = ref('');
  const drillDownLoading = ref(false);
  const drillDownList = ref<any[]>([]);
  const drillDownType = ref<'rank' | 'warning'>('rank');

  type BoardInsightSection = 'northStar' | 'trend' | 'rtm' | 'linkAndWarning';

  interface BoardInsightCardState {
    content: string;
    loading: boolean;
    insightId: string | null;
    up: number;
    down: number;
    /** 当前浏览器会话内对本条洞察的投票：与 sessionStorage 同步，用于互斥与取消 */
    userVote: 'up' | 'down' | null;
    /** 与当前筛选一致的缓存键，避免重复请求 */
    fetchedKey: string;
  }

  const INSIGHT_VOTE_STORAGE_PREFIX = 'tot_insight_vote_';

  function readStoredInsightVote(insightId: string): 'up' | 'down' | null {
    if (typeof sessionStorage === 'undefined') return null;
    try {
      const v = sessionStorage.getItem(INSIGHT_VOTE_STORAGE_PREFIX + insightId);
      if (v === 'up' || v === 'down') return v;
      return null;
    } catch {
      return null;
    }
  }

  function writeStoredInsightVote(insightId: string, v: 'up' | 'down' | null) {
    if (typeof sessionStorage === 'undefined') return;
    try {
      const key = INSIGHT_VOTE_STORAGE_PREFIX + insightId;
      if (v == null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, v);
    } catch {
      /* ignore quota / private mode */
    }
  }

  function emptyBoardInsightCard(): BoardInsightCardState {
    return {
      content: '',
      loading: false,
      insightId: null,
      up: 0,
      down: 0,
      userVote: null,
      fetchedKey: '',
    };
  }

  const boardInsightCard = ref<Record<BoardInsightSection, BoardInsightCardState>>({
    northStar: emptyBoardInsightCard(),
    trend: emptyBoardInsightCard(),
    rtm: emptyBoardInsightCard(),
    linkAndWarning: emptyBoardInsightCard(),
  });

  function resetBoardInsightCards() {
    boardInsightCard.value = {
      northStar: emptyBoardInsightCard(),
      trend: emptyBoardInsightCard(),
      rtm: emptyBoardInsightCard(),
      linkAndWarning: emptyBoardInsightCard(),
    };
  }

  /** 打开门店排名下钻 (Top/Bottom) */
  async function openStoreRankDrillDown(type: 'top' | 'bottom') {
    const taskId = activeTaskId.value;
    if (!taskId) return;

    drillDownType.value = 'rank';
    drillDownTitle.value =
      type === 'top' ? '门店完成率排行 (Top 20)' : '门店完成率排行 (Bottom 20)';
    showDrillDownModal.value = true;
    drillDownLoading.value = true;
    drillDownList.value = [];

    try {
      const res = await getDashboardStoreRank({ taskId, type, limit: 20 }).send();
      drillDownList.value = res.rankList || [];
    } catch (err: any) {
      message.error('获取排名详情失败');
    } finally {
      drillDownLoading.value = false;
    }
  }

  /** 打开预警门店下钻 */
  async function openWarningDrillDown(level: 'p1' | 'p2', title: string) {
    const taskId = activeTaskId.value;
    if (!taskId) return;

    drillDownType.value = 'warning';
    drillDownTitle.value = `${title} - 风险门店名单`;
    showDrillDownModal.value = true;
    drillDownLoading.value = true;
    drillDownList.value = [];

    try {
      const res = await getDashboardWarnings({ taskId, warningLevel: level, pageSize: 50 }).send();
      drillDownList.value = res.list || [];
    } catch (err: any) {
      message.error('获取预警详情失败');
    } finally {
      drillDownLoading.value = false;
    }
  }

  const showAiInsightDrawer = ref(false);
  const aiInsightInput = ref('');
  const aiInsightChatRef = ref<HTMLElement | null>(null);
  interface AiInsightMsg {
    role: 'user' | 'ai';
    content: string;
  }
  const aiInsightMessages = ref<AiInsightMsg[]>([]);
  const aiInsightPresets = [
    '当前选中任务完成率如何？',
    '哪些区域落后需要关注？',
    '概述一下链路触达与读取情况',
  ];

  const hqDisplayName = computed(() => {
    const u = userStore.getUserInfo;
    return u?.username || u?.email || '总部';
  });
  const hqAvatarLetter = computed(() => {
    const n = hqDisplayName.value;
    return n ? Array.from(n)[0].toUpperCase() : '总';
  });

  function scrollAiInsightToBottom() {
    nextTick(() => {
      const el = aiInsightChatRef.value;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  function fillAiInsightInput(text: string) {
    aiInsightInput.value = text;
  }

  /** 点击快捷问题：直接发送并获取回复 */
  function triggerPresetQuestion(text: string) {
    aiInsightMessages.value.push({ role: 'user', content: text });
    scrollAiInsightToBottom();
    setTimeout(() => {
      const reply = generateMockFollowUpReply(text);
      aiInsightMessages.value.push({
        role: 'ai',
        content: reply,
      });
      scrollAiInsightToBottom();
    }, 400);
  }

  function onAiInsightKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAiInsightSend();
    }
  }


  const copiedStates = ref<Record<string, boolean>>({
    northStar: false, trend: false, rtm: false, linkAndWarning: false
  });

  const handleCopyAiInsight = (text: string, section: string) => {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => {
        message.success('已复制到剪贴板');
        copiedStates.value[section] = true;
        setTimeout(() => {
          copiedStates.value[section] = false;
        }, 2000);
      }).catch(() => {
        message.error('复制失败');
      });
    } else {
      // 降级处理: 针对内网 IP 访问非 HTTPS 环境下 clipboard API 不可用的情况
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        document.execCommand('copy');
        message.success('已复制到剪贴板');
        copiedStates.value[section] = true;
        setTimeout(() => {
          copiedStates.value[section] = false;
        }, 2000);
      } catch (error) {
        message.error('复制失败');
      } finally {
        textArea.remove();
      }
    }
  };

  /** 生成 Mock 任务分析报告（基于当前 activeTask 数据） */
  function generateMockTaskAnalysis(): string {
    const t = activeTask.value;
    if (!t) {
      return '暂无选中任务，请先在左侧任务列表中选择一个任务，我将为你分析其执行数据。';
    }
    const name = t.name || '该任务';
    const overallRate = t.northStar?.overallRate ?? '—';
    const onTimeRate = t.northStar?.onTimeRate ?? '—';
    const avgTime = t.northStar?.avgTime ?? '—';
    const total = t.overviewSummary?.totalAssignments ?? 0;
    const completed = t.overviewSummary?.completedCount ?? 0;
    const overdue = t.overviewSummary?.overdueCount ?? 0;
    const pending = t.overviewSummary?.pendingCount ?? 0;
    const reachRate = t.linkData?.reachRate ?? 100;
    const readRate = t.linkData?.readRate ?? 0;
    const overallPct = parseFloat(String(overallRate));
    const readPct = Number(readRate);

    // 找出落后的区域（mock 分析）
    let laggingAreas = '暂无';
    if (t.rtmData && t.rtmData.length > 0) {
      const sorted = [...t.rtmData].sort((a: any, b: any) => (a.rate || 0) - (b.rate || 0));
      const bottom3 = sorted.slice(0, 3).filter((x: any) => x.rate < 60);
      if (bottom3.length > 0) {
        laggingAreas = bottom3.map((x: any) => `${x.name}(${formatPct2(x.rate)}%)`).join('、');
      }
    }

    // 风险评级
    let riskLevel = '正常';
    if (overdue > 0) riskLevel = '⚠️ 有风险';
    if (!Number.isNaN(overallPct) && overallPct < 50 && overdue > 5) riskLevel = '🔴 高风险';

    return `【${name}】执行分析报告

📊 整体进度
• 完成率：${formatPct2(overallRate)}%（按时完成率 ${formatPct2(onTimeRate)}%）
• 人均耗时：${avgTime} 小时
• 总人数：${total} 人｜已完成：${completed} 人｜逾期：${overdue} 人｜待开始：${pending} 人

📡 链路触达
• 推送覆盖率：${formatPct2(reachRate)}%｜已读率：${formatPct2(readRate)}%

📍 区域表现（需关注）
• 落后区域：${laggingAreas}

🎯 风险评级：${riskLevel}

💡 建议行动
1. ${
      overdue > 0
        ? `重点关注 ${overdue} 位逾期学员，建议手动催办或调整截止时间`
        : '进度正常，继续保持'
    }
2. ${readPct < 80 ? '读取率偏低，建议二次推送或短信提醒' : '读取率良好'}
3. ${laggingAreas !== '暂无' ? `针对 ${laggingAreas} 区域启动专项督导` : '各区域进度均衡'}

如需更详细分析，可直接追问，如「哪些门店最落后？」或「导出逾期名单」等。`;
  }

  /** 页面上自动显示的 AI 洞察计算属性 */
  const autoAiInsightContent = computed(() => {
    return generateMockTaskAnalysis();
  });

  /** 打开 AI 洞察并自动生成分析报告 */
  function openAiInsightWithAnalysis() {
    showAiInsightDrawer.value = true;
    // 清空历史，重新开始分析
    aiInsightMessages.value = [];
    // 延迟一下让抽屉动画完成再显示分析
    setTimeout(() => {
      const analysis = generateMockTaskAnalysis();
      aiInsightMessages.value.push({
        role: 'ai',
        content: analysis,
      });
      scrollAiInsightToBottom();
    }, 300);
  }

  /** 追问：根据用户输入生成 mock 回复 */
  function generateMockFollowUpReply(question: string): string {
    const t = activeTask.value;
    const q = question.toLowerCase();

    // 识别关键词并返回相应的 mock 数据
    if (q.includes('门店') || q.includes('store') || q.includes('排名')) {
      return `门店完成率排名（Top 5 / Bottom 5）：

🏆 领先门店：
1. Apple 南京东路 - 98%
2. Apple 三里屯 - 96%
3. Apple 杭州西湖 - 95%
4. Apple 成都太古里 - 94%
5. Apple 深圳万象城 - 93%

⚠️ 落后门店（需关注）：
1. Apple 某三线城市店 - 23%
2. Apple 某郊区店 - 28%
3. Apple 某新开店 - 31%
4. Apple 某维修中心 - 35%
5. Apple 某授权店 - 38%

建议：对 Bottom 5 门店启动一对一督导，了解是否存在人员不足或系统使用障碍。`;
    }

    if (q.includes('逾期') || q.includes('名单') || q.includes('导出')) {
      return `逾期学员清单（${t?.overviewSummary?.overdueCount ?? 0} 人）：

已逾期 > 24h：
• 张三（Apple 某三线城市店）- 逾期 3 天
• 李四（Apple 某郊区店）- 逾期 2 天
• 王五（Apple 某新开店）- 逾期 1 天

即将逾期（< 12h）：
• 赵六、孙七、周八...等 12 人

📥 导出功能：如需完整名单 Excel，请告诉我邮箱，系统将自动发送（演示模式暂不支持真实导出）。`;
    }

    if (q.includes('区域') || q.includes('rtm') || q.includes('华东') || q.includes('华北')) {
      return `区域完成率对比：

华东区：76%（领先，但环比下降 5%）
华北区：68%（稳定，北京门店表现突出）
华南区：82%（最优，深圳/广州双核驱动）
西南区：45%（⚠️ 落后，成都一枝独秀但周边偏弱）
西北区：38%（🔴 严重落后，需重点关注）

区域差距分析：
• 最大差距：44 个百分点（华南 vs 西北）
• 建议：西北区启动「一对一帮扶计划」，复制华南经验。`;
    }

    if (q.includes('时间') || q.includes('趋势') || q.includes('每天') || q.includes('进度')) {
      return `近 7 日完成趋势：

04/01：+12 人完成（启动日，集中学习）
04/02：+28 人完成（高峰，工作日空闲时段）
04/03：+15 人完成（回落，正常波动）
04/04：+8 人完成（清明假期前）
04/05：+5 人完成（假期，预期内低谷）
04/06：+18 人完成（假期后反弹）
04/07：+22 人完成（今日，冲刺迹象）

📈 预测：按当前趋势，预计 04/10 可达 85% 完成率，04/12 接近 95%。建议 04/10 前集中资源推动剩余 35% 学员。`;
    }

    if (q.includes('原因') || q.includes('为什么') || q.includes('分析')) {
      return `进度分析（基于当前数据推测）：

主要阻碍因素：
1. 时间因素：40% 逾期集中在周末/节假日，门店轮班导致学习时间碎片化
2. 系统门槛：15% 学员反馈「AI Coach 登录异常」（IT 已修复，需二次通知）
3. 内容难度：SmartSell 模块平均耗时 2.5h（预期 1.5h），内容偏长
4. 督导断层：西北区缺乏专职培训督导，依赖店长自发推动

优化建议：
• 拆分模块：将 SmartSell 拆分为 3 个 45 分钟小节
• 错峰学习：针对轮班门店开放「早班前 30 分钟」集中学习时段
• 补推机制：对系统故障期间受影响学员自动延长 24h 并重新推送`;
    }

    // 默认回复
    return `已收到你的追问：「${question}」

我已在分析「${t?.name || '当前任务'}」的相关数据。由于当前为演示模式，我基于看板数据生成了模拟解读。

你可以尝试询问以下方向获取更详细分析：
• 「哪些门店最落后？」 - 查看门店排名
• 「导出逾期名单」 - 查看逾期学员清单
• 「区域对比」 - 查看各 RTM 区域表现
• 「近7日趋势」 - 查看完成趋势
• 「为什么进度慢」 - 查看原因分析

如需真实 AI 分析能力，后续将对接大模型 API。`;
  }

  function handleAiInsightSend() {
    const text = aiInsightInput.value.trim();
    if (!text) return;
    aiInsightMessages.value.push({ role: 'user', content: text });
    aiInsightInput.value = '';
    scrollAiInsightToBottom();
    setTimeout(() => {
      const reply = generateMockFollowUpReply(text);
      aiInsightMessages.value.push({
        role: 'ai',
        content: reply,
      });
      scrollAiInsightToBottom();
    }, 600);
  }

  /** 总部看板：已下发任务 PATCH 后 WS 推送 task_updated，同步列表/详情中的 ddl 与预警规则 */
  let hqWs: WebSocket | null = null;
  const HQ_WS_ROLES = ['central', 'admin', 'executive'];

  function isHqWsRole(role?: string | null) {
    return !!role && HQ_WS_ROLES.includes(role);
  }

  /** 看板任务卡片上的预警规则展示（兼容后端嵌套结构与旧扁平 JSON） */
  function hqRulesDisplay(task: any) {
    return displayAutoNudgeRules(task?.autoNudgeRules);
  }

  function applyTaskUpdatedFromWs(data: {
    taskId: string;
    ddlAt?: string;
    autoNudgeRules?: Record<string, unknown> | null;
  }) {
    const { taskId, ddlAt, autoNudgeRules } = data;
    const idx = taskList.value.findIndex((t) => t.id === taskId);
    if (idx >= 0) {
      const t = taskList.value[idx];
      taskList.value.splice(idx, 1, {
        ...t,
        deadline: ddlAt ? ddlAt.substring(0, 10) : t.deadline,
        autoNudgeRules: autoNudgeRules !== undefined ? autoNudgeRules : t.autoNudgeRules,
      });
    }
    const detail = taskDetailById.value[taskId];
    if (detail) {
      taskDetailById.value = {
        ...taskDetailById.value,
        [taskId]: {
          ...detail,
          ddlAt: ddlAt ?? detail.ddlAt,
          autoNudgeRules: autoNudgeRules !== undefined ? autoNudgeRules : detail.autoNudgeRules,
        },
      };
    }
  }

  function initHqBoardWebSocket() {
    closeHqBoardWebSocket();
    const token = userStore.getToken;
    if (!token || !isHqWsRole(userStore.getUserInfo?.role)) return;

    let wsHost = apiUrl as string;
    if (!wsHost || wsHost.startsWith('/')) {
      wsHost = window.location.origin;
    }
    const wsUrl = `${String(wsHost).replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`;

    try {
      hqWs = new WebSocket(wsUrl);
    } catch {
      return;
    }

    hqWs.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.event === 'task_updated' && parsed.data?.taskId) {
          applyTaskUpdatedFromWs(parsed.data);
          const tid = parsed.data.taskId;
          const row = taskList.value.find((t) => t.id === tid);
          if (row?.dispatched && activeTaskId.value === tid) {
            void loadDashboardForTask(tid);
          }
        } else if (parsed.event === 'dashboard_updated') {
          void loadTasks().then(() => {
            if (activeTaskId.value) {
              const stillExists = taskList.value.find((t) => t.id === activeTaskId.value);
              if (stillExists) {
                void loadDashboardForTask(activeTaskId.value);
              } else {
                activeTaskId.value = taskList.value.length > 0 ? taskList.value[0].id : '';
                if (activeTaskId.value) void loadDashboardForTask(activeTaskId.value);
              }
            }
          });
        }
      } catch (e) {
        console.error('HQ board WebSocket message error', e);
      }
    };

    hqWs.onclose = () => {
      hqWs = null;
    };
  }

  function closeHqBoardWebSocket() {
    if (hqWs) {
      hqWs.close();
      hqWs = null;
    }
  }

  // --- 数据响应式结构 ---
  const taskList = ref<any[]>([]);
  const activeTaskId = ref<string>('');
  const activeTask = computed(
    () => taskList.value.find((t) => t.id === activeTaskId.value) || null
  );

  const showDispatchedListModal = ref(false);
  const dispatchedListLoading = ref(false);
  const expandedDispatchedTaskId = ref<string | null>(null);
  const detailLoadingTaskId = ref<string | null>(null);
  const taskDetailById = ref<Record<string, any>>({});

  const dispatchedTasksOnly = computed(() => taskList.value.filter((t) => t.dispatched));

  const openDispatchedTasksDialog = async () => {
    dispatchedListLoading.value = true;
    try {
      await loadTasks();
      showDispatchedListModal.value = true;
    } finally {
      dispatchedListLoading.value = false;
    }
  };

  watch(showDispatchedListModal, (open) => {
    if (!open) {
      expandedDispatchedTaskId.value = null;
    }
  });

  const formatHqDetailTime = (isoStr: string) => {
    if (!isoStr) return '—';
    const d = new Date(isoStr);
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(
      d.getHours()
    ).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const toggleDispatchedTaskDetail = async (taskId: string) => {
    if (expandedDispatchedTaskId.value === taskId) {
      expandedDispatchedTaskId.value = null;
      return;
    }
    expandedDispatchedTaskId.value = taskId;
    if (taskDetailById.value[taskId]) return;

    detailLoadingTaskId.value = taskId;
    try {
      const res = await getTaskDetail(taskId).send();
      taskDetailById.value = { ...taskDetailById.value, [taskId]: res };
    } catch (err: any) {
      message.error(err?.message || '加载任务详情失败');
      expandedDispatchedTaskId.value = null;
    } finally {
      detailLoadingTaskId.value = null;
    }
  };

  const goEditDispatchedTask = (taskId: string) => {
    showDispatchedListModal.value = false;
    router.push({ path: '/central/task/publish', query: { id: taskId } });
  };

  const showAlertRulesModal = ref(false);
  const alertRulesListLoading = ref(false);
  const expandedRulesTaskId = ref<string | null>(null);

  const openAlertRulesDialog = () => {
    showAlertRulesModal.value = true;
  };

  watch(showAlertRulesModal, (open) => {
    if (!open) {
      expandedRulesTaskId.value = null;
    }
  });

  const toggleAlertRulesExpand = (taskId: string) => {
    if (expandedRulesTaskId.value === taskId) {
      expandedRulesTaskId.value = null;
    } else {
      expandedRulesTaskId.value = taskId;
    }
  };

  const goEditRulesTask = (taskId: string) => {
    showAlertRulesModal.value = false;
    router.push({ path: '/central/task/publish', query: { id: taskId } });
  };

  /** 看板 KPI 加载（overview + heatmap + trend daily） */
  const boardStatsLoading = ref(false);
  /** 按小时趋势：当前选中日期的接口数据 */
  const activeHourlyTrendRows = ref<TrendPoint[]>([]);
  /** 缓存 key = `${taskId}::${date}` */
  const hourlyTrendCache = ref<Record<string, TrendPoint[]>>({});

  function formatTrendDateLabel(timeKey: string) {
    if (!timeKey) return '';
    const m = String(timeKey).match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[2]}-${m[3]}`;
    return timeKey;
  }

  function formatOverviewTime(iso: string) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso).slice(0, 16);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(
      d.getMinutes()
    ).padStart(2, '0')}`;
  }

  /** 百分比展示统一保留 2 位小数 */
  function formatPct2(value: unknown): string {
    const n = typeof value === 'string' ? parseFloat(value) : Number(value);
    if (Number.isNaN(n)) return '0.00';
    return n.toFixed(2);
  }

  /** n-progress 的 percentage 需在 0–100 */
  function pctForBar(value: unknown): number {
    const n = typeof value === 'string' ? parseFloat(value) : Number(value);
    if (Number.isNaN(n)) return 0;
    return Math.min(100, Math.max(0, n));
  }

  function emptyBoardStats() {
    return {
      northStar: { overallRate: 0, onTimeRate: 0, avgTime: '0' },
      overviewSummary: {
        totalAssignments: 0,
        completedCount: 0,
        inProgressCount: 0,
        pendingCount: 0,
        overdueCount: 0,
        pushUserCount: 0,
        updatedAt: '',
      },
      trendDailyRows: [] as TrendPoint[],
      trendData: { xAxis: [] as string[], series: [] as number[] },
      rtmData: [
        {
          name: '暂无数据',
          rate: 0,
          time: 0,
          assignmentCount: 0,
          completedCount: 0,
        },
      ],
      linkData: { reachRate: 0, readRate: 0, nudgeRate: 0 },
      warningData: { startAbnormal: 0, p1Crisis: 0, p0Crisis: 0 },
    };
  }

  async function loadDashboardForTask(taskId: string) {
    const idx = taskList.value.findIndex((t) => t.id === taskId);
    if (idx < 0) return;
    const row = taskList.value[idx];
    if (!row.dispatched) {
      const empty = emptyBoardStats();
      taskList.value.splice(idx, 1, { ...row, ...empty });
      activeHourlyTrendRows.value = [];
      nextTick(() => renderChart());
      return;
    }

    boardStatsLoading.value = true;
    try {
      const [overview, heatmap, trendDailyRes] = await Promise.all([
        getDashboardOverview({ taskId }).send(),
        getDashboardHeatmap({ taskId }).send(),
        getDashboardTrend({ taskId, type: 'daily' }).send(),
      ]);

      const trendRows: TrendPoint[] = trendDailyRes?.trendData ?? [];
      const heatmapRows = heatmap?.heatmapData ?? [];
      const rtmData = heatmapRows.map((h) => ({
        name: h.rtmValue || '—',
        rate: h.completionRate ?? 0,
        time:
          h.avgCompletionTimeHours != null
            ? Number(Number(h.avgCompletionTimeHours).toFixed(1))
            : 0,
        assignmentCount: h.assignmentCount ?? 0,
        completedCount: h.completedCount ?? 0,
      }));
      if (rtmData.length === 0) {
        rtmData.push({
          name: '暂无门店维度数据',
          rate: 0,
          time: 0,
          assignmentCount: 0,
          completedCount: 0,
        });
      }

      const xAxis = trendRows.map((r) => formatTrendDateLabel(r.timeKey));
      const series = trendRows.map((r) => r.cumulativeCompleted ?? 0);

      taskList.value.splice(idx, 1, {
        ...row,
        northStar: {
          overallRate: overview.completionRate ?? 0,
          onTimeRate: overview.onTimeCompletionRate ?? 0,
          avgTime: String(
            overview.avgCompletionTimeHours != null
              ? Number(overview.avgCompletionTimeHours).toFixed(1)
              : '0'
          ),
        },
        overviewSummary: {
          totalAssignments: overview.totalAssignments ?? 0,
          completedCount: overview.completedCount ?? 0,
          inProgressCount: overview.inProgressCount ?? 0,
          pendingCount: overview.pendingCount ?? 0,
          overdueCount: overview.overdueCount ?? 0,
          pushUserCount: overview.pushUserCount ?? 0,
          updatedAt: overview.updatedAt || '',
        },
        trendDailyRows: trendRows,
        trendData: { xAxis, series },
        rtmData,
        linkData: {
          reachRate: overview.taskReachRate ?? 0,
          readRate: overview.taskReadRate ?? 0,
          nudgeRate: overview.nudgeConversionRate ?? 0,
        },
        warningData: {
          startAbnormal: overview.startDelayRate ?? 0,
          p1Crisis: overview.crisisP1Rate ?? 0,
          p0Crisis: overview.crisisP0Rate ?? 0,
        },
        dashboardUpdatedAt: overview.updatedAt,
      });

      const dateKeys = trendRows.map((r) => r.timeKey).filter(Boolean);
      if (dateKeys.length) {
        if (!trendSelectedDay.value || !dateKeys.includes(trendSelectedDay.value)) {
          trendSelectedDay.value = dateKeys[dateKeys.length - 1];
        }
      } else {
        trendSelectedDay.value = '';
      }

      hourlyTrendCache.value = {};
      if (trendTimeDimension.value === 'hour' && trendSelectedDay.value) {
        await fetchHourlyTrendForActiveTask();
      } else {
        activeHourlyTrendRows.value = [];
      }

      nextTick(() => renderChart());
    } catch (err: any) {
      console.error(err);
      message.error(err?.message || '加载看板统计失败');
    } finally {
      boardStatsLoading.value = false;
    }
  }

  async function fetchHourlyTrendForActiveTask() {
    const taskId = activeTaskId.value;
    const date = trendSelectedDay.value;
    if (!taskId || !date) {
      activeHourlyTrendRows.value = [];
      return;
    }
    const task = taskList.value.find((t) => t.id === taskId);
    if (!task?.dispatched) {
      activeHourlyTrendRows.value = [];
      return;
    }
    const cacheKey = `${taskId}::${date}`;
    if (hourlyTrendCache.value[cacheKey]) {
      activeHourlyTrendRows.value = hourlyTrendCache.value[cacheKey];
      return;
    }
    try {
      const data = await getDashboardTrend({ taskId, type: 'hourly', date }).send();
      const list = data?.trendData ?? [];
      hourlyTrendCache.value[cacheKey] = list;
      activeHourlyTrendRows.value = list;
    } catch {
      activeHourlyTrendRows.value = [];
    }
  }

  // 提取加载任务列表的方法
  const loadTasks = async () => {
    try {
      const res = await getTaskList().send();
      taskList.value = (res || []).map((t: any) => {
        const isDraft = t.status === 'draft';
        const createdRaw = t.createdAt || '';
        const createdAtLabel = createdRaw
          ? `创建 ${createdRaw.substring(0, 10)} ${createdRaw.substring(11, 16) || ''}`
          : '';
        const base = {
          id: t.id,
          name: t.title,
          dispatched: t.status === 'dispatched',
          statusType: isDraft ? 'default' : 'success',
          statusText: isDraft ? '草稿' : '已下发',
          deadline: t.ddlAt ? t.ddlAt.substring(0, 10) : '无截止时间',
          createdAtLabel,
          autoNudgeRules: t.autoNudgeRules ?? null,
          ...emptyBoardStats(),
        };
        return base;
      });

      if (
        taskList.value.length > 0 &&
        (!activeTaskId.value || !taskList.value.find((t) => t.id === activeTaskId.value))
      ) {
        activeTaskId.value = taskList.value[0].id;
      }

      if (activeTaskId.value) {
        await loadDashboardForTask(activeTaskId.value);
      } else {
        nextTick(() => renderChart());
      }
    } catch (err: any) {
      message.error('获取任务列表失败');
      console.error(err);
    }
  };

  const selectTask = (id: string) => {
    activeTaskId.value = id;
    trendSelectedWeek.value = 'all'; // 切换任务时重置任务周筛选
    void loadDashboardForTask(id);
  };

  const autoNudgeLoading = ref(false);
  const handleTriggerAutoNudge = async () => {
    if (!activeTaskId.value) return;
    autoNudgeLoading.value = true;
    try {
      const data = await triggerTaskAutoNudge(activeTaskId.value).send();
      const n = data?.nudgedCount ?? data?.nudgedUsers ?? 0;
      const rules = data?.evaluatedRules?.length
        ? `（规则键：${data.evaluatedRules.join(', ')}）`
        : '';
      const hint = data?.reason ? ` ${data.reason}` : '';
      if (n > 0) {
        message.success(`扫描完成，本次触发 ${n} 人次催办${rules}`);
      } else {
        message.warning(
          `本次触发 0 人次催办。${
            hint || '请检查任务截止时间与预警规则是否命中，或是否已被去重。'
          }${rules}`
        );
      }
      if (activeTaskId.value) {
        await loadDashboardForTask(activeTaskId.value);
      }
    } catch (err: any) {
      message.error(err?.message || '触发失败');
    } finally {
      autoNudgeLoading.value = false;
    }
  };

  // 删除任务的方法
  const handleDeleteTask = (id: string, name: string) => {
    dialog.warning({
      title: '确认删除任务',
      content: `确定要将任务 "${name}" 及其所有的下发记录和数据从系统中彻底删除吗？此操作不可恢复。`,
      positiveText: '确认删除',
      negativeText: '取消',
      onPositiveClick: async () => {
        const msgReactive = message.loading('正在删除中...', { duration: 0 });
        try {
          await deleteTask(id).send();
          msgReactive.destroy();
          message.success('删除成功');

          // 重新加载列表
          await loadTasks();

          // 如果全删光了，清空 activeTask，图表会自动销毁隐藏
          if (taskList.value.length === 0) {
            activeTaskId.value = '';
          }
        } catch (err: any) {
          msgReactive.destroy();
          message.error(err.message || '删除失败');
        }
      },
    });
  };

  // --- ECharts 渲染逻辑 ---
  const trendChartRef = ref<HTMLElement | null>(null);
  const chartInstance = shallowRef<echarts.ECharts | null>(null);
  const trendTimeDimension = ref<'day' | 'hour'>('day');
  const trendSelectedDay = ref<string>('');
  const trendSelectedWeek = ref<string>('all');

  function buildBoardInsightRequestKey(section: BoardInsightSection): string {
    const tid = activeTaskId.value || '';
    if (section === 'northStar') return `north_star::${tid}`;
    if (section === 'trend') {
      const dim = trendTimeDimension.value;
      const d = trendSelectedDay.value || new Date().toISOString().slice(0, 10);
      const w = trendSelectedWeek.value;
      return `trend::${tid}::${dim}::${d}::${w}`;
    }
    if (section === 'rtm') return `channel::${tid}`;
    return `funnel::${tid}`;
  }

  function buildBoardInsightPayload(section: BoardInsightSection): CreateDashboardInsightBody | null {
    const tid = activeTaskId.value;
    if (!tid) return null;
    if (section === 'northStar') {
      return { insightType: 'north_star', taskId: tid };
    }
    if (section === 'trend') {
      if (trendTimeDimension.value === 'hour') {
        const date = trendSelectedDay.value || new Date().toISOString().slice(0, 10);
        return {
          insightType: 'completion_daily',
          taskId: tid,
          date,
          trendType: 'hourly',
        };
      }
      return {
        insightType: 'completion_weekly',
        taskId: tid,
        trendType: 'daily',
      };
    }
    if (section === 'rtm') {
      return { insightType: 'channel_north_star', taskId: tid, rtmLevel: 'rtm' };
    }
    return { insightType: 'funnel_alerts', taskId: tid };
  }

  async function ensureBoardInsightOnOpen(section: BoardInsightSection) {
    const tid = activeTaskId.value;
    if (!tid || !activeTask.value?.dispatched) {
      message.warning('请先选择已下发的任务');
      return;
    }
    const key = buildBoardInsightRequestKey(section);
    const cur = boardInsightCard.value[section];
    if (cur.fetchedKey === key && cur.content) return;

    boardInsightCard.value[section] = { ...cur, loading: true };
    try {
      const payload = buildBoardInsightPayload(section);
      if (!payload) {
        boardInsightCard.value[section] = { ...boardInsightCard.value[section], loading: false };
        message.error('无法构造洞察请求');
        return;
      }
      const data = await postDashboardInsight(payload).send();
      boardInsightCard.value[section] = {
        content: data.content,
        loading: false,
        insightId: data.insightId,
        up: data.voteSummary?.up ?? 0,
        down: data.voteSummary?.down ?? 0,
        userVote: readStoredInsightVote(data.insightId),
        fetchedKey: key,
      };
    } catch {
      boardInsightCard.value[section] = {
        ...boardInsightCard.value[section],
        loading: false,
        content: '',
        insightId: null,
        userVote: null,
        fetchedKey: '',
      };
    }
  }

  const insightVotePending = ref<Record<BoardInsightSection, boolean>>({
    northStar: false,
    trend: false,
    rtm: false,
    linkAndWarning: false,
  });

  async function toggleBoardInsightVote(section: BoardInsightSection, vote: 'up' | 'down') {
    const card = boardInsightCard.value[section];
    const id = card.insightId;
    if (!id) {
      message.warning('请等待洞察生成完成后再反馈');
      return;
    }
    if (insightVotePending.value[section]) return;
    insightVotePending.value[section] = true;
    const prev = card.userVote ?? null;
    try {
      if (vote === 'up') {
        if (prev === 'up') {
          const res = await postDashboardInsightVote(id, { vote: 'up', action: 'remove' }).send();
          boardInsightCard.value[section] = {
            ...boardInsightCard.value[section],
            up: res.up,
            down: res.down,
            userVote: null,
          };
          writeStoredInsightVote(id, null);
          message.success('已取消赞');
        } else {
          if (prev === 'down') {
            await postDashboardInsightVote(id, { vote: 'down', action: 'remove' }).send();
          }
          const res = await postDashboardInsightVote(id, { vote: 'up', action: 'add' }).send();
          boardInsightCard.value[section] = {
            ...boardInsightCard.value[section],
            up: res.up,
            down: res.down,
            userVote: 'up',
          };
          writeStoredInsightVote(id, 'up');
          message.success(prev === 'down' ? '已更新为赞' : '感谢您的反馈！');
        }
      } else if (prev === 'down') {
        const res = await postDashboardInsightVote(id, { vote: 'down', action: 'remove' }).send();
        boardInsightCard.value[section] = {
          ...boardInsightCard.value[section],
          up: res.up,
          down: res.down,
          userVote: null,
        };
        writeStoredInsightVote(id, null);
        message.success('已取消踩');
      } else {
        if (prev === 'up') {
          await postDashboardInsightVote(id, { vote: 'up', action: 'remove' }).send();
        }
        const res = await postDashboardInsightVote(id, { vote: 'down', action: 'add' }).send();
        boardInsightCard.value[section] = {
          ...boardInsightCard.value[section],
          up: res.up,
          down: res.down,
          userVote: 'down',
        };
        writeStoredInsightVote(id, 'down');
        message.success(prev === 'up' ? '已更新为踩' : '已记录您的反馈，我们将持续优化。');
      }
    } catch {
      /* 全局错误提示由 Alova 处理 */
    } finally {
      insightVotePending.value[section] = false;
    }
  }

  function handleAiFeedback(section: BoardInsightSection, vote: 'up' | 'down') {
    void toggleBoardInsightVote(section, vote);
  }

  const trendWeekOptions = computed(() => {
    const rows = activeTask.value?.trendDailyRows as TrendPoint[] | undefined;
    if (!rows?.length) return [{ label: '全部时间', value: 'all' }];
    
    const firstDateStr = rows[0].timeKey;
    const firstTime = new Date(firstDateStr).getTime();
    const lastDateStr = rows[rows.length - 1].timeKey;
    const lastTime = new Date(lastDateStr).getTime();
    
    const diffDays = Math.max(1, Math.ceil((lastTime - firstTime) / (1000 * 60 * 60 * 24)) + 1);
    const totalWeeks = Math.ceil(diffDays / 7);
    
    const opts = [{ label: '全部时间', value: 'all' }];
    for (let i = 1; i <= totalWeeks; i++) {
      opts.push({ label: `第 ${i} 周`, value: String(i) });
    }
    return opts;
  });

  const trendDayOptions = computed(() => {
    const rows = activeTask.value?.trendDailyRows as TrendPoint[] | undefined;
    if (!rows?.length) return [];
    return rows.map((r) => ({
      label: formatTrendDateLabel(r.timeKey),
      value: r.timeKey,
    }));
  });

  const handleDimensionChange = () => {
    if (trendTimeDimension.value === 'hour') {
      if (!trendSelectedDay.value && trendDayOptions.value.length > 0) {
        trendSelectedDay.value = trendDayOptions.value[0].value;
      }
      void fetchHourlyTrendForActiveTask().then(() => nextTick(() => renderChart()));
      return;
    }
    renderChart();
  };

  const renderChart = () => {
    if (!trendChartRef.value || !activeTask.value) return;

    if (!chartInstance.value) {
      chartInstance.value = echarts.init(trendChartRef.value);
    }

    const isHour = trendTimeDimension.value === 'hour';

    let xAxisData: string[] = [];
    let seriesList: any[] = [];
    let legendData: string[] = [];

    if (!isHour) {
      let rows = (activeTask.value.trendDailyRows || []) as TrendPoint[];

      // Filter by selected week
      if (trendSelectedWeek.value !== 'all' && rows.length > 0) {
        const firstTime = new Date(rows[0].timeKey).getTime();
        const weekNum = parseInt(trendSelectedWeek.value, 10);
        const startTimeMs = firstTime + (weekNum - 1) * 7 * 24 * 60 * 60 * 1000;
        const endTimeMs = firstTime + weekNum * 7 * 24 * 60 * 60 * 1000;
        
        rows = rows.filter(r => {
          const rTime = new Date(r.timeKey).getTime();
          return rTime >= startTimeMs && rTime < endTimeMs;
        });
      }

      if (rows.length === 0) {
        xAxisData = ['暂无完成数据'];
        const cumulativeData = [0];
        const dailyData = [0];
        legendData = ['单日增量', '累计完成'];
        seriesList = [
          {
            name: '单日增量',
            type: 'bar',
            barMaxWidth: 28,
            itemStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: '#2997ff' },
                { offset: 1, color: '#0071e3' },
              ]),
              borderRadius: [6, 6, 0, 0],
            },
            data: dailyData,
          },
          {
            name: '累计完成',
            type: 'line',
            smooth: 0.4,
            symbol: 'circle',
            symbolSize: 8,
            showSymbol: false,
            itemStyle: { color: '#0071e3', borderColor: '#ffffff', borderWidth: 2 },
            lineStyle: {
              width: 3,
              color: '#0071e3',
              shadowColor: 'rgba(0, 113, 227, 0.25)',
              shadowBlur: 10,
              shadowOffsetY: 6,
            },
            areaStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: 'rgba(0, 113, 227, 0.15)' },
                { offset: 1, color: 'rgba(0, 113, 227, 0.01)' },
              ]),
            },
            data: cumulativeData,
          },
        ];
      } else {
        xAxisData = rows.map((r) => formatTrendDateLabel(r.timeKey));
        const cumulativeData = rows.map((r) => r.cumulativeCompleted ?? 0);
        const dailyData = rows.map((r) => r.newCompleted ?? 0);

        legendData = ['单日增量', '累计完成'];

        seriesList = [
          {
            name: '单日增量',
            type: 'bar',
            barMaxWidth: 28,
            itemStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: '#2997ff' },
                { offset: 1, color: '#0071e3' },
              ]),
              borderRadius: [6, 6, 0, 0],
            },
            data: dailyData,
          },
          {
            name: '累计完成',
            type: 'line',
            smooth: 0.4,
            symbol: 'circle',
            symbolSize: 8,
            showSymbol: false,
            itemStyle: { color: '#0071e3', borderColor: '#ffffff', borderWidth: 2 },
            lineStyle: {
              width: 3,
              color: '#0071e3',
              shadowColor: 'rgba(0, 113, 227, 0.25)',
              shadowBlur: 10,
              shadowOffsetY: 6,
            },
            areaStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: 'rgba(0, 113, 227, 0.15)' },
                { offset: 1, color: 'rgba(0, 113, 227, 0.01)' },
              ]),
            },
            data: cumulativeData,
          },
        ];
      }
    } else {
      xAxisData = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);
      const rows = activeHourlyTrendRows.value || [];
      const hourlyDelta = Array(24).fill(0);
      const hourlyCumulative = Array(24).fill(0);
      let prevCum = 0;
      for (let h = 0; h < 24; h++) {
        const hk = String(h).padStart(2, '0');
        const row = rows.find((r) => String(r.timeKey).padStart(2, '0') === hk);
        if (row) {
          hourlyDelta[h] = row.newCompleted ?? 0;
          hourlyCumulative[h] = row.cumulativeCompleted ?? prevCum + hourlyDelta[h];
          prevCum = hourlyCumulative[h];
        } else {
          hourlyDelta[h] = 0;
          hourlyCumulative[h] = prevCum;
        }
      }

      legendData = ['单时增量', '累计完成'];

      seriesList = [
        {
          name: '单时增量',
          type: 'bar',
          barMaxWidth: 28,
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: '#2997ff' },
              { offset: 1, color: '#0071e3' },
            ]),
            borderRadius: [6, 6, 0, 0],
          },
          data: hourlyDelta,
        },
        {
          name: '累计完成',
          type: 'line',
          smooth: 0.4,
          symbol: 'circle',
          symbolSize: 8,
          showSymbol: false,
          itemStyle: { color: '#0071e3', borderColor: '#ffffff', borderWidth: 2 },
          lineStyle: {
            width: 3,
            color: '#0071e3',
            shadowColor: 'rgba(0, 113, 227, 0.25)',
            shadowBlur: 10,
            shadowOffsetY: 6,
          },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(0, 113, 227, 0.15)' },
              { offset: 1, color: 'rgba(0, 113, 227, 0.01)' },
            ]),
          },
          data: hourlyCumulative,
        },
      ];
    }

    chartInstance.value.clear();

    const option = {
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        borderColor: '#e5e7eb',
        borderWidth: 1,
        padding: [10, 14],
        textStyle: { color: '#1f2937', fontSize: 13, fontWeight: 500 },
        axisPointer: {
          type: 'shadow',
          lineStyle: { color: '#cbd5e1', type: 'dashed' },
          shadowStyle: { color: 'rgba(243, 244, 246, 0.5)' },
        },
      },
      legend: {
        data: legendData,
        icon: 'circle',
        right: '4%',
        top: 0,
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { color: '#6b7280', fontSize: 12 },
      },
      grid: { left: '3%', right: '4%', bottom: '5%', top: '15%', containLabel: true },
      xAxis: {
        type: 'category',
        boundaryGap: true, // Bar charts usually need boundaryGap: true to look aligned
        data: xAxisData,
        axisLine: { lineStyle: { color: '#e5e7eb', width: 1.5 } },
        axisTick: { show: false },
        axisLabel: { color: '#6b7280', margin: 12 },
      },
      yAxis: {
        type: 'value',
        name: '完成人数',
        nameTextStyle: { color: '#9ca3af', padding: [0, 0, 0, 20], fontSize: 12 },
        splitLine: { lineStyle: { type: 'dashed', color: '#f3f4f6' } },
        axisLabel: { color: '#6b7280' },
      },
      series: seriesList,
    };

    chartInstance.value.setOption(option);
  };

  const resizeChart = () => {
    chartInstance.value?.resize();
  };

  watch(trendSelectedDay, () => {
    if (trendTimeDimension.value !== 'hour' || !activeTaskId.value) return;
    void fetchHourlyTrendForActiveTask().then(() => nextTick(() => renderChart()));
  });

  watch(activeTaskId, () => {
    resetBoardInsightCards();
  });

  watch([trendTimeDimension, trendSelectedWeek, trendSelectedDay], () => {
    boardInsightCard.value.trend = emptyBoardInsightCard();
  });

  watch(
    () => [userStore.getToken, userStore.getUserInfo?.role] as const,
    () => {
      if (!userStore.getToken || !isHqWsRole(userStore.getUserInfo?.role)) {
        closeHqBoardWebSocket();
        return;
      }
      initHqBoardWebSocket();
    },
    { immediate: true }
  );

  onMounted(() => {
    loadTasks();
    nextTick(() => {
      if (activeTask.value) {
        renderChart();
      }
      window.addEventListener('resize', resizeChart);
    });
  });

  onBeforeUnmount(() => {
    window.removeEventListener('resize', resizeChart);
    chartInstance.value?.dispose();
    closeHqBoardWebSocket();
  });

  onActivated(() => {
    loadTasks();
  });
</script>

<style lang="less" scoped>
  /* 商业级 SaaS 风格 - 实时看板 */
  .board-stats-spin {
    display: block;
    width: 100%;
  }

  .hq-board {
    padding: 32px 40px;
    min-height: 100%;
    background-color: #f5f5f7;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Helvetica,
      Arial, sans-serif;
  }

  .board-header {
    margin-bottom: 32px;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;

    .board-header-main {
      flex: 1;
      min-width: 220px;
    }

    .board-header-actions {
      flex-shrink: 0;
      align-self: flex-start;
    }

    .title {
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', Helvetica,
        Arial, sans-serif;
      font-size: 24px;
      font-weight: 600;
      color: #1d1d1f;
      letter-spacing: -0.28px;
      line-height: 1.1;
      margin: 0 0 8px 0;
    }

    .desc {
      font-size: 14px;
      color: rgba(0, 0, 0, 0.48);
      letter-spacing: -0.374px;
      line-height: 1.47;
      margin: 0;
      max-width: 680px;
    }

    .hq-ai-robot-btn {
      border: 1px solid rgba(0, 113, 227, 0.25);
      background: rgba(0, 113, 227, 0.06);

      &:hover {
        background: rgba(0, 113, 227, 0.12);
        border-color: rgba(0, 113, 227, 0.35);
      }
    }

    .hq-ai-robot-img {
      width: 24px;
      height: 24px;
      object-fit: contain;
      display: block;
    }
  }

  /* ─── AI 洞察：悬浮卡片 + 内部 flex 高度链 ─── */
  :deep(.hq-ai-insight-drawer) {
    max-width: min(472px, 100vw);
  }

  :deep(.hq-ai-floating-panel) {
    display: flex;
    flex-direction: column;
    margin: 16px;
    border-radius: 20px;
    overflow: hidden;
    height: calc(100vh - 32px) !important;
    max-height: calc(100vh - 32px);
    box-sizing: border-box;
    background: linear-gradient(165deg, #f8fafc 0%, #ffffff 45%, #f1f5f9 100%);
    border: 1px solid rgba(15, 23, 42, 0.08);
    box-shadow: 0 25px 50px -12px rgba(15, 23, 42, 0.18), 0 12px 24px -8px rgba(15, 23, 42, 0.1),
      inset 0 1px 0 rgba(255, 255, 255, 0.9);
  }

  :deep(.hq-ai-floating-panel .n-drawer-content) {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: transparent;
    border-radius: 20px;
  }

  :deep(.hq-ai-floating-panel .hq-ai-drawer-header-wrap.n-drawer-header) {
    padding: 16px 48px 14px 18px;
    border-bottom: 1px solid rgba(15, 23, 42, 0.06);
    background: linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.95) 0%,
      rgba(248, 250, 252, 0.88) 100%
    );
    backdrop-filter: blur(12px);
  }

  :deep(.hq-ai-floating-panel .hq-ai-drawer-body.n-drawer-body) {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 0;
  }

  :deep(.hq-ai-floating-panel .hq-ai-drawer-body-inner.n-drawer-body-content-wrapper) {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .hq-ai-drawer-header {
    display: flex;
    align-items: center;
    width: 100%;
  }

  .hq-ai-drawer-header-brand {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .hq-ai-drawer-header-avatar {
    flex-shrink: 0;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: linear-gradient(135deg, #e0f2fe 0%, #dbeafe 100%);
    border: 2px solid #ffffff;
    box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);

    .hq-ai-header-icon {
      display: flex;
      align-items: center;
      justify-content: center;
    }
  }

  .hq-ai-drawer-header-titles {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .hq-ai-drawer-header-title {
    font-size: 17px;
    font-weight: 700;
    letter-spacing: -0.3px;
    color: #0f172a;
    line-height: 1.2;
  }

  .hq-ai-drawer-header-sub {
    font-size: 12px;
    color: rgba(15, 23, 42, 0.5);
    letter-spacing: 0.02em;
  }

  .hq-ai-insight-body {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    height: 100%;
  }

  .hq-ai-insight-messages {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 18px 18px 12px;
    background: linear-gradient(
      180deg,
      rgba(241, 245, 249, 0.5) 0%,
      rgba(248, 250, 252, 0.35) 100%
    );
  }

  .custom-scroll-ai {
    &::-webkit-scrollbar {
      width: 6px;
    }
    &::-webkit-scrollbar-thumb {
      background: rgba(148, 163, 184, 0.45);
      border-radius: 6px;
    }
    &::-webkit-scrollbar-track {
      background: transparent;
    }
  }

  .hq-ai-insight-empty {
    display: flex;
    justify-content: center;
    padding: 8px 0 12px;
  }

  .hq-ai-insight-empty-card {
    width: 100%;
    max-width: 100%;
    text-align: center;
    padding: 22px 18px 20px;
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.72);
    border: 1px solid rgba(255, 255, 255, 0.85);
    box-shadow: 0 4px 24px rgba(15, 23, 42, 0.06);
  }

  .hq-ai-insight-kicker {
    margin: 0 0 8px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #3b82f6;
  }

  .hq-ai-insight-hi {
    margin: 0 0 10px;
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.4px;
    color: #0f172a;
    line-height: 1.25;
  }

  .hq-ai-insight-desc {
    margin: 0 0 18px;
    font-size: 13px;
    line-height: 1.55;
    color: rgba(15, 23, 42, 0.58);
  }

  .hq-ai-insight-presets {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: stretch;
  }

  .hq-ai-preset-chip {
    width: 100%;
    padding: 10px 14px;
    text-align: left;
    font-size: 13px;
    line-height: 1.45;
    color: #1e293b;
    background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
    border: 1px solid rgba(148, 163, 184, 0.35);
    border-radius: 12px;
    cursor: pointer;
    transition: border-color 0.2s, box-shadow 0.2s, transform 0.15s;

    &:hover {
      border-color: rgba(59, 130, 246, 0.45);
      box-shadow: 0 4px 16px rgba(37, 99, 235, 0.1);
      transform: translateY(-1px);
    }

    &:active {
      transform: translateY(0);
    }
  }

  .hq-ai-msg-row {
    display: flex;
    gap: 10px;
    margin-bottom: 12px;
    align-items: flex-end;

    &.is-user {
      flex-direction: row-reverse;

      .hq-ai-msg-bubble {
        background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
        color: #fff;
        box-shadow: 0 4px 14px rgba(37, 99, 235, 0.28);
      }
    }

    &.is-ai .hq-ai-msg-bubble {
      background: #ffffff;
      color: #0f172a;
      border: 1px solid rgba(15, 23, 42, 0.06);
      box-shadow: 0 2px 12px rgba(15, 23, 42, 0.05);
    }
  }

  .hq-ai-msg-avatar {
    flex-shrink: 0;
    padding-bottom: 2px;
  }

  .hq-ai-bot-icon {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
    border: 1px solid rgba(37, 99, 235, 0.15);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .hq-ai-user-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
    border: 2px solid #fff;
    box-shadow: 0 2px 8px rgba(37, 99, 235, 0.12);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    font-weight: 700;
    color: #1d4ed8;
  }

  .hq-ai-msg-bubble {
    max-width: calc(100% - 44px);
    padding: 10px 14px;
    border-radius: 14px;
    font-size: 14px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .hq-ai-insight-footer {
    flex-shrink: 0;
    padding: 14px 16px 14px;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.92) 0%, #f8fafc 100%);
    border-top: 1px solid rgba(15, 23, 42, 0.06);
  }

  .hq-ai-insight-composer {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .hq-ai-insight-input {
    :deep(.n-input) {
      border-radius: 14px;
      background: #ffffff;
      box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.08);
      transition: box-shadow 0.2s;
    }

    :deep(.n-input--focus) {
      box-shadow: inset 0 0 0 1px rgba(59, 130, 246, 0.45), 0 0 0 3px rgba(59, 130, 246, 0.12);
    }
  }

  .hq-ai-insight-send {
    align-self: flex-end;
    min-width: 88px;
    font-weight: 600;
    box-shadow: 0 4px 14px rgba(37, 99, 235, 0.25);
  }

  .hq-ai-insight-tip {
    margin: 8px 0 0;
    font-size: 11px;
    line-height: 1.4;
    color: rgba(15, 23, 42, 0.42);
    text-align: center;
  }

  .hq-dispatched-body {
    max-height: min(58vh, 520px);
    overflow-y: auto;
    padding-right: 4px;
  }

  .hq-waterfall-list {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .hq-waterfall-card {
    background: #ffffff;
    border-radius: 12px;
    padding: 0;
    border: none;
    border-left: 4px solid #0071e3;
    box-shadow: rgba(0, 0, 0, 0.04) 0px 2px 10px 0px;
    transition: box-shadow 0.2s;
    overflow: hidden;

    &.is-expanded {
      box-shadow: rgba(0, 0, 0, 0.12) 0px 8px 30px 0px;
    }

    .hq-wf-summary {
      padding: 16px 20px;
      cursor: pointer;
      user-select: none;
      transition: background 0.15s;

      &:hover {
        background: #f5f5f7;
      }
    }

    .hq-wf-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }

    .hq-wf-chevron {
      color: rgba(0, 0, 0, 0.32);
      font-size: 14px;
      transition: transform 0.2s ease;

      &.is-open {
        transform: rotate(180deg);
        color: #0071e3;
      }
    }

    .hq-wf-tag {
      display: inline-block;
      font-size: 12px;
      font-weight: 600;
      color: #1d1d1f;
      background: #f5f5f7;
      padding: 4px 8px;
      border-radius: 4px;
      letter-spacing: -0.12px;
    }

    .hq-wf-title {
      margin: 0 0 8px;
      font-size: 16px;
      font-weight: 600;
      color: #1d1d1f;
      line-height: 1.47;
      letter-spacing: -0.374px;
    }

    .hq-wf-meta {
      margin: 0 0 4px;
      font-size: 13px;
      color: rgba(0, 0, 0, 0.8);
      letter-spacing: -0.224px;
    }

    .hq-wf-time {
      margin: 0 0 8px;
      font-size: 12px;
      color: rgba(0, 0, 0, 0.48);
      letter-spacing: -0.12px;
    }

    .hq-wf-hint {
      margin: 0;
      font-size: 12px;
      color: #0071e3;
      letter-spacing: -0.12px;
    }

    .hq-wf-expand {
      padding: 0 20px 20px;
      border-top: 1px solid rgba(0, 0, 0, 0.05);
      background: #fafafc;
    }
  }

  .hq-detail-inner {
    padding-top: 12px;
  }

  .hq-detail-desc-block {
    margin-top: 16px;
  }

  .hq-detail-desc-label {
    font-size: 14px;
    color: rgba(0, 0, 0, 0.48);
    letter-spacing: -0.224px;
    margin-bottom: 8px;
  }

  .hq-detail-desc-text {
    white-space: pre-wrap;
    line-height: 1.47;
    background: #ffffff;
    padding: 16px;
    border-radius: 8px;
    border: none;
    box-shadow: rgba(0, 0, 0, 0.04) 0px 2px 10px 0px;
    font-size: 14px;
    color: #1d1d1f;
    letter-spacing: -0.224px;
  }

  .hq-detail-edit-btn {
    margin-top: 16px;
  }

  .hq-rules-card {
    border-left-color: #ff9500;

    &.is-expanded {
      box-shadow: rgba(0, 0, 0, 0.12) 0px 8px 30px 0px;
    }
  }

  .hq-rules-expand {
    .hq-rules-body {
      margin-bottom: 12px;
    }

    .hq-rule-block {
      margin-bottom: 16px;

      &:last-of-type {
        margin-bottom: 0;
      }
    }

    .hq-rule-block-title {
      font-size: 14px;
      font-weight: 600;
      color: #1d1d1f;
      letter-spacing: -0.224px;
      margin-bottom: 8px;
    }

    .hq-rule-line {
      margin: 0 0 6px;
      font-size: 14px;
      color: rgba(0, 0, 0, 0.8);
      line-height: 1.47;
      letter-spacing: -0.224px;

      strong {
        color: #ff9500;
        font-weight: 600;
      }
    }

    .hq-rules-empty {
      margin: 8px 0 12px;
    }
  }

  .task-nav-section {
    margin-bottom: 24px;
    overflow-x: auto;
    padding-bottom: 8px;
    &::-webkit-scrollbar {
      height: 6px;
    }
    &::-webkit-scrollbar-thumb {
      background: #d1d5db;
      border-radius: 3px;
    }
  }

  .auto-nudge-bar {
    margin-bottom: 24px;
    .auto-nudge-inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
      padding: 12px 20px;
      background: #fafafc;
      border: none;
      border-radius: 8px;
    }
    .auto-nudge-hint {
      font-size: 14px;
      color: rgba(0, 0, 0, 0.8);
      letter-spacing: -0.224px;
      line-height: 1.47;
      flex: 1;
      min-width: 200px;
    }
  }

  .empty-board {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 400px;
    background: #ffffff;
    border-radius: 12px;
    border: none;
    box-shadow: rgba(0, 0, 0, 0.04) 0px 2px 10px 0px;
  }

  .task-list {
    display: flex;
    gap: 16px;
    width: max-content;
  }

  .task-card {
    width: 280px;
    background: #ffffff;
    border: none;
    border-radius: 12px;
    padding: 20px;
    cursor: pointer;
    transition: all 0.2s ease;
    flex-shrink: 0;
    position: relative;
    overflow: hidden;
    box-shadow: rgba(0, 0, 0, 0.04) 0px 2px 10px 0px;

    &:hover {
      box-shadow: rgba(0, 0, 0, 0.12) 0px 8px 30px 0px;
      transform: translateY(-2px);
    }

    &.is-active {
      box-shadow: rgba(0, 0, 0, 0.12) 0px 8px 30px 0px;
      border: 1px solid rgba(0, 113, 227, 0.3);

      &::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        width: 4px;
        height: 100%;
        background-color: #0071e3;
      }
    }

    .task-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;

      .header-right {
        display: flex;
        align-items: center;
        gap: 6px;
      }
    }
    .task-name {
      font-size: 14px;
      font-weight: 600;
      color: #1d1d1f;
      letter-spacing: -0.374px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 140px;
    }
    .action-btn {
      opacity: 0;
      transition: opacity 0.2s ease, color 0.2s ease, background 0.2s ease;
      color: rgba(0, 0, 0, 0.48);
    }

    .edit-btn:hover {
      color: #0071e3;
      background: rgba(0, 113, 227, 0.1);
    }

    .del-btn:hover {
      color: #ff3b30;
      background: rgba(255, 59, 48, 0.1);
    }

    &:hover .action-btn {
      opacity: 1;
    }
    .task-card-time {
      font-size: 14px;
      color: rgba(0, 0, 0, 0.48);
      letter-spacing: -0.224px;
    }
  }

  /* 核心看板区结构 */
  .dashboard-content {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  /* 全局卡片统一样式 */
  :deep(.n-card) {
    border-radius: 4px;
    box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
    background: #ffffff;
    border: 1px solid #e5e7eb;
  }

  :deep(.n-card-header) {
    border-bottom: 1px solid #f3f4f6;
    padding: 16px 24px !important;
  }

  :deep(.n-card-header__main) {
    font-weight: 600 !important;
    font-size: 16px !important;
    color: #111827 !important;
    position: relative;
    padding-left: 12px;

    &::before {
      content: '';
      position: absolute;
      left: 0;
      top: 50%;
      transform: translateY(-50%);
      width: 4px;
      height: 16px;
      background-color: #2563eb;
      border-radius: 2px;
    }
  }

  /* 各区域 AI 悬浮按钮公共类 */
  .ai-hover-trigger {
    position: relative;
  }

  .ai-hover-trigger .ai-hover-btn-container {
    opacity: 0;
    visibility: hidden;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    transform: translateY(-4px);
    z-index: 10;
  }

  .ai-hover-trigger:hover .ai-hover-btn-container,
  .ai-hover-btn-container:focus-within {
    opacity: 1;
    visibility: visible;
    transform: translateY(0);
  }

  .ai-analyze-btn {
    background: linear-gradient(135deg, #f0f7ff 0%, #e0f2fe 100%);
    color: #0071e3;
    border: 1px solid #bae6fd;
    box-shadow: 0 4px 12px rgba(0, 113, 227, 0.15);
    font-weight: 400;
    border-radius: 6px !important;
  }

  .ai-analyze-btn:hover {
    background: #dbeafe;
  }

  .ai-analyze-content {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 360px;
    max-height: 360px;
    box-sizing: border-box;
  }

  .ai-analyze-header {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    border-bottom: 1px solid #f3f4f6;
    padding-bottom: 10px;
  }

  .ai-analyze-body {
    flex: 1 1 auto;
    min-height: 0;
    margin-top: 8px;
    overflow-x: hidden;
    overflow-y: auto;
    padding-right: 4px;
  }

  .ai-analyze-body .ai-insight-md,
  .ai-analyze-body .ai-insight-md-empty {
    margin-top: 0;
  }

  .ai-analyze-body :deep(.n-spin-container) {
    min-height: min-content;
  }

  .ai-analyze-actions {
    display: flex;
    justify-content: flex-end;
    flex-shrink: 0;
    gap: 16px;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid #f3f4f6;
    color: #9ca3af;
  }

  .ai-action-icon {
    cursor: pointer;
    transition: color 0.2s;
  }

  .ai-action-icon:hover {
    color: #0071e3;
  }

  .ai-action-icon.is-active-up {
    color: #10b981 !important;
  }

  .ai-action-icon.is-active-down {
    color: #f97316 !important;
  }

  .ai-insight-md-empty {
    font-size: 14px;
    color: #9ca3af;
    margin-top: 12px;
    min-height: 48px;
  }

  .ai-insight-md {
    font-size: 14px;
    color: #4b5563;
    line-height: 1.65;
    margin-top: 12px;
    min-height: 48px;
    word-break: break-word;

    :deep(h1),
    :deep(h2),
    :deep(h3),
    :deep(h4) {
      font-weight: 600;
      color: #1d1d1f;
      margin: 12px 0 8px;
      line-height: 1.35;
      &:first-child {
        margin-top: 0;
      }
    }
    :deep(h1) {
      font-size: 16px;
    }
    :deep(h2) {
      font-size: 15px;
    }
    :deep(h3),
    :deep(h4) {
      font-size: 14px;
    }
    :deep(p) {
      margin: 0 0 8px;
      &:last-child {
        margin-bottom: 0;
      }
    }
    :deep(ul),
    :deep(ol) {
      margin: 0 0 8px;
      padding-left: 1.25em;
    }
    :deep(li) {
      margin: 4px 0;
    }
    :deep(strong) {
      font-weight: 600;
      color: #374151;
    }
    :deep(code) {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      background: #f3f4f6;
      padding: 1px 5px;
      border-radius: 4px;
    }
    :deep(pre) {
      margin: 8px 0;
      padding: 10px 12px;
      background: #f9fafb;
      border-radius: 8px;
      overflow-x: auto;
      font-size: 12px;
      line-height: 1.5;
      code {
        padding: 0;
        background: transparent;
      }
    }
    :deep(blockquote) {
      margin: 8px 0;
      padding: 6px 0 6px 12px;
      border-left: 3px solid #e5e7eb;
      color: #6b7280;
    }
    :deep(hr) {
      border: none;
      border-top: 1px solid #e5e7eb;
      margin: 10px 0;
    }
    :deep(a) {
      color: #0071e3;
      text-decoration: none;
      &:hover {
        text-decoration: underline;
      }
    }
  }

  /* 1. 概览 KPI（overview） */
  .north-star-container {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 8px 0;
    background: #ffffff;
    border: none;
    border-radius: 12px;
    padding: 40px 24px;
    box-shadow: rgba(0, 0, 0, 0.04) 0px 2px 10px 0px;

    .divider {
      width: 1px;
      height: 64px;
      background: rgba(0, 0, 0, 0.05);
      margin: 0 48px;
      flex-shrink: 0;
    }

    .ns-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
    }

    .ns-label {
      font-size: 14px;
      font-weight: 600;
      color: #1d1d1f;
      letter-spacing: -0.374px;
      margin-bottom: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Helvetica,
        Arial, sans-serif;
    }

    .ns-value {
      font-size: 40px;
      font-weight: 600;
      line-height: 1.07;
      letter-spacing: -0.28px;
      color: #1d1d1f;
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', Helvetica,
        Arial, sans-serif;

      &.highlight {
        color: #0071e3;
      }

      .unit {
        font-size: 16px;
        font-weight: 400;
        color: rgba(0, 0, 0, 0.48);
        margin-left: 6px;
      }
    }

    .ns-sub {
      font-size: 12px;
      color: rgba(0, 0, 0, 0.48);
      margin-top: 12px;
      max-width: 200px;
      letter-spacing: -0.12px;
    }
  }

  .overview-kpi-strip {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 6px;
    margin: 12px 0 24px;
    padding: 12px 20px;
    background: #f5f5f7;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    color: rgba(0, 0, 0, 0.48);
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Helvetica,
      Arial, sans-serif;
    letter-spacing: -0.224px;

    .kpi-chip {
      strong {
        color: #1d1d1f;
        font-weight: 600;
      }
      &.warn strong {
        color: #ff3b30;
      }
    }
    .kpi-dot {
      color: rgba(0, 0, 0, 0.1);
      user-select: none;
    }
    .kpi-updated {
      margin-left: auto;
      font-size: 12px;
      color: rgba(0, 0, 0, 0.48);
      letter-spacing: -0.12px;
    }
  }

  .chart-card-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
  }

  .chart-title {
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', Helvetica,
      Arial, sans-serif;
    font-size: 17px;
    font-weight: 700;
    color: #1d1d1f;
    letter-spacing: 0.231px;
    line-height: 1.19;
  }

  .chart-sub {
    font-size: 13px;
    color: rgba(0, 0, 0, 0.48);
    margin-top: 4px;
    line-height: 1.29;
    letter-spacing: -0.224px;
    max-width: 520px;
  }

  /* 2. 中间图表区 */
  
  .combined-metrics-container {
    display: flex;
    align-items: center;
    gap: 32px;
  }

  .vertical-divider {
    width: 1px;
    height: 80px;
    background-color: rgba(0, 0, 0, 0.06);
    flex-shrink: 0;
  }

  @media screen and (max-width: 1200px) {
    .combined-metrics-container {
      flex-direction: column;
      align-items: stretch;
      gap: 16px;
    }
    .vertical-divider {
      width: 100%;
      height: 1px;
      margin: 8px 0;
    }
  }

  .middle-section {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
    box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
    border-radius: 4px;
    overflow: hidden;
    border: 1px solid #e5e7eb;
    background: #ffffff;

    :deep(.n-card) {
      border: none !important;
      box-shadow: none !important;
      border-radius: 0 !important;
    }

    .chart-card {
      border-right: 1px solid #e5e7eb !important;
    }

    .chart-container {
      height: 320px;
      width: 100%;
    }

    .rtm-list {
      display: flex;
      flex-direction: column;
      height: 320px;
      overflow-y: auto;

      &::-webkit-scrollbar {
        width: 6px;
      }
      &::-webkit-scrollbar-thumb {
        background: rgba(0, 0, 0, 0.1);
        border-radius: 3px;
      }

      .rtm-item {
        display: grid;
        grid-template-columns: minmax(72px, 1.1fr) 44px 44px minmax(100px, 1.2fr) 52px;
        align-items: center;
        gap: 10px;
        padding: 12px 16px;
        border-bottom: 1px solid rgba(0, 0, 0, 0.05);

        &:hover {
          background-color: #f5f5f7;
        }

        .rtm-col-num,
        .rtm-col-time {
          font-size: 14px;
          color: rgba(0, 0, 0, 0.48);
          letter-spacing: -0.224px;
          text-align: right;
        }

        &.header {
          font-weight: 600;
          color: rgba(0, 0, 0, 0.8);
          background-color: #fafafc;
          border-bottom: 1px solid rgba(0, 0, 0, 0.05);
          font-size: 14px;
          letter-spacing: -0.224px;
          &:hover {
            background-color: #fafafc;
          }
        }

        .rtm-name {
          font-size: 14px;
          font-weight: 600;
          color: #1d1d1f;
          letter-spacing: -0.224px;
        }
        .rtm-time {
          font-size: 14px;
          color: rgba(0, 0, 0, 0.48);
          text-align: right;
        }

        .rtm-rate {
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 0;
        }

        .rtm-pct-label {
          font-size: 12px;
          font-weight: 600;
          color: #1d1d1f;
          letter-spacing: -0.2px;
        }

        /* 进度条恢复为主题蓝 */
        :deep(.n-progress .n-progress-graph-line-fill) {
          background-color: #0071e3 !important;
        }
      }
    }
  }

  /* 3. 底部详细数据区 */
  .bottom-section {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
    box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
    border-radius: 4px;
    overflow: hidden;
    border: 1px solid #e5e7eb;
    background: #ffffff;

    :deep(.n-card) {
      border: none !important;
      box-shadow: none !important;
      border-radius: 0 !important;
    }

    .link-card {
      border-right: 1px solid #e5e7eb !important;
    }
  }

  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
  }

  .funnel-grid {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;

    .metric-box {
      flex: 1;
      min-width: 0;
    }
  }

  .funnel-arrow {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .metric-box {
    padding: 24px;
    border-radius: 12px;
    background: #ffffff;
    border: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
    box-shadow: rgba(0, 0, 0, 0.04) 0px 2px 10px 0px;

    .m-label {
      font-size: 13px;
      color: rgba(0, 0, 0, 0.48);
      letter-spacing: -0.224px;
      display: flex;
      align-items: center;
      gap: 4px;
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Helvetica,
        Arial, sans-serif;
      .icon {
        color: rgba(0, 0, 0, 0.32);
        cursor: help;
      }
    }

    .m-value {
      font-size: 24px;
      font-weight: 600;
      color: #1d1d1f;
      letter-spacing: -0.231px;
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', Helvetica,
        Arial, sans-serif;
    }

    &.info-style {
      background: #fafafc;
      .m-value {
        color: #0071e3;
      }
    }

    /* 预警数据 */
    &.warn-style {
      background: #fafafc;
      .m-value {
        color: #f59e0b;
      }
    }
    &.danger-style {
      background: #fafafc;
      .m-value {
        color: #ff9500;
      }
    }
    &.fatal-style {
      background: #fafafc;
      .m-value {
        color: #ff3b30;
      }
    }
  }
  .chart-card :deep(.n-radio-button) {
    border-radius: 6px !important;
  }
  .chart-card :deep(.n-radio-button.n-radio-button--checked) {
    background-color: #ffffff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1) !important;
    color: #1d1d1f;
    font-weight: 600;
  }
  .chart-card :deep(.n-radio-group .n-radio-button:not(.n-radio-button--checked):hover) {
    color: rgba(0, 0, 0, 0.8);
  }
  .chart-card :deep(.n-radio-group) {
    border: none;
  }
  .chart-card :deep(.n-radio-group .n-radio-button::before) {
    display: none !important; /* Hide the separator lines between buttons */
  }

  /* 门店排名下钻卡片 */
  .drilldown-entry-card {
    .de-container {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 8px 0;
    }
    .de-item {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 16px;
      background: #f5f5f7;
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.2s ease;
      border: 1px solid transparent;

      &:hover {
        background: #ffffff;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
        border-color: rgba(0, 113, 227, 0.1);
        transform: translateY(-1px);
      }

      .de-icon {
        width: 44px;
        height: 44px;
        background: #ffffff;
        border-radius: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #0071e3;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04);
      }

      .de-label {
        font-weight: 600;
        font-size: 15px;
        color: #1d1d1f;
        margin-bottom: 2px;
      }
      .de-desc {
        font-size: 12px;
        color: #86868b;
      }

      &.top .de-icon {
        color: #34c759;
      }
      &.bottom .de-icon {
        color: #ff3b30;
      }
    }
  }

  /* 指标卡片点击下钻样式 */
  .metric-box.is-clickable {
    cursor: pointer;
    position: relative;
    overflow: hidden;
    transition: all 0.2s ease;

    &:hover {
      background: #ffffff !important;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
      transform: translateY(-2px);
      z-index: 1;
    }

    .m-click-hint {
      position: absolute;
      bottom: 8px;
      right: 12px;
      font-size: 10px;
      color: rgba(0, 0, 0, 0.25);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      opacity: 0;
      transition: opacity 0.2s;
    }

    &:hover .m-click-hint {
      opacity: 1;
    }
  }

  .dd-item:hover {
    background: #f9f9fb;
  }
</style>
