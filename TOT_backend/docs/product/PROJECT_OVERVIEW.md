# MVP 项目总体概览

## 📋 项目基本信息

| 项目 | MVP - Zero-Code 企业零售培训管理系统 |
|------|------|
| **目标** | Q1 2026 新品培训 - 50 门店 × 6 人 = 300 学员 |
| **架构** | 三层 AI Agent（总部/店长/员工） |
| **技术栈** | Node.js + SQLite + WebSocket + Vanilla JS |
| **状态** | 后端开发完成，正准备前端集成 |
| **上市目标** | 2026 年 3 月下旬 |

---

## 🎯 核心业务流程

```
总部（Central）
    ↓ 创建并下发培训任务
店长（Store Manager）
    ↓ 接收任务，管理员工进度
员工（Employee）
    ↓ 接收任务，执行培训，提交进度和反馈
数据汇总
    ↓ 实时展示完成率、进度、反馈信息
```

---

## 📂 项目目录结构

```
MVP/
├── front-end/                    # 前端应用（三个独立页面）
│   ├── index.html               # 门户/登录页面
│   ├── central.html             # 总部仪表板（中央管理）
│   ├── store.html               # 店长端（移动端模拟）
│   ├── employee.html            # 员工端（移动端模拟）
│   ├── css/                     # 样式文件
│   ├── js/
│   │   ├── api.js              # API 客户端（WebSocket + REST）
│   │   ├── auth.js             # 认证管理
│   │   ├── data.js             # Mock 数据生成（300 学员）
│   │   ├── central-*.js        # 总部端逻辑
│   │   ├── store-*.js          # 店长端逻辑
│   │   └── employee-*.js       # 员工端逻辑
│
├── server/                       # 后端 Node.js 应用
│   ├── index.js                # Express 主应用 + WebSocket 服务
│   ├── db.js                   # SQLite 数据库初始化
│   ├── auth.js                 # JWT 认证中间件
│   ├── schema/                 # SQL Schema 定义
│   │   └── tasks.sql           # 任务相关表结构
│   ├── routes/                 # API 路由
│   │   ├── login.js            # 登录 API
│   │   ├── tasks.js            # ✅ 任务 API（包括汇总）
│   │   ├── stores.js           # 门店 API
│   │   ├── employees.js        # 员工 API
│   │   └── ...其他路由
│   ├── services/               # 业务逻辑服务
│   │   ├── taskService.js      # 任务管理
│   │   ├── taskSummaryService.js # ✅ 任务汇总（新建）
│   │   ├── dispatchService.js  # 任务下发
│   │   ├── stateSync.js        # 状态同步
│   │   └── ...其他服务
│   ├── database.db             # SQLite 数据库文件
│   ├── package.json            # Node.js 依赖
│   └── npm start               # 启动命令
│
├── docs/                        # 📚 项目文档
│   ├── PROJECT_OVERVIEW.md     # 本文件（项目概览）
│   ├── ARCHITECTURE.md         # 系统架构设计
│   ├── API.md                  # 原始 API 约定
│   ├── API_REFERENCE.md        # ✅ 详细 API 参考
│   ├── DATABASE_SCHEMA.md      # 数据库结构
│   ├── FILE_STRUCTURE.md       # 文件结构说明
│   ├── QUICK_START.md          # 快速启动指南
│   ├── INTEGRATION_GUIDE.md    # 前后端集成指南
│   ├── DEBUGGING_GUIDE.md      # 调试和问题排查
│   ├── TECH_INDEX.md           # 技术索引（关键词）
│   ├── BACKEND_IMPLEMENTATION_REPORT.md  # 后端完成报告
│   └── superpowers/            # 实现计划存档
│
└── .claude/                     # Claude Code 配置
    └── projects/.../memory/
        └── MEMORY.md           # 项目关键信息（自动同步）
```

---

## 🔄 核心数据流

### 任务完整生命周期

```
1. 创建阶段
   POST /api/tasks
   └─ 总部创建任务
     └─ 状态: pending

2. 下发阶段
   POST /api/tasks/:id/dispatch
   └─ 300 人自动分配
     └─ 状态: dispatched
     └─ 为每个人创建 assignment 记录

3. 接收阶段
   PATCH /api/assignments/:id (status=received)
   └─ 员工接收任务
     └─ assignment.status: received
     └─ assignment.received_at 记录

4. 执行阶段
   PATCH /api/assignments/:id/progress
   └─ 员工提交进度
     └─ assignment.progress: 0-100%
     └─ assignment.feedback: 反馈信息
     └─ 状态自动转换: in_progress → completed

5. 汇总阶段
   GET /api/tasks/:id/summary
   └─ 获取实时汇总数据
     ├─ 整体统计（完成率、平均进度）
     ├─ 按门店分组统计
     └─ 时间线追踪
```

### 数据关系图

```
tasks（任务表）
  ↓ 1:N
task_assignments（分配表）
  ├─ assignee_id → employees
  ├─ store_id → stores
  └─ task_id → tasks

员工更新进度：
  assignment.progress ← 员工 PATCH
       ↓
  汇总计算：SUM(progress) / COUNT(*)
       ↓
  任务汇总：summary.avgProgress
```

---

## 🏗️ 系统架构

### 三层 Agent 架构

```
┌─────────────────────────────────────────────────────┐
│  Central (总部)                                      │
│  ├─ 创建任务、下发任务                               │
│  ├─ 查看完整培训数据（50门店×300人）                 │
│  └─ 按地区/部门聚合分析                              │
├─────────────────────────────────────────────────────┤
│  Store Manager (店长) ×50                           │
│  ├─ 接收任务、管理本店员工                           │
│  ├─ 查看本店员工进度（6人/店）                       │
│  └─ 提交店铺级反馈                                   │
├─────────────────────────────────────────────────────┤
│  Employee (员工) ×300                               │
│  ├─ 接收任务、更新进度                               │
│  ├─ 提交反馈和问题                                   │
│  └─ 查看任务详情                                     │
└─────────────────────────────────────────────────────┘
           ↕ WebSocket + REST API
┌─────────────────────────────────────────────────────┐
│  Backend Server (Node.js + Express)                 │
│  ├─ 任务管理服务                                     │
│  ├─ 数据汇总服务                                     │
│  ├─ 认证授权                                         │
│  └─ 实时推送（WebSocket）                           │
├─────────────────────────────────────────────────────┤
│  数据存储 (SQLite)                                   │
│  ├─ tasks: 任务信息                                  │
│  ├─ task_assignments: 分配记录                       │
│  ├─ employees: 员工信息（300人）                     │
│  ├─ stores: 门店信息（50家）                         │
│  └─ users: 用户账户（350人）                         │
└─────────────────────────────────────────────────────┘
```

---

## 🔐 认证和权限

| 角色 | 权限 | API 限制 |
|------|------|--------|
| **admin** | 全部权限 | 无限制 |
| **central** | 创建下发任务、查看汇总 | POST /tasks, GET /summary |
| **store** | 管理店内员工、查看员工进度 | GET /stores/:id/employees |
| **employee** | 接收任务、更新进度 | PATCH /assignments |

**认证方式：** JWT Token（7天有效期）

---

## 📊 当前状态

### ✅ 已完成
- [x] 数据库设计和初始化
- [x] 用户认证系统
- [x] 任务创建和下发
- [x] 进度追踪（TaskSummaryService）
- [x] 任务汇总 API
- [x] WebSocket 推送
- [x] Mock 数据（300 学员）
- [x] 后端测试验证

### 🚧 进行中
- [ ] 前端集成 API
- [ ] 三个界面的任务展示
- [ ] 进度条和反馈 UI

### 📋 待办
- [ ] 前端部署和测试
- [ ] Demo 演示
- [ ] 性能优化
- [ ] 功能扩展（数据导出、报表等）

---

## 🚀 快速启动

### 启动后端
```bash
cd server
npm install
npm start
# 服务地址: http://localhost:8080
# WebSocket: ws://localhost:8080/ws
```

### 访问前端
```
总部端: http://localhost:8080/front-end/central.html
店长端: http://localhost:8080/front-end/store.html
员工端: http://localhost:8080/front-end/employee.html
```

### 测试账户
```
总部: username=central, password=central123
店长: username=store_S001, password=store123
员工: username=employee_E001, password=emp123
```

---

## 📚 关键文档导航

| 文档 | 适用场景 | 阅读时间 |
|------|--------|-----------|
| [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) | 理解项目全景 | 5 分钟 |
| [ARCHITECTURE.md](../backend/ARCHITECTURE.md) | 了解系统设计 | 10 分钟 |
| [QUICK_START.md](../tests/QUICK_START.md) | 本地启动和测试 | 5 分钟 |
| [API_REFERENCE.md](../specs/API_REFERENCE.md) | 调用 API 接口 | 15 分钟 |
| [INTEGRATION_GUIDE.md](../specs/INTEGRATION_GUIDE.md) | 前后端集成 | 20 分钟 |
| [DATABASE_SCHEMA.md](../specs/DATABASE_SCHEMA.md) | 理解数据结构 | 10 分钟 |
| [DEBUGGING_GUIDE.md](DEBUGGING_GUIDE.md) | 问题排查 | 按需 |

---

## 💡 AI 快速查询指南

### "如何调用任务 API？"
→ 查看 [API_REFERENCE.md](../specs/API_REFERENCE.md) 中的任务部分

### "前后端如何连接？"
→ 查看 [INTEGRATION_GUIDE.md](../specs/INTEGRATION_GUIDE.md)

### "数据库表结构是什么？"
→ 查看 [DATABASE_SCHEMA.md](../specs/DATABASE_SCHEMA.md)

### "如何启动服务？"
→ 查看 [QUICK_START.md](../tests/QUICK_START.md)

### "员工进度如何更新和汇总？"
→ 查看 [ARCHITECTURE.md](../backend/ARCHITECTURE.md) 中的数据流部分

---

## 📞 常见问题速查

| 问题 | 答案 | 文档 |
|------|------|------|
| 如何添加新的 API 端点？ | 在 routes/ 中添加路由，在 services/ 中实现逻辑 | ../specs/INTEGRATION_GUIDE.md |
| 如何修改数据库字段？ | 编辑 schema/tasks.sql，使用 ALTER TABLE | ../specs/DATABASE_SCHEMA.md |
| WebSocket 如何工作？ | 连接后自动接收 state 更新，可订阅特定事件 | ../backend/ARCHITECTURE.md |
| 进度更新后多久汇总生效？ | 实时，调用 /summary API 即得最新数据 | ../specs/API_REFERENCE.md |
| 如何检查认证是否成功？ | 查看 JWT token，后续 API 带 Authorization header | ../tests/QUICK_START.md |

---

## 🔗 相关资源

- **Backend Report:** [BACKEND_IMPLEMENTATION_REPORT.md](../backend/BACKEND_IMPLEMENTATION_REPORT.md)
- **前端系统行为:** [FRONTEND_SYSTEM_BEHAVIOR.md](../frontend/FRONTEND_SYSTEM_BEHAVIOR.md)
- **技术索引:** [TECH_INDEX.md](../specs/TECH_INDEX.md)
- **原始 API 约定:** [API.md](../specs/API.md)

---

**最后更新：** 2026-03-18
**维护者：** Claude AI
**版本：** 1.0

