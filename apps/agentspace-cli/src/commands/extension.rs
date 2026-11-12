//! `agentspace extension ...` —— Pi 扩展管理。
//!
//! 对应桌面端的「Pi 扩展」页。三组：
//! - **Pi 自带**：全局目录里直接放的扩展文件（只读，不能绑、不能删）
//! - **npm**：从 npm registry 装到 AgentSpace 工具箱里的
//! - **自定义**：用户自己写的脚本，放在工具箱的 `custom/` 下
//!
//! 全部走共享 core（`agentspace_core::extensions`）—— 跟桌面端是同一份
//! 实现，不会出现「界面说装了、CLI 说没装」。
//!
//! npm 扩展和自定义扩展放在 AgentSpace 工具箱里，不进 pi 的全局目录；
//! 只有绑定到智能体后，`agentspace run` 才把它们复制进项目的 `.pi/`。

use clap::{Args, Subcommand};
use agentspace_core::extensions::{self, ExtensionInfo, ExtensionSourceKind};
use agentspace_core::marketplace;
use agentspace_core::Paths;

use crate::commands::block_on;
use crate::output::{self, Format};

/// 退出码：0 成功，1 操作失败，2 参数不对，3 找不到。
const EXIT_OK: u8 = 0;
const EXIT_FAIL: u8 = 1;
const EXIT_INVALID: u8 = 2;
const EXIT_NOT_FOUND: u8 = 3;

#[derive(Subcommand, Debug)]
pub enum ExtensionCmd {
    /// 列出已安装的扩展
    List(ListArgs),
    /// 看一个扩展的详情
    Get(GetArgs),
    /// 从 npm 装一个扩展到工具箱
    Install(InstallArgs),
    /// 卸掉工具箱里的一个扩展（npm 或自定义）
    Remove(RemoveArgs),
    /// 新建一个自定义扩展（用模板打底）
    Create(CreateArgs),
    /// 读一个自定义扩展的源码
    Read(ReadArgs),
    /// 写一个自定义扩展的源码
    Write(WriteArgs),
    /// 给自定义扩展装 npm 依赖
    Deps(DepsArgs),
    /// 打印新扩展的模板代码
    Template,
    /// 启用一个扩展
    Enable(PathArgs),
    /// 停用一个扩展
    Disable(PathArgs),
    /// 搜扩展市场（npm registry 上的 pi 扩展包）
    Search(SearchArgs),
}

#[derive(Args, Debug)]
pub struct ListArgs {
    /// 只看某一组（builtin / npm / custom）
    #[arg(long)]
    source: Option<String>,
    /// 输出格式
    #[arg(long, value_enum, default_value = "text")]
    format: Format,
    /// 输出 JSON（等价于 --format json）
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug)]
pub struct GetArgs {
    /// 扩展名（npm 的给包名或扁平目录名，自定义的给名字）
    name: String,
    /// 输出格式
    #[arg(long, value_enum, default_value = "text")]
    format: Format,
    /// 输出 JSON（等价于 --format json）
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug)]
pub struct InstallArgs {
    /// npm 包名（如 pi-subagents / @scope/pkg）
    package: String,
    /// 输出格式
    #[arg(long, value_enum, default_value = "text")]
    format: Format,
    /// 输出 JSON（等价于 --format json）
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug)]
pub struct RemoveArgs {
    /// 扩展名（npm 的给包名或扁平目录名，自定义的给名字）
    name: Option<String>,
    /// 直接按路径删（不限 npm / 自定义）
    #[arg(long)]
    path: Option<String>,
    /// 哪一组（npm / custom）。不给就自己找
    #[arg(long)]
    source: Option<String>,
    /// 输出格式
    #[arg(long, value_enum, default_value = "text")]
    format: Format,
    /// 输出 JSON（等价于 --format json）
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug)]
pub struct CreateArgs {
    /// 扩展名（自定义扩展的名字）
    name: String,
    /// 覆盖已有的同名扩展
    #[arg(long)]
    force: bool,
    /// 输出格式
    #[arg(long, value_enum, default_value = "text")]
    format: Format,
    /// 输出 JSON（等价于 --format json）
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug)]
pub struct ReadArgs {
    /// 扩展名（自定义扩展的名字）
    name: String,
}

#[derive(Args, Debug)]
pub struct WriteArgs {
    /// 扩展名（自定义扩展的名字）
    name: String,
    /// 源码文件（不给就从标准输入读）
    #[arg(long, short)]
    file: Option<String>,
}

#[derive(Args, Debug)]
pub struct DepsArgs {
    /// 扩展名（自定义扩展的名字）
    name: String,
    /// 要装的包（可多个）
    #[arg(required = true)]
    packages: Vec<String>,
    /// 输出格式
    #[arg(long, value_enum, default_value = "text")]
    format: Format,
    /// 输出 JSON（等价于 --format json）
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug)]
pub struct PathArgs {
    /// 扩展文件的路径（`extension list` 里能看到）
    path: String,
}

#[derive(Args, Debug)]
pub struct SearchArgs {
    /// 关键词（不给就列出整个市场）
    query: Option<String>,
    /// 这一页取多少条
    #[arg(long, default_value_t = 20)]
    limit: usize,
    /// 跳过前多少条（翻页用）
    #[arg(long, default_value_t = 0)]
    offset: usize,
    /// 输出格式
    #[arg(long, value_enum, default_value = "text")]
    format: Format,
    /// 输出 JSON（等价于 --format json）
    #[arg(long)]
    json: bool,
}

impl ExtensionCmd {
    pub fn run(self, paths: &Paths) -> u8 {
        match self {
            ExtensionCmd::List(args) => list(paths, &args),
            ExtensionCmd::Get(args) => get(paths, &args),
            ExtensionCmd::Install(args) => install(paths, &args),
            ExtensionCmd::Remove(args) => remove(paths, &args),
            ExtensionCmd::Create(args) => create(paths, &args),
            ExtensionCmd::Read(args) => read(paths, &args),
            ExtensionCmd::Write(args) => write(paths, &args),
            ExtensionCmd::Deps(args) => deps(paths, &args),
            ExtensionCmd::Template => template(),
            ExtensionCmd::Enable(args) => set_enabled(&args, true),
            ExtensionCmd::Disable(args) => set_enabled(&args, false),
            ExtensionCmd::Search(args) => search(&args),
        }
    }
}

/// Pi 的全局扩展目录（不能删的东西都在这）。
fn pi_extension_dir(paths: &Paths) -> Option<std::path::PathBuf> {
    Some(extensions::agent_dir(paths).join("extensions"))
}

/// 已安装的扩展（当前目录的项目扩展也算）。
fn installed(paths: &Paths) -> Vec<ExtensionInfo> {
    let project = std::env::current_dir().ok();
    extensions::list_installed(paths, project.as_deref())
}

/// 按名字找一个扩展。
///
/// npm 的可以用包名（`@scope/pkg`）或扁平目录名（`@scope-pkg`）——
/// 用户两个都习惯用。
fn find<'a>(installed: &'a [ExtensionInfo], name: &str) -> Option<&'a ExtensionInfo> {
    let wanted = name.trim();
    let flat = extensions::flat_dir_name(wanted);
    installed
        .iter()
        .find(|item| {
            item.name == wanted
                || item.name == flat
                || item.package.as_deref() == Some(wanted)
                || item.path
                    .file_name()
                    .map(|n| n.to_string_lossy() == flat)
                    .unwrap_or(false)
        })
        .or_else(|| {
            // 按目录名找（npm 的目录是扁平的）
            installed.iter().find(|item| {
                item.path
                    .file_stem()
                    .map(|n| n.to_string_lossy() == wanted)
                    .unwrap_or(false)
            })
        })
}

fn list(paths: &Paths, args: &ListArgs) -> u8 {
    let mut items = installed(paths);
    if let Some(source) = args.source.as_deref() {
        let Some(kind) = parse_source(source) else {
            eprintln!("来源只能是 builtin / npm / custom");
            return EXIT_INVALID;
        };
        items.retain(|item| item.source == kind);
    }
    if output::wants_json(args.format, args.json) {
        output::json(&items);
        return EXIT_OK;
    }
    if items.is_empty() {
        println!("没找到扩展。");
        return EXIT_OK;
    }
    let rows: Vec<Vec<String>> = items
        .iter()
        .map(|item| {
            vec![
                item.name.clone(),
                item.source.label().to_string(),
                if item.enabled { "启用" } else { "停用" }.to_string(),
                format_size(item.size),
                item.path.display().to_string(),
            ]
        })
        .collect();
    output::table(&["名称", "来源", "状态", "大小", "路径"], &rows);
    println!();
    println!("共 {} 个扩展。", items.len());
    EXIT_OK
}

fn get(paths: &Paths, args: &GetArgs) -> u8 {
    let items = installed(paths);
    let Some(item) = find(&items, &args.name) else {
        if output::wants_json(args.format, args.json) {
            output::json(&serde_json::json!({ "error": format!("没找到扩展：{}", args.name) }));
        } else {
            eprintln!("没找到扩展：{}", args.name);
        }
        return EXIT_NOT_FOUND;
    };
    if output::wants_json(args.format, args.json) {
        output::json(item);
        return EXIT_OK;
    }
    println!("名称：{}", item.name);
    println!("来源：{}", item.source.label());
    println!("状态：{}", if item.enabled { "启用" } else { "停用" });
    println!("大小：{}", format_size(item.size));
    println!("路径：{}", item.path.display());
    if let Some(package) = &item.package {
        println!("包名：{package}");
    }
    println!("可绑定：{}", if item.source.bindable() { "是" } else { "否（Pi 自带，运行时自己加载）" });
    EXIT_OK
}

fn install(paths: &Paths, args: &InstallArgs) -> u8 {
    match extensions::install_from_npm(paths, &args.package) {
        Ok(info) => {
            if output::wants_json(args.format, args.json) {
                output::json(&info);
            } else {
                println!("已安装 {} → {}", info.name, info.path.display());
            }
            EXIT_OK
        }
        Err(error) => {
            if output::wants_json(args.format, args.json) {
                output::json(&serde_json::json!({ "error": error }));
            } else {
                eprintln!("安装失败：{error}");
            }
            EXIT_FAIL
        }
    }
}

fn remove(paths: &Paths, args: &RemoveArgs) -> u8 {
    // 按路径删 —— 不限 npm / 自定义
    if let Some(path) = args.path.as_deref() {
        let target = std::path::PathBuf::from(path);
        // Pi 自带目录里的东西不删 —— 那是 pi 自己的扩展，删了 pi 起不来。
        // 用户想停用它用 `extension disable`（改名加 .disabled）。
        if let Some(pi_dir) = pi_extension_dir(paths) {
            if target.starts_with(&pi_dir) {
                eprintln!(
                    "{} 在 Pi 的全局目录里，不能删 —— 用 `agentspace extension disable` 停用它。",
                    target.display()
                );
                return EXIT_FAIL;
            }
        }
        if !target.exists() {
            eprintln!("没找到：{}", target.display());
            return EXIT_NOT_FOUND;
        }
        return match extensions::remove(&target) {
            Ok(()) => {
                if output::wants_json(args.format, args.json) {
                    output::json(&serde_json::json!({ "ok": true, "message": "已删除" }));
                } else {
                    println!("已删除 {}", target.display());
                }
                EXIT_OK
            }
            Err(error) => {
                if output::wants_json(args.format, args.json) {
                    output::json(&serde_json::json!({ "error": error }));
                } else {
                    eprintln!("删除失败：{error}");
                }
                EXIT_FAIL
            }
        };
    }

    let Some(name) = args.name.as_deref() else {
        eprintln!("要给扩展名，或者用 --path 指定路径。");
        return EXIT_INVALID;
    };

    // 先按名字找 —— 找出它在哪一组，别让用户指定
    let items = installed(paths);
    let kind = match args.source.as_deref() {
        Some(source) => match parse_source(source) {
            Some(kind) => kind,
            None => {
                eprintln!("来源只能是 npm / custom");
                return EXIT_INVALID;
            }
        },
        None => match find(&items, name) {
            Some(item) if item.source.bindable() => item.source,
            Some(item) => {
                eprintln!("{} 是 Pi 自带的扩展，不能在这里删。", item.name);
                return EXIT_FAIL;
            }
            None => {
                eprintln!("没找到扩展：{name}");
                return EXIT_NOT_FOUND;
            }
        },
    };
    if kind == ExtensionSourceKind::Builtin {
        eprintln!("Pi 自带的扩展不能在这里删。");
        return EXIT_FAIL;
    }
    match extensions::remove_from_library(paths, kind, name) {
        Ok(()) => {
            if output::wants_json(args.format, args.json) {
                output::json(&serde_json::json!({ "ok": true, "message": "已删除" }));
            } else {
                println!("已删除 {}", name);
            }
            EXIT_OK
        }
        Err(error) => {
            if output::wants_json(args.format, args.json) {
                output::json(&serde_json::json!({ "error": error }));
            } else {
                eprintln!("删除失败：{error}");
            }
            EXIT_FAIL
        }
    }
}

fn create(paths: &Paths, args: &CreateArgs) -> u8 {
    let target = extensions::library_dir(paths)
        .join("custom")
        .join(args.name.trim())
        .join("index.ts");
    if target.exists() && !args.force {
        eprintln!("已存在同名扩展：{}（要覆盖加 --force）", args.name);
        return EXIT_FAIL;
    }
    match extensions::write_custom(paths, &args.name, extensions::TEMPLATE) {
        Ok(path) => {
            if output::wants_json(args.format, args.json) {
                output::json(&serde_json::json!({ "ok": true, "path": path.display().to_string() }));
            } else {
                println!("已创建 {} → {}", args.name, path.display());
                println!("改完用 `agentspace extension write {} --file <源码>` 写进去。", args.name);
            }
            EXIT_OK
        }
        Err(error) => {
            if output::wants_json(args.format, args.json) {
                output::json(&serde_json::json!({ "error": error }));
            } else {
                eprintln!("创建失败：{error}");
            }
            EXIT_FAIL
        }
    }
}

fn read(paths: &Paths, args: &ReadArgs) -> u8 {
    match extensions::read_custom(paths, &args.name) {
        Ok(code) => {
            print!("{code}");
            EXIT_OK
        }
        Err(error) => {
            eprintln!("读取失败：{error}");
            EXIT_FAIL
        }
    }
}

fn write(paths: &Paths, args: &WriteArgs) -> u8 {
    let code = match args.file.as_deref() {
        Some(file) => match std::fs::read_to_string(file) {
            Ok(text) => text,
            Err(error) => {
                eprintln!("读文件失败：{error}");
                return EXIT_FAIL;
            }
        },
        None => {
            use std::io::Read;
            let mut buffer = String::new();
            if let Err(error) = std::io::stdin().read_to_string(&mut buffer) {
                eprintln!("读标准输入失败：{error}");
                return EXIT_FAIL;
            }
            buffer
        }
    };
    match extensions::write_custom(paths, &args.name, &code) {
        Ok(path) => {
            println!("已保存 {}", path.display());
            EXIT_OK
        }
        Err(error) => {
            eprintln!("写入失败：{error}");
            EXIT_FAIL
        }
    }
}

/// 给自定义扩展装 npm 依赖。
///
/// 依赖装在扩展自己的 `node_modules/` 里 —— node 靠「从扩展文件往上找
/// node_modules」解析。落地到项目时整个目录一起复制，依赖也就跟着走了。
fn deps(paths: &Paths, args: &DepsArgs) -> u8 {
    match extensions::install_custom_dependencies(paths, &args.name, &args.packages) {
        Ok(()) => {
            if output::wants_json(args.format, args.json) {
                output::json(&serde_json::json!({
                    "ok": true,
                    "name": args.name,
                    "packages": args.packages,
                }));
            } else {
                println!("已给「{}」装上：{}", args.name, args.packages.join("、"));
            }
            EXIT_OK
        }
        Err(error) => {
            if output::wants_json(args.format, args.json) {
                output::json(&serde_json::json!({ "error": error }));
            } else {
                eprintln!("装依赖失败：{error}");
            }
            EXIT_FAIL
        }
    }
}

fn template() -> u8 {
    print!("{}", extensions::TEMPLATE);
    EXIT_OK
}

fn set_enabled(args: &PathArgs, enabled: bool) -> u8 {
    let path = std::path::PathBuf::from(&args.path);
    match extensions::set_enabled(&path, enabled) {
        Ok(()) => {
            println!("{}", if enabled { "已启用" } else { "已停用" });
            EXIT_OK
        }
        Err(error) => {
            eprintln!("操作失败：{error}");
            EXIT_FAIL
        }
    }
}

fn search(args: &SearchArgs) -> u8 {
    let result = block_on(marketplace::search(
        args.query.as_deref().unwrap_or(""),
        args.limit,
        args.offset,
    ));
    match result {
        Ok(result) => {
            if output::wants_json(args.format, args.json) {
                output::json(&result);
                return EXIT_OK;
            }
            if result.packages.is_empty() {
                println!("没搜到。");
                return EXIT_OK;
            }
            let rows: Vec<Vec<String>> = result
                .packages
                .iter()
                .map(|item| {
                    vec![
                        item.name.clone(),
                        item.version.clone(),
                        format_count(item.weekly_downloads),
                        item.description.clone(),
                    ]
                })
                .collect();
            output::table(&["包名", "版本", "周下载", "描述"], &rows);
            println!();
            println!("共 {} 个结果（本页 {} 个，从第 {} 条开始）。", result.total, result.packages.len(), result.offset);
            EXIT_OK
        }
        Err(error) => {
            if output::wants_json(args.format, args.json) {
                output::json(&serde_json::json!({ "error": error }));
            } else {
                eprintln!("搜索失败：{error}");
            }
            EXIT_FAIL
        }
    }
}

fn parse_source(source: &str) -> Option<ExtensionSourceKind> {
    match source.trim().to_ascii_lowercase().as_str() {
        "builtin" | "built-in" | "pi" => Some(ExtensionSourceKind::Builtin),
        "npm" => Some(ExtensionSourceKind::Npm),
        "custom" => Some(ExtensionSourceKind::Custom),
        _ => None,
    }
}

fn format_size(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = 1024 * 1024;
    if bytes >= MB {
        format!("{:.1} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.1} KB", bytes as f64 / KB as f64)
    } else {
        format!("{bytes} B")
    }
}

fn format_count(count: u64) -> String {
    if count >= 1_000_000 {
        format!("{:.1}M", count as f64 / 1_000_000.0)
    } else if count >= 1_000 {
        format!("{:.1}K", count as f64 / 1_000.0)
    } else {
        count.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_source_kinds() {
        assert_eq!(parse_source("npm"), Some(ExtensionSourceKind::Npm));
        assert_eq!(parse_source("Custom"), Some(ExtensionSourceKind::Custom));
        assert_eq!(parse_source("builtin"), Some(ExtensionSourceKind::Builtin));
        assert_eq!(parse_source("乱写"), None);
    }

    #[test]
    fn formats_sizes() {
        assert_eq!(format_size(512), "512 B");
        assert_eq!(format_size(2048), "2.0 KB");
        assert_eq!(format_size(3 * 1024 * 1024), "3.0 MB");
    }

    #[test]
    fn formats_counts() {
        assert_eq!(format_count(999), "999");
        assert_eq!(format_count(1500), "1.5K");
        assert_eq!(format_count(2_000_000), "2.0M");
    }
}
