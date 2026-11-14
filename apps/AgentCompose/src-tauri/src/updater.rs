//! 应用自身的版本检测。
//!
//! 逻辑放在共享 core（`agentspace_core::updater`），CLI 也能用同一套。
//! 这里只做一层 Tauri 命令的壳。

use tauri::AppHandle;

use agentspace_core::updater::{self, UpdateInfo};

/// 检查最新版本。
///
/// 返回当前版本、远端最新版本、发布说明和下载地址。
#[tauri::command]
pub async fn check_app_update(app: AppHandle) -> Result<UpdateInfo, String> {
    let current_version = app.package_info().version.to_string();
    updater::check_latest_release(&current_version).await
}
