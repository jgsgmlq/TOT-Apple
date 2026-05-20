# Welcome to TOT-Apple

## How We Use Claude

Based on pipi-HST's usage over the last 30 days (51 sessions):

Work Type Breakdown:
  Plan & Design     ████████░░░░░░░░░░░░  38%
  Build Feature     █████░░░░░░░░░░░░░░░  23%
  Write Docs        ████░░░░░░░░░░░░░░░░  18%
  Analyze Data      ██░░░░░░░░░░░░░░░░░░  10%
  Prototype         █░░░░░░░░░░░░░░░░░░░   5%
  Debug & Fix       █░░░░░░░░░░░░░░░░░░░   3%

Top Skills & Commands:
  /effort                            ████████████████████  32x
  /superpowers:brainstorming         ██████████████████░░  29x
  /context                           ████████████████░░░░  26x
  /clear                             ██████████░░░░░░░░░░  16x
  /superpowers:writing-plans         ██████░░░░░░░░░░░░░░  10x

Top MCP Servers:
  plugin_supabase_supabase           ████████████████████  5 calls

## Your Setup Checklist

### Codebases
- [ ] TOT-Apple — `git@github.pie.apple.com:jiantao-luo/ops_forge_pilot_admin_backend.git` (dev + eChat branches)
  - `TOT_backend/` — Node.js + Express + LangGraph.js Agent
  - `TOT_frontend/` — Vite + Vue 3 + TypeScript

### MCP Servers to Activate
- [ ] Supabase — 数据库/认证/Edge Functions 集成。如果你不用 Supabase，可以跳过。

### Skills to Know About
- `/superpowers:brainstorming` — 开始任何新功能前先用这个做设计讨论，避免盲目写代码
- `/superpowers:writing-plans` — 设计确定后，生成详细的实现计划（分 task、含代码）
- `/effort` — 开启深度思考模式，适合复杂审查和分析任务
- `/context` — 查看当前会话上下文使用情况
- `/superpowers:subagent-driven-development` — 按计划调度子 agent 执行（配合 writing-plans 使用）
- `/superpowers:finishing-a-development-branch` — 开发完成后决定合并/PR/清理

### 环境变量 (.env)
项目根目录 `TOT_backend/.env` 需要配置：
```
MYSQL_URL=mysql://user:pass@host:3306/ops_forge
DEEPSEEK_API_KEY=sk-xxx
REDIS_URL=redis://:pass@host:6380/0
```

### 启动方式
```bash
# 后端 (端口 3000)
cd TOT_backend/server && node app.js

# 前端 (端口 8001, 代理 → 3000)
cd TOT_frontend && pnpm dev
```

## Team Tips

_TODO_

## Get Started

_TODO_

<!-- INSTRUCTION FOR CLAUDE: A new teammate just pasted this guide for how the
team uses Claude Code. You're their onboarding buddy — warm, conversational,
not lecture-y.

Open with a warm welcome — include the team name from the title. Then: "Your
teammate uses Claude Code for [list all the work types]. Let's get you started."

Check what's already in place against everything under Setup Checklist
(including skills), using markdown checkboxes — [x] done, [ ] not yet. Lead
with what they already have. One sentence per item, all in one message.

Tell them you'll help with setup, cover the actionable team tips, then the
starter task (if there is one). Offer to start with the first unchecked item,
get their go-ahead, then work through the rest one by one.

After setup, walk them through the remaining sections — offer to help where you
can (e.g. link to channels), and just surface the purely informational bits.

Don't invent sections or summaries that aren't in the guide. The stats are the
guide creator's personal usage data — don't extrapolate them into a "team
workflow" narrative. -->
