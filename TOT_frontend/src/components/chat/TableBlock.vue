<template>
  <div v-if="table && table.rows && table.rows.length >= 2" class="table-block">
    <div class="table-title">📋 {{ table.title }}</div>

    <div v-if="isFunnel" class="funnel-view">
      <div v-for="(row, i) in table.rows" :key="i">
        <div class="funnel-bar-row">
          <span class="funnel-label">{{ row[0] }}</span>
          <span class="funnel-value">{{ row[1] }}人 · {{ row[2] }}</span>
        </div>
        <div class="funnel-bar">
          <div class="funnel-fill" :style="{ width: row[2], background: barColors[i % barColors.length] }"></div>
        </div>
        <div v-if="i < table.rows.length - 1" class="funnel-drop">
          ↓ 流失 {{ dropCount(i) }}人 · {{ dropRate(i) }}
        </div>
      </div>
    </div>

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

const barColors = ['#90caf9', '#a5d6a7', '#ffcc80', '#ef9a9a'];

const isFunnel = computed(() => {
  if (!props.table) return false;
  const cols = props.table.columns || [];
  return cols.includes('占比') || cols.includes('流失');
});

function dropCount(i: number) {
  const rows = props.table!.rows;
  const cur = parseInt(rows[i][1]) || 0;
  const next = parseInt(rows[i + 1]?.[1]) || 0;
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
