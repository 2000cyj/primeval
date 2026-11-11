//! `agentspace tool ...` —— 本机 CLI 工具箱。
//!
//! 对应桌面端的「Agents」页：那 14 个能装的 agent CLI
//! （Claude Code / Codex / Pi / Gemini CLI …）。
//!
//! 探测和装卸都走共享 core（`agentspace_core::toolbox`）——
//! 跟桌面端是同一份实现，不会出现「界面说装了、CLI 说没装」。

use clap::{Args, Subcommand};
use agentspace_core::{toolbox, Paths};

use crate::commands::block_on;
use crate::output::{self, Format};

#[derive(Subcommand, Debug)]
pub enum ToolCmd {
    /// 列出全部已知的 CLI（含安装状态）
    List(ListArgs),
    /// 看一个 CLI 的详情（含所有安装位置）
    Get(GetArgs),
    /// 查 registry 上的最新版本
    CheckUpdates(CheckArgs),
    /// 看「将要执行什么」（不真装）
    Plan(PlanArgs),
    /// 装一个
    Install(InstallArgs),
    /// 升级一个
    Upgrade(NameArgs),
    /// 卸一个
    Uninstall(UninstallArgs),
}

#[derive(Args, Debug)]
pub struct ListArgs {
    /// 只看装了的
    #[arg(long)]
    installed: bool,
    /// 输出格式
    #[arg(long, value_enum, default_value = "text")]
    format: Format,
    /// 输出 JSON（等价于 --format json）
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug)]
pub struct NameArgs {
    /// CLI 的命令名（如 claude / codex / pi）
    command: String,
}

#[derive(Args, Debug)]
pub struct GetArgs {
    /// CLI 的命令名
    command: String,
    /// 输出格式
    #[arg(long, value_enum, default_value = "text")]
    format: Format,
    /// 输出 JSON（等价于 --format json）
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug)]
pub struct CheckArgs {
    /// 只查这些（不给就查全装了的）
    #[arg(long)]
    command: Vec<String>,
    /// 输出格式
    #[arg(long, value_enum, default_value = "text")]
    format: Format,
    /// 输出 JSON（等价于 --format json）
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug)]
pub struct PlanArgs {
    /// CLI 的命令名
    command: String,
    /// 操作：install / upgrade / uninstall
    #[arg(default_value = "install")]
    op: String,
    /// 装哪个版本（默认 latest）
    #[arg(long)]
    version: Option<String>,
}

#[derive(Args, Debug)]
pub struct InstallArgs {
    /// CLI 的命令名
    command: String,
    /// 装哪个版本（默认 latest）
    #[arg(long)]
    version: Option<String>,
    /// 不确认，直接装
    #[arg(long)]
    yes: bool,
}

#[derive(Args, Debug)]
pub struct UninstallArgs {
    /// CLI 的命令名
    command: String,
    /// 不确认，直接卸
    #[arg(long)]
    yes: bool,
}

impl ToolCmd {
    pub fn run(self, paths: &Paths) -> u8 {
        match self {
            ToolCmd::List(args) => list(paths, args),
            ToolCmd::Get(args) => get(paths, args),
            ToolCmd::CheckUpdates(args) => check_updates(paths, args),
            ToolCmd::Plan(args) => plan(paths, args),
            ToolCmd::Install(args) => install(paths, args),
            ToolCmd::Upgrade(args) => upgrade(paths, args),
            ToolCmd::Uninstall(args) => uninstall(paths, args),
        }
    }
}

fn list(paths: &Paths, args: ListArgs) -> u8 {
    let agents = match block_on(toolbox::toolbox_scan(paths)) {
        Ok(agents) => agents,
        Err(error) => {
            eprintln!("探测失败：{error}");
            return 1;
        }
    };
    let filtered: Vec<_> = if args.installed {
        agents.iter().filter(|item| item.installed).collect()
    } else {
        agents.iter().collect()
    };
    if output::wants_json(args.format, args.json) {
        output::json(&filtered);
        return 0;
    }
    if filtered.is_empty() {
        println!("本机还没装任何 CLI。");
        return 0;
    }
    let rows: Vec<Vec<String>> = filtered
        .iter()
        .map(|item| {
            vec![
                item.command.clone(),
                item.name.clone(),
                if item.installed { "已装".into() } else { "未装".into() },
                item.version.clone().unwrap_or_else(|| "—".into()),
                item.path.clone().unwrap_or_default(),
            ]
        })
        .collect();
    output::table(&["命令", "名称", "状态", "版本", "路径"], &rows);
    0
}

fn get(paths: &Paths, args: GetArgs) -> u8 {
    let installs = match block_on(toolbox::toolbox_installations(
        paths,
        args.command.clone(),
    )) {
        Ok(installs) => installs,
        Err(error) => {
            eprintln!("读取失败：{error}");
            return 1;
        }
    };
    if output::wants_json(args.format, args.json) {
        output::json(&installs);
        return 0;
    }
    if installs.is_empty() {
        println!("没检测到 {} 的安装。", args.command);
        return 0;
    }
    let rows: Vec<Vec<String>> = installs
        .iter()
        .map(|item| {
            vec![
                item.path.clone(),
                item.version.clone().unwrap_or_else(|| "—".into()),
                if item.runnable { "可运行".into() } else { "跑不了".into() },
                item.source.clone(),
            ]
        })
        .collect();
    output::table(&["路径", "版本", "状态", "来源"], &rows);
    0
}

fn check_updates(paths: &Paths, args: CheckArgs) -> u8 {
    let commands = if args.command.is_empty() {
        match block_on(toolbox::toolbox_scan(paths)) {
            Ok(agents) => agents
                .into_iter()
                .filter(|item| item.installed)
                .map(|item| item.command)
                .collect(),
            Err(error) => {
                eprintln!("探测失败：{error}");
                return 1;
            }
        }
    } else {
        args.command.clone()
    };
    if commands.is_empty() {
        println!("没有要查的 CLI。");
        return 0;
    }
    let result = match block_on(toolbox::toolbox_check_updates(paths, commands)) {
        Ok(result) => result,
        Err(error) => {
            eprintln!("查更新失败：{error}");
            return 1;
        }
    };
    if output::wants_json(args.format, args.json) {
        output::json(&result);
        return 0;
    }
    let rows: Vec<Vec<String>> = result
        .iter()
        .map(|item| {
            vec![
                item.command.clone(),
                item.latest_version.clone().unwrap_or_else(|| "查不到".into()),
            ]
        })
        .collect();
    output::table(&["命令", "最新版本"], &rows);
    0
}

fn plan(paths: &Paths, args: PlanArgs) -> u8 {
    match toolbox::toolbox_package_plan(
        paths,
        args.command.clone(),
        args.op.clone(),
        args.version.clone(),
    ) {
        Ok(plan) => {
            output::text(&serde_json::to_string_pretty(&plan).unwrap_or_default());
            0
        }
        Err(error) => {
            eprintln!("生成方案失败：{error}");
            1
        }
    }
}

fn install(paths: &Paths, args: InstallArgs) -> u8 {
    let version = args
        .version
        .clone()
        .unwrap_or_else(|| "latest".to_string());
    let plan = match toolbox::toolbox_package_plan(
        paths,
        args.command.clone(),
        "install".to_string(),
        Some(version.clone()),
    ) {
        Ok(plan) => plan,
        Err(error) => {
            eprintln!("安装失败：{error}");
            return 1;
        }
    };
    if !args.yes
        && !crate::commands::agent::confirm(&format!(
            "将执行：{}\n确定安装？",
            plan.command_line
        ))
    {
        println!("已取消。");
        return 0;
    }
    match block_on(toolbox::toolbox_install(
        paths,
        args.command.clone(),
        args.version.clone(),
    )) {
        Ok(message) => {
            println!("{message}");
            0
        }
        Err(error) => {
            eprintln!("安装失败：{error}");
            1
        }
    }
}

fn upgrade(paths: &Paths, args: NameArgs) -> u8 {
    let plan = match toolbox::toolbox_package_plan(
        paths,
        args.command.clone(),
        "upgrade".to_string(),
        None,
    ) {
        Ok(plan) => plan,
        Err(error) => {
            eprintln!("升级失败：{error}");
            return 1;
        }
    };
    if !crate::commands::agent::confirm(&format!("将执行：{}\n确定升级？", plan.command_line)) {
        println!("已取消。");
        return 0;
    }
    match block_on(toolbox::toolbox_upgrade(paths, args.command.clone())) {
        Ok(message) => {
            println!("{message}");
            0
        }
        Err(error) => {
            eprintln!("升级失败：{error}");
            1
        }
    }
}

fn uninstall(paths: &Paths, args: UninstallArgs) -> u8 {
    let plan = match toolbox::toolbox_package_plan(
        paths,
        args.command.clone(),
        "uninstall".to_string(),
        None,
    ) {
        Ok(plan) => plan,
        Err(error) => {
            eprintln!("卸载失败：{error}");
            return 1;
        }
    };
    if !args.yes
        && !crate::commands::agent::confirm(&format!(
            "将执行：{}\n确定卸载？",
            plan.command_line
        ))
    {
        println!("已取消。");
        return 0;
    }
    match block_on(toolbox::toolbox_uninstall(paths, args.command.clone())) {
        Ok(message) => {
            println!("{message}");
            0
        }
        Err(error) => {
            eprintln!("卸载失败：{error}");
            1
        }
    }
}
