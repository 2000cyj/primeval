//! `agentspace version` —— 版本总览。
//!
//! 一条命令看完所有版本号：AgentSpace 自己（桌面端 + 命令行），
//! 加上**工具箱**里各个 CLI 工具（Claude Code / Codex / Gemini CLI …）的版本。
//!
//! 为什么单独一条命令：这些版本号散在几个地方 ——
//! 桌面端的版本只有桌面端进程知道，命令行自己的版本在 Cargo 里，
//! 工具箱里各工具的版本要现探测。装了个新东西、或者排查「是不是版本旧了」，
//! 敲一条命令全看到，比挨个地方翻快。

use clap::Args;
use agentspace_core::{toolbox, Paths};
use serde::Serialize;

use crate::output::{self, Format};

#[derive(Args, Debug)]
pub struct VersionArgs {
    /// 顺便查 registry 上的最新版本（要联网，慢一点）
    #[arg(long)]
    check: bool,
    /// 输出格式
    #[arg(long, value_enum, default_value = "text")]
    format: Format,
    /// 输出 JSON（等价于 --format json）
    #[arg(long)]
    json: bool,
}

/// 一个工具的版本。
#[derive(Serialize)]
struct ToolVersion {
    /// 命令名。
    command: String,
    /// 展示名。
    name: String,
    /// 装没装。
    installed: bool,
    /// 本机版本。
    version: Option<String>,
    /// registry 上的最新版本（`--check` 才查）。
    latest_version: Option<String>,
}

/// 版本总览。
#[derive(Serialize)]
struct VersionOverview {
    /// 桌面端版本。
    app_version: String,
    /// 命令行版本。
    cli_version: String,
    /// 工具箱里各工具的版本。
    tools: Vec<ToolVersion>,
}

pub fn run(paths: &Paths, args: VersionArgs) -> u8 {
    let agents = match crate::commands::block_on(toolbox::toolbox_scan(paths)) {
        Ok(agents) => agents,
        Err(error) => {
            eprintln!("探测工具箱失败：{error}");
            return 1;
        }
    };

    // 装了哪些工具才值得问 registry —— 没装的东西问一趟白等。
    let installed_commands: Vec<String> = agents
        .iter()
        .filter(|item| item.installed)
        .map(|item| item.command.clone())
        .collect();
    let latest: std::collections::HashMap<String, Option<String>> = if args.check
        && !installed_commands.is_empty()
    {
        match crate::commands::block_on(toolbox::toolbox_check_updates(
            paths,
            installed_commands.clone(),
        )) {
            Ok(items) => items
                .into_iter()
                .map(|item| (item.command, item.latest_version))
                .collect(),
            Err(error) => {
                eprintln!("查最新版本失败（不影响本机版本）：{error}");
                Default::default()
            }
        }
    } else {
        Default::default()
    };

    let overview = VersionOverview {
        app_version: app_version(paths),
        cli_version: env!("CARGO_PKG_VERSION").to_string(),
        tools: agents
            .iter()
            .map(|item| ToolVersion {
                command: item.command.clone(),
                name: item.name.clone(),
                installed: item.installed,
                version: item.version.clone(),
                latest_version: latest.get(&item.command).cloned().flatten(),
            })
            .collect(),
    };

    if output::wants_json(args.format, args.json) {
        output::json(&overview);
        return 0;
    }

    println!("AgentSpace");
    println!("  桌面端    {}", overview.app_version);
    println!("  命令行    {}", overview.cli_version);
    println!();
    println!("工具箱");
    let rows: Vec<Vec<String>> = overview
        .tools
        .iter()
        .map(|tool| {
            let local = if tool.installed {
                tool.version.clone().unwrap_or_else(|| "—".to_string())
            } else {
                "未安装".to_string()
            };
            let mut latest_text = String::new();
            if let Some(latest_version) = &tool.latest_version {
                latest_text = format!("最新 {latest_version}");
                // 本机版本比 registry 旧 —— 点出来，别让人自己比。
                if let Some(current) = &tool.version {
                    if agentspace_core::updater::is_newer(latest_version, current) {
                        latest_text.push_str("（有新版）");
                    }
                }
            }
            vec![tool.name.clone(), local, latest_text]
        })
        .collect();
    output::table(&["工具", "本机版本", "registry"], &rows);
    0
}

/// 桌面端的版本号。
///
/// 桌面端启动时把自己的版本写进 `~/.agent-compose/app-version` ——
/// 命令行跟桌面端是两个进程，拿不到对方的版本号，只能从磁盘上读。
fn app_version(paths: &Paths) -> String {
    let path = paths.root().join("app-version");
    match std::fs::read_to_string(&path) {
        Ok(raw) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                "未知".to_string()
            } else {
                trimmed.to_string()
            }
        }
        Err(_) => "未知（桌面端还没启动过）".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::{CommandFactory, Parser};

    #[test]
    fn command_tree_is_valid() {
        crate::Cli::command().debug_assert();
    }

    #[test]
    fn parses_version_with_check() {
        let parsed = crate::Cli::try_parse_from(["agentspace", "version", "--check"]).unwrap();
        assert!(matches!(parsed.command, crate::Command::Version(_)));
    }

    #[test]
    fn app_version_falls_back_when_file_missing() {
        let paths = Paths::new(std::path::PathBuf::from("/tmp/agent-space-home-not-there"));
        assert!(app_version(&paths).contains("未知"));
    }
}
