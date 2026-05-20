# 前端 Chat 回复卡片重设计 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Executive Chat 前端回复从纯 Markdown 文本升级为结构化卡片渲染 (Hero + KeyGrid + Table + Insights + Chips + HITL Picker)

**Architecture:** 在 `src/views/executive/index.vue` 的 assistant 消息模板中，用新组件替换原有 `{{ ap }}` / Markdown 渲染。每个组件接收 `replyContent` 对应字段，内部处理空值降级。

**Tech Stack:** Vue 3 + TypeScript + Naive UI + Less

---

## Task 1: 创建 KeyGrid 组件

**Files:**
- Create: `TOT_frontend/src/components/chat/KeyGrid.vue`

- [ ] **Step 1: 写组件**

```vue
<template>
  <div v-if="items.length" class="key-grid">
    <div
      v-for="k in items" :key="k.label"
      class="key-cell"
      :style="{ color: cellColor(k) }"
    >
      <span class="key-value">{{ k.value }}{{ k.unit ? `<small>${k.unit}</small>` : '' }}</span>
      <span class="key-label">{{ k.label }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  items: Array<{ label: string; value: string | number; unit?: string }>;
}>();

function cellColor(k: { label: string; value: string | number }) {
  const v = String(k.value);
  if (k.label.includes('完成') && !k.label.includes('未')) return '#2e7d32';
  if (k.label.includes('未完成')) return '#c62828';
  return '#1a1a2e';
}
</script>

<style lang="less" scoped>
.key-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
  gap: 6px;
  margin-bottom: 12px;
}
.key-cell {
  text-align: center;
  padding: 10px 4px;
  border-radius: 8px;
  background: #f8f9fa;
}
.key-value {
  display: block;
  font-size: 18px;
  font-weight: 700;
}
.key-label {
  font-size: 11px;
  color: #888;
  margin-top: 2px;
}
</style>
```

- [ ] **Step 2: 运行 pnpm build 确认编译**

```bash
cd TOT_frontend && pnpm build 2>&1 | tail -5
```

Expected: 无 TypeScript 编译错误。

- [ ] **Step 3: 提交**

```bash
git add TOT_frontend/src/components/chat/KeyGrid.vue
git commit -m "feat: add KeyGrid component for keyNumbers display"
```

---

## Task 2: 创建 InsightList 组件

**Files:**
- Create: `TOT_frontend/src/components/chat/InsightList.vue`

- [ ] **Step 1: 写组件**

```vue
<template>
  <div v-if="items.length" class="insight-list">
    <div
      v-for="(p, i) in items" :key="i"
      class="insight-item"
      :class="'insight-' + getLevel(p)"
    >
      <span class="insight-icon">{{ getIcon(p) }}</span>
      <span class="insight-text">{{ getText(p) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  items: Array<string | { level: 'warning' | 'info' | 'positive'; text: string }>;
}>();

function getLevel(p: any) { return typeof p === 'string' ? 'info' : p.level; }
function getIcon(p: any) { return getLevel(p) === 'warning' ? '⚠️' : getLevel(p) === 'positive' ? '✅' : 'ℹ️'; }
function getText(p: any) { return typeof p === 'string' ? p : (p.text || ''); }
</script>

<style lang="less" scoped>
.insight-list { margin-bottom: 12px; }
.insight-item {
  padding: 8px 10px; margin-bottom: 4px; border-radius: 6px; font-size: 13px;
  border-left: 3px solid;
  &.insight-warning { background: #fff3e0; border-color: #e65100; }
  &.insight-info { background: #e3f2fd; border-color: #1565c0; }
  &.insight-positive { background: #e8f5e9; border-color: #2e7d32; }
}
.insight-icon { margin-right: 6px; }
</style>
```

- [ ] **Step 2: 运行 pnpm build 确认编译**

```bash
cd TOT_frontend && pnpm build 2>&1 | tail -5
```

- [ ] **Step 3: 提交**

```bash
git add TOT_frontend/src/components/chat/InsightList.vue
git commit -m "feat: add InsightList component for attentionPoints"
```

---

## Task 3: 创建 TableBlock 组件

**Files:**
- Create: `TOT_frontend/src/components/chat/TableBlock.vue`

- [ ] **Step 1: 写组件（紧凑表 + 漏斗进度条双模式）**

```vue
<template>
  <div v-if="table && table.rows.length >= 2" class="table-block">
    <div class="table-title">{{ table.title }}</div>

    <!-- 漏斗模式：4列 (阶段/人数/占比/流失) → 进度条 -->
    <div v-if="isFunnel" class="funnel-view">
      <div v-for="(row, i) in table.rows" :key="i">
        <div class="funnel-bar-row">
          <span class="funnel-label">{{ icons[i] || '📌' }} {{ row[0] }}</span>
          <span class="funnel-value">{{ row[1] }}人 · {{ row[2] }}</span>
        </div>
        <div class="funnel-bar">
          <div class="funnel-fill" :style="{ width: row[2], background: barColors[i % barColors.length] }"></div>
        </div>
        <div v-if="i < table.rows.length - 1" class="funnel-drop">
          ↓ 流失 {{ dropCount(i) }} · {{ dropRate(i) }}
        </div>
      </div>
    </div>

    <!-- 紧凑表模式 -->
    <table v-else class="compact-table">
      <thead><tr><th v-for="c in table.columns" :key="c">{{ c }}</th></tr></thead>
      <tbody>
        <tr v-for="(row, i) in table.rows" :key="i">
          <td v-for="(cell, j) in row" :key="j">{{ cell }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  table: { title: string; columns: string[]; rows: string[][] } | null | undefined;
}>();

const icons = ['📤', '✅', '📖', '🎯'];
const barColors = ['#90caf9', '#a5d6a7', '#ffcc80', '#ef9a9a'];

const isFunnel = computed(() => {
  if (!props.table) return false;
  const cols = props.table.columns;
  return cols.length >= 3 && (cols.includes('占比') || cols.includes('流失'));
});

function dropCount(i: number) {
  const rows = props.table!.rows;
  const cur = parseInt(rows[i][1]) || 0;
  const next = parseInt(rows[i + 1][1]) || 0;
  return cur - next;
}
function dropRate(i: number) {
  const rows = props.table!.rows;
  const cur = parseInt(rows[i][1]) || 1;
  const drop = dropCount(i);
  return ((drop / cur) * 100).toFixed(1) + '%';
}
</script>

<style lang="less" scoped>
.table-block { margin-bottom: 12px; }
.table-title { font-weight: 600; font-size: 13px; color: #555; margin-bottom: 8px; }
.funnel-bar-row { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 2px; }
.funnel-label { font-size: 13px; }
.funnel-value { font-weight: 600; font-size: 13px; }
.funnel-bar { height: 10px; background: #e0e0e0; border-radius: 5px; margin-bottom: 2px; }
.funnel-fill { height: 10px; border-radius: 5px; }
.funnel-drop { text-align: center; font-size: 11px; color: #c62828; margin-bottom: 6px; }
.compact-table { width: 100%; border-collapse: collapse; font-size: 13px;
  th { background: #f5f5f5; padding: 8px; text-align: left; border-bottom: 1px solid #e0e0e0; }
  td { padding: 8px; border-bottom: 1px solid #f0f0f0; }
}
</style>
```

- [ ] **Step 2: pnpm build 确认编译**

```bash
cd TOT_frontend && pnpm build 2>&1 | tail -5
```

- [ ] **Step 3: 提交**

```bash
git add TOT_frontend/src/components/chat/TableBlock.vue
git commit -m "feat: add TableBlock component with funnel and compact modes"
```

---

## Task 4: 创建 SuggestChips 组件

**Files:**
- Create: `TOT_frontend/src/components/chat/SuggestChips.vue`

- [ ] **Step 1: 写组件**

```vue
<template>
  <div v-if="items.length" class="suggest-chips">
    <span class="suggest-title">💡 建议追问：</span>
    <div class="chips-wrap">
      <span
        v-for="(s, i) in items" :key="i"
        class="chip"
        @click="$emit('select', s)"
      >{{ s }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ items: string[] }>();
defineEmits<{ select: [text: string] }>();
</script>

<style lang="less" scoped>
.suggest-chips { margin-top: 8px; }
.suggest-title { font-size: 12px; color: #888; margin-bottom: 6px; display: block; }
.chips-wrap { display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
  flex-shrink: 0; background: #e8eaf6; padding: 6px 14px; border-radius: 16px;
  font-size: 12px; cursor: pointer; transition: background .15s;
  &:hover { background: #c5cae9; }
}
</style>
```

- [ ] **Step 2: pnpm build 确认编译**

```bash
cd TOT_frontend && pnpm build 2>&1 | tail -5
```

- [ ] **Step 3: 提交**

```bash
git add TOT_frontend/src/components/chat/SuggestChips.vue
git commit -m "feat: add SuggestChips component for followUpSuggestions"
```

---

## Task 5: 改造 index.vue — 用新组件替换原有模板

**Files:**
- Modify: `TOT_frontend/src/views/executive/index.vue`

- [ ] **Step 1: 导入新组件**

在 script 区顶部添加：

```ts
import KeyGrid from '@/components/chat/KeyGrid.vue';
import InsightList from '@/components/chat/InsightList.vue';
import TableBlock from '@/components/chat/TableBlock.vue';
import SuggestChips from '@/components/chat/SuggestChips.vue';
```

- [ ] **Step 2: 替换 assistant 消息的卡片渲染区**

找到 assistant 消息的 template 区域（`v-if="msg.role === 'assistant'"`），将 keyNumbers 部分替换：

替换前（约 line 323-332）:
```html
<div v-if="msg.replyContent.keyNumbers?.length" class="key-numbers">
  <div v-for="k in msg.replyContent.keyNumbers" :key="k.label" class="kn-item">
    <span class="kn-value">{{ k.value }}</span><span class="kn-unit">{{ k.unit || '' }}</span>
    <span class="kn-label">{{ k.label }}</span>
  </div>
</div>
```

替换后:
```html
<KeyGrid :items="msg.replyContent.keyNumbers" />
```

- [ ] **Step 3: 替换 attentionPoints 部分**

替换前 (约 line 333-337):
```html
<ul v-if="msg.replyContent.attentionPoints?.length" class="exec-attn">
  <li v-for="(ap, ai) in msg.replyContent.attentionPoints" :key="ai" :class="...">
    <span ...>...</span>
    {{ typeof ap === 'string' ? ap : ap.text || ap.message || '' }}
  </li>
</ul>
```

替换后:
```html
<InsightList :items="msg.replyContent.attentionPoints" />
```

- [ ] **Step 4: 替换 followUpSuggestions 部分**

替换前 (约 line 338-353):
```html
<div v-if="msg.replyContent.followUpSuggestions?.length" class="exec-follow">
  <div class="exec-follow-title">💡 建议追问：</div>
  <div class="exec-follow-bubbles">
    <n-button v-for="(sug, si) in msg.replyContent.followUpSuggestions" ...>{{ sug }}</n-button>
  </div>
</div>
```

替换后:
```html
<SuggestChips :items="msg.replyContent.followUpSuggestions" @select="sendPreset" />
```

同时在 script 区添加 `sendPreset` 函数:
```ts
function sendPreset(text: string) {
  inputText.value = text;
  doSend();
}
```

- [ ] **Step 5: 添加 TableBlock**

在 KeyGrid 和 InsightList 之间插入:
```html
<TableBlock v-if="msg.replyContent.table" :table="msg.replyContent.table" />
```

- [ ] **Step 6: 添加 Hero 概述**

在 overview 段落样式改为 Hero 卡片:
```html
<div v-if="msg.replyContent.overview" class="hero-card">
  <div class="hero-body">{{ msg.replyContent.overview }}</div>
</div>
```

添加 Hero 卡片样式到 `<style scoped>`:
```less
.hero-card {
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff; padding: 14px 16px; border-radius: 12px; margin-bottom: 12px;
  font-size: 15px; line-height: 1.6;
}
```

- [ ] **Step 7: pnpm build 确认编译**

```bash
cd TOT_frontend && pnpm build 2>&1 | tail -5
```

- [ ] **Step 8: 提交**

```bash
git add TOT_frontend/src/views/executive/index.vue
git commit -m "feat: replace inline templates with KeyGrid, InsightList, TableBlock, SuggestChips, Hero card"
```

---

## Task 6: E2E 验证

- [ ] **Step 1: 清 Vite 缓存 + 重启前端**

```bash
pkill -f vite 2>/dev/null; sleep 1
rm -rf TOT_frontend/node_modules/.vite
cd TOT_frontend && pnpm dev 2>&1 &
sleep 4
```

- [ ] **Step 2: 后端确认运行中**

```bash
curl -s http://localhost:3000/api/health
```

Expected: `{"ok":true,"service":"mvp-lan-api"}`

- [ ] **Step 3: 打开浏览器，登录 Executive Chat**

打开 `http://localhost:8001/executive/login`，用 `central` / `Train2026!` 登录。

- [ ] **Step 4: 发送测试消息**

发送 "iPad mini 培训完成率怎么样？"，验证：
- Hero 卡片渐变紫底显示概述 ✅
- KeyGrid 4 列网格显示关键数字 ✅
- InsightList 色条显示 3 条洞察 ✅
- TableBlock 漏斗进度条显示阶段分布 ✅
- SuggestChips 显示追问建议按钮 ✅
- 点击 chip 能发消息 ✅

- [ ] **Step 5: 提交（如有新文件）**

```bash
git add -A && git commit -m "test: E2E verify frontend card redesign"
```

---

## 不改的文件

- 后端所有文件
- `src/api/chat/index.ts` (类型已更新)
- `src/utils/execStreamReply.ts` (流式解析逻辑不变)
- 店员端、总部看板端
