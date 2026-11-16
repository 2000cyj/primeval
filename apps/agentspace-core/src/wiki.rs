//! 内置 Wiki：本地 Markdown 知识库。
//!
//! # 存哪
//!
//! ```text
//! ~/.agent-compose/wiki/<slug>/
//!   page.md      正文（Markdown 源码）
//!   .meta.json   { title, tags, parent, createdAt, updatedAt }
//! ```
//!
//! 为什么是「一个目录一个页面」而不是「一个文件一页」：
//! - 跟 skill 仓库的布局一致（那边也是 `<目录>/SKILL.md` + sidecar），
//!   两套心智模型统一，导入导出、备份的逻辑也能复用；
//! - 一个页面以后想带附件（图片、脚本）有地方放 —— 现在不放，将来也不用改结构。
//!
//! # 页面组织
//!
//! `parent` 字段构成一棵树（`parent: null` = 顶层）。
//! 树在**前端组** —— 后端只存扁平的 `parent` 引用，
//! 前端想按标签、按更新时间重排都不用改后端。
//!
//! # agent 怎么读
//!
//! Wiki 的内容就是 Markdown 文件，agent 通过 AgentSpace 自己的 MCP 端点读
//! （sidecar 里有 `wiki_list` / `wiki_read` / `wiki_search` 三个本地工具）。
//! 不用另起服务、不用改 agent 的配置 —— agent 本来就连着 AgentSpace。

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::paths::Paths;

/// 正文文件名。
pub const PAGE_FILE: &str = "page.md";

/// 元信息文件名（sidecar，跟 skill 仓库一个套路）。
const META_FILE: &str = ".meta.json";

/// 页面标题的默认上限（防止有人写一个 5000 字的标题）。
const MAX_TITLE_CHARS: usize = 200;

/// 一个页面的元信息（不含正文）。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WikiPageMeta {
    /// 唯一标识（目录名）。
    pub slug: String,
    /// 标题。
    pub title: String,
    /// 标签。
    pub tags: Vec<String>,
    /// 父页面 slug；`None` = 顶层。
    pub parent: Option<String>,
    /// 创建时间（epoch 毫秒）。
    pub created_at: u64,
    /// 最后修改时间（epoch 毫秒）。
    pub updated_at: u64,
}

impl Default for WikiPageMeta {
    fn default() -> Self {
        Self {
            slug: String::new(),
            title: String::new(),
            tags: Vec::new(),
            parent: None,
            created_at: 0,
            updated_at: 0,
        }
    }
}

/// 一个页面（含正文）。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WikiPage {
    pub slug: String,
    pub title: String,
    pub tags: Vec<String>,
    pub parent: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
    /// 正文（Markdown 源码）。
    pub content: String,
}

impl Default for WikiPage {
    fn default() -> Self {
        Self {
            slug: String::new(),
            title: String::new(),
            tags: Vec::new(),
            parent: None,
            created_at: 0,
            updated_at: 0,
            content: String::new(),
        }
    }
}

impl WikiPage {
    /// 元信息视图（列表用）。
    pub fn meta(&self) -> WikiPageMeta {
        WikiPageMeta {
            slug: self.slug.clone(),
            title: self.title.clone(),
            tags: self.tags.clone(),
            parent: self.parent.clone(),
            created_at: self.created_at,
            updated_at: self.updated_at,
        }
    }
}

/// 搜索命中。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiSearchHit {
    /// 页面 slug。
    pub slug: String,
    /// 页面标题。
    pub title: String,
    /// 命中行附近的文本片段。
    pub snippet: String,
    /// 命中的行号（从 1 开始）。
    pub line: usize,
}

/// Wiki 根目录。
pub fn wiki_root(paths: &Paths) -> PathBuf {
    paths.root().join("wiki")
}

/// 某个页面的目录。
fn page_dir(paths: &Paths, slug: &str) -> PathBuf {
    wiki_root(paths).join(slug)
}

/// 把标题转成目录名（slug）。
///
/// **保留中文** —— 用户的页面标题大概率是中文，全转成拼音或哈希就没法用了。
/// 只挡掉那些真会出问题的东西：
/// - 路径分隔符和 Windows 保留字符（`/ \ : * ? " < > |`）
/// - 空格（转成连字符）
/// - 结尾的点（Windows 不允许）
///
/// 重名时补一个短后缀（`note`, `note-2`, `note-3`…）。
pub fn slugify(title: &str) -> String {
    const RESERVED: &[char] = &['/', '\\', ':', '*', '?', '"', '<', '>', '|'];
    let mut out = String::new();
    let mut last_dash = true; // 开头不留下划线
    for ch in title.chars() {
        if RESERVED.contains(&ch) || ch.is_control() {
            // 路径分隔符类的当分隔符处理
            if !last_dash {
                out.push('-');
                last_dash = true;
            }
        } else if ch.is_whitespace() {
            if !last_dash {
                out.push('-');
                last_dash = true;
            }
        } else {
            out.push(ch);
            last_dash = false;
        }
    }
    // 结尾的点/空格在 Windows 上不行
    let trimmed = out.trim_matches('-').trim_end_matches(['.', ' ']).to_string();
    if trimmed.is_empty() {
        "page".to_string()
    } else {
        trimmed
    }
}

/// 保证 slug 在 wiki 里唯一。
///
/// 已存在就补后缀（`-2`、`-3`…）。这样两个同名标题不会互相覆盖。
fn unique_slug(paths: &Paths, base: &str) -> String {
    let root = wiki_root(paths);
    if !root.join(base).exists() {
        return base.to_string();
    }
    for n in 2..1000 {
        let candidate = format!("{base}-{n}");
        if !root.join(&candidate).exists() {
            return candidate;
        }
    }
    format!("{base}-{}", now_millis())
}

/// 当前时间（epoch 毫秒）。
fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 读元信息。
fn read_meta(dir: &Path) -> WikiPageMeta {
    let raw = fs::read_to_string(dir.join(META_FILE)).unwrap_or_default();
    serde_json::from_str::<WikiPageMeta>(&raw).unwrap_or_default()
}

/// 写元信息。
fn write_meta(dir: &Path, meta: &WikiPageMeta) -> Result<(), String> {
    let text = serde_json::to_vec_pretty(meta)
        .map_err(|e| format!("序列化页面信息失败：{e}"))?;
    fs::write(dir.join(META_FILE), text).map_err(|e| format!("写入页面信息失败：{e}"))
}

/// 列出所有页面（扁平的，按标题排序）。
pub fn list_pages(paths: &Paths) -> Vec<WikiPageMeta> {
    let root = wiki_root(paths);
    let Ok(entries) = fs::read_dir(&root) else {
        return Vec::new();
    };
    let mut out: Vec<WikiPageMeta> = Vec::new();
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        if !dir.join(PAGE_FILE).is_file() {
            continue;
        }
        let mut meta = read_meta(&dir);
        let Some(slug) = dir.file_name().map(|n| n.to_string_lossy().to_string()) else {
            continue;
        };
        meta.slug = slug;
        if meta.title.trim().is_empty() {
            meta.title = meta.slug.clone();
        }
        out.push(meta);
    }
    out.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    out
}

/// 读一个页面（含正文）。
pub fn read_page(paths: &Paths, slug: &str) -> Result<WikiPage, String> {
    let dir = page_dir(paths, slug);
    if !dir.is_dir() {
        return Err(format!("页面不存在：{slug}"));
    }
    let content = fs::read_to_string(dir.join(PAGE_FILE)).unwrap_or_default();
    let meta = read_meta(&dir);
    Ok(WikiPage {
        slug: slug.to_string(),
        title: if meta.title.trim().is_empty() {
            slug.to_string()
        } else {
            meta.title
        },
        tags: meta.tags,
        parent: meta.parent,
        created_at: meta.created_at,
        updated_at: meta.updated_at,
        content,
    })
}

/// 新建页面。
///
/// 正文是空的 —— 页面建出来之后去编辑器里写。
pub fn create_page(
    paths: &Paths,
    title: &str,
    parent: Option<String>,
) -> Result<WikiPage, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("标题不能为空".to_string());
    }
    let slug = unique_slug(paths, &slugify(title));
    let dir = page_dir(paths, &slug);
    fs::create_dir_all(&dir).map_err(|e| format!("创建页面目录失败：{e}"))?;

    let now = now_millis();
    let meta = WikiPageMeta {
        slug: slug.clone(),
        title: title.to_string(),
        tags: Vec::new(),
        parent: parent.filter(|p| !p.trim().is_empty()),
        created_at: now,
        updated_at: now,
    };
    write_meta(&dir, &meta)?;
    let body = format!("# {}\n\n", meta.title);
    fs::write(dir.join(PAGE_FILE), &body).map_err(|e| format!("写入页面失败：{e}"))?;

    Ok(WikiPage {
        slug,
        title: meta.title,
        tags: meta.tags,
        parent: meta.parent,
        created_at: now,
        updated_at: now,
        content: body,
    })
}

/// 保存页面（标题 / 正文 / 标签 / 父页面）。
pub fn save_page(
    paths: &Paths,
    slug: &str,
    title: &str,
    content: &str,
    tags: &[String],
    parent: Option<String>,
) -> Result<WikiPage, String> {
    let dir = page_dir(paths, slug);
    if !dir.is_dir() {
        return Err(format!("页面不存在：{slug}"));
    }
    let old = read_meta(&dir);
    let now = now_millis();

    let title = if title.trim().is_empty() {
        old.title.clone()
    } else {
        truncate_chars(title.trim(), MAX_TITLE_CHARS)
    };
    // 父页面不能指向自己（会成环）
    let parent = parent
        .filter(|p| !p.trim().is_empty() && p != slug)
        .and_then(|p| {
            // 父页面必须存在 —— 指向不存在的页面会让那页从树上消失
            if page_dir(paths, &p).is_dir() {
                Some(p)
            } else {
                None
            }
        });

    // 标签：去空、去重
    let mut clean_tags: Vec<String> = Vec::new();
    for tag in tags {
        let t = tag.trim();
        if t.is_empty() {
            continue;
        }
        if !clean_tags.iter().any(|existing| existing == t) {
            clean_tags.push(t.to_string());
        }
    }

    let meta = WikiPageMeta {
        slug: slug.to_string(),
        title,
        tags: clean_tags.clone(),
        parent: parent.clone(),
        created_at: if old.created_at == 0 { now } else { old.created_at },
        updated_at: now,
    };
    write_meta(&dir, &meta)?;
    fs::write(dir.join(PAGE_FILE), content).map_err(|e| format!("写入页面失败：{e}"))?;

    Ok(WikiPage {
        slug: slug.to_string(),
        title: meta.title,
        tags: meta.tags,
        parent: meta.parent,
        created_at: meta.created_at,
        updated_at: now,
        content: content.to_string(),
    })
}

/// 删页面。
///
/// 子页面的 `parent` 会被置空（提升到顶层）—— 不然它们会从树上消失，
/// 变成谁也找不到的孤儿。
pub fn delete_page(paths: &Paths, slug: &str) -> Result<(), String> {
    let dir = page_dir(paths, slug);
    if !dir.is_dir() {
        return Err(format!("页面不存在：{slug}"));
    }
    fs::remove_dir_all(&dir).map_err(|e| format!("删除页面失败：{e}"))?;

    // 孩子提升到顶层
    for meta in list_pages(paths) {
        if meta.parent.as_deref() == Some(slug) {
            let dir = page_dir(paths, &meta.slug);
            let mut updated = meta.clone();
            updated.parent = None;
            updated.updated_at = now_millis();
            let _ = write_meta(&dir, &updated);
        }
    }
    Ok(())
}

/// 搜索标题和正文。
///
/// 命中规则：大小写不敏感的子串匹配。标题命中优先（排前面），
/// 正文命中给出行号和片段。
pub fn search_pages(paths: &Paths, query: &str) -> Vec<WikiSearchHit> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Vec::new();
    }
    let mut out: Vec<WikiSearchHit> = Vec::new();

    for meta in list_pages(paths) {
        if meta.title.to_lowercase().contains(&needle) {
            out.push(WikiSearchHit {
                slug: meta.slug.clone(),
                title: meta.title.clone(),
                snippet: meta.title.clone(),
                line: 1,
            });
            // 标题命中了就不再看正文 —— 同一页出现两次没意义
            continue;
        }
        let Ok(page) = read_page(paths, &meta.slug) else {
            continue;
        };
        for (index, line) in page.content.lines().enumerate() {
            if line.to_lowercase().contains(&needle) {
                out.push(WikiSearchHit {
                    slug: meta.slug.clone(),
                    title: meta.title.clone(),
                    snippet: snippet_of(line),
                    line: index + 1,
                });
                // 一页最多给 3 条命中 —— 免得一大段重复内容刷屏
                let count = out.iter().filter(|hit| hit.slug == meta.slug).count();
                if count >= 3 {
                    break;
                }
            }
        }
    }
    out
}

/// 截断字符串（按字符，不切碎多字节）。
fn truncate_chars(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max).collect();
    out.push('…');
    out
}

/// 命中行的片段 —— 太长的行截一下，前后各留一点。
fn snippet_of(line: &str) -> String {
    let trimmed = line.trim();
    if trimmed.chars().count() <= 120 {
        return trimmed.to_string();
    }
    let chars: Vec<char> = trimmed.chars().collect();
    let start = chars.len() / 2 - 30;
    let end = (start + 60).min(chars.len());
    let mut out = String::from("…");
    out.extend(&chars[start..end]);
    out.push('…');
    out
}

/// 页面的直接子页面（按标题排序）。
pub fn children_of(paths: &Paths, parent: Option<&str>) -> Vec<WikiPageMeta> {
    let all = list_pages(paths);
    match parent {
        None => all.into_iter().filter(|m| m.parent.is_none()).collect(),
        Some(slug) => all
            .into_iter()
            .filter(|m| m.parent.as_deref() == Some(slug))
            .collect(),
    }
}

/// 按 slug 找标题（给「发布为 skill」这类场景用）。
pub fn title_of(paths: &Paths, slug: &str) -> Option<String> {
    let dir = page_dir(paths, slug);
    if !dir.is_dir() {
        return None;
    }
    Some(read_meta(&dir).title)
}

/// 页面里出现过的所有标签（给筛选器用）。
pub fn all_tags(paths: &Paths) -> Vec<String> {
    let mut counts: HashMap<String, usize> = HashMap::new();
    for meta in list_pages(paths) {
        for tag in meta.tags {
            *counts.entry(tag).or_insert(0) += 1;
        }
    }
    let mut tags: Vec<(String, usize)> = counts.into_iter().collect();
    tags.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    tags.into_iter().map(|(tag, _)| tag).collect()
}

/// 把一个 wiki 页面发布成 skill。
///
/// **为什么值得做**：skill 本质就是「agent 可读的 Markdown」。
/// wiki 里写的部署手册、排查步骤，发布成 skill 后就能直接绑到智能体上 ——
/// 不用把同样的内容在两个地方写一遍。
///
/// skill 名没给就用页面标题。
pub fn publish_as_skill(
    paths: &Paths,
    slug: &str,
    name: Option<String>,
) -> Result<crate::skills::SkillInfo, String> {
    let page = read_page(paths, slug)?;
    let skill_name = name
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| page.title.clone());
    if skill_name.is_empty() {
        return Err("skill 名不能为空".to_string());
    }

    let description = summarize(&page.content);
    let body = format!(
        "---\nname: {skill_name}\ndescription: {description}\n---\n\n{}",
        page.content.trim_start()
    );
    let files = vec![crate::skills::SkillFile::text("SKILL.md", body)];
    crate::skills::write_skill_public(paths, &skill_name, &description, "local", files)
}

/// 从正文里摘一段当描述。
///
/// skill 的描述是要给 agent 看的（决定它什么时候用这个 skill），
/// 所以得是「这篇文档讲什么」而不是首行标题。
fn summarize(content: &str) -> String {
    let mut lines = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        // 跳过标题、代码块围栏、空行
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with("```") {
            continue;
        }
        // 去掉行内的 Markdown 标记（链接、强调、代码）
        let plain = trimmed
            .replace("**", "")
            .replace('`', "")
            .replace('*', "")
            .replace("[", "")
            .replace("]", "")
            .replace("(", "")
            .replace(")", "");
        if !plain.is_empty() {
            lines.push(plain);
        }
        if lines.join(" ").chars().count() > 200 {
            break;
        }
    }
    let text = lines.join(" ");
    if text.is_empty() {
        return "来自 AgentSpace Wiki 的文档".to_string();
    }
    truncate_chars(&text, 300)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_paths(tag: &str) -> Paths {
        let dir = std::env::temp_dir().join(format!(
            "agentspace-wiki-{tag}-{}-{}",
            std::process::id(),
            now_millis()
        ));
        fs::create_dir_all(dir.join(".agent-compose")).unwrap();
        Paths::new(dir)
    }

    #[test]
    fn slugify_keeps_chinese_and_drops_path_separators() {
        // 中文保留 —— 页面标题大概率是中文，全转成 page 没法用
        assert_eq!(slugify("部署手册"), "部署手册");
        assert_eq!(slugify("  多个   空格  "), "多个-空格");
        assert_eq!(slugify("Hello World"), "Hello-World");
        // 路径分隔符不能进目录名
        assert_eq!(slugify("a/b"), "a-b");
        assert_eq!(slugify("a\\b"), "a-b");
        assert_eq!(slugify("a:b"), "a-b");
        // Windows 保留字符
        assert_eq!(slugify("a<b>c"), "a-b-c");
        // 空标题兜底
        assert_eq!(slugify(""), "page");
        assert_eq!(slugify("///"), "page");
        // 结尾的点（Windows 不允许）
        assert_eq!(slugify("名字."), "名字");
    }

    #[test]
    fn create_read_save_delete_roundtrip() {
        let paths = temp_paths("crud");
        let page = create_page(&paths, "部署手册", None).unwrap();
        assert_eq!(page.title, "部署手册");
        assert!(page.content.contains("部署手册"));

        // 保存
        let saved = save_page(
            &paths,
            &page.slug,
            "部署手册 v2",
            "# 内容\n\n正文",
            &["运维".to_string(), "运维".to_string(), " ".to_string()],
            None,
        )
        .unwrap();
        assert_eq!(saved.title, "部署手册 v2");
        // 标签去重去空
        assert_eq!(saved.tags, vec!["运维".to_string()]);

        let read = read_page(&paths, &page.slug).unwrap();
        assert_eq!(read.content, "# 内容\n\n正文");

        // 删除
        delete_page(&paths, &page.slug).unwrap();
        assert!(read_page(&paths, &page.slug).is_err());
        let _ = fs::remove_dir_all(paths.home());
    }

    #[test]
    fn same_title_gets_distinct_slugs() {
        let paths = temp_paths("dup");
        let a = create_page(&paths, "笔记", None).unwrap();
        let b = create_page(&paths, "笔记", None).unwrap();
        assert_ne!(a.slug, b.slug);
        // 两个页面都在
        assert_eq!(list_pages(&paths).len(), 2);
        let _ = fs::remove_dir_all(paths.home());
    }

    #[test]
    fn parent_must_exist_and_cannot_be_self() {
        let paths = temp_paths("parent");
        let parent = create_page(&paths, "父页", None).unwrap();
        let child = create_page(&paths, "子页", Some(parent.slug.clone())).unwrap();
        assert_eq!(child.parent.as_deref(), Some(parent.slug.as_str()));

        // 指向不存在的父页面 → 当成顶层
        let saved = save_page(&paths, &child.slug, "子页", "x", &[], Some("不存在".into())).unwrap();
        assert!(saved.parent.is_none());

        // 指向自己 → 忽略
        let saved = save_page(&paths, &child.slug, "子页", "x", &[], Some(child.slug.clone())).unwrap();
        assert!(saved.parent.is_none());
        let _ = fs::remove_dir_all(paths.home());
    }

    #[test]
    fn deleting_parent_promotes_children() {
        let paths = temp_paths("orphan");
        let parent = create_page(&paths, "父页", None).unwrap();
        let child = create_page(&paths, "子页", Some(parent.slug.clone())).unwrap();

        delete_page(&paths, &parent.slug).unwrap();

        let child_after = read_page(&paths, &child.slug).unwrap();
        assert!(child_after.parent.is_none(), "孩子应该被提升到顶层");
        let _ = fs::remove_dir_all(paths.home());
    }

    #[test]
    fn search_finds_title_and_body() {
        let paths = temp_paths("search");
        let page = create_page(&paths, "签名流程", None).unwrap();
        save_page(
            &paths,
            &page.slug,
            "签名流程",
            "第一步：生成密钥\n第二步：签名\n第三步：上传",
            &[],
            None,
        )
        .unwrap();

        let hits = search_pages(&paths, "签名");
        assert!(!hits.is_empty(), "应该搜到标题");
        assert_eq!(hits[0].slug, page.slug);

        let hits = search_pages(&paths, "第二步");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].line, 2);
        assert!(hits[0].snippet.contains("第二步"));

        // 空查询不返回东西
        assert!(search_pages(&paths, "  ").is_empty());
        let _ = fs::remove_dir_all(paths.home());
    }

    #[test]
    fn publish_as_skill_creates_a_usable_skill() {
        let paths = temp_paths("publish");
        let page = create_page(&paths, "部署手册", None).unwrap();
        save_page(
            &paths,
            &page.slug,
            "部署手册",
            "# 部署手册\n\n这是给运维看的部署步骤。\n\n第一步：生成密钥",
            &[],
            None,
        )
        .unwrap();

        let info = publish_as_skill(&paths, &page.slug, None).unwrap();
        assert_eq!(info.name, "部署手册");
        // 描述是正文摘要，不是首行标题
        assert!(info.description.contains("运维"), "实际描述：{}", info.description);
        assert!(info.description.contains("部署步骤"));

        // skill 真的能读
        let detail = crate::skills::skills_read(&paths, info.name.clone()).unwrap();
        assert!(detail.content.contains("生成密钥"));
        let _ = fs::remove_dir_all(paths.home());
    }

    #[test]
    fn publish_as_skill_uses_given_name() {
        let paths = temp_paths("publish-name");
        let page = create_page(&paths, "原标题", None).unwrap();
        let info = publish_as_skill(&paths, &page.slug, Some("自定义名".into())).unwrap();
        assert_eq!(info.name, "自定义名");
        let _ = fs::remove_dir_all(paths.home());
    }

    #[test]
    fn tags_are_collected_across_pages() {
        let paths = temp_paths("tags");
        let a = create_page(&paths, "A", None).unwrap();
        let b = create_page(&paths, "B", None).unwrap();
        save_page(&paths, &a.slug, "A", "x", &["运维".into(), "部署".into()], None).unwrap();
        save_page(&paths, &b.slug, "B", "x", &["运维".into()], None).unwrap();

        let tags = all_tags(&paths);
        assert_eq!(tags[0], "运维", "出现最多的排前面");
        assert!(tags.contains(&"部署".to_string()));
        let _ = fs::remove_dir_all(paths.home());
    }
}
