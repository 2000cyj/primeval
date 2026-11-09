use std::path::PathBuf;

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

/// 转发一次 admin API 调用到 sidecar。
async fn admin_request(
    app: &AppHandle,
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    let ep = endpoint(app)?;
    let client = reqwest::Client::new();
    let url = format!("{}{}", ep.base, path);

    let mut req = client.request(method, &url).bearer_auth(&ep.token);
    if let Some(payload) = body {
        req = req.json(&payload);
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        return Err(format!("sidecar 返回 {}：{}", status.as_u16(), text));
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
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
