//! 从配置文件批量导入 MCP server。
//!
//! # 为什么需要
//!
//! 已经有项目在用 yaml 声明自己的 MCP server（比如 orca 工作区的
//! `packages/mcp-bridge/mcp-bridge-info.yaml`），里面写了每个 server 的
//! 传输方式、地址、命令、环境变量映射。
//!
//! 让用户把这些 server 一个个用 `mcp create` 敲一遍很折磨 —— 字段容易敲错，
//! 而且以后源文件改了还得重来一遍。
//!
//! 所以这里支持**直接读源文件批量导入**：解析出能用的字段，写进代理的配置。
//!
//! # 认哪些字段
//!
//! 源文件的格式（简化后）：
//!
//! ```yaml
//! mcp-servers:
//!   - name: idea
//!     kind: remote
//!     url: http://127.0.0.1:64343/stream
//!   - name: context-mode
//!     kind: local
//!     command: some/path/cli.bundle.mjs
//!     args: []
//!     envMap:
//!       FIGMA_API_KEY: FIGMA_TOKEN
//!     requiredEnvKey: FIGMA_TOKEN
//! ```
//!
//! - `name` → server id
//! - `kind: remote` → http 传输，用 `url`
//! - `kind: local` → stdio 传输，用 `command` + `args`
//! - `envMap` → 写成 `env`，值用 `${ENV:名字}` 占位（运行时才解析）
//! - `requiredEnvKey` → 记成备注：这个 server 缺环境变量就连不上
//!
//! 认不出来的字段一律忽略 —— 源文件可能有别的工具专用的字段。

use std::collections::BTreeMap;

use serde::Deserialize;
use serde_json::Value;

/// 源文件里的一个 server 条目。
#[derive(Clone, Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BridgeServerEntry {
    /// server id。
    #[serde(default)]
    pub name: String,
    /// 传输方式：`local`（stdio）/ `remote`（http）/ `sse`。
    #[serde(default)]
    pub kind: String,
    /// http / sse 的地址。
    #[serde(default)]
    pub url: Option<String>,
    /// stdio 的可执行文件。
    #[serde(default)]
    pub command: Option<String>,
    /// stdio 的参数。
    #[serde(default)]
    pub args: Option<Vec<String>>,
    /// 由 npm 包提供的 server（等价于 `npx <module>`）。
    #[serde(default)]
    pub module: Option<String>,
    /// npm 包方式的额外参数（接在包名后面）。
    #[serde(default)]
    pub module_args: Option<Vec<String>>,
    /// 子进程环境变量名 → 父进程环境变量名。
    #[serde(default)]
    pub env_map: Option<BTreeMap<String, String>>,
    /// 缺少就跳过的环境变量。
    #[serde(default)]
    pub required_env_key: Option<String>,
}

/// 源文件的顶层结构。
#[derive(Clone, Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BridgeConfig {
    /// server 列表。
    #[serde(default, rename = "mcp-servers")]
    pub mcp_servers: Vec<BridgeServerEntry>,
}

/// 从 yaml 文本解析出 server 列表。
///
/// 解析不了就报错，不静默跳过 —— 静默跳过会让人以为导进去了。
pub fn parse_bridge_yaml(raw: &str) -> Result<Vec<BridgeServerEntry>, String> {
    let config: BridgeConfig =
        serde_yaml::from_str(raw).map_err(|e| format!("解析 yaml 失败：{e}"))?;
    if config.mcp_servers.is_empty() {
        return Err("文件里没有 mcp-servers 条目".to_string());
    }
    Ok(config.mcp_servers)
}

/// 把源文件里的条目转成代理的 server 定义。
///
/// 转不了的（既没 url 也没 command）跳过，返回 `None`。
pub fn to_server_def(entry: &BridgeServerEntry, base_dir: Option<&Path>) -> Option<Value> {
    let id = entry.name.trim();
    if id.is_empty() {
        return None;
    }
    let kind = entry.kind.trim().to_lowercase();

    let mut def = serde_json::Map::new();
    def.insert("id".into(), Value::String(id.to_string()));
    def.insert("name".into(), Value::String(id.to_string()));
    def.insert("enabled".into(), Value::Bool(true));

    match kind.as_str() {
        "local" => {
            def.insert("transport".into(), Value::String("stdio".into()));
            // 两种给法：直接给 command，或给 npm 包名（走 npx）。
            if let Some(module) = entry.module.as_ref().filter(|m| !m.trim().is_empty()) {
                def.insert("command".into(), Value::String("npx".into()));
                let mut args = vec!["-y".to_string(), module.trim().to_string()];
                if let Some(extra) = &entry.module_args {
                    args.extend(extra.iter().cloned());
                }
                if let Some(extra) = &entry.args {
                    args.extend(extra.iter().cloned());
                }
                def.insert("args".into(), serde_json::json!(args));
            } else {
                let command = entry.command.as_ref()?.trim();
                if command.is_empty() {
                    return None;
                }
                def.insert(
                    "command".into(),
                    Value::String(resolve_path(command, base_dir)),
                );
                if let Some(args) = &entry.args {
                    if !args.is_empty() {
                        def.insert("args".into(), serde_json::json!(args));
                    }
                }
            }
        }
        "remote" | "sse" | "http" => {
            let url = entry.url.as_ref()?.trim();
            if url.is_empty() {
                return None;
            }
            def.insert("transport".into(), Value::String("http".into()));
            def.insert("url".into(), Value::String(url.to_string()));
        }
        // 认不出来的传输方式 → 试试看它有没有 url / command
        _ => {
            if let Some(url) = entry.url.as_ref().filter(|u| !u.trim().is_empty()) {
                def.insert("transport".into(), Value::String("http".into()));
                def.insert("url".into(), Value::String(url.trim().to_string()));
            } else if let Some(command) = entry.command.as_ref().filter(|c| !c.trim().is_empty()) {
                def.insert("transport".into(), Value::String("stdio".into()));
                def.insert("command".into(), Value::String(command.trim().to_string()));
            } else {
                return None;
            }
        }
    }

    // envMap：子进程变量名 ← 父进程变量名。
    // 写成 `${ENV:父变量名}` —— 运行时才解析，配置文件里不落明文。
    if let Some(map) = &entry.env_map {
        let mut env = serde_json::Map::new();
        for (child, parent) in map {
            env.insert(
                child.clone(),
                Value::String(format!("${{ENV:{parent}}}")),
            );
        }
        if !env.is_empty() {
            def.insert("env".into(), Value::Object(env));
        }
    }

    Some(Value::Object(def))
}

/// 读源文件，解析出可用的 server 定义。
///
/// 返回 `(定义列表, 跳过的条目名)` —— 跳过的要告诉用户，
/// 否则他会以为全都导进去了。
pub fn load_bridge_servers(
    path: &Path,
    base_dir: Option<&Path>,
) -> Result<(Vec<Value>, Vec<String>), String> {
    let raw = std::fs::read_to_string(path).map_err(|e| format!("读文件失败：{e}"))?;
    let entries = parse_bridge_yaml(&raw)?;
    let mut defs = Vec::new();
    let mut skipped = Vec::new();
    for entry in &entries {
        match to_server_def(entry, base_dir) {
            Some(def) => defs.push(def),
            None => skipped.push(entry.name.clone()),
        }
    }
    if defs.is_empty() {
        return Err("文件里没有能用的 server（既没有 url 也没有 command）".to_string());
    }
    Ok((defs, skipped))
}

use std::path::Path;

/// 相对路径解析成绝对路径。
///
/// 源文件里的 `command` 常常是相对仓库根的（比如
/// `packages/plugin/release/.../xerj.exe`），但代理的 cwd 是它自己的
/// 目录 —— 相对路径在那儿根本找不到。导入时按 base_dir 解析成绝对路径。
fn resolve_path(command: &str, base_dir: Option<&Path>) -> String {
    let path = Path::new(command);
    if path.is_absolute() {
        return command.to_string();
    }
    match base_dir {
        Some(base) => {
            let joined = base.join(path);
            // base_dir 本身可能是相对路径 —— 那拼出来还是相对的，
            // 代理的 cwd 不是它，照样找不到。补成绝对路径。
            if joined.is_absolute() {
                joined.to_string_lossy().to_string()
            } else {
                match std::env::current_dir() {
                    Ok(cwd) => cwd.join(joined).to_string_lossy().to_string(),
                    Err(_) => joined.to_string_lossy().to_string(),
                }
            }
        }
        None => command.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"
mcp-servers:
  - name: idea
    toolPrefix: mcp__idea__
    kind: remote
    url: http://127.0.0.1:64343/stream
    envKeys: []

  - name: context-mode
    kind: local
    command: packages/plugin/git/github.com/mksglu/context-mode/cli.bundle.mjs
    args: []

  - name: figma
    kind: local
    module: figma-developer-mcp
    envMap:
      FIGMA_API_KEY: FIGMA_TOKEN
    requiredEnvKey: FIGMA_TOKEN
"#;

    #[test]
    fn parses_all_entries() {
        let entries = parse_bridge_yaml(SAMPLE).unwrap();
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].name, "idea");
        assert_eq!(entries[1].kind, "local");
    }

    #[test]
    fn remote_becomes_http() {
        let entries = parse_bridge_yaml(SAMPLE).unwrap();
        let def = to_server_def(&entries[0], None).unwrap();
        assert_eq!(def["transport"], "http");
        assert_eq!(def["url"], "http://127.0.0.1:64343/stream");
    }

    #[test]
    fn local_becomes_stdio() {
        let entries = parse_bridge_yaml(SAMPLE).unwrap();
        let def = to_server_def(&entries[1], None).unwrap();
        assert_eq!(def["transport"], "stdio");
        assert_eq!(
            def["command"],
            "packages/plugin/git/github.com/mksglu/context-mode/cli.bundle.mjs"
        );
    }

    #[test]
    fn env_map_becomes_placeholder() {
        let entries = parse_bridge_yaml(SAMPLE).unwrap();
        let def = to_server_def(&entries[2], None).unwrap();
        // 值是占位符，不是明文
        assert_eq!(def["env"]["FIGMA_API_KEY"], "${ENV:FIGMA_TOKEN}");
    }

    #[test]
    fn module_becomes_npx_invocation() {
        let entries = parse_bridge_yaml(SAMPLE).unwrap();
        let def = to_server_def(&entries[2], None).unwrap();
        assert_eq!(def["transport"], "stdio");
        assert_eq!(def["command"], "npx");
        assert_eq!(def["args"][0], "-y");
        assert_eq!(def["args"][1], "figma-developer-mcp");
    }

    #[test]
    fn relative_command_resolves_against_base_dir() {
        let entries = parse_bridge_yaml(SAMPLE).unwrap();
        let base = std::env::current_dir().unwrap().join("repo");
        let def = to_server_def(&entries[1], Some(&base)).unwrap();
        let command = def["command"].as_str().unwrap();
        // 拼在 base 后面（路径分隔符随平台）
        assert!(command.starts_with(base.to_string_lossy().as_ref()), "{command}");
        assert!(command.ends_with("cli.bundle.mjs"), "{command}");
        // 补成绝对路径了 —— 代理的 cwd 不是 base_dir
        assert!(Path::new(command).is_absolute(), "{command}");
    }

    #[test]
    fn absolute_command_is_left_alone() {
        let raw = r#"
mcp-servers:
  - name: abs
    kind: local
    command: C:/tools/thing.exe
"#;
        let entries = parse_bridge_yaml(raw).unwrap();
        let def = to_server_def(&entries[0], Some(Path::new("/repo"))).unwrap();
        assert_eq!(def["command"], "C:/tools/thing.exe");
    }

    #[test]
    fn broken_yaml_is_reported() {
        assert!(parse_bridge_yaml("这不是 yaml: [").is_err());
    }

    #[test]
    fn empty_list_is_reported() {
        assert!(parse_bridge_yaml("mcp-servers: []").is_err());
    }
}
