//! 内置 Wiki 的 Tauri 命令。
//!
//! 业务逻辑在共享 core（`agentspace_core::wiki`）—— 这里只做一层壳。
//!
//! 页面内容就是 Markdown 文件，agent 通过 AgentSpace 自己的 MCP 端点读
//! （sidecar 里有 `wiki_list` / `wiki_read` / `wiki_search` 三个本地工具）。

use tauri::{AppHandle, Manager};

use agentspace_core::paths::Paths;
use agentspace_core::wiki::{self, WikiPage, WikiPageMeta, WikiSearchHit};

/// 拿当前的数据目录。
fn paths(app: &AppHandle) -> Paths {
    Paths::new(
        app.path()
            .home_dir()
            .unwrap_or_else(|_| std::env::var("USERPROFILE").map(std::path::PathBuf::from).unwrap_or_default()),
    )
}

/// 列出所有页面。
#[tauri::command]
pub fn wiki_list(app: AppHandle) -> Vec<WikiPageMeta> {
    wiki::list_pages(&paths(&app))
}

/// 读一个页面（含正文）。
#[tauri::command]
pub fn wiki_read(app: AppHandle, slug: String) -> Result<WikiPage, String> {
    wiki::read_page(&paths(&app), &slug)
}

/// 保存页面。
#[tauri::command]
pub fn wiki_save(
    app: AppHandle,
    slug: String,
    title: String,
    content: String,
    tags: Vec<String>,
    parent: Option<String>,
) -> Result<WikiPage, String> {
    wiki::save_page(&paths(&app), &slug, &title, &content, &tags, parent)
}

/// 新建页面。
#[tauri::command]
pub fn wiki_create(
    app: AppHandle,
    title: String,
    parent: Option<String>,
) -> Result<WikiPage, String> {
    wiki::create_page(&paths(&app), &title, parent)
}

/// 删页面。
#[tauri::command]
pub fn wiki_delete(app: AppHandle, slug: String) -> Result<(), String> {
    wiki::delete_page(&paths(&app), &slug)
}

/// 搜索标题和正文。
#[tauri::command]
pub fn wiki_search(app: AppHandle, query: String) -> Vec<WikiSearchHit> {
    wiki::search_pages(&paths(&app), &query)
}

/// 所有用过的标签（给筛选器用）。
#[tauri::command]
pub fn wiki_tags(app: AppHandle) -> Vec<String> {
    wiki::all_tags(&paths(&app))
}

/// 把一个 wiki 页面发布成 skill。
///
/// skill 本质就是「agent 可读的 Markdown」—— wiki 里写的文档发布成 skill
/// 后就能直接绑到智能体上，不用在两个地方写一遍。
#[tauri::command]
pub fn wiki_publish_as_skill(
    app: AppHandle,
    slug: String,
    name: Option<String>,
) -> Result<agentspace_core::skills::SkillInfo, String> {
    wiki::publish_as_skill(&paths(&app), &slug, name)
}
