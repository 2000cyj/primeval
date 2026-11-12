//! 从 GitHub 仓库发现 / 导入 skill。
//!
//! 对应 cc-switch 的「仓库管理」：填 GitHub 链接 → 选分支 → 列出仓库里的
//! skill → 勾选导入。
//!
//! 实现放在共享 core（`agentspace_core::github`），CLI 也能用同一套。

use serde::Serialize;
use tauri::AppHandle;

use agentspace_core::github::{self, DiscoveredSkill, RepoRef};

use crate::paths;

/// 一个分支。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    pub name: String,
}

/// 从 GitHub 链接里解析 owner/repo。
#[tauri::command]
pub fn skills_parse_repo_url(url: String) -> Option<RepoRef> {
    github::parse_repo_url(&url)
}

/// 列出仓库的分支。
#[tauri::command]
pub async fn skills_repo_branches(_app: AppHandle, url: String) -> Result<Vec<Branch>, String> {
    let repo = github::parse_repo_url(&url).ok_or_else(|| {
        format!("看不出仓库地址：{url}（应该是 https://github.com/owner/repo）")
    })?;
    let branches = tauri::async_runtime::spawn_blocking(move || github::list_branches(&repo))
        .await
        .map_err(|e| e.to_string())??;
    Ok(branches
        .into_iter()
        .map(|name| Branch { name })
        .collect())
}

/// 列出仓库里的 skill（不导入）。
#[tauri::command]
pub async fn skills_repo_discover(
    app: AppHandle,
    url: String,
    branch: String,
) -> Result<Vec<DiscoveredSkill>, String> {
    let repo = github::parse_repo_url(&url)
        .ok_or_else(|| format!("看不出仓库地址：{url}"))?;
    let paths = paths::of(&app);
    tauri::async_runtime::spawn_blocking(move || {
        github::discover_skills(&paths, &repo, &branch)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 从仓库里导入选中的 skill。
#[tauri::command]
pub async fn skills_repo_import(
    app: AppHandle,
    url: String,
    branch: String,
    paths: Vec<String>,
) -> Result<Vec<agentspace_core::skills::SkillInfo>, String> {
    let repo = github::parse_repo_url(&url)
        .ok_or_else(|| format!("看不出仓库地址：{url}"))?;
    let core = paths::of(&app);
    tauri::async_runtime::spawn_blocking(move || {
        github::import_skills(&core, &repo, &branch, &paths)
    })
    .await
    .map_err(|e| e.to_string())?
}
