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
//! agentspace wiki list             看知识库里有哪些页面
//! agentspace backup inventory      看有哪些数据可以导出
//! agentspace version               看 AgentSpace 和工具箱里各工具的版本
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
//! ├── wiki                  内部知识库（Wiki）
//! ├── backup                数据管理（导入 / 导出）
//! ├── app                   桌面端本身（查更新）
//! ├── version               版本总览
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

    /// 内部知识库（Wiki）
    #[command(subcommand)]
    Wiki(commands::wiki::WikiCmd),

    /// 数据管理（导入 / 导出）
    #[command(subcommand)]
    Backup(commands::backup::BackupCmd),

    /// 桌面端本身（查更新）
    #[command(subcommand)]
    App(commands::app::AppCmd),

    /// 版本总览：AgentSpace 自己 + 工具箱里各 CLI 工具
    ///
    /// 也认 `-version` / `-v`（归一化在 `normalize_version_alias` 里）。
    Version(commands::version::VersionArgs),

    /// 本机 CLI 工具箱
    #[command(subcommand)]
    Tool(commands::tool::ToolCmd),

    /// 全局出站代理
    #[command(subcommand)]
    Proxy(commands::proxy::ProxyCmd),
}

fn main() -> std::process::ExitCode {
    let cli = Cli::parse_from(normalize_version_alias(std::env::args_os().collect()));
    let paths = Paths::from_env();
    let code = match cli.command {
        Command::Run { name, args } => commands::run::run(&paths, &name, &args),
        Command::Install { name } => commands::install::install(&paths, &name),
        Command::Update { name } => commands::install::update(&paths, &name),
        Command::Agent(cmd) => cmd.run(&paths),
        Command::Skill(cmd) => cmd.run(&paths),
        Command::Mcp(cmd) => cmd.run(&paths),
        Command::Extension(cmd) => cmd.run(&paths),
        Command::Wiki(cmd) => cmd.run(&paths),
        Command::Backup(cmd) => cmd.run(&paths),
        Command::App(cmd) => cmd.run(&paths),
        Command::Version(args) => commands::version::run(&paths, args),
        Command::Tool(cmd) => cmd.run(&paths),
        Command::Proxy(cmd) => cmd.run(&paths),
    };
    std::process::ExitCode::from(code)
}

/// 把 `-version` / `-v` 归一成 `version`。
///
/// clap 原生只认两种写法：`--version`（长选项）和 `-V`（单字符短选项）。
/// `-version` 这种**单横线多字符**的写法它不认 —— 但用户习惯里它很常见，
/// `-v` 也常被当成 `version` 用。
///
/// 只改**子命令位置**上的那一个参数（`args[1]`）——
/// 后面的参数是传给子命令的，`agentspace run 某智能体 -v` 不该被改。
fn normalize_version_alias(args: Vec<std::ffi::OsString>) -> Vec<std::ffi::OsString> {
    let mut args = args;
    let is_alias = args
        .get(1)
        .map(|arg| arg == "-version" || arg == "-v")
        .unwrap_or(false);
    if is_alias {
        args[1] = std::ffi::OsString::from("version");
    }
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(items: &[&str]) -> Vec<std::ffi::OsString> {
        items.iter().map(std::ffi::OsString::from).collect()
    }

    #[test]
    fn version_aliases_are_normalized() {
        for spelling in ["-version", "-v"] {
            let args = normalize_version_alias(argv(&["agentspace", spelling]));
            assert_eq!(args[1], "version", "{spelling} 应该归一成 version");
        }
    }

    #[test]
    fn plain_version_is_untouched() {
        let args = normalize_version_alias(argv(&["agentspace", "version"]));
        assert_eq!(args[1], "version");
    }

    #[test]
    fn only_the_subcommand_position_is_touched() {
        // 子命令后面的 `-v` 是传给子命令的，不能改
        let args = normalize_version_alias(argv(&["agentspace", "run", "某智能体", "-v"]));
        assert_eq!(args[1], "run");
        assert_eq!(args[3], "-v");
    }

    #[test]
    fn all_three_spellings_parse_to_the_same_command() {
        for spelling in ["version", "-version", "-v"] {
            let args = normalize_version_alias(argv(&["agentspace", spelling]));
            let parsed = Cli::parse_from(args);
            assert!(
                matches!(parsed.command, Command::Version(_)),
                "{spelling} 应该解析成 version 子命令"
            );
        }
    }
}
