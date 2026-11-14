use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

pub(crate) mod agents;
mod agent_store;
mod extensions;
mod github;
mod history;
mod paths;
mod backup;
mod proxy;
mod skills;
mod updater;

/// MCP sidecar 的数据目录。
///
/// 必须与 Node 侧 `config.ts` 的路径规则一致：
/// `~/.agent-compose/mcp`（可用 `AGENT_COMPOSE_DATA_DIR` 覆盖）
fn mcp_data_dir(app: &AppHandle) -> PathBuf {
    home_dir(app).join(".agent-compose").join("mcp")
}

/// 用户主目录。
fn home_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .home_dir()
        .unwrap_or_else(|_| std::env::var("USERPROFILE").map(PathBuf::from).unwrap_or_default())
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

/// sidecar 落盘的运行信息文件名
const RUNTIME_FILE: &str = "sidecar.json";

/// 固定的访问令牌（与 sidecar 侧的 `FIXED_TOKEN` 保持一致）。
const FIXED_TOKEN: &str = "AgentSpace";

/// 运行中的 sidecar 信息
struct SidecarRuntime {
    pid: u32,
    source_stamp: u64,
}

/// 读取运行中的 sidecar 信息。
fn read_sidecar_runtime(app: &AppHandle) -> Option<SidecarRuntime> {
    let raw = std::fs::read_to_string(mcp_data_dir(app).join(RUNTIME_FILE)).ok()?;
    let value: Value = serde_json::from_str(&raw).ok()?;
    let pid = value.get("pid")?.as_u64()? as u32;
    let source_stamp = value.get("sourceStamp")?.as_u64().unwrap_or(0);
    Some(SidecarRuntime { pid, source_stamp })
}

/// 当前 sidecar 源码的最新修改时间（毫秒）。
///
/// 与 sidecar 落盘的指纹比较，不一致说明代码改过，运行中的实例是旧的。
fn current_source_stamp() -> u64 {
    let src = sidecar_script()
        .parent()
        .map(|p| p.to_path_buf());
    let Some(src) = src else { return 0 };
    let mut latest = 0u64;
    let Ok(entries) = std::fs::read_dir(&src) else { return 0 };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("ts") {
            continue;
        }
        if let Ok(meta) = entry.metadata() {
            if let Ok(modified) = meta.modified() {
                if let Ok(ms) = modified.duration_since(std::time::UNIX_EPOCH) {
                    let stamp = ms.as_millis() as u64;
                    if stamp > latest {
                        latest = stamp;
                    }
                }
            }
        }
    }
    latest
}

/// 进程是否还活着。
fn process_alive(pid: u32) -> bool {
    #[cfg(windows)]
    {
        let mut cmd = agentspace_core::proc::command("tasklist");
        cmd.arg("/FI")
            .arg(format!("PID eq {pid}"))
            .arg("/NH")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let output = cmd.output();
        match output {
            Ok(out) => {
                let text = String::from_utf8_lossy(&out.stdout);
                text.contains(&pid.to_string())
            }
            Err(_) => false,
        }
    }
    #[cfg(not(windows))]
    {
        Path::new(&format!("/proc/{pid}")).exists()
    }
}

/// 结束一个进程。
fn kill_process(pid: u32) {
    #[cfg(windows)]
    {
        let _ = agentspace_core::proc::command("taskkill")
            .arg("/PID")
            .arg(pid.to_string())
            .arg("/F")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = agentspace_core::proc::command("kill")
            .arg("-9")
            .arg(pid.to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

/// 打包好的 sidecar 可执行文件。
///
/// 发布形态下随 gui 一起分发；开发形态下可能还没构建。
/// 打包好的 sidecar 可执行文件。
///
/// 发布形态下它在资源目录里；开发形态下在仓库的 `src-tauri/bin/`。
/// 两个都找 —— 发布形态的路径在编译期是猜不出来的（编译机上才有）。
fn sidecar_binary(app: &AppHandle) -> Option<PathBuf> {
    let exe_name = if cfg!(windows) {
        "agent-compose-mcp.exe"
    } else {
        "agent-compose-mcp"
    };
    if let Ok(dir) = app.path().resource_dir() {
        let candidate = dir.join("bin").join(exe_name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    let dev = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("bin")
        .join(exe_name);
    if dev.is_file() {
        return Some(dev);
    }
    // 桌面端装出来的（CLI 也找这里）
    let installed = home_dir(app).join(".agent-compose").join("bin").join(exe_name);
    if installed.is_file() {
        return Some(installed);
    }
    None
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
    // 优先用打包好的 sidecar 可执行文件（发布形态），
    // 没有则回落到 node + ts 源码（开发形态）
    let binary = sidecar_binary(app);
    let script = sidecar_script();
    if binary.is_none() && !script.exists() {
        return Err(format!(
            "找不到 sidecar：既没有可执行文件，也没有入口脚本 {}",
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

    let mut cmd = if script.exists() {
        // 开发形态：跑仓库里的源码。
        // 源码优先于打包好的二进制 —— 二进制是构建时的快照，改了源码它不会变，
        // 跑起来还是旧逻辑（token、接口都可能对不上）。
        let mut cmd = agentspace_core::proc::command("node");
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
            );
        cmd
    } else {
        // 发布形态：只有打包好的可执行文件
        let binary = binary.expect("上面已经确认过它存在");
        let mut cmd = agentspace_core::proc::command(&binary);
        cmd.current_dir(binary.parent().unwrap_or_else(|| Path::new(".")));
        cmd
    };
    cmd.stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err));

    // 让 sidecar 的出站请求（目录搜索、OAuth）也走全局代理。
    // Node 24 起 fetch 默认不读环境代理，NODE_USE_ENV_PROXY=1 让它读；
    // Bun 本身就读 HTTP_PROXY / HTTPS_PROXY。
    cmd.env("NODE_USE_ENV_PROXY", "1");
    if let Some(proxy) = agentspace_core::proxy::resolve(&paths::of(&app)).url {
        cmd.env("HTTP_PROXY", &proxy);
        cmd.env("HTTPS_PROXY", &proxy);
        cmd.env("ALL_PROXY", &proxy);
        cmd.env("http_proxy", &proxy);
        cmd.env("https_proxy", &proxy);
        cmd.env("all_proxy", &proxy);
        // 本机上跑的 MCP server 不能走代理。
        cmd.env("NO_PROXY", "localhost,127.0.0.1,::1");
        cmd.env("no_proxy", "localhost,127.0.0.1,::1");
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        cmd.creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS);
    }

    cmd.spawn().map_err(|e| format!("启动 sidecar 失败：{e}"))?;
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
            // 源码改过就重启：sidecar 是独立进程，不重启还在用旧逻辑
            let stale = match read_sidecar_runtime(app) {
                Some(info) => {
                    info.source_stamp != current_source_stamp()
                        && info.source_stamp != 0
                        && current_source_stamp() != 0
                }
                None => false,
            };
            if !stale {
                return Ok(());
            }
            if let Some(info) = read_sidecar_runtime(app) {
                if process_alive(info.pid) {
                    kill_process(info.pid);
                }
            }
            // 等旧进程退出，端口释放
            for _ in 0..20 {
                if !port_alive(port) {
                    break;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            // 端口文件已失效，清掉避免下次误判
            let _ = std::fs::remove_file(dir.join("port"));
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

/// 停掉正在运行的 sidecar。
///
/// 改了全局代理后要重启它 —— 代理是以环境变量的形式传进去的，
/// 只在进程启动时生效。下次要 sidecar 时 `ensure_sidecar_ready` 会重新拉起。
pub(crate) fn stop_sidecar(app: &AppHandle) {
    if let Some(info) = read_sidecar_runtime(app) {
        if process_alive(info.pid) {
            kill_process(info.pid);
        }
    }
    let dir = mcp_data_dir(app);
    let _ = std::fs::remove_file(dir.join("port"));
    let _ = std::fs::remove_file(dir.join("token"));
}

/// 确保 sidecar 在运行，返回其端口与令牌。
#[tauri::command]
fn mcp_ensure_sidecar(app: AppHandle) -> Result<Value, String> {
    let dir = mcp_data_dir(&app);

    // 已在运行且代码没变：直接返回
    if let Some(port) = read_trimmed(&dir.join("port")).and_then(|s| s.parse::<u16>().ok()) {
        if port_alive(port) {
            let fresh = match read_sidecar_runtime(&app) {
                Some(info) => {
                    info.source_stamp == current_source_stamp() || current_source_stamp() == 0
                }
                None => true,
            };
            if fresh {
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
    // sidecar 在本机：明确直连，别被系统 / 全局代理拦一道。
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("{}{}", ep.base, path);

    let mut req = client.request(method.clone(), &url).bearer_auth(&ep.token);
    if let Some(payload) = body.clone() {
        req = req.json(&payload);
    }

    let resp = match req.send().await {
        Ok(resp) => resp,
        Err(_first) => {
            // 连不上：拉起 sidecar 后重试一次
            ensure_sidecar_ready(app)?;
            let ep = endpoint(&app)?;
            let url = format!("{}{}", ep.base, path);
            let mut retry = client.request(method.clone(), &url).bearer_auth(&ep.token);
            if let Some(payload) = body.clone() {
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
        // 401：令牌与正在跑的 sidecar 对不上（换过令牌、sidecar 重启过、
        // 或者令牌文件被别的手工改过）。
        // 自愈：重启 sidecar —— 新实例会写一份与它自己一致的令牌文件，然后重试。
        if status == reqwest::StatusCode::UNAUTHORIZED {
            stop_sidecar(app);
            ensure_sidecar_ready(app)?;
            let ep = endpoint(app)?;
            let url = format!("{}{}", ep.base, path);
            let mut retry = client.request(method, &url).bearer_auth(&ep.token);
            if let Some(payload) = body.clone() {
                retry = retry.json(&payload);
            }
            let resp = retry.send().await.map_err(|e| {
                format!("连接 MCP sidecar 失败：{e}（已尝试重新拉起 sidecar）")
            })?;
            let status = resp.status();
            let text = resp.text().await.map_err(|e| e.to_string())?;
            if status.is_success() {
                return if text.trim().is_empty() {
                    Ok(Value::Null)
                } else {
                    serde_json::from_str(&text).map_err(|e| format!("sidecar 响应解析失败：{e}"))
                };
            }
            return Err(format!(
                "sidecar 返回错误（{}）：{}（已重启 sidecar，仍失败）",
                status.as_u16(),
                text
            ));
        }
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
    // 先拿旧列表：被删掉的 server 也要算进「绑了它的智能体版本 +1」，
    // 否则智能体还绑着一个已经不存在的 server，版本却没动。
    let previous: Vec<String> = mcp_list_servers(app.clone())
        .await
        .ok()
        .and_then(|value| {
            value
                .as_array()
                .map(|list| {
                    list.iter()
                        .filter_map(|item| item.get("id").and_then(|id| id.as_str()))
                        .map(|id| id.to_string())
                        .collect()
                })
        })
        .unwrap_or_default();

    admin_request(&app, reqwest::Method::PUT, "/admin/servers", Some(json!({ "servers": servers })))
        .await
        .map(|_| ())?;
    // server 定义变了 → 绑了它们的智能体版本 +1（启动脚本据此提示覆盖）
    let mut ids: Vec<String> = servers
        .get("servers")
        .and_then(|value| value.as_array())
        .map(|list| {
            list.iter()
                .filter_map(|item| item.get("id").and_then(|id| id.as_str()))
                .map(|id| id.to_string())
                .collect()
        })
        .unwrap_or_default();
    // 补上「这次被删掉的」—— 少了它们，绑着它们的智能体看不出自己过期了
    let removed: Vec<String> = previous.into_iter().filter(|id| !ids.contains(id)).collect();
    ids.extend(removed);
    agent_store::bump_versions(&app, &[], &ids);
    Ok(())
}

/// 删除单个上游 MCP server
#[tauri::command]
async fn mcp_remove_server(app: AppHandle, id: String) -> Result<(), String> {
    admin_request(&app, reqwest::Method::DELETE, &format!("/admin/servers/{id}"), None)
        .await
        .map(|_| ())?;
    // 少了一个 server → 绑了它的智能体版本 +1
    agent_store::bump_versions(&app, &[], &[id]);
    Ok(())
}

/// 测试单个 server 的连接，返回其最新状态
#[tauri::command]
async fn mcp_test_server(app: AppHandle, id: String) -> Result<Value, String> {
    admin_request(&app, reqwest::Method::POST, &format!("/admin/servers/{id}/test"), None).await
}

/// 让代理把所有启用的上游都连一遍。
///
/// 上游默认惰性连接：页面刚打开时全是「未连接」。
/// 界面调它来主动建连 —— 连上的工具清单会落盘，下次不用重连。
#[tauri::command]
async fn mcp_connect_servers(app: AppHandle) -> Result<(), String> {
    admin_request(&app, reqwest::Method::POST, "/admin/servers/connect", None)
        .await
        .map(|_| ())
}

/// 测一个**还没保存**的上游定义。
///
/// 「新增/编辑 MCP server」弹窗里的「测试」按钮用它 —— 用户填完就想知道
/// 能不能连上，那时定义还没存进 servers.json。
#[tauri::command]
async fn mcp_probe_server_def(app: AppHandle, server: Value) -> Result<Value, String> {
    admin_request(
        &app,
        reqwest::Method::POST,
        "/admin/servers/probe",
        Some(json!({ "server": server })),
    )
    .await
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

/// 刷新访问令牌：让运行中的 sidecar 立刻用上当前的 token。
///
/// token 固定用产品名（AgentSpace）—— 接入地址要粘到各个 agent 的配置里，
/// 固定值好记、好核对。这个接口的作用是「sidecar 重启过 / token 文件被改过」
/// 时把它拉回一致。
#[tauri::command]
async fn mcp_refresh_token(app: AppHandle) -> Result<Value, String> {
    admin_request(
        &app,
        reqwest::Method::POST,
        "/admin/token",
        Some(json!({ "token": FIXED_TOKEN })),
    )
    .await
}

/// 为一个远程上游发起 oauth 授权，返回需要用户打开的授权地址。
#[tauri::command]
async fn mcp_authorize_server(app: AppHandle, id: String) -> Result<Value, String> {
    let ep = endpoint(&app)?;
    // 加超时：sidecar 不可达时不要无界等待
    // sidecar 在本机：明确直连，别被系统 / 全局代理拦一道。
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .no_proxy()
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
        // 用 rundll32 而不是 `cmd /c start`。
        //
        // 授权地址带一长串查询参数（?response_type=code&client_id=...&code_challenge=...），
        // 而 cmd 把 `&` 当命令分隔符：`cmd /c start "" <url>` 会把 URL 从第一个
        // `&` 处截断，后半截被当成另一条命令去执行 —— 浏览器只拿到
        // `?response_type=code`，少了 client_id，授权服务器直接报
        // 「Parameter client_id is required」。
        //
        // rundll32 直接 spawn（不经 cmd），Rust 会按 MSVC 规则给参数加引号，
        // 整个 URL 原样交给系统。
        let mut cmd = agentspace_core::proc::command("rundll32");
        cmd.arg("url.dll,FileProtocolHandler")
            .arg(&url)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(DETACHED_PROCESS);
        cmd.spawn().map_err(|e| format!("打开浏览器失败：{e}"))?;
    }

    #[cfg(not(windows))]
    {
        agentspace_core::proc::command("xdg-open")
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
    // sidecar 在本机：明确直连，别被系统 / 全局代理拦一道。
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .no_proxy()
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

/// 把 `agentspace` 命令装到终端能直接敲的地方。
///
/// `agentspace` 命令行的安装状态。
///
/// 桌面端启动时会把命令装到一个 PATH 上的目录里。
/// 这里告诉界面：装没装、装在哪 —— 用户在终端敲不到命令时要能查。
#[tauri::command]
fn cli_status(app: AppHandle) -> Value {
    let home = app.path().home_dir().ok();
    let exe_name = if cfg!(windows) { "agentspace.exe" } else { "agentspace" };
    // 跟 install_cli 用同一套候选目录，别一个装这儿一个查那儿
    let mut candidates: Vec<PathBuf> = vec![home.clone().unwrap_or_default().join(".local").join("bin")];
    #[cfg(windows)]
    {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            candidates.push(PathBuf::from(appdata).join("npm"));
        }
    }
    if let Some(home) = home {
        candidates.push(home.join(".agent-compose").join("bin"));
    }
    let found = candidates
        .iter()
        .map(|dir| dir.join(exe_name))
        .find(|path| path.is_file());
    json!({
        "installed": found.is_some(),
        "path": found.map(|path| path.to_string_lossy().to_string()),
        "command": "agentspace",
    })
}

/// 把 `agentspace` 命令装到终端能直接敲的地方。
///
/// 做法：把可执行文件装到一个**已经在 PATH 上**的目录（优先 `~/.local/bin`）——
/// 这样用户当前开着的终端立刻就能敲，不用重开、不用改注册表。
/// 实在找不到 PATH 上的目录，才装到 `~/.agent-compose/bin/` 并写用户级 PATH。
///
/// 幂等：已装的比新构建新就不动它。
fn install_cli(app: &AppHandle) -> Option<PathBuf> {
    let source = app
        .path()
        .resource_dir()
        .ok()
        .map(|dir| dir.join("bin").join(if cfg!(windows) { "agentspace.exe" } else { "agentspace" }))?;
    if !source.is_file() {
        return None;
    }

    let home = app.path().home_dir().ok()?;
    let exe_name = if cfg!(windows) { "agentspace.exe" } else { "agentspace" };

    // 装到哪个目录？优先挑一个**已经在 PATH 上**的 ——
    // 那样用户当前开着的终端立刻就能敲，不用重开。
    //
    // 候选按顺序试：
    // 1. `~/.local/bin` —— 用户级 bin 的标准位置，多数开发机都在 PATH 上
    // 2. `%APPDATA%\npm` —— node 的全局 bin（装过 npm 全局包才有）
    // 3. `~/.agent-compose/bin` —— 我们自己的目录，不在 PATH 上就写注册表
    let mut candidates: Vec<PathBuf> = vec![home.join(".local").join("bin")];
    #[cfg(windows)]
    {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            candidates.push(PathBuf::from(appdata).join("npm"));
        }
    }
    candidates.push(home.join(".agent-compose").join("bin"));

    let current_path = std::env::var("PATH").unwrap_or_default();
    let on_path = |dir: &Path| {
        current_path
            .split(if cfg!(windows) { ';' } else { ':' })
            .any(|item| path_mentions(item, &dir.to_string_lossy()))
    };

    // 已经在 PATH 上的候选优先；实在没有才用自己的目录
    let install_dir = candidates
        .iter()
        .find(|dir| dir.is_dir() && on_path(dir))
        .cloned()
        .unwrap_or_else(|| candidates.last().expect("候选列表不为空").clone());

    std::fs::create_dir_all(&install_dir).ok()?;
    let target = install_dir.join(exe_name);

    // 已装的那份比新构建旧 → 覆盖
    let needs_copy = match (
        std::fs::metadata(&source).and_then(|meta| meta.modified()),
        std::fs::metadata(&target).and_then(|meta| meta.modified()),
    ) {
        (Ok(newer), Ok(installed)) => newer > installed,
        _ => true,
    };
    if needs_copy && std::fs::copy(&source, &target).is_err() {
        return None;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755));
    }

    // 装的目录不在 PATH 上 → 写进用户级 PATH（只对以后开的终端生效）
    if !on_path(&install_dir) {
        add_to_user_path(&install_dir);
    }
    Some(target)
}

/// PATH 的文本里是不是已经有这个目录了。
///
/// 注册表导出一行形如 `    Path    REG_EXPAND_SZ    <目录;目录;...>`，
/// 目录用分号隔开。
fn path_mentions(text: &str, dir: &str) -> bool {
    let normalize = |raw: &str| {
        raw.trim()
            .trim_start_matches('%')
            .replace('/', std::path::MAIN_SEPARATOR_STR)
            .trim_end_matches(std::path::MAIN_SEPARATOR_STR)
            .to_lowercase()
    };
    let needle = normalize(dir);
    // Windows 的 PATH 用 `;` 分隔，Unix 用 `:` ——
    // 不能一刀切切 `:`：Windows 路径本身就带冒号（`C:\...`）。
    let separator = if cfg!(windows) { ';' } else { ':' };
    text.split(separator).any(|item| normalize(item) == needle)
}

/// 从 `reg query` 的输出里取出 Path 的值。
fn read_path_value(reg_output: &str) -> String {
    for line in reg_output.lines() {
        let trimmed = line.trim_start();
        if !trimmed.starts_with("Path") {
            continue;
        }
        // `Path` 和类型名各占一段，剩下的才是值
        let mut parts = trimmed.splitn(3, char::is_whitespace);
        parts.next(); // Path
        parts.next(); // REG_EXPAND_SZ
        return parts.next().unwrap_or("").trim().to_string();
    }
    String::new()
}

/// 把目录加进用户级 PATH（Windows 走注册表，其它走 shell 配置文件）。
///
/// 已经在 PATH 里就不动 —— 每次启动都改一遍注册表没意义。
fn add_to_user_path(dir: &Path) {
    let dir_text = dir.to_string_lossy().to_string();

    #[cfg(windows)]
    {
        // 读 HKCU\Environment 的 Path 整条值。
        // 不用 `reg query ... /v Path`：带斜杠的参数在某些 shell 里会被当成路径改写。
        let output = agentspace_core::proc::command("reg").args(["query", r"HKCU\Environment"]).output();
        let existing = output
            .ok()
            .map(|out| String::from_utf8_lossy(&out.stdout).into_owned())
            .map(|text| read_path_value(&text))
            .unwrap_or_default();

        if path_mentions(&existing, &dir_text) {
            return;
        }

        // 保留原来的全部内容，只在尾部追加
        let updated = if existing.trim().is_empty() {
            dir_text.clone()
        } else {
            format!("{};{}", existing.trim_end_matches(';'), dir_text)
        };
        let _ = agentspace_core::proc::command("reg")
            .args([
                "add",
                r"HKCU\Environment",
                "/v",
                "Path",
                "/t",
                "REG_EXPAND_SZ",
                "/f",
                "/d",
                &updated,
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }

    #[cfg(not(windows))]
    {
        let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
            return;
        };
        let profile = home.join(".profile");
        let marker = format!("# agentspace ({dir_text})");
        if let Ok(text) = std::fs::read_to_string(&profile) {
            if text.contains(&marker) {
                return;
            }
        }
        let line = format!("\n{marker}\nexport PATH=\"{dir_text}:$PATH\"\n");
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&profile)
        {
            use std::io::Write;
            let _ = file.write_all(line.as_bytes());
        }
    }
}

/// 把 sidecar 也装一份到 `~/.agent-compose/bin/`。
///
/// 为什么：CLI（`agentspace`）装在 PATH 上的目录，而 sidecar 跟着应用走。
/// CLI 找 sidecar 时会看这个目录 —— 没有它的话，
/// 终端里跑 `agentspace run` 就拉不起 MCP 代理。
fn install_sidecar(app: &AppHandle) {
    let Some(source) = sidecar_binary(app) else {
        return;
    };
    let target_dir = home_dir(app).join(".agent-compose").join("bin");
    if std::fs::create_dir_all(&target_dir).is_err() {
        return;
    }
    let target = target_dir.join(source.file_name().unwrap_or_default());
    let needs_copy = match (
        std::fs::metadata(&source).and_then(|meta| meta.modified()),
        std::fs::metadata(&target).and_then(|meta| meta.modified()),
    ) {
        (Ok(newer), Ok(installed)) => newer > installed,
        _ => true,
    };
    if needs_copy {
        let _ = std::fs::copy(&source, &target);
    }
}

/// 当前平台是不是「应用内标题栏」。
///
/// Windows 上我们在 setup 里关掉了系统标题栏，前端据此画最小化/最大化/关闭。
/// macOS / Linux 保留系统标题栏，前端就不要画窗口按钮。
#[tauri::command]
fn custom_titlebar() -> bool {
    cfg!(target_os = "windows")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // 命令行：装一次，终端里就能直接敲 agentspace
            install_cli(app.handle());
            // sidecar 也装一份：CLI 靠它拉起 MCP 代理
            install_sidecar(app.handle());
            // Windows：关掉系统标题栏，改由应用自己画标题栏。
            // 不这么做的话，窗口上会出现「系统标题栏 + 应用顶栏」两层，
            // 应用名重复一次，两边高度/颜色也对不齐（cc-switch 也是这么干的）。
            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_decorations(false);
            }
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        // 应用内更新：官方 updater 插件。下载、验签、安装都在应用内完成，
        // 不再把用户丢到浏览器去自己点链接下载。
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            cli_status,
            agents::agents_scan,
            agents::agents_installations,
            agents::agents_check_updates,
            agents::agents_package_plan,
            agents::agents_package_versions,
            agents::agents_upgrade,
            agents::agents_install,
            agents::agents_uninstall,
            skills::skills_list,
            skills::skills_git_repos,
            skills::skills_create_manual,
            skills::skills_import_url,
            skills::skills_import_local,
            skills::skills_list_runtime,
            skills::skills_import_runtime,
            skills::skills_remove,
            skills::skills_set_enabled,
            skills::skills_read,
            skills::skills_update,
            skills::skills_duplicate,
            skills::skills_refresh,
            skills::skills_pick_source,
            github::skills_parse_repo_url,
            github::skills_repo_branches,
            github::skills_repo_discover,
            github::skills_repo_import,
            extensions::extensions_list,
            extensions::extensions_read,
            extensions::extensions_set_enabled,
            extensions::extensions_remove,
            extensions::extensions_save,
            extensions::extensions_template,
            extensions::extensions_market_search,
            extensions::extensions_install_npm,
            extensions::extensions_remove_library,
            mcp_ensure_sidecar,
            mcp_search_registry,
            mcp_authorize_server,
            mcp_open_url,
            mcp_list_servers,
            mcp_save_servers,
            mcp_remove_server,
            mcp_test_server,
            mcp_probe_server_def,
            mcp_connect_servers,
            mcp_get_exposure,
            mcp_set_exposure,
            mcp_list_profiles,
            mcp_save_profiles,
            mcp_get_status,
            mcp_refresh_token,
            proxy::proxy_get,
            proxy::proxy_set,
            proxy::proxy_test,
            proxy::proxy_scan,
            agent_store::created_agents_list,
            agent_store::created_agents_save,
            agent_store::created_agents_delete,
            history::cli_op_history_load,
            history::cli_op_history_upsert,
            history::cli_op_history_remove,
            history::cli_op_history_clear,
            updater::check_app_update,
            updater::install_update_and_restart,
            backup::backup_inventory,
            backup::backup_export,
            backup::backup_inspect,
            backup::backup_import,
            backup::backup_import_status,
            backup::backup_pick_import_zip,
            custom_titlebar,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AgentSpace");
}

#[cfg(test)]
mod cli_tests {
    use super::*;

    #[test]
    fn path_mentions_finds_existing_dir() {
        let text = r"Path    REG_EXPAND_SZ    C:\Users\me\AppData\Local\Programs;C:\Users\me\.agent-compose\bin";
        assert!(path_mentions(text, r"C:\Users\me\.agent-compose\bin"));
        assert!(!path_mentions(text, r"C:\other\bin"));
    }

    #[test]
    fn path_mentions_ignores_case_and_trailing_separator() {
        let text = r"C:\Users\me\.agent-compose\bin;C:\Windows";
        assert!(path_mentions(text, r"c:\users\ME\.agent-compose\bin\"));
    }

    #[test]
    fn read_path_value_picks_the_path_line() {
        let output = r"HKEY_CURRENT_USER\Environment
    NVM_HOME    REG_EXPAND_SZ    D:\nvm
    Path    REG_EXPAND_SZ    C:\a;C:\b
    TEMP    REG_EXPAND_SZ    %TEMP%";
        assert_eq!(read_path_value(output), r"C:\a;C:\b");
    }

    #[test]
    fn read_path_value_returns_empty_when_absent() {
        let output = r"HKEY_CURRENT_USER\Environment
    NVM_HOME    REG_EXPAND_SZ    D:\nvm";
        assert_eq!(read_path_value(output), "");
    }
}
