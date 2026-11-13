//! 跟 MCP 代理（sidecar）打交道：读端口/令牌，必要时把它拉起来。
//!
//! 代理是独立进程，落盘在 `~/.agent-compose/mcp/`：
//! - `port`：监听端口
//! - `token`：Bearer 令牌（固定 `AgentSpace`）
//! - `sidecar.json`：pid 与源码指纹

use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use crate::paths::mcp_runtime_dir;

/// 固定的访问令牌（与桌面端、代理侧一致）。
pub const FIXED_TOKEN: &str = "AgentSpace";

/// 代理的地址信息。
#[derive(Clone, Debug)]
pub struct Endpoint {
    pub port: u16,
    pub token: String,
}

impl Endpoint {
    /// 基础地址（不带路径）
    pub fn base(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }
}

/// 端口上有人监听吗？
fn port_alive(port: u16) -> bool {
    use std::net::{SocketAddr, TcpStream};
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

fn read_trimmed(path: &Path) -> Option<String> {
    std::fs::read_to_string(path)
        .ok()
        .map(|text| text.trim().to_string())
}

/// 从磁盘读代理的端口与令牌（代理在跑时有效）。
pub fn read_endpoint() -> Option<Endpoint> {
    let dir = mcp_runtime_dir();
    let port: u16 = read_trimmed(&dir.join("port"))?.parse().ok()?;
    if !port_alive(port) {
        return None;
    }
    let token = read_trimmed(&dir.join("token")).unwrap_or_else(|| FIXED_TOKEN.to_string());
    Some(Endpoint { port, token })
}

/// 代理的启动方式：可执行文件路径 + 前置参数。
struct SidecarLaunch {
    program: PathBuf,
    args: Vec<String>,
}

/// 找到代理的可执行文件 / 入口脚本。
///
/// **源码优先** —— 跟桌面端（`src-tauri/src/lib.rs` 的 `spawn_sidecar`）一致。
///
/// 为什么源码优先：打包好的二进制是**构建时的快照**。开发期改了
/// `packages/agent-compose-mcp/src/` 里的代码，二进制不会跟着变 ——
/// 桌面端跑的是源码（改动立刻生效），CLI 跑的是旧二进制，两边行为对不上。
/// 而且 CLI 没法像桌面端那样比对源码指纹（它只看配置文件有没有变），
/// 所以只能从「启动哪个」这一步就统一到源码。
///
/// 找法：
/// 1. 仓库里的源码（开发形态）—— 从当前目录往上找
/// 2. 桌面端装出来的（`~/.agent-compose/bin/`）
/// 3. 自己旁边的 `bin/`（万一两个放一起）
fn find_sidecar() -> Option<SidecarLaunch> {
    let exe_name = if cfg!(windows) {
        "agent-compose-mcp.exe"
    } else {
        "agent-compose-mcp"
    };
    // 1) 仓库里的源码（开发形态）
    if let Ok(cwd) = std::env::current_dir() {
        let mut dir = Some(cwd);
        for _ in 0..6 {
            let Some(current) = dir.clone() else { break };
            let script = current
                .join("packages")
                .join("agent-compose-mcp")
                .join("src")
                .join("index.ts");
            if script.is_file() {
                return Some(SidecarLaunch {
                    program: PathBuf::from("node"),
                    args: vec![
                        "--experimental-strip-types".to_string(),
                        script.to_string_lossy().to_string(),
                    ],
                });
            }
            dir = current.parent().map(|p| p.to_path_buf());
        }
    }
    // 2) 桌面端装出来的（~/.agent-compose/bin/）——
    //    CLI 装在 PATH 上的目录，sidecar 跟着应用走，两者不在一处。
    let installed = crate::paths::compose_root().join("bin").join(exe_name);
    if installed.is_file() {
        return Some(SidecarLaunch {
            program: installed,
            args: Vec::new(),
        });
    }
    // 3) 自己旁边的 bin/（发布形态：CLI 与 sidecar 放一起）
    if let Ok(exe) = std::env::current_exe() {
        let mut dir = exe.parent().map(|p| p.to_path_buf());
        // bin/agentspace(.exe) → bin/agent-compose-mcp(.exe)
        for _ in 0..3 {
            let Some(current) = dir.clone() else { break };
            let candidate = current.join(exe_name);
            if candidate.is_file() {
                return Some(SidecarLaunch {
                    program: candidate,
                    args: Vec::new(),
                });
            }
            dir = current.parent().map(|p| p.to_path_buf());
        }
    }
    None
}

/// 代理启动后，配置文件被改过吗？
///
/// 代理只在启动时读一次 `servers.json` / `exposure.json`，之后靠 admin 接口
/// 更新内存态。所以「磁盘上的配置比代理启动时新」就意味着代理手里的配置是旧的
/// —— 表现是工具列表空的。
///
/// 端口文件是代理启动时写的（绑定成功后），拿它的修改时间当「启动时间」，
/// 不用去解析 `sidecar.json` 里的 ISO 时间戳。
fn config_is_newer_than_proxy() -> bool {
    let dir = mcp_runtime_dir();
    let Ok(started) = std::fs::metadata(dir.join("port")).and_then(|meta| meta.modified()) else {
        return false;
    };
    for name in ["servers.json", "exposure.json"] {
        let Ok(modified) = std::fs::metadata(dir.join(name)).and_then(|meta| meta.modified()) else {
            continue;
        };
        if modified > started {
            return true;
        }
    }
    false
}

/// 谁在监听这个端口。
///
/// `sidecar.json` 里的 pid 可能是旧的（实例换过），所以以端口的实际占用者为准。
fn pid_listening_on(port: u16) -> Option<u64> {
    let output = agentspace_core::proc::command("netstat").args(["-ano"]).output().ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let needle = format!("127.0.0.1:{port}");
    for line in text.lines() {
        if !line.contains(&needle) || !line.contains("LISTENING") {
            continue;
        }
        if let Some(pid) = line.split_whitespace().last() {
            if let Ok(pid) = pid.parse::<u64>() {
                return Some(pid);
            }
        }
    }
    None
}

/// 停掉正在跑的代理（按端口的实际占用者，端口文件里的 pid 只是兜底）。
fn stop_running_proxy(port: u16) {
    let dir = mcp_runtime_dir();
    let pid = pid_listening_on(port).or_else(|| {
        let raw = std::fs::read_to_string(dir.join("sidecar.json")).ok()?;
        let value = serde_json::from_str::<serde_json::Value>(&raw).ok()?;
        value.get("pid").and_then(|pid| pid.as_u64())
    });
    let Some(pid) = pid else {
        return;
    };
    if cfg!(windows) {
        let _ = agentspace_core::proc::command("taskkill")
            .args(["/F", "/PID", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    } else {
        let _ = agentspace_core::proc::command("kill")
            .args(["-9", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = std::fs::remove_file(dir.join("port"));
}

/// 确保代理在跑，且手里的配置是最新的。
///
/// 已经在跑但配置过期 → 先重启它（否则 agent 看到的是空的工具列表）。
pub fn ensure_running() -> Result<Endpoint, String> {
    if let Some(endpoint) = read_endpoint() {
        if !config_is_newer_than_proxy() {
            return Ok(endpoint);
        }
        stop_running_proxy(endpoint.port);
        std::thread::sleep(Duration::from_millis(500));
    }
    let launch = find_sidecar().ok_or_else(|| {
        "找不到 MCP 代理（既没有 agent-compose-mcp 可执行文件，也没有仓库源码）".to_string()
    })?;

    // 起代理这一步有个坑：**子进程会继承父进程的 stdio 句柄**。
    //
    // 代理是常驻的，它一直活着就一直拿着当前 shell 的管道写端 ——
    // 于是 `agentspace run xxx | tee log` 这种命令永远等不到 EOF，
    // 看起来就是“卡住了”。退出码明明已经拿到，shell 却还在等。
    //
    // Windows 上用 `explorer.exe <程序路径>` 起进程是惯用解法：
    // 它是系统 shell 自己去 CreateProcess，**不继承调用方的句柄**。
    // （`cmd /c start`、`PowerShell Start-Process` 实测都还会继承。）
    #[cfg(windows)]
    {
        let mut cmd = agentspace_core::proc::command("explorer.exe");
        cmd.arg(&launch.program);
        cmd.args(&launch.args);
        cmd.stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        cmd.spawn().map_err(|e| format!("拉起 MCP 代理失败：{e}"))?;
    }

    #[cfg(not(windows))]
    {
        let mut cmd = agentspace_core::proc::command(&launch.program);
        cmd.args(&launch.args);
        // 输出落盘：跟桌面端一个做法
        let log_path = mcp_runtime_dir().join("sidecar.log");
        let log = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .map_err(|e| format!("打开代理日志失败：{e}"))?;
        let log_err = log.try_clone().map_err(|e| e.to_string())?;
        cmd.stdin(Stdio::null())
            .stdout(Stdio::from(log))
            .stderr(Stdio::from(log_err));
        cmd.spawn().map_err(|e| format!("拉起 MCP 代理失败：{e}"))?;
    }

    let deadline = Instant::now() + Duration::from_secs(15);
    while Instant::now() < deadline {
        if let Some(endpoint) = read_endpoint() {
            return Ok(endpoint);
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    Err("MCP 代理启动超时（15 秒）".to_string())
}

/// 代理当前暴露了哪些 server（`exposure.json`）。
///
/// 只用来提示：智能体绑定的 server 没被暴露的话，agent 那边一个工具都看不到。
pub fn exposed_server_ids() -> Vec<String> {
    let Ok(raw) = std::fs::read_to_string(mcp_runtime_dir().join("exposure.json")) else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return Vec::new();
    };
    value
        .get("exposure")
        .and_then(|exposure| exposure.get("serverIds"))
        .and_then(|ids| ids.as_array())
        .map(|ids| {
            ids.iter()
                .filter_map(|id| id.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

/// 极简 HTTP 客户端：只用来跟本机代理的 admin 接口说话。
///
/// 不引第三方 HTTP 库 —— 这点需求不值得多一个依赖。
fn admin_post(endpoint: &Endpoint, path: &str, timeout: Duration) -> Option<String> {
    use std::net::SocketAddr;
    let addr = SocketAddr::from(([127, 0, 0, 1], endpoint.port));
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, timeout) else {
        return None;
    };
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));
    let mut request = String::new();
    request.push_str(&format!("POST {path} HTTP/1.1\r\n"));
    request.push_str(&format!("Host: 127.0.0.1:{}\r\n", endpoint.port));
    request.push_str(&format!("Authorization: Bearer {}\r\n", endpoint.token));
    request.push_str("Content-Length: 0\r\n");
    request.push_str("Connection: close\r\n");
    request.push_str("\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return None;
    }

    // 读响应：先读头，按 Content-Length 取 body。
    // 不能直接 read_to_end —— 服务端会保持连接（keep-alive），
    // 读到 EOF 要等到超时，白等一轮。
    let mut raw = Vec::new();
    let mut chunk = [0u8; 4096];
    let header_end = loop {
        if let Some(index) = find_header_end(&raw) {
            break index;
        }
        let read = stream.read(&mut chunk).ok()?;
        if read == 0 {
            return None;
        }
        raw.extend_from_slice(&chunk[..read]);
        if raw.len() > 1024 * 1024 {
            return None;
        }
    };
    let header = String::from_utf8_lossy(&raw[..header_end]).into_owned();
    let content_length = header
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            if name.trim().eq_ignore_ascii_case("content-length") {
                value.trim().parse::<usize>().ok()
            } else {
                None
            }
        })
        .unwrap_or(0);

    let mut body = raw[header_end + 4..].to_vec();
    while body.len() < content_length {
        let read = stream.read(&mut chunk).ok()?;
        if read == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..read]);
    }
    Some(String::from_utf8_lossy(&body).into_owned())
}

/// 找 HTTP 头结束的位置（`\r\n\r\n`）
fn find_header_end(raw: &[u8]) -> Option<usize> {
    raw.windows(4).position(|window| window == b"\r\n\r\n")
}

/// 让代理把绑定的上游连起来。
///
/// 上游是**惰性连接**的：代理启动后不会自己连，只有「测试连接」接口会触发。
/// 不主动连的话，agent 拿到的工具清单是空的（看起来像 MCP 配错了）。
///
/// 返回 (连上的 server 数, 连不上的说明)。
pub fn probe_servers(endpoint: &Endpoint, server_ids: &[String]) -> (usize, Vec<String>) {
    let mut connected = 0usize;
    let mut failures = Vec::new();
    for id in server_ids {
        let path = format!("/admin/servers/{id}/test");
        let Some(body) = admin_post(endpoint, &path, Duration::from_secs(30)) else {
            failures.push(format!("{id}（代理没响应）"));
            continue;
        };
        let value = serde_json::from_str::<serde_json::Value>(&body).ok();
        let state = value
            .as_ref()
            .and_then(|v| v.get("state"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        let tool_count = value
            .as_ref()
            .and_then(|v| v.get("tools"))
            .and_then(|v| v.as_array())
            .map(|list| list.len())
            .unwrap_or(0);
        if state == "ready" {
            connected += 1;
            if tool_count == 0 {
                failures.push(format!("{id}（连上了但没有工具）"));
            }
        } else {
            let detail = value
                .as_ref()
                .and_then(|v| v.get("error"))
                .and_then(|v| v.as_str())
                .unwrap_or(state);
            failures.push(format!("{id}：{detail}"));
        }
    }
    (connected, failures)
}
