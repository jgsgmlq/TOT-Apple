## Front-end 系统行为提取（不含视觉设计）

来源：`/front-end` 目录的 HTML + Vanilla JS（含 `js/auth.js`, `js/api.js`, `js/data.js`, `js/*-tasks.js`）。

约束（严格遵守）：
- **不编造业务逻辑**：仅基于代码可见行为描述。
- **不确定必须标注**：所有不确定处用 `[NEED CONFIRM]`。
- **不关注视觉设计**：只提取“系统行为”（组件/交互/状态/API 调用）。

---

## 后端业务正确性审查（严谨版）

说明：以下从**后端架构师**视角，对本文“AI 生成的页面行为定义”进行**业务正确性审查**，并提供“修正后的版本”。  
目标是让行为定义可被后端**按接口/状态机/权限模型落地实现**，且具备可观测、可追踪、可回滚的错误处理闭环。

### 【1. 找问题】

#### 1) 鉴权与权限（高风险）
- **`TaskAPI` 与 `LAN_API` 请求未带 `Authorization`**：`js/api.js` 中 `TaskAPI.*` 与 `LAN_API.*` 均为裸 `fetch('/api/...')`。但 `AppData.init()` 与 `admin.html` 明确使用 `Authorization: Bearer <token>` 调用 `/api/stores|stats|alerts|tasks|employees`。
  - **结论**：行为定义虽标注“调用 API”，但**权限边界不自洽**：后端若严格校验 JWT，这些调用会 401；若不校验，则存在严重越权（任意人可创建/下发任务、改 assignment、注入事件）。
- **前端 `Auth.requireRole()` 不能替代后端权限控制**：后端必须对所有敏感接口独立做 RBAC/ABAC 校验。

#### 2) 任务状态机与语义（逻辑不完整/不一致）
- **Central `publishTask()` 仅写 LAN 事件 + 模拟进度**，并不等价于“真实发布/真实下发/生成 assignments/触达率可查”。将其描述为“发布完成、300人收到任务”属于**业务语义错误**。
- **Task 与 Assignment 状态机缺失/混用**：当前仅出现 `task.status(dispatched/completed/...)` 与 `assignment.status(in_progress/completed)`，但缺少关键约束（是否允许 pending→completed、是否存在 overdue/signed/cancelled 等）。

#### 3) LAN 事件流（可信度/一致性问题）
- `LAN_API.getState()` 失败时返回空 `{events:[],tasks:[]}`，会把真实故障伪装成空态；应区分 **empty vs error**。
- 多个提交动作（`alert_ack/checklist_done/intel_submitted/voc_submitted/help_submitted`）都是“先 toast 成功 + 吞掉写入失败”，会造成“用户认为已同步，后端实际未写入”的一致性问题。

#### 4) 错误处理缺口（可用性与可观测性）
- `StoreTasks/EmployeeTasks` 使用 N+1 拉取（tasks 列表后逐个 detail），行为定义未明确部分失败的处理策略；后端建议提供聚合接口，减少请求风暴。
- 多处按钮仅 `showToast(...)`（生成强化包/推送薄弱店/导出/一键处理全部P1等），作为业务定义仍缺少明确的后端动作与错误闭环。

#### 5) API 设计一致性
- `/api/tasks` 被两套客户端调用：`AppData.init()`（带 JWT）与 `TaskAPI`（不带 JWT）。必须收敛为统一安全模型。
- `/api/state` / `/ws` 的订阅权限必须由后端裁剪，不能依赖前端 filter。

### 【2. 修正后的版本】（保持原结构，行为明确）

> 修正原则：
> - 除 `POST /api/login` 外，所有 `/api/*` 默认**必须带 `Authorization: Bearer`**，后端做权限校验。
> - `LAN_API.postEvent` 仅作为“实时同步通道”，不能作为事实来源；事实必须落库（任务、预警、清单、情报、VOC、求助等）。
> - 所有动作必须有明确的 success/error 行为，不能“吞错后假成功”。

（以下为修正稿，与原结构对应）

#### 【1. 页面结构（Page Structure）】
（结构描述可保留原文；仅需额外标注：哪些按钮当前为演示/仅 toast，不代表后端状态变更。）

#### 【2. 用户行为（User Actions）】

##### A. `index.html`
组件：导航锚点链接（三端演示/设计原则/信息流/验收标准）

trigger: click

flow:
1. 用户操作：点击顶部导航锚点
2. 系统响应：平滑滚动到对应 section
3. 是否调用 API：否

success:
- 页面滚动到目标区块

error:
- 目标元素不存在：不滚动（前端静默）

组件：入口卡片（进入总部管理端/店长端/员工端）

trigger: click

flow:
1. 用户操作：点击卡片
2. 系统响应：跳转到对应页面
3. 是否调用 API：否

success:
- 页面跳转成功

error:
- 资源不存在：浏览器 404（静态资源错误）

##### B. `login.html`
组件：登录按钮 `#loginBtn`

trigger: click

flow:
1. 用户操作：点击“登录”
2. 系统响应：
   - 前端：校验非空；按钮置灰；发起请求
   - 后端：校验账号密码；生成 JWT（包含 `sub/userId`、`role`、`exp`）
3. 是否调用 API：是（`POST /api/login`）

success:
- 前端保存 token+user 到 `localStorage`
- 前端按 `user.role` 跳转
- 后端应返回：`200 { token, user:{id,role,name,storeId?} }`

error:
- 后端 `401/403`：返回明确错误码与 message（账号/密码错误、账号禁用等）
- 网络错误/超时：前端提示失败并允许重试

##### C. `admin.html`
组件：进入页面（鉴权）

trigger: [auto]

flow:
1. 用户操作：打开 `admin.html`
2. 系统响应：
   - 前端：`Auth.requireRole('admin')`
   - 后端：所有 `/api/admin/*` 必须校验 JWT 且 `role=admin`
3. 是否调用 API：是（后续任何数据加载）

success:
- 允许访问页面功能

error:
- `401`：清 token 并跳 `login.html`
- `403`：提示无权限并跳转到角色首页 `[NEED PRODUCT DECISION]`

组件：进度表“保存”（每个员工一行）

trigger: click

flow:
1. 用户操作：修改字段并点击“保存”
2. 系统响应：
   - 前端：该行按钮进入 loading，禁止重复提交
   - 后端：校验 admin；校验字段范围；写库；返回更新后的员工快照
3. 是否调用 API：是（`PUT /api/admin/employees/:empId`，必须带 `Authorization`）

success:
- 前端提示“已保存”
- 前端用服务端返回刷新该行或重拉整表

error:
- `400`：展示字段校验错误
- `409`：并发冲突（若启用乐观锁）`[NEED PRODUCT DECISION]`
- `5xx`：提示失败可重试；不刷新表格

组件：重新 Seed 全部数据

trigger: click

flow:
1. 用户操作：两次 confirm
2. 系统响应：
   - 后端：校验 admin；执行操作；记录审计；建议额外口令/输入确认 `[NEED PRODUCT DECISION]`
3. 是否调用 API：是（`POST /api/admin/seed`，必须带 `Authorization`）

success:
- 返回重建统计；前端提示成功

error:
- 生产环境禁用/拒绝：返回明确错误并提示原因 `[NEED PRODUCT DECISION]`

##### D. `central.html`（Central Agent）
组件：页面初始化（`AppData.init()`）

trigger: [auto]

flow:
1. 用户操作：进入页面
2. 系统响应：后端校验 JWT；按角色返回可见范围数据（总部=全网）
3. 是否调用 API：是（`GET /api/stores|stats|alerts|tasks|employees`，全部必须带 `Authorization`）

success:
- 渲染看板数据

error:
- 任一接口失败：显示错误态并提供重试；不得静默变空态

组件：CA-001 表单“创建任务”（`#taskCreateForm` submit）

trigger: click

flow:
1. 用户操作：填写后点击“创建任务”
2. 系统响应：后端校验 `role=central/admin`；创建 task（建议 `status=created`）
3. 是否调用 API：是（`POST /api/tasks`，必须带 `Authorization`）

success:
- 返回 `201 task`
- 前端刷新任务列表并打开“下发确认弹窗”

error:
- `400/403/5xx`：分别提示并允许重试

组件：下发确认弹窗“确认下发”（`#confirmDispatchBtn`）

trigger: click

flow:
1. 用户操作：确认下发
2. 系统响应：后端生成 assignments（按受众圈选）；task 状态 `created → dispatched`；返回成功/失败统计；要求幂等（重复 dispatch 不重复生成）
3. 是否调用 API：是（`POST /api/tasks/:id/dispatch`，必须带 `Authorization`）

success:
- 前端显示“成功 X / 失败 Y”；刷新看板

error:
- `409(已下发)`：幂等返回或提示已下发
- `5xx`：失败提示并允许重试

组件：CA-001 “一键发布”（页面按钮 `publishTask()`）

trigger: click

flow:
1. 用户操作：点击“一键发布”
2. 系统响应：必须明确语义二选一：
   - A：真实下发（调用 dispatch）
   - B：仅广播通知（仅写事件，不生成 assignments）
3. 是否调用 API：
   - A：`POST /api/tasks/:id/dispatch`（真实下发）
   - B：`POST /api/events`（仅通知）`[NEED PRODUCT DECISION]`

success:
- 仅当后端成功后才显示“发布成功”；不得吞错后假成功

error:
- 显示失败原因并提供重试

组件：LAN 事件流展示（总部端）

trigger: [auto]

flow:
1. 用户操作：停留页面
2. 系统响应：后端按 JWT 权限裁剪事件范围；失败时返回明确错误码；前端显示连接失败并降级重试（保留最近快照）
3. 是否调用 API：是（`GET /api/state` 或 `WS /ws`，建议鉴权）`[NEED PRODUCT DECISION: WS 鉴权方式]`

success:
- 事件持续刷新

error:
- 显示错误态 + 重试/降级；不可直接清空为 empty

##### E. `store.html`（Store Agent）
组件：AI置顶卡“一键执行AI建议”

trigger: click

flow:
1. 用户操作：点击执行
2. 系统响应：后端必须落库“干预执行记录”，并更新 alert 状态；LAN 仅用于同步
3. 是否调用 API：必须是（例如 `POST /api/alerts/:id/execute`）`[NEED PRODUCT DECISION]`

success:
- 返回执行结果；前端以服务端结果更新 UI

error:
- 执行失败：提示原因；UI 不应显示成功

组件：Trade-in 准备清单勾选

trigger: click

flow:
1. 用户操作：勾选/取消
2. 系统响应：后端必须落库门店清单完成状态；失败时 UI 回滚或标记待同步 `[NEED PRODUCT DECISION]`
3. 是否调用 API：必须是（例如 `PATCH /api/tradein/checklist/:itemId`）

success:
- 返回最新进度快照并渲染

error:
- 失败提示并可重试；不得 toast 成功后吞错

##### F. `employee.html`（Employee Agent）
组件：情报提交 / VOC 提交 / 求助提交

trigger: click

flow:
1. 用户操作：提交表单
2. 系统响应：后端必须各自落库（submission/voc/ticket），并按紧急程度触发升级策略；LAN 仅同步
3. 是否调用 API：必须是（如 `/api/intel/submissions`、`/api/tradein/voc`、`/api/tradein/help`）

success:
- 返回 id；前端提示成功

error:
- 校验失败/网络失败：提示并允许重试；不得吞错后假成功

#### 【3. 状态流转（State Flow）】
列出所有可能状态：
- loading
- success
- error
- empty

并说明状态变化（用箭头表示）：
- `loading(Auth校验+数据拉取) → success(渲染完成)`
- `loading → error(401) → 跳转login`
- `loading → error(403) → 无权限提示/跳转` `[NEED PRODUCT DECISION]`
- `loading → error(5xx/timeout) → 错误态(可重试，保留快照)`
- `success → loading(轮询/手动刷新) → success`
- `success → empty`（仅在 API 200 且数据为空时成立）
- `success → error(实时连接断开) → success(降级轮询恢复)`

error:

- 显示错误态 + 重试/降级；不可直接清空为 empty

##### E. `store.html`（Store Agent）
组件：AI置顶卡“一键执行AI建议”

trigger: click

flow:
1. 用户操作：点击执行
2. 系统响应：后端必须落库“干预执行记录”，并更新 alert 状态；LAN 仅用于同步
3. 是否调用 API：必须是（例如 `POST /api/alerts/:id/execute`）`[NEED PRODUCT DECISION]`

success:
- 返回执行结果；前端以服务端结果更新 UI

error:
- 执行失败：提示原因；UI 不应显示成功

组件：Trade-in 准备清单勾选

trigger: click

flow:
1. 用户操作：勾选/取消
2. 系统响应：后端必须落库门店清单完成状态；失败时 UI 回滚或标记待同步 `[NEED PRODUCT DECISION]`
3. 是否调用 API：必须是（例如 `PATCH /api/tradein/checklist/:itemId`）

success:
- 返回最新进度快照并渲染

error:
- 失败提示并可重试；不得 toast 成功后吞错

##### F. `employee.html`（Employee Agent）
组件：情报提交 / VOC 提交 / 求助提交

trigger: click

flow:
1. 用户操作：提交表单
2. 系统响应：后端必须各自落库（submission/voc/ticket），并按紧急程度触发升级策略；LAN 仅同步
3. 是否调用 API：必须是（如 `/api/intel/submissions`、`/api/tradein/voc`、`/api/tradein/help`）

success:
- 返回 id；前端提示成功

error:
- 校验失败/网络失败：提示并允许重试；不得吞错后假成功

#### 【3. 状态流转（State Flow）】
列出所有可能状态：
- loading
- success
- error
- empty

并说明状态变化（用箭头表示）：
- `loading(Auth校验+数据拉取) → success(渲染完成)`
- `loading → error(401) → 跳转login`
- `loading → error(403) → 无权限提示/跳转` `[NEED PRODUCT DECISION]`
- `loading → error(5xx/timeout) → 错误态(可重试，保留快照)`
- `success → loading(轮询/手动刷新) → success`
- `success → empty`（仅在 API 200 且数据为空时成立）
- `success → error(实时连接断开) → success(降级轮询恢复)`

### 【3. 标注风险】（仍需产品拍板）
- TaskAPI/LAN_API 是否必须鉴权 `[NEED PRODUCT DECISION]`
- “一键发布”的真实语义（真实下发 vs 仅通知）`[NEED PRODUCT DECISION]`
- Task/Assignment 状态机与跳转约束（是否允许 pending→completed，是否存在 overdue/cancelled）`[NEED PRODUCT DECISION]`
- 删除员工策略（软删/硬删/关联任务处理）`[NEED PRODUCT DECISION]`
- 提交失败时 UI 回滚 vs 待同步队列 ` [NEED PRODUCT DECISION]`
- WebSocket 鉴权方式与事件裁剪策略 `[NEED PRODUCT DECISION]`

---

## 【1. 页面结构（Page Structure）】

### `front-end/index.html`（系统门户）
- **导航锚点链接**：`三端演示/设计原则/信息流/验收标准`（`<a href="#...">`）
- **入口卡片（可点击跳转）**：`Central Agent / Store Agent / Employee Agent`（`<a href="central.html|store.html|employee.html">`）
- **指标展示区**：`门店数/学习者数/达标率/预警数/情报回流率`（DOM 填充）
- **验收标准列表**：动态渲染网格（DOM 填充）
- **无表单、无弹窗、无表格**

### `front-end/login.html`（登录）
- **输入框**：用户名 `#username`、密码 `#password`（Enter 触发登录）
- **按钮**：登录 `#loginBtn`
- **错误提示块**：`#errorMsg`（显示/隐藏）
- **无弹窗、无表格**

### `front-end/admin.html`（管理后台）
- **Tab 切换**：`员工进度管理 / 员工管理 / 系统操作`
- **下拉选择**：门店选择 `#storeSelect`、门店选择 `#empStoreSelect`；新增员工角色 `#newEmpRole`
- **按钮**
  - 退出登录（`Auth.logout()`）
  - 进度管理：重置本店进度、每行“保存”
  - 员工管理：新增员工、保存、取消、每行“删除”
  - 系统操作：重新 Seed（二次 confirm）
- **表格**
  - 进度表：每个员工一行（含 `number`、`checkbox` 输入）
  - 员工列表表：每个员工一行（含删除按钮）
- **Toast**：`#toast`
- **无标准 modal 组件（用 confirm/toast）**

### `front-end/central.html`（Central Agent 总部端）
- **侧边栏导航（nav items）**：实时看板/布置学习任务/布置情报收集/智能预警/情报中枢/项目部署/Beta分析/店铺详情 + 跳转入口
- **顶部组件**：预警铃铛（带数量）、退出登录
- **实时看板（Dashboard）**
  - **按钮**：刷新数据、切换 Tab（Q1 / Trade-in）、多处“查看全部/跳转”
  - **下拉选择**：雷达图产品选择 `#radarProductSel`、热力图筛选 `#heatmapFilter`、排行排序 `#rankingSortQ1`、准备排名排序 `#prepRankSort`
  - **图表**：雷达图 `#radarChart`、散点图 `#scatterChart`、VOC 转化趋势图（canvas）
  - **列表容器**：指标区/参与&达标/平台进度/排行/预警速览/情报速览/事件流等（JS 渲染）
  - **可折叠面板**：Trade-in 四阶段（phase1~phase4，点击 header 折叠）
- **CA-001 布置学习任务**
  - **表单**：`#taskCreateForm`
  - **输入框**：任务名 `#taskName`、描述 `#taskDescription`、截止时间 `#taskDeadline(datetime-local)`
  - **下拉**：目标角色 `#taskTargetRole`、店铺范围 `#taskStoreScope`、受众范围（未绑定 id 的 select）
  - **按钮**：加载现有任务、一键发布、创建任务（submit）、最近任务列表项（卡片点击）
  - **弹窗（modal）**

    - 下发确认：`#dispatchModal`（确认下发按钮 `#confirmDispatchBtn`）
    - 发布进度：`#publishModal`（进度条/步骤列表/关闭按钮）
- **CA-004 智能预警**
  - **按钮**：一键处理全部P1、每条预警“查看详情/一键执行AI建议”
  - **列表**：预警统计卡片区、预警列表区
  - **弹窗**：[存在“查看详情”入口]（具体 modal DOM 需进一步确认）`[NEED CONFIRM]`
- **CA-002 布置情报收集**
  - **按钮**：新建情报任务
  - **列表容器**：`#intel-collect-list`
- **CA-005 情报中枢**
  - **三 Tab 按钮**：常规情报/Trade-in情报/主动收集任务
  - **大量操作按钮**：生成话术、推送策略、催办、导出、生成简报等（多为 `showToast(...)`）
- **全局 toast**：`showToast(...)`（DOM 位置 `[NEED CONFIRM]`）
- **局域网事件区**：`#storeEmployeeEvents`（LAN 轮询渲染）

### `front-end/store.html`（Store Agent 店长端）
- **顶部按钮/入口**：铃铛（滚动）、退出、看回放、进入学习（SA-006）
- **标签页（自定义 Tab）**：待办 `#storePendingTab`、已完成 `#storeCompletedTab`
- **任务列表区（我的任务）**：待办/已完成容器；任务详情 modal `#storeTaskDetailModal`（关闭/开始任务）
- **时间流卡片（timeline）**：卡片点击折叠/已读；卡片内 action 按钮
- **弹窗/底部抽屉（sheet/modal）**
  - 我的学习 sheet：`#myLearningSheet`（四平台按钮）
  - 团队进度 sheet：`#teamModal`（含项目切换 Q1/Trade-in）
  - Trade-in 准备清单 sheet：`#tradeinChecklistModal`（清单项勾选；指南/下载/标准；反馈给总部）
  - 情报汇总 sheet：`#intelModal`
  - Chat 面板：`#chatPanel`（输入框 + 发送按钮 + tip chips）
- **实时通知区**：`#lanLiveEvents`（LAN 事件卡片/任务卡片）

### `front-end/employee.html`（Employee Agent 员工端）
- **顶部按钮/入口**：退出；四平台快捷入口（4 个可点击块 + 看回放按钮）
- **AI置顶卡**：点击展开详情；卡内按钮（Sales Coach/立即开始）
- **时间流（timeline）**：卡片点击标记已读；卡片 action 按钮
- **浮动按钮（FAB）**：Chat、VOC 速记（📦）、求助（🆘）
- **弹窗/底部抽屉**
  - AI Coach scripts：`#aiCoachModal`
  - 情报反馈：`#intelModal`（textarea + 快速选项 + 提交）
  - 平台详情：`#platModal`
  - VOC：`#vocModal`
  - 求助：`#helpModal`（类型按钮组 + 紧急程度按钮组）
  - Trade-in 项目详情：`#tradeinDetailModal`
  - 任务详情：`#employeeTaskDetailModal`（关闭/标记完成）+ 任务列表 `#employeeTaskList`（默认隐藏）
  - Chat 面板：`#chatPanel`
- **实时通知区**：`#lanLiveEvents`

### `front-end/1.跨职能流程图.html` / `2.业务架构图.html` / `3.系统功能全景图.html`
- 用于“图解/说明”（React 渲染 SVG/模块卡片）
- **交互**：Tab/层级切换、模块展开
- **是否调用本系统 API**：`[NEED CONFIRM]`（当前未见与 `TaskAPI/LAN_API/Auth` 的直接集成）

---

## 【2. 用户行为（User Actions）】

> 格式说明：对每个按钮/交互，按“组件/trigger/flow/success/error”描述。  
> 凡只见 `showToast(...)` 或纯前端渲染、未见真实接口调用，一律标注 `[NEED CONFIRM]`。

### A. `index.html`

组件：导航锚点链接（三端演示/设计原则/信息流/验收标准）

trigger: click

flow:
1. 用户操作：点击顶部导航锚点
2. 系统响应：阻止默认跳转，平滑滚动到对应 section
3. 是否调用 API：否

success:
- 页面滚动到目标区块

error:
- 目标元素不存在则无动作 `[NEED CONFIRM]`

组件：入口卡片（进入总部管理端/店长端/员工端）

trigger: click

flow:
1. 用户操作：点击卡片
2. 系统响应：浏览器跳转到 `central.html/store.html/employee.html`

3. 是否调用 API：否

success:
- 进入对应页面

error:
- 文件不存在/路径错误导致 404 `[NEED CONFIRM]`

### B. `login.html`

组件：用户名输入框 `#username`

trigger: input

flow:
1. 用户操作：输入用户名
2. 系统响应：仅更新输入值（无即时校验）
3. 是否调用 API：否

success:
- 值保留在输入框

error:
- 无

组件：密码输入框 `#password`（Enter 登录）

trigger: input

flow:
1. 用户操作：输入密码；按 Enter
2. 系统响应：调用 `login()`
3. 是否调用 API：是（`POST /api/login`）

success:
- 见“登录按钮”success

error:
- 见“登录按钮”error

组件：登录按钮 `#loginBtn`

trigger: click

flow:
1. 用户操作：点击“登录”
2. 系统响应：校验必填；按钮 disabled + 文案变“登录中…”；隐藏错误块；请求登录接口
3. 是否调用 API：是（`POST /api/login`）

success:
- `Auth.saveAuth(token,user)` 写入 `localStorage`
- 按 `user.role` 重定向：`admin.html/central.html/store.html/employee.html`

error:
- 接口非 2xx：展示 `data.error` 或“登录失败”
- 网络异常：展示“网络错误，请检查服务器是否运行”

组件：已登录自动跳转

trigger: [auto]

flow:
1. 用户操作：打开登录页
2. 系统响应：若 `Auth.isTokenValid()`，按角色直接 `location.replace(...)`
3. 是否调用 API：否

success:
- 直接进入角色页

error:
- token 解码失败/过期：停留在登录页

### C. `admin.html`

组件：退出登录

trigger: click

flow:
1. 用户操作：点“退出登录”

2. 系统响应：清空 token/user，跳转 `login.html`
3. 是否调用 API：否

success:
- 回到登录页

error:
- `localStorage` 不可用时行为异常 `[NEED CONFIRM]`

组件：Tab 切换（progress/employees/system）

trigger: click

flow:
1. 用户操作：点击某个 Tab
2. 系统响应：切换 `.active`；切换 panel 显示；若进入 system 则加载统计
3. 是否调用 API：进入 system 时是（见“加载系统统计”），否则否

success:
- 对应面板显示

error:
- DOM 不存在导致不切换 `[NEED CONFIRM]`

组件：门店下拉 `#storeSelect`（进度管理）

trigger: select

flow:
1. 用户操作：选择门店
2. 系统响应：加载该店员工进度表
3. 是否调用 API：是（`GET /api/stores/:sid/employees`，带 `Authorization`）

success:
- 渲染表格：每行含多个输入 + “保存”按钮

error:
- toast “加载进度数据失败” `[NEED CONFIRM: 服务器错误结构]`

组件：重置本店进度为初始值

trigger: click

flow:
1. 用户操作：点击重置
2. 系统响应：若未选门店提示；弹 confirm；调用重置接口；重载表格
3. 是否调用 API：是（`POST /api/admin/stores/:sid/reset`）

success:
- toast 显示重置人数；刷新进度表

error:
- toast “网络错误，重置失败” 或（`res.json().error`）`[NEED CONFIRM]`

组件：进度表“保存”（每个员工一行）

trigger: click

flow:
1. 用户操作：修改数字/勾选后点击该行“保存”
2. 系统响应：读取行内输入值组装 body；调用更新接口；成功后刷新表格
3. 是否调用 API：是（`PUT /api/admin/employees/:empId`）

success:
- toast “已保存”；刷新表格（重新 GET 员工列表）

error:
- toast “保存失败: <error>” 或 “网络错误，保存失败”

组件：门店下拉 `#empStoreSelect`（员工管理）

trigger: select

flow:
1. 用户操作：选择门店
2. 系统响应：加载员工列表表格
3. 是否调用 API：是（`GET /api/stores/:sid/employees`）

success:
- 渲染员工列表（含删除按钮）

error:
- toast “加载员工列表失败”

组件：+ 新增员工

trigger: click

flow:
1. 用户操作：点击“新增员工”
2. 系统响应：显示新增表单 `#addEmpForm`
3. 是否调用 API：否

success:
- 表单出现

error:
- 无

组件：新增员工-保存

trigger: click

flow:
1. 用户操作：填写姓名/角色/店长权限，点“保存”
2. 系统响应：校验门店与姓名；调用新增接口；隐藏表单；刷新员工表
3. 是否调用 API：是（`POST /api/admin/employees`）

success:
- toast 显示新员工 id 与默认账号 `emp_<id> / Train2026!`；刷新表格

error:
- toast “新增失败: <error>” 或 “网络错误，新增失败”

组件：新增员工-取消

trigger: click

flow:
1. 用户操作：点“取消”
2. 系统响应：隐藏表单
3. 是否调用 API：否

success:
- 表单隐藏

error:
- 无

组件：删除员工

trigger: click

flow:
1. 用户操作：点击某行“删除”；confirm
2. 系统响应：调用删除接口；刷新员工表
3. 是否调用 API：是（`DELETE /api/admin/employees/:empId`）

success:
- toast “已删除 <name>”；刷新表格

error:
- toast “删除失败”或“网络错误，删除失败” `[NEED CONFIRM: 失败原因展示]`

组件：加载系统统计（system tab）

trigger: click

flow:
1. 用户操作：切到“系统操作”Tab
2. 系统响应：并发拉取 stores、employees、tasks；渲染统计卡片
3. 是否调用 API：是（`GET /api/stores`、`GET /api/admin/employees`、`GET /api/tasks`）

success:
- 显示门店数/员工数/活跃任务数

error:
- toast “加载统计数据失败”

组件：重新 Seed 全部数据（危险操作）


trigger: click

flow:
1. 用户操作：点击 reseed；两次 confirm
2. 系统响应：调用 seed 接口
3. 是否调用 API：是（`POST /api/admin/seed`，body `{confirm:true}`）

success:
- toast 显示重建数量（stores/employees/users）

error:
- toast “Seed 失败: <error>” 或 “网络错误，Seed 失败”

### D. `central.html`（Central Agent）

组件：侧边栏导航项（dashboard/create/intel-collect/alerts/intel/deploy/analytics/stores）

trigger: click

flow:
1. 用户操作：点击导航项
2. 系统响应：切换 `.panel` 显示、切换 nav 高亮；部分 panel 触发渲染函数
3. 是否调用 API：多数否；但页面初始化依赖 `AppData.init()`（见“页面初始化”）

success:
- 对应模块内容出现

error:
- DOM 不存在导致不切换 `[NEED CONFIRM]`

组件：预警铃铛（顶部）

trigger: click

flow:
1. 用户操作：点击铃铛
2. 系统响应：跳转到 alerts panel（`navTo('alerts')`）
3. 是否调用 API：否

success:
- 打开预警面板

error:
- 无

组件：退出登录

trigger: click

flow:
1. 用户操作：点击退出
2. 系统响应：`Auth.logout()` 清 token 并跳转登录页
3. 是否调用 API：否

success:
- 回到登录页

error:
- `[NEED CONFIRM]`


组件：刷新数据（看板）

trigger: click

flow:
1. 用户操作：点“刷新数据”
2. 系统响应：调用 `simulateRefresh()`（看起来是前端模拟刷新）
3. 是否调用 API：否 `[NEED CONFIRM]`

success:
- 看板重新渲染/提示刷新 `[NEED CONFIRM]`

error:
- 无/仅 toast `[NEED CONFIRM]`

组件：看板 Tab 切换（Q1 / Trade-in）

trigger: click

flow:
1. 用户操作：点击 Q1 或 Trade-in
2. 系统响应：切换按钮样式；切换内容容器显示；切换口径 badge
3. 是否调用 API：否

success:
- 切换不同数据视图

error:
- 无

组件：雷达图产品下拉 `#radarProductSel`

trigger: select

flow:
1. 用户操作：选择产品
2. 系统响应：调用 `renderRadarChart()` 重绘图表
3. 是否调用 API：否

success:
- 雷达图刷新

error:
- Chart.js 未加载则不渲染 `[NEED CONFIRM]`

组件：按钮“生成强化包/推送薄弱店”（热力图区）

trigger: click

flow:
1. 用户操作：点击按钮
2. 系统响应：toast 提示生成/推送
3. 是否调用 API：否 `[NEED CONFIRM]`

success:
- 显示提示

error:
- 无


组件：排行排序下拉 `#rankingSortQ1`

trigger: select

flow:
1. 用户操作：切换排序维度
2. 系统响应：调用 `renderQ1DualRanking()` 重渲染经销商榜/门店榜
3. 是否调用 API：否

success:
- 排名更新

error:
- 无

组件：准备阶段折叠（phase header）

trigger: click

flow:
1. 用户操作：点击阶段标题行
2. 系统响应：展开/收起 body，切换 chevron
3. 是否调用 API：否

success:
- 展开/收起

error:
- 无

组件：准备排名排序 `#prepRankSort`

trigger: select

flow:
1. 用户操作：选择排序口径
2. 系统响应：`renderPrepRanking()` 重渲染列表
3. 是否调用 API：否

success:
- 排名更新

error:
- 无

组件：CA-001 “加载现有任务”

trigger: click

flow:
1. 用户操作：点击
2. 系统响应：把 `AppData.TRAINING_TASK.name` 填入 `#taskName`；toast
3. 是否调用 API：否

success:
- 表单被填充

error:
- `AppData` 未初始化导致失败 `[NEED CONFIRM]`


组件：CA-001 表单“创建任务”（`#taskCreateForm` submit）

trigger: click

flow:
1. 用户操作：填写后点击“创建任务”
2. 系统响应：`js/central-tasks.js` 监听 submit → `TaskAPI.createTask(...)`
3. 是否调用 API：是（`POST /api/tasks`）

success:
- toast “任务创建成功”
- 刷新任务列表（`GET /api/tasks?...`）
- 打开下发确认弹窗 `#dispatchModal` 并绑定确认按钮

error:
- toast “创建失败: <err.message>”

组件：下发确认弹窗“确认下发”（`#confirmDispatchBtn`）

trigger: click

flow:
1. 用户操作：确认下发
2. 系统响应：`TaskAPI.dispatchTask(taskId)`
3. 是否调用 API：是（`POST /api/tasks/:id/dispatch`）

success:
- toast “任务已下发(x人)”
- 关闭弹窗；刷新任务列表

error:
- toast “下发失败: <err.message>”

组件：CA-001 “一键发布”（页面按钮 `publishTask()`）

trigger: click

flow:
1. 用户操作：点击“一键发布”
2. 系统响应：写 LAN 事件 `task_published`；打开发布进度弹窗；用定时器模拟步骤进度
3. 是否调用 API：是（`POST /api/events` via `LAN_API.postEvent`）

success:
- 发布弹窗显示“发布成功”（步骤为模拟文本）
- 关闭后回到 dashboard

error:
- LAN 写失败被吞掉（仍继续展示发布进度）`[NEED CONFIRM]`

组件：CA-005 情报中枢三 Tab 切换

trigger: click

flow:
1. 用户操作：点击 Tab（regular/tradein/tasks）
2. 系统响应：显示对应内容；进入 tradein 会延迟渲染 VOC 转化图 `renderVocConversionChart()`
3. 是否调用 API：否

success:

- 内容切换；图表出现（依赖 Chart.js）

error:
- Chart.js 缺失则图不显示 `[NEED CONFIRM]`

组件：LAN 事件流展示（总部端）

trigger: [auto]

flow:
1. 用户操作：打开页面并保持
2. 系统响应：`LAN_API.getState()` + `LAN_API.startPolling(5000, ...)` 拉取事件并渲染到 `#storeEmployeeEvents`
3. 是否调用 API：是（`GET /api/state`；可能 `WS /ws`）

success:
- 事件卡片持续刷新

error:
- `getState` 失败返回空 events/tasks（界面表现为无事件）

组件：页面初始化（`AppData.init()`）

trigger: [auto]

flow:
1. 用户操作：进入页面
2. 系统响应：读取 token/user；并发拉取 stores/stats/alerts/tasks + employees；初始化看板数据源
3. 是否调用 API：是（`GET /api/stores`、`GET /api/stats`、`GET /api/alerts`、`GET /api/tasks`、`GET /api/employees` 或 `GET /api/stores/:storeId/employees`）

success:
- 后续渲染函数使用初始化数据正常工作

error:
- 若报 `Not authenticated/401/403`：清 auth 并跳转 `login.html` `[NEED CONFIRM: central 页是否同样处理]`

### E. `store.html`（Store Agent）

组件：AI置顶卡按钮“一键执行AI建议”

trigger: click

flow:
1. 用户操作：点击（阻止冒泡）
2. 系统响应：toast；卡片变已读；向 LAN 写 `alert_ack`
3. 是否调用 API：是（`POST /api/events`）

success:
- 本端卡片变淡；总部端可见事件

error:
- LAN 写失败吞掉 `[NEED CONFIRM]`

组件：Trade-in 准备清单项勾选（toggleCheckItem）

trigger: click

flow:
1. 用户操作：点击清单项
2. 系统响应：UI 变更；toast；向 LAN 写 `checklist_done`
3. 是否调用 API：是（`POST /api/events`）

success:
- 本端状态变更；总部端可见事件

error:
- LAN 写失败吞掉 `[NEED CONFIRM]`

组件：Chat 发送（店长端）

trigger: input

flow:
1. 用户操作：输入问题并发送/Enter 或点 quick chips
2. 系统响应：追加 user 消息；调用 `AppData.chatbotQuery(q)`
3. 是否调用 API：是（优先 `POST /api/ai/chat`；失败 fallback 本地 KB）

success:
- AI 回复展示

error:
- 接口失败且本地未命中：回复“网络错误，请稍后再试。”

组件：StoreTasks 自动轮询拉取任务

trigger: [auto]

flow:
1. 用户操作：停留页面
2. 系统响应：每 5 秒：`GET /api/tasks?status=dispatched` → 对每个任务 `GET /api/tasks/:id` → 过滤出属于当前店长的 assignment
3. 是否调用 API：是

success:
- 列表刷新；新任务插入通知区

error:
- 失败仅 console warn；界面保持旧数据/空数据 `[NEED CONFIRM]`

### F. `employee.html`（Employee Agent）

组件：情报反馈-提交（submitIntel）

trigger: click

flow:
1. 用户操作：填写 textarea，点提交
2. 系统响应：校验必填；关闭 modal；toast；向 LAN 写 `intel_submitted`
3. 是否调用 API：是（`POST /api/events`）

success:
- 事件流可见

error:
- LAN 写失败吞掉（仍 toast “已提交”）`[NEED CONFIRM]`

组件：VOC 速记-提交（submitVoc）

trigger: click

flow:
1. 用户操作：点击提交
2. 系统响应：toast；关闭 modal；向 LAN 写 `voc_submitted`
3. 是否调用 API：是（`POST /api/events`）

success:
- 事件流可见

error:
- LAN 写失败吞掉 `[NEED CONFIRM]`

组件：求助-提交（submitHelp）

trigger: click

flow:
1. 用户操作：点击提交
2. 系统响应：按紧急程度 toast；关闭 modal；向 LAN 写 `help_submitted`
3. 是否调用 API：是（`POST /api/events`）

success:
- 事件流可见

error:
- LAN 写失败吞掉 `[NEED CONFIRM]`

组件：Chat 发送（员工端）

trigger: input

flow:
1. 用户操作：输入并发送/Enter 或点 tip
2. 系统响应：追加 user 消息；调用 `AppData.chatbotQuery(q)`
3. 是否调用 API：是（`POST /api/ai/chat`；失败 fallback 本地 KB）

success:
- AI 回复展示

error:
- 同上

组件：EmployeeTasks 自动轮询拉取任务

trigger: [auto]

flow:
1. 用户操作：停留页面
2. 系统响应：每 5 秒：`GET /api/tasks?status=dispatched` → `GET /api/tasks/:id` → 过滤 assignee=当前员工（仅未 completed）
3. 是否调用 API：是

success:
- 列表刷新；新任务插入通知区

error:
- 失败仅 console warn `[NEED CONFIRM]`

---

## 【3. 状态流转（State Flow）】

### 3.1 通用（页面初始化 + 鉴权）
- **loading**：进入页面 → `Auth.requireRole(...)` 校验 token；`AppData.init()` 拉取数据（central/store/employee）
- **success**：数据拉取完成 → 渲染看板/时间流/列表 → 启动 LAN/Task 轮询
- **error**
  - token 无效/过期 → `clearAuth()` → 跳 `login.html`
  - API 拉取失败 → LAN API 降级为空；Task 拉取多为 console warn `[NEED CONFIRM: central 页具体提示]`
- **empty**：列表/事件为空则显示空态文案

状态箭头（示例）：
- `loading → success`
- `loading → error(401/403) → 跳转login`
- `success → loading(轮询刷新) → success`
- `success → empty(无数据)`

### 3.2 登录（`login.html`）
- `empty(未输入) → error(缺用户名/密码)`
- `loading(点击登录/Enter) → success(保存token并跳转)`
- `loading → error(接口非2xx/网络异常) → idle(可再次点击)`

### 3.3 任务系统（TaskAPI + *Tasks 模块）
- **Central 创建任务**：`idle → loading(create) → success(创建成功+弹窗)`；`loading → error`
- **下发任务**：`idle → loading(dispatch) → success`；`loading → error`
- **店长开始任务 / 员工完成任务**：`idle → loading(PATCH assignment) → success`；`loading → error`
- **空态**：`success → empty(无任务)`

### 3.4 LAN 实时事件（`LAN_API`）
- `loading(getState/startPolling) → success(渲染events)`
- `loading → error → empty(events=[])`（LAN getState 失败返回空）
- `idle(点击提交/执行) → success(UI先行toast/已读)`；失败回滚 `[NEED CONFIRM]`

### 3.5 Modal/Sheet（store/employee/central）
- `idle(隐藏) → success(显示) → idle(关闭)`
- 表单类：`idle → error(校验失败) → idle`；`idle → loading(如有API) → success/error`

---

## 已明确的 API 调用点清单（便于核对）

### 认证
- `POST /api/login`

### 基础数据（`AppData.init()`）
- `GET /api/stores`
- `GET /api/stats`
- `GET /api/alerts`
- `GET /api/tasks`
- `GET /api/employees` 或 `GET /api/stores/:storeId/employees`

### 任务（`TaskAPI`）
- `POST /api/tasks`
- `GET /api/tasks?status=...`
- `GET /api/tasks/:id`
- `POST /api/tasks/:id/dispatch`

### 指派（`TaskAPI`）
- `PATCH /api/assignments/:assignmentId`（body `{status}`）

### 管理后台（`admin.html`）
- `GET /api/stores`
- `GET /api/stores/:sid/employees`
- `PUT /api/admin/employees/:empId`
- `POST /api/admin/employees`
- `DELETE /api/admin/employees/:empId`
- `GET /api/admin/employees`
- `POST /api/admin/stores/:sid/reset`
- `POST /api/admin/seed`

### LAN 实时（`LAN_API`）
- `GET /api/state`
- `POST /api/events`
- `WS /ws`（若可用，否则 fallback polling）

### AI Chat（`AppData.chatbotQuery()`）
- `POST /api/ai/chat`（失败 fallback：本地关键词 KB）
