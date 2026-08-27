#!/usr/bin/env bash
#
# 中转站 Plus —— 一键部署脚本（面向下载用户）
#
# 运行本脚本即可完成：环境检查 → 配置引导 → 构建启动 → 健康检查 → 输出使用信息。
# 首次运行会在项目根自动生成 .env（唯一配置源），并自动创建数据库表与管理员账号，
# 全程无需手动编辑任何配置文件。
#
# 用法：
#   ./deploy.sh            交互式引导配置并部署（推荐，首次运行）
#   ./deploy.sh --yes      全部使用默认配置 + 自动生成随机密钥，免交互一键部署
#   ./deploy.sh --no-build 已有镜像时跳过构建，加快启动（升级后重启常用）
#   ./deploy.sh --reset    忽略已有 .env，重新引导生成配置（旧配置备份为 .env.bak）
#   ./deploy.sh --help     显示本帮助
#
# 环境要求：Linux / macOS（或 Windows + Git Bash / WSL），已安装 Docker。
# 配置约定：全部个人密钥/账户/数据库凭据只放在项目根 `.env`（唯一配置源）。
#
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "==> 中转站 Plus 一键部署"
echo "==> 项目目录: $PWD"

# ---------- 命令行参数 ----------
YES=0
NO_BUILD=0
RESET=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y)        YES=1 ;;
    --no-build)      NO_BUILD=1 ;;
    --reset)         RESET=1 ;;
    -h|--help)       sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "!! 未知参数: $arg（支持 --yes / --no-build / --reset / --help）"; exit 1 ;;
  esac
done

# ---------- 0. 环境检查 ----------
command -v docker >/dev/null 2>&1 || {
  echo "!! 未检测到 Docker，请先安装 Docker（https://docs.docker.com/get-docker/）后重试"; exit 1; }
DC_CMD=()
if docker compose version >/dev/null 2>&1; then
  DC_CMD=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  DC_CMD=(docker-compose)
else
  echo "!! 未检测到 docker compose（v2 插件或 docker-compose），请安装 Docker Compose 后重试"; exit 1
fi
command -v curl >/dev/null 2>&1 || { echo "!! 未检测到 curl，请安装后重试"; exit 1; }
echo "==> 环境检查通过: $(docker --version 2>/dev/null | tr -d '\r')"

# ---------- 辅助函数 ----------
# 生成 48 位随机十六进制（用作 JWT_SECRET / POSTGRES_PASSWORD）
rand_secret() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 24
  else head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n'; fi
}
# 生成 16 位随机密码（字母+数字，用作管理员初始密码）
rand_pass() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 12 | tr -d '/+=' | cut -c1-16
  else head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n' | cut -c1-16; fi
}
# 交互提问（$1=提示, $2=默认值）；--yes 模式直接输出默认值
ask() {
  local ans
  if [ "$YES" = 1 ]; then printf '%s\n' "$2"; return; fi
  read -r -p "$1 [$2]: " ans || true
  printf '%s\n' "${ans:-$2}"
}
# 交互提问 y/n（$1=提示, $2=默认 true|false）；输出 true/false
ask_yn() {
  local ans
  if [ "$YES" = 1 ]; then printf '%s\n' "$2"; return; fi
  read -r -p "$1 ($2): " ans || true
  case "${ans:-$2}" in
    y|Y|yes|YES|true|TRUE|1) printf 'true' ;;
    *) printf 'false' ;;
  esac
}

# ---------- 1. 配置引导（生成唯一配置源 .env） ----------
GEN_ENV=0
if [ -f .env ] && [ "$RESET" = 0 ]; then
  echo "==> 检测到已有 .env，将复用现有配置（如需重新配置请加 --reset）"
elif [ -f .env ]; then
  cp .env .env.bak
  echo "==> --reset：旧配置已备份为 .env.bak，开始重新引导"
  GEN_ENV=1
else
  echo "==> 首次运行：开始引导生成配置（直接回车使用默认值）"
  GEN_ENV=1
fi

if [ "$GEN_ENV" = 1 ]; then
  echo ""
  echo "------------------ 基础配置（回车=默认值） ------------------"
  SITE_NAME="$(ask '站点名称' '中转站 Plus')"
  ADMIN_EMAIL="$(ask '管理员邮箱' 'admin@relay.local')"
  ADMIN_PASSWORD="$(ask '管理员密码（留空=自动生成随机密码）' '')"
  if [ -z "$ADMIN_PASSWORD" ]; then
    ADMIN_PASSWORD="$(rand_pass)"
    echo "  -> 已自动生成管理员密码: $ADMIN_PASSWORD  （仅显示这一次，请记下）"
  fi
  WEB_PORT="$(ask '对外访问端口' '8082')"
  ALLOW_REGISTER="$(ask_yn '是否开放用户注册' 'true')"
  DEFAULT_BALANCE="$(ask '新用户默认余额(美元, 纯充值制填 0)' '0')"
  FREE_GRANT_AMOUNT="$(ask '免费体验额度(美元, 0=不发放)' '0')"
  PUBLIC_BASE_URL="$(ask '对外公网地址(如 https://api.example.com, 留空=自动)' '')"
  JWT_SECRET="$(rand_secret)"
  POSTGRES_PASSWORD="$(rand_secret)"

  echo ""
  echo "==> 正在写入 .env ..."
  cat > .env <<EOF
# ============================================================
# 中转站 Plus 配置（由 ./deploy.sh 生成，唯一配置源）
# 可手动编辑本文件后重新运行 ./deploy.sh 使改动生效。
# 注意：值中不要引用其他变量；含 # 或空格的取值请用引号包裹。
# ============================================================

# 站点信息
SITE_NAME=${SITE_NAME}
PUBLIC_BASE_URL=${PUBLIC_BASE_URL}

# 对外访问端口（web 入口；如需 HTTPS 请前置 Caddy/Nginx 反代到此端口）
WEB_PORT=${WEB_PORT}

# 数据库（容器内部使用；宿主机不直接暴露，无需改动）
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
DATABASE_URL=postgres://relay:${POSTGRES_PASSWORD}@db:5432/relay_plus

# JWT 签名密钥（已自动生成随机值；泄露可导致令牌伪造，请勿公开）
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=7d

# 初始管理员（首次启动自动创建，请登录后尽快修改密码）
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}

# 运营模式（full=完整模式含 SaaS 计费界面；simple=隐藏计费界面）
RUN_MODE=full

# 用户注册与余额
ALLOW_REGISTER=${ALLOW_REGISTER}
DEFAULT_BALANCE=${DEFAULT_BALANCE}
FREE_GRANT_AMOUNT=${FREE_GRANT_AMOUNT}

# CORS 白名单（逗号分隔；留空=允许所有来源，生产建议填前端域名）
CORS_ORIGINS=

# 登录安全
LOGIN_MAX_FAILS=5
LOGIN_LOCK_SECONDS=600
LOGIN_IP_WINDOW_SEC=60
LOGIN_IP_BURST=20

# 注册限制（0=不限）
REGISTER_IP_CAP=5
REGISTER_EMAIL_SUFFIX_WHITELIST=
REGISTER_EMAIL_DOMAIN_QUOTA=0

# 计费与安全开关（生产环境建议保持默认）
BALANCE_LOW_THRESHOLD=0
USD_TO_CNY=7.2
ALLOW_UNPRICED=false
ALLOW_LOOPBACK_UPSTREAM=false
ALLOW_GLOBAL_ROUTING=false

# Cloudflare Turnstile 人机验证（留空=不启用）
TURNSTILE_SECRET=

# 可选：GitHub 登录 / 邮件（留空即不启用）
OAUTH_GITHUB_CLIENT_ID=
OAUTH_GITHUB_CLIENT_SECRET=
OAUTH_GITHUB_REDIRECT_URI=
SMTP_HOST=

# 网关默认上游超时（毫秒）
UPSTREAM_TIMEOUT_MS=300000

# OpenAI OAuth（与 Sub2API/Codex CLI 兼容的公共客户端，一般无需修改）
OPENAI_OAUTH_CLIENT_ID=app_EMoamEEZ73f0CkXaXp7hrann
OPENAI_OAUTH_AUTHORIZE_URL=https://auth.openai.com/oauth/authorize
OPENAI_OAUTH_TOKEN_URL=https://auth.openai.com/oauth/token
EOF
  chmod 600 .env
  echo "==> .env 已生成（权限 600，仅当前用户可读）"
fi

# ---------- 2. 校验配置（安全解析：逐行读取，不经过 eval） ----------
while IFS='=' read -r k v; do
  case "$k" in
    ''|'#'*) continue ;;
    *) export "$k=$v" ;;
  esac
done < <(grep -v '^\s*#' .env)

MISSING=()
[ -z "${JWT_SECRET:-}" ]        && MISSING+=("JWT_SECRET")
[ -z "${ADMIN_EMAIL:-}" ]       && MISSING+=("ADMIN_EMAIL")
[ -z "${ADMIN_PASSWORD:-}" ]    && MISSING+=("ADMIN_PASSWORD")
[ -z "${POSTGRES_PASSWORD:-}" ] && MISSING+=("POSTGRES_PASSWORD")
if [ "${#MISSING[@]}" -gt 0 ]; then
  echo "!! 根 .env 缺少必填项：${MISSING[*]}（请编辑 .env 补全后重新运行 ./deploy.sh）"
  exit 1
fi
echo "==> 配置校验通过（JWT_SECRET 长度: ${#JWT_SECRET}，读取自唯一源 .env）"

# ---------- 3. 构建并启动 ----------
echo "==> 开始构建并启动（${DC_CMD[*]} up -d --build）..."
if [ "$NO_BUILD" = 1 ]; then
  "${DC_CMD[@]}" up -d --no-build
else
  "${DC_CMD[@]}" up -d --build
fi

# ---------- 4. 健康检查（最多等 120s），超时属于失败 ----------
WEB_PORT="${WEB_PORT:-8082}"
echo "==> 等待服务健康（最多 120 秒）..."
DEPLOY_OK=0
for i in $(seq 1 24); do
  DB_ST=$("${DC_CMD[@]}" ps --format '{{.Service}}:{{.Status}}' | grep -E '^db:' || true)
  SRV_ST=$("${DC_CMD[@]}" ps --format '{{.Service}}:{{.Status}}' | grep -E '^server:' || true)
  if echo "$DB_ST" | grep -qi 'healthy' && echo "$SRV_ST" | grep -qi 'up'; then
    if curl -fsS -m 3 "http://127.0.0.1:${WEB_PORT}/healthz" >/dev/null 2>&1; then
      echo "==> 服务就绪（等待 $((i*5))s）"
      DEPLOY_OK=1
      break
    fi
  fi
  sleep 5
done
if [ "$DEPLOY_OK" != 1 ]; then
  echo "!! 部署未完成（服务未就绪）。请用 ${DC_CMD[*]} logs -f server 排查后重试。"
  exit 1
fi

# ---------- 5. 输出使用信息 ----------
echo ""
echo "======================================================"
echo "  部署完成 ✅ 中转站 Plus 已上线"
echo "======================================================"
echo "  访问地址 : http://<服务器IP>:${WEB_PORT}/login"
echo "  管理后台 : http://<服务器IP>:${WEB_PORT}/app"
echo "  管理员   : ${ADMIN_EMAIL}"
echo ""
echo "  常用命令:"
echo "    查看日志 : ${DC_CMD[*]} logs -f server"
echo "    重启     : ${DC_CMD[*]} restart"
echo "    停止     : ${DC_CMD[*]} down"
echo "    升级     : git pull && ./deploy.sh --no-build"
echo ""
echo "  HTTPS: 建议前置 Caddy / Nginx / 云负载均衡反代到 ${WEB_PORT}，勿裸跑公网 HTTP。"
echo "  首次使用: 登录后进入管理后台，在「设置」中配置上游 API Key 与售价倍率。"
echo "======================================================"
