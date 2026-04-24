<template>
  <div
    class="app-wrapper max-w-2xl mx-auto min-h-[100dvh] relative pb-24"
    @touchstart="touchStart"
    @touchmove="touchMove"
    @touchend="touchEnd"
  >
    <div
      v-if="showToastAlert"
      class="fixed top-10 left-1/2 -translate-x-1/2 bg-white text-slate-800 px-6 py-3 rounded-full shadow-lg border border-slate-100 font-bold z-[100] transition-opacity flex items-center gap-2"
    >
      <i data-lucide="check-circle-2" class="text-brand-green w-5 h-5"></i>
      {{ toastMsg }}
    </div>

    <div class="w-full pt-[env(safe-area-inset-top)]">
      <div
        :style="{
          height: isRefreshing ? '80px' : pullDistance + 'px',
          opacity: isRefreshing || pullDistance > 0 ? 1 : 0,
        }"
        class="flex items-center justify-center smooth-transition overflow-hidden"
      >
        <div
          class="w-10 h-10 rounded-full bg-white shadow-md border border-slate-100 flex items-center justify-center"
          :style="{ transform: `rotate(${isRefreshing ? 0 : pullDistance * 4}deg)` }"
        >
          <i
            data-lucide="refresh-cw"
            class="w-5 h-5 text-brand-green"
            :class="{ 'animate-spin': isRefreshing }"
          ></i>
        </div>
      </div>

      <div class="px-6 pt-12 pb-6">
        <div class="flex items-center justify-between mb-3 relative">
          <div class="flex items-center gap-3">
            <h1 class="text-[32px] font-bold text-slate-900 tracking-tight">Hi, {{ profile.name }}</h1>
            <div
              class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#E8F3EC] border border-[#349658]/20 text-[#2A7A46] rounded-full shadow-sm"
            >
              <i data-lucide="map-pin" class="w-4 h-4 text-[#349658] opacity-80"></i>
              <span class="text-[13px] font-bold tracking-tight">{{ profile.storeName }}</span>
            </div>
          </div>
          <div class="relative">
            <div
              @click="logoutMenuOpen = !logoutMenuOpen"
              class="w-12 h-12 rounded-full flex items-center justify-center text-white font-semibold text-[18px] tracking-wide shadow-sm border border-[#2A4C36] cursor-pointer hover:ring-4 hover:ring-brand-green/20 hover:scale-[1.02] smooth-transition bg-gradient-to-tr from-[#3C6A4B] to-[#659976]"
            >
              {{ profile.name.charAt(0).toUpperCase() }}
            </div>
            
            <!-- 增加全屏透明遮罩，点击外部收起下拉菜单 -->
            <div v-if="logoutMenuOpen" class="fixed inset-0 z-[60]" @click="logoutMenuOpen = false"></div>
            
            <div
              v-show="logoutMenuOpen"
              class="absolute top-full right-0 mt-2 w-36 bg-white border border-slate-200 rounded-[1rem] shadow-[0_8px_30px_rgb(0,0,0,0.12)] p-1.5 z-[70] animate-in fade-in zoom-in-95 duration-200"
            >
              <button
                @click="handleLogout"
                class="w-full flex items-center gap-2 px-3 py-2 text-accent-red font-bold text-[14px] rounded-[0.75rem] hover:bg-red-50 smooth-transition"
              >
                <i data-lucide="log-out" class="w-4 h-4 stroke-[2.5]"></i> 退出登录
              </button>
            </div>
          </div>
        </div>
        <p class="text-[16px] text-slate-500 font-bold">今天也是元气满满的一天！</p>
      </div>

      <div class="px-5 pb-6" v-if="tasks.length > 0">
        <div class="space-y-4">
          <div
            v-if="urgentCount > 0"
            class="flex items-center justify-between py-3.5 px-5 bg-[#FFF5F0] rounded-[1rem] shadow-[0_4px_12px_rgba(226,84,56,0.06)] border border-[#FFE4D6]/60"
          >
            <div>
              <h2 class="text-[15px] font-bold text-[#B23A1F] tracking-tight leading-snug mb-0.5"
                >你有 {{ urgentCount }} 项紧急任务待完成</h2
              >
              <p class="text-[13px] text-[#E25438] font-medium opacity-90"
                >最近截止：{{ formatShortDeadline(closestUrgentDeadline) }}</p
              >
            </div>
            <div class="w-8 h-8 rounded-full bg-white/60 flex items-center justify-center shrink-0">
              <i data-lucide="bell-ring" class="w-4 h-4 text-[#E25438] stroke-[2.5]"></i>
            </div>
          </div>

          <div
            v-for="task in sortedTasks"
            :key="task.id"
            class="rounded-[1.25rem] p-5 relative cursor-pointer border smooth-transition"
            :class="[
              getCardStatusClass(task.status),
              task.status !== 'overdue' ? 'hover:shadow-[0_8px_30px_rgb(0,0,0,0.04)]' : '',
            ]"
            @click="
              task.type === 'single' ? handleDetail(task) : (task._expanded = !task._expanded)
            "
          >
            <template v-if="task.type === 'single'">
              <div class="flex items-center justify-between mb-3">
                <div class="flex items-center gap-2">
                  <span
                    v-if="
                      task.status === 'urgent' || task.status === 'nudging' || task.status === 'new'
                    "
                    class="relative flex h-2.5 w-2.5"
                  >
                    <span
                      class="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 scale-150"
                      :style="{ backgroundColor: getStatusColor(task.status) }"
                    ></span>
                    <span
                      class="relative inline-flex rounded-full h-2.5 w-2.5"
                      :style="{ backgroundColor: getStatusColor(task.status) }"
                    ></span>
                  </span>
                  <span
                    v-else
                    class="w-2.5 h-2.5 rounded-full"
                    :style="{ backgroundColor: getStatusColor(task.status) }"
                  ></span>
                  <span
                    class="px-2.5 py-1 rounded-[0.5rem] text-[13px] font-bold tracking-wide"
                    :class="getPillClass(task.status)"
                    >{{ getStatusLabel(task.status) }}</span
                  >
                </div>
                <span class="text-[13px] font-bold text-slate-400 tracking-wide shrink-0 pl-3">{{
                  task.parentName
                }}</span>
              </div>
              <div class="mb-4">
                <h3 class="text-[20px] font-bold text-slate-900 mb-2.5 leading-snug">{{
                  task.title
                }}</h3>
                <div
                  class="flex items-center text-[13px] text-slate-500 font-semibold"
                  v-if="task.deadline && task.status !== 'new'"
                >
                  <i data-lucide="clock" class="w-4 h-4 mr-1.5 stroke-[2.5]"></i>
                  <span :class="{ 'text-accent-red font-black': isPastDate(task.deadline) }"
                    >剩余 {{ getFormattedRemaining(task.deadline) }}</span
                  >
                </div>
                <div
                  class="flex items-center text-[13px] text-slate-500 font-semibold"
                  v-else-if="task.status === 'new' && task.publishedAt"
                  >总部于 {{ task.publishedAt }} 发布</div
                >
              </div>
              <div class="flex items-end justify-between pt-4 border-t border-slate-100/80 mt-2">
                <span
                  class="px-2.5 py-1 text-[11px] font-bold rounded-[0.5rem] uppercase tracking-wider border w-fit"
                  :class="getPlatformClass(task.platformName)"
                  >{{ task.platformName }}</span
                >
                <button
                  class="flex items-center justify-center gap-1.5 px-6 min-h-[40px] rounded-full text-[14px] font-bold text-white bg-[#349658] shadow-[0_4px_12px_rgba(52,150,88,0.2)] hover:bg-[#2A7A46] hover:-translate-y-[1px] smooth-transition"
                  @click.stop="handleLearn"
                  >立即学习 <i data-lucide="arrow-right" class="w-4 h-4 stroke-[2.5]"></i
                ></button>
              </div>
            </template>

            <template v-if="task.type === 'bundle'">
              <div class="flex items-center justify-between mb-4">
                <div class="flex items-center gap-2">
                  <span
                    v-if="
                      task.status === 'urgent' || task.status === 'nudging' || task.status === 'new'
                    "
                    class="relative flex h-2.5 w-2.5"
                  >
                    <span
                      class="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 scale-150"
                      :style="{ backgroundColor: getStatusColor(task.status) }"
                    ></span>
                    <span
                      class="relative inline-flex rounded-full h-2.5 w-2.5"
                      :style="{ backgroundColor: getStatusColor(task.status) }"
                    ></span>
                  </span>
                  <span
                    v-else
                    class="w-2.5 h-2.5 rounded-full"
                    :style="{ backgroundColor: getStatusColor(task.status) }"
                  ></span>
                  <span
                    class="px-2.5 py-1 rounded-[0.5rem] text-[13px] font-bold tracking-wide"
                    :class="getPillClass(task.status)"
                    >{{ getStatusLabel(task.status) }}</span
                  >
                  <div class="flex gap-1.5 ml-1">
                    <span
                      v-if="getBundleUrgentCount(task) > 0"
                      class="px-2 py-0.5 text-[11px] font-bold rounded-md bg-[#FFF9F9] text-[#E25438] border border-red-100 flex items-center"
                      >{{ getBundleUrgentCount(task) }} 紧急</span
                    >
                    <span
                      v-if="getBundleNudgingCount(task) > 0"
                      class="px-2 py-0.5 text-[11px] font-bold rounded-md bg-[#FFFCF0] text-[#DF9D2A] border border-amber-100 flex items-center"
                      >{{ getBundleNudgingCount(task) }} 催办</span
                    >
                  </div>
                </div>
              </div>
              <div class="mb-5">
                <h3 class="text-[20px] font-bold text-slate-900 mb-4 leading-snug">{{
                  task.title
                }}</h3>
                <div class="flex items-center gap-3">
                  <div
                    class="flex-1 h-[4px] bg-slate-100 rounded-full overflow-hidden shadow-[inset_0_1px_2px_rgba(0,0,0,0.05)]"
                  >
                    <div
                      class="h-full rounded-full transition-all duration-700 ease-out"
                      :style="{
                        width: (getBundleCompleted(task) / task.subTasks.length) * 100 + '%',
                        backgroundColor: getBundleProgressColor(task),
                      }"
                    ></div>
                  </div>
                  <span
                    class="text-[12px] font-black tabular-nums tracking-tight"
                    :style="{
                      color:
                        getBundleCompleted(task) === task.subTasks.length ? '#349658' : '#94A3B8',
                    }"
                    >{{ getBundleCompleted(task) }}/{{ task.subTasks.length }}</span
                  >
                </div>
              </div>
              <div v-if="task._expanded" class="mt-4 space-y-3">
                <div
                  v-for="sub in task.subTasks"
                  :key="sub.id"
                  class="p-5 relative overflow-hidden rounded-[1rem] border smooth-transition bg-white/60 hover:bg-white hover:shadow-[0_4px_16px_rgba(0,0,0,0.03)]"
                  @click.stop="handleDetail(sub, task.title)"
                >
                  <div class="flex items-start gap-3">
                    <div class="mt-0.5">
                      <i
                        v-if="sub.completed"
                        data-lucide="check-circle-2"
                        class="w-5 h-5 text-brand-green stroke-[2.5]"
                      ></i>
                      <div v-else class="w-5 h-5 rounded-full border-2 border-slate-300"></div>
                    </div>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center justify-between mb-2">
                        <span
                          class="px-2.5 py-1 text-[11px] font-bold rounded-[0.5rem] uppercase tracking-wider border w-fit"
                          :class="getPlatformClass(sub.platformName)"
                          >{{ sub.platformName }}</span
                        >
                        <div v-if="!sub.completed" class="flex items-center gap-1.5">
                          <span class="relative flex h-1.5 w-1.5">
                            <span
                              v-if="sub.status === 'urgent' || sub.status === 'nudging'"
                              class="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                              :style="{ backgroundColor: getStatusColor(sub.status) }"
                            ></span>
                            <span
                              class="relative inline-flex rounded-full h-1.5 w-1.5"
                              :style="{ backgroundColor: getStatusColor(sub.status) }"
                            ></span>
                          </span>
                          <span
                            class="text-[11px] font-bold tracking-wider uppercase"
                            :style="{ color: getStatusColor(sub.status) }"
                            >{{ getStatusLabel(sub.status) }}</span
                          >
                          <span
                            v-if="
                              (sub.status === 'urgent' || sub.status === 'nudging') && sub.deadline
                            "
                            class="text-[11px] font-bold ml-1 tabular-nums"
                            :style="{ color: getStatusColor(sub.status) }"
                            >剩余 {{ getFormattedRemaining(sub.deadline) }}</span
                          >
                        </div>
                      </div>
                      <div
                        v-if="sub.description"
                        class="bg-white/80 border border-slate-100/80 rounded-xl p-3 mb-3 mt-2 shadow-[inset_0_1px_2px_rgba(0,0,0,0.01)]"
                      >
                        <p
                          class="text-[13px] text-slate-600 font-medium line-clamp-3 leading-relaxed"
                          >{{ sub.description }}</p
                        >
                      </div>
                      <div
                        v-if="!sub.completed"
                        class="flex justify-end mt-2 pt-3 border-t border-slate-100/60"
                      >
                        <button
                          @click.stop="handleLearn"
                          class="flex items-center justify-center gap-1.5 px-5 min-h-[40px] rounded-full text-[13px] font-bold text-white bg-[#349658] shadow-[0_4px_12px_rgba(52,150,88,0.2)] hover:bg-[#2A7A46] hover:-translate-y-[1px] smooth-transition"
                          >立即学习
                          <i data-lucide="arrow-right" class="w-3.5 h-3.5 stroke-[2.5]"></i
                        ></button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div
                class="flex justify-center pt-4 mt-2"
                :class="{ 'border-t border-slate-100/60': !task._expanded }"
              >
                <button
                  class="flex items-center gap-1 text-[14px] font-bold text-slate-500 hover:text-brand-green smooth-transition"
                  >{{ task._expanded ? '收起任务' : '展开任务' }}
                  <i
                    :data-lucide="task._expanded ? 'chevron-up' : 'chevron-down'"
                    class="w-4 h-4 stroke-[3]"
                  ></i
                ></button>
              </div>
            </template>
          </div>

          <div
            v-if="overdueTasks && overdueTasks.length > 0"
            class="bg-[#FAFAFA] rounded-[1.25rem] p-5 relative border border-slate-200 smooth-transition"
          >
            <div class="flex items-center gap-3 mb-5">
              <div
                class="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0"
              >
                <i data-lucide="clock" class="w-5 h-5 text-slate-500 stroke-[2.5]"></i>
              </div>
              <div>
                <h2 class="font-black text-[18px] text-slate-800 uppercase tracking-tight"
                  >已逾期任务</h2
                >
                <p class="text-[13px] text-slate-500 font-bold mt-0.5"
                  >共 {{ overdueTasks.length }} 项需尽快处理</p
                >
              </div>
            </div>
            <div class="space-y-0 relative pl-4">
              <div class="absolute left-1.5 top-3 bottom-3 w-[2px] bg-slate-200"></div>
              <div v-for="ot in displayedOverdueTasks" :key="ot.id" class="relative pb-4 last:pb-0">
                <div
                  class="absolute -left-[18px] top-1.5 w-2.5 h-2.5 rounded-full bg-slate-400 ring-4 ring-slate-100 z-10"
                ></div>
                <div
                  class="bg-white rounded-xl p-4 border border-slate-200 shadow-sm smooth-transition hover:shadow-md cursor-pointer"
                  @click="handleDetail(ot)"
                >
                  <h4
                    class="text-[15px] font-bold text-slate-800 line-clamp-1 leading-snug mb-1.5"
                    >{{ ot.title }}</h4
                  >
                  <p class="text-[13px] text-slate-500 font-semibold flex items-center"
                    ><i data-lucide="calendar" class="w-3.5 h-3.5 mr-1 stroke-[2.5]"></i>截止：{{
                      formatSubDeadline(ot.deadline)
                    }}</p
                  >
                </div>
              </div>
            </div>
            <button
              v-if="overdueTasks.length > 3"
              @click="showAllOverdue = !showAllOverdue"
              class="w-full mt-4 min-h-[40px] text-[13px] font-bold bg-white border border-slate-200 text-slate-600 rounded-full flex items-center justify-center shadow-sm hover:bg-slate-50 smooth-transition"
              >{{ showAllOverdue ? '收起' : '显示更多 (' + (overdueTasks.length - 3) + ')' }}
              <i
                :data-lucide="showAllOverdue ? 'chevron-up' : 'chevron-down'"
                class="w-4 h-4 ml-1 stroke-[2.5]"
              ></i
            ></button>
          </div>

          <div
            v-if="sortedTasks.length === 0"
            class="flex flex-col items-center justify-center py-20 px-6 bg-white rounded-[1.5rem] border border-slate-200"
          >
            <h3 class="text-[20px] font-bold text-slate-800 mb-2 tracking-tight">暂无待处理任务</h3>
            <p class="text-[15px] text-slate-500 font-medium text-center"
              >您已完成所有分配的工作，请稍后回来查看新任务。</p
            >
          </div>
        </div>
      </div>
      <div class="px-5 pb-6" v-else>
        <div class="space-y-4">
          <!-- 全部完成状态 (Empty State Banner) -->
          <div class="flex flex-col items-center justify-center pt-8 pb-10 px-6">
            <div
              class="w-[72px] h-[72px] mb-5 flex items-center justify-center rounded-full bg-[#E8F3EC] border-[3px] border-white shadow-[0_8px_24px_rgba(52,150,88,0.12)] relative"
            >
              <div
                class="absolute inset-0 bg-[#E8F3EC] rounded-full animate-ping opacity-[0.6] scale-[1.3] smooth-transition"
                style="animation-duration: 3s"
              ></div>
              <i
                data-lucide="check"
                class="w-8 h-8 text-[#349658] stroke-[4] z-10 -translate-y-0.5"
              ></i>
            </div>
            <h2
              class="text-[22px] font-black text-slate-900 mb-2 tracking-tight text-center leading-snug"
            >
              全部完成，做得不错！
            </h2>
            <p class="text-[14px] text-slate-500 font-medium text-center leading-relaxed">
              当前无待办事项。接下来可以回顾已完成的学习记录。
            </p>
          </div>

          <!-- 已完成任务列表 (List Style) -->
          <div class="mt-8">
            <div class="flex items-center justify-between mb-3 px-1">
              <h3 class="text-[18px] font-bold text-slate-800 tracking-tight">已完成记录</h3>
              <span
                class="text-[13px] font-bold text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full"
                >{{ completedTasks.length }}</span
              >
            </div>

            <div
              class="bg-white rounded-[1.5rem] border border-slate-200 overflow-hidden shadow-sm"
            >
              <div
                v-for="(task, i) in completedTasks"
                :key="task.id"
                class="flex items-start gap-4 p-5 hover:bg-slate-50 smooth-transition cursor-pointer relative group"
                :class="i !== completedTasks.length - 1 ? 'border-b border-slate-100' : ''"
              >
                <div class="mt-0.5">
                  <i
                    data-lucide="check-circle-2"
                    class="w-5 h-5 text-slate-300 stroke-[2.5] group-hover:text-[#349658] smooth-transition"
                  ></i>
                </div>

                <div class="flex-1 min-w-0">
                  <h4
                    class="text-[16px] font-bold text-slate-700 leading-snug mb-1 line-clamp-1 group-hover:text-slate-900 smooth-transition"
                    >{{ task.title }}</h4
                  >
                  <div class="flex items-center gap-2">
                    <span
                      class="px-2 py-0.5 text-[10px] font-bold bg-[#E8F3EC] text-[#2A7A46] rounded-[0.4rem] uppercase tracking-wider border border-[#349658]/20 w-fit"
                    >
                      {{ task.platformName }}
                    </span>
                    <span class="w-1 h-1 rounded-full bg-slate-300"></span>
                    <span class="text-[12px] font-bold text-slate-500">{{ task.completedAt }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="detailModalOpen" class="fixed inset-0 z-[60] flex items-center justify-center px-4">
      <div
        class="absolute inset-0 bg-black/40 backdrop-blur-sm"
        @click="detailModalOpen = false"
      ></div>
      <div
        class="relative w-full max-w-md bg-white rounded-t-[2rem] rounded-b-[2rem] shadow-2xl flex flex-col overflow-hidden z-10 animate-in fade-in zoom-in-95 duration-200 max-h-[80vh]"
      >
        <div class="px-6 pt-7 pb-5 relative shrink-0">
          <button
            @click="detailModalOpen = false"
            class="absolute top-5 right-5 p-2 bg-slate-100 text-slate-500 rounded-full hover:bg-slate-200 smooth-transition z-10"
            ><i data-lucide="x" class="w-4 h-4 stroke-[3]"></i
          ></button>
          <div v-if="selectedTask?.platformName" class="flex items-center gap-1.5 mb-3"
            ><span
              class="px-2.5 py-1 text-[11px] font-bold rounded-[0.5rem] uppercase tracking-wider border w-fit"
              :class="getPlatformClass(selectedTask.platformName)"
              >{{ selectedTask.platformName }}</span
            ></div
          >
          <h2 class="text-[24px] font-black text-slate-900 leading-snug tracking-tight pr-8">{{
            selectedTask?.title
          }}</h2>
        </div>
        <div class="flex-shrink flex-1 overflow-y-auto px-6 pb-8 space-y-6">
          <div
            class="bg-slate-50/80 border border-slate-100 rounded-[1.25rem] overflow-hidden shrink-0"
          >
            <div
              v-if="selectedTask?.deadline"
              class="flex items-center p-4 border-b border-slate-200/50"
            >
              <div
                class="w-9 h-9 rounded-full bg-white shadow-sm flex items-center justify-center mr-3.5 border border-slate-100 shrink-0"
                ><i data-lucide="clock" class="w-4 h-4 text-brand-green stroke-[2.5]"></i
              ></div>
              <div class="flex-1">
                <div class="text-[12px] text-slate-400 font-bold uppercase tracking-wider mb-0.5"
                  >截止时间</div
                >
                <div class="text-[15px] font-bold text-slate-800">{{
                  formatSubDeadline(selectedTask.deadline)
                }}</div>
              </div>
            </div>
            <div v-if="selectedTask?.passingScore" class="flex items-center p-4">
              <div
                class="w-9 h-9 rounded-full bg-white shadow-sm flex items-center justify-center mr-3.5 border border-slate-100 shrink-0"
                ><i data-lucide="target" class="w-4 h-4 text-brand-green stroke-[2.5]"></i
              ></div>
              <div class="flex-1">
                <div class="text-[12px] text-slate-400 font-bold uppercase tracking-wider mb-0.5"
                  >考核标准</div
                >
                <div class="text-[15px] font-bold text-slate-800"
                  >达标 {{ selectedTask.passingScore }} 分</div
                >
              </div>
            </div>
          </div>
          <div v-if="selectedTask?.description">
            <h4 class="text-[13px] font-bold text-slate-400 uppercase tracking-widest mb-3 ml-1"
              >任务详情</h4
            >
            <div
              class="text-[15px] text-slate-700 leading-relaxed whitespace-pre-wrap font-medium p-5 bg-slate-50 rounded-[1.25rem] border border-slate-100 shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)]"
              >{{ selectedTask.description }}</div
            >
          </div>
        </div>
        <div
          class="px-6 py-5 border-t border-slate-100/60 bg-white/90 backdrop-blur-md shrink-0"
          v-if="selectedTask?.status !== 'overdue'"
        >
          <button
            @click="finishTask"
            class="w-full flex items-center justify-center gap-1.5 min-h-[48px] text-[16px] font-bold text-white bg-[#349658] rounded-full shadow-[0_4px_16px_rgba(52,150,88,0.2)] uppercase tracking-wide hover:shadow-[0_8px_24px_rgba(52,150,88,0.3)] hover:bg-[#2A7A46] hover:-translate-y-[1px] smooth-transition"
            >立即学习 <i data-lucide="arrow-right" class="w-4 h-4 stroke-[2.5]"></i
          ></button>
        </div>
      </div>
    </div>

    <button
      v-show="scrollY > 300"
      @click="scrollToTop"
      class="fixed bottom-6 right-6 w-14 h-14 bg-white border border-slate-200 rounded-full shadow-lg flex items-center justify-center z-50 hover:scale-110 smooth-transition active:scale-95"
      style="
        bottom: max(1.5rem, env(safe-area-inset-bottom));
        right: max(1.5rem, env(safe-area-inset-right));
      "
    >
      <i data-lucide="arrow-up" class="w-6 h-6 text-brand-green stroke-[2.5]"></i>
    </button>
  </div>
</template>
<script setup lang="ts">
  import { ref, computed, onMounted, onUpdated } from 'vue';
  import { useRouter } from 'vue-router';
  import { useUserStore } from '@/store/modules/user';
  import { PageEnum } from '@/enums/pageEnum';

  // We rely on globally injected `lucide` and `confetti` from CDNs.
  const router = useRouter();
  const userStore = useUserStore();

  const now = new Date();
  const addTime = (hours, mins = 0) => {
    const d = new Date(now);
    d.setHours(d.getHours() + hours);
    d.setMinutes(d.getMinutes() + mins);
    return d.toISOString();
  };

  import { Alova } from '@/utils/http/alova/index';

  const profile = ref({
    name: userStore.info?.username || userStore.info?.email || '店员伙伴',
    storeName: '正在加载门店...',
  });

  if (userStore.info?.storeId) {
    Alova.Get(`/stores/${userStore.info.storeId}`)
      .send()
      .then((res: any) => {
        profile.value.storeName = res?.data?.name || res?.name || '未知门店';
      })
      .catch(() => {
        profile.value.storeName = '未知门店';
      });
  } else {
    profile.value.storeName = '未分配门店';
  }

  // Here we can toggle empty vs non-empty by clearing `tasks`
  const tasks = ref([
    {
      id: 't1',
      type: 'single',
      parentName: 'MacBook 培训',
      title: 'MacBook 销售技巧起步异常',
      deadline: addTime(20, 57),
      status: 'urgent',
      platformName: 'SmartSales',
      passingScore: 80,
      description: '针对近期反馈的 MacBook 销售初期引导阶段出现的共性问题进行专项强化培训。',
    },
    {
      id: 't2',
      type: 'single',
      parentName: 'AirPods 培训',
      title: '降噪模式对比讲解话术',
      deadline: addTime(54, 0),
      status: 'nudging',
      platformName: 'MyPAL',
      passingScore: 90,
      description: 'AirPods Pro 2 与 AirPods Max 的主动降噪（ANC）及通透模式的对比演示标准流程。',
    },
    {
      id: 'b1',
      type: 'bundle',
      parentName: 'NPI 专项认证',
      title: 'Apple Vision Pro NPI 认证',
      status: 'urgent',
      subTasks: [
        {
          id: 's1',
          title: 'Apple Vision Pro NPI 认证',
          completed: true,
          platformName: 'MyPAL',
          description: '空间计算设备的入门级认证课程。',
          passingScore: 85,
          status: 'normal',
        },
        {
          id: 's2',
          title: 'Apple Vision Pro NPI 认证',
          completed: false,
          platformName: '直播培训',
          description: '由区域资深专家主持的实操直播演示课。',
          passingScore: 80,
          status: 'urgent',
          deadline: addTime(2, 30),
        },
        {
          id: 's3',
          title: 'Apple Vision Pro NPI 认证',
          completed: false,
          platformName: 'AI Coach',
          description: '利用 AI 驱动的对话系统进行实战化的销售模拟训练。',
          passingScore: 90,
          status: 'nudging',
          deadline: addTime(26, 15),
        },
      ],
      _expanded: false,
    },
    {
      id: 't3',
      type: 'single',
      parentName: 'Vision Pro 介绍',
      title: '空间计算场景与客户沟通指南',
      deadline: addTime(168, 0),
      status: 'normal',
      platformName: '直播培训',
      passingScore: 80,
      description: '如何将空间计算这一超前概念转化为客户可理解的生活场景。',
    },
    {
      id: 't4',
      type: 'single',
      parentName: 'iPad Pro 培训',
      title: 'iPad Pro (M4) 核心优势与话术对练',
      deadline: addTime(48, 0),
      publishedAt: '04-20 10:30',
      status: 'new',
      platformName: 'AI Coach',
      passingScore: 80,
      description: '全新的 iPad Pro (M4) 系列核心优势与对比话术对练。',
    },
  ]);

  const overdueTasks = ref([
    {
      id: 'o1',
      parentName: 'AirPods 培训',
      title: 'AirPods Pro 2 产品培训',
      deadline: addTime(-2, 0),
      status: 'overdue',
      platformName: 'MyPAL',
      description: '已过期的基础培训。',
    },
    {
      id: 'o2',
      parentName: '合规培训',
      title: '客户隐私保护政策学习',
      deadline: addTime(-26, 0),
      status: 'overdue',
      platformName: 'SmartSales',
      description: '极度重要的合规课程。',
    },
    {
      id: 'o3',
      parentName: 'Watch 培训',
      title: 'Apple Watch Ultra 2 功能介绍',
      deadline: addTime(-50, 0),
      status: 'overdue',
      platformName: 'MyPAL',
      description: '介绍了 S9 SiP 芯片、3000 尼特峰值亮度以及潜水探测等极限运动功能。',
    },
  ]);

  const completedTasks = ref([
    {
      id: 'c1',
      title: 'MacBook 销售技巧起步异常',
      platformName: 'SmartSales',
      completedAt: '今天 10:30',
    },
    { id: 'c2', title: '降噪模式对比讲解话术', platformName: 'MyPAL', completedAt: '今天 09:15' },
    {
      id: 'c3',
      title: 'Apple Vision Pro NPI 认证',
      platformName: 'MyPAL',
      completedAt: '昨天 16:45',
    },
    {
      id: 'c4',
      title: '空间计算场景与客户沟通指南',
      platformName: '直播培训',
      completedAt: '昨天 14:20',
    },
    {
      id: 'c5',
      title: '你有一项新的学习任务',
      platformName: 'AI Coach',
      completedAt: '昨天 09:00',
    },
  ]);

  const showAllOverdue = ref(false);
  const sortedOverdueTasks = computed(() =>
    [...overdueTasks.value].sort((a, b) => new Date(b.deadline) - new Date(a.deadline))
  );
  const displayedOverdueTasks = computed(() =>
    showAllOverdue.value ? sortedOverdueTasks.value : sortedOverdueTasks.value.slice(0, 3)
  );
  const getBundleUrgentCount = (task) =>
    task.subTasks ? task.subTasks.filter((s) => !s.completed && s.status === 'urgent').length : 0;
  const getBundleNudgingCount = (task) =>
    task.subTasks ? task.subTasks.filter((s) => !s.completed && s.status === 'nudging').length : 0;

  const detailModalOpen = ref(false);
  const selectedTask = ref(null);
  const scrollY = ref(0);
  const logoutMenuOpen = ref(false);

  const showToastAlert = ref(false);
  const toastMsg = ref('');
  const pullDistance = ref(0);
  const isRefreshing = ref(false);
  let startY = 0;

  const showToast = (msg) => {
    toastMsg.value = msg;
    showToastAlert.value = true;
    setTimeout(() => {
      showToastAlert.value = false;
    }, 2000);
  };

  const handleLogout = async () => {
    try {
      await userStore.logout();
      showToast('退出登录成功');
      setTimeout(() => {
        router.replace('/storesales/login');
      }, 500);
    } catch (e) {
      showToast('退出失败，请重试');
    }
  };

  const activeTimer = ref(new Date());
  let timerId = null;

  const loadLucide = () => {
    if (window.lucide) {
      window.lucide.createIcons();
    } else {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/lucide@0.292.0/dist/umd/lucide.min.js';
      script.onload = () => window.lucide.createIcons();
      document.head.appendChild(script);
    }
  };

  const loadConfetti = () => {
    if (!window.confetti) {
      const script = document.createElement('script');
      script.src =
        'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.browser.min.js';
      document.head.appendChild(script);
    }
  };

  onMounted(() => {
    loadLucide();
    loadConfetti();
    timerId = setInterval(() => {
      activeTimer.value = new Date();
    }, 60000);
    window.addEventListener('scroll', () => {
      scrollY.value = window.scrollY;
    });
  });

  onUpdated(() => {
    if (window.lucide) window.lucide.createIcons();
  });

  const sortedTasks = computed(() => {
    const orderMap = { urgent: 0, nudging: 1, new: 2, normal: 3 };
    return [...tasks.value].sort((a, b) => orderMap[a.status] - orderMap[b.status]);
  });

  const urgentCount = computed(() => tasks.value.filter((t) => t.status === 'urgent').length);
  const closestUrgentDeadline = computed(() => {
    const ut = tasks.value.filter((t) => t.status === 'urgent' && t.deadline);
    if (ut.length === 0) return null;
    return ut.reduce((c, curr) => (new Date(curr.deadline) < new Date(c.deadline) ? curr : c))
      .deadline;
  });

  const getFormattedRemaining = (deadlineStr) => {
    if (!deadlineStr) return '';
    const diff = new Date(deadlineStr) - activeTimer.value;
    if (diff <= 0) return '已逾期';
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const days = Math.floor(hours / 24);
    const rh = hours % 24;
    if (days >= 1) return rh === 0 ? `${days} 天` : `${days} 天 ${rh}h`;
    return `${hours}h ${minutes}m`;
  };

  const formatShortDeadline = (deadlineStr) => {
    if (!deadlineStr) return '';
    const d = new Date(deadlineStr);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const isTomorrow = d.getDate() === tomorrow.getDate() && d.getMonth() === tomorrow.getMonth();
    const ts = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(
      2,
      '0'
    )}`;
    if (isTomorrow) return `明天 ${ts}`;
    return `${d.getMonth() + 1}月${d.getDate()}日 ${ts}`;
  };

  const formatSubDeadline = (deadlineStr) => {
    if (!deadlineStr) return '';
    const d = new Date(deadlineStr);
    return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(
      d.getMinutes()
    ).padStart(2, '0')}`;
  };

  const getStatusColor = (status) => {
    if (status === 'urgent') return '#E25438';
    if (status === 'nudging') return '#DF9D2A';
    if (status === 'new') return '#349658';
    return '#3B82F6';
  };

  const getCardStatusClass = (status) => {
    if (status === 'urgent') return 'bg-[#FFF9F9] border-red-100';
    if (status === 'nudging') return 'bg-[#FFFCF0] border-amber-100';
    if (status === 'new') return 'bg-[#F7FDF9] border-emerald-100';
    if (status === 'normal') return 'bg-[#F0F9FF] border-[#B9E6FE]';
    if (status === 'overdue') return 'bg-[#FAFAFA] border-slate-200';
    return 'bg-white border-slate-200';
  };

  const getDotClass = (status) => {
    if (status === 'urgent') return 'bg-[#E25438]';
    if (status === 'nudging') return 'bg-[#DF9D2A]';
    if (status === 'new') return 'bg-[#349658]';
    return 'bg-[#3B82F6]';
  };

  const getPillClass = (status) => {
    if (status === 'urgent') return 'bg-[#E25438] text-white';
    if (status === 'nudging') return 'bg-[#FFF9EB] text-[#A16D14]';
    if (status === 'new') return 'bg-[#349658] text-white';
    return 'bg-[#E0F2FE] text-[#0369A1]';
  };

  const getTimeClass = (status) => {
    if (status === 'urgent') return 'text-[#E25438]';
    if (status === 'nudging') return 'text-[#B87A15]';
    if (status === 'new') return 'text-[#349658]';
    return 'text-[#6B7280]';
  };

  const getStatusLabel = (status) => {
    if (status === 'urgent') return '紧急';
    if (status === 'nudging') return '催办中';
    if (status === 'new') return '新任务';
    return '待完成';
  };

  const getBundleCompleted = (task) =>
    task.subTasks ? task.subTasks.filter((s) => s.completed).length : 0;
  const getBundleProgressColor = (task) => {
    if (!task.subTasks) return '#06B6D4';
    const comp = getBundleCompleted(task);
    if (comp === task.subTasks.length) return '#349658';
    if (comp > 0) return '#DF9D2A';
    return '#06B6D4';
  };

  const getPlatformClass = (platform) => {
    if (platform === 'MyPAL') return 'bg-[#F0F7FF] text-[#0369A1] border-[#B9E6FE]/60';
    if (platform === '直播培训') return 'bg-[#FFF7ED] text-[#B45309] border-[#FDE68A]/60';
    if (platform === 'SmartSales') return 'bg-[#FDF2F8] text-[#86198F] border-[#E9D5FF]/60';
    if (platform === 'AI Coach') return 'bg-[#F0FDF4] text-[#15803D] border-[#BBF7D0]/60';
    return 'bg-[#F8FAFC] text-[#64748B] border-[#E2E8F0]';
  };

  const isPastDate = (dStr) => new Date(dStr) < new Date();

  const celebrate = () => {
    const count = 200;
    const defaults = { origin: { y: 0.7 }, zIndex: 9999 };
    function fire(particleRatio, opts) {
      window.confetti(
        Object.assign({}, defaults, opts, { particleCount: Math.floor(count * particleRatio) })
      );
    }
    fire(0.25, { spread: 26, startVelocity: 55, colors: ['#349658', '#E8F3EC'] });
    fire(0.2, { spread: 60, colors: ['#E25438', '#DF9D2A'] });
  };

  const handleLearn = () => {
    celebrate();
    showToast('正在跳转到学习平台...');

    // For demo, finish all tasks to show the other screen after 3 seconds
    setTimeout(() => {
      tasks.value = [];
    }, 3000);
  };

  const handleDetail = (task) => {
    selectedTask.value = task;
    detailModalOpen.value = true;
  };

  const finishTask = () => {
    detailModalOpen.value = false;
    celebrate();
    showToast('即将跳转到学习平台');
  };

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const touchStart = (e) => {
    if (window.scrollY === 0) startY = e.touches[0].clientY;
  };

  const touchMove = (e) => {
    if (startY > 0 && window.scrollY === 0) {
      const dist = e.touches[0].clientY - startY;
      if (dist > 0 && !isRefreshing.value) {
        pullDistance.value = Math.min(dist * 0.5, 80);
        if (dist > 10) e.preventDefault();
      }
    }
  };

  const touchEnd = () => {
    if (pullDistance.value > 60 && !isRefreshing.value) {
      isRefreshing.value = true;
      pullDistance.value = 80;
      setTimeout(() => {
        isRefreshing.value = false;
        pullDistance.value = 0;
        showToast('数据已更新');

        // If tasks are empty, refill them to demo again
        if (tasks.value.length === 0) {
          tasks.value = [
            {
              id: 't1',
              type: 'single',
              parentName: 'MacBook 培训',
              title: 'MacBook 销售技巧起步异常',
              deadline: addTime(20, 57),
              status: 'urgent',
              platformName: 'SmartSales',
              passingScore: 80,
              description:
                '针对近期反馈的 MacBook 销售初期引导阶段出现的共性问题进行专项强化培训。',
            },
            {
              id: 't2',
              type: 'single',
              parentName: 'AirPods 培训',
              title: '降噪模式对比讲解话术',
              deadline: addTime(54, 0),
              status: 'nudging',
              platformName: 'MyPAL',
              passingScore: 90,
              description:
                'AirPods Pro 2 与 AirPods Max 的主动降噪（ANC）及通透模式的对比演示标准流程。',
            },
          ];
        }
      }, 1500);
    } else {
      pullDistance.value = 0;
    }
    startY = 0;
  };
</script>

<style scoped>
  .app-wrapper {
    background-color: #f6f6f3;
    font-family: 'Manrope', -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  h1,
  h2,
  h3,
  h4,
  p {
    text-wrap: pretty;
  }
  .smooth-transition {
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .glass-modal {
    background: #ffffff;
    border-radius: 2rem;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.1);
  }
  .hide-scrollbar::-webkit-scrollbar {
    display: none;
  }
</style>
