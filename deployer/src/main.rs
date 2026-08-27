//! 中转站 Plus —— 一键部署部署器（跨平台：Windows / Linux / macOS）
//!
//! 工作方式：引导生成根 `.env` → 调用 `docker compose` 启动全套 → 健康检查 → 输出使用信息。
//!   在线模式（默认）: docker compose up -d --build（需 server/ web/ 源码）
//!   离线模式（--offline）: 若存在 images.tar 则 docker load，再 docker compose up -d --no-build
//!
//! 本程序假定在项目根目录运行（需存在 docker-compose.yml 与根 .env 同一目录）。

use std::env;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::Duration;

const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
const ENV_TEMPLATE: &str = include_str!("env.template");
const MIN_SECRET_HEX: usize = 48;
const ADMIN_PASS_LEN: usize = 16;

struct Args {
    yes: bool,
    offline: bool,
    reset: bool,
    help: bool,
}

impl Args {
    fn parse() -> Args {
        let mut a = Args { yes: false, offline: false, reset: false, help: false };
        for arg in env::args().skip(1) {
            match arg.as_str() {
                "--yes" | "-y" => a.yes = true,
                "--offline" => a.offline = true,
                "--reset" => a.reset = true,
                "--help" | "-h" | "help" => a.help = true,
                other => {
                    eprintln!("!! 未知参数: {other}（支持 --yes / --offline / --reset / --help）");
                    std::process::exit(1);
                }
            }
        }
        a
    }
}

// ---------- 辅助 ----------

fn print_banner() {
    println!("===============================================================");
    println!("  中转站 Plus 一键部署部署器 v{APP_VERSION}   (Windows / Linux / macOS)");
    println!("===============================================================");
}

/// 读一行，回车返回 None（用默认值）
fn read_line() -> Option<String> {
    let mut s = String::new();
    io::stdin().read_line(&mut s).ok()?;
    let s = s.trim().to_string();
    if s.is_empty() { None } else { Some(s) }
}

/// 交互提问；--yes 模式直接返回默认值
fn ask(prompt: &str, default: &str, yes: bool) -> String {
    if yes {
        return default.to_string();
    }
    print!("{prompt} [{default}]: ");
    io::stdout().flush().ok();
    match read_line() {
        Some(v) => v,
        None => default.to_string(),
    }
}

/// 交互 y/n（default: true/false）返回 "true"/"false"
fn ask_yn(prompt: &str, default_true: bool, yes: bool) -> String {
    let d = if default_true { "true" } else { "false" };
    if yes {
        return d.to_string();
    }
    print!("{prompt} (default {d}) [y/N]: ");
    io::stdout().flush().ok();
    match read_line() {
        Some(v) => {
            let lv = v.to_lowercase();
            if ["y", "yes", "true", "1"].contains(&lv.as_str()) { "true".into() } else { "false".into() }
        }
        None => d.to_string(),
    }
}

/// 从安全随机源取 bytes（Windows 与 Unix 均有系统支持）
fn secure_rand(buf: &mut [u8]) -> Result<(), String> {
    let mut tmp = vec![0u8; buf.len()];
    getrandom::getrandom(&mut tmp).map_err(|e| format!("随机数生成失败: {e}"))?;
    buf.copy_from_slice(&tmp);
    Ok(())
}

/// 生成 n 位的十六进制随机串
fn rand_hex(n: usize) -> Result<String, String> {
    let bytes = (n + 1) / 2;
    let mut buf = vec![0u8; bytes];
    secure_rand(&mut buf)?;
    Ok(buf.iter().map(|b| format!("{:02x}", b)).collect::<String>()[..n].to_string())
}

/// 生成字母+数字随机密码
fn rand_password() -> Result<String, String> {
    const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let mut buf = vec![0u8; ADMIN_PASS_LEN];
    secure_rand(&mut buf)?;
    Ok(buf.iter().map(|&b| CHARS[(b as usize) % CHARS.len()] as char).collect())
}

/// 定位项目目录（假定 deployer 二进制在项目根，或在项目根运行）
fn project_dir() -> PathBuf {
    let cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    if cwd.join("docker-compose.yml").exists() {
        cwd
    } else {
        // 二进制可能在 deployer/target/... 下被直接运行，向上找 docker-compose.yml
        let mut d = cwd.clone();
        while d.pop() {
            if d.join("docker-compose.yml").exists() {
                return d;
            }
        }
        cwd
    }
}

// ---------- 生成 .env ----------

fn write_env(proj: &Path, yes: bool) -> Result<bool, String> {
    let env_path = proj.join(".env");
    let env_path_str = env_path.display().to_string();

    if env_path.exists() && !yes {
        // 交互模式：询问是否覆盖
        let confirmed = ask_yn("检测到已有 .env，是否覆盖重新生成？", false, false);
        if confirmed == "false" {
            println!("==> 复用现有 .env（如需重新配置请运行 --reset）");
            return Ok(false);
        }
    }
    if env_path.exists() {
        // 备份一次
        let _ = fs::copy(&env_path, proj.join(".env.bak"));
        println!("==> 旧配置已备份为 .env.bak");
    }

    println!("==> 开始引导生成配置（直接回车使用默认值）");
    let site_name = ask("站点名称", "中转站 Plus", yes);
    let admin_email = ask("管理员邮箱", "admin@relay.local", yes);
    let mut admin_password = ask("管理员密码（留空=自动生成随机）", "", yes);
    if admin_password.is_empty() {
        admin_password = rand_password()?;
        println!("  -> 已自动生成管理员密码: {admin_password}   （仅显示这一次，请记下）");
    }
    let web_port = ask("对外访问端口", "8082", yes);
    let allow_register = ask_yn("是否开放用户注册", true, yes);
    let default_balance = ask("新用户默认余额(美元, 纯充值制填 0)", "0", yes);
    let free_grant = ask("免费体验额度(美元, 0=不发放)", "0", yes);
    let public_url = ask("对外公网地址(留空=自动)", "", yes);

    let jwt_secret = rand_hex(MIN_SECRET_HEX)?;
    let pg_password = rand_hex(MIN_SECRET_HEX)?;
    let datbase_url = format!("postgres://relay:{}@db:5432/relay_plus", pg_password);

    // 渲染模板
    let content = ENV_TEMPLATE
        .replace("__SITE_NAME__", &site_name)
        .replace("__PUBLIC_BASE_URL__", &public_url)
        .replace("__WEB_PORT__", &web_port)
        .replace("__POSTGRES_PASSWORD__", &pg_password)
        .replace("__DATABASE_URL__", &datbase_url)
        .replace("__JWT_SECRET__", &jwt_secret)
        .replace("__ADMIN_EMAIL__", &admin_email)
        .replace("__ADMIN_PASSWORD__", &admin_password)
        .replace("__ALLOW_REGISTER__", &allow_register)
        .replace("__DEFAULT_BALANCE__", &default_balance)
        .replace("__FREE_GRANT_AMOUNT__", &free_grant);

    fs::write(&env_path, content).map_err(|e| format!("写入 .env 失败: {e}"))?;
    // 设置权限 600（Unix）
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&env_path, fs::Permissions::from_mode(0o600));
    }
    println!("==> .env 已生成: {env_path_str}");
    Ok(true)
}

// ---------- 校验 .env ----------

fn parse_env(path: &Path) -> Result<std::collections::HashMap<String, String>, String> {
    let text = fs::read_to_string(path).map_err(|e| format!("读取 .env 失败: {e}"))?;
    let mut map = std::collections::HashMap::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(eq) = line.find('=') {
            let k = line[..eq].trim().to_string();
            let v = line[eq + 1..].trim().trim_matches('"').to_string();
            if !k.is_empty() {
                map.insert(k, v);
            }
        }
    }
    Ok(map)
}

fn validate_env(env: &std::collections::HashMap<String, String>) -> Result<(), String> {
    let mut missing: Vec<&str> = Vec::new();
    for key in ["JWT_SECRET", "ADMIN_EMAIL", "ADMIN_PASSWORD", "POSTGRES_PASSWORD"] {
        match env.get(key) {
            Some(v) if !v.is_empty() => {}
            _ => missing.push(key),
        }
    }
    if !missing.is_empty() {
        return Err(format!("根 .env 缺少必填项: {}", missing.join(" / ")));
    }
    println!(
        "==> 配置校验通过（JWT_SECRET 长度: {}）",
        env.get("JWT_SECRET").map(|s| s.len()).unwrap_or(0)
    );
    Ok(())
}

// ---------- 运行命令 ----------

fn find_docker() -> Result<(), String> {
    let v = Command::new("docker").arg("--version").output();
    match v {
        Ok(o) if o.status.success() => {
            let s = String::from_utf8_lossy(&o.stdout);
            println!("==> 环境检查通过: {}", s.trim());
            Ok(())
        }
        _ => Err("未检测到 Docker。请先安装 Docker（https://docs.docker.com/get-docker/）后重试".into()),
    }
}

/// 运行命令并透传 stdout/stderr，返回是否成功
fn run_cmd(program: &str, args: &[&str]) -> io::Result<bool> {
    // 打印执行的命令，便于排查
    let mut line = String::from(program);
    for a in args {
        line.push(' ');
        line.push_str(a);
    }
    println!("$ {line}");
    match Command::new(program).args(args).status() {
        Ok(st) => Ok(st.success()),
        Err(e) => Err(e),
    }
}

/// 轮询 compose ps，直到 db healthy + server up，最多 120s
fn wait_healthy() -> bool {
    for _ in 0..24 {
        let out = Command::new("docker").args(["compose", "ps", "--format", "{{.Service}}:{{.Status}}"]).output();
        if let Ok(o) = out {
            let text = String::from_utf8_lossy(&o.stdout).to_string();
            let db_ok = text.lines().any(|l| l.starts_with("db:") && l.to_lowercase().contains("healthy"));
            let srv_ok = text.lines().any(|l| l.starts_with("server:") && l.to_lowercase().contains("up"));
            if db_ok && srv_ok {
                println!("==> 服务就绪 ✅");
                return true;
            }
        }
        thread::sleep(Duration::from_secs(5));
    }
    eprintln!("!! 等待超时（120s），请用 `docker compose logs -f server` 排查");
    false
}

// ---------- 主流程 ----------

fn deploy(proj: &Path, args: &Args) -> Result<(), String> {
    // 1. 环境检查
    find_docker()?;

    // 2. 生成/复用 .env
    write_env(proj, args.yes)?;

    // 3. 校验配置
    let env = parse_env(&proj.join(".env"))?;
    validate_env(&env)?;

    let web_port = env.get("WEB_PORT").cloned().unwrap_or_else(|| "8082".into());

    // 4. 启动
    if args.offline {
        println!("==> 离线模式");
        let images_tar = proj.join("images.tar");
        if images_tar.exists() {
            println!("==> 载入离线镜像 images.tar ...");
            if !run_cmd("docker", &["load", "-i", "images.tar"]).map_err(|e| e.to_string())? {
                return Err("docker load 失败".into());
            }
        } else {
            println!("!! 未找到 images.tar（离线包需包含镜像）。若镜像已在 Docker 中，将直接启动。");
        }
        println!("==> 启动服务（docker compose up -d --no-build）...");
        if !run_cmd("docker", &["compose", "up", "-d", "--no-build"]).map_err(|e| e.to_string())? {
            return Err("docker compose up 失败，请用 `docker compose logs -f server` 排查".into());
        }
    } else {
        println!("==> 在线模式：构建并启动（docker compose up -d --build）...");
        if !run_cmd("docker", &["compose", "up", "-d", "--build"]).map_err(|e| e.to_string())? {
            return Err("docker compose up 失败，请用 `docker compose logs -f server` 排查".into());
        }
    }

    // 5. 健康检查
    println!("==> 等待服务健康（最多 120 秒）...");
    if !wait_healthy() {
        return Err("部署未完成（服务未就绪）。请用 `docker compose logs -f server` 排查".into());
    }

    // 6. 输出使用信息
    let admin_email = env.get("ADMIN_EMAIL").cloned().unwrap_or_else(|| "admin@relay.local".into());
    println!();
    println!("===============================================================");
    println!("  部署完成 ✅ 中转站 Plus 已上线");
    println!("===============================================================");
    println!("  访问地址 : http://<服务器IP>:{web_port}/login");
    println!("  管理后台 : http://<服务器IP>:{web_port}/app");
    println!("  管理员   : {admin_email}");
    println!();
    println!("  常用命令:");
    println!("    查看日志 : docker compose logs -f server");
    println!("    重启     : docker compose restart");
    println!("    停止     : docker compose down");
    println!("    升级     : 替换新版本二进制后重新运行本程序");
    println!();
    println!("  HTTPS: 建议前置 Caddy / Nginx / 云负载均衡反代到 {web_port}，勿裸跑公网 HTTP。");
    println!("  首次使用: 登录后进入管理后台，在「设置」中配置上游 API Key 与售价倍率。");
    println!("===============================================================");
    Ok(())
}

/// 部署前校验必备文件（给出清晰缺失清单）
fn validate_required_files(proj: &Path, offline: bool) -> Result<(), String> {
    let compose = proj.join("docker-compose.yml");
    let mut missing: Vec<String> = Vec::new();
    if !compose.exists() {
        missing.push("docker-compose.yml".into());
    }
    if offline {
        if !proj.join("images.tar").exists() {
            missing.push("images.tar（离线模式必需；也可放入 images 后再运行）".into());
        }
    } else {
        // 在线模式需要 server/ web/ 源码（用于 docker compose build）
        if !proj.join("server").join("Dockerfile").exists() {
            missing.push("server/（在线模式源码，用于 docker compose build）".into());
        }
        if !proj.join("web").join("Dockerfile").exists() {
            missing.push("web/（在线模式源码）".into());
        }
    }
    if missing.is_empty() {
        return Ok(());
    }
    let mode = if offline { "离线" } else { "在线" };
    // proj 可能带非 ASCII 路径，先用 display
    Err(format!(
        "{mode}模式缺少必要文件，请将部署器放到完整安装包中运行：\n  \
         当前目录: {}\n  缺失: {}\n\n\
         正确用法（二选一）：\n  \
         a) 在线包：仓库源码套件（含 server/ web/ docker-compose.yml）+ 部署器二进制\n  \
         b) 离线包：部署器二进制 + docker-compose.yml + images.tar，并以 --offline 运行\n",
        proj.display(),
        missing.join("、")
    ))
}

// Windows 双击时可看到结果；出错/完成后等待按键避免窗口闪关
fn pause_for_exit() {
    #[cfg(windows)]
    {
        use std::io::Write;
        println!();
        print!("按任意键退出...");
        let _ = io::stdout().flush();
        let _ = io::stdin().read_line(&mut String::new());
    }
}

fn main() {
    let args = Args::parse();
    if args.help {
        println!(
            r"
中转站 Plus 一键部署部署器 v{APP_VERSION}

用法:
  relay-plus-deployer [选项]

选项:
  --yes        全部使用默认配置 + 自动随机密钥，免交互部署
  --offline    离线模式（载入 images.tar 后用 docker compose up --no-build)
  --reset      忽略已有 .env 重新生成（旧配置备份为 .env.bak）
  -h, --help   显示本帮助

说明:
  - 请将本程序放入完整安装包目录运行：
      · 在线包：仓库源码套件（含 server/ web/ docker-compose.yml）+ 本程序
      · 离线包：本程序 + docker-compose.yml + images.tar，加 --offline
  - 首次运行自动生成唯一配置源 .env 并创建数据库表与管理员账号。
  - 需要本机已安装 Docker（https://docs.docker.com/get-docker/）。
"
        );
        return;
    }

    print_banner();
    let proj = project_dir();
    println!("==> 项目目录: {}", proj.display());

    let result = (|| -> Result<(), String> {
        validate_required_files(&proj, args.offline)?;
        // Docker 环境检查由 deploy() 首步执行
        deploy(&proj, &args)
    })();

    match result {
        Ok(()) => {}
        Err(e) => {
            eprintln!("\n!! {e}");
            pause_for_exit();
            std::process::exit(1);
        }
    }
    // 正常结束也暂停，方便双击查看结果
    pause_for_exit();
}
