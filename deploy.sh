#!/usr/bin/env bash
#
# 中转站 Plus —— 一键部署脚本（Linux 服务器）
# 配置约定：全部个人密钥/账户/数据库凭据只放在项目根 `.env`（唯一配置源）。
#
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "==> 项目目录: $PWD"

# ---------- 1. 校验唯一配置源 ----------
if [ ! -f .env ]; then
  echo "!! 缺少配置文件：请先复制模板并填写（唯一配置源，集中存放全部密钥/账户/数据库凭据）："
  echo "    cp server/.env.example .env"
  echo "    然后务必修改 JWT_SECRET / ADMIN_PASSWORD / POSTGRES_PASSWORD"
  exit 1
fi

# 加载 .env（安全解析：逐行读取，兼容含空格/特殊字符的值；compose 会自行读取，这里仅做前置校验）
while IFS='=' read -r k v; do
  case "$k" in
    ''|'#'*) continue ;;  # 跳过空行与注释
    *) export "$k=$v" ;;   # 值不再经过 eval/shell 二次解释，避免空格值 command not found
  esac
done < <(grep -v '^\s*#' .env)

MISSING=()
[ -z "${JWT_SECRET:-}" ]          && MISSING+=("JWT_SECRET")
[ -z "${ADMIN_EMAIL:-}" ]         && MISSING+=("ADMIN_EMAIL")
[ -z "${ADMIN_PASSWORD:-}" ]      && MISSING+=("ADMIN_PASSWORD")
[ -z "${POSTGRES_PASSWORD:-}" ]   && MISSING+=("POSTGRES_PASSWORD")
[ -z "${DATABASE_URL:-}" ]        && MISSING+=("DATABASE_URL")
if [ "${#MISSING[@]}" -gt 0 ]; then
  echo "!! 根 .env 缺少必填项：${MISSING[*]}"
  exit 1
fi
echo "==> 配置校验通过（JWT_SECRET 长度: ${#JWT_SECRET}，读取自唯一源 .env）"

# ---------- 2. Docker 环境检查 ----------
docker --version >/dev/null 2>&1 || { echo "!! 未安装 Docker"; exit 1; }

# ---------- 3. 构建并启动 ----------
echo "==> 开始构建并启动（docker compose up -d --build）..."
docker compose up -d --build

# ---------- 4. 健康检查（最多等 120s），超时属于失败 ----------
echo "==> 等待服务健康..."
DEPLOY_OK=0
for i in $(seq 1 24); do
  DB_OK=$(docker compose ps --format '{{.Service}}:{{.Status}}' | grep -E '^db:' || true)
  SRV_OK=$(docker compose ps --format '{{.Service}}:{{.Status}}' | grep -E '^server:' || true)
  if echo "$DB_OK" | grep -qi 'healthy' && echo "$SRV_OK" | grep -qi 'up'; then
    echo "==> db 健康 / server 运行中（等待 $((i*5))s）"; DEPLOY_OK=1; break
  fi
  sleep 5
  [ "$i" = 24 ] && echo "!! 等待超时，请用 docker compose logs -f server 排查"
done
if [ "$DEPLOY_OK" != 1 ]; then
  echo "!! 部署未完成（服务未就绪），已退出。请用 docker compose logs 排查后重试。"
  exit 1
fi

# ---------- 5. 打印访问信息 ----------
PORT_OUT="${WEB_PORT:-8082}"
echo ""
echo "部署完成 👇"
echo "  访问地址 : http://<服务器IP>:${PORT_OUT}   （默认 8082，若被占用可改 docker-compose.yml web.ports 左侧）"
echo "  管理员账号: ${ADMIN_EMAIL:-admin@relay.local}"
echo "  日志查看 : docker compose logs -f server"
echo "  停止     : docker compose down"
echo "  HTTPS    : 请前置 Caddy / Nginx / 云负载均衡反代到 80，勿裸跑公网 HTTP"
