//! `agentspace app ...` —— 桌面端本身。
//!
//! 对应桌面端的「设置 → 关于」。
//!
//! 命令行这边能做的只有**看** —— 下载安装包、验签、装完重启都是桌面端
//! 的活（那套走 Tauri 官方的 updater 插件）。CLI 在这儿的作用是：
//! 让脚本和 agent 能在不打开窗口的情况下知道有没有新版本。

use std::path::PathBuf;

use clap::{Args, Subcommand};
use agentspace_core::{updater, Paths};

use crate::output::{self, Format};

#[derive(Subcommand, Debug)]
pub enum AppCmd {
    /// 看桌面端有没有新版本
    Update(UpdateArgs),
}

#[derive(Args, Debug)]
pub struct UpdateArgs {
    /// 输出格式
    #[arg(long, value_enum, default_value = "text")]
    format: Format,
    /// 输出 JSON（等价于 --format json）
    #[arg(long)]
    json: bool,
}

impl AppCmd {
    pub fn run(self, paths: &Paths) -> u8 {
        match self {
            AppCmd::Update(args) => update(paths, args),
        }
    }
}

fn update(paths: &Paths, args: UpdateArgs) -> u8 {
    let current = current_version(paths);
    let info = match crate::commands::block_on(updater::check_latest_release(&current)) {
        Ok(info) => info,
        Err(error) => {
            eprintln!("查更新失败：{error}");
            return 1;
        }
    };
    if output::wants_json(args.format, args.json) {
        output::json(&info);
        return 0;
    }
    println!("当前版本：{current}");
    println!("最新版本：{}", info.latest_version);
    if info.has_update {
        println!("有新版本。");
        println!("发布说明：{}", info.release_url);
        println!("（下载安装要打开桌面端 —— 那套走应用内更新，装完自动重启。）");
    } else {
        println!("已经是最新。");
    }
    0
}

/// 本机桌面端的版本号。
///
/// 桌面端启动时把自己的版本写进 `~/.agent-compose/app-version` ——
/// CLI 跟桌面端是两个进程，CLI 拿不到对方的版本号，只能从磁盘上读。
///
/// 读不到就退回 CLI 自己的版本 —— 至少不是空的。
fn current_version(paths: &Paths) -> String {
    let path = version_file(paths);
    if let Ok(raw) = std::fs::read_to_string(&path) {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    env!("CARGO_PKG_VERSION").to_string()
}

/// 版本号文件的位置。
fn version_file(paths: &Paths) -> PathBuf {
    paths.root().join("app-version")
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::CommandFactory;

    #[test]
    fn command_tree_is_valid() {
        crate::Cli::command().debug_assert();
    }

    #[test]
    fn version_file_sits_next_to_other_agent_space_data() {
        let paths = Paths::new(std::path::PathBuf::from("/tmp/agent-space-home"));
        assert!(version_file(&paths).ends_with("app-version"));
    }
}
