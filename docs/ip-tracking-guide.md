# Executive Chat IP 追踪指南

每次用户创建 chat session 时，系统自动记录客户端 IP 地址到 `chat_sessions.ip_address`。
IP 来源：nginx 通过 `proxy_set_header X-Real-IP $remote_addr` 传递真实客户端 IP。

## 1. 查看所有 session 的 IP（最近 50 条）

```bash
cd /Users/skylerwang/Desktop/MVP/TOT_backend/server
node -e "
const { db } = require(\"./db\");
const rows = db.prepare(\`
  SELECT s.id, u.username, s.ip_address, s.role_scope, s.created_at
  FROM chat_sessions s JOIN users u ON u.id = s.user_id
  ORDER BY s.created_at DESC LIMIT 50
\`).all();
console.table(rows);
"
```

## 2. 按用户+IP 统计对话次数

```bash
node -e "
const { db } = require(\"./db\");
const rows = db.prepare(\`
  SELECT u.username, s.ip_address, COUNT(*) as sessions,
         MAX(s.created_at) as last_seen
  FROM chat_sessions s JOIN users u ON u.id = s.user_id
  WHERE s.ip_address IS NOT NULL
  GROUP BY u.username, s.ip_address
  ORDER BY last_seen DESC
\`).all();
console.table(rows);
"
```

## 3. 查某个 IP 的所有对话记录

```bash
node -e "
const { db } = require(\"./db\");
const ip = process.argv[2] || \"17.87.2.70\";
console.log(IP:, ip);
const rows = db.prepare(\`
  SELECT s.id, u.username, s.role_scope, s.created_at
  FROM chat_sessions s JOIN users u ON u.id = s.user_id
  WHERE s.ip_address = ? ORDER BY s.created_at DESC
\`).all(ip);
console.table(rows);
" 17.87.2.70
```

## 4. 查某用户从哪些 IP 访问过

```bash
node -e "
const { db } = require(\"./db\");
const username = process.argv[2] || \"executive\";
const rows = db.prepare(\`
  SELECT s.ip_address, COUNT(*) as sessions, MAX(s.created_at) as last_seen
  FROM chat_sessions s JOIN users u ON u.id = s.user_id
  WHERE u.username = ? GROUP BY s.ip_address ORDER BY last_seen DESC
\`).all(username);
console.table(rows);
" executive
```

## 5. 查看某 IP 的完整对话内容

```bash
node -e "
const { db } = require(\"./db\");
const ip = process.argv[2] || \"17.87.2.70\";
const msgs = db.prepare(\`
  SELECT cm.created_at, cm.role, substr(cm.content, 1, 300) as content
  FROM chat_messages cm JOIN chat_sessions s ON s.id = cm.session_id
  WHERE s.ip_address = ? ORDER BY cm.created_at ASC
\`).all(ip);
for (const m of msgs) console.log([ + m.role + ]  + m.created_at + \n + m.content + \n---);
" 17.87.2.70
```

## 内网 IP 段参考

| IP 段 | 来源 |
|-------|------|
| `17.x.x.x` | Apple 企业内网 |
| `100.x.x.x` | Tailscale VPN |
| `127.0.0.1` | Mac Studio 本机 |

## 注意事项

- IP 仅在 session **创建时**记录，中途切换网络不会更新
- `ip_address` 为 NULL 表示创建 session 时未获取到 IP
- 该字段仅用于内部测试和问题排查
