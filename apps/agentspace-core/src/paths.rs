//! 数据目录布局。
//!
//! 一切都落在 `~/.agent-compose/` 下：
//!
//! ```text
//! ~/.agent-compose/
//!   agents/<id>/            智能体定义（agent.json + AGENTS.md）
//!   skills/<目录名>/         skill 仓库
//!   extensions/npm/<名>/     工具箱里的 npm 扩展（连同它自己的 node_modules）
//!   extensions/custom/<名>/  工具箱里的自定义扩展
//!   mcp/                    MCP 代理的运行时目录
//!   git/<host>/<owner>/<仓库>  git 源的本地克隆（刷新时重拉）
//!   bin/                    随应用分发的可执行文件（agentspace / sidecar）
//! ```
//!
//! 桌面端和 CLI 都要用这套路径，但**主目录怎么找**两边不一样：
//! 桌面端走 Tauri 的 `app.path().home_dir()`，CLI 读环境变量。
//! 所以这里不自己去找主目录 —— 由调用方把主目录传进来。

use std::path::{Path, PathBuf};

/// 一组数据目录。
///
/// 传主目录进来，而不是自己找 —— 桌面端和 CLI 的「主目录」来源不同，
/// 硬编码成一种会有一边读到别的目录。
#[derive(Clone, Debug)]
pub struct Paths {
    home: PathBuf,
}

impl Paths {
    /// 用给定的主目录。
    pub fn new(home: impl Into<PathBuf>) -> Self {
        Self { home: home.into() }
    }

    /// 从环境变量推断主目录。
    ///
    /// Windows 走 `USERPROFILE`，其它走 `HOME`。都没有就退回当前目录。
    pub fn from_env() -> Self {
        for key in ["USERPROFILE", "HOME"] {
            if let Some(value) = std::env::var_os(key) {
                if !value.is_empty() {
                    return Self::new(PathBuf::from(value));
                }
            }
        }
        Self::new(PathBuf::from("."))
    }

    /// 主目录。
    pub fn home(&self) -> &Path {
        &self.home
    }

    /// `~/.agent-compose`
    pub fn root(&self) -> PathBuf {
        self.home.join(".agent-compose")
    }

    /// `~/.agent-compose/agents`（智能体定义）
    pub fn agents_root(&self) -> PathBuf {
        self.root().join("agents")
    }

    /// `~/.agent-compose/skills`（skill 仓库）
    pub fn skills_root(&self) -> PathBuf {
        self.root().join("skills")
    }

    /// `~/.agent-compose/mcp`（MCP 代理的运行时目录）
    pub fn mcp_dir(&self) -> PathBuf {
        self.root().join("mcp")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_is_under_dot_agent_compose() {
        let paths = Paths::new("/home/test");
        assert_eq!(paths.root(), Path::new("/home/test/.agent-compose"));
        assert_eq!(
            paths.agents_root(),
            Path::new("/home/test/.agent-compose/agents")
        );
        assert_eq!(
            paths.skills_root(),
            Path::new("/home/test/.agent-compose/skills")
        );
        assert_eq!(
            paths.mcp_dir(),
            Path::new("/home/test/.agent-compose/mcp")
        );
    }
}
