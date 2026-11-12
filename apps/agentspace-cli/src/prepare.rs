//! 把智能体的能力落到启动目录里。
//!
//! 这一层是**运行时无关**的：具体落在哪儿、条目长什么样，由
//! [`Runtime`](crate::runtime::Runtime) 决定。这里只管流程：
//!
//! 1. 看落地记录，版本对不上就问用户要不要覆盖
//! 2. skill → 运行时的 skill 目录
//! 3. 指令 → 运行时的指令文件（托管块）
//! 4. 扩展 → 运行时的扩展文件（没有扩展机制就跳过）
//! 5. MCP   → 运行时的 MCP 配置（每个上游一条）
//! 6. 写落地记录

use std::fs;
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use agentspace_core::agent::CreatedAgent;
use agentspace_core::Paths;
use crate::mcp;
use crate::runtime::Runtime;

/// 托管块的起止标记（抄 multica 的做法：块外的内容永远不动）。
const BLOCK_BEGIN: &str = "<!-- BEGIN AGENTSPACE-RUNTIME (auto-managed; do not edit) -->";
const BLOCK_END: &str = "<!-- END AGENTSPACE-RUNTIME -->";
/// 托管块与用户内容之间的分隔。
const BLOCK_SEPARATOR: &str = "\n\n";

/// 落地记录（默认在运行时的配置目录下）。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LandedState {
    /// 落地时对应的智能体 id
    pub agent_id: String,
    /// 落地时对应的智能体名
    pub agent_name: String,
    /// 落地时的智能体版本
    pub version: u64,
    /// 落地时用的运行时（Pi）
    pub runtime: String,
    /// 写了哪些文件（相对启动目录）
    pub files: Vec<String>,
    /// 写进 MCP 配置的条目名。
    ///
    /// 下次启动时靠它认出自家的条目：不再绑定的删掉，别人手写的留着。
    pub mcp_entries: Vec<String>,
}

impl Default for LandedState {
    fn default() -> Self {
        Self {
            agent_id: String::new(),
            agent_name: String::new(),
            version: 0,
            runtime: String::new(),
            files: Vec::new(),
            mcp_entries: Vec::new(),
        }
    }
}

/// 要不要覆盖项目里已有的配置。
///
/// 三种情形：
/// - 没落过地 / 版本一样 → 直接覆盖
/// - 版本不一样 → 问用户（终端里人说了算）
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Overwrite {
    /// 直接用新版本覆盖
    Yes,
    /// 问用户（用户答「否」就保留项目里现有的）
    Ask,
}

/// 根据「落地时的版本」和「当前版本」决定要不要问。
///
/// 版本一样 → 直接覆盖（不用打扰用户）。
/// 版本不一样 → 问一次（用户可能故意留在旧版上）。
pub fn decide_overwrite(landed: Option<u64>, current: u64) -> Overwrite {
    match landed {
        Some(version) if version != current => Overwrite::Ask,
        _ => Overwrite::Yes,
    }
}

/// 读落地记录（没有就是没落过地）。
pub fn read_state(path: &Path) -> Option<LandedState> {
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

/// 写落地记录。
pub fn write_state(path: &Path, state: &LandedState) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let raw = serde_json::to_string_pretty(state).unwrap_or_default();
    fs::write(path, format!("{raw}\n"))
}

/// 复制一个目录的内容（覆盖已有的同名文件）。
fn copy_dir(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let target = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

/// 复制 skill 仓库里的一个 skill 到运行时的 skill 目录。
///
/// 名字用 skill 目录名 —— 跟运行时自己的发现规则一致。
/// 同名怎么办由运行时决定（它先到先得），这里不额外做避让。
pub fn land_skill(skills_dir: &Path, skill_dir: &Path) -> std::io::Result<PathBuf> {
    let name = skill_dir
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    if name.is_empty() {
        return Err(std::io::Error::other("skill 目录名无效"));
    }
    let target = skills_dir.join(&name);
    copy_dir(skill_dir, &target)?;
    Ok(target)
}

/// 生成托管块内容：身份 + 指令 + 已装 skill 清单。
pub fn build_block(agent: &CreatedAgent, skill_names: &[String]) -> String {
    let mut out = String::new();
    out.push_str("## Agent Identity\n\n");
    out.push_str(&format!("**You are: {}**\n\n", agent.name.trim()));
    let instruction = agent.instruction.trim();
    if !instruction.is_empty() {
        out.push_str(instruction);
        out.push_str("\n\n");
    }
    if !skill_names.is_empty() {
        out.push_str("## Skills\n\n");
        out.push_str("You have the following skills installed (discovered automatically):\n\n");
        for name in skill_names {
            out.push_str(&format!("- **{name}**\n"));
        }
        out.push_str("\n");
    }
    out
}

/// 把内容写进（或替换掉）指令文件的托管块。
///
/// - 文件不存在 → 只写这个块
/// - 文件存在、没有块 → 追加分隔符 + 块（用户原内容保留）
/// - 文件已有块 → 原地替换块内容（反复跑不会越写越长）
pub fn write_managed_block(path: &Path, body: &str) -> std::io::Result<()> {
    let block = format!("{BLOCK_BEGIN}\n{}\n{BLOCK_END}\n", body.trim_end());
    let existing = fs::read_to_string(path).ok();
    let content = match existing {
        None => block,
        Some(text) => match (text.find(BLOCK_BEGIN), text.find(BLOCK_END)) {
            (Some(start), Some(end)) if end > start => {
                let head = &text[..start];
                let tail = &text[end + BLOCK_END.len()..];
                format!("{head}{block}{tail}")
            }
            _ => {
                let mut out = text;
                if !out.is_empty() {
                    out.push_str(BLOCK_SEPARATOR);
                }
                out.push_str(&block);
                out
            }
        },
    };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, content)
}

/// 把托管块从文件里去掉（用户自己写的内容留着）。
///
/// 用于迁移：以前指令写在项目根目录，现在改写到运行时自己的位置，
/// 旧位置那份不能留 —— 否则指令会同时被读到两次
/// （原生发现 + 扩展注入）。
///
/// 文件不存在、或者里面没有托管块 → 什么都不做。
pub fn remove_managed_block(path: &Path) -> std::io::Result<bool> {
    let Some(text) = fs::read_to_string(path).ok() else {
        return Ok(false);
    };
    let (Some(start), Some(end)) = (text.find(BLOCK_BEGIN), text.find(BLOCK_END)) else {
        return Ok(false);
    };
    if end < start {
        return Ok(false);
    }
    let mut out = String::with_capacity(text.len());
    out.push_str(&text[..start]);
    out.push_str(&text[end + BLOCK_END.len()..]);
    let out = out.trim_end().to_string();
    let out = if out.is_empty() {
        String::new()
    } else {
        format!("{out}\n")
    };
    fs::write(path, out)?;
    Ok(true)
}

/// 写运行时扩展到项目里。
pub fn write_extension(path: &Path, source: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, source)
}

/// 合并 MCP 配置：**每个绑定的上游写一条**，别的一个都不动。
///
/// 写进来的条目标记在 `mcpServers.<名字>.x-agentspace` 下（值为 `true`），
/// 方便下次清理：不再绑定的条目能被认出来并删掉，别人的条目不动。
pub fn merge_mcp_config(
    path: &Path,
    entries: &[(String, serde_json::Value)],
    remove: &[String],
) -> std::io::Result<()> {
    let mut doc: serde_json::Value = fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    if !doc.is_object() {
        doc = serde_json::json!({});
    }
    let root = doc.as_object_mut().expect("刚保证是对象");
    let servers = root
        .entry("mcpServers")
        .or_insert_with(|| serde_json::json!({}));
    if !servers.is_object() {
        *servers = serde_json::json!({});
    }
    let map = servers.as_object_mut().expect("刚保证是对象");

    // 清理旧格式：之前把多个上游合成一条 `agentspace`（URL 里用 `+` 连）。
    // 认准两个特征：名字是 agentspace，且指向我们的代理（带 Bearer 令牌）。
    // 只删这样的，别处自己写的同名条目不动。
    let legacy = map.get("agentspace").is_some_and(|entry| {
        entry
            .get("headers")
            .and_then(|headers| headers.get("Authorization"))
            .and_then(|value| value.as_str())
            .map(|value| value.starts_with("Bearer "))
            .unwrap_or(false)
    });
    if legacy {
        map.remove("agentspace");
    }

    // 清理：上次写进来的、这次不再绑的
    //
    // 名单来自落地记录（`mcp_entries`）—— 那就是「上次确实是我们写的」。
    // 不在 mcp.json 里加自定义标记字段：运行时的 MCP 适配器不认得未知字段，
    // 会报 "Ignored settings" 警告。
    for name in remove {
        map.remove(name);
    }

    // 写入：每个上游一条
    for (name, entry) in entries {
        map.insert(name.clone(), entry.clone());
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let raw = serde_json::to_string_pretty(&doc).unwrap_or_default();
    fs::write(path, format!("{raw}\n"))
}

/// 把智能体的能力落到启动目录。
///
/// 落在哪儿由 `runtime` 决定 —— 这个函数只管流程。
/// 返回落地记录（写哪些文件、写了哪些 MCP 条目）。
pub fn land(
    runtime: &dyn Runtime,
    agent: &CreatedAgent,
    cwd: &Path,
    paths: &Paths,
) -> LandedState {
    let state_path = runtime.state_file(cwd);
    let previous = read_state(&state_path);
    let landed_version = previous.as_ref().map(|item| item.version);

    // 版本对不上 → 问一次要不要覆盖
    let overwrite = match decide_overwrite(landed_version, agent.version) {
        Overwrite::Yes => true,
        Overwrite::Ask => {
            println!(
                "项目里的配置是 v{}，智能体「{}」现在是 v{}。",
                landed_version.unwrap_or(0),
                agent.name.trim(),
                agent.version
            );
            ask_yes_no("是否用新版本覆盖项目里的配置？")
        }
    };

    if !overwrite {
        // 版本一致 —— 但落地物可能被人手动删了（.pi/extensions/、.pi/skills/…）。
        // 这种得补上，不然用户看到的“配置已就绪”，实际扩展没了。
        let intact = previous
            .as_ref()
            .map(|item| item.files.iter().all(|file| cwd.join(file).exists()))
            .unwrap_or(false);
        if intact {
            println!("保持项目里现有的配置，继续启动。");
            return previous.unwrap_or_default();
        }
        println!("项目里缺了些配置，补齐一下。");
    }

    let mut skill_names: Vec<String> = Vec::new();
    let mut files: Vec<String> = Vec::new();

    // ── skill ──────────────────────────────────────────────
    let skills_dir = runtime.skills_dir(cwd);
    for dir in agentspace_core::agent::skill_dirs(paths, agent) {
        let Some(name) = dir.file_name().map(|n| n.to_string_lossy().to_string()) else {
            continue;
        };
        if !dir.join("SKILL.md").is_file() {
            eprintln!("跳过：找不到 skill 的 SKILL.md（{}）", dir.display());
            continue;
        }
        match land_skill(&skills_dir, &dir) {
            Ok(target) => {
                skill_names.push(name);
                files.push(relative_to(cwd, &target));
            }
            Err(error) => eprintln!("复制 skill 失败（{}）：{error}", dir.display()),
        }
    }

    // ── 指令 ──────────────────────────────────────────────
    let block = build_block(agent, &skill_names);
    let instructions = runtime.instructions_file(cwd);
    match write_managed_block(&instructions, &block) {
        Ok(()) => files.push(relative_to(cwd, &instructions)),
        Err(error) => eprintln!("写指令文件失败（{}）：{error}", instructions.display()),
    }

    // ── 扩展 ──────────────────────────────────────────────
    if let Some(asset) = runtime.extension() {
        let path = extension_path(runtime, cwd, asset.relative_path);
        match write_extension(&path, asset.source) {
            Ok(()) => files.push(relative_to(cwd, &path)),
            Err(error) => eprintln!("写扩展失败（{}）：{error}", path.display()),
        }
    }

    // ── 绑定的 Pi 扩展 ────────────────────────────────────
    //
    // 复制到项目的 `.pi/extensions/` —— pi 会自动发现这个目录。
    //
    // 整个扩展目录一起复制（包括它自己的 node_modules）：
    // - 扩展之间的相对 import 才不断
    // - 依赖跟着走 —— 扩展里 `import yaml from 'yaml'` 靠 node 的模块解析
    //   （从扩展文件往上找 node_modules）。不带上就会报
    //   "Cannot find module 'yaml'"。
    let ext_dirs = agentspace_core::agent::extension_dirs(paths, agent);
    if !ext_dirs.is_empty() {
        let target_root = cwd.join(".pi").join("extensions");
        for dir in &ext_dirs {
            let Some(name) = dir.file_name().map(|n| n.to_string_lossy().to_string()) else {
                continue;
            };
            let target = target_root.join(&name);
            // 先清掉旧的
            let _ = std::fs::remove_dir_all(&target);
            match agentspace_core::extensions::copy_dir(dir, &target) {
                Ok(()) => files.push(relative_to(cwd, &target)),
                Err(error) => eprintln!("复制扩展失败（{name}）：{error}"),
            }
        }
    }

    // ── MCP ───────────────────────────────────────────────
    let mut mcp_entries: Vec<String> = Vec::new();
    let server_ids = agentspace_core::agent::mcp_server_ids(agent);
    if !server_ids.is_empty() {
        if let Some(config) = runtime.mcp_config_file(cwd) {
            match mcp::ensure_running() {
                Ok(endpoint) => {
                    // 上游是惰性连接的：不主动连，agent 拿到的工具清单是空的
                    let (connected, failures) = mcp::probe_servers(&endpoint, &server_ids);
                    if connected > 0 {
                        println!("MCP 已连接 {connected} 个上游。");
                    }
                    for failure in failures {
                        eprintln!("提示：MCP {failure} —— 这个上游这次可能用不了。");
                    }
                    // 每个上游一条配置，不合成一条 ——
                    // 这样在运行时的 MCP 列表里能一眼看到绑了哪几个。
                    let entries: Vec<(String, serde_json::Value)> = server_ids
                        .iter()
                        .map(|id| {
                            (
                                runtime.mcp_entry_name(id),
                                runtime.mcp_entry(id, &endpoint.base(), &endpoint.token),
                            )
                        })
                        .collect();
                    // 上次写的、这次不绑的 → 删掉（只删带我们标记的）
                    let stale = previous
                        .as_ref()
                        .map(|item| item.mcp_entries.clone())
                        .unwrap_or_default();
                    let remove: Vec<String> = stale
                        .into_iter()
                        .filter(|name| {
                            !server_ids
                                .iter()
                                .any(|id| runtime.mcp_entry_name(id) == *name)
                        })
                        .collect();
                    match merge_mcp_config(&config, &entries, &remove) {
                        Ok(()) => {
                            files.push(relative_to(cwd, &config));
                            mcp_entries = entries.iter().map(|(name, _)| name.clone()).collect();
                        }
                        Err(error) => {
                            eprintln!("写 MCP 配置失败（{}）：{error}", config.display())
                        }
                    }
                    // 曝光提醒：绑了但没暴露 → agent 那边一个工具都看不到
                    let exposed = mcp::exposed_server_ids();
                    let missing: Vec<&String> = server_ids
                        .iter()
                        .filter(|id| !exposed.contains(id))
                        .collect();
                    if !missing.is_empty() && !exposed.is_empty() {
                        eprintln!(
                            "提示：绑定的 MCP {} 没在 MCP 页的「配置暴露」里勾上，agent 看不到它们的工具。",
                            missing
                                .iter()
                                .map(|id| id.as_str())
                                .collect::<Vec<_>>()
                                .join("、")
                        );
                    }
                }
                Err(error) => {
                    eprintln!("MCP 代理没起来（{error}）—— 这次不带 MCP 能力启动。");
                }
            }
        }
    }

    // 清理旧布局（由运行时自己决定要不要清、清理什么）
    runtime.migrate_legacy(cwd);

    let state = LandedState {
        agent_id: agent.id.clone(),
        agent_name: agent.name.trim().to_string(),
        version: agent.version,
        runtime: runtime.id().to_string(),
        files,
        mcp_entries,
    };
    if let Err(error) = write_state(&state_path, &state) {
        eprintln!("写落地记录失败：{error}");
    }

    println!(
        "已按智能体「{}」v{} 准备：{}",
        agent.name.trim(),
        agent.version,
        if state.files.is_empty() {
            "（没有可落地的内容）".to_string()
        } else {
            state.files.join("、")
        }
    );
    state
}

/// 扩展文件在项目里的完整路径。
fn extension_path(runtime: &dyn Runtime, cwd: &Path, relative: &str) -> PathBuf {
    runtime.config_dir(cwd).join(relative)
}

/// 路径相对启动目录（用于展示）。
fn relative_to(cwd: &Path, path: &Path) -> String {
    path.strip_prefix(cwd)
        .map(|rest| rest.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| path.to_string_lossy().to_string())
}

/// 问一句是/否。
///
/// 不是交互终端（管道、CI）时直接当「否」—— 不擅自改用户目录。
pub fn ask_yes_no(question: &str) -> bool {
    print!("{question} [y/N] ");
    let _ = std::io::stdout().flush();
    let mut answer = String::new();
    if std::io::stdin().lock().read_line(&mut answer).is_err() {
        return false;
    }
    let answer = answer.trim().to_lowercase();
    answer == "y" || answer == "yes"
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::PiRuntime;

    #[test]
    fn managed_block_new_file_writes_only_block() {
        let dir = std::env::temp_dir().join("agentspace-cli-block-new");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("AGENTS.md");

        write_managed_block(&path, "hello").unwrap();

        let text = fs::read_to_string(&path).unwrap();
        assert!(text.contains("hello"));
        assert!(text.starts_with(BLOCK_BEGIN));
        assert!(text.trim_end().ends_with(BLOCK_END));
    }

    #[test]
    fn managed_block_keeps_user_content_and_replaces_in_place() {
        let dir = std::env::temp_dir().join("agentspace-cli-block-existing");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("AGENTS.md");
        fs::write(&path, "# 我的项目说明\n\n不要动我。\n").unwrap();

        write_managed_block(&path, "第一版").unwrap();
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.contains("不要动我。"));
        assert!(text.contains("第一版"));

        // 再写一次：用户内容还在，块被替换，不增长
        write_managed_block(&path, "第二版").unwrap();
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.contains("不要动我。"));
        assert!(text.contains("第二版"));
        assert!(!text.contains("第一版"));
        assert_eq!(text.matches(BLOCK_BEGIN).count(), 1);
    }

    #[test]
    fn remove_managed_block_keeps_user_content() {
        let dir = std::env::temp_dir().join("agentspace-cli-remove-block");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("AGENTS.md");

        fs::write(&path, "# 我的项目说明\n\n不要动我。\n").unwrap();
        write_managed_block(&path, "第一版").unwrap();

        assert!(remove_managed_block(&path).unwrap());
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.contains("不要动我。"));
        assert!(!text.contains("第一版"));
        assert!(!text.contains(BLOCK_BEGIN));
    }

    #[test]
    fn remove_managed_block_is_noop_without_block() {
        let dir = std::env::temp_dir().join("agentspace-cli-remove-block-noop");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("AGENTS.md");
        fs::write(&path, "# 只有我自己的内容\n").unwrap();

        assert!(!remove_managed_block(&path).unwrap());
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "# 只有我自己的内容\n"
        );

        // 文件不存在也不报错
        let missing = dir.join("AGENTS-missing.md");
        assert!(!remove_managed_block(&missing).unwrap());
    }

    #[test]
    fn write_extension_creates_file_with_source() {
        let dir = std::env::temp_dir().join("agentspace-cli-extension");
        let _ = fs::remove_dir_all(&dir);
        let path = dir.join("extensions").join("agentspace.ts");

        write_extension(&path, "export default function () {}").unwrap();

        let text = fs::read_to_string(&path).unwrap();
        assert_eq!(text, "export default function () {}");
    }

    #[test]
    fn extension_path_sits_next_to_instructions() {
        let runtime = PiRuntime::new();
        let cwd = Path::new("/tmp/project");
        let path = extension_path(&runtime, cwd, "extensions/agentspace.ts");
        assert_eq!(path, Path::new("/tmp/project/.pi/extensions/agentspace.ts"));
    }

    #[test]
    fn mcp_config_writes_one_entry_per_server() {
        let dir = std::env::temp_dir().join("agentspace-cli-mcp");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("mcp.json");
        fs::write(
            &path,
            r#"{"mcpServers":{"别人的":{"type":"http","url":"http://x"}}}"#,
        )
        .unwrap();

        let runtime = PiRuntime::new();
        let entries = vec![(
            "filesystem".to_string(),
            runtime.mcp_entry("filesystem", "http://127.0.0.1:7801", "AgentSpace"),
        )];

        merge_mcp_config(&path, &entries, &[]).unwrap();

        let raw = fs::read_to_string(&path).unwrap();
        let doc: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let servers = doc["mcpServers"].as_object().unwrap();
        assert_eq!(servers.len(), 2);
        assert!(servers.contains_key("filesystem"));
        assert!(servers.contains_key("别人的"));
        // 不写运行时不认得的字段 —— 否则会报 "Ignored settings" 警告
        let known = ["type", "url", "headers", "command", "args", "env", "cwd", "oauth", "exposure", "enabled", "timeout", "description"];
        for (name, entry) in servers {
            for key in entry.as_object().unwrap().keys() {
                assert!(known.contains(&key.as_str()), "{name} 里有运行时不认得的字段：{key}");
            }
        }
    }

    #[test]
    fn mcp_config_removes_only_our_stale_entries() {
        let dir = std::env::temp_dir().join("agentspace-cli-mcp-stale");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("mcp.json");

        merge_mcp_config(
            &path,
            &[("a".to_string(), serde_json::json!({"type": "http"}))],
            &[],
        )
        .unwrap();
        merge_mcp_config(
            &path,
            &[("b".to_string(), serde_json::json!({"type": "http"}))],
            &["a".to_string()],
        )
        .unwrap();

        let raw = fs::read_to_string(&path).unwrap();
        let doc: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let servers = doc["mcpServers"].as_object().unwrap();
        assert!(!servers.contains_key("a"));
        assert!(servers.contains_key("b"));
    }

    #[test]
    fn mcp_config_replaces_legacy_aggregated_entry() {
        let dir = std::env::temp_dir().join("agentspace-cli-mcp-legacy");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("mcp.json");
        fs::write(
            &path,
            r#"{"mcpServers":{"agentspace":{"type":"http","url":"http://x/mcp/s/a+b","headers":{"Authorization":"Bearer t"}}}}"#,
        )
        .unwrap();

        merge_mcp_config(
            &path,
            &[("a".to_string(), serde_json::json!({"type": "http"}))],
            &[],
        )
        .unwrap();

        let raw = fs::read_to_string(&path).unwrap();
        let doc: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let servers = doc["mcpServers"].as_object().unwrap();
        assert!(!servers.contains_key("agentspace"));
        assert!(servers.contains_key("a"));
    }

    #[test]
    fn mcp_config_keeps_foreign_agentspace_entry() {
        let dir = std::env::temp_dir().join("agentspace-cli-mcp-foreign");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("mcp.json");
        // 名字一样，但没有 Bearer 头 —— 是别人自己写的，不能删
        fs::write(
            &path,
            r#"{"mcpServers":{"agentspace":{"type":"http","url":"http://x"}}}"#,
        )
        .unwrap();

        merge_mcp_config(
            &path,
            &[("a".to_string(), serde_json::json!({"type": "http"}))],
            &[],
        )
        .unwrap();

        let raw = fs::read_to_string(&path).unwrap();
        let doc: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert!(doc["mcpServers"].as_object().unwrap().contains_key("agentspace"));
    }

    #[test]
    fn land_skill_copies_into_given_dir() {
        let dir = std::env::temp_dir().join("agentspace-cli-skill");
        let _ = fs::remove_dir_all(&dir);
        let src = dir.join("src").join("kb");
        fs::create_dir_all(&src).unwrap();
        fs::write(src.join("SKILL.md"), "# kb").unwrap();
        let target_root = dir.join("out").join("skills");

        let target = land_skill(&target_root, &src).unwrap();

        assert_eq!(target, target_root.join("kb"));
        assert!(target.join("SKILL.md").is_file());
    }

    #[test]
    fn pi_runtime_has_extension_to_land() {
        let runtime = PiRuntime::new();
        let asset = runtime.extension().expect("Pi 有扩展机制");
        assert_eq!(asset.relative_path, "extensions/agentspace.ts");
    }
}
