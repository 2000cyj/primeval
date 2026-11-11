//! `agentspace mcp ...` —— MCP server。
//!
//! 对应桌面端的「MCP」页。
//!
//! **操作走 sidecar 的 admin HTTP API** —— 桌面端和 CLI 是同一个 API 的两个
//! 客户端（跟 multica 的 CLI / Web 调同一套 API 一个道理）。
//!
//! server 的定义、曝光配置、令牌都归 sidecar 管，CLI 不自己碰那些文件。

use std::path::Path;

use clap::{Args, Subcommand};
use agentspace_core::Paths;

use crate::commands::mcp_client::McpClient;
use crate::output::{self, Format};

#[derive(Subcommand, Debug)]
pub enum McpCmd {
    /// 列出全部 MCP server
    List(ListArgs),
    /// 看一个 server 的详情
    Get(GetArgs),
    /// 新建一个 server
    Create(CreateArgs),
    /// 改一个 server
    Update(UpdateArgs),
    /// 删一个 server
    Delete(DeleteArgs),
    /// 启用
    Enable(NameArgs),
    /// 停用
    Disable(NameArgs),
    /// 测试连接（真实握手 + 拉工具清单）
    Test(NameArgs),
    /// 连上所有启用的上游，刷新工具清单
    Connect,
    /// 看对外暴露的配置
    Exposure(GetArgs),
    /// 设对外暴露的配置
    SetExposure(SetExposureArgs),
    /// 刷新访问令牌
    RefreshToken,
    /// 看代理的整体状态（含每个上游的工具清单）
    Status(ListArgs),
    /// 测一个**还没保存**的 server 定义
    Probe(ProbeArgs),
}

#[derive(Args, Debug)]
pub struct ProbeArgs {
    /// server 定义的 JSON（从文件读或直接给字符串）
    #[arg(long)]
    def: String,
}

#[derive(Args, Debug)]
pub struct ListArgs {
    /// 输出格式
    #[arg(long, value_enum, default_value = "text")]
    format: Format,
    /// 输出 JSON（等价于 --format json）
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug)]
pub struct NameArgs {
    /// server id
    id: String,
}

#[derive(Args, Debug)]
pub struct GetArgs {
    /// server id
    id: String,
    /// 输出格式
    #[arg(long, value_enum, default_value = "text")]
    format: Format,
    /// 输出 JSON（等价于 --format json）
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug)]
pub struct CreateArgs {
    /// server id（唯一）
    id: String,
    /// 显示名
    #[arg(long, default_value = "")]
    name: String,
    /// 传输方式：http / stdio
    #[arg(long, default_value = "http")]
    transport: String,
    /// http 方式的地址
    #[arg(long)]
    url: Option<String>,
    /// stdio 方式的命令
    #[arg(long)]
    command: Option<String>,
    /// stdio 方式的参数（可重复）
    #[arg(long)]
    args: Vec<String>,
    /// 认证方式：none / static / oauth
    #[arg(long, default_value = "none")]
    auth: String,
    /// 固定令牌（可以写 `${ENV:NAME}`）
    #[arg(long)]
    token: Option<String>,
    /// 额外的请求头（`名字=值`，可重复）
    #[arg(long = "header")]
    headers: Vec<String>,
}

#[derive(Args, Debug)]
pub struct UpdateArgs {
    /// server id
    id: String,
    /// 改显示名
    #[arg(long)]
    name: Option<String>,
    /// 改地址
    #[arg(long)]
    url: Option<String>,
    /// 改认证方式
    #[arg(long)]
    auth: Option<String>,
    /// 改固定令牌
    #[arg(long)]
    token: Option<String>,
}

#[derive(Args, Debug)]
pub struct DeleteArgs {
    /// server id
    id: String,
    /// 不确认，直接删
    #[arg(long)]
    yes: bool,
}

#[derive(Args, Debug)]
pub struct SetExposureArgs {
    /// 暴露哪些 server（相对引用 `mcp/servers.json#<id>`，可重复）
    #[arg(long = "server")]
    servers: Vec<String>,
    /// 暴露哪些工具（`serverId::工具名`，可重复）
    #[arg(long = "tool")]
    tools: Vec<String>,
    /// 工具总数上限
    #[arg(long)]
    max_tools: Option<u64>,
}

impl McpCmd {
    pub fn run(self, paths: &Paths) -> u8 {
        let client = match McpClient::attach(paths) {
            Ok(client) => client,
            Err(error) => {
                eprintln!("连不上 MCP 代理：{error}");
                eprintln!("先在桌面端打开 MCP 页面，或手动启动 ~/.agent-compose/bin/agent-compose-mcp。");
                return 1;
            }
        };
        match self {
            McpCmd::List(args) => list(&client, args),
            McpCmd::Get(args) => get(&client, args),
            McpCmd::Create(args) => create(&client, args),
            McpCmd::Update(args) => update(&client, args),
            McpCmd::Delete(args) => delete(&client, args),
            McpCmd::Enable(args) => set_enabled(&client, args, true),
            McpCmd::Disable(args) => set_enabled(&client, args, false),
            McpCmd::Test(args) => test(&client, args),
            McpCmd::Connect => connect(&client),
            McpCmd::Exposure(args) => exposure(&client, args),
            McpCmd::SetExposure(args) => set_exposure(&client, args),
            McpCmd::RefreshToken => refresh_token(&client),
            McpCmd::Status(args) => status(&client, args),
            McpCmd::Probe(args) => probe(&client, args),
        }
    }
}

fn list(client: &McpClient, args: ListArgs) -> u8 {
    let servers = match client.servers() {
        Ok(servers) => servers,
        Err(error) => {
            eprintln!("读取 server 列表失败：{error}");
            return 1;
        }
    };
    if output::wants_json(args.format, args.json) {
        output::json(&servers);
        return 0;
    }
    if servers.is_empty() {
        println!("还没有 MCP server。");
        return 0;
    }
    let rows: Vec<Vec<String>> = servers
        .iter()
        .map(|server| {
            let id = server
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let name = server
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or(&id)
                .to_string();
            let transport = server
                .get("transport")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let enabled = server
                .get("enabled")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            vec![
                id,
                name,
                transport,
                if enabled { "启用".into() } else { "停用".into() },
                server
                    .get("url")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string(),
            ]
        })
        .collect();
    output::table(&["ID", "名称", "传输", "状态", "地址"], &rows);
    0
}

fn get(client: &McpClient, args: GetArgs) -> u8 {
    let servers = match client.servers() {
        Ok(servers) => servers,
        Err(error) => {
            eprintln!("读取 server 列表失败：{error}");
            return 1;
        }
    };
    let Some(server) = servers
        .iter()
        .find(|item| item.get("id").and_then(|v| v.as_str()) == Some(args.id.as_str()))
    else {
        eprintln!("找不到 server：{}", args.id);
        return 3;
    };
    if output::wants_json(args.format, args.json) {
        output::json(server);
        return 0;
    }
    output::text(&serde_json::to_string_pretty(server).unwrap_or_default());
    0
}

fn create(client: &McpClient, args: CreateArgs) -> u8 {
    let mut headers = serde_json::Map::new();
    for entry in &args.headers {
        let Some((name, value)) = entry.split_once('=') else {
            eprintln!("--header 的格式是 `名字=值`：{entry}");
            return 2;
        };
        headers.insert(name.trim().to_string(), serde_json::json!(value));
    }
    let mut server = serde_json::Map::new();
    server.insert("id".into(), serde_json::json!(args.id));
    server.insert(
        "name".into(),
        serde_json::json!(if args.name.trim().is_empty() {
            args.id.clone()
        } else {
            args.name.clone()
        }),
    );
    server.insert("transport".into(), serde_json::json!(args.transport));
    if let Some(url) = args.url {
        server.insert("url".into(), serde_json::json!(url));
    }
    if let Some(command) = args.command {
        server.insert("command".into(), serde_json::json!(command));
    }
    if !args.args.is_empty() {
        server.insert("args".into(), serde_json::json!(args.args));
    }
    server.insert("auth".into(), serde_json::json!(args.auth));
    if let Some(token) = args.token {
        server.insert("token".into(), serde_json::json!(token));
    }
    if !headers.is_empty() {
        server.insert("headers".into(), serde_json::Value::Object(headers));
    }
    server.insert("enabled".into(), serde_json::json!(true));

    let mut servers = match client.servers() {
        Ok(servers) => servers,
        Err(error) => {
            eprintln!("读取 server 列表失败：{error}");
            return 1;
        }
    };
    if servers
        .iter()
        .any(|item| item.get("id").and_then(|v| v.as_str()) == Some(args.id.as_str()))
    {
        eprintln!("已经有同 id 的 server 了：{}", args.id);
        return 2;
    }
    servers.push(serde_json::Value::Object(server));
    match client.save_servers(&servers) {
        Ok(()) => {
            println!("已创建 MCP server「{}」", args.id);
            0
        }
        Err(error) => {
            eprintln!("创建失败：{error}");
            1
        }
    }
}

fn update(client: &McpClient, args: UpdateArgs) -> u8 {
    let mut servers = match client.servers() {
        Ok(servers) => servers,
        Err(error) => {
            eprintln!("读取 server 列表失败：{error}");
            return 1;
        }
    };
    let Some(target) = servers.iter_mut().find(|item| {
        item.get("id").and_then(|v| v.as_str()) == Some(args.id.as_str())
    }) else {
        eprintln!("找不到 server：{}", args.id);
        return 3;
    };
    let Some(object) = target.as_object_mut() else {
        eprintln!("server 定义格式不对");
        return 1;
    };
    if let Some(value) = args.name {
        object.insert("name".into(), serde_json::json!(value));
    }
    if let Some(value) = args.url {
        object.insert("url".into(), serde_json::json!(value));
    }
    if let Some(value) = args.auth {
        object.insert("auth".into(), serde_json::json!(value));
    }
    if let Some(value) = args.token {
        object.insert("token".into(), serde_json::json!(value));
    }
    match client.save_servers(&servers) {
        Ok(()) => {
            println!("已更新 MCP server「{}」", args.id);
            0
        }
        Err(error) => {
            eprintln!("更新失败：{error}");
            1
        }
    }
}

fn delete(client: &McpClient, args: DeleteArgs) -> u8 {
    if !args.yes
        && !crate::commands::agent::confirm(&format!("确定删掉 MCP server「{}」？", args.id))
    {
        println!("已取消。");
        return 0;
    }
    match client.remove_server(&args.id) {
        Ok(()) => {
            println!("已删除 MCP server「{}」", args.id);
            0
        }
        Err(error) => {
            eprintln!("删除失败：{error}");
            1
        }
    }
}

fn set_enabled(client: &McpClient, args: NameArgs, enabled: bool) -> u8 {
    let mut servers = match client.servers() {
        Ok(servers) => servers,
        Err(error) => {
            eprintln!("读取 server 列表失败：{error}");
            return 1;
        }
    };
    let Some(target) = servers.iter_mut().find(|item| {
        item.get("id").and_then(|v| v.as_str()) == Some(args.id.as_str())
    }) else {
        eprintln!("找不到 server：{}", args.id);
        return 3;
    };
    if let Some(object) = target.as_object_mut() {
        object.insert("enabled".into(), serde_json::json!(enabled));
    }
    match client.save_servers(&servers) {
        Ok(()) => {
            println!(
                "已{} MCP server「{}」",
                if enabled { "启用" } else { "停用" },
                args.id
            );
            0
        }
        Err(error) => {
            eprintln!("操作失败：{error}");
            1
        }
    }
}

fn test(client: &McpClient, args: NameArgs) -> u8 {
    match client.test_server(&args.id) {
        Ok(result) => {
            output::text(&serde_json::to_string_pretty(&result).unwrap_or_default());
            0
        }
        Err(error) => {
            eprintln!("测试失败：{error}");
            1
        }
    }
}

fn connect(client: &McpClient) -> u8 {
    match client.connect_all() {
        Ok(()) => {
            println!("已连接所有启用的上游。");
            0
        }
        Err(error) => {
            eprintln!("连接失败：{error}");
            1
        }
    }
}

fn exposure(client: &McpClient, args: GetArgs) -> u8 {
    match client.exposure() {
        Ok(value) => {
            if output::wants_json(args.format, args.json) {
                output::json(&value);
            } else {
                output::text(&serde_json::to_string_pretty(&value).unwrap_or_default());
            }
            0
        }
        Err(error) => {
            eprintln!("读取曝光配置失败：{error}");
            1
        }
    }
}

fn set_exposure(client: &McpClient, args: SetExposureArgs) -> u8 {
    let mut value = match client.exposure() {
        Ok(value) => value,
        Err(error) => {
            eprintln!("读取曝光配置失败：{error}");
            return 1;
        }
    };
    let Some(object) = value.as_object_mut() else {
        eprintln!("曝光配置格式不对");
        return 1;
    };
    object.insert("serverIds".into(), serde_json::json!(args.servers));
    object.insert("toolKeys".into(), serde_json::json!(args.tools));
    if let Some(max) = args.max_tools {
        object.insert("maxTools".into(), serde_json::json!(max));
    }
    match client.set_exposure(&value) {
        Ok(()) => {
            println!("已更新对外暴露的配置。");
            0
        }
        Err(error) => {
            eprintln!("更新失败：{error}");
            1
        }
    }
}

fn refresh_token(client: &McpClient) -> u8 {
    match client.refresh_token() {
        Ok(token) => {
            println!("已刷新令牌：{token}");
            0
        }
        Err(error) => {
            eprintln!("刷新失败：{error}");
            1
        }
    }
}

fn status(client: &McpClient, args: ListArgs) -> u8 {
    match client.status() {
        Ok(value) => {
            if output::wants_json(args.format, args.json) {
                output::json(&value);
                return 0;
            }
            output::text(&serde_json::to_string_pretty(&value).unwrap_or_default());
            0
        }
        Err(error) => {
            eprintln!("读取状态失败：{error}");
            1
        }
    }
}

fn probe(client: &McpClient, args: ProbeArgs) -> u8 {
    // 传路径就读文件，否则当 JSON 字符串解析
    let raw = if Path::new(&args.def).is_file() {
        match std::fs::read_to_string(&args.def) {
            Ok(text) => text,
            Err(error) => {
                eprintln!("读文件失败：{error}");
                return 1;
            }
        }
    } else {
        args.def.clone()
    };
    let value: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(error) => {
            eprintln!("不是合法 JSON：{error}");
            return 2;
        }
    };
    match client.probe(&value) {
        Ok(result) => {
            output::text(&serde_json::to_string_pretty(&result).unwrap_or_default());
            0
        }
        Err(error) => {
            eprintln!("探测失败：{error}");
            1
        }
    }
}
