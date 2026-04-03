# 系统架构设计文档

> ⚠️ **历史文档声明（重要）**
> 本文档基于旧版本实现（2026-03-18），仅用于历史背景参考，**不作为当前实现/验收依据**。
> 当前基线请以 `docs/product/PRODUCT_REQUIREMENTS.md` 与 `docs/specs/00-08` 及 `docs/backend/01-04` 为准。

**文档版本:** 1.0.0
**最后更新:** 2026-03-18
**文档作者:** Backend Team
**审批:** Product Team
**状态:** ⚠️ 历史版本（已过时）

---

## 1. 系统概览

### 1.1 系统定位

本系统是一个零代码企业零售培训管理平台，采用三层 Agent 架构，支持 50 个门店、300 个学员的大规模协作培训。

**核心特性：**
- 实时进度追踪
- 多维度数据汇总
- WebSocket 实时推送
- JWT 认证授权

### 1.2 系统指标

| 指标 | 值 | 说明 |
|------|-----|------|
| **用户规模** | 350 人 | 中央1 + 店长50 + 员工300 |
| **支持门店** | 50 个 | 每个门店6人 |
| **并发连接** | 100+ | WebSocket 连接数 |
| **API 延迟** | < 50ms | P95 响应时间 |
| **汇总准确率** | 100% | 实时统计准确 |

---

## 2. 架构设计

### 2.1 整体架构

```
┌──────────────────────────────────────────────────────────┐
│                    浏览器层（Frontend）                    │
├──────────────┬──────────────┬──────────────┐──────────────┤
│  Central UI  │  Store UI    │ Employee UI  │   Portal     │
│  (1920×1080) │  (Mobile)    │  (Mobile)    │  (Login)     │
└──────────────┴──────────────┴──────────────┴──────────────┘
                             ↕ HTTP + WebSocket
┌──────────────────────────────────────────────────────────┐
│               API Gateway (Express.js)                     │
├──────────────────────────────────────────────────────────┤
│  Authentication │ Authorization │ Request Logging │ CORS  │
└──────────────────────────────────────────────────────────┘
                             ↕
┌──────────────────────────────────────────────────────────┐
│                  Application Layer                        │
├──────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ TaskService │  │TaskSummaryService│DispatchService│  │
│  │ (任务管理)   │  │ (汇总统计)    │  │(任务下发)     │  │
│  └─────────────┘  └──────────────┘  └────────────────┘  │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ AuthService │  │ StateSync    │  │ NotifyService │  │
│  │ (认证)       │  │ (状态同步)    │  │(推送通知)     │  │
│  └─────────────┘  └──────────────┘  └────────────────┘  │
└──────────────────────────────────────────────────────────┘
                             ↕
┌──────────────────────────────────────────────────────────┐
│                   Data Layer (SQLite)                     │
├──────────────────────────────────────────────────────────┤
│  Tasks │ Assignments │ Employees │ Stores │ Users │       │
│  Events│ Alerts      │ PushLogs  │ Audit  │       │       │
└──────────────────────────────────────────────────────────┘
```

### 2.2 三层 Agent 架构

```
┌─────────────────────────────────────────────────────────┐
│  L1: 决策层 (Central Agent - 总部)                       │
│  ├─ 权限: 创建/下发任务、查看汇总、导出报表               │
│  ├─ 数据: 全公司视角（50门店×300人）                     │
│  ├─ 行为: 制定培训计划、监控进度、对标分析               │
│  └─ 接口: central.html                                  │
└─────────────────────────────────────────────────────────┘
                             ↕
┌─────────────────────────────────────────────────────────┐
│  L2: 执行层 (Store Manager Agent - 店长) ×50            │
│  ├─ 权限: 接收任务、管理员工、报送进度                   │
│  ├─ 数据: 本店视角（6人）                                │
│  ├─ 行为: 任务分配、员工督导、问题处理                   │
│  └─ 接口: store.html                                    │
└─────────────────────────────────────────────────────────┘
                             ↕
┌─────────────────────────────────────────────────────────┐
│  L3: 执行层 (Employee Agent - 员工) ×300                │
│  ├─ 权限: 接收任务、提交进度、反馈问题                   │
│  ├─ 数据: 个人视角（任务进度）                           │
│  ├─ 行为: 完成培训、记录学习、获取支持                   │
│  └─ 接口: employee.html                                 │
└─────────────────────────────────────────────────────────┘
```

---

## 3. 核心数据流

### 3.1 任务生命周期

```
创建阶段 (Create)
    │
    ├─ POST /api/tasks
    ├─ status: pending
    └─ 存储到 tasks 表

下发阶段 (Dispatch)
    │
    ├─ POST /api/tasks/:id/dispatch
    ├─ 创建 300 条 task_assignments 记录
    ├─ 按 target_role 过滤接收人
    ├─ status: dispatched
    └─ 触发 WebSocket 广播

接收阶段 (Receive)
    │
    ├─ PATCH /api/assignments/:id (status=received)
    ├─ received_at 时间戳
    └─ 店长/员工确认收到

执行阶段 (Execute)
    │
    ├─ PATCH /api/assignments/:id/progress
    ├─ progress: 0-100%
    ├─ feedback: 文本反馈
    ├─ 状态自动转换:
    │  ├─ progress > 0 → in_progress
    │  ├─ progress = 100 → completed
    │  └─ 记录 started_at / completed_at
    └─ 触发 WebSocket 推送

汇总阶段 (Summary)
    │
    ├─ GET /api/tasks/:id/summary
    ├─ 计算整体统计
    ├─ 按门店分组
    ├─ 生成时间线
    └─ 返回实时数据

完成阶段 (Complete)
    │
    └─ 所有 assignments = completed
       → 任务状态自动转为 completed
```

### 3.2 数据关系模型

```
ERD (Entity Relationship Diagram)

┌──────────────┐
│   users      │
├──────────────┤
│ id (PK)      │
│ username     │
│ password_hash│
│ role         │ ──┐
│ store_id (FK)│  │
│ employee_id  │  │
└──────────────┘  │
                  │
     ┌────────────┼────────────┐
     │            │            │
┌─────────────────┼─────────────┴──────────────┐
│    tasks        │                            │
├─────────────────┤                            │
│ id (PK)         │                            │
│ name            │                            │
│ description     │                            │
│ status          │      ┌──────────────────────────┐
│ target_role     │      │  task_assignments        │
│ store_scope     │      ├──────────────────────────┤
│ deadline        │      │ id (PK)                  │
│ created_by      │      │ task_id (FK) ←─┐        │
│ created_at      │      │ assignee_id    │        │
└─────────────────┤      │ assignee_role  │        │
                  │      │ store_id (FK)  │        │
                  │      │ status         │        │
                  │      │ progress       │        │
                  │      │ feedback       │        │
                  │      │ received_at    │        │
                  │      │ started_at     │        │
                  │      │ completed_at   │        │
                  │      └──────│ created_at ────┘        │
                         │ updated_at              │
                         └──────────────────────────┘
                                  │
                                  ├─ assignee_id → employees(id)
                                  └─ store_id → stores(id)
```

---

## 4. 关键服务设计

### 4.1 TaskSummaryService

**职责:** 聚合任务统计数据，提供多维度汇总

```javascript
class TaskSummaryService {
  // 获取任务完整汇总
  static getTaskSummary(taskId) {
    return {
      summary: {           // 整体统计
        total,
        completed,
        completionRate,
        avgProgress
      },
      storeBreakdown: [],  // 按门店分组
      timeline: {}         // 时间线追踪
    }
  }

  // 获取分配详情
  static getAssignmentDetail(assignmentId) {
    return {
      status,
      progress,
      feedback,
      timeline
    }
  }

  // 更新进度
  static updateAssignmentProgress(assignmentId, progress, feedback) {
    // 智能状态转换
    // 自动时间戳记录
    // 触发事件通知
  }
}
```

**设计亮点:**
- SQL 聚合函数优化（避免应用层计算）
- 事务一致性保证
- 时间戳自动管理

### 4.2 DispatchService

**职责:** 任务下发管理

```javascript
class DispatchService {
  // 下发任务给指定范围的人员
  static dispatchTask(taskId) {
    // 1. 验证任务存在
    // 2. 获取目标人员（按店铺和角色过滤）
    // 3. 批量创建 assignments
    // 4. 更新任务状态为 dispatched
    // 5. 记录下发事件
  }

  // 获取待接收任务
  static getPendingTasks(assigneeId, assigneeRole) {
    // 按用户筛选任务
  }
}
```

**设计亮点:**
- N+1 查询优化（JOIN 而非循环）
- 大批量插入性能考量
- 事务原子性

### 4.3 WebSocket 推送机制

```javascript
// 事件类型
const Events = {
  TASK_CREATED: 'task_created',      // 新任务创建
  TASK_DISPATCHED: 'task_dispatched',// 任务下发
  PROGRESS_UPDATED: 'progress_updated', // 进度更新
  TASK_COMPLETED: 'task_completed'   // 任务完成
}

// 推送策略
function broadcastState() {
  // 推送完整 state（包含所有事件和统计）
  // 包含时间戳用于前端去重
  // 适配 100+ 并发连接
}
```

---

## 5. API 规范

### 5.1 请求规范

**认证:** JWT Token（Header）
```
Authorization: Bearer <token>
```

**错误响应标准:**
```json
{
  "error": "错误描述",
  "errorCode": "ERR_001",
  "timestamp": "2026-03-18T12:00:00Z"
}
```

**成功响应标准:**
```json
{
  "data": {},
  "timestamp": "2026-03-18T12:00:00Z"
}
```

### 5.2 API 分类

| 分类 | 端点 | 权限 | 说明 |
|------|------|------|------|
| **任务管理** | POST /api/tasks | central | 创建任务 |
| | GET /api/tasks | all | 列表查询 |
| | GET /api/tasks/:id | all | 详情查询 |
| | POST /api/tasks/:id/dispatch | central | 下发任务 |
| | GET /api/tasks/:id/summary | all | 任务汇总 |
| **分配管理** | GET /api/assignments/:id | all | 分配详情 |
| | PATCH /api/assignments/:id/progress | all | 更新进度 |
| **数据查询** | GET /api/stores | all | 门店列表 |
| | GET /api/employees | all | 员工列表 |
| **认证** | POST /api/login | public | 登录 |
| | GET /api/me | all | 当前用户 |

---

## 6. 数据库设计

### 6.1 核心表结构

```sql
-- 任务表
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT,              -- pending | dispatched | completed
  target_role TEXT,         -- store_manager | employee | both
  deadline TEXT,
  created_by TEXT,
  created_at TEXT
);

-- 分配表（关键：记录每个人的任务状态）
CREATE TABLE task_assignments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,    -- 关联任务
  assignee_id TEXT NOT NULL, -- 员工 ID
  store_id TEXT NOT NULL,    -- 门店 ID
  status TEXT,              -- pending | in_progress | completed
  progress INTEGER,         -- 0-100
  feedback TEXT,            -- 员工反馈
  received_at TEXT,         -- 接收时间
  started_at TEXT,          -- 开始时间
  completed_at TEXT,        -- 完成时间
  created_at TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);
```

### 6.2 索引策略

```sql
CREATE INDEX idx_assignments_task_id ON task_assignments(task_id);
CREATE INDEX idx_assignments_assignee_id ON task_assignments(assignee_id);
CREATE INDEX idx_assignments_store_id ON task_assignments(store_id);
CREATE INDEX idx_assignments_status ON task_assignments(status);
```

---

## 7. 性能考虑

### 7.1 查询优化

| 操作 | 优化方案 | 性能 |
|------|--------|------|
| 汇总统计 | SQL 聚合函数 | < 20ms |
| 批量下发 | 单次批量插入 | < 50ms |
| 分组查询 | 索引 + GROUP BY | < 10ms |
| 列表查询 | 分页 + 索引 | < 5ms |

### 7.2 缓存策略

```javascript
// TaskSummaryService 添加缓存
const cache = {
  'summary_TASKID': {
    data: {...},
    timestamp: Date.now()
  }
}

// 缓存有效期: 5 秒（足以应对并发查询）
const CACHE_TTL = 5000;
```

### 7.3 并发处理

- WebSocket 广播: 支持 100+ 并发连接
- 数据库并发: SQLite WAL 模式，支持并发读
- 批量操作: 事务保证一致性

---

## 8. 安全性设计

### 8.1 认证

- JWT Token（7 天有效期）
- 密码 Hash（bcrypt + salt）
- Token 刷新机制

### 8.2 授权

- 基于角色的访问控制（RBAC）
- 资源所有权验证（不能访问他人数据）
- API 级别权限检查

### 8.3 数据安全

- SQL 参数化（防 SQL 注入）
- 输入验证（长度、类型、范围）
- 审计日志（可选）

---

## 9. 扩展性设计

### 9.1 水平扩展

```
当前: 单服务器 (SQLite)
规划: Node 集群 + Redis 缓存 (未来)
```

### 9.2 功能扩展点

- **数据导出:** 添加 GET /api/tasks/:id/export
- **报表生成:** 添加复杂的统计维度
- **消息队列:** 异步任务处理
- **权限系统:** 更细粒度的权限控制

---

## 10. 部署和运维

### 10.1 启动命令

```bash
# 开发环境
npm install
npm start

# 生产环境
NODE_ENV=production npm start
```

### 10.2 环境变量

```
PORT=8080
JWT_SECRET=<生成的密钥>
NODE_ENV=production
DB_PATH=/path/to/database.db
```

### 10.3 监控指标

- API 响应时间
- 数据库连接池
- WebSocket 连接数
- 内存使用率
- 错误率

---

## 11. 版本历史

| 版本 | 日期 | 变更 | 作者 |
|------|------|------|------|
| 1.0 | 2026-03-18 | 初版 - 后端完成 | Backend Team |

---

**相关文档:**
- [API_REFERENCE.md](../specs/API_REFERENCE.md) - 详细 API 参考
- [DATABASE_SCHEMA.md](../specs/DATABASE_SCHEMA.md) - 数据库详细设计
- [INTEGRATION_GUIDE.md](../specs/INTEGRATION_GUIDE.md) - 前后端集成指南

