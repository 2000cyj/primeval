use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

/// MCP sidecar 的数据目录。
///
/// 必须与 Node 侧 `config.ts` 的路径规则一致：
/// `~/.agent-compose/mcp`（可用 `AGENT_COMPOSE_DATA_DIR` 覆盖）
fn mcp_data_dir(app: &AppHandle) -> PathBuf {
    let home = app
        .path()
        .home_dir()
        .unwrap_or_else(|_| std::env::var("USERPROFILE").map(PathBuf::from).unwrap_or_default());
    home.join(".agent-compose").join("mcp")
}

/// sidecar 入口脚本（仓库内相对路径）。
///
/// `CARGO_MANIFEST_DIR` = `apps/AgentCompose/src-tauri`，
/// sidecar 在 `packages/agent-compose-mcp`。
fn sidecar_script() -> PathBuf {
    // CARGO_MANIFEST_DIR = <仓库>/apps/AgentCompose/src-tauri
    // 到仓库根要上三层：src-tauri -> AgentCompose -> apps -> 仓库根
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .join("packages")
        .join("agent-compose-mcp")
        .join("src")
        .join("index.ts")
}

/// 端口是否有人监听。
fn port_alive(port: u16) -> bool {
    use std::net::{SocketAddr, TcpStream};
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

fn read_trimmed(path: &PathBuf) -> Option<String> {
    std::fs::read_to_string(path)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// sidecar 的地址与令牌。
struct Endpoint {
    base: String,
    token: String,
}

/// 读取 sidecar 的地址与令牌。
///
/// sidecar 独立于 GUI 进程运行，可能尚未启动，因此这里不做探测性请求，
/// 只读取 sidecar 落盘的端口与 token 文件。
fn endpoint(app: &AppHandle) -> Result<Endpoint, String> {
    let dir = mcp_data_dir(app);
    let port = read_trimmed(&dir.join("port"))
        .ok_or("MCP sidecar 未运行：找不到端口文件")?
        .parse::<u16>()
        .map_err(|_| "MCP sidecar 端口文件内容非法".to_string())?;
    let token = read_trimmed(&dir.join("token")).ok_or("MCP sidecar 未运行：找不到令牌文件")?;
    Ok(Endpoint {
        base: format!("http://127.0.0.1:{port}"),
        token,
    })
}

/// 拉起 sidecar（若未运行）。
///
/// 子进程以 detached 方式启动，**不随 GUI 退出而结束** —— agent 可能还在
/// 使用它。发布形态下这里会换成 Tauri sidecar 二进制。
fn spawn_sidecar(app: &AppHandle) -> Result<(), String> {
    let script = sidecar_script();
    if !script.exists() {
        return Err(format!(
            "找不到 sidecar 入口脚本：{}\n\
             开发形态下它应位于 <仓库>/packages/agent-compose-mcp/src/index.ts；\
             发布形态下应改为调用打包后的 sidecar 可执行文件。",
            script.display()
        ));
    }

    // sidecar 的输出落盘：启动失败时 gui 才能看到真实原因，
    // 而不是只报「启动超时」
    let log_path = mcp_data_dir(app).join("sidecar.log");
    let log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("打开 sidecar 日志失败：{e}"))?;
    let log_err = log.try_clone().map_err(|e| e.to_string())?;

    let mut cmd = Command::new("node");
    cmd.arg("--experimental-strip-types");
    // 开发时监听 sidecar 源码：它是独立进程，不重启就还用着旧代码
    if std::env::var("AGENT_COMPOSE_MCP_WATCH").is_ok() {
        if let Some(dir) = script.parent().and_then(Path::parent) {
            cmd.arg("--watch-path").arg(dir);
        }
    }
    cmd.arg(&script)
        .current_dir(
            script
                .parent()
                .and_then(Path::parent)
                .unwrap_or_else(|| Path::new(".")),
        )
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err));

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        cmd.creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS);
    }

    cmd.spawn().map_err(|e| format!("启动 sidecar 失败：{e}"))?;
    let _ = app;
    Ok(())
}

/// 确保 sidecar 在运行并等待就绪。
///
/// 已在运行则直接返回；否则拉起并等待就绪（最多 15 秒）。
///
/// 转发请求失败时会调用它做兜底 —— 只在页面加载时确保一次不够，
/// 用户可能几分钟后才点「搜索」，那时 sidecar 早就退出了。
fn ensure_sidecar_ready(app: &AppHandle) -> Result<(), String> {
    let dir = mcp_data_dir(app);

    // 已在运行：端口文件存在且端口有人监听
    if let Some(port) = read_trimmed(&dir.join("port")).and_then(|s| s.parse::<u16>().ok()) {
        if port_alive(port) {
            return Ok(());
        }
    }

    spawn_sidecar(app)?;

    // 等待就绪
    let deadline = Instant::now() + Duration::from_secs(15);
    while Instant::now() < deadline {
        if let Some(port) = read_trimmed(&dir.join("port")).and_then(|s| s.parse::<u16>().ok()) {
            if port_alive(port) {
                return Ok(());
            }
        }
        std::thread::sleep(Duration::from_millis(250));
    }

    // 超时：把 sidecar 日志尾部带出来，便于判断是启动失败还是端口问题
    let log = std::fs::read_to_string(dir.join("sidecar.log")).unwrap_or_default();
    let tail: Vec<&str> = log.lines().rev().take(5).collect();
    let detail = if tail.is_empty() {
        String::new()
    } else {
        format!("，日志尾部：{}", tail.join(" / "))
    };
    Err(format!("MCP sidecar 启动超时（15 秒）{detail}"))
}

/// 确保 sidecar 在运行，返回其端口与令牌。
#[tauri::command]
fn mcp_ensure_sidecar(app: AppHandle) -> Result<Value, String> {
    let dir = mcp_data_dir(&app);

    // 已在运行：端口文件存在且端口有人监听
    if let Some(port) = read_trimmed(&dir.join("port")).and_then(|s| s.parse::<u16>().ok()) {
        if port_alive(port) {
            let token = read_trimmed(&dir.join("token")).unwrap_or_default();
            return Ok(json!({
                "endpoint": format!("http://127.0.0.1:{port}"),
                "token": token,
                "port": port,
                "running": true,
                "started": false,
            }));
        }
    }

    ensure_sidecar_ready(&app)?;

    let port = read_trimmed(&dir.join("port"))
        .and_then(|s| s.parse::<u16>().ok())
        .ok_or("MCP sidecar 端口文件内容非法")?;
    let token = read_trimmed(&dir.join("token")).unwrap_or_default();
    Ok(json!({
        "endpoint": format!("http://127.0.0.1:{port}"),
        "token": token,
        "port": port,
        "running": true,
        "started": true,
    }))
}

/// 转发一次 admin API 调用到 sidecar。
///
/// sidecar 不可用时（没启动或中途退出）会先尝试拉起再重试一次：
/// 只在页面加载时确保一次是不够的 —— 用户可能在几分钟后才点「搜索」，
/// 那时 sidecar 早就退出了。
async fn admin_request(
    app: &AppHandle,
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    let ep = endpoint(&app)?;
    // 加超时：sidecar 不可达时不要无界等待
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("{}{}", ep.base, path);

    let mut req = client.request(method.clone(), &url).bearer_auth(&ep.token);
    if let Some(payload) = body.clone() {
        req = req.json(&payload);
    }

    let resp = match req.send().await {
        Ok(resp) => resp,
        Err(first) => {
            // 连不上：拉起 sidecar 后重试一次
            ensure_sidecar_ready(app)?;
            let ep = endpoint(&app)?;
            let url = format!("{}{}", ep.base, path);
            let mut retry = client.request(method, &url).bearer_auth(&ep.token);
            if let Some(payload) = body {
                retry = retry.json(&payload);
            }
            retry.send().await.map_err(|e| {
                format!("连接 MCP sidecar 失败：{e}（已尝试重新拉起 sidecar）")
            })?
        }
    };
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        let hint = if status == reqwest::StatusCode::UNAUTHORIZED {
            "令牌与正在运行的 sidecar 不匹配，请重启 sidecar"
        } else {
            "sidecar 返回错误"
        };
        return Err(format!("{hint}（{}）：{}", status.as_u16(), text));
    }
    if text.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(&text).map_err(|e| format!("sidecar 响应解析失败：{e}"))
}

/// 上游 MCP server 列表
#[tauri::command]
async fn mcp_list_servers(app: AppHandle) -> Result<Value, String> {
    let payload = admin_request(&app, reqwest::Method::GET, "/admin/servers", None).await?;
    Ok(payload
        .get("servers")
        .cloned()
        .unwrap_or_else(|| Value::Array(Vec::new())))
}

/// 全量保存上游 MCP server 列表
#[tauri::command]
async fn mcp_save_servers(app: AppHandle, servers: Value) -> Result<(), String> {
    admin_request(&app, reqwest::Method::PUT, "/admin/servers", Some(json!({ "servers": servers })))
        .await
        .map(|_| ())
}

/// 删除单个上游 MCP server
#[tauri::command]
async fn mcp_remove_server(app: AppHandle, id: String) -> Result<(), String> {
    admin_request(&app, reqwest::Method::DELETE, &format!("/admin/servers/{id}"), None)
        .await
        .map(|_| ())
}

/// 测试单个 server 的连接，返回其最新状态
#[tauri::command]
async fn mcp_test_server(app: AppHandle, id: String) -> Result<Value, String> {
    admin_request(&app, reqwest::Method::POST, &format!("/admin/servers/{id}/test"), None).await
}

/// 读取对外暴露配置
#[tauri::command]
async fn mcp_get_exposure(app: AppHandle) -> Result<Value, String> {
    admin_request(&app, reqwest::Method::GET, "/admin/exposure", None).await
}

/// 保存对外暴露配置
#[tauri::command]
async fn mcp_set_exposure(app: AppHandle, exposure: Value) -> Result<(), String> {
    admin_request(&app, reqwest::Method::PUT, "/admin/exposure", Some(json!({ "exposure": exposure })))
        .await
        .map(|_| ())
}

/// 读取命名组合（profile）列表
#[tauri::command]
async fn mcp_list_profiles(app: AppHandle) -> Result<Value, String> {
    admin_request(&app, reqwest::Method::GET, "/admin/profiles", None).await
}

/// 保存命名组合（profile）列表
#[tauri::command]
async fn mcp_save_profiles(app: AppHandle, profiles: Value) -> Result<(), String> {
    admin_request(&app, reqwest::Method::PUT, "/admin/profiles", Some(json!({ "profiles": profiles })))
        .await
        .map(|_| ())
}

/// 读取运行时总状态
#[tauri::command]
async fn mcp_get_status(app: AppHandle) -> Result<Value, String> {
    admin_request(&app, reqwest::Method::GET, "/admin/status", None).await
}

/// 为一个远程上游发起 oauth 授权，返回需要用户打开的授权地址。
#[tauri::command]
async fn mcp_authorize_server(app: AppHandle, id: String) -> Result<Value, String> {
    let ep = endpoint(&app)?;
    // 加超时：sidecar 不可达时不要无界等待
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("{}/admin/servers/{}/authorize", ep.base, encode_component(&id));

    let resp = client
        .post(&url)
        .bearer_auth(&ep.token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("发起授权失败（{}）：{}", status.as_u16(), text));
    }
    serde_json::from_str(&text).map_err(|e| format!("授权响应解析失败：{e}"))
}

/// 用系统默认浏览器打开一个网址。
///
/// 授权流程需要用户在浏览器里人工登录与同意；桌面端不能直接弹浏览器，
/// 交给系统默认浏览器最可靠。
#[tauri::command]
fn mcp_open_url(url: String) -> Result<(), String> {
    // 只允许 http/https，避免被用来打开本地文件或执行任意程序
    let parsed = url::Url::parse(&url).map_err(|e| format!("网址不合法：{e}"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("只允许打开 http/https 网址".to_string());
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        let mut cmd = Command::new("cmd");
        cmd.arg("/c")
            .arg("start")
            .arg("")
            .arg(&url)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(DETACHED_PROCESS);
        cmd.spawn().map_err(|e| format!("打开浏览器失败：{e}"))?;
    }

    #[cfg(not(windows))]
    {
        Command::new("xdg-open")
            .arg(&url)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("打开浏览器失败：{e}"))?;
    }

    Ok(())
}

/// 在官方目录里搜索第三方 mcp server。
///
/// 参数：query 关键词（空串表示浏览全部）、cursor 分页游标（可选）。
#[tauri::command]
async fn mcp_search_registry(
    app: AppHandle,
    query: String,
    cursor: Option<String>,
) -> Result<Value, String> {
    let ep = endpoint(&app)?;
    // 加超时：sidecar 不可达时不要无界等待
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let mut url = format!("{}/admin/registry/search", ep.base);
    {
        // 手工拼 query，避免额外引入 url 构造依赖
        let mut parts = vec![format!("query={}", encode_component(&query))];
        if let Some(c) = cursor.filter(|c| !c.is_empty()) {
            parts.push(format!("cursor={}", encode_component(&c)));
        }
        url.push('?');
        url.push_str(&parts.join("&"));
    }

    let resp = client
        .get(&url)
        .bearer_auth(&ep.token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("目录服务返回 {}：{}", status.as_u16(), text));
    }
    serde_json::from_str(&text).map_err(|e| format!("目录响应解析失败：{e}"))
}

/// 极简 query 编码（仅需处理空格与少数保留字符）。
fn encode_component(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => out.push(ch),
            ' ' => out.push_str("%20"),
            _ => {
                let mut buf = [0u8; 4];
                for byte in ch.encode_utf8(&mut buf).as_bytes() {
                    out.push_str(&format!("%{byte:02X}"));
                }
            }
        }
    }
    out
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            mcp_ensure_sidecar,
            mcp_search_registry,
            mcp_authorize_server,
            mcp_open_url,
            mcp_list_servers,
            mcp_save_servers,
            mcp_remove_server,
            mcp_test_server,
            mcp_get_exposure,
            mcp_set_exposure,
            mcp_list_profiles,
            mcp_save_profiles,
            mcp_get_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AgentCompose");
}
