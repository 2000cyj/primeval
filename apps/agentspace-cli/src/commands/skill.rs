//! `agentspace skill ...` —— Skill 仓库。
//!
//! 对应桌面端的「Skills」页。
//!
//! 逻辑都在共享 core（`agentspace_core::skills`）里，这里只管参数和输出。

use clap::{Args, Subcommand};
use agentspace_core::{skills, Paths};

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
    /// 管理 skill 里的文件
    #[command(subcommand)]
    Files(FileCmd),
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
    let result = crate::commands::block_on(async move {
        if source.starts_with("http://") || source.starts_with("https://") {
            skills::skills_import_url(paths, source).await
        } else {
            skills::skills_import_local(paths, source)
        }
    });
    match result {
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
