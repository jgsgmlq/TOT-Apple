<template>
  <div v-if="steps && steps.length > 0" class="trace-panel">
    <n-collapse>
      <n-collapse-item name="trace">
        <template #header>
          <span class="trace-header">
            <n-icon size="16"><NodeIndexOutlined /></n-icon>
            运行过程
            <n-tag size="tiny" :bordered="false" type="info">{{ steps.length }} 步</n-tag>
          </span>
        </template>
        <div class="trace-timeline">
          <div
            v-for="(step, i) in steps"
            :key="i"
            class="trace-step"
          >
            <!-- Connector line -->
            <div class="trace-connector">
              <div
                class="trace-dot"
                :class="dotClass(step)"
                :title="step.type"
              ></div>
              <div v-if="i < steps.length - 1" class="trace-line"></div>
            </div>

            <!-- Content -->
            <div class="trace-body">
              <div class="trace-top">
                <span class="trace-node">{{ formatNodeName(step) }}</span>
                <span class="trace-time">{{ step.ts > 1000 ? (step.ts / 1000).toFixed(1) + 's' : step.ts + 'ms' }}</span>
              </div>

              <!-- node_enter / node_exit -->
              <div v-if="step.type === 'node_enter' || step.type === 'node_exit'" class="trace-detail">
                <template v-if="step.type === 'node_exit' && step.data">
                  <span v-if="step.data.step !== undefined" class="trace-tag">step {{ step.data.step }}</span>
                  <span v-if="step.data.snippets !== undefined" class="trace-tag">{{ step.data.snippets }} memories</span>
                  <span v-if="step.data.mode" class="trace-tag">mode={{ step.data.mode }}</span>
                  <span v-if="step.data.hasTools !== undefined" class="trace-tag">{{ step.data.hasTools ? '有工具调用' : '无工具调用' }}</span>
                  <span v-if="step.data.callNames" class="trace-tag">{{ step.data.callNames.join(', ') }}</span>
                  <span v-if="step.data.executed !== undefined" class="trace-tag">{{ step.data.executed }} tools executed</span>
                  <span v-if="step.data.merged !== undefined" class="trace-tag">{{ step.data.merged }} msgs merged</span>
                  <span v-if="step.data.template" class="trace-tag">template={{ step.data.template }}</span>
                  <span v-if="step.data.tables !== undefined" class="trace-tag">{{ step.data.tables }} tables</span>
                  <span v-if="step.data.charts !== undefined" class="trace-tag">{{ step.data.charts }} charts</span>
                  <span v-if="step.data.bytes !== undefined" class="trace-tag">{{ (step.data.bytes as number) > 1024 ? ((step.data.bytes as number) / 1024).toFixed(1) + 'KB' : step.data.bytes + 'B' }}</span>
                  <span v-if="step.data.aborted" class="trace-tag error">aborted</span>
                  <span v-if="step.data.error" class="trace-tag error">{{ step.data.error }}</span>
                  <span v-if="step.data.fallback" class="trace-tag warn">fallback</span>
                </template>
              </div>

              <!-- decision -->
              <div v-if="step.type === 'decision'" class="trace-detail trace-decision">
                <span class="trace-decision-label">{{ step.data.decision }}</span>
                <span v-if="step.data.reason" class="trace-reason">{{ step.data.reason }}</span>
                <span v-if="step.data.total !== undefined" class="trace-tag">total={{ step.data.total }}</span>
                <span v-if="step.data.deduped !== undefined" class="trace-tag">{{ step.data.deduped }} deduped</span>
                <span v-if="step.data.pending !== undefined" class="trace-tag">{{ step.data.pending }} pending</span>
              </div>

              <!-- tool_call -->
              <div v-if="step.type === 'tool_call'" class="trace-detail trace-tool">
                <span class="trace-tool-name">{{ step.data.tool }}</span>
                <span v-if="step.data.args && Object.keys(step.data.args as any).length > 0" class="trace-args-inline">
                  <template v-for="(v, k, idx) in (step.data.args as Record<string, unknown>)" :key="k">
                    <span v-if="idx > 0" class="trace-args-sep">, </span>
                    <span class="trace-arg-key">{{ k }}=</span>
                    <span class="trace-arg-val">{{ formatArgValue(v) }}</span>
                  </template>
                </span>
                <span v-else class="trace-args-empty">(无参数)</span>
              </div>

              <!-- tool_result -->
              <div v-if="step.type === 'tool_result'" class="trace-detail trace-result">
                <span :class="step.data.ok ? 'trace-ok' : 'trace-fail'">{{ step.data.ok ? 'OK' : 'FAIL' }}</span>
                <span v-if="step.data.total !== undefined" class="trace-tag">共 {{ step.data.total }} 条</span>
                <span v-if="step.data.rows !== undefined" class="trace-tag">{{ step.data.rows }} rows</span>
                <span v-if="step.data.taskName" class="trace-tag">{{ step.data.taskName }}</span>
                <span v-if="step.data.error" class="trace-tag error">{{ step.data.error }}</span>
              </div>

              <!-- llm_generation -->
              <div v-if="step.type === 'llm_generation'" class="trace-detail trace-llm">
                <span v-if="step.data.step !== undefined" class="trace-tag">step {{ step.data.step }}/{{ step.data.maxSteps }}</span>
                <span v-if="step.data.chunks !== undefined" class="trace-tag">{{ step.data.chunks }} chunks</span>
                <span v-if="step.data.latencyMs !== undefined" class="trace-tag">{{ step.data.latencyMs }}ms</span>
                <span v-if="step.data.toolCallCount > 0" class="trace-tag">{{ step.data.toolCallCount }} tools</span>
                <span v-if="step.data.toolCallNames?.length" class="trace-tag">{{ (step.data.toolCallNames as string[]).join(', ') }}</span>
                <span v-if="!step.data.toolCallCount" class="trace-tag dim">no tool calls</span>
                <span v-if="step.data.isOverCap" class="trace-tag warn">over cap</span>
              </div>
            </div>
          </div>
        </div>
      </n-collapse-item>
    </n-collapse>
  </div>
</template>

<script setup lang="ts">
import { NodeIndexOutlined } from '@vicons/antd';

interface TraceStep {
  ts: number;
  type: string;
  node?: string;
  data: Record<string, unknown>;
}

const props = defineProps<{
  steps?: TraceStep[] | null;
}>();

function formatArgValue(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(', ') + ']';
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function dotClass(step: TraceStep) {
  switch (step.type) {
    case 'node_enter': return 'dot-enter';
    case 'node_exit': return 'dot-exit';
    case 'decision': return 'dot-decision';
    case 'tool_call': return 'dot-tool-call';
    case 'tool_result': return 'dot-tool-result';
    case 'llm_generation': return 'dot-llm';
    default: return '';
  }
}

function formatNodeName(step: TraceStep): string {
  if (step.type === 'node_enter') return step.node || '';
  if (step.type === 'node_exit') return `${step.node || ''} 完成`;
  if (step.type === 'decision') return `决策: ${step.node || ''}`;
  if (step.type === 'tool_call') return `调用工具`;
  if (step.type === 'tool_result') return `工具结果`;
  if (step.type === 'llm_generation') return `LLM 推理`;
  return step.type;
}
</script>

<style lang="less" scoped>
.trace-panel {
  margin-top: 12px;
}

.trace-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #5f6b7a;
}

.trace-timeline {
  padding: 8px 0 4px;
}

.trace-step {
  display: flex;
  gap: 10px;
  min-height: 32px;
}

.trace-connector {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 18px;
  flex-shrink: 0;
  padding-top: 6px;
}

.trace-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;

  &.dot-enter { background: #91cc75; }
  &.dot-exit { background: #a0aec0; }
  &.dot-decision { background: #5470c6; }
  &.dot-tool-call { background: #fac858; }
  &.dot-tool-result { background: #ee6666; }
  &.dot-llm { background: #73c0de; }
}

.trace-line {
  width: 2px;
  flex: 1;
  min-height: 10px;
  background: #e2e6ed;
  margin: 2px 0;
}

.trace-body {
  flex: 1;
  padding: 3px 0 12px;
}

.trace-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 2px;
}

.trace-node {
  font-size: 13px;
  font-weight: 600;
  color: #1a1f36;
}

.trace-time {
  font-size: 11px;
  color: #a0aec0;
  font-variant-numeric: tabular-nums;
}

.trace-detail {
  font-size: 12px;
  color: #5f6b7a;
  line-height: 1.6;
}

.trace-decision-label {
  font-weight: 600;
  color: #5470c6;
  margin-right: 8px;
}

.trace-reason {
  color: #a0aec0;
  font-style: italic;
  margin-right: 8px;
}

.trace-tool-name {
  font-weight: 600;
  font-family: monospace;
  font-size: 12px;
  margin-right: 8px;
}

.trace-ok { color: #16a34a; font-weight: 600; margin-right: 8px; }
.trace-fail { color: #dc2626; font-weight: 600; margin-right: 8px; }

.trace-args-inline {
  font-size: 11px;
  color: #5f6b7a;
  font-family: monospace;
  word-break: break-all;
}

.trace-args-sep {
  color: #cbd5e1;
}

.trace-arg-key {
  color: #8f99a8;
}

.trace-arg-val {
  color: #1a1f36;
}

.trace-args-empty {
  font-size: 11px;
  color: #cbd5e1;
  font-style: italic;
}

.trace-tag {
  display: inline-block;
  margin-right: 6px;
  padding: 1px 6px;
  background: #f0f2f5;
  border-radius: 3px;
  font-size: 11px;
  font-family: monospace;
  &.dim { color: #a0aec0; }
  &.warn { background: #fef3c7; color: #92400e; }
  &.error { background: #fee2e2; color: #dc2626; }
}
</style>
