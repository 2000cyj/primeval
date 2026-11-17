//! `agentspace mcp ...` —— MCP server。
//!
//! 对应桌面端的「MCP」页。
//!
//! **操作走 sidecar 的 admin HTTP API** —— 桌面端和 CLI 是同一个 API 的两个
//! 客户端（桌面端和 CLI 调同一套 API，一个道理）。
//!
//! server 的定义、曝光配置、令牌都归 sidecar 管，CLI 不自己碰那些文件。

use std::path::{Path, PathBuf};

use clap::{Args, Subcommand};
use agentspace_core::{bridge, Paths};

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
    /// 从配置文件批量导入 server
    Import(ImportArgs),
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
    Exposure(ListArgs),
    /// 设对外暴露的配置
    SetExposure(SetExposureArgs),
    /// 刷新访问令牌
    RefreshToken,
    /// 看代理的整体状态（含每个上游的工具清单）
    Status(ListArgs),
    /// 测一个**还没保存**的 server 定义
    Probe(ProbeArgs),
    /// 配置文件档（一组 server 的组合）
    #[command(subcommand)]
    Profiles(ProfileCmd),
    /// 发起 OAuth 授权
    Authorize(AuthorizeArgs),
    /// 在官方目录里搜 MCP server
    Registry(RegistryArgs),
    /// 用系统默认浏览器打开一个网址
    OpenUrl(OpenUrlArgs),
}

/// 配置文件档的命令组。
///
/// 配置档是一组 server 的组合 —— 换项目时整套换过去，
/// 不用一个一个改。
#[derive(Subcommand, Debug)]
pub enum ProfileCmd {
    /// 列出全部配置档
    List(ListArgs),
    /// 覆盖式保存配置档（从 JSON 文件读）
    Save(SaveProfilesArgs),
}

#[derive(Args, Debug)]
pub struct SaveProfilesArgs {
    /// 配置档列表的 JSON 文件
    file: PathBuf,
}

#[derive(Args, Debug)]
pub struct AuthorizeArgs {
    /// server id
    id: String,
    /// 授权成功后要打开的回调页（默认只打印授权网址）
    #[arg(long)]
    open: bool,
}

#[derive(Args, Debug)]
pub struct RegistryArgs {
    /// 搜索关键词
    query: String,
    /// 翻页游标（从上一次的 nextCursor 拿）
    #[arg(long)]
    cursor: Option<String>,
    /// 输出格式
    #[arg(long, value_enum, default_value = "text")]
    format: Format,
    /// 输出 JSON（等价于 --format json）
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug)]
pub struct OpenUrlArgs {
    /// 要打开的网址
    url: String,
}

#[derive(Args, Debug)]
pub struct ImportArgs {
    /// 配置文件路径（yaml）
    source: String,
    /// 相对路径的基准目录（如仓库根）—— 源文件里的相对 command 会按它解析成绝对路径
    #[arg(long)]
    base_dir: Option<String>,
    /// 覆盖已有的同名 server（默认跳过）
    #[arg(long)]
    overwrite: bool,
    /// 不导入，只看会导入什么
    #[arg(long)]
    dry_run: bool,
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
    /// 暴露哪些 server（server id，可重复）
    #[arg(long = "server")]
    servers: Vec<String>,
    /// 暴露这些 server 的全部工具（按当前连上的工具清单展开）
    #[arg(long)]
    all_tools: bool,
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
            McpCmd::Import(args) => import(&client, args),
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
            McpCmd::Profiles(cmd) => profiles(&client, cmd),
            McpCmd::Authorize(args) => authorize(&client, args),
            McpCmd::Registry(args) => registry(&client, args),
            // 开浏览器不需要 sidecar —— 单独拿出来，不走 attach。
            McpCmd::OpenUrl(args) => open_url(args),
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

fn exposure(client: &McpClient, args: ListArgs) -> u8 {
    match client.exposure() {
        Ok(value) => {
            if output::wants_json(args.format, args.json) {
                output::json(&value);
                return 0;
            }
            // 人看的形式：server 列表 + 工具数
            let server_ids: Vec<String> = value
                .get("serverIds")
                .and_then(|v| v.as_array())
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            let tool_keys: Vec<String> = value
                .get("toolKeys")
                .and_then(|v| v.as_array())
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            let max_tools = value.get("maxTools").and_then(|v| v.as_u64()).unwrap_or(0);
            println!("可见 server：{}", server_ids.len());
            for id in &server_ids {
                let count = tool_keys
                    .iter()
                    .filter(|key| key.starts_with(&format!("{id}::")))
                    .count();
                println!("  - {id}（{count} 个工具）");
            }
            println!("已选工具：{} / {}", tool_keys.len(), max_tools);
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
    // server id 的引用形式有两种：`mcp/servers.json#<id>` 和裸 id。
    // 前端存的是前者，这里两种都认。
    let server_ids: Vec<String> = args
        .servers
        .iter()
        .map(|raw| {
            raw.rsplit('#')
                .next()
                .unwrap_or(raw)
                .trim()
                .to_string()
        })
        .filter(|id| !id.is_empty())
        .collect();
    object.insert("serverIds".into(), serde_json::json!(server_ids));

    // 工具清单：`--all-tools` 时按当前连上的工具展开，
    // 否则用命令行给的（`serverId::工具名`）。
    let tool_keys: Vec<String> = if args.all_tools {
        match client.status() {
            Ok(status) => status
                .get("upstreams")
                .and_then(|v| v.as_array())
                .map(|upstreams| {
                    upstreams
                        .iter()
                        .filter(|u| {
                            u.get("serverId")
                                .and_then(|v| v.as_str())
                                .map(|id| server_ids.iter().any(|s| s == id))
                                .unwrap_or(false)
                        })
                        .flat_map(|u| {
                            u.get("tools")
                                .and_then(|v| v.as_array())
                                .map(|tools| {
                                    tools
                                        .iter()
                                        .filter_map(|t| t.get("name").and_then(|v| v.as_str()))
                                        .map(|name| {
                                            format!(
                                                "{}::{}",
                                                u.get("serverId")
                                                    .and_then(|v| v.as_str())
                                                    .unwrap_or_default(),
                                                name
                                            )
                                        })
                                        .collect::<Vec<String>>()
                                })
                                .unwrap_or_default()
                        })
                        .collect()
                })
                .unwrap_or_default(),
            Err(error) => {
                eprintln!("读工具清单失败：{error}");
                return 1;
            }
        }
    } else {
        args.tools
            .iter()
            .map(|raw| {
                raw.rsplit('#')
                    .next()
                    .unwrap_or(raw)
                    .trim()
                    .to_string()
            })
            .filter(|key| !key.is_empty())
            .collect()
    };
    object.insert("toolKeys".into(), serde_json::json!(tool_keys));
    if let Some(max) = args.max_tools {
        object.insert("maxTools".into(), serde_json::json!(max));
    }
    match client.set_exposure(&value) {
        Ok(()) => {
            println!(
                "已更新对外暴露的配置：{} 个 server，{} 个工具。",
                server_ids.len(),
                tool_keys.len()
            );
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

fn import(client: &McpClient, args: ImportArgs) -> u8 {
    let base_dir = args.base_dir.as_ref().map(std::path::PathBuf::from);
    let (defs, skipped) = match bridge::load_bridge_servers(
        std::path::Path::new(&args.source),
        base_dir.as_deref(),
    ) {
        Ok(result) => result,
        Err(error) => {
            eprintln!("导入失败：{error}");
            return 1;
        }
    };
    if !skipped.is_empty() {
        eprintln!("提示：这些条目没法用，已跳过：{}", skipped.join("、"));
    }

    if args.dry_run {
        println!("将会导入 {} 个 server：", defs.len());
        for def in &defs {
            let id = def.get("id").and_then(|v| v.as_str()).unwrap_or("?");
            let transport = def.get("transport").and_then(|v| v.as_str()).unwrap_or("?");
            println!("  - {id}（{transport}）");
        }
        return 0;
    }

    let mut servers = match client.servers() {
        Ok(servers) => servers,
        Err(error) => {
            eprintln!("读取 server 列表失败：{error}");
            return 1;
        }
    };
    let mut added = 0usize;
    let mut skipped_existing = Vec::new();
    for def in defs {
        let id = def
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let exists = servers
            .iter()
            .any(|item| item.get("id").and_then(|v| v.as_str()) == Some(id.as_str()));
        if exists && !args.overwrite {
            skipped_existing.push(id);
            continue;
        }
        // 覆盖：先去掉旧的
        if exists {
            servers.retain(|item| item.get("id").and_then(|v| v.as_str()) != Some(id.as_str()));
        }
        servers.push(def);
        added += 1;
    }

    if added == 0 {
        println!("没有新增（已有的：{}）", skipped_existing.join("、"));
        return 0;
    }
    match client.save_servers(&servers) {
        Ok(()) => {
            println!("已导入 {added} 个 MCP server。");
            if !skipped_existing.is_empty() {
                println!("跳过了已有的：{}", skipped_existing.join("、"));
            }
            0
        }
        Err(error) => {
            eprintln!("导入失败：{error}");
            1
        }
    }
}

fn profiles(client: &McpClient, cmd: ProfileCmd) -> u8 {
    match cmd {
        ProfileCmd::List(args) => {
            let value = match client.profiles() {
                Ok(value) => value,
                Err(error) => {
                    eprintln!("读配置档失败：{error}");
                    return 1;
                }
            };
            if output::wants_json(args.format, args.json) {
                output::json(&value);
                return 0;
            }
            // 配置档的形状由 sidecar 定，这里只把常见的字段摊开给人看。
            let list = value
                .get("profiles")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            if list.is_empty() {
                println!("还没有配置档。");
                return 0;
            }
            let rows: Vec<Vec<String>> = list
                .iter()
                .map(|item| {
                    let name = item
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("(未命名)")
                        .to_string();
                    let servers = item
                        .get("servers")
                        .and_then(|v| v.as_array())
                        .map(|items| {
                            items
                                .iter()
                                .filter_map(|v| v.as_str())
                                .collect::<Vec<&str>>()
                                .join("、")
                        })
                        .unwrap_or_default();
                    vec![name, servers]
                })
                .collect();
            output::table(&["配置档", "包含的 server"], &rows);
            0
        }
        ProfileCmd::Save(args) => {
            let raw = match std::fs::read_to_string(&args.file) {
                Ok(raw) => raw,
                Err(error) => {
                    eprintln!("读配置文件失败：{error}");
                    return 1;
                }
            };
            let value: serde_json::Value = match serde_json::from_str(&raw) {
                Ok(value) => value,
                Err(error) => {
                    eprintln!("配置文件不是 JSON：{error}");
                    return 1;
                }
            };
            // 文件里可以直接是数组，也可以是 { "profiles": [...] }。
            let payload = if value.is_array() {
                value
            } else {
                value.get("profiles").cloned().unwrap_or(value)
            };
            match client.save_profiles(&payload) {
                Ok(_) => {
                    println!("已保存配置档。");
                    0
                }
                Err(error) => {
                    eprintln!("保存配置档失败：{error}");
                    1
                }
            }
        }
    }
}

fn authorize(client: &McpClient, args: AuthorizeArgs) -> u8 {
    let result = match client.authorize_server(&args.id) {
        Ok(result) => result,
        Err(error) => {
            eprintln!("发起授权失败：{error}");
            return 1;
        }
    };
    let url = result
        .get("authorizeUrl")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    if url.is_empty() {
        eprintln!("代理没返回授权网址。");
        return 1;
    }
    println!("在浏览器里打开这个网址完成授权：");
    println!("{url}");
    if args.open {
        if let Err(error) = open_in_browser(&url) {
            eprintln!("打开浏览器失败：{error}");
            return 1;
        }
        println!("已交给浏览器打开。");
    }
    0
}

fn registry(client: &McpClient, args: RegistryArgs) -> u8 {
    let result = match client.registry_search(&args.query, args.cursor.as_deref()) {
        Ok(result) => result,
        Err(error) => {
            eprintln!("搜官方目录失败：{error}");
            return 1;
        }
    };
    if output::wants_json(args.format, args.json) {
        output::json(&result);
        return 0;
    }
    let entries = result
        .get("entries")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    if entries.is_empty() {
        println!("没找到相关的条目。");
        return 0;
    }
    let rows: Vec<Vec<String>> = entries
        .iter()
        .map(|entry| {
            let name = entry
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("(未命名)")
                .to_string();
            let description = entry
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let installable = entry
                .get("installable")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            vec![
                name,
                if installable { "可安装".to_string() } else { "-".to_string() },
                description,
            ]
        })
        .collect();
    output::table(&["条目", "能否直接装", "说明"], &rows);
    if let Some(next) = result.get("nextCursor").and_then(|v| v.as_str()) {
        println!("还有更多 —— 加 --cursor {next} 继续。");
    }
    0
}

fn open_url(args: OpenUrlArgs) -> u8 {
    match open_in_browser(&args.url) {
        Ok(()) => {
            println!("已打开 {}", args.url);
            0
        }
        Err(error) => {
            eprintln!("打开失败：{error}");
            1
        }
    }
}

/// 用系统默认浏览器打开一个网址。
///
/// 只借系统的 `open` / `start` —— 不引浏览器控制库，也不自己找浏览器路径。
fn open_in_browser(url: &str) -> Result<(), String> {
    let mut cmd = agentspace_core::proc::command(if cfg!(windows) { "cmd" } else { "xdg-open" });
    if cfg!(windows) {
        // `start` 是 cmd 的内建命令，得用 `cmd /c start "" <url>`。
        cmd.arg("/c").arg("start").arg("").arg(url);
    } else {
        cmd.arg(url);
    }
    cmd.status()
        .map(|_| ())
        .map_err(|error| format!("启动浏览器失败：{error}"))
}
