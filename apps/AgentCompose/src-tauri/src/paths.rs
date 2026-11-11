//! 数据目录 —— 从 `AppHandle` 推出共享 crate 的 `Paths`。
//!
//! 桌面端的主目录走 Tauri 的 `app.path().home_dir()`，CLI 走环境变量 ——
//! 同一份数据的两个入口，但主目录的来源不同，所以由各自决定，core 不猜。

use agentspace_core::Paths;
use tauri::{AppHandle, Manager};

/// 桌面端的数据目录。
pub fn of(app: &AppHandle) -> Paths {
    let home = app
        .path()
        .home_dir()
        .unwrap_or_else(|_| std::env::var("USERPROFILE").map(std::path::PathBuf::from).unwrap_or_default());
    Paths::new(home)
}
