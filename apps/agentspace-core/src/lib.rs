//! AgentSpace 的共享核心。
//!
//! # 为什么有这个 crate
//!
//! 桌面端（`apps/AgentCompose/src-tauri`）和命令行（`apps/agentspace-cli`）
//! 是**两个独立的 crate**，但操作的是**同一份数据**（`~/.agent-compose/`）。
//!
//! 以前两边各写一份 `agent.json` 的结构定义 —— 加一个字段要改两处，
//! 删一个字段也要记得删两处。迟早漂移。
//!
//! 这个 crate 把「数据长什么样 + 怎么读写」收成一份，两个 crate 都依赖它。
//! 和桌面端是同一个路子：`agentspace-cli`（CLI）和 `AgentCompose`（桌面端）
//! （HTTP 服务）在同一个 Go module 里，共享 `server/internal/`。
//!
//! **不依赖 Tauri** —— 桌面端和 CLI 都要能引它，Tauri 只能待在桌面端那一侧。

pub mod agent;
pub mod bridge;
pub mod extensions;
/// git 源的解析与克隆 —— 只在 crate 内用（github.rs 调它）。
pub(crate) mod git_source;
pub mod github;
pub mod marketplace;
pub mod paths;
pub mod pi_settings;
pub mod proc;
pub mod toolbox;
pub mod updater;
pub mod proxy;
pub mod skills;

pub use agent::{CreatedAgent, DEFAULT_RUNTIME};
pub use paths::Paths;
