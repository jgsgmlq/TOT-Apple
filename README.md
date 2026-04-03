# TOT 培训任务管理系统 - 前后端联调进度文档

本文档记录了 `TOT_joint`（TOT-Apple 培训任务管理系统 MVP P0）项目当前的前后端集成与联调状态。系统分为 **总部端 (Central)** 和 **店员端 (Employee)**，后端采用 Node.js (Express + SQLite)，前端采用 Vue 3 + Vite。

> 更新日期：2026年4月3日

---

## ✅ 目前已成功联调的部分 (Successfully Integrated)

### 1. 核心架构与底层通信
- **数据库与接口底座**：后端基于 `better-sqlite3` 实现同步读写，移除了历史遗留的 `store_manager` 角色与相关业务逻辑（符合 DB v2.5.0 / API v1.4.0 规范）。
- **Alova 请求适配**：前端基础请求链路打通，包含 Token 鉴权、全局路由拦截以及请求/响应错误处理。

### 2. 总部端 (HQ Central)
- **AI 智能文案生成 (DeepSeek)**：
  - 前端发布页（`taskManage/index.vue`）点击“AI 智能润色”成功调用后端 `POST /api/v1/tasks/ai-generate-description` 接口。
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
- **现状**：目前后端 `server/ws/manager.js` 已有 WebSocket 广播逻辑；前端店员端页面的“预警消息灯箱”及瀑布流使用的还是模拟数据 (`mockWarnings`)。
- **待联调**：
  - 店员端登录后需要真实建立 WebSocket 连接（携带 JWT token）。
  - 后端触发自动催办 (`task_assigned`, `nudge_sent` 等事件) 时，前端需要监听 `message` 并将真实的预警数据推入 `waterfallMessages` 中，并触发预警弹窗。

### 2. 自动化催办后台服务 (Auto Nudge Cron Trigger)
- **现状**：后端 `services/autoNudge.js` 具备基于预警规则（包括我们新加的 48 小时临期）评估进度并生成催办文案的能力，但可能缺乏持续的全局定时触发器（Cron Job）。
- **待联调**：后端需部署一个定时任务（例如每小时执行一次），遍历所有 `in_progress` 的 Task，对比当前时间与 `ddl_at`，触发对应的 24h / 48h 临期预警，写入 `notification_events` 表并通过 WS 广播给对应店员。

### 3. 学习平台任务真实完成回调 (Task Completion Workflow)
- **现状**：目前前端店员端点击“去完成”是直接唤起微信小程序，点击“标记完成”只在前端列表做了 UI 上的本地移除（Mock 完成）。
- **待联调**：
  - 需接入真实的 `/assignments/:id/platforms/:platform/complete` 接口（对于无需自动回传的平台如直播）。
  - 对于 MyPal，需与后端的 `mypal_learning_mock` 同步机制联调，让后端的 `task_assignments` 进度表（progress）真实变为 100% 并流转到 `completed` 状态。

### 4. 总部端看板数据真实统计 (HQ Dashboard Stats)
- **现状**：总部看板页面 (`/central/board`) 中的通过率、排名等图表数据部分处于静态/Mock状态。
- **待联调**：需和后端的统计接口对接，根据真实 `task_assignments` 聚合数据，渲染大盘概览与门店排行。

---

## 🚀 快速启动指南 (Quick Start)

### 启动后端 (Backend)
```bash
cd TOT_backend/server
npm install
npm run dev
# 默认运行在 3000 端口
```

### 启动前端 (Frontend)
```bash
cd TOT_frontend
pnpm install
pnpm run dev
# 默认运行在 8001 端口
```

**快速测试入口**：
- **总部端**：浏览器访问 `http://localhost:8001/hq` (自动带入总部免密权限进入看板)
- **店员端**：浏览器模拟移动端尺寸访问 `http://localhost:8001/employee/login` (可使用 `test1@tot.com` 测试账号)