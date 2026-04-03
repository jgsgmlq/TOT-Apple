# TOT 团队接入指南

本文档帮助新成员从零开始接入共享开发服务器。  
完成后你可以：在家/公司/任何网络 → Cursor 打开远程目录 → 写代码直连后端。

---

## 前置信息

| 项目 | 值 |
|------|----|
| 共享服务器 | Mac Studio（始终开机） |
| macOS 用户名 | `skylerwang` |
| Mac Studio Tailscale IP | `100.x.x.x`（问管理员获取，执行 `tailscale ip -4`） |
| 后端端口 | `3000` |
| 前端开发端口 | `8001` |
| Git 仓库 | GitHub（问管理员要链接） |
| 主开发分支 | `dev_joint` |

---

## Step 1：安装 Tailscale（每台设备都需要）

1. 下载：https://tailscale.com/download
2. 登录同一个 Tailscale 账号（问管理员发邀请链接加入 Network）
3. 完成后你的设备会获得一个 `100.x.x.x` 虚拟 IP
4. 验证连通性：

```bash
ping 100.x.x.x   # 换成 Mac Studio 的 Tailscale IP，能 ping 通即成功
```

---

## Step 2：生成并注册 SSH Key

**在你自己的电脑上生成密钥（已有 `~/.ssh/id_ed25519` 可跳过）：**

```bash
ssh-keygen -t ed25519 -C "你的名字或邮箱"
# 连续按回车使用默认路径
```

**复制公钥：**

```bash
cat ~/.ssh/id_ed25519.pub
# 输出类似：ssh-ed25519 AAAAC3Nza... 你的名字
```

把这行输出**发给管理员**，管理员在 Mac Studio 上执行：

```bash
# 管理员在 Mac Studio 上执行
echo "ssh-ed25519 AAAAC3Nza... 成员名字" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

---

## Step 3：配置本机 SSH

编辑 `~/.ssh/config`（没有就新建）：

```
Host mac-studio
  HostName 100.x.x.x          # 换成 Mac Studio 的 Tailscale IP
  User skylerwang
  IdentityFile ~/.ssh/id_ed25519
  ServerAliveInterval 60
  ServerAliveCountMax 3
```

测试连接：

```bash
ssh mac-studio
# 看到 Mac Studio 的终端提示符说明成功
# 退出：exit
```

---

## Step 4：Cursor Remote SSH 配置

1. 打开 Cursor → 左侧 Extensions 图标 → 搜索 `Remote - SSH` → Install
2. 按 `Cmd+Shift+P` → 输入 `Remote-SSH: Connect to Host` → 选 `mac-studio`
3. 第一次连接会在 Mac Studio 安装 VS Code Server，等待约 1 分钟
4. 连接成功后：`File → Open Folder → /Users/skylerwang/Desktop/MVP`

现在你在 Mac Studio 上写代码，本地 Cursor 只是显示界面。

---

## Step 5：前端开发者工作方式

### 选项 A：Cursor Remote SSH（推荐）

- 按 Step 4 连接 Mac Studio，打开 `/Users/skylerwang/Desktop/MVP`
- 在 Mac Studio 的 `TOT_frontend/` 目录工作
- 在 Cursor 内置终端启动前端：
  ```bash
  cd TOT_frontend
  pnpm run dev
  # 前端跑在 Mac Studio 的 8001 端口
  ```
- 浏览器访问：`http://100.x.x.x:8001`（用 Tailscale IP）
- 无需在本机安装任何 Node.js 环境

### 选项 B：本地开发（适合只改 UI、不依赖后端实时数据时）

- 本机 `pnpm run dev`
- 修改 `TOT_frontend/.env.development` 的 API 地址：
  ```
  VITE_GLOB_API_URL = http://100.x.x.x:3000
  ```
  > ⚠️ 这个文件不要 commit，每人本地维护自己的 IP

---

## Step 6：后端开发者工作方式

后端开发者**必须在 Mac Studio 上工作**（SQLite 数据库文件在那里，不能分布）。

1. Cursor Remote SSH 连接 Mac Studio
2. 切到自己的功能分支：
   ```bash
   git checkout dev_joint && git pull
   git checkout -b feature/be-你的功能名
   ```
3. 开发时单独启动 dev 服务（与 PM2 守护的服务区分）：
   ```bash
   cd /Users/skylerwang/Desktop/MVP/TOT_backend/server
   npm run dev   # node --watch，改代码自动重启，跑在 3000 端口
   ```
   > ⚠️ 注意：开发时如果 PM2 的 `tot-api` 已在占用 3000 端口，先停掉：`pm2 stop tot-api`
4. 功能完成，PR 到 `dev_joint`，merge 后通知管理员执行部署：
   ```bash
   bash /Users/skylerwang/Desktop/MVP/scripts/deploy.sh
   ```

---

## Git 分支规范

```
main              ← 稳定版，只接受来自 dev_joint 的 PR（需 review）
  └── dev_joint   ← Mac Studio 始终运行此分支（PM2 守护）
        ├── feature/be-<简短描述>   ← 后端功能分支
        └── feature/fe-<简短描述>   ← 前端功能分支
```

**完整日常流程：**

```bash
# 1. 从 dev_joint 拉新分支开始工作
git checkout dev_joint
git pull origin dev_joint
git checkout -b feature/fe-ws-notification

# 2. 开发并提交（小步提交，频繁 commit）
git add src/hooks/useWebSocket.ts
git commit -m "feat: add ws composable"

# 3. Push 到 GitHub
git push -u origin feature/fe-ws-notification

# 4. 在 GitHub 上创建 PR，target branch 选 dev_joint

# 5. PR 合并后，管理员在 Mac Studio 执行部署
bash scripts/deploy.sh
```

**命名规范：**

| 类型 | 格式 | 示例 |
|------|------|------|
| 后端功能 | `feature/be-<描述>` | `feature/be-ws-nudge` |
| 前端功能 | `feature/fe-<描述>` | `feature/fe-employee-ws` |
| Bug 修复 | `fix/<描述>` | `fix/ws-reconnect` |

---

## 常用命令速查

```bash
# === 在 Mac Studio 上执行 ===

# 查看后端运行状态
pm2 status

# 查看实时日志
pm2 logs tot-api

# 重启后端（不停机）
pm2 reload tot-api

# 部署最新代码
bash /Users/skylerwang/Desktop/MVP/scripts/deploy.sh

# 获取 Mac Studio 的 Tailscale IP
tailscale ip -4

# 查看 SSH 已授权的公钥
cat ~/.ssh/authorized_keys


# === 在自己电脑上执行 ===

# SSH 连接
ssh mac-studio

# 测试后端是否可访问
curl http://100.x.x.x:3000/api/v1/auth/login \
  -X POST -H "Content-Type: application/json" \
  -d '{"email":"test1@tot.com","password":"test123"}'
```
