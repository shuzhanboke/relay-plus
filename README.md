# 中转站 Plus

一套开源的**自建 AI API 中转站**：把多个上游 AI 能力（OpenAI / Anthropic / 自定义上游）统一接入一个网关，再向终端用户分发 **API Key**，平台完成**鉴权、配额计费、限流、负载均衡和请求转发**，并提供完整管理后台与用户自助能力。管理接口兼容 [Sub2API](https://github.com/Wei-Shaw/sub2api) / [FlowPilot](https://github.com/QLHazyCoder/FlowPilot) 的核心对接契约，可与 FlowPilot 批量注册工具联动。

> 完整的生产部署手册见 **[DEPLOY.md](./DEPLOY.md)**（环境准备、域名 HTTPS、安全加固、备份、上线检查清单）。对接契约与联调说明见 **[INTEGRATION.md](./INTEGRATION.md)**，产品定位见 **[PRODUCT.md](./PRODUCT.md)**。

---

## 功能特性

- **AI 网关**
  - OpenAI `/v1/chat/completions`、`/v1/responses`、`/v1/embeddings`、`/v1/models`
  - Anthropic `/v1/messages`
  - 流式（SSE）透传、非流式 JSON
  - 模型白名单鉴权、负载均衡（优先级 + 轮转）
  - 多上游支持：API Key 型 / OAuth 型（含 OpenAI OAuth 授权码回写）/ Codex PAT 型
- **配额计费**
  - 可按模型配置价格（美元 / 1M tokens，支持 `*` 通配）
  - 真实 usage 计费（含 cache tokens），余额实时扣费，不足自动拒绝
  - **下游售价倍率** `billing_rate_multiplier`（管理端可调，计费 × 倍率）
  - 用户侧实价查询 `/billing/me/pricing`
- **限流**：RPM / TPS / TPM / 并发上限
- **多租户用户系统**：注册/登录、JWT、admin/user 角色、余额
- **API Key 管理**：生成 `sk-` Key（仅明文展示一次）、前缀/尾号识别、启停、过期、限流参数
- **上游账号池**：可分组成员、绑定代理、设并发与优先级；分组把上游归类（如 `codex`、`claude`）
- **代理管理**：HTTP/HTTPS/SOCKS5 出站代理
- **用户自助计费（SaaS）**
  - 套餐选购 `/billing/plans`、订阅、下单与模拟支付
  - **卡密兑换**：管理员生成卡密（`credit` 面额），用户在充值页兑换自动上分（幂等，兑换过即拒绝）
  - 支付渠道（`card` / 测试渠道）与收款码上传展示
  - 充值/用量/余额展示，充值页浅橙配色
- **管理功能**
  - 用量统计 `/admin/usage?days=N`：总量 / 按用户 / 按模型 / 时间序列；用户侧用量页 `/app/usage`
  - 套餐管理（管理端 `/app/manage-plans`）与用户侧套餐实价页 `/pricing`（`/billing/plans` + `/billing/me/pricing`）
  - 管理后台 Web：仪表盘 / 用户 / 分组 / 上游账号 / API Key / 请求日志 / 卡密 / 系统设置
- **FlowPilot / Sub2API 兼容接口**
  - `POST /api/v1/admin/openai/generate-auth-url`
  - `POST /api/v1/admin/openai/exchange-code`
  - `POST /api/v1/admin/openai/refresh-token`
  - `POST /api/v1/admin/openai/create-from-oauth`
  - `GET /api/v1/admin/groups/all`、`GET /api/v1/admin/proxies/all`、`POST /api/v1/admin/accounts`
  - 登录接口返回格式与 FlowPilot 一致（顶层 `access_token`）

---

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Node.js 22 + TypeScript + Express + `pg` |
| 数据库 | PostgreSQL 16 |
| 前端 | React 18 + Vite 5 + React Router |
| 网关 | 原生 `fetch`（undici）流式透传 |
| 部署 | Docker Compose + Nginx |

---

## 运行环境要求

### 统一前提（所有下载/运行方式都必须满足）

中转站以 **Docker 容器**运行（托管 PostgreSQL + 后端 Node + 前端 Nginx）。无论用「方式①~⑤」哪种方式部署，**目标机器都必须已安装 Docker**：

- **Docker Engine 20.10+**（含 `docker compose` v2 命令，或旧版 `docker-compose`）。安装：[Docker 官方](https://docs.docker.com/get-docker/) / [Windows](https://www.docker.com/products/docker-desktop/) / [Linux](https://docs.docker.com/engine/install/) / [macOS](https://www.docker.com/products/docker-desktop/)
- 校验：`docker --version` 与 `docker compose version` 都能正常输出版本号

> 部署器是**静态编译的单一可执行文件**：除了 Docker，**不要求**目标机安装 Node.js / Go / Rust / Python 等任何运行环境。

### 平台与架构

| 系统 | 架构 | 说明 |
|---|---|---|
| Windows | x86_64 / arm64 | Windows 10/11；双击 exe 或 cmd 运行 |
| Linux | x86_64 / arm64 | 主流发行版（Ubuntu/Debian/CentOS 等） |
| macOS | arm64(Apple Silicon)、x86_64 | macOS 12+ |

> 选择**与你的 CPU 架构匹配**的 Release 产物（x86_64=Intel/AMD，arm64=Apple Silicon/ARM 服务器）。

### 如何安装 Docker（分平台教程）

**Windows 10/11 —— Docker Desktop**

1. 下载安装包：官网 <https://www.docker.com/products/docker-desktop/>（选你的架构 x86_64/arm64）。
2. 双击安装包，一路「Next」→ 完成后**重启电脑**并启动 Docker Desktop。
3. 右下角任务栏出现 Docker 图标，变绿即引擎就绪。
4. 建议：设置里勾选 **WSL 2** 后端（默认）；若用 WSL 需提前 `wsl --install`。

**macOS —— Docker Desktop**

1. 下载 <https://www.docker.com/products/docker-desktop/>（Apple Silicon 或 Intel 对应版本）。
2. 打开 `.dmg`，把 Docker 拖入 Applications，首次打开按提示允许。
3. 启动 Docker Desktop，右上角菜单栏鲸鱼图标稳定即就绪。

**Linux（Ubuntu / Debian，推荐）**

```bash
# 卸载旧版
sudo apt-get remove docker docker-engine docker.io containerd runc 2>/dev/null || true

# 设置官方仓库 + 安装
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# 当前用户免 sudo（重新登录生效）
sudo usermod -aG docker $USER
```

> CentOS/RHEL：用 `sudo yum install -y yum-utils && sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo && sudo yum install -y docker-ce docker-compose-plugin docker-ce-cli containerd.io && sudo systemctl enable --now docker`。

**验证是否安装成功（所有平台通用）**

```bash
docker --version          # 例如: Docker version 26.1.0
docker compose version    # 例如: Docker Compose version v2.27.0
sudo docker run hello-world   # 能打印 Hello from Docker! 即成功（Linux 先用 sudo 试）
```

> 容器以 Docker 用户运行：Linux 可用 `sudo usermod -aG docker $USER` 后重登；Windows 用 Docker Desktop 会处理好权限。

### 国内镜像加速（可选，国内拉镜像慢时配置）

国内直连 Docker Hub 经常慢/超时。到 2025 年后多数大厂的公共加速源已停用，但以下**社区源仍可用**（使用时若失效可换列表里其他源）：

```json
{ "registry-mirrors": [
  "https://docker.1ms.run",
  "https://docker.1panel.live",
  "https://hub.rat.dev",
  "https://docker.xuanyuan.me",
  "https://docker.m.daocloud.io"
] }
```

配置位置（二选一）：

- **Linux**：编辑 `/etc/docker/daemon.json`（没有就新建）写入上面的 JSON，然后
  ```bash
  sudo systemctl daemon-reload && sudo systemctl restart docker
  docker info | grep -A5 "Registry Mirrors"   # 出现上面地址即生效
  ```
- **Windows/macOS（Docker Desktop）**：右键/点击 Docker 图标 → **Settings → Docker Engine** → 在 JSON 里加 `"registry-mirrors"` 数组 → **Apply & Restart**。

> 若镜像源全部不可用或不想配，就直接用**「方式① 自包含 / 方式② 离线包」**部署——它们镜像已内嵌，部署时**不需要从 Docker Hub 拉镜像**（但仍需先装好 Docker）。

### 硬件 / 资源建议


| 项目 | 建议 |
|---|---|
| 内存 | ≥ 2 GB（容器：PostgreSQL + Node + Nginx） |
| 磁盘 | 预留 ≥ 3 GB（镜像 ~2GB + 数据库数据卷） |
| 网络 | 在线方式(③④⑤)需要能拉取/构建镜像；离线方式(①②)需提前准备好镜像，运行时可不联网 |
| 端口 | 对外默认 `8082`（`WEB_PORT`，可改）；容器内部固定 5432/8080/80 |

### 前端访问

- 部署完成后用**任意现代浏览器**（Chrome/Edge/Firefox/Safari）访问 `http://服务器IP:端口/login`。

---

## 快速开始

生产与本地开发都使用**项目根目录 `.env`** 作为唯一配置源（集中存放全部密钥 / 账户 / 数据库凭据）。模板与字段说明见 `server/.env.example`。

### 0. 方式速览（选一种）

本节为你列出**所有下载和运行中转站的方式**，按「越简单越靠前」排序，任选其一即可。所有方式都满足上述「运行环境要求」；首次运行会自动建表并创建管理员账号。


| 方式 | 下载内容 | 运行命令 | 是否要网络构建 | 适用 |
|---|---|---|---|---|
| ① 自包含单文件 | 1 个文件（~200MB） | 双击 / `./xxx` | 否 | 最省事，任何用户 |
| ② 离线安装包 | 1 个 zip（解压后 3 文件） | 解压后 `... --offline` | 否 | 内网/离线 |
| ③ 在线一键脚本 | 源码套件（git 仓库） | `./deploy.sh` | 是（build 镜像） | 有源码、可联网的服务器 |
| ④ 部署器二进制 | 1 个轻量二进制（几百 KB） | `./relay-plus-deployer` | 是（build 镜像） | 有源码、要轻量 |
| ⑤ 手动 Compose | 源码套件 | `docker compose up` | 是（build 镜像） | 高级用户 / 调试 |

> 默认对外端口 `8082`，可在生成后的根 `.env` 里改 `WEB_PORT`。

---

### 方式 ①：自包含单文件（最简单，推荐下载用户）

从 Release 下载**一个自包含部署器**（已内嵌全部服务镜像），**放到任意文件夹，一键运行**，不依赖源码、配置或网络：

- Windows：双击 `relay-plus-selfcontained-win-x86_64.exe`（或 cmd 中 `relay-plus-selfcontained.exe --yes`）
- Linux：`./relay-plus-selfcontained-linux-x86_64`、`./relay-plus-selfcontained-linux-aarch64`
- macOS：`./relay-plus-selfcontained-macos-aarch64`

自动完成：检测 Docker → 引导输入站点/管理员/端口（回车用默认）→ 从自身解包镜像 → `docker load` → 启动全套 → 健康检查 → 打印访问地址。

### 方式 ②：离线安装包（内网 / 无外网）

从 Release 下载 `relay-plus-offline-<平台>.zip`（内含 `relay-plus-deployer` + `docker-compose.yml` + `images.tar`），**解压到独立文件夹**，在该文件夹运行：

```bash
unzip relay-plus-offline-win-x86_64.zip
cd relay-plus-offline-win-x86_64
relay-plus-deployer --offline     # Linux/macOS: ./relay-plus-deployer --offline
```

部署器会自动 `docker load -i images.tar` 后 `docker compose up -d --no-build`，全程不联网。（免交互加 `--yes`，重新配置加 `--reset`。）

### 方式 ③：在线一键脚本 deploy.sh（有源码、可联网）

克隆源码后在项目根运行：

```bash
git clone <仓库地址> relay-plus && cd relay-plus

./deploy.sh          # 交互式引导（站点/管理员/端口，回车用默认）
# 或 ./deploy.sh --yes      免交互 + 自动随机密钥
#    ./deploy.sh --no-build 已有镜像跳过构建
#    ./deploy.sh --reset    重建配置（旧配置备份 .env.bak）
#    ./deploy.sh --help     帮助
```

自动完成：环境检查 → 引导生成 `.env` → `docker compose up -d --build` → 健康检查 → 打印访问地址。

**Windows**：装好 [Docker Desktop](https://docs.docker.com/get-docker/) 与 [Git for Windows](https://git-scm.com/download/win) 后，**双击 `deploy.bat`**（或 cmd 中 `deploy.bat`）。

### 方式 ④：部署器二进制 + 源码（在线，轻量）

下载 Release 里的轻量部署器二进制（仅几百 KB，不含镜像），放入**源码项目根**运行；它会用旁边的源码 `docker compose up --build`：

```bash
./relay-plus-deployer                 # 在线构建启动
./relay-plus-deployer --yes           # 免交互
```

### 方式 ⑤：手动 Docker Compose（备选 / 开发）

> 需要源码与网络；日常部署优先用部署器。

```bash
cp server/.env.example .env        # 手动创建配置（务必改 JWT_SECRET / ADMIN_PASSWORD / POSTGRES_PASSWORD）
docker compose up -d --build
docker compose ps                  # 等待 db 变 healthy、server 为 up
docker compose logs -f server
```

> 生产必须配合 HTTPS：前置 Caddy / Nginx / 云负载均衡 反代到 `${WEB_PORT}`。详见 [DEPLOY.md](./DEPLOY.md)。

---

### 运行后访问

按照以上任意一种方式完成部署后：

- 登录页：`http://服务器IP:端口/login`（默认端口 `8082`）
- 管理后台：`http://服务器IP:端口/app`
- 管理员账号：引导时设置的邮箱（默认 `admin@relay.local`）与密码

> 端口可在根 `.env` 的 `WEB_PORT` 修改；自包含/离线包首次运行会生成 `.env` 到你的运行目录。

### 本地开发

```bash
# 1) 启动数据库（仅 db 容器）
docker compose -f compose.db.yml up -d

# 2) 安装后端依赖、迁移 + 种子（创建默认管理员）
cd server
npm install
cp ../server/.env.example ../.env   # 不存在的根 .env 时先用模板，按需改 PORT=18080
npm run migrate && npm run seed

# 3) 启动后端（dev 默认 18080，见根 .env 的 PORT；vite 代理指向它）
npm run dev

# 4) 启动前端（默认 5173，已配置 /api/v1、/v1、/healthz、/uploads 代理到 18080）
cd ../web
npm install
npm run dev
```

> 根 `.env` 的 `PORT=18080` 供本地开发；`docker-compose.yml` 中 server 内部用 `PORT=8080`（容器内），二者互不影响。

---

## 配置说明（唯一根 `.env`）

后端通过 `server/src/env.ts` 显式加载**项目根** `.env`（`dotenv` 指向 `${projectRoot}/../..`），四个入口（`index` / `migrate` / `seed` / `pool`）统一经 `./env.js` 引入，数据库连接池不再内置任何默认凭据。

| 关键变量 | 说明 |
|---|---|
| `PORT` / `HOST` | 后端监听（dev 用 `18080`；容器内 `8080`） |
| `DATABASE_URL` | PostgreSQL 连接串 |
| `JWT_SECRET` | **必填**，生产用随机长串（≥24 位） |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | **必填**，seed 创建的管理员 |
| `POSTGRES_PASSWORD` | **必填**，`docker-compose.yml` 中 db 的密码（`${POSTGRES_PASSWORD:?...}` 必填注入） |
| `RUN_MODE` | `full`（完整 SaaS）/ `simple`（隐藏计费界面） |
| `ALLOW_REGISTER` | 是否开放注册 |
| `DEFAULT_BALANCE` / `FREE_GRANT_AMOUNT` | 新用户默认余额 / 可领免费额度 |
| `ALLOW_LOOPBACK_UPSTREAM` | 允许上游指向本机/内网（仅本地开发，生产必须 `false`） |
| `ALLOW_GLOBAL_ROUTING` | 允许未绑分组账号被全局路由 |
| `TURNSTILE_SECRET` | Cloudflare Turnstile 人机验证（留空不启用） |
| `USD_TO_CNY` | 充值展示汇率 |

完整字段（JWT 过期、登录/注册限制、OAuth、SMTP、CORS 等）见 `server/.env.example`。

> compose 已把 `POSTGRES_PASSWORD` / `ADMIN_PASSWORD` / `JWT_SECRET` / `DATABASE_URL` 等设为 `${VAR:?...}` 必填——缺项时 `docker compose` / `deploy.sh` 会直接报错，防止带默认弱密码上线。

---

## 使用流程

1. **配置上游账号**（后台 → 上游账号）：添加上游（OpenAI 官方 API Key，或你的中转上游 Base URL + Key）。
2. **创建分组**（后台 → 分组管理）：把上游账号绑定到分组；新建 API Key 时绑定分组。
3. **创建用户并生成 API Key**（后台 → 用户管理 / API Key 管理）：给用户充值余额、绑定分组与限流。
4. **用户自助**：用户在充值页下单/兑换卡密上分；用量页查看消耗；套餐页选购套餐。
5. **客户端接入**：
   - **Claude Code**：`ANTHROPIC_BASE_URL=http://你的域名`，`ANTHROPIC_AUTH_TOKEN=sk-面板Key`
   - **OpenAI SDK / Codex**：`base_url=http://你的域名/v1`，`api_key=sk-面板Key`
6. **查看日志与统计**：在后台「请求日志」「仪表盘」「用量管理」核对计费是否准确。

---

## 对接 FlowPilot（批量注册 OpenAI/ChatGPT 账号）

本系统的管理接口兼容 FlowPilot 的 `SUB2API` 来源。

1. 在后台「分组管理」创建分组（例如 `codex`），并在「上游账号」配置默认代理（可选）。
2. 在 FlowPilot 侧边栏设置：
   - 来源 = `SUB2API`
   - SUB2API = `http://你的域名/admin/accounts`
   - 账号 / 密码 = 本面板管理员登录信息
   - 分组 = 上面创建的分组名
   - 邮箱生成 / 邮箱服务 = Cloudflare Temp Email
   - 短信 = HeroSMS（OpenAI 建议巴西号码）
3. 单步跑通 Step 1 → Step 4 → Step 10 后开 Auto 批量；OAuth 授权码会通过 `exchange-code` + `create-from-oauth` 自动回写为「上游账号」。

> 合规提示：批量注册、共享上游账号可能违反上游平台服务条款，请自行评估风险并控制用量。

---

## Nginx 反代注意事项

- `web/nginx.conf` 已开启 SSE 流式透传（`proxy_buffering off`）与粘性头透传。
- 若手动配置 Nginx 反代后端，Codex 粘性会话需要保留下划线请求头：
  ```nginx
  underscores_in_headers on;
  ```

---

## 安全建议

- 生产环境务必修改 `JWT_SECRET`（随机长字符串）与默认管理员密码。
- 前置 HTTPS（Caddy / Nginx / 云负载均衡），不要在公网裸跑 HTTP。
- 按需关闭开放注册（`ALLOW_REGISTER=false`）。
- `ALLOW_LOOPBACK_UPSTREAM`、`ALLOW_GLOBAL_ROUTING` 生产保持关闭（SSRF / 全局放行防护）。
- 定期备份 PostgreSQL 卷 `relay_pgdata`，参考 [DEPLOY.md](./DEPLOY.md) 第 7 节。

---

## 项目结构

```
.
├── .env                  # 唯一配置源（生产/开发共用，见 server/.env.example 模板）
├── compose.db.yml        # 仅数据库（本地开发）
├── docker-compose.yml    # 生产：db + server + web
├── deploy.sh             # 一键部署脚本（校验 .env → Docker → up --build → 健康检查）
├── DEPLOY.md             # 生产部署手册（域名/HTTPS/加固/备份）
├── INTEGRATION.md        # 对接契约与联调说明
├── PRODUCT.md            # 产品定位与设计原则
├── server/               # 后端（Express + TS + pg）
│   ├── src/
│   │   ├── db/           # 迁移 / seed / 连接池
│   │   ├── services/     # 网关、计费、限流、OAuth、日志、卡密
│   │   └── http/         # 路由与中间件（含 billing / admin 等）
│   └── Dockerfile
└── web/                  # 前端（React + Vite）
    ├── src/pages/        # 各功能页（仪表盘/用量/套餐/充值/管理页等）
    └── Dockerfile        # 内含 nginx 反代
```

---

## 说明

- 本项目的网关、计费逻辑参考了公开的 Sub2API 设计思想，但为**独立实现**，未复用其代码。
- 上游代理（SOCKS5 等）在 token 交换等场景的默认实现为「透传直连」；如需完整代理能力，请配置系统级 `HTTP(S)_PROXY` 或改用支持代理的 HTTP 客户端。
- 支付渠道 `card` / 测试渠道为本地模拟，接入真实商户（alipay/wechat）需按商户文档实现下单与回调用签名。