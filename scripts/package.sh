#!/usr/bin/env bash
#
# 中转站 Plus —— 离线发布包打包脚本
# 产物：dist/relay-plus-offline/ 目录，内含部署器二进制 + docker-compose.yml + images.tar
#
# 用法：
#   ./scripts/package.sh <platform>   # platform: windows | linux | macOS
#   例： ./scripts/package.sh windows
#
# 说明：
#   1. 在线构建 server/web 镜像并导入 postgres，docker save 成 images.tar
#   2. 拷贝指定平台的部署器二进制（需先交叉编译好，见 deployer/README）
#   3. 把 compose 白名单文件与部署器组装到 dist/relay-plus-offline-<platform>/
#
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PLAT="${1:?用法: ./scripts/package.sh <windows|linux|macOS>}"
case "$PLAT" in
  windows) BIN="deployer/target/x86_64-pc-windows-msvc/release/relay-plus-deployer.exe";;
  linux)   BIN="deployer/target/x86_64-unknown-linux-musl/release/relay-plus-deployer";;
  macOS)   BIN="deployer/target/aarch64-apple-darwin/release/relay-plus-deployer";;
  *) echo "!! 未知平台: $PLAT（支持 windows / linux / macOS）"; exit 1;;
esac

test -f "$BIN" || { echo "!! 未找到部署器二进制: $BIN（请先交叉编译，见 deployer/README.md）"; exit 1; }

OUT="dist/relay-plus-offline-$PLAT"
rm -rf "$OUT"
mkdir -p "$OUT"

echo "==> 构建镜像..."
docker compose build
echo "==> 导出镜像 images.tar（server/web/postgres）..."
docker save -o images.tar plus-server:latest plus-web:latest postgres:16-alpine

echo "==> 组装离线包: $OUT"
cp "$BIN" "$OUT/"
cp docker-compose.yml "$OUT/"
cp compose.db.yml "$OUT/" || true
cp images.tar "$OUT/"
cp README.md "$OUT/说明.md" 2>/dev/null || cp README.md "$OUT/README.md"

cat > "$OUT/安装说明.txt" <<'EOF'
中转站 Plus 离线安装包
=======================

前提：目标机器已安装 Docker（含 docker compose）。

安装：
  1. 将本文件夹整体拷贝到目标服务器（至少 500MB 可用空间）。
  2. 运行部署器：
       Windows: 双击 relay-plus-deployer.exe（或在 cmd 运行 relay-plus-deployer.exe --offline）
       Linux  : ./relay-plus-deployer --offline
       macOS  : ./relay-plus-deployer --offline
  3. 按引导输入站点名/管理员邮箱/密码/端口（回车=默认）。
  4. 部署器会自动载入 images.tar 并启动全套服务，完成后打印访问地址。

升级：
  替换旧的 images.tar 与部署器二进制后，重新运行部署器 --offline。

说明：
  本安装包为离线模式（含全部镜像），安装过程不依赖外网。
EOF

echo "==> 完成: $OUT"
echo "    包大小: $(du -sh "$OUT" 2>/dev/null | cut -f1)"
