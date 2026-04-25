const fs = require('fs');

let content = fs.readFileSync('TOT_frontend/src/views/central/newBoard/index.vue', 'utf8');

const funnelModalHtml = `
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
                  @click="fmCurrentDimension = dim.value"
                  :class="[
                    'px-4 py-1.5 text-[13px] font-semibold rounded-md transition-all duration-200 whitespace-nowrap',
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
`;

const targetIndex = content.indexOf('<!-- Alert Modal -->');
content = content.slice(0, targetIndex) + funnelModalHtml + '\n    ' + content.slice(targetIndex);

fs.writeFileSync('TOT_frontend/src/views/central/newBoard/index.vue', content);
