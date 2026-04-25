const fs = require('fs');

let content = fs.readFileSync('TOT_frontend/src/views/central/newBoard/index.vue', 'utf8');

// 1. Restore handleFunnelDrillDown
content = content.replace(
  "const handleFunnelDrillDown = (stage: any) => {\n    alertFilter.value = stage.stage;\n    isAlertModalOpen.value = true;\n  };",
  "const handleFunnelDrillDown = (stage: any) => {\n    selectedFunnelStage.value = stage;\n    isFunnelModalOpen.value = true;\n  };"
);

// 2. Insert fm logic
const fmLogic = `
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
        } else {
          // 'read' or 'in_progress' - fallback to overview if possible, else 0.
          // For safety, let's just make the overview call if NOT store level
          if (fmCurrentDimension.value !== 'store') {
             try {
                const ov = await getDashboardOverview(ovParams).send();
                if (st === 'read') count = ov.employeeReadCount || ov.totalReadCount || 0;
                if (st === 'in_progress') count = (ov.inProgressCount || 0) + (ov.completedCount || 0);
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
`;

const targetIndex = content.indexOf('const amFilter = ref(alertFilter.value);');
content = content.slice(0, targetIndex) + fmLogic + '\n  ' + content.slice(targetIndex);

fs.writeFileSync('TOT_frontend/src/views/central/newBoard/index.vue', content);
