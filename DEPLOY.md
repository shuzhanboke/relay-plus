# 中转站 Plus · 生产部署手册

本手册指导把「中转站 Plus」部署到你的 VPS 并上线。含：环境准备、域名与 HTTPS、构建启动、安全加固、备份、日常运维、上线检查清单。

---

## 0. 你需要准备（外部资源）

| 项 | 说明 |
|---|---|
| VPS | Linux（Ubuntu 22.04/Debian 12 推荐），海外机房（便于访问 OpenAI/Anthropic），建议 2C4G+，放行端口 |
| 域名 | 已解析 A 记录到 VPS 公网 IP（`@` 与 `www`） |
| TLS 证书 | 用 Caddy 自动签发（推荐，零配置），或 Nginx + certbot |
| 上游凭据 | OpenAI/Anthropic API Key，或你的上游中转 base URL + Key |
| HTTPS 端口 | 80/443（Caddy/Nginx 监听），SSH 22/自定义 |

> 生产必须使用域名 + TLS，不要用裸 IP + HTTP（会导致客户端 SDK 拒连、Cookie/鉴权不安全）。

---

## 1. 系统前置

```bash
# 以 root 执行
apt update && apt upgrade -y
apt install -y docker.io docker-compose-plugin git curl ufw

# 放行端口
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

---

## 2. 克隆并准备配置

```bash
# 在你服务器上
mkdir -p /opt/relay-plus && cd /opt/relay-plus
git clone <你的仓库地址> .   # 或先 git init 拉取

# 生成生产配置
cp server/.env.example .env
```

### 编辑 `.env`（关键安全项必须改）

| 变量 | 必填 | 说明 |
|---|---|---|
| `JWT_SECRET` | ✅ | 随机 48+ 字符，`openssl rand -hex 32` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | ✅ | 强管理员密码（≥12 位） |
| `POSTGRES_PASSWORD` | ✅ | `openssl rand -hex 16` |
| `ALLOW_REGISTER` | `false` 对外则 `true` | 开放注册 |
| `ALLOW_LOOPBACK_UPSTREAM` | 生产**不得为 true** | 关闭（默认）以启用 SSRF 防护 |
| `TURNSTILE_SECRET` | 建议 | 配置后强制人机验证 |
| `FREE_GRANT_AMOUNT` | 可选 | 新用户免费体验额度 |
| `LOGIN_MAX_FAILS` / `LOGIN_LOCK_SECONDS` | 默认即可 | 登录防爆破 |

```bash
cd /opt/relay-plus
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)" >> .env
```

---

## 3. 构建并启动（Docker Compose）

> 仓库 `docker-compose.yml` 定义：`db`(postgres) + `server`(后端) + `web`(nginx+前端静态资源)。
> 默认 web 监听 80 端口。**由 Caddy 对外反代 443**（见第 4 步）。

```bash
cd /opt/relay-plus
docker compose -f docker-compose.yml up -d --build
docker compose -f docker-compose.yml ps
docker compose -f docker-compose.yml logs -f server   # 应看到 migrations/seeding/listening
```

首启后检查：
- `http://服务器IP/healthz` → `{"status":"ok"}`
- 管理后台 `http://服务器IP/` → 应出现登录页

> 若 80 被占，将 `docker-compose.yml` 中 `web` 的 `ports` 改为 `8080:80` 等，再配 Caddy 反代到该端口。

---

## 4. 域名 + HTTPS（Caddy，推荐）

`web` 容器已含 Nginx 反代后端。再放一层 Caddy 负责 **HTTPS 终结 + 域名映射到 web 容器**。

新建 `/opt/relay-plus/caddy/Caddyfile`：

```caddy
api.yourdomain.com {
    reverse_proxy localhost:80 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}
```

启动 Caddy：

```bash
mkdir -p /opt/relay-plus/caddy
# 上面 Caddyfile 放进去后：
cd /opt/relay-plus
docker run -d --name caddy \
  -p 80:80 -p 443:443 \
  -v /opt/relay-plus/caddy:/etc/caddy \
  -v caddy_data:/data -v caddy_config:/config \
  caddy:latest caddy run --config /etc/caddy/Caddyfile
```

> 若用 Nginx + certbot：把 `web/nginx.conf` 配到 443，用 certbot 签证书。

---

## 5. 配置真实上游 & 发 Key

1. 登录后台 `https://api.yourdomain.com`（管理员）。
2. **上游账号** → 添加：平台 `openai`，Base URL 留空用官方，API Key 填你的真实 Key。
3. **分组管理** → 创建分组（如 `codex`），把上游加入分组。
4. **用户管理** → 创建用户、充值余额；**API Key 管理** → 生成 `sk-` Key 并绑定分组。
5. 客户端接入：
   - Claude Code：`ANTHROPIC_BASE_URL=https://api.yourdomain.com`，`ANTHROPIC_AUTH_TOKEN=sk-...`
   - OpenAI SDK：`base_url=https://api.yourdomain.com/v1`，`api_key=sk-...`

---

## 6. 上线前安全加固清单

- [ ] `JWT_SECRET` 为随机 40+ 位，未用默认值
- [ ] `ADMIN_PASSWORD` 为强密码，首次登录后已改
- [ ] `ALLOW_LOOPBACK_UPSTREAM` 未开启（SSRF 防护生效）
- [ ] 已配 `TURNSTILE_SECRET`（人机验证）
- [ ] 已配 `ALLOW_REGISTER`（公开= `true`，否则 `false`）
- [ ] 只有 22/80/443 对公网开放（ufw）
- [ ] 已通过域名访问，HTTP 已重定向 HTTPS
- [ ] 用真实上游对 `/v1/chat/completions` 做过一次成功真实调用，并核对余额扣费

---

## 7. 数据备份（重要）

PostgreSQL 数据在命名卷 `relay_pgdata`。建议 nightly 逻辑备份：

```bash
# 每日 3:00 备份到 /opt/backups
mkdir -p /opt/backups
cat > /usr/local/bin/backup-relay.sh <<'SH'
#!/usr/bin/env bash
DIR=/opt/backups
docker exec $(docker ps -qf name=relay-plus-db) pg_dump -U relay -d relay_plus | gzip > "$DIR/relay_$(date +%Y%m%d_%H%M).sql.gz"
find "$DIR" -name '*.sql.gz' -mtime +7 -delete
SH
chmod +x /usr/local/bin/backup-relay.sh
# crontab -e 添加：
# 0 3 * * * /usr/local/bin/backup-relay.sh >/dev/null 2>&1
```

日常升级：

```bash
cd /opt/relay-plus
docker compose -f docker-compose.yml pull && docker compose -f docker-compose.yml up -d --build
```

---

## 8. 运维排查

| 现象 | 排查 |
|---|---|
| 后台访问不了 | 看 `docker compose logs server`，是否 DB 连不上/迁移失败；ufw 是否放行 |
| 网关 502 | 上游 Key 无效/超时；看 `server` 日志与后台「请求日志」的 error_message |
| **SSRF 拦截** | 上游 base_url 指向内网被拒属正常，生产不能用内网上游 |
| 登录被锁 | 连续失败 5 次锁 10 分钟，等 / 后台清 `rate_counters` 表 |
| 余额不扣 | 该模型价格表未配置（按 0 计费），去「模型价格」补价格 |

---

## 9. 上线后建议

- 接支付商户号后，在 `billingRoutes` 中为 `channel=alipay/wechat` 填充真实下单与回调用签名实现（当前提供 manual 人工到账过渡）。
- 监控：UptimeRobot 探活 `/healthz`；上游失败、余额告警（可接 webhook / 云告警）。
- 关注上游 ToS 合规风险。

---

## 10. 快速验证清单（部署后）

```bash
# 1) 服务健康
curl -s http://localhost/healthz
# 2) 登录
curl -s -X POST http://localhost/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@yourdomain.com","password":"<强密码>"}'
# 3) 真实网关调用（拿到 sk- key 后）
curl -s https://api.yourdomain.com/v1/chat/completions -H "Authorization: Bearer sk-xxx" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}'
# 4) 检查收货：后台「用户」余额已扣对应金额
```

---

这份手册编写期的**外部依赖**：
- 真实上游 Key → 用于完成 `step 6/10` 的真实联调验证（launch_step_05）。
- VPS IP / 域名 / SSH → 实际执行 `step 1-5` 的部署落地（launch_step_06）。

请提供这些值后，我可以在你服务器上直接执行或逐条指导完成上线。
