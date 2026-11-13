//! 从 git 仓库拉取 skill。
//!
//! # 为什么需要
//!
//! 很多项目的 skill 来自 git 包（Pi 的 `.pi/settings.json` 里
//! `packages: ["git:github.com/owner/repo@ref"]`）。
//!
//! 之前我们只能从**本地缓存目录**导入 —— 那是 Pi 克隆下来的副本，
//! 记下来的来源是「本地路径」。有两个问题：
//!
//! - Pi 没跑过（缓存是空的）→ 一个 skill 都导不出来；
//! - 来源记成本地路径 → Pi 换了 ref、缓存被清，刷新就失效了。
//!
//! 所以这里直接按 git 源来：自己 clone、自己记来源。
//! 记的是 `git:github.com/owner/repo@ref`，刷新时能重新拉。

use std::path::{Path, PathBuf};


/// git 源：`git:github.com/owner/repo@ref` 或 `git:https://...@ref`。
#[derive(Clone, Debug)]
pub struct GitSource {
    /// clone 用的地址（去掉 `git:` 前缀和 `@ref` 后缀）。
    pub repo: String,
    /// ref（分支 / tag / commit）。空 = 默认分支。
    pub reference: Option<String>,
}

/// 解析 `git:github.com/owner/repo@v1.2.3`。
///
/// 认这些形态：
/// - `git:github.com/owner/repo@ref`
/// - `git:github.com/owner/repo`
/// - `git:https://host/owner/repo.git@ref`
pub fn parse_git_source(source: &str) -> Option<GitSource> {
    let rest = source.trim().strip_prefix("git:")?;
    if rest.is_empty() {
        return None;
    }
    // 拆 @ref —— scope 里的 @ 不算（git 源不会有 scope，但保险起见）
    let (repo, reference) = match rest.rfind('@') {
        Some(index) if index > 0 => {
            let head = &rest[..index];
            let tail = &rest[index + 1..];
            if tail.is_empty() {
                (head, None)
            } else {
                (head, Some(tail.to_string()))
            }
        }
        _ => (rest, None),
    };
    Some(GitSource {
        repo: repo.to_string(),
        reference,
    })
}

/// clone 到的位置：`~/.agent-compose/git/<host>/<owner>/<repo>`。
///
/// 跟 Pi 的缓存（`.pi/git/`）分开 —— 那是 Pi 的地盘，我们自己的放自己的。
pub fn git_cache_dir(paths: &Paths, source: &GitSource) -> PathBuf {
    let mut dir = paths.root().join("git");
    // `github.com/owner/repo` → `git/github.com/owner/repo`
    let repo = source
        .repo
        .trim_end_matches(".git")
        .replace(':', "")
        .trim_start_matches('/')
        .to_string();
    for part in repo.split('/') {
        if !part.is_empty() {
            dir = dir.join(part);
        }
    }
    dir
}

/// 确保仓库在本地是拉好的状态，返回它的目录。
///
/// 已有 → `git fetch` + `git checkout`（ref 变了也能跟上）；
/// 没有 → `git clone`。
pub fn ensure_cloned(paths: &Paths, source: &GitSource) -> Result<PathBuf, String> {
    let target = git_cache_dir(paths, source);
    if target.join(".git").is_dir() {
        // 已经在本地了 —— 更新到指定 ref
        if let Some(reference) = &source.reference {
            // tag 不在浅克隆里 —— 先把 ref 拉下来
            let _ = run_git(&target, &["fetch", "--depth", "1", "origin", reference]);
            let _ = run_git(&target, &["fetch", "--tags", "--force"]);
            // `0.6.13` 这种 tag 名有时是 `v0.6.13` —— 两个都试
            if !checkout(&target, reference) {
                let alt = format!("v{reference}");
                if !checkout(&target, &alt) {
                    return Err(format!(
                        "仓库里没有 ref「{reference}」（试过 {reference} 和 {alt}）"
                    ));
                }
            }
        }
        return Ok(target);
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
    }
    let url = clone_url(&source.repo);
    // 不用 --depth：tag 需要完整历史才拿得到
    run_git(Path::new("."), &["clone", &url, &target.to_string_lossy()])?;
    if let Some(reference) = &source.reference {
        if !checkout(&target, reference) {
            let alt = format!("v{reference}");
            if !checkout(&target, &alt) {
                return Err(format!(
                    "仓库里没有 ref「{reference}」（试过 {reference} 和 {alt}）"
                ));
            }
        }
    }
    Ok(target)
}

/// checkout 一个 ref，成功返回 true。
fn checkout(dir: &Path, reference: &str) -> bool {
    run_git(dir, &["checkout", "--force", reference]).is_ok()
}

/// clone 的地址。
///
/// `github.com/owner/repo` → `https://github.com/owner/repo.git`
/// 已经是完整 url 的原样用。
pub fn clone_url(repo: &str) -> String {
    let trimmed = repo.trim();
    if trimmed.starts_with("http://")
        || trimmed.starts_with("https://")
        || trimmed.starts_with("git@")
    {
        if trimmed.ends_with(".git") {
            return trimmed.to_string();
        }
        return format!("{trimmed}.git");
    }
    format!("https://{trimmed}.git")
}

/// 跑一条 git 命令。
fn run_git(cwd: &Path, args: &[&str]) -> Result<(), String> {
    let output = crate::proc::command("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("执行 git 失败：{e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if stderr.is_empty() { stdout } else { stderr };
        return Err(format!(
            "git {} 失败：{}",
            args.join(" "),
            if detail.is_empty() { "未知原因".to_string() } else { detail }
        ));
    }
    Ok(())
}

use crate::paths::Paths;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_repo_and_ref() {
        let source = parse_git_source("git:github.com/owner/repo@v1.2.3").unwrap();
        assert_eq!(source.repo, "github.com/owner/repo");
        assert_eq!(source.reference.as_deref(), Some("v1.2.3"));
    }

    #[test]
    fn parses_repo_without_ref() {
        let source = parse_git_source("git:github.com/owner/repo").unwrap();
        assert_eq!(source.repo, "github.com/owner/repo");
        assert_eq!(source.reference, None);
    }

    #[test]
    fn rejects_non_git_source() {
        assert!(parse_git_source("npm:pkg@1.0.0").is_none());
        assert!(parse_git_source("git:").is_none());
    }

    #[test]
    fn builds_clone_url() {
        assert_eq!(
            clone_url("github.com/owner/repo"),
            "https://github.com/owner/repo.git"
        );
        assert_eq!(
            clone_url("https://host/owner/repo"),
            "https://host/owner/repo.git"
        );
        assert_eq!(
            clone_url("https://host/owner/repo.git"),
            "https://host/owner/repo.git"
        );
    }

    #[test]
    fn cache_dir_is_under_own_root() {
        let paths = Paths::new("/home/test");
        let source = parse_git_source("git:github.com/owner/repo@v1").unwrap();
        let dir = git_cache_dir(&paths, &source);
        assert_eq!(dir, PathBuf::from("/home/test/.agent-compose/git/github.com/owner/repo"));
    }
}
