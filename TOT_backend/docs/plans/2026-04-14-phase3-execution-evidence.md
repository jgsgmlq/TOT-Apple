# 第三阶段执行验收与回滚留证（统一 Agent 架构）

## 验收范围

- T3-01~T3-08（Function Calling 主链路守门、分析链路、会话态、预警降级、文档同步、回滚演练）

## 命令留证

### 1) 语法校验

```bash
node --check TOT_backend/server/services/chatAgentRunner.js
node --check TOT_backend/server/services/chatService.js
node --check TOT_backend/server/services/chatAnalyticsService.js
node --check TOT_backend/server/services/chatSessionStateService.js
node --check TOT_backend/server/chat_tools/tool_getWarnings.js
node --check TOT_backend/server/chat_tools/tool_runAnalytics.js
```

结果：全部通过（exit code 0）。

### 2) 守门策略冒烟（deny/chat_only）

```bash
node -e "process.env.CHAT_AGENT_MODE='function_calling'; const runner=require('./TOT_backend/server/services/chatAgentRunner'); (async()=>{const a=await runner.run('你好',[],{type:'national',regions:null,rtm:null},{sessionId:'sess_a'}); const b=await runner.run('帮我生成催办邮件',[],{type:'national',regions:null,rtm:null},{sessionId:'sess_a'}); console.log('chat_only',a._intentType,'deny',b._intentType);})();"
```

结果：`chat_only chat_only deny deny`。

### 3) 分析能力冒烟（EC-P0 + EC-P1）

```bash
node -e "const svc=require('./TOT_backend/server/services/chatAnalyticsService'); const scope={type:'national',regions:null,rtm:null}; const types=['quantile_duration','completion_time_distribution','metric_correlation','progress_variance_by_channel','completion_rate_forecast','trimmed_mean_duration']; for (const t of types){const out=svc.runAnalysis({analysisType:t}, scope); console.log(t, typeof out==='object' && out.analysisType===t ? 'ok':'bad');}"
```

结果：6 项全部 `ok`。

### 4) 会话态缓存冒烟

```bash
node -e "const state=require('./TOT_backend/server/services/chatSessionStateService'); state.clearSession('sess_test'); state.addRecord('sess_test',{signature:'toolA|-|-|-|-',source:'test',result:{x:1}}); const hit=state.getLatestBySignature('sess_test','toolA|-|-|-|-'); console.log('cache_hit', !!hit, hit && hit.result.x);"
```

结果：`cache_hit true 1`。

### 5) 回滚开关演练

```bash
node -e "process.env.CHAT_AGENT_MODE='intent_routing'; process.env.CHAT_SESSION_STATE_ENABLED='0'; const runner=require('./TOT_backend/server/services/chatAgentRunner'); (async()=>{const a=await runner.run('你好',[],{type:'national',regions:null,rtm:null},{sessionId:'sess_b'}); console.log('mode_fallback_ok', a._intentType);})();"
```

结果：`mode_fallback_ok chat_only`。

## 回滚策略确认

- 关闭 FC：`CHAT_AGENT_MODE=intent_routing`
- 关闭会话缓存：`CHAT_SESSION_STATE_ENABLED=0`
- 预警降级链路为内置只读逻辑，不引入数据库写变更，可随版本回滚代码。

## 风险备注

- `completion_rate_forecast` 当前为线性估计（近 24 小时速率），应在前端展示“预测仅供参考”。
- 多实例部署建议尽快补齐 Redis 适配器，避免会话态只在单实例命中。
