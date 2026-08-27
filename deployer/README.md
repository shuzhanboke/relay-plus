# 中转站 Plus 部署器（Rust）

跨平台一键部署器：引导生成 `.env` → 检测 Docker → 启动（在线构建 / 离线加载镜像）→ 健康检查 → 输出使用信息。

支持平台：Windows / Linux / macOS（x86_64 与 arm64）。

## 用法

在项目根目录（存在 `docker-compose.yml` 的位置）运行：

```text
relay-plus-deployer [选项]

  --yes       全部使用默认配置 + 自动随机密钥，免交互部署
  --offline   离线模式（载入 images.tar 后用 docker compose up --no-build）
  --reset     忽略已有 .env 重新生成（旧配置备份为 .env.bak）
  -h, --help  显示帮助
```

首次运行自动生成唯一配置源 `.env`，并自动创建数据库表与管理账号。

## 本地开发（本机只编 Windows）

```bash
cd deployer
cargo build --release                          # 本机 Windows exe
```

## 三平台 / 双架构交叉编译

本机（Windows）只能直接产出 Windows 二进制。完整六产物（win/linux/macOS × x86_64/arm64）由 **GitHub Actions** 生成：

- workflow：`.github/workflows/build-deployer.yml`
- 触发：push 到 `main` 或 `v*` tag。产物以上传 artifact（tag 时可附加到 Release）。

各产物命名：

| 产物 | 目标 target |
|---|---|
| `relay-plus-deployer.exe` | Windows x86_64-pc-windows-msvc |
| `relay-plus-deployer-arm64.exe` | Windows aarch64-pc-windows-msvc |
| `relay-plus-deployer-linux-x86_64` | Linux x86_64-unknown-linux-musl |
| `relay-plus-deployer-linux-aarch64` | Linux aarch64-unknown-linux-musl |
| `relay-plus-deployer-macos-x86_64` | macOS x86_64-apple-darwin |
| `relay-plus-deployer-macos-aarch64` | macOS aarch64-apple-darwin |

## 离线安装包

`scripts/package.sh` 把「部署器二进制 + docker-compose.yml + images.tar」组装成离线包：

```bash
docker compose build                 # 先构建镜像（需有可联网+可跑 compose 的 Docker）
docker save -o images.tar plus-server:latest plus-web:latest postgres:16-alpine
./scripts/package.sh windows          # windows | linux | macOS
```

离线包目标机器只依赖已安装的 Docker，安装过程不联网。

> 说明：`images.tar` 体积较大（≈200MB），不进 git 仓库，通过 Release 附件交付。
