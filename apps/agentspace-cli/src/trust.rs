//! 把项目登记进 Pi 的信任名单。
//!
//! 为什么需要：Pi 的项目级资源（`.pi/extensions/`、`.pi/mcp.json`、
//! `.pi/skills/` …）都要**项目受信任**才加载。用户跑 `agentspace run`
//! 时我们用 `--approve` 绕过了这个检查，但那只对那一次进程有效 ——
//! 用户之后直接在该目录跑 `pi`，扩展和 MCP 配置就都不会加载了。
//!
//! Pi 给的原生持久化手段是 `~/.pi/agent/trust.json`：
//! 一个 `{ "<项目绝对路径>": true | false }` 的映射。
//! 这也是 Pi 交互式询问「信任并记住」时写的地方。
//!
//! 信任是**按项目**记的 —— 只影响这一个目录（及其子目录，
//! `findNearestTrustEntry` 会往上找），别的项目不受影响。

use std::fs;
use std::path::{Path, PathBuf};

/// Pi 的 agent 目录。
///
/// 默认 `~/.pi/agent`；`PI_CODING_AGENT_DIR` 可以覆盖（跟 Pi 的
/// `getAgentDir()` 一致）。
pub fn agent_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("PI_CODING_AGENT_DIR") {
        if !dir.is_empty() {
            return PathBuf::from(dir);
        }
    }
    crate::paths::home_dir().join(".pi").join("agent")
}

/// Pi 的信任名单文件。
pub fn trust_file() -> PathBuf {
    agent_dir().join("trust.json")
}

/// 信任名单里的键。
///
/// 要跟 Pi 那边对得上，Pi 的 `normalizeCwd()` 是
/// `canonicalizePath(resolvePath(cwd))`，也就是「绝对路径 + 解析符号链接」。
/// Rust 的 `canonicalize` 同样解析符号链接，但 Windows 上会带
/// `\\?\` 前缀 —— Node 的 `realpathSync` 不带，得去掉。
pub fn trust_key(cwd: &Path) -> String {
    let resolved = std::fs::canonicalize(cwd).unwrap_or_else(|_| cwd.to_path_buf());
    let text = resolved.to_string_lossy().to_string();
    // Windows：去掉 `\\?\` 前缀，跟 Node 的 realpathSync 对齐
    match text.strip_prefix(r"\\?\") {
        Some(stripped) => stripped.to_string(),
        None => text,
    }
}

/// 把项目登记为可信。
///
/// 已经有明确记成「不信任」的条目时**不覆盖** —— 那是用户自己拒绝过的，
/// 不该被我们悄悄推翻。这种情况返回 `Ok(false)`，让调用方提示用户。
///
/// 返回值：`true` = 已登记（或本来就是），`false` = 用户拒绝过，没动。
pub fn trust_project(cwd: &Path) -> std::io::Result<bool> {
    let path = trust_file();
    let key = trust_key(cwd);

    let mut map: serde_json::Map<String, serde_json::Value> = match fs::read_to_string(&path) {
        Ok(raw) => match serde_json::from_str::<serde_json::Value>(&raw) {
            Ok(serde_json::Value::Object(obj)) => obj,
            // 文件坏了别覆盖它 —— 那是用户的其它状态，砸了不好
            Ok(_) => return Ok(false),
            Err(_) => return Ok(false),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => serde_json::Map::new(),
        Err(error) => return Err(error),
    };

    // 找同一个目录的旧条目（Windows 上大小写可能不同）
    let existing_key = map
        .keys()
        .find(|candidate| paths_equal(candidate.as_str(), &key))
        .cloned();
    match existing_key {
        // 已有条目且用户明确拒绝过 → 不推翻他的选择
        Some(existing) if map.get(&existing) == Some(&serde_json::Value::Bool(false)) => {
            return Ok(false)
        }
        Some(existing) => {
            map.insert(existing, serde_json::Value::Bool(true));
        }
        None => {
            map.insert(key.clone(), serde_json::Value::Bool(true));
        }
    }

    // Pi 写这个文件时是「键排序 + 两空格缩进 + 末尾换行」，照着来
    let sorted: serde_json::Map<String, serde_json::Value> = {
        let mut keys: Vec<&String> = map.keys().collect();
        keys.sort();
        let mut out = serde_json::Map::new();
        for key in keys {
            if let Some(value) = map.get(key) {
                out.insert(key.clone(), value.clone());
            }
        }
        out
    };

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let body = serde_json::to_string_pretty(&serde_json::Value::Object(sorted))
        .unwrap_or_else(|_| "{}".to_string());
    fs::write(&path, format!("{body}\n"))?;
    Ok(true)
}

/// 路径比较（Windows 上不区分大小写）。
fn paths_equal(a: &str, b: &str) -> bool {
    if cfg!(windows) {
        a.eq_ignore_ascii_case(b)
    } else {
        a == b
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trust_key_strips_windows_verbatim_prefix() {
        // `\\?\C:\x` → `C:\x`
        let raw = r"\\?\C:\Users\test";
        let stripped = raw.strip_prefix(r"\\?\").unwrap_or(raw);
        assert_eq!(stripped, r"C:\Users\test");
    }

    #[test]
    fn trust_key_matches_input_for_existing_dir() {
        let dir = std::env::temp_dir().join("agentspace-cli-trust-key");
        let _ = fs::create_dir_all(&dir);
        let key = trust_key(&dir);
        assert!(key.contains("agentspace-cli-trust-key"));
        assert!(!key.starts_with(r"\\?\"));
    }

    #[test]
    fn paths_equal_ignores_case_on_windows() {
        if cfg!(windows) {
            assert!(paths_equal(r"C:\Users\Test", r"c:\users\test"));
        } else {
            assert!(!paths_equal("/a", "/A"));
        }
    }
}
