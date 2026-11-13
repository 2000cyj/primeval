//! 从 GitHub 仓库发现 skill。
//!
//! # 做法（抄 cc-switch 的「仓库管理」）
//!
//! cc-switch 的流程是：
//!
//! 1. 用户填 GitHub 链接（`owner/repo`）+ 分支
//! 2. 下载 zip：`https://github.com/{owner}/{repo}/archive/refs/heads/{branch}.zip`
//! 3. 解压到临时目录
//! 4. 递归扫 `SKILL.md`，列出每个 skill 的名字 / 描述 / 路径
//!
//! 我们照这个路子做，但用 `git clone` 而不是 zip ——
//! 我们本来就有 git 缓存（`skills_import_git` 用它），同一个仓库只下一次。
//!
//! # 为什么不走 GitHub API
//!
//! API 要 token 才有更高的限额，而且匿名请求 60 次/小时。
//! zip 归档是公开的，不需要认证。

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::paths::Paths;
use crate::skills::{self, SkillFile};

/// 从 GitHub 链接里解析出 owner / repo。
///
/// 认这些写法：
/// - `https://github.com/owner/repo`
/// - `https://github.com/owner/repo.git`
/// - `git@github.com:owner/repo.git`
/// - `owner/repo`
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoRef {
    pub owner: String,
    pub name: String,
}

impl RepoRef {
    /// `owner/repo` 形式（用于拼 zip 地址）。
    pub fn slug(&self) -> String {
        format!("{}/{}", self.owner, self.name)
    }
}

/// 解析 GitHub 仓库链接。
pub fn parse_repo_url(input: &str) -> Option<RepoRef> {
    let text = input.trim();
    if text.is_empty() {
        return None;
    }
    // 去掉协议前缀和 host
    let rest = if let Some(rest) = text.strip_prefix("https://") {
        rest
    } else if let Some(rest) = text.strip_prefix("http://") {
        rest
    } else if let Some(rest) = text.strip_prefix("git@") {
        rest
    } else {
        text
    };
    // 去掉 host 部分（github.com: 或 github.com/）
    let rest = match rest.find("github.com") {
        Some(index) => &rest[index + "github.com".len()..],
        None => rest,
    };
    let rest = rest.trim_start_matches([':', '/']);
    // 去掉 .git 后缀
    let rest = rest.trim_end_matches('/').trim_end_matches(".git");
    // 只取前两段
    let mut parts = rest.split('/').filter(|part| !part.is_empty());
    let owner = parts.next()?.to_string();
    let name = parts.next()?.to_string();
    if owner.is_empty() || name.is_empty() {
        return None;
    }
    Some(RepoRef { owner, name })
}

/// 仓库里发现的一个 skill。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredSkill {
    /// skill 名字（frontmatter 里的 name，或目录名）。
    pub name: String,
    /// 描述（frontmatter 里的 description）。
    pub description: String,
    /// 相对仓库根的路径（`skills/foo/SKILL.md`）。
    pub path: String,
}

/// 列出仓库里的分支。
///
/// 走 `git ls-remote --heads` —— 不用 clone，也不用 GitHub API。
pub fn list_branches(repo: &RepoRef) -> Result<Vec<String>, String> {
    let url = format!("https://github.com/{}.git", repo.slug());
    let output = crate::proc::command("git")
        .args(["ls-remote", "--heads", &url])
        .output()
        .map_err(|e| format!("执行 git 失败：{e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!(
            "读分支失败：{}",
            if stderr.is_empty() { "仓库不存在或没网络" } else { &stderr }
        ));
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut branches: Vec<String> = text
        .lines()
        .filter_map(|line| line.split_whitespace().next_back())
        .map(|name| name.trim_start_matches("refs/heads/").to_string())
        .filter(|name| !name.is_empty())
        .collect();
    branches.sort();
    branches.dedup();
    if branches.is_empty() {
        return Err("仓库里没有分支".to_string());
    }
    Ok(branches)
}

/// 把仓库拉到本地（缓存），返回仓库根目录。
fn clone_repo(paths: &Paths, repo: &RepoRef, branch: &str) -> Result<PathBuf, String> {
    let url = format!("https://github.com/{}.git", repo.slug());
    let target = paths
        .root()
        .join("git")
        .join("github.com")
        .join(&repo.owner)
        .join(&repo.name);

    if target.join(".git").is_dir() {
        // 已经在本地 —— 切到目标分支并拉最新
        //
        // 用 FETCH_HEAD 而不是直接 checkout 分支名：
        // 浅克隆（--depth 1）本地没有对应的分支引用，
        // 直接 checkout 会失败。
        let fetched = run_git(&target, &["fetch", "--depth", "1", "origin", branch]);
        if fetched.is_ok() {
            let _ = run_git(&target, &["checkout", "--force", "FETCH_HEAD"]);
        }
        if let Ok(current) = current_branch(&target) {
            if current == branch {
                return Ok(target);
            }
        }
        // fetch 失败（分支可能不存在）→ 退回按名字 checkout
        let _ = run_git(&target, &["checkout", "--force", branch]);
        return Ok(target);
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
    }
    run_git(
        Path::new("."),
        &[
            "clone",
            "--depth",
            "1",
            "--branch",
            branch,
            &url,
            &target.to_string_lossy(),
        ],
    )?;
    Ok(target)
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

/// 当前在哪个分支。
fn current_branch(dir: &Path) -> Result<String, String> {
    let output = crate::proc::command("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(dir)
        .output()
        .map_err(|e| format!("执行 git 失败：{e}"))?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// 列出仓库里的所有 skill。
///
/// 递归找带 `SKILL.md` 的目录 —— 跟 cc-switch 一样。
pub fn discover_skills(
    paths: &Paths,
    repo: &RepoRef,
    branch: &str,
) -> Result<Vec<DiscoveredSkill>, String> {
    let root = clone_repo(paths, repo, branch)?;
    let mut out: Vec<DiscoveredSkill> = Vec::new();
    collect_skills(&root, &root, &mut out);
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

/// 递归扫目录找 SKILL.md。
fn collect_skills(dir: &Path, root: &Path, out: &mut Vec<DiscoveredSkill>) {
    let skill_md = dir.join("SKILL.md");
    if skill_md.is_file() {
        if let Some(item) = build_discovered(&skill_md, dir, root) {
            out.push(item);
        }
        // 找到 SKILL.md 就不再往里递归（skill 目录是叶子）
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() && !is_noise_dir(&path) {
            collect_skills(&path, root, out);
        }
    }
}

/// 扫的时候跳过的目录。
fn is_noise_dir(path: &Path) -> bool {
    let Some(name) = path.file_name().map(|n| n.to_string_lossy().to_string()) else {
        return false;
    };
    name == ".git"
        || name == "node_modules"
        || name == "__MACOSX"
        || name == "target"
        || name == "dist"
        || name == "build"
}

/// 从 SKILL.md 读出名字和描述。
fn build_discovered(skill_md: &Path, dir: &Path, root: &Path) -> Option<DiscoveredSkill> {
    let raw = std::fs::read_to_string(skill_md).ok()?;
    let (frontmatter, _) = skills::parse_frontmatter_public(&raw);
    let name = skills::fm_get_public(&frontmatter, "name");
    let name = if name.is_empty() {
        dir.file_name()?.to_string_lossy().to_string()
    } else {
        name
    };
    let description = skills::fm_get_public(&frontmatter, "description");
    let path = skill_md
        .strip_prefix(root)
        .map(|rest| rest.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| skill_md.to_string_lossy().to_string());
    Some(DiscoveredSkill {
        name,
        description,
        path,
    })
}


/// 从 git 仓库导入 skill。
///
/// `source` 形如 `git:github.com/owner/repo@ref`。
/// `skill_paths` 是相对仓库根的路径（如 `skills/foo/SKILL.md`）——
/// 空 = 导入仓库里所有带 SKILL.md 的目录。
///
/// 仓库自己 clone 到 `~/.agent-compose/git/` 下，来源记成 git 源 ——
/// 刷新时能按仓库重新拉，不用依赖谁的本地缓存。
pub fn skills_import_git(
    paths: &Paths,
    source: &str,
    skill_paths: &[String],
) -> Result<Vec<skills::SkillInfo>, String> {
    let parsed = crate::git_source::parse_git_source(source)
        .ok_or_else(|| format!("不是 git 源：{source}"))?;
    let repo_dir = crate::git_source::ensure_cloned(paths, &parsed)?;

    // 要哪些 skill：显式列了就按列的来，没列就全找
    let mut targets: Vec<PathBuf> = Vec::new();
    if skill_paths.is_empty() {
        targets = find_all_skill_dirs(&repo_dir);
    } else {
        for rel in skill_paths {
            let cleaned = rel.trim_start_matches('+');
            let cleaned = cleaned.strip_prefix("./").unwrap_or(cleaned);
            let path = repo_dir.join(cleaned);
            let dir = if path.file_name().map(|n| n == "SKILL.md").unwrap_or(false) {
                match path.parent() {
                    Some(parent) => parent.to_path_buf(),
                    None => continue,
                }
            } else {
                path
            };
            if dir.join("SKILL.md").is_file() {
                targets.push(dir);
            }
        }
    }
    if targets.is_empty() {
        return Err(format!(
            "{} 里没找到 skill（要具体的路径，或让它自己找）",
            parsed.repo
        ));
    }

    let mut out: Vec<skills::SkillInfo> = Vec::new();
    for dir in targets {
        let files = match skills::collect_skill_files_public(&dir) {
            Ok(files) => files,
            Err(_) => continue,
        };
        let raw = files
            .iter()
            .find(|file| file.rel.eq_ignore_ascii_case("SKILL.md"))
            .map(|file| String::from_utf8_lossy(&file.data).to_string())
            .unwrap_or_default();
        let (frontmatter, _) = skills::parse_frontmatter_public(&raw);
        let declared = skills::fm_get_public(&frontmatter, "name");
        let name = if declared.is_empty() {
            dir.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "skill".to_string())
        } else {
            declared
        };
        let description = skills::fm_get_public(&frontmatter, "description");
        match skills::write_skill_public(paths, &name, &description, "git", files) {
            Ok(mut info) => {
                // 记 git 源 —— 刷新时按仓库重新拉
                skills::set_origin_public(
                    paths,
                    &name,
                    Some(skills::origin_git_public(
                        &parsed.repo,
                        parsed.reference.as_deref(),
                    )),
                );
                info.refreshable = true;
                out.push(info);
            }
            // 已存在同名 —— 覆盖它（用户明确要从这个源导入）
            Err(error) if error.contains("已存在同名 skill") => {
                let target = paths
            .skills_root()
            .join(skills::sanitize_skill_name_public(&name));
                let _ = std::fs::remove_dir_all(&target);
                let files = skills::collect_skill_files_public(&dir)?;
                match skills::write_skill_public(paths, &name, &description, "git", files) {
                    Ok(mut info) => {
                        skills::set_origin_public(
                            paths,
                            &name,
                            Some(skills::origin_git_public(
                                &parsed.repo,
                                parsed.reference.as_deref(),
                            )),
                        );
                        info.refreshable = true;
                        out.push(info);
                    }
                    Err(error) => return Err(error),
                }
            }
            Err(error) => return Err(error),
        }
    }
    if out.is_empty() {
        return Err("一个都没导进来".to_string());
    }
    Ok(out)
}

/// 找一个目录下所有带 SKILL.md 的 skill 目录（含下一层）。
fn find_all_skill_dirs(root: &Path) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    let Ok(entries) = std::fs::read_dir(root) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if path.join("SKILL.md").is_file() {
            out.push(path);
            continue;
        }
        out.extend(find_all_skill_dirs(&path));
    }
    out.sort();
    out
}

/// 从仓库里导入选中的 skill。
///
/// `paths` 是相对仓库根的 SKILL.md 路径列表（`discover_skills` 给的）。
pub fn import_skills(
    paths: &Paths,
    repo: &RepoRef,
    branch: &str,
    selected: &[String],
) -> Result<Vec<skills::SkillInfo>, String> {
    if selected.is_empty() {
        return Err("一个都没选".to_string());
    }
    let root = clone_repo(paths, repo, branch)?;
    let mut out: Vec<skills::SkillInfo> = Vec::new();

    for rel in selected {
        let cleaned = rel.trim_start_matches("./");
        let skill_md = root.join(cleaned);
        let Some(dir) = skill_md.parent() else { continue };
        if !skill_md.is_file() {
            continue;
        }
        let files: Vec<SkillFile> = skills::collect_skill_files_public(dir)?;
        let raw = files
            .iter()
            .find(|file| file.rel.eq_ignore_ascii_case("SKILL.md"))
            .map(|file| String::from_utf8_lossy(&file.data).to_string())
            .unwrap_or_default();
        let (frontmatter, _) = skills::parse_frontmatter_public(&raw);
        let name = skills::fm_get_public(&frontmatter, "name");
        let name = if name.is_empty() {
            dir.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default()
        } else {
            name
        };
        let description = skills::fm_get_public(&frontmatter, "description");

        let source = format!("git:github.com/{}@{}", repo.slug(), branch);
        match skills_import_git(paths, &source, &[cleaned.to_string()]) {
            Ok(items) => {
                if let Some(info) = items.into_iter().next() {
                    let _ = (name, description);
                    out.push(info);
                }
            }
            Err(error) => return Err(error),
        }
    }
    if out.is_empty() {
        return Err("一个都没导进来".to_string());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_https_url() {
        let repo = parse_repo_url("https://github.com/farion1231/cc-switch").unwrap();
        assert_eq!(repo.owner, "farion1231");
        assert_eq!(repo.name, "cc-switch");
        assert_eq!(repo.slug(), "farion1231/cc-switch");
    }

    #[test]
    fn parses_url_with_git_suffix() {
        let repo = parse_repo_url("https://github.com/owner/repo.git").unwrap();
        assert_eq!(repo.name, "repo");
    }

    #[test]
    fn parses_ssh_url() {
        let repo = parse_repo_url("git@github.com:owner/repo.git").unwrap();
        assert_eq!(repo.owner, "owner");
        assert_eq!(repo.name, "repo");
    }

    #[test]
    fn parses_bare_slug() {
        let repo = parse_repo_url("owner/repo").unwrap();
        assert_eq!(repo.owner, "owner");
        assert_eq!(repo.name, "repo");
    }

    #[test]
    fn parses_url_with_trailing_path() {
        let repo = parse_repo_url("https://github.com/owner/repo/tree/main").unwrap();
        assert_eq!(repo.owner, "owner");
        assert_eq!(repo.name, "repo");
    }

    #[test]
    fn rejects_garbage() {
        assert!(parse_repo_url("").is_none());
        assert!(parse_repo_url("https://github.com/owner").is_none());
    }
}

#[cfg(test)]
mod live_tests {
    use super::*;

    /// 实测：列出 github.com/farion1231/cc-switch 的分支
    #[test]
    #[ignore = "需要网络"]
    fn live_list_branches() {
        let repo = parse_repo_url("https://github.com/farion1231/cc-switch").unwrap();
        let branches = list_branches(&repo).unwrap();
        println!("分支：{branches:?}");
        assert!(branches.contains(&"main".to_string()) || branches.len() > 0);
    }

    /// 实测：发现仓库里的 skill
    #[test]
    #[ignore = "需要网络"]
    fn live_discover() {
        let paths = Paths::from_env();
        let repo = parse_repo_url("https://github.com/addyosmani/agent-skills").unwrap();
        let skills = discover_skills(&paths, &repo, "main").unwrap();
        for item in skills.iter().take(5) {
            println!("{} | {} | {}", item.name, item.path, item.description);
        }
        println!("共 {} 个", skills.len());
    }
}
