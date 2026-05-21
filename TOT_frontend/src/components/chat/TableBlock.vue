<template>
  <div v-if="table && table.rows && table.rows.length >= 2" class="table-block">
    <div class="table-title">{{ table.title }}</div>

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

const barColors = ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#fc8452'];

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
.table-block { margin-bottom: 20px; }
.table-title { font-weight: 600; font-size: 13px; color: #1a1f36; margin-bottom: 10px; }
.funnel-bar-row { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 2px; }
.funnel-label { font-size: 13px; color: #1a1f36; }
.funnel-value { font-weight: 600; font-size: 13px; color: #5f6b7a; }
.funnel-bar { height: 10px; background: #f0f2f5; border-radius: 5px; margin-bottom: 2px; }
.funnel-fill { height: 10px; border-radius: 5px; }
.funnel-drop { text-align: center; font-size: 11px; color: #dc2626; margin-bottom: 6px; }
.compact-table { width: 100%; border-collapse: collapse; font-size: 13px;
  th { background: #f8f9fb; padding: 10px 14px; text-align: left; border-bottom: 2px solid #e2e6ed; color: #5f6b7a; font-weight: 600; font-size: 11px; }
  td { padding: 10px 14px; border-bottom: 1px solid #f0f2f5; color: #1a1f36; }
  tr:last-child td { border-bottom: none; }
}
</style>
