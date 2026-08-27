#!/usr/bin/env bash
#
# 中转站 Plus —— 自包含单文件部署器打包脚本
#
# 产物：把「部署器二进制 + 该架构服务镜像」合成一个自包含单文件。
# 用户下载这一个文件即可直接运行（内部自解压镜像 → docker load → 启动，零参数）。
#
# 用法：
#   ./scripts/package-selfcontained.sh <platform>
#     platform: windows-x86_64 | linux-x86_64 | linux-aarch64 | macos-aarch64
#
# 前置：已 `docker compose build` 出 plus-server/plus-web 镜像（当前架构），
#       且已交叉编译出对应平台的部署器二进制（deployer/target/<target>/release）。
#
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PLAT="${1:?用法: ./scripts/package-selfcontained.sh <platform>}"
case "$PLAT" in
  windows-x86_64) BIN="deployer/target/x86_64-pc-windows-msvc/release/relay-plus-deployer.exe"; EXT=".exe" ;;
  linux-x86_64)   BIN="deployer/target/x86_64-unknown-linux-gnu/release/relay-plus-deployer";      EXT="" ;;
  linux-aarch64)  BIN="deployer/target/aarch64-unknown-linux-gnu/release/relay-plus-deployer";     EXT="" ;;
  macos-aarch64)  BIN="deployer/target/aarch64-apple-darwin/release/relay-plus-deployer";          EXT="" ;;
  *) echo "!! 未知平台: $PLAT（支持 windows-x86_64 / linux-x86_64 / linux-aarch64 / macos-aarch64）"; exit 1 ;;
esac

test -f "$BIN" || { echo "!! 未找到部署器二进制: $BIN"; exit 1; }
command -v gzip >/dev/null 2>&1 || { echo "!! 需要 gzip"; exit 1; }

OUT="dist/relay-plus-selfcontained$EXT"
DIST_DIR="dist"
mkdir -p "$DIST_DIR"

echo "==> 构建镜像（plus-server / plus-web）..."
docker compose build

echo "==> 导出并压缩镜像段（server/web/postgres）..."
TMPGZ="$(mktemp --suffix=.tar.gz)"
docker save plus-server:latest plus-web:latest postgres:16-alpine | gzip -9 > "$TMPGZ"

echo "==> 组装自包含单文件: $OUT ..."
# marker + gzip 数据 追加到部署器二进制尾部
cp "$BIN" "$OUT"
printf '\n==RELAY_PLUS_EMBED_BEGIN==\n' >> "$OUT"
cat "$TMPGZ" >> "$OUT"
rm -f "$TMPGZ"

echo "==> 完成: $OUT（$(du -h "$OUT" | cut -f1））"
echo "    用法：下载该文件，在 Windows/Linux 上直接运行即可（需本机已装 Docker）。"
