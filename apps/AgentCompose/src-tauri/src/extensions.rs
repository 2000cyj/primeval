//! Pi 扩展管理的 Tauri 命令。
//!
//! 分三块：
//! - 已安装：扫各个来源目录（见 `agentspace_core::extensions`）
//! - 市场：搜 npm registry 的 `keywords:pi-package`
//! - 自定义：自己写扩展脚本
//!
//! 装扩展走 pi 自己的命令（`pi install <source>`）—— 不自己实现一套，
//! 保证和 pi 的行为一致（settings.json 的写法、缓存目录、ref 对齐）。

use std::path::PathBuf;

use serde::Serialize;
use tauri::AppHandle;

use agentspace_core::extensions::{self, ExtensionInfo};
use agentspace_core::marketplace::{self, SearchResult};

use crate::paths;

/// 一个动作的执行结果。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandOutput {
    pub ok: bool,
    pub message: String,
}

fn ok(message: impl Into<String>) -> CommandOutput {
    CommandOutput {
        ok: true,
        message: message.into(),
    }
}

fn fail(message: impl Into<String>) -> CommandOutput {
    CommandOutput {
        ok: false,
        message: message.into(),
    }
}

/// 列出已安装的扩展。
#[tauri::command]
pub fn extensions_list(app: AppHandle) -> Vec<ExtensionInfo> {
    let project = std::env::current_dir().ok();
    extensions::list_installed(&paths::of(&app), project.as_deref())
}

/// 读一个扩展的源码。
#[tauri::command]
pub fn extensions_read(path: String) -> Result<String, String> {
    extensions::read_source(&PathBuf::from(path))
}

/// 启用 / 停用一个扩展。
///
/// pi 没有「禁用某个扩展」的机制 —— 它按目录里的文件加载。
/// 所以停用 = 把文件改名加 `.disabled` 后缀。
#[tauri::command]
pub fn extensions_set_enabled(path: String, enabled: bool) -> Result<CommandOutput, String> {
    match extensions::set_enabled(&PathBuf::from(path), enabled) {
        Ok(()) => Ok(ok(if enabled { "已启用" } else { "已停用" })),
        Err(error) => Ok(fail(error)),
    }
}

/// 删掉一个扩展。
#[tauri::command]
pub fn extensions_remove(path: String) -> Result<CommandOutput, String> {
    match extensions::remove(&PathBuf::from(path)) {
        Ok(()) => Ok(ok("已删除")),
        Err(error) => Ok(fail(error)),
    }
}

/// 写一个自定义扩展（放到工具箱里，不进 pi 的全局目录）。
#[tauri::command]
pub fn extensions_save(
    app: AppHandle,
    name: String,
    code: String,
) -> Result<CommandOutput, String> {
    match extensions::write_custom(&paths::of(&app), &name, &code) {
        Ok(path) => Ok(ok(format!("已保存：{}", path.display()))),
        Err(error) => Ok(fail(error)),
    }
}

/// 从 npm 装一个扩展到工具箱。
#[tauri::command]
pub async fn extensions_install_npm(
    app: AppHandle,
    name: String,
) -> Result<CommandOutput, String> {
    let paths = paths::of(&app);
    let result = tauri::async_runtime::spawn_blocking(move || {
        extensions::install_from_npm(&paths, &name)
    })
    .await
    .map_err(|e| format!("安装失败：{e}"))?;
    match result {
        Ok(info) => Ok(ok(format!("已安装 {}", info.name))),
        Err(error) => Ok(fail(error)),
    }
}

/// 删掉工具箱里的一个扩展。
#[tauri::command]
pub fn extensions_remove_library(
    app: AppHandle,
    source: String,
    name: String,
) -> Result<CommandOutput, String> {
    let kind = match source.as_str() {
        "npm" => extensions::ExtensionSourceKind::Npm,
        "custom" => extensions::ExtensionSourceKind::Custom,
        _ => return Ok(fail("只能删 npm 或自定义的扩展")),
    };
    match extensions::remove_from_library(&paths::of(&app), kind, &name) {
        Ok(()) => Ok(ok("已删除")),
        Err(error) => Ok(fail(error)),
    }
}

/// 新扩展的模板代码。
#[tauri::command]
pub fn extensions_template() -> String {
    extensions::TEMPLATE.to_string()
}

/// 搜扩展市场。
///
/// `offset` 是跳过多少条 —— 配合「加载更多」翻页。
#[tauri::command]
pub async fn extensions_market_search(
    query: String,
    limit: Option<u64>,
    offset: Option<u64>,
) -> Result<SearchResult, String> {
    let limit = limit.unwrap_or(40).clamp(1, 250) as usize;
    let offset = offset.unwrap_or(0) as usize;
    marketplace::search(&query, limit, offset).await
}
