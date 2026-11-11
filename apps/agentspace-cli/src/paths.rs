//! 目录约定：一切都落在 `~/.agent-compose` 下。
//!
//! 与桌面端（`apps/AgentCompose`）共用同一套布局 —— 路径定义在共享 crate
//! `agentspace-core` 里（[`agentspace_core::Paths`]），这里只是转一层，
//! 免得 CLI 里的老代码要改一堆。
//!
//! 这里只读它的产出（智能体定义、skill 仓库、MCP 配置），不改。

use std::path::PathBuf;

pub use agentspace_core::Paths;

/// 用户主目录（Windows 走 `USERPROFILE`，其它走 `HOME`）。
pub fn home_dir() -> PathBuf {
    Paths::from_env().home().to_path_buf()
}

/// `~/.agent-compose`
pub fn compose_root() -> PathBuf {
    Paths::from_env().root()
}

/// `~/.agent-compose/mcp`（MCP 代理的运行时目录）
pub fn mcp_runtime_dir() -> PathBuf {
    Paths::from_env().mcp_dir()
}

