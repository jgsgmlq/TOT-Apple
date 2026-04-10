# Executive Chat 前端对接指南

**版本:** 1.0.3 | **角色:** `executive` | **终端:** H5 / 桌面（与 PRD 独立 Chat 页一致；当前工程为 Vue 3）
**基于:** [../specs/04-API-SPEC.md](../specs/04-API-SPEC.md) **§6**（HTTP 正本）+ [../specs/09-EXECUTIVE-CHAT.md](../specs/09-EXECUTIVE-CHAT.md)（产品行为、权限、溯源）
**图例:** ✅ 已对齐可实现 | ⚠️ 部分占位 / 待联调（以 04 各接口正本为准；`/api/v1/chat` 已在 `app.js` 挂载）

---

## 1. 实现状态（与仓库对齐）

| 项目 | 说明 |
|------|------|
| 后端 HTTP | **`/api/v1/chat/*` 已挂载**（`server/app.js` → `routes/chat.js`）；正本见 04 §6。 |
| 前端工程 | `TOT_frontend`：`/executive`、`/executive/login`，主界面 `src/views/executive/index.vue`；历史列表与回复目前可为占位，**需按本节契约接入真实 API**。 |
| 优先级 | 产品 **P1**；与 [../internal/FRONTEND-HANDOFF.md](../internal/FRONTEND-HANDOFF.md)「不在本期范围」一致时，仅作规格对齐，不阻塞 P0。 |

---

## 2. 页面与鉴权

### 2.1 路由（Vue）

| 路径 | 组件 | 说明 |
|------|------|------|
| `/executive/login` | `views/executive/login.vue` | 登录；`meta.ignoreAuth: true` |
| `/executive` | `views/executive/index.vue` | Chat 主界面；需 **`role === executive`** 的 JWT |

### 2.2 鉴权约定

- 全站基础路径：**`/api/v1`**
- 请求头：**`Authorization: Bearer <token>`**（必填；服务端从 JWT 解析 `req.user`，见 04「通用请求头」）
- Chat 接口权限：**仅 `executive`**（04 §6）
- 登录成功后保存 token；进入 `/executive` 前校验角色，非 executive 跳转登录或 403 提示

### 2.3 创建会话时的「辖区」参数与 [09-EXECUTIVE-CHAT.md](../specs/09-EXECUTIVE-CHAT.md) 一致：

- **全国：**`roleScope: "national"`，不传 `regions` / `rtm`
- **大区：**`roleScope: "regional"`，**必须**传 `regions: string[]`（元素与 **`stores.region`** 同源，如 `"华东"`）
- **按 RTM：**`roleScope: "rtm"`，**必须**传 `rtm`（与 `stores.rtm` 精确匹配）

`executiveId` 与 User-Id 对齐时，实现上通常等于 **`req.user.id`**（JWT）；若 04 仍写请求体 `executiveId`，与后端实现保持一致即可。

---

## 3. HTTP 契约摘要（正本在 04 §6）

以下路径均相对于 **`/api/v1`**。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/chat/executive/sessions` | 创建会话 → `sessionId`、`contextId`、`exampleQuestions` |
| POST | `/chat/executive/sessions/{sessionId}/messages` | 用户提问 → 结构化 `replyContent` |
| DELETE | `/chat/executive/sessions/{sessionId}` | 删除会话及全部消息（仅所属用户） |
| GET | `/chat/executive/sessions/{sessionId}/history` | 分页历史（`pageNum`、`pageSize`） |

**废弃：** 不得使用 ~~`POST /api/executive/chat`~~（09 与 04 均已废弃为非正本）。

### 3.1 创建会话 — 请求体（摘要）

```json
{
  "executiveId": "string",
  "roleScope": "national|regional|rtm",
  "regions": ["华东"],
  "rtm": "string"
}
```

### 3.2 发送消息 — 请求体（摘要）

```json
{
  "messageId": "string",
  "content": "string",
  "executiveId": "string",
  "contextId": "string"
}
```

- **`messageId`：** 建议前端用 `crypto.randomUUID()` 或等价唯一 ID，便于重试与去重。
- **`contextId`：** 使用创建会话（或上一轮回复）返回的上下文 ID；多轮追问必须沿用链路上**最新**的 `contextId`（若 04 约定每轮更新则以后端返回为准）。

### 3.3 统一响应壳

与全站一致：

```json
{
  "code": 200,
  "message": "string",
  "data": {},
  "requestId": "string"
}
```

前端联调问题请携带 **`requestId`** 给后端（见 [FRONTEND-HANDOFF.md](../internal/FRONTEND-HANDOFF.md)）。

---

## 4. 结构化回答 `replyContent`（UI 映射）

发送消息成功时，`data.replyContent` 为渲染主对象（04 §6.2）。建议前端组件化拆分：

| 字段 | UI 建议 | 说明 |
|------|---------|------|
| `overview` | 顶部摘要卡片 / 首条气泡 | 一句话结论 |
| `keyNumbers[]` | 指标栅格或列表 | 每项含 `label`、`value`、`unit`（若存在） |
| `attentionPoints[]` | 警告列表 / 高亮 | 可为空数组 |
| `followUpSuggestions[]` | 可点击 chips / 快捷追问 | 点击后填入输入框或直接发送 |

### 4.1 PRD §5.7.1 可选扩展（09 约定）

若后端返回，前端宜做**渐进增强**（无则隐藏）：

| 字段 | 前端行为 |
|------|----------|
| `statisticsProvenance` | 折叠「数据来源与口径」、tooltip 或次要文案 |
| `visualizations` | 按 `type` 渲染简单图（如 histogram）或外链图 |
| `forecastDisclaimer` | 预测类**必显**声明 |
| `correlationNote` | 相关分析旁注「相关非因果」 |
| `ecCapabilityTier` | 可选展示 `EC-P0` / `EC-P1` 标签 |

### 4.2 性能与反馈

- 04 示例含 **`responseTime`（ms）**；产品目标 **P95 ≤ 5s**（09）
- 超时 / **503**：提示「服务繁忙，请重试」，可带 `requestId`
- 若未来支持 **202 + jobId**（EC-P1 异步），需单独补交互：轮询或 WS（以最终实现为准）

---

## 5. 会话历史与侧边栏

`GET .../history` 返回 `historyList` + `pagination`。

| 前端概念 | API 字段 | 说明 |
|----------|----------|------|
| 侧边栏「历史会话」 | 若后端仅提供**单 session 内消息历史**，需产品确认是否另有「会话列表」接口；当前04 仅 §6.3 分页历史 | 可与 `sessionId` 列表本地缓存或后续接口扩展对齐 |
| 单条历史展示 | `content`、`sender`、`timestamp`、`replyContent` | `sender === executive` 为用户侧，否则为助手侧 |

### 5.1 产品说明：侧栏「新对话」与刷新

以下约定面向**产品 / 验收**，并与当前前端实现一致（侧栏与会话列表以本地持久化为主，正本 API 仍见 §3）。

| 原则 | 说明 |
|------|------|
| 刷新后的体验 | 刷新后用户仍应处于**可立即输入**的「新对话」状态（空白消息区 + 预设问题可点）。 |
| 不要堆空白会话 | **不得**因用户**反复刷新**而每次调用「创建会话」并在侧栏增加多条**内容相同、均为空白**的「新对话」条目。 |
| 侧栏中「新对话」数量 | 同一时间，侧栏里标题为「新对话」的会话**至多一条**。用户点击「新对话」或系统需要挂接新的空白会话时，应**移除或合并**其它「新对话」项后再保留当前这一条。 |
| 刷新时如何复用 | 若本地侧栏中已存在仍为「新对话」标题的会话（表示尚未用首条用户消息改写侧栏标题），刷新后应**复用该条的 `sessionId`**，**不再**调用 `POST .../sessions`；仅当侧栏中**没有**这样的空白项时（例如仅有已命名历史会话），首屏再创建新会话。 |
| 历史脏数据 | 若本地曾出现多条「新对话」（旧版本或异常），加载侧栏时应**合并为一条**并写回缓存。 |
| 预设问题 | 复用已有空白会话时无法再次拿到创建接口的响应体；可将**最近一次**创建会话返回的 `exampleQuestions` 按用户维度缓存在客户端；若无缓存则使用前端兜底预设文案。 |

**实现参考（仓库）：** `TOT_frontend/src/views/executive/index.vue` — 侧栏 `localStorage` key：`tot_executive_chat_sidebar_${username}`；预设缓存 key：`tot_executive_chat_presets_${username}`。

**「新对话」按钮（用户主动）：** 仍应调用 **创建会话** 获取新的 `sessionId` / `contextId`，清空当前消息区并展示 `exampleQuestions`，且遵守上表「至多一条空白会话」的侧栏规则。

### 5.2 产品说明：删除侧栏历史会话

| 项 | 说明 |
|------|------|
| 交互 | 每条侧栏会话行提供删除入口；操作前 **二次确认**。桌面侧栏：删除按钮在悬停或当前选中行时显示；移动端抽屉：删除按钮常显以便触摸。 |
| 服务端删除 | 用户确认后先调用 **`DELETE /api/v1/chat/executive/sessions/{sessionId}`**；成功后再从本地侧栏移除并 `persistSidebar`。失败（非「会话已不存在」类）时 **不移除侧栏**，由全局 HTTP 层 toast 错误。 |
| 幂等 | 若服务端返回 **404 / 会话不存在**（`CHAT_003`），视为已删除，仍同步移除侧栏，避免残留死链。 |
| 删除「当前正在查看」的会话 | 服务端删除成功后，调用 **创建会话**，进入 **新的空白「新对话」**（新 `sessionId`、展示 `exampleQuestions`，并遵守 §5.1「至多一条空白会话」）。 |
| 删除非当前会话 | 服务端删除成功后仅从侧栏移除；主区消息与当前 `sessionId` 不变。 |
| 加载历史中 | 正在 `GET .../history` 拉取时，禁止删除或提示稍候。 |
| 实现 | `deleteChatSession`：`TOT_frontend/src/api/chat/index.ts`；侧栏逻辑：`views/executive/index.vue`。 |

---

## 6. 错误与分支

| 场景 | HTTP / code | 前端处理 |
|------|-------------|----------|
| 未登录 / Token 无效 | 401 | 跳转 `/executive/login` |
| 非 executive 或越权 | 403，`AUTH_003` | 提示无权限 |
| `regional` 未传 `regions`等 | 400 | 展示后端 `message`，创建会话前做前端校验 |
| Agent 未就绪 / 超时 | 503 | 重试提示；记录 `requestId` |
| 业务码 | `code !== 200` | 统一 toast / 内联错误，勿静默失败 |

---

## 7. 与公共模块的关系

- **HTTP 封装：** 与 [04-SHARED.md](./04-SHARED.md) 目标一致：统一 Base URL、`Authorization`、401 处理、`requestId` 日志。
- **勿在浏览器调用 LLM Key：** DeepSeek / 其他模型仅服务端使用（04 §6.5）；前端只调 **`/api/v1/chat/...`**。

---

## 8. 对接清单（前端）

- [ ] 确认后端已挂载 `/api/v1/chat/executive/*`
- [ ] 登录后 `role === executive` 再进主界面
- [ ] 首屏：创建会话 → 展示 `exampleQuestions`
- [ ] 发送消息：生成 `messageId`，携带最新 `contextId`
- [ ] 渲染 `replyContent` 四段 + 可选扩展字段
- [ ] 多轮：至少3 轮追问链路可测（与 09 验收对齐）
- [ ] 503 / 401 / 403 与 `requestId` 可观测
- [x] 侧栏删除历史：先 `DELETE .../sessions/{id}`，再更新本地；删当前 → 新空白「新对话」—见 §5.2、04 §6.2.1

---

## 9. 参考文档索引

| 文档 | 用途 |
|------|------|
| [04-API-SPEC.md §6](../specs/04-API-SPEC.md) | 路径、请求/响应 JSON、错误场景 |
| [09-EXECUTIVE-CHAT.md](../specs/09-EXECUTIVE-CHAT.md) | 意图类型、`stores.region` 权限、溯源、LLM 架构 |
| [01-DATA-MODEL.md](../specs/01-DATA-MODEL.md) | `executive_regions` 等数据模型扩展说明 |
| [PRODUCT_REQUIREMENTS.md §5.7](../product/PRODUCT_REQUIREMENTS.md) | 产品话术与验收口径 |

---

## 10. 修订记录

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-04-10 | 初版：前端目录对齐，衔接 04 §6 / 09，Vue 路径与 UI 映射 |
| 1.0.1 | 2026-04-10 | §5.1 补充产品说明：侧栏「新对话」唯一性、刷新复用 `sessionId`、预设问题客户端缓存与实现引用 |
| 1.0.2 | 2026-04-10 | §5.2 侧栏删除历史（首版本地）；对接清单勾选与后续 DELETE 预留 |
| 1.0.3 | 2026-04-10 | §5.2 与 §3 对齐服务端 `DELETE`；§1 挂载状态；04 §6.2.1 正本 |
