# TOT 培训任务管理系统 - 前后端联调进度文档

**产品需求口径：** 见 [`TOT_backend/docs/product/PRODUCT_REQUIREMENTS.md`](TOT_backend/docs/product/PRODUCT_REQUIREMENTS.md)（以该文件为准）。

本文档记录本仓库（主线分支 **`dev_joint`**，TOT-Apple 培训任务管理系统 MVP P0）当前的前后端集成与联调状态。系统分为 **总部端 (Central)** 和 **店员端 (Employee)**，后端采用 Node.js (Express + SQLite)，前端采用 Vue 3 + Vite。更完整的文档索引见 [`TOT_backend/docs/README.md`](TOT_backend/docs/README.md)。

> 更新日期：2026年4月13日

---

## 当前阶段：内部联调（MyPal 使用本地 Mock）

**现阶段不接入 MyPal 真实接口或对方数据库。** 前后端联调请统一走后端已实现的 **本地 Mock**：

| 做法 | 说明 |
|------|------|
| 环境变量 | 在 **`TOT_backend/.env`** 中设置 **`MYPAL_MOCK=1`**（`server/app.js` 从此文件加载；勿打开 **`MYPAL_ENABLED=1`**，除非已与 MyPal 开通真实联调）。模板见 `TOT_backend/.env.example`。 |
| 接口 | **`GET /api/v1/mypal/mock/learning`**（需登录），返回与 MyPal 文档同形态的字段；数据来自 SQLite 表 **`mypal_learning_mock`**。在 `TOT_backend/server` 下执行 **`npm run seed`**（或 `node db/seed.js`）生成/刷新种子数据。 |
| 与正式 HTTP 对接 | `POST /api/v1/mypal/sync`、凭证变量等见 [`TOT_backend/docs/backend/06-MYPAL-INTEGRATION.md`](TOT_backend/docs/backend/06-MYPAL-INTEGRATION.md)，待与 MyPal 正式开通后再启用。 |

---

## 🖥️ 共享开发服务器（Mac Studio）

团队使用 Mac Studio 作为统一后端服务器，支持外网远程开发。

| 项目 | 值 |
|------|----|
| 后端地址 | `http://100.65.95.128:3000` |
| Tailscale IP | `100.65.95.128`（需加入团队 Network） |
| 进程管理 | PM2（`pm2 status tot-api` 查看共享后端进程） |
| 主开发分支 | `dev_joint` |
| 远程开发 | Cursor Remote SSH → `mac-studio` |

**新成员接入**：见 [`TOT_backend/docs/team-onboarding.md`](TOT_backend/docs/team-onboarding.md)

**网络双路径（内网 + 可选公网）**：

| 路径 | 适用场景 | 说明 |
|------|----------|------|
| Tailscale 内网 `100.x` | 团队成员已安装 Tailscale | 访问 `http://<Tailscale IP>:3000`（API）或 `:8001`（Mac Studio 上已跑 Vite 时） |
| [Tailscale Funnel](https://tailscale.com/kb/1223/funnel) 公网 HTTPS | 未装 Tailscale 的设备（如蜂窝网演示） | 仅在 Mac Studio 上按需开启，详见 onboarding 文档「路径 B」 |

管理员在 Mac Studio 上应定期执行基线检查（Tailscale 在线、`pm2 status tot-api`、`tailscale ip -4`）；若 `tailscale ip -4` 与上表 IP 不一致，请更新本 README 与 onboarding 中的示例地址。

**日常部署**（合并到 dev_joint 后在 Mac Studio 执行）：
```bash
bash scripts/deploy.sh
```

**后端代码更新与 PM2 重载**：在 Mac Studio 上由 PM2 跑的是**当时磁盘上的代码**；你改了后端并需要共享环境生效时，必须把新代码同步到 Mac Studio，再重载进程（不会自动热更新）。

| 操作 | 命令 / 说明 |
|------|-------------|
| 推荐流程（拉代码 + 依赖 + 重载） | 在仓库根目录执行 `bash scripts/deploy.sh`（默认分支 `dev_joint`） |
| 指定分支部署 | `bash scripts/deploy.sh <分支名>` |
| 仅重载 PM2（已是最新代码时） | `cd TOT_backend/server && pm2 reload ecosystem.config.js --env development` |
| 查看状态 | `pm2 status tot-api`（进程名 **`tot-api`**，定义见 `TOT_backend/server/ecosystem.config.js`） |
| 硬重启（`reload` 异常时） | 同上目录下执行 `pm2 restart tot-api` |

`reload` 按 PM2 方式重载进程（会重启 Node，单实例时接口会短暂不可用）；`restart` 为直接重启。数据库结构变更请按项目迁移步骤单独处理，PM2 不负责迁移。

若你**只在个人电脑改后端、且前端连本机 `localhost:3000`**，用下文 **「本地独立开发」** 里的 `npm run dev` 即可，**不必**在 Mac Studio 上执行 `deploy.sh` 或 `pm2 reload`；只有需要团队共用那台机上的接口时，才要部署并重载。

**测试账号**：
| 账号 | 密码 | 角色 |
|------|------|------|
| `central` | `Train2026!` | 总部 |
| `executive` | `Train2026!` | Executive |
| `admin` | `Admin2026!` | 管理员 |
| `emp_E001` | `Train2026!` | 店员（S001 门店） |

---

## ✅ 目前已成功联调的部分 (Successfully Integrated)

### 1. 核心架构与底层通信
- **数据库与接口底座**：后端基于 `better-sqlite3` 实现同步读写，移除了历史遗留的 `store_manager` 角色与相关业务逻辑（符合 DB v2.5.0 / API v1.4.0 规范）。
- **Alova 请求适配**：前端基础请求链路打通，包含 Token 鉴权、全局路由拦截以及请求/响应错误处理。

### 2. 总部端 (HQ Central)
- **AI 智能文案生成 (DeepSeek)**：
  - 前端发布页（`src/views/central/taskManage/index.vue`）点击“AI 智能润色”成功调用后端 `POST /api/v1/tasks/ai-generate-description` 接口。
  - **后端已成功切换至 DeepSeek 模型** (`generate_task_description_deepseek`)，彻底解决了原代理 API 导致的 Token 截断与输出不完整问题。
- **任务发布与预警规则下发**：
  - 前端表单可以成功将任务基础信息、平台（MyPal, Sales Coach, AI Coach, 直播等）、覆盖范围传递给后端。
  - **预警规则 (Auto Nudge Rules) 全面打通**：支持配置“进度掉队”、“起步异常”、以及最新的 **“24小时 / 48小时双重临期危机预警”**（`deadlineCrisisHours`, `deadlineCrisisHoursSecondary`），并成功将 JSON 存入后端 `tasks` 表中。
- **任务状态与编辑回显**：
  - 草稿态任务的保存与修改联调成功。
  - 从列表点击编辑可成功请求 `getTaskDetail`，并在前端精准回显所有参数（包含时间、平台标签、覆盖人群及预警规则参数）。

### 3. 店员端 (Employee Mobile)
- **UI 与动态渲染**：
  - 店员端首页成功获取用户信息，并动态渲染出高颜值的首字母纯文本头像。
- **待办任务获取与展示 (Banner)**：
  - 成功对接 `GET /api/v1/tasks` 和详情接口，首页上半部分的“紧急待办”卡片能真实读取后端数据库下发的任务数据。
  - 前端实现了基于后端时间戳 (`ddlAt`) 的动态倒计时与超时判定逻辑。
- **任务详情解析**：
  - 点击具体任务卡片，成功打开弹窗读取并展示由总部 AI 润色后的长文案 (`description`) 和关联的平台 Tag。
- **WebSocket 实时推送（开发环境已联调）**：
  - 开发环境下通过 Vite 将 `/ws` 代理至本机后端 `3000`，店员端使用 JWT 建立 `ws://…/ws?token=` 连接；可接收 `task_assigned` / `task_updated` / `task_deleted` / `assignment_completed` / `nudge_sent` 等事件，驱动列表刷新、预警瀑布流与弹窗（详见下文「联调更新概览」2026-04-10）。

---

## 🚧 后续待完成联调的部分 (Pending / To-Do)

### 1. WebSocket 实时预警推送 (Real-time Nudge & WS)
- **现状（2026-04-11）**：后端 [`TOT_backend/server/ws/manager.js`](TOT_backend/server/ws/manager.js) 广播逻辑可用；开发环境下前端已建立 WebSocket（见 `TOT_frontend/vite.config.ts` 中 `/ws` 代理与 `employee/index.vue` 中 `initWebSocket`），并处理 `nudge_sent`（推入瀑布流、弹窗）、`assignment_completed`（刷新列表等）等事件。
- **待联调 / 待加固**：
  - 断线重连、Token 续期后重连、生产环境（HTTPS / Tailscale Funnel）下 WSS 与代理一致性。
  - 与自动催办 Cron、全量门店压测下的推送稳定性联调验收。

### 2. 自动化催办后台服务 (Auto Nudge Cron Trigger)
- **现状**：后端 [`TOT_backend/server/services/autoNudge.js`](TOT_backend/server/services/autoNudge.js) 具备基于预警规则（包括 48 小时临期）评估进度并生成催办文案的能力，但可能缺乏持续的全局定时触发器（Cron Job）。
- **待联调**：后端需部署一个定时任务（例如每小时执行一次），遍历所有 `in_progress` 的 Task，对比当前时间与 `ddl_at`，触发对应的 24h / 48h 临期预警，写入 `notification_events` 表并通过 WS 广播给对应店员。

### 3. 学习平台任务真实完成回调 (Task Completion Workflow)
- **现状**：目前前端店员端点击“去完成”是直接唤起微信小程序，点击“标记完成”只在前端列表做了 UI 上的本地移除（Mock 完成）。
- **内部联调阶段**：MyPal 侧 **`MYPAL_MOCK=1` + `GET /api/v1/mypal/mock/learning`** 与 `mypal_learning_mock` 表已可支撑开发自测，**不要求**接通 MyPal 真实环境。
- **待联调**：
  - 需接入真实的 `/assignments/:id/platforms/:platform/complete` 接口（对于无需自动回传的平台如直播）。
  - 对于 MyPal，在内部阶段可继续用 mock 表对齐字段；**与 MyPal 真实 HTTP 同步**（`POST /api/v1/mypal/sync`）与任务进度自动回写可在对方凭证就绪后再做端到端验收。

### 4. 总部端看板数据真实统计 (HQ Dashboard Stats)
- **现状（2026-04-11）**：门店排名下钻、预警维度下钻等已对接 `/api/v1/dashboard/store-rank`、`/api/v1/dashboard/warnings` 等接口（见下文「联调更新概览」）；大盘部分指标仍可能为静态或需与后端继续对齐字段。
- **待联调**：其余图表与聚合口径需按产品定义与后端统计接口持续对齐，并用真实 `task_assignments` 数据验收。

---

## 🚀 快速启动指南 (Quick Start)

### Mac Studio 共享服务器（推荐）

后端已由 PM2 守护，**平时不必手起 `npm run dev`**；若你改了后端并要 Mac Studio 上的接口用上新代码，见上文 **「后端代码更新与 PM2 重载」**。前端仍需本机执行 `pnpm run dev`。

`TOT_frontend/.env.development` 中 **`VITE_GLOB_API_URL`** 默认留空（同源 + Vite 代理到本机 `:3000`）；若你要临时直连某台后端，请在 `.env.development.local` 覆盖，避免改动已跟踪文件并误提交个人地址。

```bash
# 确认后端正在运行（在 Mac Studio 上执行）
pm2 status tot-api

# 前端本地开发（Vite 已 `host: true`，局域网/Tailscale 可访问）
cd TOT_frontend && pnpm run dev
```

### 演示模式（推荐给手机/公网）：build + preview + Funnel

当需要保证演示稳定性（尤其 iPhone）时，建议不要直接把 `pnpm run dev` 暴露到公网，而使用「先构建、再预览、最后开启 Funnel」的固定流程：

```bash
# Terminal A（Mac Studio）
pm2 status tot-api
cd /Users/skylerwang/Desktop/MVP/TOT_frontend
pnpm install
pnpm run build
pnpm run preview:dist --host 0.0.0.0 --port 4173

# Terminal B（Mac Studio）
tailscale funnel reset
tailscale funnel 4173
tailscale funnel status
```

将 `tailscale funnel status` 输出的 `https://<machine>.<tailnet>.ts.net` 发给演示设备访问：

- 总部入口：`https://<...>/hq`
- 店员入口：`https://<...>/employee/login`

演示结束后关闭公网暴露：

```bash
tailscale funnel reset
```

### 本地独立开发（仅本机调试时）

```bash
# 后端
cd TOT_backend/server
npm install
npm run dev          # node --watch app.js，修改自动重启，端口 3000

# 前端（先将 .env.development 里 VITE_GLOB_API_URL 设为 http://localhost:3000）
cd TOT_frontend
pnpm install
pnpm run dev         # 默认端口 8001（见 .env.development 中 VITE_PORT）
```

**快速测试入口**：
- **总部入口**：`http://localhost:8001/hq`（或同网段/Tailscale 下 `http://100.65.95.128:8001/hq`，需本机已 `pnpm run dev` 且 Vite 在跑）
- **店员端**：`http://localhost:8001/employee/login`（账号见上方测试账号表）

## 前后端联调更新概览

以下为按日期的变更摘要（与仓库内 `前后端联调更新概览.md` 同步）。

## 2026-04-13

- **总部端任务下发范围逻辑与交互重构**：
  - **选项更新与数据映射**：移除原有的“店员端”选项，新增“店长 (Store Manager)”选项。重构了后端 Payload 构建逻辑：当选中“全员”或仅选中“店长”时，自动识别为全局下发（`storeScope: "all"`, `rtmFilter: null`）；如果同时选中“店长”和特定业务线（如 Monobrand），则精准匹配对应 RTM 过滤受众，完美适配当前系统的单一人群架构。
  - **Apple 极简风格多选标签**：废弃了朴素的原生下拉框 UI。现采用高度定制的极简风格选中标签：无边框设计、更淡的苹果系统灰背景 (`#f2f2f7`)、更小巧的圆角与内边距，悬停叉号时伴有警示红 (`#ff3b30`) 反馈，使输入框呈现出清爽高级的扁平化质感。
- **店员端预警触达与已读闭环优化**：
  - **沉浸式预警处理**：移除了预警弹窗中的“稍后再说”次要按钮，强制用户聚焦当前预警信息。如果有多条未读预警，统一改为“我知道了”以关闭并分别处理；单条预警下，系统会根据该预警包含任务的已读状态动态切换底部按钮为“去完成”或“查看任务详情”。
  - **智能状态流转与连贯下钻**：点击“查看任务详情”不仅会关闭预警弹窗，还会自动穿透唤起对应任务的真实详情卡片，同时静默同步触发该对应预警的“已读回执”，打通了预警到任务阅读并确认的完整流转链路。
- **总部端看板体验与智能分析增强**：
  - **全屏模式回归**：在总部端顶部导航栏右上角恢复了“全屏/退出全屏”功能的快捷按钮。
  - **完成趋势任务周筛选**：在实时看板的“完成人数趋势”折线图中，新增了按“任务周”进行时间区间截取和筛选的能力（根据首尾日期自动计算第 1 周、第 2 周等），便于针对长周期任务进行精细化趋势回溯。
  - **AI 洞察面板视觉修复**：修复了自动 AI 洞察框高度失控的问题，为其设置了最大高度 (`max-height: 230px`) 与局部滚动。同时将其背景色校准为与页面一致的底色 (`#f5f5f7`)，完美融入整体视觉。
  - **全局模块级智能分析悬浮入口 (Magic Wand)**：为看板内的五个核心数据区（北极星指标、趋势图、区域进度排行、漏斗链路数据、预警统计）全面接入“悬浮触发式”的智能分析按钮。采用 `ColorWandOutline` 魔法棒图标与 `10px` 圆角的渐变蓝按钮。基于用户的当前焦点数据生成对应视角的局部 Mock 洞察分析弹层，极大强化了看板的“AI 赋能”属性。
- **后端任务删除外键约束 Bug 修复**：
  - 修复了由于新增了 `read_receipts` (已读回执表) 强依赖 `notification_events` (预警通知表)，导致在尝试级联删除任务时触发 SQLite `FOREIGN KEY constraint failed` 报错的问题。现在后端在执行事务删除时，会优先清理该任务下所有通知关联的已读回执记录，确保数据彻底安全地被清除。

## 2026-04-11

- **店员端已完成任务 24h 留存与庆贺体系 (纯前端方案实现)**：
  - **任务留存逻辑 (24h Window)**：重构了店员端 (`employee/index.vue`) 的任务过滤机制。现在除了展示所有未完成任务外，还会自动筛选并保留“已完成且完成时间距今 < 24 小时”的任务。实现了在不改动后端 API 存储逻辑的前提下，提供任务完成后的即时成就感反馈。
  - **Apple 风格庆贺横幅**：为已完成任务的卡片引入了全新的 UI 状态。卡片顶部新增带有苹果官方绿色 (`#34c759`) 风格的“恭喜你完成任务”庆贺栏，并伴有柔和的背景渐变和左侧边框变色，提升了店员完成学习目标的视觉奖励。
  - **原生精致烟花动画 (Confetti)**：在项目中手动实现了一套高性能、零依赖的 Canvas 粒子烟花算法 (`triggerConfetti`)。当店员点击“确认完成”并收到成功响应，或者从 MyPal 小程序完成学习并经由 WebSocket 接收到 `assignment_completed` 事件时，屏幕会爆发 Apple 五色主题的电子纸屑。该动画不污染项目依赖，通过原生 Web API 确保了在移动端极高的流畅度。
  - **上下文交互优化**：智能识别任务完成状态，自动隐藏瀑布流卡片及详情弹窗中的“去完成”行动点，并将其替换为置灰/不可点击的“任务已完成”状态，闭环了任务从“待办”到“归档”的交互路径。
- **店员端预警增强与文案透明化**：
  - **预警文案补全**：修复了原先预警原因会覆盖任务标题的逻辑，现在统一展示为 `【任务名称】触发了预警：[具体原因]`，让店员明确感知紧迫感来源。
  - **强制视觉提醒**：移除了预警卡片的“叉号”关闭按钮，确保任务未完成前预警始终存在。
  - **视觉爆闪强化**：将警示灯 ⚠️ 的呼吸动画频率从 1.2s 提升至 0.8s，并增加了 12px 的彩色外发光（Drop Shadow），显著提升了视觉权重。
- **总部端 AI 快捷发布 (Beta)**：
  - **智能解析面板**：在任务发布页新增 AI 解析区域，支持一句话描述或模拟语音输入，自动提取并填充平台选择、任务名称、达标分数及截止时间，大幅缩短了发布链路。
  - **任务描述 AI 润色**：集成了基于任务上下文的 AI 描述补全逻辑，将干瘪的名称自动转化为结构化、带有表情符号的苹果风格培训说明。
- **总部端多页签动态命名与状态隔离**：
  - **动态标签重载**：修改了标签页（TabsView）与面包屑的渲染逻辑。系统会自动识别路由 Query，当处于编辑状态时，标签页与网页标题动态变为“编辑任务”，实现了与新建页面的视觉与逻辑共存。
  - **KeepAlive 状态污染修复**：通过封装 `resetForm` 并在 `onActivated` 生命周期中进行强制路由校验，解决了开启组件缓存后“新建”与“编辑”模式切换导致数据残留的 Bug。
- **总部端看板 AI 实时洞察面板**：
  - **去按钮化升级**：注释了原有的“手动运行预警扫描”按钮，替换为极简、可折叠的“AI 实时洞察面板”，直接展示自动化扫描结果与风险建议。
  - **自动展开与自适应对齐**：通过 `activeTask.id` 驱动面板自动重置展开状态，并优化了字体规格（16px SF Pro Semi-bold），使其与页面内其他看板卡片完美对齐。
- **总部端看板指标深度下钻 (Drill-down) 与全链路对接**：
  - **门店排名下钻**：对接 `/api/v1/dashboard/store-rank` 接口，在区域热力卡片头部新增 Top 20 / Bottom 20 快捷入口。点击弹出带原生 Apple 风格进度条的 🧍‍♂️ 门店明细列表。
  - **预警详情下钻**：对接 `/api/v1/dashboard/warnings` 接口，将底部的起步异常、临期危机 (P1/P0) 指标块改造为可点击交互组件（含悬浮阴影与“点击下钻”指引），点击即可查看当前预警维度下的风险门店名单及具体逾期人数。
- **总部端看板全屏网格排版重构 (Apple Design)**：
  - **无缝化网格拼接**：将中间（图表与热力）和底部（链路与预警）两大核心区域的 `grid-template-columns` 统一设定为严谨的 `1fr 1fr` 绝对平分。彻底去除了卡片间松散的 `24px` 间距，通过统一的浅色外边框 (`1px solid #e5e7eb`) 将左右卡片无缝合体，呈现出高度一体化的“玻璃面板”视觉。
  - **组件收纳与降噪**：移除了原先突兀占据整行的独立“门店执行排名”卡片，将其功能入口优雅地收纳至“区域进度”卡片的右上角，极大释放了垂直空间并保持了左右对称。
  - **文本层级统一**：重构了漏斗链路卡片与预警卡片的 `template #header` 渲染结构，摒弃了生硬的系统原生 `title`，全面引入“16px黑体主标题 + 13px浅灰副标题”的标准组合，使得页面从上至下的阅读层级实现像素级对齐。

## 2026-04-10

- **全链路 WebSocket 实时同步与通信稳定性修复**：
  - **环境配置补全**：修改 `TOT_frontend/vite.config.ts`，新增 `/ws` 路径的长连接反向代理（`target: http://127.0.0.1:3000`，`ws: true`），与 `/api/v1` 一并支持 WebSocket 升级，打通开发环境下浏览器到本机 Node `3000` 的 WS 链路，避免连接被 Vite 开发服务器误拦。
  - **连接与事件处理**：店员端 (`employee/index.vue`) 中 `initWebSocket` 在 `apiUrl` 为空或以 `/` 开头时使用 `window.location.origin`，将 HTTP(S) 转为 `ws(s)://` 并请求 `/ws?token=<JWT>`；`onmessage` 中按 `event` 分发 `task_assigned` / `task_updated` / `task_deleted`（刷新任务列表）、`assignment_completed`（配合烟花与刷新）、`nudge_sent`（催办文案写入缓存、瀑布流与预警弹窗）等。
