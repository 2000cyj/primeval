//! `agentspace skill ...` —— Skill 仓库。
//!
//! 对应桌面端的「Skills」页。
//!
//! 逻辑都在共享 core（`agentspace_core::skills`）里，这里只管参数和输出。

use clap::{Args, Subcommand};
use agentspace_core::{github, pi_settings, skills, Paths};

use crate::output::{self, Format};

#[derive(Subcommand, Debug)]
pub enum SkillCmd {
    /// 列出全部 skill
    List(ListArgs),
    /// 看一个 skill 的详情（含文件清单与正文）
    Get(GetArgs),
    /// 手动创建一个 skill
    Create(CreateArgs),
    /// 改 skill 的名字、描述或正文
    Update(UpdateArgs),
    /// 删一个 skill
    Delete(DeleteArgs),
    /// 复制一个 skill
    Duplicate(DuplicateArgs),
    /// 启用
    Enable(NameArgs),
    /// 停用
    Disable(NameArgs),
    /// 从来源刷新（本地路径或网址）
    Refresh(NameArgs),
    /// 从本地目录或网址导入
    Import(ImportArgs),
    /// 从 pi 项目的配置里导入 package 带的 skill
    ImportFromPi(ImportFromPiArgs),
    /// 从 GitHub 仓库导入
    Github(GithubArgs),
    /// 列出从 git 仓库导入过的仓库
    Repos(ReposArgs),
    /// 管理 skill 里的文件
    #[command(subcommand)]
    Files(FileCmd),
}

#[derive(Args, Debug)]
pub struct GithubArgs {
    /// GitHub 仓库地址（https://github.com/owner/repo）
    repo: String,
    /// 分支（不给就用 main）
    #[arg(long)]
    branch: Option<String>,
    /// 只列分支，不扫仓库
    #[arg(long)]
    branches: bool,
    /// 真的导入（不给就只列出来 —— 误用不会把一堆 skill 拉进来）
    #[arg(long)]
    import: bool,
    /// 导入哪些 skill（按名字或仓库里的相对路径，可重复）
    #[arg(long)]
    skill: Vec<String>,
    /// 输出格式
    #[arg(long, value_enum, default_value = "text")]
    format: Format,
}

#[derive(Args, Debug)]
pub struct ReposArgs {
    /// 输出格式
    #[arg(long, value_enum, default_value = "text")]
    format: Format,
    /// 输出 JSON（等价于 --format json）
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug)]
pub struct ImportFromPiArgs {
    /// pi 项目的目录（含 .pi/）
    #[arg(default_value = ".")]
    project: String,
    /// 只看会导入什么
    #[arg(long)]
    dry_run: bool,
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
    /// skill 名字
    name: String,
}

#[derive(Args, Debug)]
pub struct GetArgs {
    /// skill 名字
    name: String,
    /// 输出格式
    #[arg(long, value_enum, default_value = "text")]
    format: Format,
    /// 输出 JSON（等价于 --format json）
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug)]
pub struct CreateArgs {
    /// skill 名字
    name: String,
    /// 描述
    #[arg(long, default_value = "")]
    description: String,
    /// 指令正文（SKILL.md 的正文部分）
    #[arg(long, default_value = "")]
    body: String,
}

#[derive(Args, Debug)]
pub struct UpdateArgs {
    /// skill 名字
    name: String,
    /// 改成新名字
    #[arg(long = "new-name")]
    new_name: Option<String>,
    /// 改描述
    #[arg(long)]
    description: Option<String>,
    /// 改正文
    #[arg(long)]
    body: Option<String>,
}

#[derive(Args, Debug)]
pub struct DeleteArgs {
    /// skill 名字
    name: String,
    /// 不确认，直接删
    #[arg(long)]
    yes: bool,
}

#[derive(Args, Debug)]
pub struct DuplicateArgs {
    /// skill 名字
    name: String,
    /// 新名字
    new_name: String,
}

#[derive(Args, Debug)]
pub struct ImportArgs {
    /// 本地目录，或 http(s) 网址
    source: String,
    /// 目录里有多个 skill 时全部导入（默认只导一个）
    #[arg(long)]
    all: bool,
}

#[derive(Subcommand, Debug)]
pub enum FileCmd {
    /// 列出 skill 里的文件
    List(GetArgs),
    /// 读一个文件
    Read {
        /// skill 名字
        name: String,
        /// 相对路径
        path: String,
    },
    /// 写一个文件（不存在就建）
    Write {
        /// skill 名字
        name: String,
        /// 相对路径
        path: String,
        /// 内容
        content: String,
    },
    /// 删一个文件
    Delete {
        /// skill 名字
        name: String,
        /// 相对路径
        path: String,
    },
}

impl SkillCmd {
    pub fn run(self, paths: &Paths) -> u8 {
        match self {
            SkillCmd::List(args) => list(paths, args),
            SkillCmd::Get(args) => get(paths, args),
            SkillCmd::Create(args) => create(paths, args),
            SkillCmd::Update(args) => update(paths, args),
            SkillCmd::Delete(args) => delete(paths, args),
            SkillCmd::Duplicate(args) => duplicate(paths, args),
            SkillCmd::Enable(args) => set_enabled(paths, args, true),
            SkillCmd::Disable(args) => set_enabled(paths, args, false),
            SkillCmd::Refresh(args) => refresh(paths, args),
            SkillCmd::Import(args) => import(paths, args),
            SkillCmd::ImportFromPi(args) => import_from_pi(paths, args),
            SkillCmd::Github(args) => from_github(paths, args),
            SkillCmd::Repos(args) => repos(paths, args),
            SkillCmd::Files(cmd) => files(paths, cmd),
        }
    }
}

fn list(paths: &Paths, args: ListArgs) -> u8 {
    let items = match skills::skills_list(paths) {
        Ok(items) => items,
        Err(error) => {
            eprintln!("读取 skill 列表失败：{error}");
            return 1;
        }
    };
    if output::wants_json(args.format, args.json) {
        output::json(&items);
        return 0;
    }
    if items.is_empty() {
        println!("还没有 skill。");
        return 0;
    }
    let rows: Vec<Vec<String>> = items
        .iter()
        .map(|item| {
            vec![
                item.name.clone(),
                if item.enabled { "启用".into() } else { "停用".into() },
                item.source.clone(),
                format!("{} 个文件", item.file_count),
                item.description.clone(),
            ]
        })
        .collect();
    output::table(&["名称", "状态", "来源", "文件", "描述"], &rows);
    0
}

fn get(paths: &Paths, args: GetArgs) -> u8 {
    let detail = match skills::skills_read(paths, args.name.clone()) {
        Ok(detail) => detail,
        Err(error) => {
            eprintln!("{error}");
            return 3;
        }
    };
    if output::wants_json(args.format, args.json) {
        output::json(&detail);
        return 0;
    }
    println!("名称：{}", detail.name);
    println!("描述：{}", detail.description);
    println!("来源：{}", detail.source);
    println!(
        "状态：{}",
        if detail.enabled { "启用" } else { "停用" }
    );
    println!("路径：{}", detail.path);
    println!("文件：");
    for file in &detail.files {
        println!("  - {}（{} 字节）", file.rel, file.size);
    }
    println!("正文：");
    println!("{}", detail.content.trim());
    0
}

fn create(paths: &Paths, args: CreateArgs) -> u8 {
    match skills::skills_create_manual(
        paths,
        args.name.clone(),
        args.description.clone(),
    ) {
        Ok(info) => {
            // 正文另写 —— create_manual 生成的是模板
            if !args.body.trim().is_empty() {
                if let Err(error) = skills::skills_update(
                    paths,
                    info.name.clone(),
                    None,
                    None,
                    Some(args.body.clone()),
                ) {
                    eprintln!("写入正文失败：{error}");
                }
            }
            println!("已创建 skill「{}」（{}）", info.name, info.relative_path);
            0
        }
        Err(error) => {
            eprintln!("创建失败：{error}");
            1
        }
    }
}

fn update(paths: &Paths, args: UpdateArgs) -> u8 {
    match skills::skills_update(
        paths,
        args.name.clone(),
        args.new_name.clone(),
        args.description.clone(),
        args.body.clone(),
    ) {
        Ok(info) => {
            println!("已更新 skill「{}」", info.name);
            0
        }
        Err(error) => {
            eprintln!("更新失败：{error}");
            1
        }
    }
}

fn delete(paths: &Paths, args: DeleteArgs) -> u8 {
    if !args.yes
        && !crate::commands::agent::confirm(&format!("确定删掉 skill「{}」？", args.name))
    {
        println!("已取消。");
        return 0;
    }
    match skills::skills_remove(paths, args.name.clone()) {
        Ok(()) => {
            println!("已删除 skill「{}」", args.name);
            0
        }
        Err(error) => {
            eprintln!("删除失败：{error}");
            1
        }
    }
}

fn duplicate(paths: &Paths, args: DuplicateArgs) -> u8 {
    match skills::skills_duplicate(paths, args.name.clone(), args.new_name.clone()) {
        Ok(info) => {
            println!("已复制为「{}」", info.name);
            0
        }
        Err(error) => {
            eprintln!("复制失败：{error}");
            1
        }
    }
}

fn set_enabled(paths: &Paths, args: NameArgs, enabled: bool) -> u8 {
    match skills::skills_set_enabled(paths, args.name.clone(), enabled) {
        Ok(()) => {
            println!(
                "已{} skill「{}」",
                if enabled { "启用" } else { "停用" },
                args.name
            );
            0
        }
        Err(error) => {
            eprintln!("操作失败：{error}");
            1
        }
    }
}

fn refresh(paths: &Paths, args: NameArgs) -> u8 {
    let name = args.name.clone();
    let result = crate::commands::block_on(async move {
        skills::skills_refresh(paths, name).await
    });
    match result {
        Ok(info) => {
            println!("已刷新 skill「{}」", info.name);
            0
        }
        Err(error) => {
            eprintln!("刷新失败：{error}");
            1
        }
    }
}

fn import(paths: &Paths, args: ImportArgs) -> u8 {
    let source = args.source.trim().to_string();
    // 网址只能导一个
    let is_url = source.starts_with("http://") || source.starts_with("https://");
    if is_url {
        let result = crate::commands::block_on(async move {
            skills::skills_import_url(paths, source).await
        });
        return match result {
            Ok(info) => {
                println!("已导入 skill「{}」（{}）", info.name, info.relative_path);
                0
            }
            Err(error) => {
                eprintln!("导入失败：{error}");
                1
            }
        };
    }

    if args.all {
        // 批量：目录里每个带 SKILL.md 的子目录都导
        match skills::skills_import_local_all(paths, source) {
            Ok(items) => {
                for info in &items {
                    println!("已导入 skill「{}」（{}）", info.name, info.relative_path);
                }
                println!("共导入 {} 个 skill。", items.len());
                0
            }
            Err(error) => {
                eprintln!("导入失败：{error}");
                1
            }
        }
    } else {
        match skills::skills_import_local(paths, source) {
            Ok(info) => {
                println!("已导入 skill「{}」（{}）", info.name, info.relative_path);
                0
            }
            Err(error) => {
                eprintln!("导入失败：{error}");
                1
            }
        }
    }
}

fn files(paths: &Paths, cmd: FileCmd) -> u8 {
    match cmd {
        FileCmd::List(args) => {
            let detail = match skills::skills_read(paths, args.name.clone()) {
                Ok(detail) => detail,
                Err(error) => {
                    eprintln!("{error}");
                    return 3;
                }
            };
            if output::wants_json(args.format, args.json) {
                output::json(&detail.files);
                return 0;
            }
            let rows: Vec<Vec<String>> = detail
                .files
                .iter()
                .map(|file| vec![file.rel.clone(), format!("{} 字节", file.size)])
                .collect();
            output::table(&["路径", "大小"], &rows);
            0
        }
        FileCmd::Read { name, path } => match skills::skills_read_file(paths, &name, &path) {
            Ok(content) => {
                output::text(&content);
                0
            }
            Err(error) => {
                eprintln!("读取失败：{error}");
                1
            }
        },
        FileCmd::Write {
            name,
            path,
            content,
        } => match skills::skills_write_file(paths, &name, &path, content.as_bytes()) {
            Ok(()) => {
                println!("已写入 {path}");
                0
            }
            Err(error) => {
                eprintln!("写入失败：{error}");
                1
            }
        },
        FileCmd::Delete { name, path } => {
            match skills::skills_delete_file(paths, &name, &path) {
                Ok(()) => {
                    println!("已删除 {path}");
                    0
                }
                Err(error) => {
                    eprintln!("删除失败：{error}");
                    1
                }
            }
        }
    }
}

/// 从 pi 项目的配置里导入 package 带的 skill。
///
/// pi 的 `.pi/settings.json` 用 `packages` 声明 skill，包本身由 pi 克隆到
/// `.pi/git/` 和 `.pi/npm/` 里。这里把那些 skill 收进我们的 skill 仓库。
fn import_from_pi(paths: &Paths, args: ImportFromPiArgs) -> u8 {
    let project = std::path::PathBuf::from(args.project.trim());
    let pi_dir = project.join(".pi");
    let settings_path = pi_dir.join("settings.json");
    if !settings_path.is_file() {
        eprintln!("找不到 {} —— 这不是一个 pi 项目目录。", settings_path.display());
        return 1;
    }
    let settings = match pi_settings::read_settings(&settings_path) {
        Ok(settings) => settings,
        Err(error) => {
            eprintln!("{error}");
            return 1;
        }
    };
    let resolved = pi_settings::resolve_skills(&settings, &pi_dir);
    if resolved.is_empty() {
        eprintln!(
            "没找到 skill —— {} 里声明的包可能还没克隆下来（先跑一次 pi）。",
            settings_path.display()
        );
        return 1;
    }

    if args.dry_run {
        println!("将会导入 {} 个 skill：", resolved.len());
        for item in &resolved {
            println!("  - {}（{}）", item.declared, item.package);
        }
        return 0;
    }

    // 按来源类型分派：
    // - git 源 → 自己 clone 仓库再导（不依赖 pi 的本地缓存，来源也记成 git）
    // - npm 源 → 包就装在 node_modules 里，直接从那儿导
    let mut imported = 0usize;
    let mut failed = Vec::new();
    for item in &resolved {
        let result = if item.package.starts_with("git:") {
            github::skills_import_git(paths, &item.package, &[item.declared.clone()])
                .map(|list| list.into_iter().next())
        } else {
            skills::skills_import_local(paths, item.dir.to_string_lossy().to_string())
                .map(Some)
        };
        match result {
            Ok(Some(info)) => {
                println!("已导入 skill「{}」（{}）", info.name, info.relative_path);
                imported += 1;
            }
            Ok(None) => {
                failed.push(format!("{}（没找到 skill）", item.declared));
            }
            Err(error) => {
                // 已存在同名 —— 不算失败，跳过
                if error.contains("已存在同名 skill") {
                    println!("已存在，跳过：{}", item.declared);
                    imported += 1;
                } else {
                    failed.push(format!("{}（{error}）", item.declared));
                }
            }
        }
    }
    if !failed.is_empty() {
        eprintln!("这些没导进来：");
        for item in &failed {
            eprintln!("  - {item}");
        }
    }
    println!("共处理 {imported} 个 skill。");
    if imported == 0 {
        return 1;
    }
    0
}

/// 从 GitHub 仓库导入 skill。
///
/// 流程跟 cc-switch 的「仓库管理」一样：填地址 → 选分支 → 列出 skill → 导入。
/// 列出从 git 仓库导入过的仓库。
///
/// 导入时来源就记在 skill 的 sidecar 里（`origin: {type: "git", …}`），
/// 这里按「仓库 + ref」归拢 —— 同一个仓库导过多次算一条。
fn repos(paths: &Paths, args: ReposArgs) -> u8 {
    let items = match skills::skills_git_repos(paths) {
        Ok(items) => items,
        Err(error) => {
            eprintln!("读仓库列表失败：{error}");
            return 1;
        }
    };
    if output::wants_json(args.format, args.json) {
        output::json(&items);
        return 0;
    }
    if items.is_empty() {
        println!("还没从 git 仓库导入过 skill。");
        return 0;
    }
    let rows: Vec<Vec<String>> = items
        .iter()
        .map(|item| {
            vec![
                item.source_url.clone(),
                item.source_ref.clone().unwrap_or_else(|| "(默认分支)".to_string()),
                item.skills.len().to_string(),
                item.skills.join("、"),
            ]
        })
        .collect();
    output::table(&["仓库", "ref", "数量", "已导入的 skill"], &rows);
    println!();
    println!("共 {} 个仓库。", items.len());
    println!("用 `agentspace skill github <仓库> --import` 可以再导一次。");
    0
}

fn from_github(paths: &Paths, args: GithubArgs) -> u8 {
    let repo = match github::parse_repo_url(&args.repo) {
        Some(repo) => repo,
        None => {
            eprintln!("看不出仓库地址：{}", args.repo);
            eprintln!("应该是 https://github.com/owner/repo");
            return 2;
        }
    };
    let branch = args
        .branch
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "main".to_string());

    // 只列分支
    if args.branches {
        return match github::list_branches(&repo) {
            Ok(branches) => {
                if output::wants_json(args.format, false) {
                    let names: Vec<serde_json::Value> = branches
                        .iter()
                        .map(|name| serde_json::json!({ "name": name }))
                        .collect();
                    output::json(&serde_json::json!({
                        "repo": repo.slug(),
                        "branches": names,
                    }));
                    return 0;
                }
                println!("{} —— {} 个分支：", repo.slug(), branches.len());
                for name in &branches {
                    println!("  {name}");
                }
                0
            }
            Err(error) => {
                eprintln!("读分支失败：{error}");
                1
            }
        };
    }

    // 列出仓库里的 skill
    let found = match github::discover_skills(paths, &repo, &branch) {
        Ok(found) => found,
        Err(error) => {
            eprintln!("读仓库失败：{error}");
            return 1;
        }
    };
    if found.is_empty() {
        eprintln!("分支 {branch} 里没找到 skill（仓库里要有带 SKILL.md 的目录）。");
        return 1;
    }

    // 默认只列出来 —— 导入要显式加 --import。
    // agent 误用参数时不会莫名其妙拉一堆 skill 进来。
    if !args.import {
        if output::wants_json(args.format, false) {
            let payload = serde_json::json!({
                "repo": repo.slug(),
                "branch": branch,
                "skills": found,
            });
            output::json(&payload);
            return 0;
        }
        println!("{} @ {} —— {} 个 skill：", repo.slug(), branch, found.len());
        for item in &found {
            println!("  - {}（{}）", item.name, item.path);
        }
        println!();
        println!("要导入就加 --import（可再用 --skill <名字> 挑其中几个）。");
        return 0;
    }

    // 导入：不给 --skill 就是全导
    let selected: Vec<String> = if args.skill.is_empty() {
        found.iter().map(|item| item.path.clone()).collect()
    } else {
        // 支持按名字或按仓库里的相对路径选
        found
            .iter()
            .filter(|item| {
                args.skill
                    .iter()
                    .any(|want| want == &item.name || want == &item.path)
            })
            .map(|item| item.path.clone())
            .collect()
    };
    if selected.is_empty() {
        eprintln!("没匹配到要导入的 skill。");
        eprintln!("仓库里有的：");
        for item in &found {
            eprintln!("  - {}", item.name);
        }
        return 2;
    }
    match github::import_skills(paths, &repo, &branch, &selected) {
        Ok(items) => {
            if output::wants_json(args.format, false) {
                output::json(&items);
                return 0;
            }
            for info in &items {
                println!("已导入 skill「{}」（{}）", info.name, info.relative_path);
            }
            println!("共导入 {} 个。", items.len());
            0
        }
        Err(error) => {
            eprintln!("导入失败：{error}");
            1
        }
    }
}
