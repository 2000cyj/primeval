//! 已创建智能体的落盘存储 —— **Tauri 薄封装**。
//!
//! 真正的实现在共享 crate `agentspace-core` 里（`agentspace_core::agent`）。
//! CLI（`apps/agentspace-cli`）也用同一份 —— 两边操作的是同一批文件，
//! 逻辑不能各写一份。
//!
//! 这里只做两件事：
//! 1. 从 `AppHandle` 推出数据目录
//! 2. 把 core 的函数包成 Tauri 命令（签名跟以前一样，前端不用改）

use tauri::AppHandle;

pub use agentspace_core::agent::CreatedAgent;

use crate::paths;

/// 列出全部智能体（新的在前）。
#[tauri::command]
pub fn created_agents_list(app: AppHandle) -> Vec<CreatedAgent> {
    agentspace_core::agent::list(&paths::of(&app))
}

/// 新建或更新一个智能体。
///
/// 版本号由 core 统一管：**每次保存 +1**（新建从 1 开始）。
#[tauri::command]
pub fn created_agents_save(app: AppHandle, agent: CreatedAgent) -> Result<CreatedAgent, String> {
    agentspace_core::agent::save(&paths::of(&app), &agent)
}

/// 删掉一个智能体（连目录一起删）。
#[tauri::command]
pub fn created_agents_delete(app: AppHandle, id: String) -> Result<(), String> {
    agentspace_core::agent::delete(&paths::of(&app), &id)
}

/// 给绑定了这些 skill / MCP 的智能体递增版本号。
///
/// skill 更新、删除、改名，MCP server 增删改 —— 都会让「绑着它的智能体」
/// 的实际能力变了，版本号必须跟着动。
pub fn bump_versions(app: &AppHandle, skills: &[String], mcp_ids: &[String]) {
    agentspace_core::agent::bump_versions(&paths::of(app), skills, mcp_ids);
}
