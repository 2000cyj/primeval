//! `agentspace wiki ...` —— 内部知识库（Wiki）。
//!
//! 对应桌面端的「Wiki」页。
//!
//! 逻辑都在共享 core（`agentspace_core::wiki`）里，这里只管参数和输出。
//!
//! ── 知识库是什么 ──────────────────────────────────────
//!
//! 一批 Markdown 页面，放在 `~/.agent-compose/wiki/<slug>/page.md`。
//! 页面之间可以用 `[[slug]]` 互相引用 —— 那些引用就是知识图谱的边，
//! 页面标题和标签则是弱关系。智能体可以绑定某个入口页面，
//! 连带继承它的子树，拿它当知识库用。

use clap::{Args, Subcommand};
use agentspace_core::{skills, wiki, Paths};

use crate::output::{self, Format};

#[derive(Subcommand, Debug)]
pub enum WikiCmd {
    /// 列出全部页面
    List(ListArgs),
    /// 看一个页面（元信息 + 正文）
    Get(GetArgs),
    /// 新建一个页面
    Create(CreateArgs),
    /// 改页面的标题、正文、标签或父页面
    Update(UpdateArgs),
    /// 删一个页面
    Delete(DeleteArgs),
    /// 检索页面
    Search(SearchArgs),
    /// 列出用过的全部标签
    Tags(ListArgs),
    /// 查一个页面的关联页面
    Neighbors(NeighborsArgs),
    /// 把一个页面发布成 Skill
    Publish(PublishArgs),
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
    /// 页面 slug
    slug: String,
    /// 输出格式
    #[arg(long, value_enum, default_value = "text")]
    format: Format,
    /// 输出 JSON（等价于 --format json）
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug)]
pub struct CreateArgs {
    /// 页面标题（slug 由标题生成）
    title: String,
    /// 父页面 slug（不给就是顶层页面）
    #[arg(long)]
    parent: Option<String>,
    /// 输出格式
    #[arg(long, value_enum, default_value = "text")]
    format: Format,
    /// 输出 JSON（等价于 --format json）
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug)]
pub struct UpdateArgs {
    /// 页面 slug
    slug: String,
    /// 新的标题
    #[arg(long)]
    title: Option<String>,
    /// 新的正文
    #[arg(long, conflicts_with = "body_file")]
    body: Option<String>,
    /// 从文件读正文（长文用这个）
    #[arg(long, conflicts_with = "body")]
    body_file: Option<String>,
    /// 新的标签（整体替换，可重复）
    #[arg(long)]
    tags: Vec<String>,
    /// 清空标签
    #[arg(long, conflicts_with = "tags")]
    clear_tags: bool,
    /// 新的父页面 slug
    #[arg(long)]
    parent: Option<String>,
    /// 提到顶层（去掉父页面）
    #[arg(long, conflicts_with = "parent")]
    no_parent: bool,
    /// 输出格式
    #[arg(long, value_enum, default_value = "text")]
    format: Format,
    /// 输出 JSON（等价于 --format json）
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug)]
pub struct DeleteArgs {
    /// 页面 slug
    slug: String,
    /// 不问，直接删
    #[arg(long)]
    yes: bool,
}

#[derive(Args, Debug)]
pub struct SearchArgs {
    /// 检索关键词
    query: String,
    /// 输出格式
    #[arg(long, value_enum, default_value = "text")]
    format: Format,
    /// 输出 JSON（等价于 --format json）
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug)]
pub struct NeighborsArgs {
    /// 页面 slug
    slug: String,
    /// 输出格式
    #[arg(long, value_enum, default_value = "text")]
    format: Format,
    /// 输出 JSON（等价于 --format json）
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug)]
pub struct PublishArgs {
    /// 页面 slug
    slug: String,
    /// 发布后的 skill 名字（不给就用页面标题）
    #[arg(long)]
    name: Option<String>,
    /// 输出格式
    #[arg(long, value_enum, default_value = "text")]
    format: Format,
    /// 输出 JSON（等价于 --format json）
    #[arg(long)]
    json: bool,
}

impl WikiCmd {
    pub fn run(self, paths: &Paths) -> u8 {
        match self {
            WikiCmd::List(args) => list(paths, args),
            WikiCmd::Get(args) => get(paths, args),
            WikiCmd::Create(args) => create(paths, args),
            WikiCmd::Update(args) => update(paths, args),
            WikiCmd::Delete(args) => delete(paths, args),
            WikiCmd::Search(args) => search(paths, args),
            WikiCmd::Tags(args) => tags(paths, args),
            WikiCmd::Neighbors(args) => neighbors(paths, args),
            WikiCmd::Publish(args) => publish(paths, args),
        }
    }
}

fn list(paths: &Paths, args: ListArgs) -> u8 {
    let pages = wiki::list_pages(paths);
    if output::wants_json(args.format, args.json) {
        output::json(&pages);
        return 0;
    }
    if pages.is_empty() {
        println!("知识库还是空的 —— 用 `agentspace wiki create <标题>` 建一页。");
        return 0;
    }
    let rows: Vec<Vec<String>> = pages
        .iter()
        .map(|page| {
            vec![
                page.title.clone(),
                page.slug.clone(),
                join_or_dash(&page.tags),
                page.parent.clone().unwrap_or_else(|| "-".to_string()),
                join_or_dash(&page.links),
            ]
        })
        .collect();
    output::table(&["标题", "slug", "标签", "父页面", "引用"], &rows);
    0
}

fn get(paths: &Paths, args: GetArgs) -> u8 {
    let page = match wiki::read_page(paths, &args.slug) {
        Ok(page) => page,
        Err(error) => {
            eprintln!("{error}");
            return 3;
        }
    };
    if output::wants_json(args.format, args.json) {
        output::json(&page);
        return 0;
    }
    println!("标题：{}", page.title);
    println!("slug：{}", page.slug);
    println!("标签：{}", join_or_dash(&page.tags));
    println!(
        "父页面：{}",
        page.parent.clone().unwrap_or_else(|| "-".to_string())
    );
    println!("引用：{}", join_or_dash(&page.links));
    println!("正文：");
    output::text(&page.content);
    0
}

fn create(paths: &Paths, args: CreateArgs) -> u8 {
    let page = match wiki::create_page(paths, &args.title, args.parent.clone()) {
        Ok(page) => page,
        Err(error) => {
            eprintln!("创建失败：{error}");
            return 1;
        }
    };
    if output::wants_json(args.format, args.json) {
        output::json(&page);
        return 0;
    }
    println!("已创建页面「{}」（{}）", page.title, page.slug);
    0
}

/// 改页面。
///
/// core 的 `save_page` 是**全量替换** —— 标题、正文、标签、父页面一次写全。
/// 所以这里先读当前值，再把用户改动的那几项换上去，其余照旧。
fn update(paths: &Paths, args: UpdateArgs) -> u8 {
    let current = match wiki::read_page(paths, &args.slug) {
        Ok(page) => page,
        Err(error) => {
            eprintln!("{error}");
            return 3;
        }
    };

    let title = args.title.clone().unwrap_or_else(|| current.title.clone());
    let content = match (&args.body, &args.body_file) {
        (Some(body), _) => body.clone(),
        (None, Some(path)) => match std::fs::read_to_string(path) {
            Ok(raw) => raw,
            Err(error) => {
                eprintln!("读正文文件失败：{error}");
                return 1;
            }
        },
        (None, None) => current.content.clone(),
    };
    // 标签：给了就整体替换；`--clear-tags` 清空；都没动就保持原样。
    let tags = if args.clear_tags {
        Vec::new()
    } else if !args.tags.is_empty() {
        args.tags.clone()
    } else {
        current.tags.clone()
    };
    // 父页面同理 —— `--no-parent` 提到顶层，`--parent` 换新的。
    let parent = if args.no_parent {
        None
    } else if let Some(parent) = &args.parent {
        Some(parent.clone())
    } else {
        current.parent.clone()
    };

    let page = match wiki::save_page(paths, &args.slug, &title, &content, &tags, parent) {
        Ok(page) => page,
        Err(error) => {
            eprintln!("保存失败：{error}");
            return 1;
        }
    };
    if output::wants_json(args.format, args.json) {
        output::json(&page);
        return 0;
    }
    println!("已保存页面「{}」（{}）", page.title, page.slug);
    0
}

fn delete(paths: &Paths, args: DeleteArgs) -> u8 {
    // 先看一眼标题 —— 确认框里给 slug 不如给标题好认。
    let title = wiki::title_of(paths, &args.slug)
        .unwrap_or_else(|| args.slug.clone());
    if !args.yes
        && !crate::commands::agent::confirm(&format!("确定删掉页面「{title}」？"))
    {
        println!("已取消。");
        return 0;
    }
    match wiki::delete_page(paths, &args.slug) {
        Ok(()) => {
            println!("已删除页面 {title}");
            0
        }
        Err(error) => {
            eprintln!("删除失败：{error}");
            1
        }
    }
}

fn search(paths: &Paths, args: SearchArgs) -> u8 {
    let hits = wiki::search_pages(paths, &args.query);
    if output::wants_json(args.format, args.json) {
        output::json(&hits);
        return 0;
    }
    if hits.is_empty() {
        println!("没找到与「{}」相关的页面。", args.query);
        return 0;
    }
    let rows: Vec<Vec<String>> = hits
        .iter()
        .map(|hit| {
            vec![
                hit.title.clone(),
                hit.slug.clone(),
                hit.line.to_string(),
                hit.snippet.clone(),
            ]
        })
        .collect();
    output::table(&["标题", "slug", "行", "片段"], &rows);
    0
}

fn tags(paths: &Paths, args: ListArgs) -> u8 {
    let all = wiki::all_tags(paths);
    if output::wants_json(args.format, args.json) {
        output::json(&all);
        return 0;
    }
    if all.is_empty() {
        println!("还没有标签。");
        return 0;
    }
    output::lines(&all);
    0
}

fn neighbors(paths: &Paths, args: NeighborsArgs) -> u8 {
    let related = match wiki::neighbors(paths, &args.slug) {
        Ok(related) => related,
        Err(error) => {
            eprintln!("{error}");
            return 3;
        }
    };
    if output::wants_json(args.format, args.json) {
        output::json(&related);
        return 0;
    }
    // 分组打印，空组不占行 —— 页面往往只有一两种关系。
    let mut printed = false;
    for (label, list) in [
        ("引用的页面", &related.outgoing),
        ("被引用的页面", &related.incoming),
        ("子页面", &related.children),
        ("同标签页面", &related.siblings),
    ] {
        if list.is_empty() {
            continue;
        }
        printed = true;
        println!("{label}：{}", join_or_dash(list));
    }
    if !printed {
        println!("这个页面还没有关联页面。");
    }
    0
}

fn publish(paths: &Paths, args: PublishArgs) -> u8 {
    let info: skills::SkillInfo = match wiki::publish_as_skill(paths, &args.slug, args.name.clone())
    {
        Ok(info) => info,
        Err(error) => {
            eprintln!("发布失败：{error}");
            return 1;
        }
    };
    if output::wants_json(args.format, args.json) {
        output::json(&info);
        return 0;
    }
    println!(
        "已发布为 skill「{}」（{}）",
        info.name, info.relative_path
    );
    0
}

/// 列表里的多值字段 —— 空的就显示个横杠，别留空位。
fn join_or_dash(items: &[String]) -> String {
    if items.is_empty() {
        "-".to_string()
    } else {
        items.join("、")
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
    fn parses_list_and_get() {
        let parsed = crate::Cli::try_parse_from(["agentspace", "wiki", "list"]).unwrap();
        assert!(matches!(parsed.command, crate::Command::Wiki(WikiCmd::List(_))));
        let parsed = crate::Cli::try_parse_from(["agentspace", "wiki", "get", "部署"]).unwrap();
        assert!(matches!(parsed.command, crate::Command::Wiki(WikiCmd::Get(_))));
    }

    #[test]
    fn update_rejects_body_and_body_file_together() {
        let result = crate::Cli::try_parse_from([
            "agentspace",
            "wiki",
            "update",
            "部署",
            "--body",
            "正文",
            "--body-file",
            "a.md",
        ]);
        assert!(result.is_err());
    }

    #[test]
    fn update_rejects_tags_and_clear_tags_together() {
        let result = crate::Cli::try_parse_from([
            "agentspace",
            "wiki",
            "update",
            "部署",
            "--tags",
            "运维",
            "--clear-tags",
        ]);
        assert!(result.is_err());
    }

    #[test]
    fn join_or_dash_marks_empty_lists() {
        assert_eq!(join_or_dash(&[]), "-");
        assert_eq!(
            join_or_dash(&["运维".to_string(), "发布".to_string()]),
            "运维、发布"
        );
    }
}
