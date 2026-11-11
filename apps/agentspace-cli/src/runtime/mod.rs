//! 运行时（agent runtime）—— 现在只有 Pi，以后可以加别的。
//!
//! # 为什么要工厂
//!
//! 智能体数据里有个 `runtime` 字段（`agent.json` 的 `runtime`），
//! 写着这个智能体跑在哪个 agent 上。以前 CLI 里写死了「只支持 Pi」，
//! 判断、装配、启动三段逻辑全散在 `main.rs` 里，加一个运行时就得改一地。
//!
//! 现在每个运行时是一个实现 [`Runtime`] 的对象：
//! **它长什么样、怎么把 skill / 指令 / MCP / 扩展落到项目里、
//! 怎么把自己拉起来，全封装在它的方法里。**
//! [`create`] 就是工厂 —— 按 `runtime` 字段造出对应的对象。
//!
//! 加一个新运行时只要三步：
//! 1. 写一个模块，实现 [`Runtime`]
//! 2. 在 [`create`] 里加一行
//! 3. （可选）在 [`supported`] 里登记
//!
//! 流程本身（找智能体 → 检查装没装 → 落地 → 启动）跟运行时无关，
//! 在 `prepare::land` 和 `main.rs` 里。

mod pi;

use std::path::{Path, PathBuf};

pub use pi::PiRuntime;

/// 扩展资源：相对路径 + 源码。
///
/// 有些运行时没有扩展机制（它原生就读某个指令文件），那就返回 `None`，
/// 指令改走它自己的路子。
#[derive(Clone, Copy, Debug)]
pub struct ExtensionAsset {
    /// 相对运行时配置目录的路径（Pi → `extensions/agentspace.ts`）
    pub relative_path: &'static str,
    /// 源码
    pub source: &'static str,
}

/// 一个 agent 运行时。
///
/// 运行时之间差的就是这几件事：
/// - 自己装没装、没装时怎么装
/// - skill / 指令 / MCP / 扩展各自落到项目的哪个路径
/// - MCP 条目在它的配置格式里长什么样
/// - 启动时要带什么参数、怎么把进程拉起来
pub trait Runtime {
    /// 运行时 id —— 跟智能体数据里的 `runtime` 字段对应。
    fn id(&self) -> &'static str;

    /// 显示名（给用户看的）。
    fn label(&self) -> &'static str;

    /// 装没装。
    fn is_installed(&self) -> bool;

    /// 没装时给用户的安装指引（整段文案，直接打印）。
    fn install_hint(&self) -> String;

    // ── 落地布局 ──────────────────────────────────────────

    /// 运行时的项目配置目录（Pi → `.pi`）。
    fn config_dir(&self, cwd: &Path) -> PathBuf;

    /// skill 装到哪儿（目录）。
    fn skills_dir(&self, cwd: &Path) -> PathBuf;

    /// 指令文件（完整路径）。
    ///
    /// Pi 放 `.pi/AGENTS.md` —— Pi 原生不读 `.pi/`，靠扩展注入 prompt。
    fn instructions_file(&self, cwd: &Path) -> PathBuf;

    /// MCP 配置文件（完整路径）。返回 `None` = 这个运行时不支持项目级 MCP。
    fn mcp_config_file(&self, cwd: &Path) -> Option<PathBuf>;

    /// 扩展资源。返回 `None` = 这个运行时没有扩展机制。
    fn extension(&self) -> Option<ExtensionAsset>;

    /// agentspace 自己的落地记录放哪儿（完整路径）。
    fn state_file(&self, cwd: &Path) -> PathBuf;

    /// 清理旧布局 —— 运行时自己知道「以前长什么样」。
    ///
    /// Pi 以前把指令写在项目根目录的 `AGENTS.md`，现在搬到 `.pi/` 下了；
    /// 根目录那份得清掉，不然指令会被读到两次。
    fn migrate_legacy(&self, _cwd: &Path) {}

    // ── MCP 条目格式 ──────────────────────────────────────

    /// MCP 配置里一个上游对应的条目名（配置里的 key）。
    fn mcp_entry_name(&self, server_id: &str) -> String;

    /// MCP 配置里一个上游对应的条目内容。
    fn mcp_entry(&self, server_id: &str, endpoint: &str, token: &str) -> serde_json::Value;

    // ── 启动 ──────────────────────────────────────────────

    /// 启动前的准备（写信任名单之类的）。
    fn before_launch(&self, _cwd: &Path) {}

    /// 启动时要额外带的参数（跟在用户给的参数前面）。
    fn launch_args(&self, _cwd: &Path) -> Vec<String> {
        Vec::new()
    }

    /// 拉起进程。返回退出码；进程压根没起来时返回 `None`。
    fn launch(&self, cwd: &Path, args: &[String]) -> Option<i32>;
}

/// 工厂：按 id 造出对应的运行时。
///
/// id 就是智能体数据里的 `runtime` 字段。找不到返回 `None`。
pub fn create(id: &str) -> Option<Box<dyn Runtime>> {
    match id.trim().to_lowercase().as_str() {
        "pi" => Some(Box::new(PiRuntime::new())),
        _ => None,
    }
}

/// 支持的运行时（id + 显示名）。
pub fn supported() -> &'static [(&'static str, &'static str)] {
    &[("pi", "Pi")]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn factory_creates_known_runtimes() {
        let pi = create("pi").expect("pi 是支持的");
        assert_eq!(pi.id(), "pi");

        // 别名和大小写都认
        assert_eq!(create("  PI  ").unwrap().id(), "pi");
    }

    #[test]
    fn factory_returns_none_for_unknown_runtime() {
        assert!(create("aider").is_none());
        assert!(create("claude").is_none());
        assert!(create("").is_none());
    }

    #[test]
    fn supported_list_matches_factory() {
        for (id, _) in supported() {
            assert!(create(id).is_some(), "{id} 列在 supported 里但工厂造不出来");
        }
    }
}
