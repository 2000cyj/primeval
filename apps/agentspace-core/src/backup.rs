//! 数据管理：把本机的配置导成一个包，或从包里导回来。
//!
//! # 为什么要分「远程」和「本地」
//!
//! 导出的每条数据有两种可能：
//!
//! - **远程来源** —— skill 来自某个 git 仓库、扩展是 npm 装的、MCP server 来自
//!   官方 registry。这类数据在别的机器上**能自己长出来**：记下下载链接就行，
//!   导入方去重新拉一遍。塞一份文件副本反而更糟 —— 副本不会跟着上游更新。
//! - **本地手写** —— 用户自己写的 skill、自己填的 MCP server、自己写的扩展。
//!   这类数据**没有下载链接**，不打包就没了。
//!
//! 所以导出包里前者只留链接，后者留原文件。导入时按同样的规则反向处理。
//!
//! # 导出包的形状
//!
//! 一个 zip：
//!
//! ```text
//! AgentSpace-export-20261114-163000.zip
//!   manifest.json              清单：每条数据是什么、从哪来、文件在哪
//!   skills/<目录名>/...        本地 skill 的原文件
//!   mcp/servers.json           手动配置的 MCP server 定义
//!   extensions/<目录名>/...    自定义扩展的原文件
//!   agents/<id>/agent.json     智能体定义
//!   agents/<id>/AGENTS.md      智能体说明
//! ```
//!
//! `manifest.json` 是唯一的真相源 —— 文件本身没有元信息，全靠清单指路。
//!
//! # 冲突怎么办
//!
//! 导入时同名就是冲突。**默认不覆盖**（跳过），只有用户在弹窗里明确勾了
//! 「覆盖」才替换 —— 导入必须是增量动作，不能把本机已有的东西悄悄冲掉。

use std::collections::BTreeMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::paths::Paths;

/// 清单文件名（zip 根目录）。
pub const MANIFEST_NAME: &str = "manifest.json";

/// 清单格式版本。
///
/// 以后清单结构变了就 +1 —— 导入时版本不认识就报错，别硬解。
pub const MANIFEST_VERSION: u32 = 1;

/// 单个导出包的大小上限（256MB）。
///
/// 防止误选了一个巨大的目录把内存吃光 —— 打包全程在内存里做。
pub const MAX_EXPORT_BYTES: u64 = 256 * 1024 * 1024;

/// 数据类别。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DataKind {
    /// 智能体。
    Agent,
    /// Skill。
    Skill,
    /// MCP server。
    McpServer,
    /// Pi 扩展。
    Extension,
}

impl DataKind {
    /// 清单里的标签（给人看 + 做冲突 key）。
    pub fn label(self) -> &'static str {
        match self {
            DataKind::Agent => "agent",
            DataKind::Skill => "skill",
            DataKind::McpServer => "mcpServer",
            DataKind::Extension => "extension",
        }
    }
}

/// 一条数据的来源方式。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SourceKind {
    /// 远程 —— 只记下载链接。
    Remote,
    /// 本地 —— 打包原文件。
    Local,
}

/// 智能体条目。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestAgent {
    pub id: String,
    pub name: String,
    pub description: String,
    /// 引用的 skill 相对路径（`skills/<目录名>`）。
    pub skills: Vec<String>,
    /// 引用的 MCP server id。
    pub mcp_servers: Vec<String>,
    /// 引用的扩展相对路径。
    pub extensions: Vec<String>,
    /// 包里的文件（zip 内路径）。
    pub files: Vec<String>,
}

/// Skill 条目。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestSkill {
    /// skill 目录名（唯一键）。
    pub name: String,
    pub description: String,
    pub kind: SourceKind,
    /// 远程来源的地址（git 仓库 / URL）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    /// 远程来源的 ref。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_ref: Option<String>,
    /// 本地来源：包里的文件。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub files: Vec<String>,
}

/// MCP server 条目。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestMcpServer {
    pub id: String,
    pub name: String,
    pub kind: SourceKind,
    /// 远程来源：registry 条目名。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub registry_name: Option<String>,
    /// 本地来源：定义 JSON 所在的包内文件。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
}

/// 扩展条目。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestExtension {
    /// 扩展名（唯一键）。
    pub name: String,
    pub kind: SourceKind,
    /// npm 包名（远程来源）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package: Option<String>,
    /// 本地来源：包里的文件。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub files: Vec<String>,
}

/// 导出包的清单。
///
/// 除了 `version` 以外都给了默认值 —— 清单往后加字段时，老包还能读。
/// （版本不对会直接报错，不能「尽力而为」地解 —— 宁可让用户重新导一次。）
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Manifest {
    pub version: u32,
    pub app: String,
    pub exported_at: String,
    pub agents: Vec<ManifestAgent>,
    pub skills: Vec<ManifestSkill>,
    pub mcp_servers: Vec<ManifestMcpServer>,
    pub extensions: Vec<ManifestExtension>,
}

impl Default for Manifest {
    fn default() -> Self {
        Self {
            version: MANIFEST_VERSION,
            app: "AgentSpace".to_string(),
            exported_at: String::new(),
            agents: Vec::new(),
            skills: Vec::new(),
            mcp_servers: Vec::new(),
            extensions: Vec::new(),
        }
    }
}

/// 导出选择（界面勾了什么）。
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSelection {
    #[serde(default)]
    pub agent_ids: Vec<String>,
    #[serde(default)]
    pub skill_names: Vec<String>,
    #[serde(default)]
    pub mcp_server_ids: Vec<String>,
    #[serde(default)]
    pub extension_names: Vec<String>,
}

/// 导出结果。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    /// 写出来的 zip 路径。
    pub zip_path: String,
    pub file_name: String,
    /// 各类型导出了多少条。
    pub counts: ExportCounts,
}

/// 各类型导出条数。
#[derive(Clone, Copy, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportCounts {
    pub agents: usize,
    pub skills: usize,
    pub mcp_servers: usize,
    pub extensions: usize,
}

/// 导入请求（界面勾了哪些冲突要覆盖）。
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRequest {
    /// 导入包的路径。
    pub zip_path: String,
    /// 勾了「覆盖」的冲突项，格式 `kind:key`（如 `skill:vue`）。
    #[serde(default)]
    pub overwrite_keys: Vec<String>,
}

/// 导入结果。
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    /// 成功导入的条数。
    pub imported: ExportCounts,
    /// 因为冲突被跳过的条数。
    pub skipped: ExportCounts,
    /// 失败的条目（每条一句人话）。
    pub failures: Vec<String>,
    /// 导入后的提醒（如智能体引用了没导进来的 skill）。
    pub warnings: Vec<String>,
}

// ─────────────────────────────────────────────────────────
// 清单生成
// ─────────────────────────────────────────────────────────

/// 可导出的一个 skill（界面上列出来的东西）。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillExportItem {
    pub name: String,
    pub description: String,
    /// remote = 有下载链接；local = 要打包原文件。
    pub kind: SourceKind,
    /// 来源的可读描述（给人看）。
    pub source_label: String,
}

/// 可导出的一个 MCP server。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpExportItem {
    pub id: String,
    pub name: String,
    pub kind: SourceKind,
    pub source_label: String,
}

/// 可导出的一个扩展。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionExportItem {
    pub name: String,
    /// npm / custom / builtin。
    pub source: String,
    pub kind: SourceKind,
    pub source_label: String,
}

/// 可导出的一个智能体。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentExportItem {
    pub id: String,
    pub name: String,
    pub description: String,
    pub skills: Vec<String>,
    pub mcp_servers: Vec<String>,
    pub extensions: Vec<String>,
}

/// 全部可导出的数据（界面勾选列表的数据源）。
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inventory {
    pub agents: Vec<AgentExportItem>,
    pub skills: Vec<SkillExportItem>,
    pub mcp_servers: Vec<McpExportItem>,
    pub extensions: Vec<ExtensionExportItem>,
}

/// 列出所有可导出的数据。
///
/// 界面上要先给用户看「有什么可导」，所以这个函数只读不写。
pub fn inventory(paths: &Paths, mcp_servers: &[serde_json::Value]) -> Inventory {
    let mut out = Inventory::default();

    for agent in crate::agent::list(paths) {
        out.agents.push(AgentExportItem {
            id: agent.id,
            name: agent.name,
            description: agent.description,
            skills: agent.skills,
            mcp_servers: agent.mcp_servers,
            extensions: agent.extensions,
        });
    }

    for skill in crate::skills::skills_list(paths).unwrap_or_default() {
        let dir = paths.skills_root().join(&skill.name);
        let origin = crate::skills::read_origin_public(&dir);
        let (kind, source_label) = match origin {
            Some(origin) => {
                let kind = origin.get("type").and_then(|v| v.as_str()).unwrap_or("");
                let url = origin
                    .get("source_url")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .trim()
                    .to_string();
                let reference = origin
                    .get("source_ref")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .trim()
                    .to_string();
                match kind {
                    // git / url —— 有下载链接，导出链接就够
                    "git" | "url" => (
                        SourceKind::Remote,
                        if reference.is_empty() {
                            url.clone()
                        } else {
                            format!("{url}@{reference}")
                        },
                    ),
                    // manual / local / runtime —— 只有本机这一份，必须打包
                    _ => (SourceKind::Local, String::new()),
                }
            }
            // 没有 sidecar = 老数据 / 手动放的 —— 当本地处理
            None => (SourceKind::Local, String::new()),
        };
        out.skills.push(SkillExportItem {
            name: skill.name,
            description: skill.description,
            kind,
            source_label,
        });
    }

    for server in mcp_servers {
        let id = server
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if id.is_empty() {
            continue;
        }
        let name = server
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or(&id)
            .to_string();
        // registry 装的记了来源名；没记的就是手动填的
        let registry_name = server
            .get("registryName")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let (kind, source_label) = match registry_name {
            Some(name) => (SourceKind::Remote, name),
            None => (SourceKind::Local, String::new()),
        };
        out.mcp_servers.push(McpExportItem {
            id,
            name,
            kind,
            source_label,
        });
    }

    for extension in list_export_extensions(paths) {
        out.extensions.push(extension);
    }

    out
}

/// 列出工具箱里的扩展（按**目录**列，不按扩展文件列）。
///
/// 为什么不用 `list_installed`：它列的是「扩展文件」—— 一个 npm 包里声明了
/// 三个扩展文件就会出三条，而那三条的 `name` 都是包名（`scan_package` 传的），
/// 界面上看就是同一个东西出现三遍。
///
/// 导出是以**目录**为单位的（整个包一起搬），所以这里也按目录列。
/// npm 目录名是扁平的（`@dietrichgebert-ponytail`），包名要从 package.json 读回来。
fn list_export_extensions(paths: &Paths) -> Vec<ExtensionExportItem> {
    let library = crate::extensions::library_dir(paths);
    let mut out = Vec::new();
    for (sub, source) in [("npm", "npm"), ("custom", "custom")] {
        let root = library.join(sub);
        let Ok(entries) = fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let dir_name = entry.file_name().to_string_lossy().to_string();
            // npm 的目录名是扁化的，显示要用原包名
            let label = if sub == "npm" {
                crate::extensions::read_package_name(&path).unwrap_or_else(|| dir_name.clone())
            } else {
                dir_name.clone()
            };
            out.push(ExtensionExportItem {
                name: dir_name,
                source: source.to_string(),
                kind: if sub == "npm" {
                    SourceKind::Remote
                } else {
                    SourceKind::Local
                },
                source_label: if sub == "npm" {
                    label
                } else {
                    String::new()
                },
            });
        }
    }
    out
}

// ─────────────────────────────────────────────────────────
// 导出
// ─────────────────────────────────────────────────────────

/// 一个待写入 zip 的条目。
struct ZipItem {
    name: String,
    data: Vec<u8>,
}

/// 把选中的数据导出成 zip，写到 `zip_path`。
///
/// `mcp_servers` 是当前 MCP server 的定义列表（从 sidecar 拿的），
/// 里面可能有 `registryName` —— 有就是 registry 装的，导出记名；没有就导出定义。
pub fn export(
    paths: &Paths,
    mcp_servers: &[serde_json::Value],
    selection: &ExportSelection,
    zip_path: &Path,
) -> Result<ExportResult, String> {
    let mut items: Vec<ZipItem> = Vec::new();
    let mut manifest = Manifest {
        version: MANIFEST_VERSION,
        app: "AgentSpace".to_string(),
        exported_at: now_iso8601(),
        agents: Vec::new(),
        skills: Vec::new(),
        mcp_servers: Vec::new(),
        extensions: Vec::new(),
    };

    // ── Skills ────────────────────────────────────────────
    let skills_root = paths.skills_root();
    for name in &selection.skill_names {
        let dir_name = crate::skills::sanitize_skill_name_public(name);
        let dir = skills_root.join(&dir_name);
        if !dir.is_dir() {
            continue;
        }
        let origin = crate::skills::read_origin_public(&dir);
        let origin_type = origin
            .as_ref()
            .and_then(|o| o.get("type"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        if origin_type == "git" || origin_type == "url" {
            // 远程 —— 只记链接
            let source_url = origin
                .as_ref()
                .and_then(|o| o.get("source_url"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let source_ref = origin
                .as_ref()
                .and_then(|o| o.get("source_ref"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            manifest.skills.push(ManifestSkill {
                name: dir_name.clone(),
                description: read_skill_description(&dir),
                kind: SourceKind::Remote,
                source_url,
                source_ref,
                files: Vec::new(),
            });
            continue;
        }

        // 本地 —— 打包整个目录
        let files = crate::skills::collect_skill_files_public(&dir)?;
        let mut packed = Vec::new();
        for file in files {
            // sidecar 不打包 —— 它记的是本机的来源信息，导入方会自己写一份
            if file.rel == crate::skills::SOURCE_FILE_PUBLIC {
                continue;
            }
            let zip_name = format!("skills/{dir_name}/{}", file.rel);
            items.push(ZipItem {
                name: zip_name.clone(),
                data: file.data,
            });
            packed.push(zip_name);
        }
        manifest.skills.push(ManifestSkill {
            name: dir_name.clone(),
            description: read_skill_description(&dir),
            kind: SourceKind::Local,
            source_url: None,
            source_ref: None,
            files: packed,
        });
    }

    // ── MCP server ────────────────────────────────────────
    // 手动配置的定义统一写进一个 servers.json（按 id 索引），
    // 清单里记它在里面的键。
    let mut manual_servers: BTreeMap<String, serde_json::Value> = BTreeMap::new();
    for server in mcp_servers {
        let id = server
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if id.is_empty() || !selection.mcp_server_ids.contains(&id) {
            continue;
        }
        let name = server
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or(&id)
            .to_string();
        let registry_name = server
            .get("registryName")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        match registry_name {
            Some(registry) => {
                manifest.mcp_servers.push(ManifestMcpServer {
                    id,
                    name,
                    kind: SourceKind::Remote,
                    registry_name: Some(registry),
                    file: None,
                });
            }
            None => {
                manual_servers.insert(id.clone(), server.clone());
                manifest.mcp_servers.push(ManifestMcpServer {
                    id,
                    name,
                    kind: SourceKind::Local,
                    registry_name: None,
                    file: Some("mcp/servers.json".to_string()),
                });
            }
        }
    }
    if !manual_servers.is_empty() {
        let payload = serde_json::json!({ "servers": manual_servers });
        let text = serde_json::to_string_pretty(&payload)
            .map_err(|e| format!("序列化 MCP 配置失败：{e}"))?;
        items.push(ZipItem {
            name: "mcp/servers.json".to_string(),
            data: text.into_bytes(),
        });
    }

    // ── Pi 扩展 ───────────────────────────────────────────
    let library = crate::extensions::library_dir(paths);
    for name in &selection.extension_names {
        // 扩展在 npm / custom 两个子目录里。
        // 目录名才是导出的单位（npm 的目录名是扁化的包名）。
        let mut found: Option<(PathBuf, bool)> = None;
        for (sub, is_npm) in [("npm", true), ("custom", false)] {
            let dir = library.join(sub).join(name);
            if dir.is_dir() {
                found = Some((dir, is_npm));
                break;
            }
        }
        let Some((dir, is_npm)) = found else {
            continue;
        };
        if is_npm {
            // npm —— 记包名，别的机器上 `npm install` 一遍就有
            let package = crate::extensions::read_package_name(&dir).unwrap_or_else(|| name.clone());
            manifest.extensions.push(ManifestExtension {
                name: name.clone(),
                kind: SourceKind::Remote,
                package: Some(package),
                files: Vec::new(),
            });
            continue;
        }
        // 自定义 —— 打包文件（不含 node_modules —— 那是 npm 管的）
        let mut packed = Vec::new();
        collect_dir_files(&dir, &format!("extensions/{name}"), &mut packed, &mut items)?;
        manifest.extensions.push(ManifestExtension {
            name: name.clone(),
            kind: SourceKind::Local,
            package: None,
            files: packed,
        });
    }

    // ── 智能体 ────────────────────────────────────────────
    for agent in crate::agent::list(paths) {
        if !selection.agent_ids.contains(&agent.id) {
            continue;
        }
        let dir = paths.agents_root().join(&agent.id);
        let mut files = Vec::new();
        for file_name in [crate::agent::META_FILE, crate::agent::INSTRUCTION_FILE] {
            let path = dir.join(file_name);
            if !path.is_file() {
                continue;
            }
            let data = fs::read(&path).map_err(|e| format!("读取智能体文件失败：{e}"))?;
            let zip_name = format!("agents/{}/{}", agent.id, file_name);
            items.push(ZipItem {
                name: zip_name.clone(),
                data,
            });
            files.push(zip_name);
        }
        manifest.agents.push(ManifestAgent {
            id: agent.id.clone(),
            name: agent.name.clone(),
            description: agent.description.clone(),
            skills: agent.skills.clone(),
            mcp_servers: agent.mcp_servers.clone(),
            extensions: agent.extensions.clone(),
            files,
        });
    }

    // ── 写清单 + 打包 ─────────────────────────────────────
    let manifest_text = serde_json::to_string_pretty(&manifest)
        .map_err(|e| format!("序列化清单失败：{e}"))?;
    items.insert(
        0,
        ZipItem {
            name: MANIFEST_NAME.to_string(),
            data: manifest_text.into_bytes(),
        },
    );

    let total: u64 = items.iter().map(|i| i.data.len() as u64).sum();
    if total > MAX_EXPORT_BYTES {
        return Err("选中的数据太大（超过 256MB），少选一些试试".to_string());
    }

    write_zip(zip_path, &items)?;

    Ok(ExportResult {
        zip_path: zip_path.to_string_lossy().to_string(),
        file_name: zip_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
        counts: ExportCounts {
            agents: manifest.agents.len(),
            skills: manifest.skills.len(),
            mcp_servers: manifest.mcp_servers.len(),
            extensions: manifest.extensions.len(),
        },
    })
}

/// 读 skill 的描述（从 SKILL.md 的 frontmatter）。
fn read_skill_description(dir: &Path) -> String {
    let raw = fs::read_to_string(dir.join("SKILL.md")).unwrap_or_default();
    let (frontmatter, _) = crate::skills::parse_frontmatter_public(&raw);
    crate::skills::fm_get_public(&frontmatter, "description")
}

/// 递归收集目录里的文件，写进 zip 条目。
///
/// 跳过 `node_modules` —— 那是 npm 装的依赖，不该跟着自定义扩展一起搬。
fn collect_dir_files(
    dir: &Path,
    zip_prefix: &str,
    packed: &mut Vec<String>,
    items: &mut Vec<ZipItem>,
) -> Result<(), String> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Ok(());
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        if file_name == "node_modules" || file_name == ".git" {
            continue;
        }
        if path.is_dir() {
            collect_dir_files(&path, &format!("{zip_prefix}/{file_name}"), packed, items)?;
            continue;
        }
        let data = fs::read(&path).map_err(|e| format!("读取文件失败：{e}"))?;
        let zip_name = format!("{zip_prefix}/{file_name}");
        items.push(ZipItem {
            name: zip_name.clone(),
            data,
        });
        packed.push(zip_name);
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────
// zip 写入
// ─────────────────────────────────────────────────────────

/// 写一个 zip 文件。
///
/// 自己拼 zip 结构：本地已经有读 zip 的实现（skills.rs），但那是只读的。
/// 用 `zip` crate 会多一个依赖 —— 这里手写反而更少依赖，且只需要 STORE 方式
/// （不压缩）。skill 的文件大多是小文本，不压缩也够小。
///
/// STORE 方式的代价：包会比压缩版大。几十个 skill 加起来也就几 MB —— 可接受。
fn write_zip(path: &Path, items: &[ZipItem]) -> Result<(), String> {
    let file =
        fs::File::create(path).map_err(|e| format!("创建导出文件失败：{e}"))?;
    let mut writer = std::io::BufWriter::new(file);

    // 中央目录：每个文件一条记录，最后统一写
    let mut central: Vec<u8> = Vec::new();
    let mut offset: u32 = 0;

    for item in items {
        let name_bytes = item.name.as_bytes();
        let crc = crc32(&item.data);

        // 本地文件头
        let mut header = Vec::with_capacity(30 + name_bytes.len());
        header.extend_from_slice(&0x0403_4b50u32.to_le_bytes()); // 本地文件头签名
        header.extend_from_slice(&20u16.to_le_bytes()); // 解压所需版本
        header.extend_from_slice(&0u16.to_le_bytes()); // 通用标志位
        header.extend_from_slice(&0u16.to_le_bytes()); // 压缩方式：STORE
        header.extend_from_slice(&0u16.to_le_bytes()); // 修改时间
        header.extend_from_slice(&0u16.to_le_bytes()); // 修改日期
        header.extend_from_slice(&crc.to_le_bytes());
        header.extend_from_slice(&(item.data.len() as u32).to_le_bytes()); // 压缩后大小
        header.extend_from_slice(&(item.data.len() as u32).to_le_bytes()); // 原始大小
        header.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
        header.extend_from_slice(&0u16.to_le_bytes()); // 额外字段长度
        header.extend_from_slice(&name_bytes);
        writer
            .write_all(&header)
            .map_err(|e| format!("写导出文件失败：{e}"))?;
        writer
            .write_all(&item.data)
            .map_err(|e| format!("写导出文件失败：{e}"))?;

        // 中央目录记录
        central.extend_from_slice(&0x0201_4b50u32.to_le_bytes()); // 中央目录签名
        central.extend_from_slice(&20u16.to_le_bytes()); // 生成版本
        central.extend_from_slice(&20u16.to_le_bytes()); // 解压所需版本
        central.extend_from_slice(&0u16.to_le_bytes()); // 通用标志位
        central.extend_from_slice(&0u16.to_le_bytes()); // 压缩方式
        central.extend_from_slice(&0u16.to_le_bytes()); // 修改时间
        central.extend_from_slice(&0u16.to_le_bytes()); // 修改日期
        central.extend_from_slice(&crc.to_le_bytes());
        central.extend_from_slice(&(item.data.len() as u32).to_le_bytes());
        central.extend_from_slice(&(item.data.len() as u32).to_le_bytes());
        central.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes()); // 额外字段长度
        central.extend_from_slice(&0u16.to_le_bytes()); // 文件注释长度
        central.extend_from_slice(&0u16.to_le_bytes()); // 磁盘号
        central.extend_from_slice(&0u16.to_le_bytes()); // 内部属性
        central.extend_from_slice(&0u32.to_le_bytes()); // 外部属性
        central.extend_from_slice(&offset.to_le_bytes()); // 本地头偏移
        central.extend_from_slice(&name_bytes);

        offset += 30 + name_bytes.len() as u32 + item.data.len() as u32;
    }

    let central_offset = offset;
    writer
        .write_all(&central)
        .map_err(|e| format!("写导出文件失败：{e}"))?;

    // 中央目录结束记录
    let mut eocd = Vec::with_capacity(22);
    eocd.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
    eocd.extend_from_slice(&0u16.to_le_bytes()); // 磁盘号
    eocd.extend_from_slice(&0u16.to_le_bytes()); // 中央目录起始磁盘
    eocd.extend_from_slice(&(items.len() as u16).to_le_bytes()); // 本盘条目数
    eocd.extend_from_slice(&(items.len() as u16).to_le_bytes()); // 总条目数
    eocd.extend_from_slice(&(central.len() as u32).to_le_bytes()); // 中央目录大小
    eocd.extend_from_slice(&central_offset.to_le_bytes()); // 中央目录偏移
    eocd.extend_from_slice(&0u16.to_le_bytes()); // 注释长度
    writer
        .write_all(&eocd)
        .map_err(|e| format!("写导出文件失败：{e}"))?;

    writer
        .flush()
        .map_err(|e| format!("写导出文件失败：{e}"))?;
    Ok(())
}

/// CRC-32（zip 校验用）。
fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for byte in data {
        crc ^= *byte as u32;
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
        }
    }
    !crc
}

// ─────────────────────────────────────────────────────────
// 导入
// ─────────────────────────────────────────────────────────

/// 一条冲突。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conflict {
    /// 类别。
    pub kind: DataKind,
    /// 冲突项的标识。
    pub key: String,
    /// 展示名。
    pub label: String,
    /// 本地已有的说明。
    pub local_hint: String,
    /// 导入包里的说明。
    pub incoming_hint: String,
}

/// 冲突清单。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictReport {
    /// 包里一共有什么。
    pub summary: ExportCounts,
    /// 冲突明细。
    pub conflicts: Vec<Conflict>,
    /// 不冲突、会直接导入的条数。
    pub fresh_count: usize,
    /// 解析时的提醒。
    pub warnings: Vec<String>,
}

/// 读一个 zip，返回（清单， 文件表）。
fn read_zip(path: &Path) -> Result<(Manifest, BTreeMap<String, Vec<u8>>), String> {
    let entries = crate::skills::read_zip_public(path)?;
    let mut files: BTreeMap<String, Vec<u8>> = BTreeMap::new();
    for entry in entries {
        files.insert(entry.name, entry.data);
    }
    let manifest_raw = files
        .get(MANIFEST_NAME)
        .ok_or_else(|| "这不是 AgentSpace 导出的包（没有 manifest.json）".to_string())?;
    let manifest: Manifest = serde_json::from_slice(manifest_raw)
        .map_err(|e| format!("解析清单失败：{e}"))?;
    if manifest.version != MANIFEST_VERSION {
        return Err(format!(
            "这个包的清单版本是 {}，本应用只认 {}",
            manifest.version, MANIFEST_VERSION
        ));
    }
    Ok((manifest, files))
}

/// 读一个导出包里所有远程 MCP server 的目录条目名。
///
/// 调用方拿它去目录里取定义 —— 导出包里只记了名字。
pub fn remote_mcp_names(zip_path: &Path) -> Vec<String> {
    let Ok((manifest, _)) = read_zip(zip_path) else {
        return Vec::new();
    };
    manifest
        .mcp_servers
        .iter()
        .filter(|item| item.kind == SourceKind::Remote)
        .filter_map(|item| item.registry_name.clone())
        .collect()
}

/// 解析导入包，比对本地，找出冲突。
pub fn inspect(
    paths: &Paths,
    mcp_servers: &[serde_json::Value],
    zip_path: &Path,
) -> Result<ConflictReport, String> {
    let (manifest, _) = read_zip(zip_path)?;
    let mut conflicts = Vec::new();
    let mut fresh = 0usize;
    let mut warnings = Vec::new();

    // Skills
    let local_skills = crate::skills::skills_list(paths).unwrap_or_default();
    for item in &manifest.skills {
        match local_skills.iter().find(|s| s.name == item.name) {
            Some(existing) => {
                conflicts.push(Conflict {
                    kind: DataKind::Skill,
                    key: item.name.clone(),
                    label: item.name.clone(),
                    local_hint: format!("已存在（{}）", existing.source),
                    incoming_hint: match item.kind {
                        SourceKind::Remote => format!("远程来源：{}", item.source_url.clone().unwrap_or_default()),
                        SourceKind::Local => "本地文件".to_string(),
                    },
                });
            }
            None => fresh += 1,
        }
    }

    // MCP server
    for item in &manifest.mcp_servers {
        let exists = mcp_servers
            .iter()
            .any(|s| s.get("id").and_then(|v| v.as_str()) == Some(item.id.as_str()));
        if exists {
            conflicts.push(Conflict {
                kind: DataKind::McpServer,
                key: item.id.clone(),
                label: item.name.clone(),
                local_hint: "已存在同名 server".to_string(),
                incoming_hint: match item.kind {
                    SourceKind::Remote => format!("registry：{}", item.registry_name.clone().unwrap_or_default()),
                    SourceKind::Local => "本地配置".to_string(),
                },
            });
        } else {
            fresh += 1;
        }
    }

    // 扩展
    let local_ext = list_export_extensions(paths);
    for item in &manifest.extensions {
        let exists = local_ext.iter().any(|e| e.name == item.name);
        if exists {
            conflicts.push(Conflict {
                kind: DataKind::Extension,
                key: item.name.clone(),
                label: item.name.clone(),
                local_hint: "已存在同名扩展".to_string(),
                incoming_hint: match item.kind {
                    SourceKind::Remote => format!("npm：{}", item.package.clone().unwrap_or_default()),
                    SourceKind::Local => "本地文件".to_string(),
                },
            });
        } else {
            fresh += 1;
        }
    }

    // 智能体
    let local_agents = crate::agent::list(paths);
    for item in &manifest.agents {
        let exists = local_agents.iter().any(|a| a.id == item.id);
        if exists {
            conflicts.push(Conflict {
                kind: DataKind::Agent,
                key: item.id.clone(),
                label: item.name.clone(),
                local_hint: "已存在同名智能体".to_string(),
                incoming_hint: format!("{} 个 skill 引用", item.skills.len()),
            });
        } else {
            fresh += 1;
        }
    }

    let summary = ExportCounts {
        agents: manifest.agents.len(),
        skills: manifest.skills.len(),
        mcp_servers: manifest.mcp_servers.len(),
        extensions: manifest.extensions.len(),
    };

    if summary.skills == 0 && summary.agents == 0 && summary.mcp_servers == 0 && summary.extensions == 0 {
        warnings.push("这个包是空的 —— 里面没有任何数据".to_string());
    }

    Ok(ConflictReport {
        summary,
        conflicts,
        fresh_count: fresh,
        warnings,
    })
}

/// 导入进度的一步。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
    /// 当前阶段（准备中 / 导入 Skills / 导入 MCP …）。
    pub phase: String,
    /// 已完成条数。
    pub current: usize,
    /// 总条数。
    pub total: usize,
    /// 这一步的说明。
    pub message: String,
}

/// 导入进度回调。
///
/// 导入可能要拉远程仓库、跑 npm install —— 几十秒起步。
/// 调用方拿它更新界面（桌面端推事件，CLI 打一行）。
pub type ProgressCallback<'a> = &'a (dyn Fn(ImportProgress) + Send + Sync);

/// 导入一个包。
///
/// `overwrite_keys` 是用户勾了「覆盖」的项，格式 `kind:key`（如 `skill:vue`）。
/// 没勾的冲突项直接跳过 —— 导入是增量动作。
///
/// `remote_mcp_defs` 是远程 MCP server 的定义（从目录取回来的），
/// key 是目录条目名 —— 导出包里只记了名字，定义得调用方现场取。
///
/// `progress` 是可选的进度回调 —— 每处理一条就调一次。
pub fn import(
    paths: &Paths,
    mcp_servers: &mut Vec<serde_json::Value>,
    zip_path: &Path,
    overwrite_keys: &[String],
    remote_mcp_defs: &[(String, serde_json::Value)],
    progress: Option<ProgressCallback<'_>>,
) -> Result<ImportResult, String> {
    let (manifest, files) = read_zip(zip_path)?;
    let mut result = ImportResult::default();

    let allowed = |kind: DataKind, key: &str| -> bool {
        overwrite_keys
            .iter()
            .any(|item| item == &format!("{}:{}", kind.label(), key))
    };

    // 总条数：四条加起来，进度条的分母
    let total = manifest.skills.len() + manifest.mcp_servers.len()
        + manifest.extensions.len() + manifest.agents.len();
    let mut done = 0usize;

    // 报一步进度。
    let report = |phase: &str, message: &str, current: usize| {
        if let Some(callback) = progress {
            callback(ImportProgress {
                phase: phase.to_string(),
                current,
                total,
                message: message.to_string(),
            });
        }
    };

    report("准备中", "正在解析导出包", 0);

    // ── Skills ────────────────────────────────────────────
    for item in &manifest.skills {
        report("导入 Skills", &item.name, done);
        let exists = paths.skills_root().join(&item.name).is_dir();
        if exists && !allowed(DataKind::Skill, &item.name) {
            result.skipped.skills += 1;
            done += 1;
            continue;
        }
        match import_skill(paths, item, &files) {
            Ok(true) => result.imported.skills += 1,
            Ok(false) => result.skipped.skills += 1,
            Err(error) => result
                .failures
                .push(format!("skill:{} —— {error}", item.name)),
        }
        done += 1;
    }

    // ── MCP server ────────────────────────────────────────
    // 手动配置的定义从包里读出来合并进 servers.json
    let mut manual: BTreeMap<String, serde_json::Value> = BTreeMap::new();
    if let Some(raw) = files.get("mcp/servers.json") {
        if let Ok(payload) = serde_json::from_slice::<serde_json::Value>(raw) {
            if let Some(map) = payload.get("servers").and_then(|v| v.as_object()) {
                for (id, def) in map {
                    manual.insert(id.clone(), def.clone());
                }
            }
        }
    }
    for item in &manifest.mcp_servers {
        report("导入 MCP server", &item.name, done);
        let exists = mcp_servers
            .iter()
            .any(|s| s.get("id").and_then(|v| v.as_str()) == Some(item.id.as_str()));
        if exists && !allowed(DataKind::McpServer, &item.id) {
            result.skipped.mcp_servers += 1;
            done += 1;
            continue;
        }
        // 远程的（registry 装的）—— 定义由调用方从目录取回来
        if item.kind == SourceKind::Remote {
            let Some(registry) = item.registry_name.as_deref() else {
                result
                    .failures
                    .push(format!("mcpServer:{} —— 包里没有来源信息", item.id));
                done += 1;
                continue;
            };
            let Some((_, def)) = remote_mcp_defs
                .iter()
                .find(|(name, _)| name == registry)
            else {
                result
                    .warnings
                    .push(format!(
                        "MCP server「{}」在目录里找不到（{}），已跳过",
                        item.name, registry
                    ));
                result.skipped.mcp_servers += 1;
                done += 1;
                continue;
            };
            // 覆盖 = 换掉旧定义
            if exists {
                mcp_servers.retain(|s| s.get("id").and_then(|v| v.as_str()) != Some(item.id.as_str()));
            }
            // 记下它来自目录 —— 下次导出还是按远程处理
            let mut def = def.clone();
            if let Some(map) = def.as_object_mut() {
                map.insert(
                    "registryName".to_string(),
                    serde_json::Value::String(registry.to_string()),
                );
            }
            mcp_servers.push(def);
            result.imported.mcp_servers += 1;
            done += 1;
            continue;
        }
        let Some(def) = manual.get(&item.id) else {
            result
                .failures
                .push(format!("mcpServer:{} —— 包里没有它的定义", item.id));
            done += 1;
            continue;
        };
        // 覆盖 = 换掉旧定义；不覆盖但已存在 = 跳过
        if exists {
            mcp_servers.retain(|s| s.get("id").and_then(|v| v.as_str()) != Some(item.id.as_str()));
        }
        mcp_servers.push(def.clone());
        result.imported.mcp_servers += 1;
        done += 1;
    }

    // ── Pi 扩展 ───────────────────────────────────────────
    for item in &manifest.extensions {
        report("导入 Pi 扩展", &item.name, done);
        let library = crate::extensions::library_dir(paths);
        let exists = library.join("npm").join(&item.name).is_dir()
            || library.join("custom").join(&item.name).is_dir();
        if exists && !allowed(DataKind::Extension, &item.name) {
            result.skipped.extensions += 1;
            done += 1;
            continue;
        }
        match import_extension(paths, item, &files) {
            Ok(true) => result.imported.extensions += 1,
            Ok(false) => result.skipped.extensions += 1,
            Err(error) => result
                .failures
                .push(format!("extension:{} —— {error}", item.name)),
        }
        done += 1;
    }

    // ── 智能体 ────────────────────────────────────────────
    for item in &manifest.agents {
        report("导入智能体", &item.name, done);
        let exists = crate::agent::list(paths).iter().any(|a| a.id == item.id);
        if exists && !allowed(DataKind::Agent, &item.id) {
            result.skipped.agents += 1;
            done += 1;
            continue;
        }
        match import_agent(paths, item, &files) {
            Ok(true) => result.imported.agents += 1,
            Ok(false) => result.skipped.agents += 1,
            Err(error) => result
                .failures
                .push(format!("agent:{} —— {error}", item.name)),
        }
        done += 1;
    }

    report("完成", "导入完成", total);

    // 智能体引用的 skill 有没有真的导进来
    let imported_skill_names: Vec<String> = manifest
        .skills
        .iter()
        .filter(|s| {
            !paths.skills_root().join(&s.name).is_dir()
                || result
                    .failures
                    .iter()
                    .any(|f| f.starts_with(&format!("skill:{} ", s.name)))
        })
        .map(|s| s.name.clone())
        .collect();
    let _ = imported_skill_names;
    for agent in &manifest.agents {
        if !agent.skills.is_empty() {
            result.warnings.push(format!(
                "智能体「{}」引用了 {} 个 skill，确认它们都在",
                agent.name,
                agent.skills.len()
            ));
        }
    }

    Ok(result)
}

/// 导入一个 skill。
///
/// 远程的重新从仓库拉；本地的把文件写回去。
fn import_skill(
    paths: &Paths,
    item: &ManifestSkill,
    files: &BTreeMap<String, Vec<u8>>,
) -> Result<bool, String> {
    match item.kind {
        SourceKind::Remote => {
            let url = item
                .source_url
                .as_deref()
                .ok_or_else(|| "清单里没有来源地址".to_string())?;
            let reference = item.source_ref.clone();
            let source = match reference {
                Some(reference) if !reference.is_empty() => format!("git:{url}@{reference}"),
                _ => format!("git:{url}"),
            };
            // 远程 skill 在仓库里的相对路径不知道 —— 只能按名字找。
            // git 源的仓库布局不统一（有的是 skills/xxx，有的是 xxx）。
            let candidates = vec![
                format!("skills/{}/SKILL.md", item.name),
                format!("{}/SKILL.md", item.name),
            ];
            crate::github::skills_import_git(paths, &source, &candidates)
                .map(|items| !items.is_empty())
                .map_err(|e| e)
        }
        SourceKind::Local => {
            let target = paths.skills_root().join(&item.name);
            if target.exists() {
                // 覆盖：先删干净，别留下上次的残留文件
                fs::remove_dir_all(&target).map_err(|e| format!("删除旧目录失败：{e}"))?;
            }
            let mut written = 0;
            for zip_name in &item.files {
                let Some(data) = files.get(zip_name) else {
                    continue;
                };
                // zip 里的路径是 skills/<name>/<相对路径>
                let Some(rel) = zip_name
                    .strip_prefix(&format!("skills/{}/", item.name))
                    .map(|r| r.to_string())
                else {
                    continue;
                };
                if rel.split('/').any(|seg| seg == ".." || seg.is_empty()) {
                    continue;
                }
                let dest = target.join(&rel);
                if let Some(parent) = dest.parent() {
                    fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
                }
                fs::write(&dest, data).map_err(|e| format!("写文件失败：{e}"))?;
                written += 1;
            }
            if written == 0 {
                return Err("包里没有它的文件".to_string());
            }
            // 写一份 sidecar —— 记着它是本地来的
            let meta = serde_json::json!({
                "enabled": true,
                "name": item.name,
                "source": "local",
                "origin": { "type": "local" },
            });
            let _ = fs::write(
                target.join(crate::skills::SOURCE_FILE_PUBLIC),
                serde_json::to_vec_pretty(&meta).unwrap_or_default(),
            );
            Ok(true)
        }
    }
}

/// 导入一个扩展。
fn import_extension(
    paths: &Paths,
    item: &ManifestExtension,
    files: &BTreeMap<String, Vec<u8>>,
) -> Result<bool, String> {
    match item.kind {
        SourceKind::Remote => {
            let package = item
                .package
                .as_deref()
                .ok_or_else(|| "清单里没有包名".to_string())?;
            crate::extensions::install_from_npm(paths, package).map(|_| true)
        }
        SourceKind::Local => {
            let target = crate::extensions::library_dir(paths)
                .join("custom")
                .join(&item.name);
            if target.exists() {
                fs::remove_dir_all(&target).map_err(|e| format!("删除旧目录失败：{e}"))?;
            }
            let mut written = 0;
            for zip_name in &item.files {
                let Some(data) = files.get(zip_name) else {
                    continue;
                };
                let Some(rel) = zip_name
                    .strip_prefix(&format!("extensions/{}/", item.name))
                    .map(|r| r.to_string())
                else {
                    continue;
                };
                if rel.split('/').any(|seg| seg == ".." || seg.is_empty()) {
                    continue;
                }
                let dest = target.join(&rel);
                if let Some(parent) = dest.parent() {
                    fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
                }
                fs::write(&dest, data).map_err(|e| format!("写文件失败：{e}"))?;
                written += 1;
            }
            if written == 0 {
                return Err("包里没有它的文件".to_string());
            }
            Ok(true)
        }
    }
}

/// 导入一个智能体。
fn import_agent(
    paths: &Paths,
    item: &ManifestAgent,
    files: &BTreeMap<String, Vec<u8>>,
) -> Result<bool, String> {
    let meta_raw = files
        .get(&format!("agents/{}/{}", item.id, crate::agent::META_FILE))
        .ok_or_else(|| "包里没有它的定义文件".to_string())?;
    let mut agent: crate::agent::CreatedAgent = serde_json::from_slice(meta_raw)
        .map_err(|e| format!("解析智能体定义失败：{e}"))?;
    agent.id = item.id.clone();
    agent.name = item.name.clone();
    // 指令正文在 AGENTS.md 里 —— 从包里读出来填回去
    if let Some(instruction) = files.get(&format!(
        "agents/{}/{}",
        item.id,
        crate::agent::INSTRUCTION_FILE
    )) {
        agent.instruction = String::from_utf8_lossy(instruction).to_string();
    }
    crate::agent::save(paths, &agent).map(|_| true)
}

/// 当前的 UTC 时间（ISO 8601）。
fn now_iso8601() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // 手动转：不引 chrono —— 只有这一个地方要用。
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let (hour, minute, second) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // 从 1970-01-01 起的天数 → 年月日
    let mut year = 1970i64;
    let mut month = 1i64;
    let mut day = 1i64;
    let mut remaining = days;
    loop {
        let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
        let year_days = if leap { 366 } else { 365 };
        if remaining < year_days {
            break;
        }
        remaining -= year_days;
        year += 1;
    }
    let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    let month_days = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    for (index, len) in month_days.iter().enumerate() {
        if remaining < *len as i64 {
            month = index as i64 + 1;
            day = remaining + 1;
            break;
        }
        remaining -= *len as i64;
    }
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

/// 读一个文件（给 zip 读取复用）。
#[allow(dead_code)]
fn read_all(path: &Path) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    fs::File::open(path)
        .map_err(|e| format!("打开文件失败：{e}"))?
        .read_to_end(&mut buf)
        .map_err(|e| format!("读取文件失败：{e}"))?;
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 建一个临时数据目录。
    fn temp_paths(tag: &str) -> Paths {
        let dir = std::env::temp_dir().join(format!(
            "agentspace-backup-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join(".agent-compose")).unwrap();
        Paths::new(dir)
    }

    #[test]
    fn zip_round_trip_keeps_content() {
        let dir = temp_paths("zip");
        let zip_path = dir.root().join("out.zip");
        let items = vec![
            ZipItem {
                name: "manifest.json".to_string(),
                data: b"{\"version\":1}".to_vec(),
            },
            ZipItem {
                name: "skills/vue/SKILL.md".to_string(),
                data: "你好，世界\n".as_bytes().to_vec(),
            },
        ];
        write_zip(&zip_path, &items).unwrap();

        // 用 core 里现成的 zip 读回来（导入走的是同一条路）
        let entries = crate::skills::read_zip_public(&zip_path).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].name, "manifest.json");
        assert_eq!(entries[1].data, "你好，世界\n".as_bytes());
        let _ = fs::remove_dir_all(dir.home());
    }

    #[test]
    fn crc32_matches_known_value() {
        // 标准 CRC-32 测试向量
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
        assert_eq!(crc32(b""), 0);
    }

    #[test]
    fn export_then_inspect_finds_conflicts() {
        let paths = temp_paths("conflict");

        // 造两个 skill：一个本地、一个远程
        let skills_root = paths.skills_root();
        let local = skills_root.join("local-skill");
        fs::create_dir_all(&local).unwrap();
        fs::write(
            local.join("SKILL.md"),
            "---\nname: local-skill\ndescription: 本地写的\n---\n\n正文\n",
        )
        .unwrap();
        fs::write(
            local.join(".agent-compose.json"),
            r#"{"enabled":true,"name":"local-skill","source":"manual","origin":{"type":"manual"}}"#,
        )
        .unwrap();

        let remote = skills_root.join("remote-skill");
        fs::create_dir_all(&remote).unwrap();
        fs::write(
            remote.join("SKILL.md"),
            "---\nname: remote-skill\ndescription: 远程来的\n---\n\n正文\n",
        )
        .unwrap();
        fs::write(
            remote.join(".agent-compose.json"),
            r#"{"enabled":true,"name":"remote-skill","source":"git","origin":{"type":"git","source_url":"github.com/o/r","source_ref":"v1"}}"#,
        )
        .unwrap();

        // inventory：远程的应该被认出来
        let inv = inventory(&paths, &[]);
        let remote_item = inv
            .skills
            .iter()
            .find(|s| s.name == "remote-skill")
            .unwrap();
        assert_eq!(remote_item.kind, SourceKind::Remote);
        assert_eq!(remote_item.source_label, "github.com/o/r@v1");
        let local_item = inv
            .skills
            .iter()
            .find(|s| s.name == "local-skill")
            .unwrap();
        assert_eq!(local_item.kind, SourceKind::Local);

        // 导出
        let zip_path = paths.root().join("export.zip");
        let selection = ExportSelection {
            skill_names: vec!["local-skill".to_string(), "remote-skill".to_string()],
            ..Default::default()
        };
        let result = export(&paths, &[], &selection, &zip_path).unwrap();
        assert_eq!(result.counts.skills, 2);
        assert!(zip_path.is_file());

        // 再导出一次（同名）→ inspect 应该报冲突
        let report = inspect(&paths, &[], &zip_path).unwrap();
        assert_eq!(report.conflicts.len(), 2, "两个 skill 都该报冲突");
        assert_eq!(report.fresh_count, 0);

        let _ = fs::remove_dir_all(paths.home());
    }

    #[test]
    fn import_creates_local_skill_from_package() {
        let paths = temp_paths("import");

        // 先造一个导出包：本地 skill 的文件
        let skills_root = paths.skills_root();
        let local = skills_root.join("packaged");
        fs::create_dir_all(&local).unwrap();
        fs::write(
            local.join("SKILL.md"),
            "---\nname: packaged\ndescription: 打包来的\n---\n\n正文\n",
        )
        .unwrap();
        fs::write(
            local.join(".agent-compose.json"),
            r#"{"enabled":true,"name":"packaged","source":"manual","origin":{"type":"manual"}}"#,
        )
        .unwrap();

        let zip_path = paths.root().join("export.zip");
        let selection = ExportSelection {
            skill_names: vec!["packaged".to_string()],
            ..Default::default()
        };
        export(&paths, &[], &selection, &zip_path).unwrap();

        // 删掉本地 —— 模拟「另一台机器」
        fs::remove_dir_all(&local).unwrap();

        // 导入
        let mut servers = Vec::new();
        let result = import(&paths, &mut servers, &zip_path, &[], &[], None).unwrap();
        assert_eq!(result.imported.skills, 1);
        assert!(result.failures.is_empty());

        // 文件真的回来了
        let restored = paths.skills_root().join("packaged");
        assert!(restored.join("SKILL.md").is_file());
        let text = fs::read_to_string(restored.join("SKILL.md")).unwrap();
        assert!(text.contains("name: packaged"));

        let _ = fs::remove_dir_all(paths.home());
    }

    #[test]
    fn import_reports_progress_for_each_item() {
        let paths = temp_paths("progress");

        // 造两个本地 skill
        for name in ["p-one", "p-two"] {
            let dir = paths.skills_root().join(name);
            fs::create_dir_all(&dir).unwrap();
            fs::write(
                dir.join("SKILL.md"),
                format!("---\nname: {name}\ndescription: 测试\n---\n\n正文\n"),
            )
            .unwrap();
            fs::write(
                dir.join(".agent-compose.json"),
                r#"{"enabled":true,"source":"manual","origin":{"type":"manual"}}"#,
            )
            .unwrap();
        }

        let zip_path = paths.root().join("export.zip");
        let selection = ExportSelection {
            skill_names: vec!["p-one".to_string(), "p-two".to_string()],
            ..Default::default()
        };
        export(&paths, &[], &selection, &zip_path).unwrap();

        // 删掉本地，模拟另一台机器
        for name in ["p-one", "p-two"] {
            fs::remove_dir_all(paths.skills_root().join(name)).unwrap();
        }

        // 收集进度
        let seen = std::sync::Mutex::new(Vec::new());
        let mut servers = Vec::new();
        {
            let seen_ref = &seen;
            let callback = |progress: ImportProgress| {
                seen_ref.lock().unwrap().push(progress);
            };
            import(&paths, &mut servers, &zip_path, &[], &[], Some(&callback)).unwrap();
        }

        let steps = seen.into_inner().unwrap();
        assert!(!steps.is_empty(), "应该有进度");
        // 第一步是「准备中」，最后一步是「完成」
        assert_eq!(steps.first().unwrap().phase, "准备中");
        assert_eq!(steps.last().unwrap().phase, "完成");
        // 每条 skill 都报了一次
        let skill_steps = steps
            .iter()
            .filter(|step| step.phase == "导入 Skills")
            .count();
        assert_eq!(skill_steps, 2);
        // current 递增
        let currents: Vec<usize> = steps.iter().map(|step| step.current).collect();
        assert!(currents.windows(2).all(|pair| pair[0] <= pair[1]), "进度不能倒退");

        let _ = fs::remove_dir_all(paths.home());
    }

    #[test]
    fn import_skips_conflict_without_overwrite_flag() {
        let paths = temp_paths("skip");

        let skills_root = paths.skills_root();
        let skill = skills_root.join("dup");
        fs::create_dir_all(&skill).unwrap();
        fs::write(
            skill.join("SKILL.md"),
            "---\nname: dup\ndescription: 本地的\n---\n\n本地正文\n",
        )
        .unwrap();
        fs::write(
            skill.join(".agent-compose.json"),
            r#"{"enabled":true,"name":"dup","source":"manual","origin":{"type":"manual"}}"#,
        )
        .unwrap();

        // 先导一份进「另一台机器」：这里直接造包
        let zip_path = paths.root().join("export.zip");
        let selection = ExportSelection {
            skill_names: vec!["dup".to_string()],
            ..Default::default()
        };
        export(&paths, &[], &selection, &zip_path).unwrap();

        // 改本地内容 —— 如果被覆盖了会变成包里的样子
        fs::write(
            skill.join("SKILL.md"),
            "---\nname: dup\ndescription: 本地的\n---\n\n本地正文\n",
        )
        .unwrap();

        let mut servers = Vec::new();
        // 不给覆盖标记 → 应该跳过
        let result = import(&paths, &mut servers, &zip_path, &[], &[], None).unwrap();
        assert_eq!(result.skipped.skills, 1);
        assert_eq!(result.imported.skills, 0);

        let text = fs::read_to_string(skill.join("SKILL.md")).unwrap();
        assert!(text.contains("本地正文"));

        // 勾了覆盖 → 应该被换掉
        let result = import(
            &paths,
            &mut servers,
            &zip_path,
            &["skill:dup".to_string()],
            &[],
            None,
        )
        .unwrap();
        assert_eq!(result.imported.skills, 1);

        let _ = fs::remove_dir_all(paths.home());
    }

    #[test]
    fn manifest_version_mismatch_is_rejected() {
        let paths = temp_paths("version");
        let zip_path = paths.root().join("bad.zip");
        let items = vec![ZipItem {
            name: MANIFEST_NAME.to_string(),
            data: br#"{"version":99,"app":"AgentSpace"}"#.to_vec(),
        }];
        write_zip(&zip_path, &items).unwrap();
        let error = read_zip(&zip_path).unwrap_err();
        assert!(error.contains("清单版本"), "实际错误：{error}");
        let _ = fs::remove_dir_all(paths.home());
    }

    #[test]
    fn package_without_manifest_is_rejected() {
        let paths = temp_paths("nomanifest");
        let zip_path = paths.root().join("bad.zip");
        let items = vec![ZipItem {
            name: "random.txt".to_string(),
            data: b"hello".to_vec(),
        }];
        write_zip(&zip_path, &items).unwrap();
        let error = read_zip(&zip_path).unwrap_err();
        assert!(error.contains("manifest.json"), "实际错误：{error}");
        let _ = fs::remove_dir_all(paths.home());
    }
}
