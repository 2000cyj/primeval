//! 已创建智能体的落盘存储。
//!
//! 每个智能体一个目录：
//!
//! ```text
//! ~/.agent-compose/agents/<id>/
//!   agent.json     元数据：名称、描述、绑定的 skill / MCP
//!   AGENTS.md      指令正文
//! ```
//!
//! 为什么这样分：
//! - **指令单独放 AGENTS.md** —— 那是 agent 运行时约定的入口文件名，
//!   指令正文又是人写的长文本，混在 JSON 里既难读也没法直接被工具链取用；
//! - **列表数据用 JSON** —— 数据量有界，和 settings.json / servers.json
//!   是同一种形态，用户想看直接用文本编辑器打开。
//!
//! 绑定的 skill / MCP 存的是**相对 `~/.agent-compose` 的路径引用**：
//!
//! - skill：`skills/<目录名>`
//! - MCP：`mcp/servers.json#<server id>`
//!
//! 存引用而不是名字 / 绝对路径，是为了**只改一处**：在 Skills 页改了 skill 的
//! 名字或描述、在 MCP 页改了 server 的名字，智能体这边不用跟着改 ——
//! 展示时按引用现查现用。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::paths::Paths;

/// 元数据文件名。
pub const META_FILE: &str = "agent.json";

/// 指令文件名（agent 运行时约定的入口名）。
pub const INSTRUCTION_FILE: &str = "AGENTS.md";

/// 默认的 agent 运行时。
///
/// 现在只支持 Pi（新建向导里别的 agent 都标着「未适配」）。
/// 写成字段而不是隐含约定，是为了让**启动脚本**（另一个进程、另一份代码）
/// 能从数据里知道自己该拉起谁 —— 两边靠猜会漂。
pub const DEFAULT_RUNTIME: &str = "pi";

/// 一个已创建的智能体。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CreatedAgent {
    /// 唯一 id（也是目录名）。
    pub id: String,
    /// 名称。
    pub name: String,
    /// 描述。
    pub description: String,
    /// 指令正文（落在同目录的 AGENTS.md 里）。
    pub instruction: String,
    /// 绑定的 skill：相对 `~/.agent-compose` 的路径。
    pub skills: Vec<String>,
    /// 绑定的 MCP server：`mcp/servers.json#<id>`。
    pub mcp_servers: Vec<String>,
    /// 跑在哪个 agent 上（`pi`）。启动脚本据此决定拉起谁。
    pub runtime: String,
    /// 配置版本：每次变更 +1（智能体改动 / 它绑的 skill 或 MCP 变了）。
    ///
    /// 启动脚本据此判断「项目里落地的那份」是不是过期了。
    pub version: u64,
    /// 创建时间（epoch 毫秒）。
    pub created_at: u64,
}

impl Default for CreatedAgent {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            description: String::new(),
            instruction: String::new(),
            skills: Vec::new(),
            mcp_servers: Vec::new(),
            runtime: DEFAULT_RUNTIME.to_string(),
            version: 0,
            created_at: 0,
        }
    }
}

/// 落盘的元数据（不含指令正文 —— 指令在 AGENTS.md 里）。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AgentMeta {
    pub id: String,
    pub name: String,
    pub description: String,
    pub skills: Vec<String>,
    pub mcp_servers: Vec<String>,
    pub runtime: String,
    pub version: u64,
    pub created_at: u64,
}

impl Default for AgentMeta {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            description: String::new(),
            skills: Vec::new(),
            mcp_servers: Vec::new(),
            runtime: DEFAULT_RUNTIME.to_string(),
            version: 0,
            created_at: 0,
        }
    }
}

/// id → 目录名。
///
/// id 会拼进文件路径，所以只放行「字母 / 数字 / 点 / 下划线 / 连字符」，
/// 其余一律拒绝 —— 不给路径穿越留口子。
pub fn safe_dir_name(id: &str) -> Option<String> {
    if id.is_empty() || id.len() > 64 {
        return None;
    }
    if id
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
    {
        Some(id.to_string())
    } else {
        None
    }
}

/// 原子写一个文件：先写同目录临时文件，再 rename 覆盖。
pub fn write_atomic(target: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
    }
    let tmp = target.with_extension(target.extension().and_then(|ext| {
        if ext.is_empty() {
            None
        } else {
            Some(format!("{}.tmp", ext.to_string_lossy()))
        }
    }).unwrap_or_else(|| "tmp".to_string()));
    std::fs::write(&tmp, content).map_err(|e| format!("写入失败：{e}"))?;
    std::fs::rename(&tmp, target).map_err(|e| format!("保存失败：{e}"))
}

/// 读一个智能体。
fn read_agent(dir: &Path) -> Option<CreatedAgent> {
    let raw = std::fs::read_to_string(dir.join(META_FILE)).ok()?;
    let meta: AgentMeta = serde_json::from_str(&raw).ok()?;
    let instruction = std::fs::read_to_string(dir.join(INSTRUCTION_FILE)).unwrap_or_default();
    Some(CreatedAgent {
        id: meta.id,
        name: meta.name,
        description: meta.description,
        instruction,
        skills: meta.skills,
        mcp_servers: meta.mcp_servers,
        runtime: meta.runtime,
        version: meta.version,
        created_at: meta.created_at,
    })
}

/// 列出 `root` 下的全部智能体（新的在前）。
pub fn list_at(root: &Path) -> Vec<CreatedAgent> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut out: Vec<CreatedAgent> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if !path.is_dir() {
                return None;
            }
            read_agent(&path)
        })
        .collect();
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    out
}

/// 把智能体写进 `root`（agent.json + AGENTS.md）。
pub fn save_at(root: &Path, agent: &CreatedAgent) -> Result<(), String> {
    let name = safe_dir_name(&agent.id).ok_or_else(|| format!("智能体 id 不合法：{}", agent.id))?;
    let dir = root.join(name);
    let meta = AgentMeta {
        id: agent.id.clone(),
        name: agent.name.clone(),
        description: agent.description.clone(),
        skills: agent.skills.clone(),
        mcp_servers: agent.mcp_servers.clone(),
        runtime: agent.runtime.clone(),
        version: agent.version,
        created_at: agent.created_at,
    };
    let raw = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
    write_atomic(&dir.join(META_FILE), &format!("{raw}\n"))?;
    // 指令正文：空的就删掉文件，别留个空壳。
    let instruction_path = dir.join(INSTRUCTION_FILE);
    if agent.instruction.trim().is_empty() {
        let _ = std::fs::remove_file(&instruction_path);
    } else {
        write_atomic(&instruction_path, &agent.instruction)?;
    }
    Ok(())
}

/// 删掉 `root` 下的一个智能体（连目录一起删）。
pub fn delete_at(root: &Path, id: &str) -> Result<(), String> {
    let name = safe_dir_name(id).ok_or_else(|| format!("智能体 id 不合法：{id}"))?;
    let dir = root.join(name);
    if !dir.exists() {
        return Ok(());
    }
    std::fs::remove_dir_all(&dir).map_err(|e| format!("删除失败：{e}"))
}

/// 列出全部智能体（新的在前）。
pub fn list(paths: &Paths) -> Vec<CreatedAgent> {
    list_at(&paths.agents_root())
}

/// 新建或更新一个智能体。
///
/// 版本号在这里统一管：**每次保存 +1**（新建从 1 开始）。
/// 智能体改了就是它自己变；它绑的 skill / MCP 变了由
/// [`bump_versions`] 负责递增 —— 两条路最后都落到同一个版本号上。
pub fn save(paths: &Paths, agent: &CreatedAgent) -> Result<CreatedAgent, String> {
    let root = paths.agents_root();
    let mut agent = agent.clone();
    match list_at(&root).into_iter().find(|item| item.id == agent.id) {
        Some(existing) => agent.version = existing.version + 1,
        None => agent.version = 1,
    }
    save_at(&root, &agent)?;
    Ok(agent)
}

/// 删掉一个智能体（连目录一起删）。
pub fn delete(paths: &Paths, id: &str) -> Result<(), String> {
    delete_at(&paths.agents_root(), id)
}

/// 按名称找智能体。
///
/// 精确匹配优先；再退到忽略大小写。同名多个时返回全部匹配（调用方负责提示）。
pub fn find_by_name(paths: &Paths, name: &str) -> Vec<CreatedAgent> {
    let target = name.trim();
    if target.is_empty() {
        return Vec::new();
    }
    let all = list(paths);
    let exact: Vec<CreatedAgent> = all
        .iter()
        .filter(|agent| agent.name.trim() == target)
        .cloned()
        .collect();
    if !exact.is_empty() {
        return exact;
    }
    let lowered = target.to_lowercase();
    all.into_iter()
        .filter(|agent| agent.name.trim().to_lowercase() == lowered)
        .collect()
}

/// 按 id 或名称找一个智能体（id 优先）。
pub fn resolve(paths: &Paths, key: &str) -> Option<CreatedAgent> {
    let key = key.trim();
    if key.is_empty() {
        return None;
    }
    list(paths)
        .into_iter()
        .find(|agent| agent.id == key)
        .or_else(|| find_by_name(paths, key).into_iter().next())
}

/// 给绑定了这些 skill / MCP 的智能体递增版本号。
///
/// skill 更新、删除、改名，MCP server 增删改 —— 都会让「绑着它的智能体」
/// 的实际能力变了，版本号必须跟着动，否则启动脚本看不出项目里那份已经过期。
pub fn bump_versions(paths: &Paths, skills: &[String], mcp_ids: &[String]) {
    if skills.is_empty() && mcp_ids.is_empty() {
        return;
    }
    let root = paths.agents_root();
    for agent in list_at(&root) {
        let skill_hit = agent
            .skills
            .iter()
            .any(|item| skills.iter().any(|wanted| wanted == item));
        let mcp_hit = agent.mcp_servers.iter().any(|item| {
            mcp_ids
                .iter()
                .any(|id| item.ends_with(&format!("#{id}")))
        });
        if !skill_hit && !mcp_hit {
            continue;
        }
        let mut updated = agent.clone();
        updated.version = agent.version + 1;
        let _ = save_at(&root, &updated);
    }
}

/// 把引用了 `from` 的智能体改成引用 `to`。
///
/// skill 改名时目录会一起搬，而智能体那边存的是相对路径引用 —— 这里把它们
/// 跟着改一下，用户就不用手动去每个智能体里重新绑一遍。
pub fn rename_skill_ref(paths: &Paths, from: &str, to: &str) {
    if from == to {
        return;
    }
    let root = paths.agents_root();
    for agent in list_at(&root) {
        if !agent.skills.iter().any(|item| item == from) {
            continue;
        }
        let mut updated = agent.clone();
        updated.skills = agent
            .skills
            .iter()
            .map(|item| if item == from { to.to_string() } else { item.clone() })
            .collect();
        // 改名 = 绑的内容变了 → 版本号跟着动
        updated.version = agent.version + 1;
        let _ = save_at(&root, &updated);
    }
}

/// 绑定的 skill 目录（绝对路径）。
///
/// 引用格式：`skills/<目录名>`。只放行单层目录名，不给路径穿越留口子。
pub fn skill_dirs(paths: &Paths, agent: &CreatedAgent) -> Vec<PathBuf> {
    let root = paths.skills_root();
    agent
        .skills
        .iter()
        .filter_map(|reference| {
            let name = reference.strip_prefix("skills/")?;
            if name.is_empty() || name.contains('/') || name.contains("..") {
                return None;
            }
            Some(root.join(name))
        })
        .collect()
}

/// 绑定的 MCP server id（从 `mcp/servers.json#<id>` 里取 id）。
pub fn mcp_server_ids(agent: &CreatedAgent) -> Vec<String> {
    agent
        .mcp_servers
        .iter()
        .filter_map(|reference| reference.rsplit('#').next().map(|id| id.to_string()))
        .filter(|id| !id.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 临时目录（测试用）。
    fn temp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("agentspace-core-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sample(id: &str) -> CreatedAgent {
        CreatedAgent {
            id: id.to_string(),
            name: "知识助手".to_string(),
            description: "回答问题".to_string(),
            instruction: "只根据知识库回答".to_string(),
            skills: vec!["skills/kb".to_string()],
            mcp_servers: vec!["mcp/servers.json#filesystem".to_string()],
            runtime: DEFAULT_RUNTIME.to_string(),
            version: 1,
            created_at: 1,
        }
    }

    #[test]
    fn save_then_read_back() {
        let root = temp_root("save");
        save_at(&root, &sample("agent-1")).unwrap();

        // 列表数据在 agent.json，指令在 AGENTS.md —— 两处不混
        let meta = std::fs::read_to_string(root.join("agent-1").join(META_FILE)).unwrap();
        assert!(meta.contains("知识助手"));
        assert!(!meta.contains("只根据知识库回答"), "指令不该落进 JSON");
        let instruction = std::fs::read_to_string(root.join("agent-1").join(INSTRUCTION_FILE)).unwrap();
        assert_eq!(instruction, "只根据知识库回答");

        let listed = list_at(&root);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].instruction, "只根据知识库回答");
        // skill / MCP 存的是相对路径引用
        assert_eq!(listed[0].skills, vec!["skills/kb".to_string()]);
        assert_eq!(listed[0].mcp_servers, vec!["mcp/servers.json#filesystem".to_string()]);
    }

    #[test]
    fn runtime落盘并能读回() {
        let root = temp_root("runtime");
        save_at(&root, &sample("agent-1")).unwrap();

        let meta = std::fs::read_to_string(root.join("agent-1").join(META_FILE)).unwrap();
        assert!(meta.contains("\"runtime\": \"pi\""), "runtime 要写进 agent.json");
        assert_eq!(list_at(&root)[0].runtime, "pi");
    }

    #[test]
    fn legacy_agent_json_without_runtime_still_loads() {
        // 老数据没有 runtime 字段 → 反序列化时用默认值顶上，不能读不出来
        let root = temp_root("runtime-missing");
        let dir = root.join("agent-1");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join(META_FILE),
            r#"{"id":"agent-1","name":"老智能体","version":1}"#,
        )
        .unwrap();

        let listed = list_at(&root);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].runtime, DEFAULT_RUNTIME);
    }

    #[test]
    fn empty_instruction_leaves_no_file() {
        let root = temp_root("empty-instruction");
        let mut agent = sample("agent-1");
        agent.instruction = String::new();
        save_at(&root, &agent).unwrap();

        assert!(!root.join("agent-1").join(INSTRUCTION_FILE).exists());
        assert_eq!(list_at(&root)[0].instruction, "");
    }

    #[test]
    fn delete_removes_it() {
        let root = temp_root("delete");
        save_at(&root, &sample("agent-1")).unwrap();
        delete_at(&root, "agent-1").unwrap();
        assert!(list_at(&root).is_empty());
    }

    #[test]
    fn rename_updates_references() {
        let root = temp_root("rename-ref");
        let mut agent = sample("agent-1");
        agent.skills = vec!["skills/old".to_string()];
        save_at(&root, &agent).unwrap();

        // 模拟改名：把引用从 old 换成 new
        let listed = list_at(&root);
        let mut updated = listed[0].clone();
        updated.skills = vec!["skills/new".to_string()];
        save_at(&root, &updated).unwrap();

        assert_eq!(list_at(&root)[0].skills, vec!["skills/new".to_string()]);
    }

    #[test]
    fn rejects_illegal_id() {
        let root = temp_root("bad-id");
        assert!(save_at(&root, &sample("../escape")).is_err());
        assert!(delete_at(&root, "../escape").is_err());
    }

    #[test]
    fn save_bumps_version() {
        // 用自己的临时家目录 —— `Paths` 是按家目录拼的，
        // 拿临时目录的父目录会跟别的用例撞车。
        let home = temp_root("version");
        let paths = Paths::new(&home);
        let agents = paths.agents_root();
        std::fs::create_dir_all(&agents).unwrap();

        let first = save(&paths, &sample("agent-1")).unwrap();
        assert_eq!(first.version, 1);

        let second = save(&paths, &first).unwrap();
        assert_eq!(second.version, 2);
    }

    #[test]
    fn mcp_server_ids_extracted_from_refs() {
        let agent = sample("agent-1");
        assert_eq!(mcp_server_ids(&agent), vec!["filesystem".to_string()]);
    }
}
