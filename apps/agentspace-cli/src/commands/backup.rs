//! `agentspace backup ...` —— 数据管理（导入 / 导出）。
//!
//! 对应桌面端的「设置 → 数据管理」。
//!
//! 逻辑都在共享 core（`agentspace_core::backup`）里，这里只管参数和输出。
//!
//! ── 导出包长什么样 ────────────────────────────────────
//!
//! 一个 zip，里面是 `manifest.json` + 各条数据的原文件。
//! `manifest.json` 记着包里有什么、每条来自本地还是远程。
//!
//! 远程来源（registry 装的 MCP server、URL 导入的 skill）**只记下载链接** ——
//! 原文件在别人机器上，包里带不走；本地手写的内容才打包原文件。

use std::path::PathBuf;

use clap::{Args, Subcommand};
use agentspace_core::{backup, Paths};

use crate::commands::mcp_client::McpClient;
use crate::output::{self, Format};

#[derive(Subcommand, Debug)]
pub enum BackupCmd {
    /// 看本机有哪些数据可以导出
    Inventory(ListArgs),
    /// 导出成 zip 包
    Export(ExportArgs),
    /// 看一个导入包里有什么、会跟本机撞上什么
    Inspect(InspectArgs),
    /// 导入一个 zip 包
    Import(ImportArgs),
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
pub struct ExportArgs {
    /// 导出到哪个 zip 文件
    #[arg(long)]
    out: PathBuf,
    /// 要带走的智能体 id（可重复）
    #[arg(long = "agent")]
    agent: Vec<String>,
    /// 要带走的 skill 名字（可重复）
    #[arg(long = "skill")]
    skill: Vec<String>,
    /// 要带走的 MCP server id（可重复）
    #[arg(long = "mcp")]
    mcp: Vec<String>,
    /// 要带走的 Pi 扩展名字（可重复）
    #[arg(long = "extension")]
    extension: Vec<String>,
    /// 要带走的 wiki 页面 slug（可重复）
    #[arg(long = "wiki")]
    wiki: Vec<String>,
    /// 全带走（不给具体清单时用这个）
    #[arg(long, conflicts_with_all = ["agent", "skill", "mcp", "extension", "wiki"])]
    all: bool,
    /// 输出格式
    #[arg(long, value_enum, default_value = "text")]
    format: Format,
    /// 输出 JSON（等价于 --format json）
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug)]
pub struct InspectArgs {
    /// 导入包路径
    zip: PathBuf,
    /// 输出格式
    #[arg(long, value_enum, default_value = "text")]
    format: Format,
    /// 输出 JSON（等价于 --format json）
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug)]
pub struct ImportArgs {
    /// 导入包路径
    zip: PathBuf,
    /// 覆盖这些冲突项（key 形如 `skill:名称`，可重复）
    #[arg(long = "overwrite")]
    overwrite: Vec<String>,
    /// 只看会导入什么，不真的动数据
    #[arg(long)]
    dry_run: bool,
    /// 输出格式
    #[arg(long, value_enum, default_value = "text")]
    format: Format,
    /// 输出 JSON（等价于 --format json）
    #[arg(long)]
    json: bool,
}

impl BackupCmd {
    pub fn run(self, paths: &Paths) -> u8 {
        match self {
            BackupCmd::Inventory(args) => inventory(paths, args),
            BackupCmd::Export(args) => export(paths, args),
            BackupCmd::Inspect(args) => inspect(paths, args),
            BackupCmd::Import(args) => import(paths, args),
        }
    }
}

/// 拿当前 MCP server 列表。
///
/// MCP server 的定义归 sidecar 管 —— 导出要带上它们，就得问 sidecar 要。
fn current_servers(paths: &Paths) -> Result<Vec<serde_json::Value>, String> {
    let client = McpClient::attach(paths)?;
    client.servers()
}

fn inventory(paths: &Paths, args: ListArgs) -> u8 {
    let servers = match current_servers(paths) {
        Ok(servers) => servers,
        Err(error) => {
            eprintln!("读取 MCP server 失败：{error}");
            return 1;
        }
    };
    let items = backup::inventory(paths, &servers);
    if output::wants_json(args.format, args.json) {
        output::json(&items);
        return 0;
    }

    let mut rows: Vec<Vec<String>> = Vec::new();
    for agent in &items.agents {
        rows.push(vec![
            "智能体".to_string(),
            agent.name.clone(),
            agent.id.clone(),
            String::new(),
            agent.description.clone(),
        ]);
    }
    for skill in &items.skills {
        rows.push(vec![
            "Skill".to_string(),
            skill.name.clone(),
            skill.name.clone(),
            source_label(skill.kind),
            skill.description.clone(),
        ]);
    }
    for server in &items.mcp_servers {
        rows.push(vec![
            "MCP".to_string(),
            server.name.clone(),
            server.id.clone(),
            source_label(server.kind),
            server.source_label.clone(),
        ]);
    }
    for extension in &items.extensions {
        rows.push(vec![
            "扩展".to_string(),
            extension.name.clone(),
            extension.name.clone(),
            source_label(extension.kind),
            extension.source_label.clone(),
        ]);
    }
    for page in &items.wiki_pages {
        rows.push(vec![
            "Wiki".to_string(),
            page.title.clone(),
            page.slug.clone(),
            String::new(),
            page.tags.join("、"),
        ]);
    }
    output::table(&["类别", "名称", "标识", "来源", "说明"], &rows);
    println!(
        "共 {} 个智能体、{} 个 skill、{} 个 MCP server、{} 个扩展、{} 个 wiki 页面。",
        items.agents.len(),
        items.skills.len(),
        items.mcp_servers.len(),
        items.extensions.len(),
        items.wiki_pages.len()
    );
    0
}

/// 把 `--agent` 给的 id / 名字统一解析成 id。
///
/// 两种都认：
/// - 直接是 id → 原样用
/// - 是名字 → 按名字找（找不到就当 id 用，让导出结果为空而不是报错）
fn resolve_agent_ids(paths: &Paths, keys: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for key in keys {
        let trimmed = key.trim();
        if trimmed.is_empty() {
            continue;
        }
        // 先当 id 试 —— 在就直接用
        if agentspace_core::agent::list(paths)
            .iter()
            .any(|agent| agent.id == trimmed)
        {
            out.push(trimmed.to_string());
            continue;
        }
        // 再按名字找
        let found = agentspace_core::agent::find_by_name(paths, trimmed);
        match found.len() {
            0 => out.push(trimmed.to_string()),
            1 => out.push(found[0].id.clone()),
            _ => {
                eprintln!(
                    "智能体名「{trimmed}」匹配到多个（{}）—— 请改用 id",
                    found.len()
                );
                for agent in found {
                    out.push(agent.id.clone());
                }
            }
        }
    }
    out
}

fn export(paths: &Paths, args: ExportArgs) -> u8 {
    let servers = match current_servers(paths) {
        Ok(servers) => servers,
        Err(error) => {
            eprintln!("读取 MCP server 失败：{error}");
            return 1;
        }
    };

    // --agent 给的可能是 id，也可能是名字。
    //
    // 两种都认 —— 只认 id 的话，传了名字会**静默地导不出任何智能体**
    // （导出结果里就是 0 个，用户还以为包是好的）。
    let agent_ids = resolve_agent_ids(paths, &args.agent);

    // 清单为空又没给 --all → 导出空包没意义。
    let selection = backup::ExportSelection {
        agent_ids,
        skill_names: args.skill.clone(),
        mcp_server_ids: args.mcp.clone(),
        extension_names: args.extension.clone(),
        wiki_slugs: args.wiki.clone(),
    };
    let empty = selection.agent_ids.is_empty()
        && selection.skill_names.is_empty()
        && selection.mcp_server_ids.is_empty()
        && selection.extension_names.is_empty()
        && selection.wiki_slugs.is_empty();
    if empty && !args.all {
        eprintln!("没指定要导出什么 —— 给 --agent/--skill/--mcp/--extension/--wiki，或者用 --all 全带走。");
        return 1;
    }

    // --all：把清单里有的全填上。
    let selection = if args.all {
        let items = backup::inventory(paths, &servers);
        backup::ExportSelection {
            agent_ids: items.agents.iter().map(|item| item.id.clone()).collect(),
            skill_names: items.skills.iter().map(|item| item.name.clone()).collect(),
            mcp_server_ids: items.mcp_servers.iter().map(|item| item.id.clone()).collect(),
            extension_names: items.extensions.iter().map(|item| item.name.clone()).collect(),
            wiki_slugs: items.wiki_pages.iter().map(|item| item.slug.clone()).collect(),
        }
    } else {
        selection
    };

    match backup::export(paths, &servers, &selection, &args.out) {
        Ok(result) => {
            if output::wants_json(args.format, args.json) {
                output::json(&result);
                return 0;
            }
            println!("已导出到 {}", result.zip_path);
            println!(
                "含 {} 个智能体、{} 个 skill、{} 个 MCP server、{} 个扩展、{} 个 wiki 页面。",
                result.counts.agents,
                result.counts.skills,
                result.counts.mcp_servers,
                result.counts.extensions,
                result.counts.wiki
            );
            0
        }
        Err(error) => {
            eprintln!("导出失败：{error}");
            1
        }
    }
}

fn inspect(paths: &Paths, args: InspectArgs) -> u8 {
    let servers = match current_servers(paths) {
        Ok(servers) => servers,
        Err(error) => {
            eprintln!("读取 MCP server 失败：{error}");
            return 1;
        }
    };
    let report = match backup::inspect(paths, &servers, &args.zip) {
        Ok(report) => report,
        Err(error) => {
            eprintln!("读导入包失败：{error}");
            return 1;
        }
    };
    if output::wants_json(args.format, args.json) {
        output::json(&report);
        return 0;
    }

    println!(
        "包里共有 {} 个智能体、{} 个 skill、{} 个 MCP server、{} 个扩展、{} 个 wiki 页面。",
        report.summary.agents,
        report.summary.skills,
        report.summary.mcp_servers,
        report.summary.extensions,
        report.summary.wiki
    );
    if report.conflicts.is_empty() {
        println!("没有冲突 —— 直接导就行。");
    } else {
        println!("有 {} 项跟本机重名（默认不覆盖）：", report.conflicts.len());
        let rows: Vec<Vec<String>> = report
            .conflicts
            .iter()
            .map(|conflict| {
                vec![
                    kind_label(conflict.kind),
                    conflict.label.clone(),
                    // 覆盖用的 key 是「类别:标识」——
                    // 跟导入时认的格式一致（`wiki:部署手册` 这种）。
                    format!("{}:{}", conflict.kind.label(), conflict.key),
                    conflict.local_hint.clone(),
                    conflict.incoming_hint.clone(),
                ]
            })
            .collect();
        output::table(&["类别", "名称", "覆盖用的 key", "本机", "包里"], &rows);
        println!("要覆盖就加 `--overwrite <key>`（可重复）。");
    }
    if report.fresh_count > 0 {
        println!("另有 {} 项不冲突，导入时会直接进去。", report.fresh_count);
    }
    for warning in &report.warnings {
        println!("提醒：{warning}");
    }
    0
}

fn import(paths: &Paths, args: ImportArgs) -> u8 {
    let mut servers = match current_servers(paths) {
        Ok(servers) => servers,
        Err(error) => {
            eprintln!("读取 MCP server 失败：{error}");
            return 1;
        }
    };

    // 远程的 MCP server（registry 装的）包里只记了名字，定义得现场取回来。
    let mut remote_defs: Vec<(String, serde_json::Value)> = Vec::new();
    let client = match McpClient::attach(paths) {
        Ok(client) => client,
        Err(error) => {
            eprintln!("连不上 MCP 代理：{error}");
            return 1;
        }
    };
    for name in backup::remote_mcp_names(&args.zip) {
        match client.registry_entry(&name) {
            Ok(Some(def)) => remote_defs.push((name, def)),
            Ok(None) => {}
            Err(error) => {
                eprintln!("从 MCP 目录取「{name}」失败：{error}");
                return 1;
            }
        }
    }

    // dry-run：先 inspect 一遍，把会导什么说清楚就收手。
    if args.dry_run {
        let report = match backup::inspect(paths, &servers, &args.zip) {
            Ok(report) => report,
            Err(error) => {
                eprintln!("读导入包失败：{error}");
                return 1;
            }
        };
        if output::wants_json(args.format, args.json) {
            output::json(&report);
            return 0;
        }
        println!(
            "包里共 {} 个智能体、{} 个 skill、{} 个 MCP server、{} 个扩展、{} 个 wiki 页面。",
            report.summary.agents,
            report.summary.skills,
            report.summary.mcp_servers,
            report.summary.extensions,
            report.summary.wiki
        );
        println!("其中 {} 项跟本机重名（不覆盖），{} 项会直接导入。", report.conflicts.len(), report.fresh_count);
        for conflict in &report.conflicts {
            println!(
                "  - {}（{}）：{}",
                conflict.label,
                format!("{}:{}", conflict.kind.label(), conflict.key),
                conflict.local_hint
            );
        }
        return 0;
    }

    let progress = |progress: backup::ImportProgress| {
        // 进度打到 stderr —— stdout 是给 JSON 用的，不能混。
        eprint!("\r{} {}", progress.phase, progress.message);
    };
    let result = match backup::import(
        paths,
        &mut servers,
        &args.zip,
        &args.overwrite,
        &remote_defs,
        Some(&progress),
    ) {
        Ok(result) => result,
        Err(error) => {
            eprintln!("\n导入失败：{error}");
            return 1;
        }
    };
    eprintln!();

    if output::wants_json(args.format, args.json) {
        output::json(&result);
        return 0;
    }
    println!(
        "导入完成：{} 个智能体、{} 个 skill、{} 个 MCP server、{} 个扩展、{} 个 wiki 页面。",
        result.imported.agents,
        result.imported.skills,
        result.imported.mcp_servers,
        result.imported.extensions,
        result.imported.wiki
    );
    let skipped = result.skipped.agents
        + result.skipped.skills
        + result.skipped.mcp_servers
        + result.skipped.extensions
        + result.skipped.wiki;
    if skipped > 0 {
        println!("{skipped} 项因为重名被跳过（要覆盖就加 --overwrite <key>）。");
    }
    for failure in &result.failures {
        println!("失败：{failure}");
    }
    for warning in &result.warnings {
        println!("提醒：{warning}");
    }
    0
}

/// 本地 / 远程的中文说法。
fn source_label(kind: backup::SourceKind) -> String {
    match kind {
        backup::SourceKind::Remote => "远程".to_string(),
        backup::SourceKind::Local => "本地".to_string(),
    }
}

/// 数据类别的中文说法。
fn kind_label(kind: backup::DataKind) -> String {
    match kind {
        backup::DataKind::Agent => "智能体".to_string(),
        backup::DataKind::Skill => "Skill".to_string(),
        backup::DataKind::McpServer => "MCP".to_string(),
        backup::DataKind::Extension => "扩展".to_string(),
        backup::DataKind::Wiki => "Wiki".to_string(),
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
    fn export_all_conflicts_with_explicit_lists() {
        let result = crate::Cli::try_parse_from([
            "agentspace",
            "backup",
            "export",
            "--out",
            "a.zip",
            "--all",
            "--skill",
            "knowledge-base",
        ]);
        assert!(result.is_err());
    }

    #[test]
    fn parses_inventory_and_import() {
        let parsed =
            crate::Cli::try_parse_from(["agentspace", "backup", "inventory"]).unwrap();
        assert!(matches!(
            parsed.command,
            crate::Command::Backup(BackupCmd::Inventory(_))
        ));
        let parsed =
            crate::Cli::try_parse_from(["agentspace", "backup", "import", "a.zip"]).unwrap();
        assert!(matches!(
            parsed.command,
            crate::Command::Backup(BackupCmd::Import(_))
        ));
    }

    #[test]
    fn source_labels_are_chinese() {
        assert_eq!(source_label(backup::SourceKind::Remote), "远程");
        assert_eq!(source_label(backup::SourceKind::Local), "本地");
    }

    #[test]
    fn kind_labels_cover_every_kind() {
        assert_eq!(kind_label(backup::DataKind::Agent), "智能体");
        assert_eq!(kind_label(backup::DataKind::Wiki), "Wiki");
    }
}
