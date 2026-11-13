//! `agentspace` —— AgentSpace 的命令行。
//!
//! ```text
//! cd 我的项目
//! agentspace run 知识助手          启动智能体
//! agentspace install 知识助手      把智能体装进当前目录
//! agentspace skill list            看有哪些 skill
//! agentspace mcp list              看有哪些 MCP server
//! agentspace extension list        看有哪些 Pi 扩展
//! agentspace agent list            看有哪些智能体
//! agentspace tool list             看本机装了哪些 CLI
//! ```
//!
//! # 设计
//!
//! 一套数据，两个客户端。
//!
//! - 桌面端（`apps/AgentCompose`）和这个 CLI 是两个进程、两个 crate，
//!   但操作的是同一份数据（`~/.agent-compose/`）；
//! - 数据的结构与读写逻辑放在共享 crate `apps/agentspace-core` 里，
//!   两边都依赖它 —— 不会有「桌面端认的字段 CLI 不认」；
//! - MCP 的操作走 sidecar 的 admin HTTP API —— 桌面端和 CLI 是同一个 API
//!   的两个客户端（桌面端和 CLI 调同一套 API，一个道理）。
//!
//! 命令树按「名词 → 动作」分：
//!
//! ```text
//! agentspace
//! ├── run <名称>            启动智能体
//! ├── install <名称>        把智能体装进当前目录（不启动）
//! ├── update <名称>        更新当前目录里的智能体（不启动）
//! ├── agent                 智能体（我们创建的，跑在 Pi 上）
//! ├── skill                 Skill 仓库
//! ├── mcp                   MCP server
//! ├── extension             Pi 扩展（自带 / npm / 自定义）
//! ├── tool                  本机 CLI 工具箱
//! └── proxy                 全局出站代理
//! ```
//!
//! 输出默认给人看（表格 / 逐行），加 `--json` 给 agent 拿去解析。

mod commands;
mod mcp;
mod output;
mod paths;
mod prepare;
mod runtime;
mod trust;

use clap::{Parser, Subcommand};

use agentspace_core::Paths;

/// AgentSpace 命令行。
#[derive(Debug, Parser)]
#[command(
    name = "agentspace",
    version,
    about = "AgentSpace 命令行 —— 管理智能体、Skill、MCP 与本机 CLI",
    disable_help_subcommand = true
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// 准备目录并启动智能体（当前只支持 Pi）
    Run {
        /// 智能体名称
        name: String,
        /// 传给 agent 的参数
        #[arg(trailing_var_arg = true)]
        args: Vec<String>,
    },

    /// 装一个智能体到当前目录（不启动）
    Install {
        /// 智能体名称
        name: String,
    },

    /// 更新当前目录里的智能体（不启动）
    Update {
        /// 智能体名称
        name: String,
    },

    /// 智能体（我们创建的，跑在 Pi 上）
    #[command(subcommand)]
    Agent(commands::agent::AgentCmd),

    /// Skill 仓库
    #[command(subcommand)]
    Skill(commands::skill::SkillCmd),

    /// MCP server
    #[command(subcommand)]
    Mcp(commands::mcp::McpCmd),

    /// Pi 扩展（Pi 自带 / npm / 自定义）
    #[command(subcommand)]
    Extension(commands::extension::ExtensionCmd),

    /// 本机 CLI 工具箱
    #[command(subcommand)]
    Tool(commands::tool::ToolCmd),

    /// 全局出站代理
    #[command(subcommand)]
    Proxy(commands::proxy::ProxyCmd),
}

fn main() -> std::process::ExitCode {
    let cli = Cli::parse();
    let paths = Paths::from_env();
    let code = match cli.command {
        Command::Run { name, args } => commands::run::run(&paths, &name, &args),
        Command::Install { name } => commands::install::install(&paths, &name),
        Command::Update { name } => commands::install::update(&paths, &name),
        Command::Agent(cmd) => cmd.run(&paths),
        Command::Skill(cmd) => cmd.run(&paths),
        Command::Mcp(cmd) => cmd.run(&paths),
        Command::Extension(cmd) => cmd.run(&paths),
        Command::Tool(cmd) => cmd.run(&paths),
        Command::Proxy(cmd) => cmd.run(&paths),
    };
    std::process::ExitCode::from(code)
}
