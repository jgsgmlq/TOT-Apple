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
                v-model:value="formValue.coverage"
                :options="coverageOptions"
                placeholder="请选择需要覆盖的人群范围"
                :disabled="isDispatched"
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
                    <template #icon>
                      <n-icon><RobotOutlined /></n-icon>
                    </template>
                    AI 智能润色
                  </n-button>
                </div>
              </div>
            </n-form-item>
          </n-form>
        </n-card>

        <!-- 预警规则卡片（已下发任务也可改，保存后写入 auto_nudge_rules） -->
        <n-card :bordered="false" class="form-card" title="预警规则参数设置">
          <n-form :model="formValue.alertRules" label-placement="top" size="large">
            <div class="alert-rules-container">
              <!-- 进度掉队 -->
              <div class="rule-section">
                <div class="rule-header">
                  <span class="rule-title">进度掉队预警</span>
                  <n-tag size="small" type="info" :bordered="false" style="margin-left: 8px"
                    >仅针对 Monobrand</n-tag
                  >
                </div>
                <div class="rule-body">
                  <div class="rule-row">
                    <div class="rule-label">Lifestyle：</div>
                    <div class="rule-control">
                      个人任务完成率处于门店最后
                      <n-input-number
                        v-model:value="formValue.alertRules.laggingLifestyle"
                        :min="1"
                        :max="50"
                        class="inline-input"
                        :show-button="false"
                        placeholder="如: 3"
                      />
                      位
                    </div>
                  </div>
                  <div class="rule-row">
                    <div class="rule-label">Mono：</div>
                    <div class="rule-control">
                      个人任务完成率处于门店最后
                      <n-input-number
                        v-model:value="formValue.alertRules.laggingMono"
                        :min="1"
                        :max="50"
                        class="inline-input"
                        :show-button="false"
                        placeholder="如: 1"
                      />
                      位
                    </div>
                  </div>
                </div>
              </div>

              <!-- 起步异常 -->
              <div class="rule-section">
                <div class="rule-header">
                  <span class="rule-title">起步异常预警</span>
                </div>
                <div class="rule-body">
                  <div class="rule-row">
                    <div class="rule-control">
                      任务期限已度过
                      <n-input-number
                        v-model:value="formValue.alertRules.startDelayPercent"
                        :min="1"
                        :max="99"
                        class="inline-input"
                        :show-button="false"
                        placeholder="如: 50"
                      />
                      <span class="unit-text">%</span> ，但个人进度仍为 0%
                    </div>
                  </div>
                </div>
              </div>

              <!-- deadline危机 -->
              <div class="rule-section">
                <div class="rule-header">
                  <span class="rule-title">临期危机预警 (Deadline)</span>
                </div>
                <div class="rule-body">
                  <div class="rule-row">
                    <div class="rule-control" style="margin-bottom: 8px">
                      距离任务 Deadline 不足
                      <n-input-number
                        v-model:value="formValue.alertRules.deadlineCrisisHours"
                        :min="1"
                        :max="168"
                        class="inline-input"
                        :show-button="false"
                        placeholder="如: 24"
                      />
                      <span class="unit-text">小时</span> ，但仍未完成课程
                    </div>
                  </div>
                  <div class="rule-row">
                    <div class="rule-control">
                      距离任务 Deadline 不足
                      <n-input-number
                        v-model:value="formValue.alertRules.deadlineCrisisHoursSecondary"
                        :min="1"
                        :max="168"
                        class="inline-input"
                        :show-button="false"
                        placeholder="如: 48"
                      />
                      <span class="unit-text">小时</span> ，但仍未完成课程
                    </div>
                  </div>
                </div>
              </div>
            </div>
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
  import { RobotOutlined } from '@vicons/antd';
  import {
    createTask,
    dispatchTask,
    getTaskDetail,
    updateTask,
    aiGenerateTaskDescription,
  } from '@/api/task';

  const message = useMessage();
  const router = useRouter();
  const route = useRoute();
  const formRef = ref();

  // 编辑模式状态
  const editTaskId = ref<string>('');
  const taskStatus = ref<string>('draft');
  const isEditMode = computed(() => !!editTaskId.value);
  const isDispatched = computed(() => taskStatus.value === 'dispatched');

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
    coverage: '全员',
    alertRules: {
      laggingLifestyle: 3,
      laggingMono: 1,
      startDelayPercent: 50,
      deadlineCrisisHours: 24,
      deadlineCrisisHoursSecondary: 48,
    },
  });

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
        formValue.coverage = res.rtmFilter[0].rtm; // 这里前端只做简单的单选 RTM 映射
      } else {
        formValue.coverage = '全员';
      }

      formValue.platforms = [];
      if (res.hasMypal) formValue.platforms.push('MyPal');
      if (res.hasSmartSell) formValue.platforms.push('Sales Coach');
      if (res.hasAiDemo) formValue.platforms.push('AI Coach');
      if (res.hasLiveBroadcast) formValue.platforms.push('直播培训');
      if (res.autoNudgeRules) {
        formValue.alertRules.laggingLifestyle = res.autoNudgeRules.laggingLifestyle ?? 3;
        formValue.alertRules.laggingMono = res.autoNudgeRules.laggingMono ?? 1;
        formValue.alertRules.startDelayPercent = res.autoNudgeRules.startDelayPercent ?? 50;
        formValue.alertRules.deadlineCrisisHours = res.autoNudgeRules.deadlineCrisisHours ?? 24;
        formValue.alertRules.deadlineCrisisHoursSecondary =
          res.autoNudgeRules.deadlineCrisisHoursSecondary ?? 48;
      }
    } catch (e: any) {
      message.error('加载任务详情失败: ' + (e.message || '未知错误'));
    }
  };

  watch(
    () => route.query.id,
    (newId) => {
      if (newId) {
        editTaskId.value = newId as string;
        loadTaskDetail(editTaskId.value);
      } else {
        // 重置表单
        editTaskId.value = '';
        taskStatus.value = 'draft';
        formValue.taskName = '';
        formValue.description = defaultDesc;
        formValue.startTime = null;
        formValue.passScore = 80;
        formValue.endTime = null;
        formValue.platforms = ['MyPal'];
        formValue.coverage = '全员';
      }
    },
    { immediate: true }
  );

  onActivated(() => {
    // 处理 KeepAlive 模式下，切回组件时数据能够重新拉取（如在看板页面做了删除、修改等）
    if (editTaskId.value) {
      loadTaskDetail(editTaskId.value);
    } else if (!route.query.id) {
      // 如果没有ID参数，确保状态是干净的
      editTaskId.value = '';
      taskStatus.value = 'draft';
      formValue.taskName = '';
      formValue.description = defaultDesc;
      formValue.startTime = null;
      formValue.passScore = 80;
      formValue.endTime = null;
      formValue.platforms = ['MyPal'];
      formValue.coverage = '全员';
    }
  });

  const coverageOptions = [
    { label: '全员 (All)', value: '全员' },
    { label: 'Multibrand', value: 'Multibrand' },
    { label: 'Monobrand', value: 'Monobrand' },
    { label: 'Education', value: 'Education' },
  ];

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
    coverage: { required: true, message: '请选择覆盖范围', trigger: 'change' },
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
      // 已下发：可改截止时间 + 预警规则（与后端 PATCH dispatched 分支一致）
      return {
        ddlAt,
        autoNudgeRules: {
          laggingLifestyle: formValue.alertRules.laggingLifestyle,
          laggingMono: formValue.alertRules.laggingMono,
          startDelayPercent: formValue.alertRules.startDelayPercent,
          deadlineCrisisHours: formValue.alertRules.deadlineCrisisHours,
          deadlineCrisisHoursSecondary: formValue.alertRules.deadlineCrisisHoursSecondary,
        },
      };
    }

    const isAll = formValue.coverage === '全员';

    return {
      title: formValue.taskName,
      description: formValue.description,
      hasMypal: formValue.platforms.includes('MyPal'),
      hasSmartSell: formValue.platforms.includes('Sales Coach'),
      hasAiDemo: formValue.platforms.includes('AI Coach'),
      hasLiveBroadcast: formValue.platforms.includes('直播培训'),
      startAt,
      passScore: formValue.passScore ?? 80,
      ddlAt,
      storeScope: isAll ? 'all' : [],
      rtmFilter: isAll ? null : [{ rtm: formValue.coverage }],
      autoNudgeRules: {
        laggingLifestyle: formValue.alertRules.laggingLifestyle,
        laggingMono: formValue.alertRules.laggingMono,
        startDelayPercent: formValue.alertRules.startDelayPercent,
        deadlineCrisisHours: formValue.alertRules.deadlineCrisisHours,
        deadlineCrisisHoursSecondary: formValue.alertRules.deadlineCrisisHoursSecondary,
      },
    };
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
            message.success('任务截止时间更新成功！');
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
    padding: 24px 32px;
    min-height: 100%;
    background-color: #f0f2f5; /* 经典的企服底色 */
    display: flex;
    justify-content: center;
    font-family: 'PingFang SC', 'Helvetica Neue', Helvetica, Arial, 'Hiragino Sans GB',
      'Microsoft Yahei', sans-serif;
  }

  .publish-container {
    width: 100%;
    max-width: 1100px;
  }

  .publish-header {
    margin-bottom: 24px;
    text-align: left;

    .title {
      font-size: 20px;
      font-weight: 600;
      color: #1f2937;
      margin: 0 0 8px 0;
    }

    .desc {
      font-size: 14px;
      color: #6b7280;
      margin: 0;
    }
  }

  .form-section {
    width: 100%;

    .form-card {
      border-radius: 4px; /* 商业化通常用小圆角 */
      box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05); /* 极克制的阴影 */
      margin-bottom: 24px;
      background: #ffffff;
      border: 1px solid #e5e7eb;

      :deep(.n-card-header) {
        padding: 16px 24px;
        border-bottom: 1px solid #f3f4f6;
        .n-card-header__main {
          font-weight: 600;
          font-size: 16px;
          color: #111827;
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
            background-color: #2563eb;
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
    border-radius: 4px;
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
        line-height: 1.6;
      }
    }

    .ai-btn-wrapper {
      position: absolute;
      right: 12px;
      bottom: 12px;
      z-index: 10;
    }

    .ai-btn {
      border-radius: 4px;
      font-weight: 500;
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      color: #2563eb;

      &:hover {
        background: #dbeafe;
        border-color: #93c5fd;
      }
    }
  }

  /* 复选框美化 */
  :deep(.n-checkbox-group) {
    width: 100%;
    padding: 12px 16px;
    background: #f9fafb;
    border-radius: 4px;
    border: 1px solid #f3f4f6;
  }

  .submit-wrapper {
    margin-top: 24px;
    padding-top: 24px;
    border-top: 1px solid #e5e7eb;
    display: flex;
    gap: 16px;
    justify-content: flex-end; /* 商业后台按钮通常在右下角 */
    width: 100%;

    .submit-btn {
      width: auto;
      min-width: 120px;
      border-radius: 4px;
      font-weight: 500;
    }

    .cancel-btn {
      width: auto;
      min-width: 90px;
      border-radius: 4px;
      font-weight: 500;
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
      color: #1f2937;
    }
  }

  .rule-body {
    background-color: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 4px;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .rule-row {
    display: flex;
    align-items: center;
    font-size: 14px;
    color: #374151;
  }

  .rule-label {
    width: 140px;
    font-weight: 500;
    color: #4b5563;
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
      color: #2563eb;
    }
  }

  .unit-text {
    margin-left: -4px;
    font-weight: 500;
  }
</style>
