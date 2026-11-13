//! Pi 运行时。
//!
//! Pi 的能力布局：
//! - skill   → `<cwd>/.pi/skills/<名字>/`（Pi 自动扫）
//! - 指令   → `<cwd>/.pi/AGENTS.md`（Pi 原生不读 `.pi/`，靠我们的扩展注入 prompt）
//! - MCP    → `<cwd>/.pi/mcp.json`（每个上游一条）
//! - 扩展   → `<cwd>/.pi/extensions/agentspace.ts`（Pi 自动扫）
//!
//! 启动参数：
//! - `--approve`：项目级 MCP 配置要项目受信任才读
//! - `--extension <path>`：保底 —— 自动发现也要信任，`-e` 不受信任状态影响
//!
//! 信任本身写进 Pi 的 `~/.pi/agent/trust.json`，这样用户之后直接跑
//! 普通 `pi` 也能拿到智能体指令和 MCP 工具。

use std::path::{Path, PathBuf};
use std::process::Stdio;

use super::{ExtensionAsset, Runtime};
use crate::trust;

/// agentspace 的 Pi 扩展：把 `.pi/AGENTS.md` 注入 system prompt。
///
/// 用 `include_str!` 打包进来 —— CLI 是个独立 crate，不带前端资源目录，
/// 也没必要为一个文件引入打包流程。源码在 `assets/agentspace-extension.ts`。
const EXTENSION_SOURCE: &str = include_str!("../../assets/agentspace-extension.ts");

/// 扩展在项目里的落点（相对 `.pi/`）。
///
/// 放在 `.pi/extensions/` 下 —— 这是 Pi 的**原生项目扩展目录**，
/// `discoverExtensionsInDir()` 会自动扫里面的 `*.ts` / `*.js`
/// （`loader.js:641`）。不需要改 `.pi/settings.json`，也不会动用户的配置。
const EXTENSION_RELATIVE_PATH: &str = "extensions/agentspace.ts";

/// Pi 运行时。
#[derive(Clone, Copy, Debug, Default)]
pub struct PiRuntime;

impl PiRuntime {
    pub fn new() -> Self {
        Self
    }

    /// 找 Pi 的可执行文件。找不到返回 `None`。
    fn find_binary(&self) -> Option<PathBuf> {
        let mut dirs: Vec<PathBuf> = Vec::new();
        if let Some(path) = std::env::var_os("PATH") {
            dirs.extend(std::env::split_paths(&path));
        }
        dirs.extend(fallback_dirs());
        for dir in dirs {
            for candidate in candidates(&dir) {
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
        None
    }
}

/// 常见的安装位置（相对 PATH 之外的兜底）。
fn fallback_dirs() -> Vec<PathBuf> {
    let home = crate::paths::home_dir();
    let mut dirs = Vec::new();
    // npm 全局 bin
    if let Ok(prefix) = std::env::var("NVM_SYMLINK") {
        dirs.push(PathBuf::from(prefix));
    }
    if let Ok(prefix) = std::env::var("APPDATA") {
        dirs.push(PathBuf::from(prefix).join("npm"));
    }
    if let Ok(prefix) = std::env::var("LOCALAPPDATA") {
        dirs.push(PathBuf::from(prefix).join("pnpm"));
    }
    dirs.push(home.join(".bun").join("bin"));
    dirs.push(home.join(".local").join("bin"));
    dirs.push(home.join(".npm-global").join("bin"));
    dirs
}

/// 一个目录下的可执行文件名（Windows 上 npm 会写 `pi.cmd` 与无扩展名两个入口）。
fn candidates(dir: &Path) -> Vec<PathBuf> {
    if cfg!(windows) {
        vec![
            dir.join("pi.cmd"),
            dir.join("pi.exe"),
            dir.join("pi.bat"),
            dir.join("pi"),
        ]
    } else {
        vec![dir.join("pi")]
    }
}

impl Runtime for PiRuntime {
    fn id(&self) -> &'static str {
        "pi"
    }

    fn label(&self) -> &'static str {
        "Pi"
    }

    fn is_installed(&self) -> bool {
        self.find_binary().is_some()
    }

    fn install_hint(&self) -> String {
        "npm i -g @earendil-works/pi-coding-agent@latest".to_string()
    }

    fn config_dir(&self, cwd: &Path) -> PathBuf {
        cwd.join(".pi")
    }

    fn skills_dir(&self, cwd: &Path) -> PathBuf {
        cwd.join(".pi").join("skills")
    }

    fn instructions_file(&self, cwd: &Path) -> PathBuf {
        cwd.join(".pi").join("AGENTS.md")
    }

    fn mcp_config_file(&self, cwd: &Path) -> Option<PathBuf> {
        Some(cwd.join(".pi").join("mcp.json"))
    }

    fn extension(&self) -> Option<ExtensionAsset> {
        Some(ExtensionAsset {
            relative_path: EXTENSION_RELATIVE_PATH,
            source: EXTENSION_SOURCE,
        })
    }

    fn state_file(&self, cwd: &Path) -> PathBuf {
        cwd.join(".pi").join("agentspace.json")
    }

    fn migrate_legacy(&self, cwd: &Path) {
        // 清掉根目录那份旧的托管块（用户自己写的内容不动）
        //
        // 不清的话 Pi 会同时看到两份指令 —— 原生发现的 `<cwd>/AGENTS.md`
        // 和扩展注入的 `.pi/AGENTS.md`。
        let legacy = cwd.join("AGENTS.md");
        if !legacy.is_file() {
            return;
        }
        match crate::prepare::remove_managed_block(&legacy) {
            Ok(true) => eprintln!("已把旧的 AGENTS.md 托管块移到 .pi/AGENTS.md。"),
            Ok(false) => {}
            Err(error) => eprintln!("清理旧的 AGENTS.md 失败：{error}"),
        }
    }

    fn mcp_entry_name(&self, server_id: &str) -> String {
        sanitize_entry_name(server_id)
    }

    fn mcp_entry(&self, server_id: &str, endpoint: &str, token: &str) -> serde_json::Value {
        serde_json::json!({
            "type": "http",
            "url": format!("{endpoint}/mcp/s/{}", encode_component(server_id)),
            "headers": { "Authorization": format!("Bearer {token}") },
        })
    }

    fn before_launch(&self, cwd: &Path) {
        // 把项目登记进 Pi 的信任名单 —— 这样用户之后直接在该目录跑 `pi`，
        // `.pi/extensions/` 里的 agentspace 扩展和 `.pi/mcp.json` 也会自动加载。
        // `--approve` 只对这一次进程有效，trust.json 才是持久的。
        match trust::trust_project(cwd) {
            Ok(true) => {}
            Ok(false) => eprintln!(
                "提示：这个项目在 Pi 的信任名单里被标成了「不信任」，普通 pi 启动时不会加载 .pi/ 里的配置。\n\
                 想让它生效可以删掉 {} 里对应的那一条。",
                trust::trust_file().display()
            ),
            Err(error) => eprintln!(
                "写 Pi 信任名单失败（{}）：{error}",
                trust::trust_file().display()
            ),
        }
    }

    fn launch_args(&self, cwd: &Path) -> Vec<String> {
        let mut args: Vec<String> = Vec::new();
        // 项目里有我们写的 .pi/（skills / mcp.json）→ 让 Pi 信任这个项目，
        // 否则项目级 MCP 配置会被静默忽略（skill 不受影响）。
        if cwd.join(".pi").is_dir() {
            args.push("--approve".to_string());
        }
        // 扩展：`-e` 显式传，自动发现要信任才生效，`-e` 不受信任状态影响。
        // Pi 按解析后的绝对路径去重（`loader.js:676`），所以只加载一次。
        if let Some(asset) = self.extension() {
            let path = cwd.join(".pi").join(asset.relative_path);
            if path.is_file() {
                args.push("--extension".to_string());
                args.push(path.to_string_lossy().to_string());
            }
        }
        args
    }

    fn launch(&self, cwd: &Path, args: &[String]) -> Option<i32> {
        let binary = self.find_binary()?;
        // 走 proc::command —— pi 在 Windows 上是 pi.cmd，Rust 会用 cmd.exe /c
        // 包一层。不加 CREATE_NO_WINDOW 的话会弹出一个多余的 cmd 窗口。
        let mut cmd = agentspace_core::proc::command(&binary);
        cmd.args(self.launch_args(cwd));
        cmd.args(args);
        cmd.current_dir(cwd);
        cmd.stdin(Stdio::inherit());
        cmd.stdout(Stdio::inherit());
        cmd.stderr(Stdio::inherit());
        match cmd.status() {
            Ok(status) => Some(status.code().unwrap_or(1)),
            Err(error) => {
                eprintln!("启动 Pi 失败：{error}");
                None
            }
        }
    }
}

/// MCP 配置里一个上游对应的条目名。
///
/// 用上游的 id（如 `filesystem`）—— 在 Pi 的 MCP 列表里一眼认得出是哪个。
/// id 里可能有不适合做键名的字符，换成 `-`。
/// MCP 配置里一个上游对应的条目名。
///
/// 用上游的 id（如 `filesystem`）—— 在 Pi 的 MCP 列表里一眼认得出是哪个。
/// id 里可能有不适合做键名的字符，换成 `-`。
fn sanitize_entry_name(server_id: &str) -> String {
    let cleaned: String = server_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect();
    if cleaned.is_empty() {
        "agentspace".to_string()
    } else {
        cleaned
    }
}

/// 极简 percent-encoding：只放行字母数字和 `-` `_` `.` `~`。
fn encode_component(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_identity() {
        let runtime = PiRuntime::new();
        assert_eq!(runtime.id(), "pi");
        assert_eq!(runtime.label(), "Pi");
    }

    #[test]
    fn layout_points_at_pi_dir() {
        let runtime = PiRuntime::new();
        let cwd = Path::new("/tmp/project");
        assert_eq!(runtime.skills_dir(cwd), Path::new("/tmp/project/.pi/skills"));
        assert_eq!(
            runtime.instructions_file(cwd),
            Path::new("/tmp/project/.pi/AGENTS.md")
        );
        assert_eq!(
            runtime.mcp_config_file(cwd),
            Some(PathBuf::from("/tmp/project/.pi/mcp.json"))
        );
        assert_eq!(
            runtime.state_file(cwd),
            Path::new("/tmp/project/.pi/agentspace.json")
        );
    }

    #[test]
    fn extension_asset_is_the_agentspace_extension() {
        let runtime = PiRuntime::new();
        let asset = runtime.extension().expect("Pi 有扩展机制");
        assert_eq!(asset.relative_path, "extensions/agentspace.ts");
        assert!(asset.source.contains("before_agent_start"));
        assert!(asset.source.contains("AGENTS.md"));
    }

    #[test]
    fn mcp_entry_points_at_single_server() {
        let runtime = PiRuntime::new();
        let entry = runtime.mcp_entry("filesystem", "http://127.0.0.1:7801", "AgentSpace");
        assert_eq!(entry["url"], "http://127.0.0.1:7801/mcp/s/filesystem");
        assert_eq!(entry["headers"]["Authorization"], "Bearer AgentSpace");
        assert_eq!(runtime.mcp_entry_name("filesystem"), "filesystem");
    }

    #[test]
    fn mcp_entry_encodes_odd_server_id() {
        let runtime = PiRuntime::new();
        let entry = runtime.mcp_entry("a b/c", "http://x", "t");
        assert_eq!(entry["url"], "http://x/mcp/s/a%20b%2Fc");
    }

    #[test]
    fn entry_name_falls_back_when_empty() {
        assert_eq!(sanitize_entry_name(""), "agentspace");
        assert_eq!(sanitize_entry_name("a b"), "a-b");
    }
}
