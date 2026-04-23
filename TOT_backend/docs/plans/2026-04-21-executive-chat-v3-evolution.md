# Executive Chat v3.0 演进与重构计划 (Agent 架构升级)

**状态:** 草案 (Draft) | **目标版本:** v3.0.0 | **日期:** 2026-04-21
**核心目标:** 突破当前 Function Calling (FC) 结合预定义 SQL 工具的僵化模式，向具备“现场推理计算”、“生成式动态 UI”及“智能多轮澄清”的 Level 3 Agent 架构演进。

---

## 第一阶段 (Phase 1): 意图基建与柔性澄清重构
*预计耗时: 1-2 周*

**目标:** 替换生硬的正则拦截，实现真正连贯的多轮对话体验，消除高管在查询歧义时的“挫败感”。

### 1.1 引入 Semantic Router (智能意图防火墙)
*   **痛点**: `chatAgentRunner.js` 中的 `OUT_OF_SCOPE_ACTION_RE` 正则会误伤合理查询（如询问催办文案）。
*   **方案**:
    *   移除 `classifyExecutionMode` 中的正则匹配。
    *   在主 FC 循环前，引入一个极小且极快的模型（如 Qwen-Turbo 或本地轻量模型）作为 **Supervisor (监工)**。
    *   **Supervisor Prompt**: 判断用户的真实意图是否是“试图修改数据库或让系统自动发邮件”。如果是，以高情商话术拒绝；如果只是询问流程或文案，放行至主查询循环。

### 1.2 重构多轮澄清机制 (Multi-turn Disambiguation)
*   **痛点**: 门店名称（如“万象城店”）存在歧义时，当前逻辑是中断大循环，返回 `needDisambiguation` 并在前端渲染丑陋的 `suggestions` 气泡，打断了连贯的思维链。
*   **方案**:
    *   升级 `chatWithToolsStream` 支持 **Tool 挂起与恢复 (Suspend & Resume)** 机制。
    *   当 `getStoreDetailData` 发现多条同名门店时，后端通过特定的 SSE Delta（如 `type: 'clarify_request'`）向前端下发结构化数据。
    *   前端收到后，在对话流中渲染一个 **`<ClarificationCard candidates={...} />` 组件**。
    *   高管点击具体门店后，前端将选择结果直接作为 `tool_reply` 提交至同一个 `tool_call_id`，模型**在同一个大循环内无缝继续推理**，不再粗暴中断。

---

## 第二阶段 (Phase 2): 算力下放与动态数据沙盒 (Advanced Data Analysis)
*预计耗时: 3-4 周*

**目标:** 解决数据查询的“单行道”问题。后端的工具不再提供算好的指标（如 P90、趋势），而是提供原始数据集（DataFrame），由 AI 现场进行高阶统计。

### 2.1 后端：抽象宽表提取工具 (`fetchRawDataset`)
*   **痛点**: 每新增一个统计维度（如求方差、正态分布），就需要在 `chat_tools/` 里写一个新的 SQL 和 JS 接口。
*   **方案**:
    *   废弃或降级 `tool_runAnalytics.js`。
    *   新增核心工具：`fetchRawDataset(scope: 'training' | 'warnings', filters: {...}, limit: number)`。
    *   该工具的作用仅仅是根据高管的权限（Region Scope），安全地从宽表中拉取前 N 条清洗后的原始数据行（CSV 或 JSON 格式）。

### 2.2 引入 Code Interpreter (代码解释器) 引擎
*   **方案**:
    *   在后端（如 Docker 容器池）或边缘计算侧部署一个安全的 **Python/WASM 沙盒**。
    *   当高管问：“帮我算一下华东区上个月培训耗时的 90 分位数，并和全国平均水平对比。”
    *   **执行流**:
        1.  主模型调用 `fetchRawDataset` 拿到华东区和全国的原始数据。
        2.  主模型自主编写一段 `pandas` 和 `numpy` 的 Python 脚本。
        3.  主模型调用内置的新工具 `executePythonCode(code, dataset)`，在沙盒中运行脚本。
        4.  沙盒返回计算出的 P90 数值和生成的图表配置（或 Base64 图片）。
    *   **收益**: AI 从此具备了无限的数据分析能力，不再受限于后端提前写好的聚合 SQL。

---

## 第三阶段 (Phase 3): 生成式交互层升级 (Generative UI)
*预计耗时: 2-3 周*

**目标:** 抛弃大模型输出脆弱的 Markdown ECharts 字符串片段的方式，拥抱组件驱动的富交互体验。

### 3.1 前端：构建 E-Chat 专属组件注册中心 (Component Registry)
*   **痛点**: 当前 AI 生成 ` ```echarts {...} ``` ` 围栏，解析脆弱，且展示形式仅限于图表。
*   **方案**:
    *   在 Vue3 前端预先封装一系列“微前端”业务组件。例如：
        *   `<RegionalPerformanceHeatmap />` (区域热力图)
        *   `<StoreRiskRadar />` (单店风险雷达)
        *   `<TaskProgressTracker />` (任务进度里程碑)

### 3.2 后端：升级为结构化状态流 (Component State Stream)
*   **方案**:
    *   修改主 System Prompt：“不要输出 Markdown 代码块来展示图表，当需要展示复杂数据时，请调用特定工具下发组件渲染指令。”
    *   引入类似 Vercel AI SDK 的 `streamUI` 或 `render` 思想。
    *   后端 SSE 协议升级。原来只推送 `delta: text`。现在支持推送 `delta: component_state`，如：
        ```json
        {
          "type": "component_mount",
          "componentId": "StoreRiskRadar",
          "props": { "storeName": "上海静安", "riskScore": 85, "factors": [...] }
        }
        ```
    *   **收益**: 高管将在对话框中看到高度定制化、可交互的苹果风格仪表盘组件，甚至可以在这些生成的组件上直接操作（如点击柱状图下钻），实现“对话即看板”。

---

## 预期收益总结 (Expected Impact)

1.  **工程解耦**: 后端不再需要无休止地维护各种长尾数据聚合 API，维护成本降低 70%。
2.  **体验飞跃**: 告别机械的意图识别与打断，高管获得真正连贯的“副驾驶”级探索体验。
3.  **展示升维**: 从单调的文本/简单图表，升级为动态组装的富交互数据大屏，极大提升管理层的使用好感度与数据洞察力。