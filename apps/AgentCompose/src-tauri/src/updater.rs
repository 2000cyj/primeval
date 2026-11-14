//! 应用自身的版本检测与更新。
//!
//! 检测逻辑放在共享 core（`agentspace_core::updater`），CLI 也能用同一套。
//! 这里只做一层 Tauri 命令的壳。
//!
//! # 更新怎么做
//!
//! 用 Tauri 官方 updater 插件（`tauri-plugin-updater`），跟 cc-switch 同一套：
//!
//! 1. `check()` —— 问端点「有没有新版」，顺带拿到版本号和发布说明
//! 2. `download()` —— **在应用内下载**，带进度回调（进度通过事件推给前端）
//! 3. `install()` —— 验签（minisign）后交给 NSIS 装好，Windows 上装完自动重启
//!
//! 关键点：**下载不走出浏览器**。以前这里是 `openExternal(downloadUrl)`，
//! 让用户自己点链接去浏览器下 —— 下载进度看不见，装完也不管。
//!
//! 签名密钥在 CI 里（`TAURI_SIGNING_PRIVATE_KEY` 秘密），公钥写在
//! `tauri.conf.json` 的 `plugins.updater.pubkey`。CI 每次发版会多产出一个
//! `updater.json`（更新清单），挂在 release 附件上。

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use agentspace_core::updater::{self, UpdateInfo};

use tauri_plugin_updater::UpdaterExt;

/// 检查最新版本。
///
/// 返回当前版本、远端最新版本、发布说明和下载地址。
#[tauri::command]
pub async fn check_app_update(app: AppHandle) -> Result<UpdateInfo, String> {
    let current_version = app.package_info().version.to_string();
    updater::check_latest_release(&current_version).await
}

/// 下载进度 —— 通过事件推给前端。
///
/// 前端监听 `update-download-progress`，画进度条。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDownloadProgress {
    /// 已下载字节
    pub downloaded: u64,
    /// 总字节（服务端没给就是 0）
    pub total: u64,
}

/// 下载并安装更新。
///
/// 跟 cc-switch 的 `install_update_and_restart` 一个路子：
/// - 后端自己下载（带进度事件）
/// - 验签通过后交给 NSIS 安装器
/// - Windows 上安装器会用 `/UPDATE` 模式替换掉正在运行的这份程序，装完重启
///
/// 返回 `true` 表示「有新版本，已开始安装」，调用方不必再管后续 ——
/// Windows 上进程会在安装器起来后退出，macOS/Linux 上由调用方重启。
#[tauri::command]
pub async fn install_update_and_restart(app: AppHandle) -> Result<bool, String> {
    let updater = app
        .updater_builder()
        .build()
        .map_err(|e| format!("初始化更新器失败：{e}"))?;

    let Some(update) = updater
        .check()
        .await
        .map_err(|e| format!("检查更新失败：{e}"))?
    else {
        return Ok(false);
    };

    let progress_handle = app.clone();
    let mut downloaded: u64 = 0;
    let bytes = update
        .download(
            move |chunk_len, content_len| {
                downloaded = downloaded.saturating_add(chunk_len as u64);
                let _ = progress_handle.emit(
                    "update-download-progress",
                    UpdateDownloadProgress {
                        downloaded,
                        total: content_len.unwrap_or(0),
                    },
                );
            },
            || {},
        )
        .await
        .map_err(|e| format!("下载更新失败：{e}"))?;

    // Windows 上 install() 会启动安装器并直接退出当前进程；
    // 其它平台 install() 返回后由调用方重启。
    update
        .install(bytes)
        .map_err(|e| format!("安装更新失败：{e}"))?;

    Ok(true)
}
