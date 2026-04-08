# TOT 培训任务管理系统 - 前后端联调进度文档

本文档记录本仓库（主线分支 **`dev_joint`**，TOT-Apple 培训任务管理系统 MVP P0）当前的前后端集成与联调状态。系统分为 **总部端 (Central)** 和 **店员端 (Employee)**，后端采用 Node.js (Express + SQLite)，前端采用 Vue 3 + Vite。更完整的后端/前端说明见 [`TOT_backend/docs/README.md`](TOT_backend/docs/README.md)。

> 更新日期：2026年4月7日

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

---

## 🚧 后续待完成联调的部分 (Pending / To-Do)

### 1. WebSocket 实时预警推送 (Real-time Nudge & WS)
- **现状**：目前后端 [`TOT_backend/server/ws/manager.js`](TOT_backend/server/ws/manager.js) 已有 WebSocket 广播逻辑（HTTP 服务启动后见控制台输出的 `ws://…/ws?token=`）；前端店员端页面的“预警消息灯箱”及瀑布流使用的还是模拟数据（`employee/index.vue` 内 `mockWarnings`）。
- **待联调**：
  - 店员端登录后需要真实建立 WebSocket 连接（携带 JWT token）。
  - 后端触发自动催办 (`task_assigned`, `nudge_sent` 等事件) 时，前端需要监听 `message` 并将真实的预警数据推入 `waterfallMessages` 中，并触发预警弹窗。

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
- **现状**：总部看板页面 (`/central/board`) 中的通过率、排名等图表数据部分处于静态/Mock状态。
- **待联调**：需和后端的统计接口对接，根据真实 `task_assignments` 聚合数据，渲染大盘概览与门店排行。

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