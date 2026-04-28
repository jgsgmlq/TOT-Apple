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
*Happy Graph Routing!* 🚀