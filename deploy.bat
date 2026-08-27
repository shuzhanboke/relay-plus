@echo off
chcp 65001 >nul
REM ============================================================
REM  中转站 Plus 一键部署（Windows 入口）
REM  需要：Docker Desktop + Git for Windows（提供 bash）
REM  用法：双击本文件，或在命令行运行 deploy.bat [--yes]
REM ============================================================

where docker >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Docker，请先安装 Docker Desktop：https://www.docker.com/products/docker-desktop/
  pause
  exit /b 1
)

where bash >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Git Bash，请安装 Git for Windows：https://git-scm.com/download/win
  pause
  exit /b 1
)

echo ==^> 调用 deploy.sh 开始一键部署...
bash deploy.sh %*
if errorlevel 1 (
  echo.
  echo [错误] 部署失败，请根据上方日志排查（常见：网络不通、端口被占用）。
  pause
  exit /b 1
)

echo.
echo ==^> 部署完成。请用浏览器访问 http://服务器IP:8082/login 开始使用。
pause
