//! `agentspace agent ...` —— 智能体（我们创建的，跑在 Pi 上）。
//!
//! 对应桌面端的「智能体」页。

use clap::{Args, Subcommand};
use agentspace_core::{agent, Paths};

use crate::output::{self, Format};

#[derive(Subcommand, Debug)]
pub enum AgentCmd {
    /// 列出全部智能体
    List(ListArgs),
    /// 看一个智能体的详情
    Get(GetArgs),
    /// 新建一个智能体
    Create(CreateArgs),
    /// 改一个智能体
    Update(UpdateArgs),
    /// 删一个智能体
    Delete(DeleteArgs),
    /// 复制一个智能体
    Copy(CopyArgs),
    /// 管理绑定的 Skill
    #[command(subcommand)]
    Skills(SkillBindCmd),
    /// 管理绑定的 MCP
    #[command(subcommand)]
    Mcp(McpBindCmd),
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
pub struct GetArgs {
    /// 智能体 id 或名称
    key: String,
    /// 输出格式
    #[arg(long, value_enum, default_value = "text")]
    format: Format,
    /// 输出 JSON（等价于 --format json）
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug)]
pub struct CreateArgs {
    /// 名称
    name: String,
    /// 描述
    #[arg(long, default_value = "")]
    description: String,
    /// 指令（会写进 AGENTS.md）
    #[arg(long, default_value = "")]
    instruction: String,
    /// 绑定的 skill（相对引用，如 `skills/knowledge-base`，可重复）
    #[arg(long = "skill")]
    skills: Vec<String>,
    /// 绑定的 MCP server id（可重复）
    #[arg(long = "mcp")]
    mcp: Vec<String>,
    /// 跑在哪个 agent 上（现在只有 pi）
    #[arg(long, default_value = agent::DEFAULT_RUNTIME)]
    runtime: String,
}

#[derive(Args, Debug)]
pub struct UpdateArgs {
    /// 智能体 id 或名称
    key: String,
    /// 改名字
    #[arg(long)]
    name: Option<String>,
    /// 改描述
    #[arg(long)]
    description: Option<String>,
    /// 改指令
    #[arg(long)]
    instruction: Option<String>,
    /// 绑定的 skill（整体替换，可重复）
    #[arg(long = "skill")]
    skills: Option<Vec<String>>,
    /// 绑定的 MCP（整体替换，可重复）
    #[arg(long = "mcp")]
    mcp: Option<Vec<String>>,
}

#[derive(Args, Debug)]
pub struct DeleteArgs {
    /// 智能体 id 或名称
    key: String,
    /// 不确认，直接删
    #[arg(long)]
    yes: bool,
}

#[derive(Args, Debug)]
pub struct CopyArgs {
    /// 源智能体 id 或名称
    key: String,
    /// 新智能体的名字
    new_name: String,
}

#[derive(Subcommand, Debug)]
pub enum SkillBindCmd {
    /// 看绑了哪些 Skill
    List(GetArgs),
    /// 绑一个 Skill（相对引用，如 `skills/knowledge-base`）
    Add {
        /// 智能体 id 或名称
        key: String,
        /// skill 相对引用
        reference: String,
    },
    /// 解绑一个 Skill
    Remove {
        /// 智能体 id 或名称
        key: String,
        /// skill 相对引用
        reference: String,
    },
}

#[derive(Subcommand, Debug)]
pub enum McpBindCmd {
    /// 看绑了哪些 MCP
    List(GetArgs),
    /// 绑一个 MCP server
    Add {
        /// 智能体 id 或名称
        key: String,
        /// MCP server id
        id: String,
    },
    /// 解绑一个 MCP server
    Remove {
        /// 智能体 id 或名称
        key: String,
        /// MCP server id
        id: String,
    },
}

impl AgentCmd {
    pub fn run(self, paths: &Paths) -> u8 {
        match self {
            AgentCmd::List(args) => list(paths, args),
            AgentCmd::Get(args) => get(paths, args),
            AgentCmd::Create(args) => create(paths, args),
            AgentCmd::Update(args) => update(paths, args),
            AgentCmd::Delete(args) => delete(paths, args),
            AgentCmd::Copy(args) => copy(paths, args),
            AgentCmd::Skills(cmd) => skills(paths, cmd),
            AgentCmd::Mcp(cmd) => mcp(paths, cmd),
        }
    }
}

/// 智能体 id → 目录名安全字符。
fn new_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    let random: u32 = rand_like();
    format!(
        "agent-{}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0),
        format!("{:x}{:x}", seq, random)
    )
}

/// 一个够用的随机数（不需要密码学强度，只是避免同毫秒撞 id）。
fn rand_like() -> u32 {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    nanos ^ (std::process::id() as u32).wrapping_mul(2654435761)
}

/// 找一个智能体；找不到或重名都给出明确提示。
fn resolve_one(paths: &Paths, key: &str) -> Result<agent::CreatedAgent, String> {
    let matches = agent::find_by_name(paths, key);
    if matches.is_empty() {
        return Err(format!("找不到智能体：{key}"));
    }
    if matches.len() > 1 {
        let mut message = format!("有多个智能体叫「{key}」：");
        for item in &matches {
            message.push_str(&format!("\n  - {}（{}）", item.name, item.id));
        }
        return Err(message);
    }
    Ok(matches.into_iter().next().expect("刚确认过有一个"))
}

fn list(paths: &Paths, args: ListArgs) -> u8 {
    let agents = agent::list(paths);
    if output::wants_json(args.format, args.json) {
        output::json(&agents);
        return 0;
    }
    if agents.is_empty() {
        println!("还没有智能体 —— 到 AgentCompose 里新建一个，或者用 `agentspace agent create`。");
        return 0;
    }
    let rows: Vec<Vec<String>> = agents
        .iter()
        .map(|item| {
            vec![
                item.name.clone(),
                format!("v{}", item.version),
                item.runtime.clone(),
                format!("{} 个 skill", item.skills.len()),
                format!("{} 个 MCP", item.mcp_servers.len()),
                item.id.clone(),
            ]
        })
        .collect();
    output::table(
        &["名称", "版本", "运行时", "SKILLS", "MCP", "ID"],
        &rows,
    );
    0
}

fn get(paths: &Paths, args: GetArgs) -> u8 {
    let found = match agent::resolve(paths, &args.key) {
        Some(item) => item,
        None => {
            eprintln!("找不到智能体：{}", args.key);
            return 3;
        }
    };
    if output::wants_json(args.format, args.json) {
        output::json(&found);
        return 0;
    }
    println!("名称：{}", found.name);
    println!("描述：{}", found.description);
    println!("版本：v{}", found.version);
    println!("运行时：{}", found.runtime);
    println!("ID：{}", found.id);
    println!("Skills：");
    for item in &found.skills {
        println!("  - {item}");
    }
    println!("MCP：");
    for item in &found.mcp_servers {
        println!("  - {item}");
    }
    if !found.instruction.trim().is_empty() {
        println!("指令：");
        println!("{}", found.instruction.trim());
    }
    0
}

fn create(paths: &Paths, args: CreateArgs) -> u8 {
    let name = args.name.trim().to_string();
    if name.is_empty() {
        eprintln!("名字不能为空");
        return 2;
    }
    if !agent::find_by_name(paths, &name).is_empty() {
        eprintln!("已经有同名智能体了：{name}");
        return 2;
    }
    let draft = agent::CreatedAgent {
        id: new_id(),
        name: name.clone(),
        description: args.description,
        instruction: args.instruction,
        skills: args.skills,
        mcp_servers: args
            .mcp
            .iter()
            .map(|id| format!("mcp/servers.json#{id}"))
            .collect(),
        runtime: args.runtime,
        version: 0,
        created_at: now_ms(),
    };
    match agent::save(paths, &draft) {
        Ok(saved) => {
            println!("已创建智能体「{}」（{}）v{}", saved.name, saved.id, saved.version);
            0
        }
        Err(error) => {
            eprintln!("创建失败：{error}");
            1
        }
    }
}

fn update(paths: &Paths, args: UpdateArgs) -> u8 {
    let mut found = match resolve_one(paths, &args.key) {
        Ok(item) => item,
        Err(error) => {
            eprintln!("{error}");
            return 3;
        }
    };
    if let Some(name) = args.name {
        let trimmed = name.trim().to_string();
        if trimmed.is_empty() {
            eprintln!("名字不能为空");
            return 2;
        }
        if !agent::find_by_name(paths, &trimmed)
            .iter()
            .all(|item| item.id == found.id)
            && agent::find_by_name(paths, &trimmed).iter().any(|item| item.id != found.id)
        {
            eprintln!("已经有同名智能体了：{trimmed}");
            return 2;
        }
        found.name = trimmed;
    }
    if let Some(value) = args.description {
        found.description = value;
    }
    if let Some(value) = args.instruction {
        found.instruction = value;
    }
    if let Some(value) = args.skills {
        found.skills = value;
    }
    if let Some(value) = args.mcp {
        found.mcp_servers = value
            .iter()
            .map(|id| format!("mcp/servers.json#{id}"))
            .collect();
    }
    match agent::save(paths, &found) {
        Ok(saved) => {
            println!("已更新智能体「{}」→ v{}", saved.name, saved.version);
            0
        }
        Err(error) => {
            eprintln!("更新失败：{error}");
            1
        }
    }
}

fn delete(paths: &Paths, args: DeleteArgs) -> u8 {
    let found = match resolve_one(paths, &args.key) {
        Ok(item) => item,
        Err(error) => {
            eprintln!("{error}");
            return 3;
        }
    };
    if !args.yes && !confirm(&format!("确定删掉智能体「{}」？", found.name)) {
        println!("已取消。");
        return 0;
    }
    match agent::delete(paths, &found.id) {
        Ok(()) => {
            println!("已删除智能体「{}」", found.name);
            0
        }
        Err(error) => {
            eprintln!("删除失败：{error}");
            1
        }
    }
}

fn copy(paths: &Paths, args: CopyArgs) -> u8 {
    let source = match resolve_one(paths, &args.key) {
        Ok(item) => item,
        Err(error) => {
            eprintln!("{error}");
            return 3;
        }
    };
    let name = args.new_name.trim().to_string();
    if name.is_empty() {
        eprintln!("新名字不能为空");
        return 2;
    }
    if !agent::find_by_name(paths, &name).is_empty() {
        eprintln!("已经有同名智能体了：{name}");
        return 2;
    }
    let draft = agent::CreatedAgent {
        id: new_id(),
        name,
        description: source.description,
        instruction: source.instruction,
        skills: source.skills,
        mcp_servers: source.mcp_servers,
        runtime: source.runtime,
        version: 0,
        created_at: now_ms(),
    };
    match agent::save(paths, &draft) {
        Ok(saved) => {
            println!("已复制为「{}」（{}）", saved.name, saved.id);
            0
        }
        Err(error) => {
            eprintln!("复制失败：{error}");
            1
        }
    }
}

fn skills(paths: &Paths, cmd: SkillBindCmd) -> u8 {
    match cmd {
        SkillBindCmd::List(args) => {
            let found = match agent::resolve(paths, &args.key) {
                Some(item) => item,
                None => {
                    eprintln!("找不到智能体：{}", args.key);
                    return 3;
                }
            };
            if output::wants_json(args.format, args.json) {
                output::json(&found.skills);
                return 0;
            }
            output::lines(&found.skills);
            0
        }
        SkillBindCmd::Add { key, reference } => {
            let mut found = match resolve_one(paths, &key) {
                Ok(item) => item,
                Err(error) => {
                    eprintln!("{error}");
                    return 3;
                }
            };
            if found.skills.contains(&reference) {
                println!("已经绑过了：{reference}");
                return 0;
            }
            found.skills.push(reference.clone());
            match agent::save(paths, &found) {
                Ok(saved) => {
                    println!("已绑定 {reference}（v{}）", saved.version);
                    0
                }
                Err(error) => {
                    eprintln!("绑定失败：{error}");
                    1
                }
            }
        }
        SkillBindCmd::Remove { key, reference } => {
            let mut found = match resolve_one(paths, &key) {
                Ok(item) => item,
                Err(error) => {
                    eprintln!("{error}");
                    return 3;
                }
            };
            let before = found.skills.len();
            found.skills.retain(|item| item != &reference);
            if found.skills.len() == before {
                println!("没绑着：{reference}");
                return 0;
            }
            match agent::save(paths, &found) {
                Ok(saved) => {
                    println!("已解绑 {reference}（v{}）", saved.version);
                    0
                }
                Err(error) => {
                    eprintln!("解绑失败：{error}");
                    1
                }
            }
        }
    }
}

fn mcp(paths: &Paths, cmd: McpBindCmd) -> u8 {
    match cmd {
        McpBindCmd::List(args) => {
            let found = match agent::resolve(paths, &args.key) {
                Some(item) => item,
                None => {
                    eprintln!("找不到智能体：{}", args.key);
                    return 3;
                }
            };
            if output::wants_json(args.format, args.json) {
                output::json(&found.mcp_servers);
                return 0;
            }
            output::lines(&found.mcp_servers);
            0
        }
        McpBindCmd::Add { key, id } => {
            let mut found = match resolve_one(paths, &key) {
                Ok(item) => item,
                Err(error) => {
                    eprintln!("{error}");
                    return 3;
                }
            };
            let reference = format!("mcp/servers.json#{id}");
            if found.mcp_servers.contains(&reference) {
                println!("已经绑过了：{id}");
                return 0;
            }
            found.mcp_servers.push(reference);
            match agent::save(paths, &found) {
                Ok(saved) => {
                    println!("已绑定 {id}（v{}）", saved.version);
                    0
                }
                Err(error) => {
                    eprintln!("绑定失败：{error}");
                    1
                }
            }
        }
        McpBindCmd::Remove { key, id } => {
            let mut found = match resolve_one(paths, &key) {
                Ok(item) => item,
                Err(error) => {
                    eprintln!("{error}");
                    return 3;
                }
            };
            let reference = format!("mcp/servers.json#{id}");
            let before = found.mcp_servers.len();
            found.mcp_servers.retain(|item| item != &reference);
            if found.mcp_servers.len() == before {
                println!("没绑着：{id}");
                return 0;
            }
            match agent::save(paths, &found) {
                Ok(saved) => {
                    println!("已解绑 {id}（v{}）", saved.version);
                    0
                }
                Err(error) => {
                    eprintln!("解绑失败：{error}");
                    1
                }
            }
        }
    }
}

/// 当前的 epoch 毫秒。
pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 问一句是/否。不是交互终端时默认「否」—— 不擅自改用户数据。
pub fn confirm(question: &str) -> bool {
    use std::io::{BufRead, Write};
    print!("{question} [y/N] ");
    let _ = std::io::stdout().flush();
    let mut answer = String::new();
    if std::io::stdin().lock().read_line(&mut answer).is_err() {
        return false;
    }
    let answer = answer.trim().to_lowercase();
    answer == "y" || answer == "yes"
}
