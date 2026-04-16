<template>
  <div class="task-publish">
    <div class="publish-container">
      <!-- 头部：标题与功能概述 -->
      <header class="publish-header">
        <h1 class="title">{{ isEditMode ? '编辑学习任务' : '布置学习任务' }}</h1>
        <p class="desc" v-if="!isDispatched"
          >在此创建并下发新的培训任务，支持多平台联动与 AI 智能文案优化，精准触达目标门店。</p
        >
        <p class="desc" v-else style="color: #ef4444"
          >当前任务已下发执行中，为保证数据一致性，仅允许延长任务截止时间。</p
        >
      </header>

      <!-- 表单区域 -->
      <section class="form-section">
        <!-- AI 快捷创建区域 -->
        <n-card
          :bordered="false"
          class="form-card mb-4 ai-parse-card"
          style="
            margin-bottom: 24px;
            background: linear-gradient(145deg, #f0f7ff, #ffffff);
            box-shadow: 0 4px 20px rgba(0, 113, 227, 0.08);
          "
        >
          <div
            class="ai-parse-header"
            style="display: flex; align-items: center; gap: 8px; margin-bottom: 16px"
          >
            <n-icon size="24" color="#0071e3"
              ><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
                <path
                  fill="currentColor"
                  d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"
                /></svg
            ></n-icon>
            <span style="font-size: 16px; font-weight: 600; color: #1d1d1f; letter-spacing: -0.3px"
              >AI 快捷发布</span
            >
            <n-tag type="info" size="small" round :bordered="false" style="margin-left: auto"
              >Beta</n-tag
            >
          </div>

          <n-input-group>
            <n-input
              v-model:value="aiInputText"
              size="large"
              placeholder="例如：帮我建一个下周五前完成的MacBook销售话术培训，要求80分及格，包含MyPal和直播..."
              :style="{ flex: 1, borderRadius: '12px 0 0 12px' }"
              clearable
              @keydown.enter="handleAIParse"
            >
              <template #prefix>
                <n-icon
                  size="18"
                  color="#86868b"
                  style="cursor: pointer; margin-right: 8px"
                  @click="simulateVoiceInput"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    width="24"
                    height="24"
                  >
                    <path
                      fill="currentColor"
                      d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"
                    />
                  </svg>
                </n-icon>
              </template>
            </n-input>
            <n-button
              type="primary"
              size="large"
              :loading="aiParsing"
              style="border-radius: 0 12px 12px 0; padding: 0 24px; font-weight: 600"
              @click="handleAIParse"
            >
              智能解析
            </n-button>
          </n-input-group>
          <div style="margin-top: 12px; font-size: 13px; color: #86868b">
            💡 支持语音输入或一句话描述，系统将自动提取关键信息填充表单并润色任务说明。
          </div>
        </n-card>

        <!-- 基本信息卡片 -->
        <n-card :bordered="false" class="form-card mb-4" title="基本信息">
          <n-form
            ref="formRef"
            :model="formValue"
            :rules="rules"
            label-placement="top"
            size="large"
            require-mark-placement="right-hanging"
          >
            <!-- 1. 学习平台选择 (提前到首位，方便联动后续任务名称) -->
            <n-form-item label="学习平台选择 (可多选)" path="platforms">
              <n-checkbox-group v-model:value="formValue.platforms" :disabled="isDispatched">
                <n-space item-style="display: flex;">
                  <n-checkbox value="MyPal" label="MyPal" />
                  <n-checkbox value="直播培训" label="直播培训" />
                  <n-checkbox value="Sales Coach" label="Sales Coach" />
                  <n-checkbox value="AI Coach" label="AI Coach" />
                </n-space>
              </n-checkbox-group>
            </n-form-item>

            <!-- 2. 任务名称与达标分数 (横向排列) -->
            <n-grid :x-gap="24" :cols="2">
              <n-grid-item>
                <n-form-item label="任务名称" path="taskName">
                  <n-input
                    v-model:value="formValue.taskName"
                    placeholder="例如：春季新品陈列专项培训"
                    :disabled="isDispatched"
                  />
                </n-form-item>
              </n-grid-item>
              <n-grid-item>
                <n-form-item label="达标分数" path="passScore">
                  <n-input-number
                    v-model:value="formValue.passScore"
                    placeholder="请输入达标分数"
                    :min="0"
                    :max="100"
                    style="width: 100%"
                    :disabled="isDispatched"
                  >
                    <template #suffix>分</template>
                  </n-input-number>
                </n-form-item>
              </n-grid-item>
            </n-grid>

            <!-- 3. 时间设置 -->
            <n-grid :x-gap="24" :cols="2">
              <n-grid-item>
                <n-form-item label="开始时间" path="startTime">
                  <n-date-picker
                    v-model:value="formValue.startTime"
                    type="datetime"
                    clearable
                    style="width: 100%"
                    :disabled="isDispatched"
                  />
                </n-form-item>
              </n-grid-item>
              <n-grid-item>
                <n-form-item label="结束时间 (Deadline)" path="endTime">
                  <n-date-picker
                    v-model:value="formValue.endTime"
                    type="datetime"
                    clearable
                    style="width: 100%"
                  />
                </n-form-item>
              </n-grid-item>
            </n-grid>

            <!-- 4. 任务覆盖范围 -->
            <n-form-item label="任务覆盖范围" path="coverage">
              <n-select
                :value="formValue.coverage"
                :options="coverageOptions"
                multiple
                placeholder="请选择需要覆盖的人群范围"
                :disabled="isDispatched"
                @update:value="handleCoverageChange"
              />
            </n-form-item>

            <!-- 5. 任务描述与 AI 优化 (移至本部分最后，作为详细说明项) -->
            <n-form-item label="任务描述" path="description">
              <div class="desc-wrapper">
                <n-input
                  v-model:value="formValue.description"
                  type="textarea"
                  placeholder="请详细描述本次任务的学习目标、核心知识点及预计耗时..."
                  :autosize="{ minRows: 6, maxRows: 10 }"
                  :disabled="isDispatched"
                />
                <div class="ai-btn-wrapper" v-if="!isDispatched">
                  <n-button
                    type="info"
                    ghost
                    class="ai-btn"
                    :loading="aiLoading"
                    @click="handleAIOptimize"
                  >
                    AI 智能润色
                  </n-button>
                </div>
              </div>
            </n-form-item>
          </n-form>
        </n-card>

        <!-- 提交操作区 -->
        <div class="submit-wrapper">
          <n-button
            type="primary"
            size="large"
            class="submit-btn"
            :loading="isSubmitting"
            :disabled="isSavingDraft"
            @click="handleSubmit"
          >
            {{ isDispatched ? '更新任务信息' : isEditMode ? '保存并下发任务' : '确认发布任务' }}
          </n-button>
          <n-button
            size="large"
            class="cancel-btn"
            :loading="isSavingDraft"
            :disabled="isSubmitting"
            @click="handleSaveDraft"
            v-if="!isDispatched"
          >
            {{ isEditMode ? '保存修改 (草稿)' : '保存草稿' }}
          </n-button>
        </div>
      </section>
    </div>
  </div>
</template>

<script lang="ts">
  import { defineComponent } from 'vue';
  export default defineComponent({
    name: 'CentralTaskPublish',
  });
</script>

<script lang="ts" setup>
  import { ref, reactive, computed, watch, onActivated } from 'vue';
  import { useRouter, useRoute } from 'vue-router';
  import { useMessage } from 'naive-ui';
  import {
    createTask,
    dispatchTask,
    getTaskDetail,
    updateTask,
    aiGenerateTaskDescription,
    postAiSmartPublish,
  } from '@/api/task';
  import { formFromAutoNudgeRules, toApiAutoNudgeRules } from '@/utils/autoNudgeRules';

  const message = useMessage();
  const router = useRouter();
  const route = useRoute();
  const formRef = ref();

  // AI 快捷输入相关的状态与逻辑
  const aiInputText = ref('');
  const aiParsing = ref(false);

  const simulateVoiceInput = () => {
    message.loading('正在聆听... (测试演示功能)', { duration: 1500 });
    setTimeout(() => {
      aiInputText.value =
        '帮我建一个下周五前完成的MacBook Pro销售话术培训，要求90分及格，包含MyPal和直播培训平台，全员覆盖。';
      message.success('语音识别完成');
    }, 1500);
  };

  const handleAIParse = async () => {
    if (!aiInputText.value.trim()) {
      message.warning('请输入一句话描述或使用语音输入');
      return;
    }
    aiParsing.value = true;
    const loadingMsg = message.loading('AI 正在拆解意图并自动填充表单...', { duration: 0 });

    try {
      const res = await postAiSmartPublish(aiInputText.value).send();
      // NOTE: Using Alova with this configuration likely returns the resolved JSON body.
      // Since backend sends `{ code, message, data: { taskName, ...} }`
      // We check if res.data exists, else fallback to res.
      const aiData = (res as any).data || res;

      // 1. 提取平台 (如果用户没有提到，保留现有的或给个默认)
      const newPlatforms = [];
      if (aiInputText.value.includes('MyPal')) newPlatforms.push('MyPal');
      if (aiInputText.value.includes('直播')) newPlatforms.push('直播培训');
      if (aiInputText.value.includes('Sales')) newPlatforms.push('Sales Coach');
      if (aiInputText.value.includes('AI')) newPlatforms.push('AI Coach');
      if (newPlatforms.length > 0) {
        formValue.platforms = newPlatforms;
      }

      formValue.taskName = aiData.taskName;
      formValue.passScore = aiData.passingScore;
      formValue.startTime = new Date(aiData.startAt).getTime();
      formValue.endTime = new Date(aiData.ddlAt).getTime();
      formValue.description = aiData.taskDetails;

      message.success('AI 解析与润色成功，表单已自动填充！');
    } catch (e: any) {
      console.error('AI Parse Error:', e);
      message.error(e.message || '解析失败，请重试');
    } finally {
      loadingMsg.destroy();
      aiParsing.value = false;
    }
  };

  // 编辑模式状态
  const editTaskId = ref<string>('');
  const taskStatus = ref<string>('draft');
  const isEditMode = computed(() => !!editTaskId.value);
  const isDispatched = computed(() => taskStatus.value === 'dispatched');

  /** 勾选 MyPal 时后端要求非空任务周；无表单项时用此默认值；编辑时优先用 loadTaskDetail 写入的 mypalTaskWeek */
  const DEFAULT_MYPAL_TASK_WEEK = 'FY26Q2W1';

  // 初始默认模版
  const defaultDesc = `🎯【学习目标】
1. 掌握核心产品知识
2. 提升实战销售技巧

💡【核心知识点】
- 场景化演练与话术运用
- 应对常见客户异议

⏱️【预计耗时】
约 15-20 分钟`;

  const formValue = reactive({
    taskName: '',
    passScore: 80,
    description: defaultDesc,
    startTime: null as number | null,
    endTime: null as number | null,
    platforms: ['MyPal'],
    coverage: ['全员'] as string[],
    alertRules: {
      laggingLifestyle: 3,
      laggingMono: 1,
      startDelayPct: 50,
      crisisP1Hours: 48,
      crisisP0Hours: 24,
    },
    mypalTaskWeek: '',
    mypalProductName: '',
  });

  const resetForm = () => {
    editTaskId.value = '';
    taskStatus.value = 'draft';
    formValue.taskName = '';
    formValue.description = defaultDesc;
    formValue.startTime = null;
    formValue.passScore = 80;
    formValue.endTime = null;
    formValue.platforms = ['MyPal'];
    formValue.coverage = ['全员'];
    formValue.mypalTaskWeek = '';
    formValue.mypalProductName = '';
    aiInputText.value = '';
    formValue.alertRules = {
      laggingLifestyle: 3,
      laggingMono: 1,
      startDelayPct: 50,
      crisisP1Hours: 48,
      crisisP0Hours: 24,
    };
  };

  const loadTaskDetail = async (id: string) => {
    try {
      const res = await getTaskDetail(id).send();
      taskStatus.value = res.status;
      formValue.taskName = res.title;
      formValue.description = res.description || '';
      formValue.startTime = res.startAt ? new Date(res.startAt).getTime() : null;
      formValue.passScore = res.passScore ?? 80;
      formValue.endTime = res.ddlAt ? new Date(res.ddlAt).getTime() : null;

      // 还原覆盖范围
      if (res.rtmFilter && res.rtmFilter.length > 0) {
        formValue.coverage = res.rtmFilter.map((f: any) => f.rtm); // 支持多选
      } else {
        formValue.coverage = ['全员'];
      }

      formValue.platforms = [];
      if (res.hasMypal) formValue.platforms.push('MyPal');
      if (res.hasSmartSell) formValue.platforms.push('Sales Coach');
      if (res.hasAiDemo) formValue.platforms.push('AI Coach');
      if (res.hasLiveBroadcast) formValue.platforms.push('直播培训');
      if (res.autoNudgeRules) {
        Object.assign(formValue.alertRules, formFromAutoNudgeRules(res.autoNudgeRules));
      }
      formValue.mypalTaskWeek = res.mypalTaskWeek?.trim() ?? '';
      formValue.mypalProductName = res.mypalProductName?.trim() ?? '';
    } catch (e: any) {
      message.error('加载任务详情失败: ' + (e.message || '未知错误'));
    }
  };

  watch(
    () => [...formValue.platforms],
    (ids) => {
      if (!ids.includes('MyPal')) {
        formValue.mypalTaskWeek = '';
        formValue.mypalProductName = '';
      }
    }
  );

  watch(
    () => route.query.id,
    (newId) => {
      // 防止其他页面的 query 变更触发
      if (route.name !== 'CentralTaskPublish') return;

      if (newId) {
        editTaskId.value = newId as string;
        loadTaskDetail(editTaskId.value);
      } else {
        // 重置表单
        resetForm();
      }
    },
    { immediate: true }
  );

  onActivated(() => {
    // 只有在当前组件可见时才触发
    if (route.name !== 'CentralTaskPublish') return;

    // 处理 KeepAlive 模式下，切回组件时数据能够重新拉取或清空
    if (route.query.id) {
      editTaskId.value = route.query.id as string;
      loadTaskDetail(editTaskId.value);
    } else {
      resetForm();
    }
  });

  const coverageOptions = [
    { label: '全员 (All)', value: '全员' },
    { label: 'Monobrand', value: 'Monobrand' },
    { label: 'Multibrand', value: 'Multibrand' },
    { label: 'Carrier', value: 'Carrier' },
    { label: 'Education', value: 'Education' },
    { label: 'Enterprise', value: 'Enterprise' },
    { label: '店长 (Store Manager)', value: '店长' },
  ];

  const handleCoverageChange = (values: string[]) => {
    if (isDispatched.value) return;

    // 如果刚选择了“全员”，则排他
    const wasAll = formValue.coverage.includes('全员');
    const isAll = values.includes('全员');

    if (isAll && !wasAll) {
      formValue.coverage = ['全员'];
    } else if (values.length > 1 && isAll) {
      // 已经有全员了，又选了别的，则去掉全员
      formValue.coverage = values.filter((v) => v !== '全员');
    } else {
      formValue.coverage = values;
    }
  };

  const rules = {
    taskName: { required: true, message: '请输入任务名称', trigger: 'blur' },
    passScore: {
      required: true,
      type: 'number',
      message: '请输入达标分数',
      trigger: ['blur', 'change'],
    },
    description: { required: true, message: '请完善任务描述', trigger: 'blur' },
    startTime: { required: true, type: 'number', message: '请选择开始时间', trigger: 'change' },
    endTime: { required: true, type: 'number', message: '请选择结束时间', trigger: 'change' },
    platforms: {
      required: true,
      type: 'array',
      message: '请至少选择一个学习平台',
      trigger: 'change',
    },
    coverage: { 
      required: true, 
      type: 'array', 
      message: '请选择覆盖范围', 
      trigger: ['blur', 'change'] 
    },
  };

  // --- 将 Markdown 格式转换为干净的纯文本 ---
  const parseMarkdownToText = (text: string) => {
    if (!text) return '';
    return (
      text
        // 移除标题的 # 符号
        .replace(/^#{1,6}\s+(.*)/gm, '$1')
        // 移除粗体和斜体 (例如 **粗体**, *斜体*, __粗体__, _斜体_)
        .replace(/(\*\*|__)(.*?)\1/g, '$2')
        .replace(/(\*|_)(.*?)\1/g, '$2')
        // 将无序列表的 - 或 * 替换为 •，保持缩进
        .replace(/^(\s*)[-*]\s+(.*)/gm, '$1• $2')
        // 移除代码块的 ``` 符号
        .replace(/```[\s\S]*?```/g, (match) => match.replace(/```.*\n?/g, ''))
        // 移除行内代码的 ` 符号
        .replace(/`([^`]+)`/g, '$1')
        // 移除引用块的 > 符号
        .replace(/^>\s+(.*)/gm, '$1')
        // 移除链接的 [] 和 ()
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        // 移除多余的空行（连续三个以上的换行替换为两个）
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    );
  };

  // --- AI 优化逻辑 ---
  const aiLoading = ref(false);
  const handleAIOptimize = () => {
    formRef.value?.validate(async (errors: any) => {
      if (errors) {
        let firstErrorMsg = '请检查表单中未填写的必填项！';
        try {
          firstErrorMsg = errors[0][0].message || firstErrorMsg;
        } catch (e) {}
        message.warning(firstErrorMsg);

        setTimeout(() => {
          const errorEl = document.querySelector('.n-form-item.n-form-item--error-status');
          if (errorEl) {
            errorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 50);
        return;
      }

      if (!isDispatched.value && formValue.platforms.length === 0) {
        message.warning('请至少选择一个学习平台！');
        return;
      }

      aiLoading.value = true;
      const msgReactive = message.loading('AI 正在为您重构并润色培训文案...', { duration: 0 });

      try {
        const userDesc =
          formValue.description === defaultDesc ? '无特殊要求' : formValue.description;
        const startDateStr = formValue.startTime
          ? new Date(formValue.startTime).toLocaleString('zh-CN')
          : '即刻';
        const endDateStr = formValue.endTime
          ? new Date(formValue.endTime).toLocaleString('zh-CN')
          : '未指定';
        const platformsStr =
          formValue.platforms.length > 0 ? formValue.platforms.join('、') : '未指定';

        const richInstruction = `【任务基本信息】
- 任务名称：${formValue.taskName || '未命名任务'}
- 达标要求：测试通过需达到 ${formValue.passScore !== null ? formValue.passScore : 100} 分
- 任务时间：从 ${startDateStr} 至 ${endDateStr}
- 学习平台：${platformsStr}
- 目标人群：${formValue.coverage || '全员'}

【任务附加说明】
${userDesc}`;

        const payload = {
          instruction: richInstruction,
          ddlAt: formValue.endTime ? new Date(formValue.endTime).toISOString() : undefined,
          platforms: formValue.platforms,
        };

        const res = await aiGenerateTaskDescription(payload).send();

        // 如果返回的结构包含 description 字段
        if (res && res.description) {
          // 解析 Markdown 为干净的纯文本后赋值给 textarea
          formValue.description = parseMarkdownToText(res.description);
          msgReactive.destroy();
          message.success('AI 润色完成！');
        } else {
          throw new Error('未收到预期的润色结果');
        }
      } catch (err: any) {
        console.error('AI Generate Error:', err);
        msgReactive.destroy();
        message.error(err.message || 'AI 润色请求失败，请检查服务状态');
      } finally {
        aiLoading.value = false;
      }
    });
  };
  // 构造后端 API 需要的数据格式（POST /tasks 要求 startAt、passScore、ddlAt 均非空）
  const buildTaskPayload = () => {
    const ddlAt = formValue.endTime
      ? new Date(formValue.endTime).toISOString()
      : new Date().toISOString();
    const startAt = formValue.startTime
      ? new Date(formValue.startTime).toISOString()
      : new Date().toISOString();

    if (isDispatched.value) {
      // 已下发：可改截止时间 + 预警规则（与后端 autoNudge.js 结构一致）
      return {
        ddlAt,
        autoNudgeRules: toApiAutoNudgeRules(formValue.alertRules),
      };
    }

    const isAll = formValue.coverage.includes('全员') || formValue.coverage.length === 0;
    
    // 过滤掉非 RTM 的特殊选项
    const rtmList = formValue.coverage.filter((c: string) => c !== '全员' && c !== '店长');
    const isGlobal = isAll || (formValue.coverage.includes('店长') && rtmList.length === 0);

    const draft: Record<string, unknown> = {
      title: formValue.taskName,
      description: formValue.description,
      hasMypal: formValue.platforms.includes('MyPal'),
      hasSmartSell: formValue.platforms.includes('Sales Coach'),
      hasAiDemo: formValue.platforms.includes('AI Coach'),
      hasLiveBroadcast: formValue.platforms.includes('直播培训'),
      startAt,
      passScore: formValue.passScore ?? 80,
      ddlAt,
      storeScope: isGlobal ? 'all' : [],
      rtmFilter: isGlobal ? null : rtmList.map((c: string) => ({ rtm: c })),
      autoNudgeRules: toApiAutoNudgeRules(formValue.alertRules),
    };

    if (formValue.platforms.includes('MyPal')) {
      const w = String(formValue.mypalTaskWeek ?? '').trim();
      draft.mypalTaskWeek = w || DEFAULT_MYPAL_TASK_WEEK;
      const prod = String(formValue.mypalProductName ?? '').trim();
      draft.mypalProductName = prod || null;
    }

    return draft;
  };

  // --- 提交表单 (发布任务/更新并发布) ---
  const isSubmitting = ref(false);
  const handleSubmit = (e: Event) => {
    e.preventDefault();
    formRef.value?.validate(async (errors: any) => {
      if (errors) {
        message.error('请检查表单中未填写的必填项！');
        return;
      }

      if (!isDispatched.value && formValue.platforms.length === 0) {
        message.error('请至少选择一个学习平台！');
        return;
      }

      try {
        isSubmitting.value = true;
        const payload = buildTaskPayload();

        let taskId = editTaskId.value;

        if (isEditMode.value) {
          // 更新现有任务
          await updateTask(taskId, payload).send();
          if (isDispatched.value) {
            message.success('任务信息更新成功！');
            return;
          }
        } else {
          // 1. 创建新任务 (Draft)
          const resTask = await createTask(payload).send();
          taskId = resTask.id;
        }

        // 2. 如果是草稿，则进行下发 (Dispatch)
        const resDispatch = await dispatchTask(taskId).send();
        message.success(`任务发布成功！已成功触达 ${resDispatch.targetUserCount} 名终端人员。`);

        // 更新当前状态为已发布，避免重复提交
        editTaskId.value = taskId;
        taskStatus.value = 'dispatched';
      } catch (err: any) {
        console.error(err);
        message.error(err.message || '操作失败，请稍后重试');
      } finally {
        isSubmitting.value = false;
      }
    });
  };

  // --- 保存草稿 (新建或更新草稿) ---
  const isSavingDraft = ref(false);
  const handleSaveDraft = () => {
    formRef.value?.validate(async (errors: any) => {
      if (errors) {
        message.error('保存草稿也需要填写基本的必填项(名称/截止时间)哦');
        return;
      }
      try {
        isSavingDraft.value = true;
        const payload = buildTaskPayload();

        if (isEditMode.value) {
          await updateTask(editTaskId.value, payload).send();
          message.success('草稿修改成功！');
        } else {
          const resTask = await createTask(payload).send();
          editTaskId.value = resTask.id;
          taskStatus.value = 'draft';
          message.success('草稿创建成功！');
        }
      } catch (err: any) {
        message.error(err.message || '保存草稿失败');
      } finally {
        isSavingDraft.value = false;
      }
    });
  };
</script>

<style lang="less" scoped>
  /* 商业级 SaaS 风格 */
  .task-publish {
    padding: 32px 40px;
    min-height: 100%;
    background-color: #f5f5f7;
    display: flex;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Helvetica,
      Arial, sans-serif;
  }

  .publish-container {
    width: 100%;
    max-width: 1100px;
    transition: max-width 0.3s ease;
  }

  /* 全屏模式下自适应更宽 */
  :global(.layout-content:fullscreen) .publish-container {
    max-width: 1600px;
    padding: 0 24px;
  }

  /* 自定义 n-select 多选标签样式 (极致简约 Apple 风格) */
  :deep(.n-base-selection-tag-wrapper) {
    .n-tag {
      background-color:rgb(255, 255, 255) !important;
      border: none !important;
      border-radius: 6px !important;
      padding: 2px 10px !important;
      height: 28px !important;
      color:rgb(8, 8, 8) !important;
      font-weight: 450 !important;
      font-size: 13px !important;
      transition: background-color 0.2s ease !important;

      .n-tag__close {
        font-size: 12px !important;
        color:rgb(255, 255, 255) !important;
        margin-left: 4px !important;
        &:hover {
          color: #0071e3 !important; /* 悬停关闭按钮时变为红色反馈 */
          background-color: transparent !important;
        }
      }

      &:hover {
        background-color:rgb(247, 247, 247) !important;
      }
    }
  }

  /* 选中项特别样式（可选，如果需要 Apple Blue 风格可以开启） */
  /*
  :deep(.n-base-selection-tag-wrapper .n-tag--checked) {
     background-color: #0071e3 !important;
     color: #fff !important;
  }
  */

  .publish-header {
    margin-bottom: 32px;
    text-align: left;

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
    }
  }

  .form-section {
    width: 100%;

    .form-card {
      border-radius: 12px;
      box-shadow: rgba(0, 0, 0, 0.04) 0px 2px 10px 0px;
      margin-bottom: 24px;
      background: #ffffff;
      border: none;

      :deep(.n-card-header) {
        padding: 16px 24px !important;
        border-bottom: 1px solid rgba(0, 0, 0, 0.05);
        .n-card-header__main {
          font-weight: 600 !important;
          font-size: 16px !important;
          color: #1d1d1f !important;
          position: relative;
          padding-left: 12px;

          /* 左侧商业风竖线装饰 */
          &::before {
            content: '';
            position: absolute;
            left: 0;
            top: 50%;
            transform: translateY(-50%);
            width: 4px;
            height: 16px;
            background-color: #0071e3;
            border-radius: 2px;
          }
        }
      }

      :deep(.n-card__content) {
        padding: 24px;
      }
    }
  }

  /* 恢复正常的输入框样式，去掉无边框的极简设计 */
  :deep(.n-input),
  :deep(.n-select),
  :deep(.n-date-picker),
  :deep(.n-input-number) {
    border-radius: 6px;
  }

  /* 描述框与 AI 按钮的相对布局 */
  .desc-wrapper {
    position: relative;
    width: 100%;

    :deep(.n-input) {
      /* 确保滚动条在最右侧，同时文本下方留出按钮空间 */
      .n-input__textarea-el {
        padding-bottom: 48px;
        font-size: 14px;
        line-height: 1.47;
      }
    }

    .ai-btn-wrapper {
      position: absolute;
      right: 12px;
      bottom: 12px;
      z-index: 10;
    }

    .ai-btn {
      border-radius: 980px;
      font-weight: 500;
      background: rgba(255, 255, 255, 0.9);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(0, 113, 227, 0.3);
      color: #0071e3;
      padding: 0 16px;
      height: 32px;
      font-size: 13px;
      transition: all 0.2s ease;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);

      &:hover {
        background: #0071e3;
        color: #ffffff;
        border-color: #0071e3;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0, 113, 227, 0.2);
      }

      &:active {
        transform: translateY(0);
        background: #0077ed;
      }

      :deep(.n-button__icon) {
        margin-right: 6px;
      }
    }
  }

  /* 复选框美化 */
  :deep(.n-checkbox-group) {
    width: 100%;
    padding: 12px 16px;
    background: #fafafc;
    border-radius: 8px;
    border: none;
  }

  .submit-wrapper {
    margin-top: 24px;
    padding-top: 24px;
    border-top: 1px solid rgba(0, 0, 0, 0.05);
    display: flex;
    gap: 16px;
    justify-content: flex-end; /* 商业后台按钮通常在右下角 */
    width: 100%;

    .submit-btn {
      width: auto;
      min-width: 120px;
      border-radius: 980px;
      font-weight: 500;
      background-color: #0071e3;
      color: #ffffff;
      border: none;
      transition: all 0.2s ease;

      &:hover {
        background-color: #0077ed;
      }

      &:active {
        background-color: #ededf2;
        color: #0071e3;
      }
    }

    .cancel-btn {
      width: auto;
      min-width: 90px;
      border-radius: 980px;
      font-weight: 500;
      background: #f5f5f7;
      border: 1px solid transparent;
      color: #1d1d1f;
      transition: all 0.2s ease;

      &:hover {
        background: #ededf2;
        color: #0071e3;
      }

      &:active {
        background: #e5e5ea;
      }
    }
  }

  /* 预警规则专属样式 */
  .alert-rules-container {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .rule-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .rule-header {
    display: flex;
    align-items: center;

    .rule-title {
      font-size: 15px;
      font-weight: 600;
      color: #1d1d1f;
      letter-spacing: -0.224px;
    }
  }

  .rule-body {
    background-color: #fafafc;
    border: none;
    border-radius: 8px;
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .rule-row {
    display: flex;
    align-items: center;
    font-size: 14px;
    color: rgba(0, 0, 0, 0.8);
    letter-spacing: -0.224px;
  }

  .rule-label {
    width: 140px;
    font-weight: 500;
    color: rgba(0, 0, 0, 0.8);
    flex-shrink: 0;
  }

  .rule-control {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .inline-input {
    width: 80px;

    :deep(.n-input__input-el) {
      text-align: center;
      font-weight: 600;
      color: #0071e3;
    }
  }

  .unit-text {
    margin-left: -4px;
    font-weight: 500;
  }
</style>
