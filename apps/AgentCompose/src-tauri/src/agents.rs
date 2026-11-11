//! 本机 CLI 工具箱（Agent 探测 / 安装 / 升级 / 卸载）—— **Tauri 薄封装**。
//!
//! 实现在共享 crate `agentspace-core` 里（`agentspace_core::toolbox`）。
//! CLI 也用同一份 —— 否则会出现「界面说装了、CLI 说没装」。

use tauri::AppHandle;

pub use agentspace_core::toolbox::{AgentInfo, AgentInstall, LatestVersion, PackagePlan};

use crate::paths;

/// 某个 CLI 的所有安装位置。
#[tauri::command]
pub async fn agents_installations(
    app: AppHandle,
    command: String,
) -> Result<Vec<AgentInstall>, String> {
    agentspace_core::toolbox::toolbox_installations(&paths::of(&app), command).await
}

/// 探测本机所有已知的 CLI agent。
#[tauri::command]
pub async fn agents_scan(app: AppHandle) -> Result<Vec<AgentInfo>, String> {
    agentspace_core::toolbox::toolbox_scan(&paths::of(&app)).await
}

/// 查本地已装工具的最新版本。
#[tauri::command]
pub async fn agents_check_updates(
    app: AppHandle,
    commands: Vec<String>,
) -> Result<Vec<LatestVersion>, String> {
    agentspace_core::toolbox::toolbox_check_updates(&paths::of(&app), commands).await
}

/// 包操作方案：前端拿它去展示「将要执行什么」。
#[tauri::command]
pub fn agents_package_plan(
    app: AppHandle,
    command: String,
    op: String,
    version: Option<String>,
) -> Result<PackagePlan, String> {
    agentspace_core::toolbox::toolbox_package_plan(&paths::of(&app), command, op, version)
}

/// 某个包能装的版本（新 → 旧）。
#[tauri::command]
pub async fn agents_package_versions(
    app: AppHandle,
    command: String,
) -> Result<Vec<String>, String> {
    agentspace_core::toolbox::toolbox_package_versions(&paths::of(&app), command).await
}

/// 装一个。
#[tauri::command]
pub async fn agents_install(
    app: AppHandle,
    command: String,
    version: Option<String>,
) -> Result<String, String> {
    agentspace_core::toolbox::toolbox_install(&paths::of(&app), command, version).await
}

/// 升级一个。
#[tauri::command]
pub async fn agents_upgrade(app: AppHandle, command: String) -> Result<String, String> {
    agentspace_core::toolbox::toolbox_upgrade(&paths::of(&app), command).await
}

/// 卸一个。
#[tauri::command]
pub async fn agents_uninstall(app: AppHandle, command: String) -> Result<String, String> {
    agentspace_core::toolbox::toolbox_uninstall(&paths::of(&app), command).await
}
