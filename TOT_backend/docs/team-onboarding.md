# TOT 团队接入指南

本文档帮助新成员从零开始接入共享开发服务器。  
完成后你可以：在家/公司/任何网络 → Cursor 打开远程目录 → 写代码直连后端。

---

## 前置信息

| 项目 | 值 |
|------|----|
| 共享服务器 | Mac Studio（始终开机） |
| macOS 用户名 | `skylerwang` |
| Mac Studio Tailscale IP | `100.65.95.128`（问管理员获取，执行 `tailscale ip -4`） |
| 后端端口 | `3000` |
| 前端开发端口 | `8001` |
| Git 仓库 | GitHub（问管理员要链接） |
| 稳定 / 集成分支 | `dev_joint`（Mac Studio PM2、日常 PR 目标） |
| Mac Studio 仓库根路径 `REPO_ROOT` | **（待管理员补充）** — 见下说明 |

**关于 `REPO_ROOT`：** 表示 Mac Studio 上本仓库克隆后的**根目录**（内含 `TOT_frontend/`、`TOT_backend/` 等）。下文命令里出现 `$REPO_ROOT` 时，请替换为管理员提供的真实绝对路径，或在终端先执行 `export REPO_ROOT='/实际路径'` 再复制命令。Cursor 里若已用「打开文件夹」选中该根目录，内置终端的当前目录即为 `REPO_ROOT`，此时可直接 `cd TOT_frontend` 等相对路径操作。

---

## Mac Studio 管理员基线检查

在 **Mac Studio** 上定期执行（重大演示前、或成员反馈「连不上」时），确认共享环境可用：

```bash
tailscale status          # 预期：已连接，无异常
tailscale ip -4           # 与上表「Tailscale IP」一致；若不一致，更新上表、根目录 README、本文中所有示例 IP
pm2 status tot-api        # 预期：online（共享后端）
```

可选：从管理员本机再执行 `ping <Tailscale IP>` 与 `curl` 登录测试（见 Step 1-B）。

---

## Step 1：Tailscale 配置

Tailscale 是一个 P2P VPN 工具，安装后无论你在哪个网络（家里、公司、移动数据），都能像在同一局域网里一样访问 Mac Studio。

---

### 1-A 管理员操作（仅管理员做一次）

> 管理员 = 持有 Mac Studio 的人（skylerwang）

**创建 Tailscale 账号并建立 Network：**

1. 访问 https://tailscale.com，点击右上角 **Get started**
2. 用 Google 或 GitHub 账号注册（推荐 Google）
3. 下载 Mac 客户端：https://tailscale.com/download/mac，安装后打开
4. 点击菜单栏 Tailscale 图标 → **Log in** → 用刚注册的账号登录
5. 登录成功后 Mac Studio 自动加入你的 Network，获得固定虚拟 IP `100.65.95.128`

**邀请团队成员加入 Network：**

1. 浏览器打开：https://login.tailscale.com/admin/invite
2. 点击 **Generate invite link**，生成邀请链接
3. 把链接通过微信/飞书发给每个团队成员（链接默认有效期 24 小时，过期可重新生成）
4. 成员接受后，在 https://login.tailscale.com/admin/machines 能看到他们的设备上线

---

### 1-B 成员操作（每个成员在自己设备上做）

**第一步：接受邀请**

1. 打开管理员发来的邀请链接（用浏览器打开）
2. 注册或登录 Tailscale 账号（建议用 Google 登录）
3. 点击 **Accept invite** 接受邀请，加入管理员的 Network

**第二步：下载并安装 Tailscale**

| 设备 | 下载地址 |
|------|---------|
| Mac | https://tailscale.com/download/mac |
| Windows | https://tailscale.com/download/windows |
| iPhone | App Store 搜索 Tailscale |
| Android | Google Play 搜索 Tailscale |

**第三步：登录 Tailscale**

打开 Tailscale App → **Log in** → 用接受邀请时的账号登录。  
登录成功后菜单栏（Mac）或系统托盘（Windows）会出现绿色图标。

**第四步：验证连通性**

打开终端（Mac/Windows 均可），执行：

```bash
ping 100.65.95.128
# 预期：收到回包，如 64 bytes from 100.65.95.128: icmp_seq=0 ...
# 按 Ctrl+C 停止
```

再验证后端 API 可访问：

```bash
curl -s --data '{"username":"central","password":"Train2026!"}' \
  -H "Content-Type: application/json" \
  -X POST http://100.65.95.128:3000/api/v1/auth/login
# 预期：返回含 token 的 JSON，说明 Tailscale 配置完全成功
```

**常见问题：**

| 现象 | 原因 | 解决 |
|------|------|------|
| ping 不通 | Tailscale 未启动 | 点开 App，确认图标是绿色 |
| ping 不通 | 未加入同一 Network | 确认用接受邀请时的账号登录，不是新注册账号 |
| API 返回 `Connection refused` | Mac Studio 后端未运行 | 通知管理员执行 `pm2 status` 检查 |

---

### 路径 A：Tailscale 内网 (100.x) 验证清单

成员完成 Step 1-B 后，建议按下面确认 **路径 A**（不经过公网 Funnel）可用：

| 检查项 | 操作 | 预期 |
|--------|------|------|
| API | `curl` 见上文「第四步」登录接口 | 返回含 `token` 的 JSON |
| 仅 API 浏览器/客户端 | 配置请求基址为 `http://<Tailscale IP>:3000` | 与后端联调正常 |
| 完整前端（可选） | 在 `REPO_ROOT` 下执行 `cd TOT_frontend && pnpm run dev`，浏览器打开 `http://<Tailscale IP>:8001` | 页面可打开；`TOT_frontend/.env.development` 中 `VITE_GLOB_API_URL` **留空** 时走 Vite 代理到本机 `:3000` |

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
  HostName 100.65.95.128          # 换成 Mac Studio 的 Tailscale IP
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
4. 连接成功后：`File → Open Folder` → 选择 **`REPO_ROOT`**（仓库根目录，路径由管理员提供；须包含 `TOT_frontend`、`TOT_backend`）

现在你在 Mac Studio 上写代码，本地 Cursor 只是显示界面。

---

## Step 5：前端开发者工作方式

### 选项 A：Cursor Remote SSH（推荐）

- 按 Step 4 连接 Mac Studio，打开 **`REPO_ROOT`**（仓库根目录）
- 在 Mac Studio 的 `TOT_frontend/` 目录工作（终端已在 `REPO_ROOT` 时可直接 `cd TOT_frontend`）
- 在 Cursor 内置终端启动前端：
  ```bash
  cd TOT_frontend
  pnpm run dev
  # 前端跑在 Mac Studio 的 8001 端口
  ```
- 浏览器访问：`http://100.65.95.128:8001`（用 Tailscale IP）
- 无需在本机安装任何 Node.js 环境

### 选项 B：本地开发（适合只改 UI、不依赖后端实时数据时）

- 本机 `pnpm run dev`
- 在 `TOT_frontend` 下新建（或修改）`.env.development.local`，覆盖 API 地址（该文件已被忽略，不会提交）：
  ```
  VITE_GLOB_API_URL = http://100.65.95.128:3000
  ```
  > ⚠️ 不要改动已跟踪的 `.env.development`，每人仅维护本地 `.env.development.local`

---

## Step 6：后端开发者工作方式

后端开发者**必须在 Mac Studio 上工作**（SQLite 数据库文件在那里，不能分布）。

1. Cursor Remote SSH 连接 Mac Studio
2. 切到自己的功能分支：
   ```bash
   git checkout dev_joint
   git pull origin dev_joint
   git checkout -b feature/be-你的功能名
   ```
3. 开发时单独启动 dev 服务（与 PM2 守护的服务区分）：
   ```bash
   cd "$REPO_ROOT/TOT_backend/server"
   npm run dev   # node --watch，改代码自动重启，跑在 3000 端口
   ```
   > ⚠️ 注意：开发时如果 PM2 的 `tot-api` 已在占用 3000 端口，先停掉：`pm2 stop tot-api`
4. 功能完成，PR 到 `dev_joint`，merge 后通知管理员执行部署：
   ```bash
   bash "$REPO_ROOT/scripts/deploy.sh"
   ```

---

## 路径 B：Tailscale Funnel 公网 HTTPS

用于 **未安装 Tailscale** 的设备（例如手机蜂窝网）通过 **HTTPS 公网 URL** 访问本机上的开发前端与 API。流量经 Tailscale Funnel 中继到 Mac Studio；与 **路径 A（100.x）** 可同时存在，按需开关 Funnel。

**前置条件（tailnet 侧）**：

- Tailscale 客户端版本满足 [官方要求](https://tailscale.com/kb/1223/funnel)（如 v1.38.3+）。
- Admin Console 中启用 [MagicDNS](https://tailscale.com/docs/features/magicdns)、HTTPS 证书；在 [Access controls](https://login.tailscale.com/admin/acls) 中为 tailnet 配置 **Funnel**（`nodeAttrs` /「Add Funnel to policy」），且仅允许需要发布服务的机器（如 Mac Studio）具备 `funnel` 能力（最小权限）。
- Funnel 为 beta 功能，且对套餐有要求，见 [定价与说明](https://tailscale.com/pricing)。

**在 Mac Studio 上操作（管理员）**：

1. 完成上文「管理员基线检查」，确认 `tot-api` 在 `3000` 正常。
2. 进入前端目录并启动 Vite（需与 Funnel 指向的端口一致，默认 **8001**）：
   ```bash
   cd "$REPO_ROOT/TOT_frontend"
   # 若首屏长时间卡在 loading，使用本地覆盖配置（勿提交）：
   cp .env.development.local.example .env.development.local   # 已存在则可跳过；确保含 VITE_FUNNEL_MODE=1
   pnpm run dev
   ```
3. **另开终端**，在同一台 Mac Studio 上开启 Funnel，将公网 HTTPS 转发到本机 Vite（示例为官方用法，等价于代理到 `http://127.0.0.1:8001`）：
   ```bash
   tailscale funnel 8001
   ```
   终端会打印 **Available on the internet:** 下的 `https://<机器名>.<tailnet>.ts.net` —— 将该 URL 发给测试设备。更多参数与排错见 [tailscale funnel CLI](https://tailscale.com/docs/reference/tailscale-cli/funnel) 与 [Funnel 文档](https://tailscale.com/kb/1223/funnel)。
4. **环境变量**：路径 B 下请保持 `VITE_GLOB_API_URL` **为空**（与 `.env.development` 默认一致），使 API 经 **当前页面同源** 走 Vite 的 `/api/v1` 代理到 `127.0.0.1:3000`；不要写死 `http://100.x.x.x:3000`，否则蜂窝网设备无法访问 100 段地址。
5. **验证**：用 **未连接 Tailscale** 的网络（如手机关闭 VPN、仅用蜂窝数据）在浏览器打开 Funnel URL，登录并走通主流程。公网 DNS 生效可能需要数分钟（见官方文档 Troubleshooting）。

### 演示稳定模式（MVP 推荐）：build + preview + Funnel

如果目标是「演示期间手机端和电脑端都尽量稳定访问」，建议使用下列流程替代 `pnpm run dev + funnel 8001`：

```bash
# Terminal A（Mac Studio）- 运行前端演示服务
pm2 status tot-api
cd "$REPO_ROOT/TOT_frontend"
pnpm install
pnpm run build
pnpm run preview:dist --host 0.0.0.0 --port 4173

# Terminal B（Mac Studio）- 开启 Funnel 到演示端口
tailscale funnel reset
tailscale funnel 4173
tailscale funnel status
```

说明：

- 该模式使用构建后的静态产物，减少开发模式下 HMR/开发客户端带来的移动端不稳定因素。
- 将 `tailscale funnel status` 输出的公网地址发给演示设备，建议直接访问：
  - `https://<...>/hq`
  - `https://<...>/employee/login`
- 演示结束执行 `tailscale funnel reset` 关闭公网入口。

**关闭 Funnel**（演示结束后建议执行，减少暴露面）：

- 在运行 `tailscale funnel` 的终端按 `Ctrl+C`，或按官方文档使用 `tailscale funnel reset` / 对应 `off` 子命令（以本机 `tailscale funnel --help` 为准）。

---

## 安全与运维（双路径）

| 主题 | 建议 |
|------|------|
| **路径 A** | 仅 tailnet 内成员可达；仍应保护好 SSH 密钥与测试账号，勿在公开场合张贴 `100.x` 与密码。 |
| **路径 B（Funnel）** | 任意知道 URL 的人可尝试访问；**仅用于联调/短时演示**，不要长期对公网暴露含真实业务数据的 SQLite；演示结束关闭 Funnel。 |
| **ACL** | 在 [Access controls](https://login.tailscale.com/admin/acls) 中收紧 `funnel` 的 `nodeAttrs`，仅允许 Mac Studio 等指定节点；按需限制可使用 Funnel 的 tailnet 成员。 |
| **文档同步** | `tailscale ip -4` 变化时，同步更新 README 与本文「前置信息」表。 |

---

## Git 分支规范

**稳定与集成以 `dev_joint` 为准：** 日常开发、联调、Mac Studio 上 PM2 运行的代码均以此分支为基准。仓库若仍存在 `main` / `master` 等分支，可能用于历史或后续发布流程，**团队默认仍以 `dev_joint` 为 PR 目标与部署源**。

```
dev_joint         ← 稳定集成分支；Mac Studio 始终运行此分支（PM2 守护）
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

# 5. PR 合并后，管理员在 Mac Studio 于 REPO_ROOT 下执行部署
bash scripts/deploy.sh
# （若当前不在仓库根目录，使用 bash "$REPO_ROOT/scripts/deploy.sh"）
```

**命名规范：**

| 类型 | 格式 | 示例 |
|------|------|------|
| 后端功能 | `feature/be-<描述>` | `feature/be-ws-nudge` |
| 前端功能 | `feature/fe-<描述>` | `feature/fe-employee-ws` |
| Bug 修复 | `fix/<描述>` | `fix/ws-reconnect` |

也可使用 `feature/<主题>`（如 `feature/Echat`），仍建议 **PR 目标分支选 `dev_joint`**。

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

# 部署最新代码（在 REPO_ROOT 下或替换路径）
bash "$REPO_ROOT/scripts/deploy.sh"

# 获取 Mac Studio 的 Tailscale IP
tailscale ip -4

# 查看 SSH 已授权的公钥
cat ~/.ssh/authorized_keys


# === 在自己电脑上执行 ===

# SSH 连接
ssh mac-studio

# 测试后端是否可访问
curl http://100.65.95.128:3000/api/v1/auth/login \
  -X POST -H "Content-Type: application/json" \
  -d '{"username":"central","password":"Train2026!"}'
```
