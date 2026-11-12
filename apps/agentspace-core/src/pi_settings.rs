//! 从 Pi 项目的 `settings.json` 里读出 skill 清单。
//!
//! # 为什么需要
//!
//! Pi 的项目配置（`.pi/settings.json`）用 `packages` 数组声明 skill：
//!
//! ```json
//! {
//!   "packages": [
//!     "git:github.com/addyosmani/agent-skills@v0.6.13",
//!     { "source": "git:github.com/mattpocock/skills@v1.3.1",
//!       "skills": ["skills/engineering/code-review/SKILL.md"] },
//!     { "source": "npm:pi-subagents@0.86.0" }
//!   ]
//! }
//! ```
//!
//! 这些包由 Pi 自己克隆到项目的 `.pi/git/<host>/<owner>/<repo>/`
//! 和 `.pi/npm/node_modules/` 里。包里的 skill 路径是**相对包根**的。
//!
//! 我们要把这些 skill 收进自己的 skill 仓库（让智能体绑定），
//! 就得知道「包在哪 + skill 在包的哪个位置」—— 这件事只有读配置才知道。

use std::path::{Path, PathBuf};

use serde::Deserialize;

/// `settings.json` 里的一条 package 声明。
///
/// 有两种形态：字符串（只有来源），或对象（来源 + 明确的 skill 列表）。
#[derive(Clone, Debug, Deserialize)]
#[serde(untagged)]
pub enum PackageDecl {
    /// 只有来源（如 `"npm:pi-subagents@0.86.0"`）——
    /// skill 走包自己的约定（`skills/**`），不显式列。
    Source(String),
    /// 来源 + 显式的资源清单。
    Detailed(PackageDetail),
}

#[derive(Clone, Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PackageDetail {
    /// 包来源：`git:github.com/owner/repo@ref` / `npm:pkg@version`。
    #[serde(default)]
    pub source: String,
    /// 显式列出的 skill 路径（相对包根）。
    #[serde(default)]
    pub skills: Vec<String>,
}

/// 项目配置里我们要的字段。
#[derive(Clone, Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSettings {
    /// 包声明列表。
    #[serde(default)]
    pub packages: Vec<PackageDecl>,
}

/// 读项目的 `settings.json`。
pub fn read_settings(path: &Path) -> Result<ProjectSettings, String> {
    let raw = std::fs::read_to_string(path).map_err(|e| format!("读 {} 失败：{e}", path.display()))?;
    // Pi 允许 settings.json 里有注释（jsonc）—— 解析失败不直接报错，
    // 先按标准 json 试，失败就当没有 packages。
    serde_json::from_str(&raw).map_err(|e| format!("解析 settings.json 失败：{e}"))
}

/// 包在磁盘上的位置。
///
/// - `git:github.com/owner/repo@ref` → `<pi>/git/github.com/owner/repo/`
/// - `npm:pkg@version` → `<pi>/npm/node_modules/<pkg>/`
///
/// `pi_dir` 是项目的 `.pi` 目录。
pub fn package_dir(pi_dir: &Path, source: &str) -> Option<PathBuf> {
    let rest = source
        .strip_prefix("git:")
        .or_else(|| source.strip_prefix("npm:"))?;
    // 去掉 @ref / @version 后缀 —— 缓存目录里不带版本号。
    // scope 里的第一个 @ 要保留（`@scope/pkg@1.0.0` → `@scope/pkg`）。
    let without_ref = match rest.rfind('@') {
        Some(index) => {
            // 位置在 scope 的 @ 之后 → 那是版本号，剥掉
            let scope_at = rest.find('@').filter(|at| rest[..*at].is_empty());
            match scope_at {
                Some(scope) if scope < index => &rest[..index],
                Some(scope) => &rest[..scope],
                None => &rest[..index],
            }
        }
        None => rest,
    };
    if source.starts_with("git:") {
        Some(pi_dir.join("git").join(without_ref))
    } else {
        Some(pi_dir.join("npm").join("node_modules").join(without_ref))
    }
}

/// 一个 skill 的定位结果。
#[derive(Clone, Debug)]
pub struct ResolvedSkill {
    /// skill 所在目录（含 SKILL.md）。
    pub dir: PathBuf,
    /// 声明里的路径（相对包根），用来报错的定位。
    pub declared: String,
    /// 来自哪个包。
    pub package: String,
    /// skill 的名字（读 SKILL.md 的 frontmatter，没有就用目录名）。
    ///
    /// 用来去重 —— 一个包里可能有同一批 skill 的多份拷贝
    /// （比如 `skills/` 和 `.openclaw/skills/`）。
    pub name: String,
}

/// 列出配置里声明的全部 skill 位置。
///
/// 找不到的（包没克隆下来）跳过 —— 那说明用户还没跑过 Pi，
/// 不是我们该拦下的事。
pub fn resolve_skills(
    settings: &ProjectSettings,
    pi_dir: &Path,
) -> Vec<ResolvedSkill> {
    let mut out: Vec<ResolvedSkill> = Vec::new();
    for decl in &settings.packages {
        let (source, declared) = match decl {
            PackageDecl::Source(source) => (source.as_str(), Vec::new()),
            PackageDecl::Detailed(detail) => (detail.source.as_str(), detail.skills.clone()),
        };
        let Some(dir) = package_dir(pi_dir, source) else {
            continue;
        };
        if !dir.is_dir() {
            continue;
        }

        if declared.is_empty() {
            // 没显式列 → 按包自己的约定找：所有 skills/**/SKILL.md。
            // `skills/` 优先 —— 有的包在别处（如 `.openclaw/skills/`）
            // 放了同一批 skill 的拷贝，那份是给别的 agent 用的。
            let mut found_all = find_skills_under(&dir);
            found_all.sort_by_key(|path| {
                // `skills/` 开头的排前面
                let relative = path.strip_prefix(&dir).unwrap_or(path);
                let is_standard = relative
                    .components()
                    .next()
                    .map(|c| c.as_os_str() == "skills")
                    .unwrap_or(false);
                (!is_standard, relative.to_path_buf())
            });
            for found in found_all {
                let name = skill_name_of(&found);
                out.push(ResolvedSkill {
                    package: source.to_string(),
                    declared: found
                        .strip_prefix(&dir)
                        .map(|rest| rest.to_string_lossy().replace('\\', "/"))
                        .unwrap_or_default(),
                    dir: found,
                    name,
                });
            }
            continue;
        }

        for rel in &declared {
            // 声明的路径相对包根；`+./SKILL.md` 这种带前缀的写法要剥掉
            let cleaned = rel.trim_start_matches('+');
            let cleaned = cleaned.strip_prefix("./").unwrap_or(cleaned);
            let path = dir.join(cleaned);
            // SKILL.md → 它的目录
            let skill_dir = if path.file_name().map(|n| n == "SKILL.md").unwrap_or(false) {
                path.parent().map(|p| p.to_path_buf())
            } else {
                Some(path.clone())
            };
            let Some(skill_dir) = skill_dir else { continue };
            if skill_dir.join("SKILL.md").is_file() {
                out.push(ResolvedSkill {
                    package: source.to_string(),
                    declared: rel.clone(),
                    name: skill_name_of(&skill_dir),
                    dir: skill_dir,
                });
            }
        }
    }

    // 按名字去重：同一个包里有同一批 skill 的多份拷贝时留第一份。
    // 显式声明的优先（它们在列表里先被处理）。
    let mut seen: Vec<String> = Vec::new();
    let mut deduped: Vec<ResolvedSkill> = Vec::new();
    for item in out {
        if seen.iter().any(|name| name == &item.name) {
            continue;
        }
        seen.push(item.name.clone());
        deduped.push(item);
    }
    deduped
}

/// 读 SKILL.md 的 frontmatter 拿名字；没有就用目录名。
fn skill_name_of(dir: &Path) -> String {
    let raw = std::fs::read_to_string(dir.join("SKILL.md")).unwrap_or_default();
    for line in raw.lines().take(20) {
        let trimmed = line.trim();
        if let Some(value) = trimmed.strip_prefix("name:") {
            let name = value.trim().trim_matches('"').trim_matches('\'');
            if !name.is_empty() {
                return name.to_string();
            }
        }
    }
    dir.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// 找一个目录下所有带 `SKILL.md` 的 skill 目录。
fn find_skills_under(root: &Path) -> Vec<PathBuf> {
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
        // 再往下找（包根 → skills/<名字>/SKILL.md 这类布局）
        out.extend(find_skills_under(&path));
    }
    out.sort();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_string_and_detailed_packages() {
        let raw = r#"{
          "packages": [
            "npm:pi-subagents@0.86.0",
            { "source": "git:github.com/mattpocock/skills@v1.3.1",
              "skills": ["skills/engineering/code-review/SKILL.md"] }
          ]
        }"#;
        let settings: ProjectSettings = serde_json::from_str(raw).unwrap();
        assert_eq!(settings.packages.len(), 2);
        assert!(matches!(settings.packages[0], PackageDecl::Source(_)));
        assert!(matches!(settings.packages[1], PackageDecl::Detailed(_)));
    }

    #[test]
    fn package_dir_strips_ref() {
        let pi = Path::new("/p/.pi");
        assert_eq!(
            package_dir(pi, "git:github.com/owner/repo@v1.0.0"),
            Some(PathBuf::from("/p/.pi/git/github.com/owner/repo"))
        );
        assert_eq!(
            package_dir(pi, "npm:pi-subagents@0.86.0"),
            Some(PathBuf::from("/p/.pi/npm/node_modules/pi-subagents"))
        );
    }

    #[test]
    fn package_dir_keeps_scope_at_sign() {
        let pi = Path::new("/p/.pi");
        assert_eq!(
            package_dir(pi, "npm:@scope/pkg@1.0.0"),
            Some(PathBuf::from("/p/.pi/npm/node_modules/@scope/pkg"))
        );
    }

    #[test]
    fn unknown_source_is_ignored() {
        assert_eq!(package_dir(Path::new("/p"), "local:/somewhere"), None);
    }

    #[test]
    fn resolves_declared_skills() {
        let dir = std::env::temp_dir().join(format!("agentspace-core-pkg-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let pkg = dir.join("git/github.com/owner/repo");
        let skill = pkg.join("skills/one");
        std::fs::create_dir_all(&skill).unwrap();
        std::fs::write(skill.join("SKILL.md"), "# one").unwrap();

        let settings = ProjectSettings {
            packages: vec![PackageDecl::Detailed(PackageDetail {
                source: "git:github.com/owner/repo@v1".to_string(),
                skills: vec!["skills/one/SKILL.md".to_string()],
            })],
        };
        let found = resolve_skills(&settings, &dir);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].dir, skill);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolves_implicit_skills_when_none_declared() {
        let dir = std::env::temp_dir().join(format!("agentspace-core-pkg2-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let pkg = dir.join("npm/node_modules/pkg");
        std::fs::create_dir_all(pkg.join("skills/alpha")).unwrap();
        std::fs::write(pkg.join("skills/alpha/SKILL.md"), "# alpha").unwrap();

        let settings = ProjectSettings {
            packages: vec![PackageDecl::Source("npm:pkg@1.0.0".to_string())],
        };
        let found = resolve_skills(&settings, &dir);
        assert_eq!(found.len(), 1);
        assert!(found[0].dir.ends_with("alpha"));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
