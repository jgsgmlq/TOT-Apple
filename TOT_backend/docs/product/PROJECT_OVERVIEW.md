# MVP 项目总体概览

## 项目基本信息

| 项目 | TOT / Apple 零售培训任务管理（MVP） |
|------|--------------------------------------|
| **产品口径** | 以 [`PRODUCT_REQUIREMENTS.md`](./PRODUCT_REQUIREMENTS.md) 为准（需求、角色、验收见该文档） |
| **目标** | 约 50 门店 × 300 名学习对象；跑通培训任务闭环与数据看板；Executive Chat 为 P1 |
| **形态** | 独立 H5 Web App，局域网访问；**前后端分离**（当前仓库：`TOT_frontend` + `TOT_backend`） |
| **后端** | Node.js（Express）+ SQLite（`better-sqlite3`）+ WebSocket |
| **前端** | Vue 3 + Vite（总部 / 店员 / Executive 等入口，见根目录 `README.md` 与 `TOT_frontend`） |

---

## 与 PRD 一致的核心结论（摘要）

- **P0 双主线**：任务管理闭环（总部下发 → 学习对象执行 → **规则引擎**预警提醒）+ 总部数据看板（含 RTM L4、链路、预警指标）。
- **P1**：Executive Chat（自然语言查询）、部分 AI 辅助能力等，见 PRD §3.2。
- **店长**：MVP **不设独立管理端**；若总部将店长纳入下发范围，店长作为**学习对象**与店员**共用同一学习端**（Banner、消息中心、任务详情等）。
- **产品语义**：P0 **不做人工催办**；预警由规则自动计算并触达。实现代码或 API 中若仍出现 `nudge` /「催办」等命名，视为**实现层历史命名**；链路指标在 PRD 中称 **「提醒转化率」**（定义见 PRD）。
- **状态机**：`Assignment` 为 `pending → in_progress → completed`（详见 `docs/specs/02-STATE-MACHINES.md`）。

---

## 仓库目录结构（当前）

以下为文档撰写时的主干布局，**以仓库实际文件为准**。

```
MVP/                                 # 仓库根目录
├── TOT_frontend/                    # Vue 3 + Vite 前端
│   └── src/                         # 页面与视图（总部 / 店员 / Executive 等）
├── TOT_backend/
│   ├── server/                      # Node 后端入口（app.js、routes、services、db…）
│   │   └── package.json
│   └── docs/                        # 本文档所在目录（产品 / specs / backend / tests …）
├── README.md                        # 联调进度、共享服务器、快速启动
└── scripts/                         # 如 deploy.sh 等
```

更细的**路由与实现对照**见 [`../backend/index.md`](../backend/index.md)；**接口契约**见 [`../specs/04-API-SPEC.md`](../specs/04-API-SPEC.md)。

---

## 核心业务流程（产品视角）

```
总部（Central）
  → 选择学习平台与可布置任务 → 填写任务信息与预警规则 → 一键下发
        ↓
为范围内学习对象生成 Assignment（pending）
        ↓
学习对象（店员 / 店长学习对象，同一学习端）
  → Banner / 消息中心触达 → 开始学习（in_progress）→ 各平台完成判定 → 标记完成（completed）
        ↓
规则引擎按任务配置计算预警 → 消息中心 / 弹窗提醒（任务完成前持续，完成后消失）
        ↓
总部看板：完成率、按时完成率、人均完成时间、RTM L4、链路、预警等
```

Executive Chat、AI 润色/洞察等见 PRD 优先级说明。

---

## 文档导航（优先阅读）

| 文档 | 说明 |
|------|------|
| [PRODUCT_REQUIREMENTS.md](./PRODUCT_REQUIREMENTS.md) | 产品需求全文 |
| [../README.md](../README.md) | 文档中心总索引 |
| [../specs/00-OVERVIEW.md](../specs/00-OVERVIEW.md) | Spec 总览与索引 |
| [../specs/04-API-SPEC.md](../specs/04-API-SPEC.md) | REST / WebSocket 契约 |
| [../tests/QUICK_START.md](../tests/QUICK_START.md) | 本地启动与测试 |
| [../backend/index.md](../backend/index.md) | 后端文档入口 |

---

## 本地启动（摘要）

详细步骤以 [`../tests/QUICK_START.md`](../tests/QUICK_START.md) 与仓库根 [`README.md`](../../../README.md) 为准。

```bash
# 后端（示例）
cd TOT_backend/server && npm install && npm run dev

# 前端（示例）
cd TOT_frontend && pnpm install && pnpm run dev
```

默认 API 端口与前端端口以各子项目配置为准（根 `README.md` 中通常为后端 `3000`、Vite `8001` 等）。

---

**最后更新：** 2026-04-09  
**维护：** 与 `PRODUCT_REQUIREMENTS.md` 及 `docs/specs` 同步更新
