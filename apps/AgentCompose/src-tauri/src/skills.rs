//! Skill 仓库 —— **Tauri 薄封装**。
//!
//! 实现在共享 crate `agentspace-core` 里（`agentspace_core::skills`）。
//! CLI 也用同一份 —— 两边操作的是同一批文件，逻辑不能各写一份。
//!
//! 唯一留在桌面端的是 `skills_pick_source` —— 它要弹系统选择框，
//! 那是 Tauri 的事。

use tauri::AppHandle;

pub use agentspace_core::skills::{GitRepo, RuntimeSkillInfo, SkillDetail, SkillInfo};

use crate::paths;

/// 启用 / 停用一个 skill。
#[tauri::command]
pub fn skills_set_enabled(app: AppHandle, name: String, enabled: bool) -> Result<(), String> {
    agentspace_core::skills::skills_set_enabled(&paths::of(&app), name, enabled)
}

/// 列出所有「从 git 仓库导入过」的仓库。
#[tauri::command]
pub fn skills_git_repos(app: AppHandle) -> Result<Vec<GitRepo>, String> {
    agentspace_core::skills::skills_git_repos(&paths::of(&app))
}

/// 列出 Skill 仓库里的 skill。
#[tauri::command]
pub fn skills_list(app: AppHandle) -> Result<Vec<SkillInfo>, String> {
    agentspace_core::skills::skills_list(&paths::of(&app))
}

/// 手动创建 skill。
#[tauri::command]
pub fn skills_create_manual(
    app: AppHandle,
    name: String,
    description: String,
) -> Result<SkillInfo, String> {
    agentspace_core::skills::skills_create_manual(&paths::of(&app), name, description)
}

/// 从网址导入 skill。
#[tauri::command]
pub async fn skills_import_url(app: AppHandle, url: String) -> Result<SkillInfo, String> {
    agentspace_core::skills::skills_import_url(&paths::of(&app), url).await
}

/// 从本地目录导入 skill。
#[tauri::command]
pub fn skills_import_local(app: AppHandle, path: String) -> Result<SkillInfo, String> {
    agentspace_core::skills::skills_import_local(&paths::of(&app), path)
}

/// 列出本机运行时里已装好的 skill。
#[tauri::command]
pub fn skills_list_runtime(app: AppHandle) -> Result<Vec<RuntimeSkillInfo>, String> {
    agentspace_core::skills::skills_list_runtime(&paths::of(&app))
}

/// 从运行时目录导入 skill。
#[tauri::command]
pub fn skills_import_runtime(app: AppHandle, path: String) -> Result<SkillInfo, String> {
    agentspace_core::skills::skills_import_runtime(&paths::of(&app), path)
}

/// 删一个 skill。
#[tauri::command]
pub fn skills_remove(app: AppHandle, name: String) -> Result<(), String> {
    agentspace_core::skills::skills_remove(&paths::of(&app), name)
}

/// 从来源刷新 skill。
#[tauri::command]
pub async fn skills_refresh(app: AppHandle, name: String) -> Result<SkillInfo, String> {
    agentspace_core::skills::skills_refresh(&paths::of(&app), name).await
}

/// 读一个 skill 的详情。
#[tauri::command]
pub fn skills_read(app: AppHandle, name: String) -> Result<SkillDetail, String> {
    agentspace_core::skills::skills_read(&paths::of(&app), name)
}

/// 改 skill 的名字 / 描述 / 正文。
#[tauri::command]
pub fn skills_update(
    app: AppHandle,
    name: String,
    new_name: Option<String>,
    description: Option<String>,
    content: Option<String>,
) -> Result<SkillInfo, String> {
    agentspace_core::skills::skills_update(&paths::of(&app), name, new_name, description, content)
}

/// 复制一个 skill。
#[tauri::command]
pub fn skills_duplicate(app: AppHandle, name: String, new_name: String) -> Result<SkillInfo, String> {
    agentspace_core::skills::skills_duplicate(&paths::of(&app), name, new_name)
}

/// 弹出系统选择框，返回选中的路径。
///
/// kind：folder 选目录，archive 选压缩包。
///
/// 这一条留在桌面端 —— 它要弹系统窗口，是 Tauri 的事。
#[tauri::command]
pub async fn skills_pick_source(app: AppHandle, kind: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    tauri::async_runtime::spawn_blocking(move || {
        let dialog = app.dialog().file();
        let picked = match kind.as_str() {
            "folder" => dialog.blocking_pick_folder(),
            _ => dialog
                .add_filter("Skill 压缩包", &["zip", "skill"])
                .blocking_pick_file(),
        };
        Ok(picked
            .and_then(|path| path.into_path().ok())
            .map(|p| p.to_string_lossy().to_string()))
    })
    .await
    .unwrap_or(Ok(None))
}
