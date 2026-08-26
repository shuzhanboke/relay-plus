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

## 快速开始

生产与本地开发都使用**项目根目录 `.env`** 作为唯一配置源（集中存放全部密钥 / 账户 / 数据库凭据）。模板与字段说明见 `server/.env.example`。

### 生产部署（Docker Compose，推荐）

前置：Docker 20.10+ 与 Docker Compose v2+（或直接使用 `deploy.sh`）。

```bash
git clone <你的仓库地址> relay-plus && cd relay-plus

# 1) 用模板创建唯一的根 .env，并按需修改
cp server/.env.example .env
#   务必修改 JWT_SECRET / ADMIN_PASSWORD / POSTGRES_PASSWORD 等敏感项
#   （生产建议：openssl rand -hex 32 生成 JWT_SECRET，openssl rand -hex 16 生成 POSTGRES_PASSWORD）

# 2) 一键校验 + 构建 + 启动 + 健康检查
./deploy.sh
```

`deploy.sh` 会：校验 `.env` 必填项（`JWT_SECRET` / `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `POSTGRES_PASSWORD` / `DATABASE_URL`）→ 检查 Docker → `docker compose up -d --build` → 健康检查（超时视为失败，exit 1）→ 打印访问信息。

手动等价命令：

```bash
docker compose up -d --build
docker compose ps            # 等待 db 变 healthy、server 为 up
docker compose logs -f server
```

- 管理后台：`http://服务器IP:8082`（Nginx 对外映射，端口可在 `docker-compose.yml` 的 `web.ports` 左侧调整）
- 默认管理员：`admin@relay.local` / `admin123456`（来自 `.env`，首次登录后请修改）

> 生产必须配合 HTTPS：前置 Caddy / Nginx / 云负载均衡 反代到 80/443。详见 [DEPLOY.md](./DEPLOY.md)。

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
