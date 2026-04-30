# Executive Chat (LangGraph) 本地调试与 Langfuse 观测指南

随着 E-Chat v4.0 核心链路迁移到 LangGraph，系统图流转的状态机调试（包括消歧挂起、FC修参、工具执行等）变得更加复杂。为了不影响大家的代码调试体验，我们在本地环境接入了 **Langfuse 官方 Core SDK** 进行可观测性追踪。

由于我们（团队）**共用同一个 Langfuse Project Key**，为了防止不同开发者的测试数据互相污染，请所有参与 E-Chat 开发的同学遵循以下指南。

---

## 1. 本地 `.env` 配置 (必须项)

请确保你的 `TOT_backend/.env` 文件中包含以下基础配置。如果你的项目根目录没有 `.env`，请从 `.env.example` 复制一份。

```env
# ==== Langfuse Tracing (E-Chat v4.0) ====
# 开关：本地调试时必须设为 true 才会向 Langfuse 发送数据
LANGFUSE_ENABLED="true"

# 请向项目负责人索取共用的 Project API Keys
LANGFUSE_PUBLIC_KEY="pk-lf-..."
LANGFUSE_SECRET_KEY="sk-lf-..."

# 官方云端地址（或我们私有部署的地址）
LANGFUSE_BASEURL="https://us.cloud.langfuse.com" 
```

## 2. 数据隔离与自动化 Tag

**无需在代码中手动修改你的名字！**

只要你拉取了最新代码（包含 `t5MockTest.js` 和图流转逻辑的更新），系统在发起本地测试时，会自动抓取你电脑的**系统用户名**（即 `process.env.USER` 或 `process.env.LOGNAME`，例如 `skyler` 或 `zhangsan`）。

系统会自动为你发出的每条 Trace 注入以下隔离属性：
- **Trace Name**: 带有你名字的后缀，如 `ExecutiveChat-LangGraph-[skyler]`
- **User ID**: 强制映射为你的系统用户名
- **Tags**: 自动附加 `dev:你的用户名` (例如 `dev:skyler`) 和 `env:development`
- **Metadata**: 自动附加你当前的 Git 分支名（默认 fallback 为 `Echat2.0`）

## 3. 运行本地 Mock 测试验证

在进行 LangGraph 图节点开发后，你可以使用我们预置的 `t5MockTest.js` 快速验证图流转与埋点是否成功：

```bash
cd TOT_backend/server
# 确保在 server 目录下执行，因为需要加载上一级的 .env
node -e "require('dotenv').config({ path: '../.env' }); require('./agent/graph/t5MockTest.js')"
```

如果运行成功，你会在终端底部看到类似输出：
```text
[Langfuse Trace] 已生成/更新 Trace: d8fe95e2-3e3a-4660-a972-8ae0e845cd70
=== 数据已成功 flush 到 Langfuse 面板 (https://us.cloud.langfuse.com) ===
```

## 4. 在 Langfuse 面板查看你自己的数据

登录团队共用的 Langfuse 网页控制台：

1. 进入对应的 **Project**。
2. 点击左侧导航栏的 **Traces**。
3. 在列表顶部的 **Filter** 栏，点击 **Tags**。
4. 勾选 **`dev:你的系统用户名`**（如果是第一次运行，可能需要几秒钟等面板识别出这个新 Tag）。
5. *(可选)* 你也可以在 Filter 中选择 **User ID**，填入你的用户名。

完成过滤后，你看到的瀑布流（Waterfall）和各项消耗就**全部是你自己本地**跑出来的请求了，不用担心被其他同事的疯狂调试刷屏。

---

## 5. Executive Chat 的 Langfuse 调试最佳工作流 (Workflow)

对于基于 LangGraph 的复杂状态机（意图拦截 -> FC 工具预测 -> 参数修复 -> 执行），单纯看控制台 `console.log` 是不够的。请团队遵循以下标准的排障与优化工作流：

### 场景一：Bug 诊断（如大模型一直在死循环查数据）

1. **复现与捕捉**：在本地运行测试或前端界面触发异常。
2. **复制 Trace ID**：找到控制台打印的 `[Langfuse Trace] 已生成/更新 Trace: uuid`，复制该 ID。
3. **查看瀑布图 (Waterfall)**：进入 Langfuse 搜索该 ID。
4. **定位异常节点**：
   - 展开 `ContextAnalyzerRouter` 的 Span：检查 `Output` 中的 `intent` 和 `safety`。是不是问题本身就不该进工具调用？是不是被误判为闲聊了？
   - 展开 `fc_LlmToolCallStep` 的多轮 Span：点开其中一次大模型的请求。查看发送给模型的 `System Prompt` 里的工具列表（Schema）和 `Messages` 历史，看模型为什么固执地生成了错误的参数。
   - 检查 `Metadata`：侧边栏的 Metadata 中有 `fc_steps_used` 和 `repair_attempts`。如果发现 `repair_attempts` 为 2，说明触发了 **Fail Fast** 熔断。去 `fc_ValidateParams` 节点看到底是哪个必填参数缺失了。

### 场景二：协同排查与分享

如果你的代码分支遇到了解决不了的 Prompt 效果问题：
1. 不要截图发长长的 JSON！
2. 确保 `t5MockTest.js` 将你的 Trace 上报到了我们共用的 Project 中。
3. 点击 Langfuse 面板该条 Trace 右上角的 **Share** 按钮，复制只读链接。
4. 在企微/飞书中将链接发给同事：*"你看这个链接，为什么这段 Prompt 提取不出 `region_id` 这个实体？"* 你的同事点开就能看到一模一样的完整请求上下文和耗时。

### 场景三：性能瓶颈调优 (TTFT 与 P95 达标)

为了满足我们在 `t0-freeze-spec.md` 中冻结的性能门槛（TTFT < 2.5s, P95 < 12s）：
1. 使用 Langfuse 面板的 **Dashboard** 功能。
2. 过滤 `tags = executive_chat`。
3. 查看 **Latency** 图表。如果发现某些请求时间极长，点进具体 Trace。
4. 观察每个 Span 的右侧耗时条：
   - 如果是 `ContextAnalyzerRouter` 耗时超过 2s：说明我们前置的意图小模型太慢，可能需要更换更快的模型底座或精简 Schema。
   - 如果是 `fc_ExecuteTool` 耗时过长：说明是我们后端的 SQL 查询、API 调用或 E2B 沙盒太慢，而非大模型的锅，需优化数据库索引。

### 场景四：回归测试对比 (A/B Test)

当你修改了某个核心工具的 `Description`（例如教会它如何区分大区和业态）：
1. 在 `t5MockTest.js` 中将你的 `tags` 改为 `["executive_chat", "prompt_v2_test"]`。
2. 运行一遍所有核心测试用例。
3. 在 Langfuse 面板过滤 `prompt_v2_test` 的 Trace，与之前的历史数据对比。看 `fc_steps_used`（平均需要几轮 FC 才能得到结果）是否有所降低。如果步数减少，说明你的 Prompt 修改让大模型变得更聪明了，一次性就选对了参数！

---
*Happy Graph Routing!* 🚀