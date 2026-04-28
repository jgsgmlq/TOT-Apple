# Seed 数据生成说明

本文档介绍了 TOT / Apple 零售培训任务管理系统的 Seed 数据生成逻辑、运行方式及数据分布。

## 1. 运行方式

Seed 脚本位于 `TOT_backend/server/db/seed.js`。

### 执行命令
在仓库根目录下执行：
```bash
node TOT_backend/server/db/seed.js
```
或者进入 server 目录执行：
```bash
cd TOT_backend/server
node db/seed.js
```

> **注意**：执行 Seed 脚本会先清空现有的业务数据（任务、分配、通知、聊天记录等），并根据当前的脚本定义重新生成。

---

## 2. 数据分布逻辑

为了模拟真实的业务场景，Seed 数据采用了“差异化”设计，通过不同的档位（Archetype）和画像来模拟多样化的完成情况。

### 2.1 门店档位 (Store Archetypes)
系统定义了 10 家模拟门店，分为四个档位：
- **excellent (优秀)**: 如上海环球港旗舰店。完成率高（约 80%-90%），进度超前。
- **good (良好)**: 多数门店处于此档位。完成率稳健（约 50%-70%）。
- **moderate (待改进)**: 完成率中等（约 30%-50%），存在一定的滞后。
- **warning (预警)**: 如重庆观音桥、哈尔滨中央大街店。完成率低（<20%），触发多项预警。

### 2.2 任务时段 (Task Timelines)
内置了 6 个具有代表性的任务：
- **TASK_A**: 已逾期任务。用于观察最终达成率和逾期后的数据表现。
- **TASK_B**: 正常进行中任务。处于生命周期中期。
- **TASK_C**: 刚下发任务。大部分员工处于 Pending 状态。
- **TASK_WARN_START / P1 / P0**: 专门用于测试起步异常、48小时预警（P1）和 24小时预警（P0）逻辑的任务。

### 2.3 员工画像 (Employee Personas)
每家门店生成 10 名员工，对应 10 种不同的行为逻辑（从“早鸟完成者”到“极高风险待催办者”），体现了完成速度、平台进度和催办次数的差异。

---

## 3. 核心数据表概览

- **stores**: 10 条记录，涵盖 Monobrand, Multibrand, Carrier, Education 四种渠道。
- **employees**: 100 条记录，分布在上述门店中。
- **tasks**: 6 条预定义任务。
- **task_assignments**: ~600 条记录（员工 × 任务），包含多维度的平台完成情况（MyPal, SmartSell, AI Demo, Live Broadcast）。
- **notification_events**: 包含任务下发通知及历史自动催办（P2/P1/P0）记录。
- **mypal_learning_mock**: 模拟 MyPal 平台的原始同步数据。

---

## 4. 自动预警集成

Seed 脚本在完成基础数据写入后，会调用 `services/autoNudge.js` 引擎：
1. 根据当前生成的任务 DDL 和员工进度，自动计算并触发实时的预警记录。
2. 确保看板中的“预警漏斗”和“待办事项”具有真实的行为数据支撑。

---

## 5. 测试账号

| 用户名 | 密码 | 角色 | 备注 |
| :--- | :--- | :--- | :--- |
| `central` | `Train2026!` | 总部 | 可访问 HQ 看板全量数据 |
| `executive` | `Train2026!` | 渠道总监 | 可访问 Executive Chat (全国) |
| `executive_mono` | `Train2026!` | Monobrand 总监 | 仅限 Monobrand 渠道数据 |
| `emp_E001` | `Train2026!` | 店员 | 上海环球港，优秀员工 |
| `emp_E010` | `Train2026!` | 店员 | 上海环球港，高风险员工 |
| `admin` | `Admin2026!` | 管理员 | 系统管理权限 |

---

## 6. 开发建议

如果你需要修改数据规模或分布逻辑：
1. 修改 `STORE_DEFS` 增减门店。
2. 修改 `ARCHETYPE_STATUS` 调整不同档位下的完成概率。
3. 修改 `TASKS` 定义调整任务的时间窗口。
4. 运行 `node db/seed.js` 刷新数据库。
