---
name: check-logs
description: 查看 TOT 前后端最新日志，快速诊断错误
---

# Check Logs

查看后端或前端最新日志，过滤掉 Redis/BullMQ 噪音。

## 后端日志

```bash
tail -60 /tmp/tot-server.log | grep -v "Redis version\|bullmq\|RedisConnection\|processTicks\|at Redis\|at process"
```

关注关键词：`error`、`Error`、`FAIL`、`crash`、`SYNTAX`

## 前端日志

```bash
tail -40 /tmp/tot-frontend.log
```

## 只看错误

```bash
# 后端
grep -i "error\|fail\|crash" /tmp/tot-server.log | grep -v "Redis" | tail -20

# 前端
grep -i "error\|fail\|crash" /tmp/tot-frontend.log | tail -10
```
