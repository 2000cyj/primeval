//! Skill 仓库：工作区内的 Skill 以「目录 + SKILL.md」的形式落盘。
//!
//! 参照 multica 的四种添加方式实现：
//! - 手动创建：写一份只有 frontmatter 的 SKILL.md；
//! - 本地导入：选择含 SKILL.md 的目录，或 `.zip` / `.skill` 压缩包；
//! - URL 导入：拉取已发布的 skill（支持 GitHub / Skills.sh / 直接 md 链接）；
//! - 运行时复制：把本机运行时（Claude Code / Codex / 通用 Agent）里已装好的
//!   skill 提升到工作区。
//!
//! 工作区根目录：`~/.agent-compose/skills/<skill 名>/`

use crate::paths::Paths;
use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};

use serde::Serialize;
use serde_json::json;

/// 单个文件上限（对齐 multica 的 maxImportFileSize）。
const MAX_SKILL_FILE_BYTES: u64 = 1 << 20;
/// 附属文件总量上限（对齐 maxImportTotalSize）。
const MAX_SKILL_BUNDLE_BYTES: u64 = 8 << 20;
/// 附属文件数量上限（对齐 maxImportFileCount）。
const MAX_SKILL_FILE_COUNT: usize = 512;
/// 压缩包上限（对齐 maxImportArchiveUploadSize）。
const MAX_SKILL_ARCHIVE_BYTES: u64 = 16 << 20;

/// skill 名称最长多少字符 —— 规范上限 64。
const MAX_SKILL_NAME_CHARS: usize = 64;

/// skill 描述最长多少字符 —— 规范上限 1024（超出会被运行时截断）。
const MAX_SKILL_DESCRIPTION_CHARS: usize = 1024;

/// skill 目录里的 sidecar：记录来源等信息，不影响 SKILL.md。
const SOURCE_FILE: &str = ".agent-compose.json";

/// 工作区里的一�� skill。
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SkillInfo {
    pub name: String,
    pub description: String,
    /// skill 目录的绝对路径。
    pub path: String,
    /// 相对 `~/.agent-compose` 的路径（如 `skills/knowledge-base`）。
    ///
    /// 智能体绑定 skill 时存这个，而不是名字 —— 在 Skills 页改了 skill 的
    /// 名字或描述，智能体那边不用跟着改。
    pub relative_path: String,
    /// 来源：manual / url / local / runtime。
    pub source: String,
    /// 是否启用。
    pub enabled: bool,
    /// 是否有可重新拉取的来源（可用于「从来源更新」）。
    pub refreshable: bool,
    /// 最后修改时间（epoch 毫秒）。
    pub updated_at_ms: u64,
    /// 目录内的文件数（含 SKILL.md）。
    pub file_count: usize,
}

/// 运行时里已装好、可以提升到工作区的 skill。
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSkillInfo {
    pub name: String,
    pub description: String,
    /// 运行时里的绝对路径。
    pub path: String,
    /// 运行时名称，如「Claude Code」。
    pub runtime: String,
    /// 工作区里是否已经有同名 skill。
    pub installed: bool,
}

/// 写一组文件进工作区（给同 crate 的其它模块用）。
pub fn write_skill_public(
    paths: &Paths,
    name: &str,
    description: &str,
    source: &str,
    files: Vec<SkillFile>,
) -> Result<SkillInfo, String> {
    write_skill(paths, name, description, source, files)
}

/// 记来源出处（给同 crate 的其它模块用）。
pub fn set_origin_public(paths: &Paths, name: &str, origin: Option<serde_json::Value>) {
    set_origin(paths, name, origin);
}

/// git 源的出处（给同 crate 的其它模块用）。
pub fn origin_git_public(repo: &str, reference: Option<&str>) -> serde_json::Value {
    origin_git(repo, reference)
}

/// 目录名清洗（给同 crate 的其它模块用）。
pub fn sanitize_skill_name_public(raw: &str) -> String {
    sanitize_skill_name(raw)
}

/// 落盘前先在内存里攒好的一组文件。
#[derive(Clone, Debug)]
pub struct SkillFile {
    /// 相对路径（`/` 分隔）。
    pub rel: String,
    /// 文件内容。
    pub data: Vec<u8>,
}

impl SkillFile {
    /// 用字符串内容构造一个文件。
    pub fn text(rel: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            rel: rel.into(),
            data: content.into().into_bytes(),
        }
    }
}

/// skill 目录里的一个文件。
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SkillFileInfo {
    /// 相对路径（`/` 分隔）。
    pub rel: String,
    /// 文件大小（字节）。
    pub size: u64,
}

/// 一个 skill 的完整信息（详情抽屉 / 编辑器用）。
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SkillDetail {
    pub name: String,
    pub description: String,
    /// skill 目录的绝对路径。
    pub path: String,
    pub source: String,
    pub enabled: bool,
    /// SKILL.md 的正文（不含 frontmatter）。
    pub content: String,
    /// frontmatter 里的其它字段。
    pub frontmatter: BTreeMap<String, String>,
    /// 目录下的文件清单。
    pub files: Vec<SkillFileInfo>,
    /// 目录总大小（字节）。
    pub total_size: u64,
    /// 最后修改时间（epoch 毫秒）。
    pub updated_at_ms: u64,
}

// ---------------------------------------------------------------- 路径

/// skill 目录 → 相对 `~/.agent-compose` 的引用（`skills/<目录名>`）。
///
/// 智能体绑定 skill 时存这个引用：目录名是 skill 的身份，名字和描述改了
/// 引用也不变，所以智能体那边不用跟着改。
fn relative_skill_ref(dir: &Path) -> String {
    dir.file_name()
        .map(|name| format!("skills/{}", name.to_string_lossy()))
        .unwrap_or_default()
}

/// 本机已知的运行时 skill 目录。
fn runtime_skill_dirs(paths: &Paths) -> Vec<(String, PathBuf)> {
    let home = paths.home().to_path_buf();
    vec![
        (
            "Claude Code".to_string(),
            home.join(".claude").join("skills"),
        ),
        ("Codex".to_string(), home.join(".codex").join("skills")),
        (
            "通用 Agent".to_string(),
            home.join(".agents").join("skills"),
        ),
    ]
}

// ---------------------------------------------------------------- frontmatter

/// 解析 SKILL.md 的 frontmatter。
///
/// frontmatter 是 **YAML** —— 必须用 YAML 解析器，不能按行 split(':')。
///
/// 按行读的话，块标量只能拿到符号、拿不到内容：
///
/// ```yaml
/// description: |
///   第一行
///   第二行
/// ```
///
/// 于是界面上描述显示成 `|` 或 `>`，内容全丢。
///
/// 解析不出来（不是合法 YAML / 没有 frontmatter）→ 返回 `(None, 全文)`，
/// 调用方按「没有 frontmatter」处理。
fn parse_frontmatter(raw: &str) -> (Option<BTreeMap<String, String>>, String) {
    let text = raw.strip_prefix('\u{feff}').unwrap_or(raw);
    let mut lines = text.lines();
    match lines.next() {
        Some(first) if first.trim() == "---" => {}
        _ => return (None, text.to_string()),
    }

    // 找 frontmatter 的结束位置
    let mut fm_lines: Vec<&str> = Vec::new();
    let mut body_lines: Vec<&str> = Vec::new();
    let mut closed = false;
    for line in lines {
        if !closed {
            if line.trim() == "---" {
                closed = true;
                continue;
            }
            fm_lines.push(line);
            continue;
        }
        body_lines.push(line);
    }
    if !closed {
        return (None, text.to_string());
    }

    let yaml = fm_lines.join("\n");
    // 用 YAML 解析 —— 块标量、折叠标量、引号都能正确还原
    let parsed: serde_yaml::Value = match serde_yaml::from_str(&yaml) {
        Ok(value) => value,
        Err(_) => return (None, text.to_string()),
    };
    let mapping = match parsed.as_mapping() {
        Some(map) => map,
        None => return (None, text.to_string()),
    };

    let mut out: BTreeMap<String, String> = BTreeMap::new();
    for (key, value) in mapping {
        let Some(key) = key.as_str() else { continue };
        // 只取标量 —— 嵌套结构按原样忽略
        if let Some(text) = scalar_to_string(value) {
            out.insert(key.to_string(), text);
        }
    }
    let frontmatter = if out.is_empty() { None } else { Some(out) };
    (frontmatter, body_lines.join("\n"))
}

/// YAML 标量 → 字符串。
///
/// 块标量的内容会带换行 —— 折成一行（界面显示用）。
fn scalar_to_string(value: &serde_yaml::Value) -> Option<String> {
    match value {
        serde_yaml::Value::String(text) => Some(text.clone()),
        serde_yaml::Value::Bool(value) => Some(value.to_string()),
        serde_yaml::Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

/// 解析 frontmatter（给同 crate 的其它模块用）。
pub fn parse_frontmatter_public(raw: &str) -> (Option<BTreeMap<String, String>>, String) {
    parse_frontmatter(raw)
}

/// 取 frontmatter 里的字符串字段（给同 crate 的其它模块用）。
pub fn fm_get_public(frontmatter: &Option<BTreeMap<String, String>>, key: &str) -> String {
    fm_get(frontmatter, key)
}

/// 收集一个 skill 目录下的所有文件（给同 crate 的其它模块用）。
pub fn collect_skill_files_public(dir: &Path) -> Result<Vec<SkillFile>, String> {
    collect_dir_files(dir)
}

/// 取 frontmatter 里的字符串字段。
fn fm_get(frontmatter: &Option<BTreeMap<String, String>>, key: &str) -> String {
    frontmatter
        .as_ref()
        .and_then(|map| map.get(key))
        .map(|value| value.trim().to_string())
        .unwrap_or_default()
}

/// 把 skill 名规整成可用的目录名。
fn sanitize_skill_name(raw: &str) -> String {
    let trimmed = raw.trim();
    let mut out = String::new();
    let mut last_dash = false;
    for ch in trimmed.chars() {
        let keep = ch.is_alphanumeric() || ch == '-' || ch == '_' || ch == '.';
        if keep {
            if ch == '.' && out.is_empty() {
                continue;
            }
            out.push(ch);
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "skill".to_string()
    } else {
        trimmed
    }
}

/// 描述长度校验：手写路径（创建 / 编辑）超限直接报错。
fn validate_description(raw: &str) -> Result<(), String> {
    if raw.chars().count() > MAX_SKILL_DESCRIPTION_CHARS {
        return Err(format!(
            "skill 描述不能超过 {MAX_SKILL_DESCRIPTION_CHARS} 个字符（规范上限）"
        ));
    }
    Ok(())
}

/// 描述截断到规范上限：导入路径用（别人的 skill 超长不该挡住导入）。
fn truncate_description(raw: &str) -> String {
    raw.chars().take(MAX_SKILL_DESCRIPTION_CHARS).collect()
}

/// 名字里的非法字符会让 URL 导入与运行时复制找不到同一个目录。
fn validate_skill_name(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("请填写 skill 名称".to_string());
    }
    if trimmed.chars().count() > MAX_SKILL_NAME_CHARS {
        return Err(format!(
            "skill 名称不能超过 {MAX_SKILL_NAME_CHARS} 个字符（规范上限）"
        ));
    }
    if trimmed.contains('\n') || trimmed.contains('\r') {
        return Err("skill 名称不能包含换行".to_string());
    }
    Ok(trimmed.to_string())
}

/// 目录/文件名里要跳过的条目。
fn is_ignored_entry(name: &str) -> bool {
    name.starts_with('.')
        || name == "__MACOSX"
        || name == "node_modules"
        || name.eq_ignore_ascii_case("license")
        || name.eq_ignore_ascii_case("license.md")
        || name.eq_ignore_ascii_case("license.txt")
}

fn is_skill_md(rel: &str) -> bool {
    rel.rsplit('/')
        .next()
        .map(|base| base.eq_ignore_ascii_case("SKILL.md"))
        .unwrap_or(false)
}

// ---------------------------------------------------------------- 落盘

/// 把一组文件写进工作区，返回写入后的 skill 信息。
fn write_skill(
    paths: &Paths,
    name: &str,
    description: &str,
    source: &str,
    mut files: Vec<SkillFile>,
) -> Result<SkillInfo, String> {
    let dir_name = sanitize_skill_name(name);
    let root = paths.skills_root();
    let dir = root.join(&dir_name);
    if dir.exists() {
        return Err(format!("已存在同名 skill：{name}"));
    }

    // SKILL.md 必须存在，且 frontmatter 里要有 name / description。
    let skill_md = files
        .iter_mut()
        .find(|file| is_skill_md(&file.rel))
        .ok_or_else(|| "缺少 SKILL.md：无法识别为 skill".to_string())?;

    let raw = String::from_utf8_lossy(&skill_md.data).to_string();
    let (frontmatter, body) = parse_frontmatter(&raw);
    let has_name = !fm_get(&frontmatter, "name").is_empty();
    let declared_description = fm_get(&frontmatter, "description");
    let has_description = !declared_description.is_empty();
    // 描述超规范上限就截断（导入别人的 skill 时不该直接失败）。
    let description = truncate_description(description);
    let description_too_long = declared_description.chars().count() > MAX_SKILL_DESCRIPTION_CHARS;

    if has_name && has_description && !description_too_long {
        // frontmatter 已经完整：原样保留，别把多行 YAML 压成一行。
        // 来源信息另写到 sidecar 里。
    } else {
        // frontmatter 是 YAML —— 重建会把多行块标量压成一行、内容丢掉，
        // 还会剥掉引号（值里的 `: ` 就成了 YAML 嵌套映射）。
        // 所以只做「最小改动」：整段保留，只动 name / description。
        // source 单独记在 sidecar 里，不进 frontmatter（免得多一个非标准字段）。
        let wanted = if !has_name || !has_description {
            Some(description.clone())
        } else {
            None
        };
        let fm_text = patch_frontmatter(&fm_text_of(&raw), name, wanted.as_deref());
        let mut out = String::from("---\n");
        out.push_str(fm_text.trim_end_matches('\n'));
        out.push_str("\n---\n\n");
        if !body.trim().is_empty() {
            out.push_str(body.trim_start());
            if !out.ends_with('\n') {
                out.push('\n');
            }
        }
        skill_md.data = out.into_bytes();
    }

    fs::create_dir_all(&dir).map_err(|e| format!("创建 skill 目录失败：{e}"))?;
    for file in &files {
        // 相对路径不能越出 skill 目录。
        let rel = file.rel.replace('\\', "/");
        if rel.split('/').any(|seg| seg == ".." || seg.is_empty()) {
            continue;
        }
        let target = dir.join(rel.replace('/', "\\"));
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
        }
        fs::write(&target, &file.data).map_err(|e| format!("写入 {} 失败：{e}", target.display()))?;
    }

    // 来源信息存在 sidecar 里：不动 SKILL.md 的 frontmatter。
    let meta = json!({ "source": source, "name": name, "enabled": true });
    let _ = fs::write(
        dir.join(SOURCE_FILE),
        serde_json::to_vec_pretty(&meta).unwrap_or_default(),
    );

    let updated_at_ms = file_modified_ms(&dir.join("SKILL.md"));
    Ok(SkillInfo {
        name: name.to_string(),
        description: description.to_string(),
        path: dir.to_string_lossy().to_string(),
        relative_path: relative_skill_ref(&dir),
        source: source.to_string(),
        enabled: true,
        refreshable: false,
        updated_at_ms,
        file_count: files.len(),
    })
}

fn file_modified_ms(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|dur| dur.as_millis() as u64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------- 目录收集

/// 递归收集目录下的文件，遵守大小 / 数量上限。
fn collect_dir_files(root: &Path) -> Result<Vec<SkillFile>, String> {
    let mut out: Vec<SkillFile> = Vec::new();
    let mut total_bytes: u64 = 0;
    let mut stack = vec![root.to_path_buf()];

    while let Some(dir) = stack.pop() {
        let entries = fs::read_dir(&dir).map_err(|e| format!("读取目录失败：{e}"))?;
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if is_ignored_entry(&name) {
                continue;
            }
            let path = entry.path();
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_dir() {
                stack.push(path);
                continue;
            }
            let rel = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            if rel.is_empty() {
                continue;
            }
            if meta.len() > MAX_SKILL_FILE_BYTES {
                // 超大文件直接跳过：SKILL.md 本身超限会在下面单独报错。
                if is_skill_md(&rel) {
                    return Err("SKILL.md 超过 1MB，无法导入".to_string());
                }
                continue;
            }
            if out.len() >= MAX_SKILL_FILE_COUNT {
                return Err("文件数量超过 512 个，无法导入".to_string());
            }
            total_bytes += meta.len();
            if total_bytes > MAX_SKILL_BUNDLE_BYTES {
                return Err("文件总大小超过 8MB，无法导入".to_string());
            }
            let data = fs::read(&path).map_err(|e| format!("读取 {} 失败：{e}", path.display()))?;
            out.push(SkillFile { rel, data });
        }
    }
    Ok(out)
}

/// 在目录里定位 skill 根目录。
fn find_skill_root(dir: &Path) -> Result<PathBuf, String> {
    if dir.join("SKILL.md").is_file() {
        return Ok(dir.to_path_buf());
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() && path.join("SKILL.md").is_file() {
                candidates.push(path);
            }
        }
    }
    candidates.sort();
    match candidates.len() {
        0 => Err("所选目录里没有 SKILL.md，请选择包含 SKILL.md 的 skill 目录".to_string()),
        1 => Ok(candidates.remove(0)),
        _ => {
            let names: Vec<String> = candidates
                .iter()
                .filter_map(|p| p.file_name().map(|n| n.to_string_lossy().to_string()))
                .collect();
            Err(format!(
                "所选目录包含多个 skill（{}），请选择具体的 skill 目录",
                names.join("、")
            ))
        }
    }
}

// ---------------------------------------------------------------- zip

/// zip 条目。
struct ZipEntry {
    name: String,
    data: Vec<u8>,
}

fn read_u16(data: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([data[offset], data[offset + 1]])
}

fn read_u32(data: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes([
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3],
    ])
}

/// 读取 zip（STORE / DEFLATE）里的全部条目。
fn read_zip(path: &Path) -> Result<Vec<ZipEntry>, String> {
    let meta = fs::metadata(path).map_err(|e| format!("读取压缩包失败：{e}"))?;
    if meta.len() > MAX_SKILL_ARCHIVE_BYTES {
        return Err("压缩包超过 16MB，无法导入".to_string());
    }
    let data = fs::read(path).map_err(|e| format!("读取压缩包失败：{e}"))?;

    // 找 EOCD（End of Central Directory）。
    let mut eocd = None;
    let min = data.len().saturating_sub(66_000);
    for i in (min..data.len().saturating_sub(3)).rev() {
        if read_u32(&data, i) == 0x0605_4b50 {
            eocd = Some(i);
            break;
        }
    }
    let eocd = eocd.ok_or_else(|| "压缩包格式无法识别（不是有效的 zip）".to_string())?;
    let entry_count = read_u16(&data, eocd + 10) as usize;
    let cd_offset = read_u32(&data, eocd + 16) as usize;

    let mut entries: Vec<ZipEntry> = Vec::new();
    let mut cursor = cd_offset;
    for _ in 0..entry_count {
        if cursor + 46 > data.len() || read_u32(&data, cursor) != 0x0201_4b50 {
            break;
        }
        let flags = read_u16(&data, cursor + 8);
        let method = read_u16(&data, cursor + 10);
        let compressed_size = read_u32(&data, cursor + 20) as usize;
        let name_len = read_u16(&data, cursor + 28) as usize;
        let extra_len = read_u16(&data, cursor + 30) as usize;
        let comment_len = read_u16(&data, cursor + 32) as usize;
        let local_offset = read_u32(&data, cursor + 42) as usize;
        // zip 规范要求用 `/`，但 Windows 上打包出来的包常带 `\`，
        // 这里统一成 `/`，后面的路径判断才不会漏。
        let name = String::from_utf8_lossy(&data[cursor + 46..cursor + 46 + name_len])
            .replace('\\', "/");
        cursor += 46 + name_len + extra_len + comment_len;

        if name.ends_with('/') || name.is_empty() {
            continue;
        }
        // 跳过加密条目。
        if flags & 0x1 != 0 {
            continue;
        }
        if local_offset + 30 > data.len() || read_u32(&data, local_offset) != 0x0403_4b50 {
            continue;
        }
        let l_name_len = read_u16(&data, local_offset + 26) as usize;
        let l_extra_len = read_u16(&data, local_offset + 28) as usize;
        let start = local_offset + 30 + l_name_len + l_extra_len;
        let end = start + compressed_size;
        if end > data.len() {
            continue;
        }
        let raw = &data[start..end];
        let content = match method {
            0 => raw.to_vec(),
            8 => {
                let mut decoder = flate2::read::DeflateDecoder::new(raw);
                let mut out = Vec::new();
                decoder
                    .read_to_end(&mut out)
                    .map_err(|e| format!("解压压缩包失败：{e}"))?;
                out
            }
            other => return Err(format!("暂不支持的压缩方式：{other}")),
        };
        entries.push(ZipEntry { name, data: content });
    }

    if entries.is_empty() {
        return Err("压缩包里没有可读取的文件".to_string());
    }
    Ok(entries)
}

/// 从 zip 条目里挑出 skill 根前缀（最浅的 SKILL.md 所在目录）。
fn zip_skill_prefix(entries: &[ZipEntry]) -> Option<String> {
    let mut best: Option<String> = None;
    for entry in entries {
        if !is_skill_md(&entry.name) {
            continue;
        }
        let prefix = match entry.name.rfind('/') {
            Some(index) => entry.name[..=index].to_string(),
            None => String::new(),
        };
        match &best {
            Some(current) if current.len() <= prefix.len() => {}
            _ => best = Some(prefix),
        }
    }
    best
}

// ---------------------------------------------------------------- commands

/// 来源出处：记录 skill 是从哪来的，好支持「从来源更新」。
///
/// - url：记 source_url，刷新时重新抓
/// - local / runtime：记 source_path，刷新时重新读本地目录
/// git 源的出处：`type: "git"`，记仓库地址与 ref。
fn origin_git(repo: &str, reference: Option<&str>) -> serde_json::Value {
    let mut origin = json!({ "type": "git", "source_url": repo });
    if let Some(reference) = reference {
        origin["source_ref"] = json!(reference);
    }
    origin
}

fn origin_json(kind: &str, source_url: Option<&str>, source_path: Option<&str>) -> serde_json::Value {
    let mut origin = json!({ "type": kind });
    if let Some(url) = source_url {
        origin["source_url"] = json!(url);
    }
    if let Some(path) = source_path {
        origin["source_path"] = json!(path);
    }
    origin
}

/// 把来源出处写进 sidecar。
fn set_origin(paths: &Paths, name: &str, origin: Option<serde_json::Value>) {
    let dir = paths.skills_root().join(sanitize_skill_name(name));
    if !dir.is_dir() {
        return;
    }
    let mut meta = read_meta(&dir);
    match origin {
        Some(value) => meta["origin"] = value,
        None => {
            meta.as_object_mut().map(|map| map.remove("origin"));
        }
    }
    let _ = write_meta(&dir, &meta);
}

/// 读来源出处。
fn read_origin(dir: &Path) -> Option<serde_json::Value> {
    read_meta(dir).get("origin").cloned()
}

/// 该 skill 能不能「从来源更新」。
fn is_refreshable(dir: &Path) -> bool {
    let Some(origin) = read_origin(dir) else {
        return false;
    };
    let kind = origin.get("type").and_then(|v| v.as_str()).unwrap_or("");
    match kind {
        "url" | "git" => origin
            .get("source_url")
            .and_then(|v| v.as_str())
            .map(|v| !v.trim().is_empty())
            .unwrap_or(false),
        "local" | "runtime" => origin
            .get("source_path")
            .and_then(|v| v.as_str())
            .map(|v| !v.trim().is_empty())
            .unwrap_or(false),
        _ => false,
    }
}

/// 读 sidecar 里的元信息。
fn read_meta(dir: &Path) -> serde_json::Value {
    fs::read_to_string(dir.join(SOURCE_FILE))
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .unwrap_or_else(|| json!({}))
}

/// 写入 sidecar 里的元信息。
fn write_meta(dir: &Path, meta: &serde_json::Value) -> Result<(), String> {
    fs::write(
        dir.join(SOURCE_FILE),
        serde_json::to_vec_pretty(meta).unwrap_or_default(),
    )
    .map_err(|e| format!("写入 skill 信息失败：{e}"))
}

/// 一个 git 源仓库 —— 有 skill 是从它导入的。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepo {
    /// 仓库地址（`owner/repo` 或完整 URL）。
    pub source_url: String,
    /// ref（分支 / tag）。空 = 默认分支。
    pub source_ref: Option<String>,
    /// 从这个仓库导入的 skill 名。
    pub skills: Vec<String>,
}

/// 列出所有「从 git 仓库导入过」的仓库。
///
/// 导入时来源就记在 skill 的 sidecar 里（`origin: {type: "git", …}`），
/// 这里按「仓库 + ref」归拢 —— 同一个仓库导过多次算一条。
///
/// 界面上用它做「从 GitHub 仓库添加」的快捷入口：
/// 不用再输一遍地址，选一下就能把那个仓库里的 skill 导进来。
pub fn skills_git_repos(paths: &Paths) -> Result<Vec<GitRepo>, String> {
    let root = paths.skills_root();
    let Ok(entries) = fs::read_dir(&root) else {
        return Ok(Vec::new());
    };

    // 先按 (仓库, ref) 分组
    let mut groups: Vec<GitRepo> = Vec::new();

    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() || !dir.join("SKILL.md").is_file() {
            continue;
        }
        let meta = read_meta(&dir);
        let Some(origin) = meta.get("origin") else {
            continue;
        };
        if origin.get("type").and_then(|v| v.as_str()) != Some("git") {
            continue;
        }
        let Some(source_url) = origin
            .get("source_url")
            .and_then(|v| v.as_str())
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
        else {
            continue;
        };
        let source_ref = origin
            .get("source_ref")
            .and_then(|v| v.as_str())
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty());

        let name = {
            let raw = fs::read_to_string(dir.join("SKILL.md")).unwrap_or_default();
            let (frontmatter, _) = parse_frontmatter(&raw);
            let declared = fm_get(&frontmatter, "name");
            if declared.is_empty() {
                dir.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default()
            } else {
                declared
            }
        };

        let key = (source_url.clone(), source_ref.clone());
        match groups.iter_mut().find(|repo| {
            (repo.source_url.clone(), repo.source_ref.clone()) == key
        }) {
            Some(repo) => repo.skills.push(name),
            None => {
                groups.push(GitRepo {
                    source_url,
                    source_ref,
                    skills: vec![name],
                });
            }
        }
    }

    for repo in &mut groups {
        repo.skills.sort();
    }
    Ok(groups)
}

/// 启用 / 停用一个 skill。
pub fn skills_set_enabled(paths: &Paths, name: String, enabled: bool) -> Result<(), String> {    let dir = paths.skills_root().join(sanitize_skill_name(&name));
    if !dir.is_dir() {
        return Ok(());
    }
    let mut meta = read_meta(&dir);
    meta["enabled"] = json!(enabled);
    write_meta(&dir, &meta)
}

/// 列出工作区里的 skill。
pub fn skills_list(paths: &Paths) -> Result<Vec<SkillInfo>, String> {

    let root = paths.skills_root();
    let mut out: Vec<SkillInfo> = Vec::new();
    let Ok(entries) = fs::read_dir(&root) else {
        return Ok(out);
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let skill_md = dir.join("SKILL.md");
        if !skill_md.is_file() {
            continue;
        }
        let raw = fs::read_to_string(&skill_md).unwrap_or_default();
        let (frontmatter, _) = parse_frontmatter(&raw);
        let name = {
            let declared = fm_get(&frontmatter, "name");
            if declared.is_empty() {
                dir.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default()
            } else {
                declared
            }
        };
        let description = fm_get(&frontmatter, "description");
        let meta = read_meta(&dir);
        let enabled = meta
            .get("enabled")
            .and_then(|value| value.as_bool())
            .unwrap_or(true);
        let source = {
            // 优先读 sidecar；老目录（没有 sidecar）看 frontmatter。
            let from_meta = meta
                .get("source")
                .and_then(|item| item.as_str())
                .map(|item| item.to_string());
            match from_meta {
                Some(value) if !value.is_empty() => value,
                _ => {
                    let declared = fm_get(&frontmatter, "source");
                    if declared.is_empty() {
                        "manual".to_string()
                    } else {
                        declared
                    }
                }
            }
        };
        let file_count = fs::read_dir(&dir)
            .map(|list| list.flatten().count())
            .unwrap_or(0);
        out.push(SkillInfo {
            name,
            description,
            path: dir.to_string_lossy().to_string(),
            relative_path: relative_skill_ref(&dir),
            source,
            enabled,
            refreshable: is_refreshable(&dir),
            updated_at_ms: file_modified_ms(&skill_md),
            file_count,
        });
    }
    out.sort_by(|a, b| b.updated_at_ms.cmp(&a.updated_at_ms));
    Ok(out)
}

/// 手动创建 skill。
pub fn skills_create_manual(
    paths: &Paths,
    name: String,
    description: String,
) -> Result<SkillInfo, String> {
    let name = validate_skill_name(&name)?;
    let description = description.trim().to_string();
    validate_description(&description)?;
    let body = format!("---\nname: {name}\ndescription: {description}\n---\n\n# {name}\n");
    write_skill(
            paths,
        &name,
        &description,
        "manual",
        vec![SkillFile {
            rel: "SKILL.md".to_string(),
            data: body.into_bytes(),
        }],
    )
}

/// 从 URL 抓到的 skill 内容。
struct FetchedSkill {
    name: String,
    description: String,
    /// SKILL.md 全文。
    content: String,
}

/// 抓取 URL 上的 skill（导入与「从来源更新」共用）。
async fn fetch_skill_from_url(paths: &Paths, url: &str) -> Result<FetchedSkill, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("请填写 skill 网址".to_string());
    }
    let candidates = url_candidates(trimmed);
    if candidates.is_empty() {
        return Err("网址不合法".to_string());
    }

    // 走全局出站代理（系统设置 › 网络），没配就沿用环境变量。
    let client = crate::proxy::apply_to(
        reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .user_agent("AgentCompose/0.1"),
        paths,
    )
    .build()
    .map_err(|e| e.to_string())?;

    let mut last_error = String::from("没有取到 SKILL.md");
    for candidate in &candidates {
        let response = client.get(candidate).send().await;
        let Ok(response) = response else {
            last_error = format!("请求失败：{candidate}");
            continue;
        };
        if !response.status().is_success() {
            last_error = format!("{candidate} 返回 {}", response.status().as_u16());
            continue;
        }
        let Ok(text) = response.text().await else {
            last_error = format!("读取 {candidate} 失败");
            continue;
        };
        if looks_like_html(&text) {
            last_error = format!("{candidate} 返回的是网页，不是 skill 文件");
            continue;
        }
        let (frontmatter, _) = parse_frontmatter(&text);
        let declared = fm_get(&frontmatter, "name");
        let name = if declared.is_empty() {
            name_from_url(candidate)
        } else {
            declared
        };
        let description = fm_get(&frontmatter, "description");
        return Ok(FetchedSkill {
            name,
            description,
            content: text,
        });
    }
    Err(format!("导入失败：{last_error}"))
}

/// 从 URL 导入 skill。
pub async fn skills_import_url(paths: &Paths, url: String) -> Result<SkillInfo, String> {
    let trimmed = url.trim().to_string();
    let fetched = fetch_skill_from_url(paths, &trimmed).await?;
    let mut info = write_skill(
            paths,
        &fetched.name,
        &fetched.description,
        "url",
        vec![SkillFile {
            rel: "SKILL.md".to_string(),
            data: fetched.content.into_bytes(),
        }],
    )?;
    // 记下来源出处：之后才能「从来源更新」。
    set_origin(paths, &info.name, Some(origin_json("url", Some(&trimmed), None)));
    info.refreshable = true;
    Ok(info)
}

/// 从本地目录或压缩包导入 skill。
/// 批量导入一个目录下的所有 skill。
///
/// 目录本身没有 `SKILL.md`、但里面有若干个带 `SKILL.md` 的子目录时，
/// 把它们全部导进来 —— 项目里常见 `.pi/skills/<名字>/SKILL.md` 这种布局。
///
/// 返回导入成功的 skill（失败的跳过，不中断整批）。
pub fn skills_import_local_all(
    paths: &Paths,
    path: String,
) -> Result<Vec<SkillInfo>, String> {
    let source = PathBuf::from(path.trim());
    if !source.exists() {
        return Err("所选路径不存在".to_string());
    }
    if !source.is_dir() {
        return Err("批量导入只支持目录".to_string());
    }
    // 目录自己就是 skill → 当成单个导入
    if source.join("SKILL.md").is_file() {
        return skills_import_local(paths, path).map(|info| vec![info]);
    }

    let mut dirs: Vec<PathBuf> = fs::read_dir(&source)
        .map_err(|e| format!("读目录失败：{e}"))?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_dir() && path.join("SKILL.md").is_file())
        .collect();
    dirs.sort();
    if dirs.is_empty() {
        return Err(format!(
            "{} 里没有找到任何带 SKILL.md 的子目录",
            source.display()
        ));
    }

    let mut out: Vec<SkillInfo> = Vec::new();
    for dir in dirs {
        match skills_import_local(paths, dir.to_string_lossy().to_string()) {
            Ok(info) => out.push(info),
            // 一个失败不影响整批 —— 名字撞了之类的
            Err(_) => continue,
        }
    }
    if out.is_empty() {
        return Err("一个都没导进来（可能都已存在同名 skill）".to_string());
    }
    Ok(out)
}

pub fn skills_import_local(paths: &Paths, path: String) -> Result<SkillInfo, String> {
    let source = PathBuf::from(path.trim());
    if !source.exists() {
        return Err("所选路径不存在".to_string());
    }

    if source.is_dir() {
        let root = find_skill_root(&source)?;
        let files = collect_dir_files(&root)?;
        let raw = files
            .iter()
            .find(|file| is_skill_md(&file.rel))
            .map(|file| String::from_utf8_lossy(&file.data).to_string())
            .unwrap_or_default();
        let (frontmatter, _) = parse_frontmatter(&raw);
        let declared = fm_get(&frontmatter, "name");
        let name = if declared.is_empty() {
            root.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "skill".to_string())
        } else {
            declared
        };
        let description = fm_get(&frontmatter, "description");
        let mut info = write_skill(paths, &name, &description, "local", files)?;
        // 记下源目录：之后可以「从来源更新」重新读一遍。
        set_origin(
            paths,
            &name,
            Some(origin_json("local", None, Some(&root.to_string_lossy()))),
        );
        info.refreshable = true;
        return Ok(info);
    }

    let lower = source
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if !lower.ends_with(".zip") && !lower.ends_with(".skill") {
        return Err("请选择含 SKILL.md 的目录，或 .zip / .skill 压缩包".to_string());
    }

    let entries = read_zip(&source)?;
    let prefix = zip_skill_prefix(&entries)
        .ok_or_else(|| "压缩包里没有 SKILL.md，无法识别为 skill".to_string())?;
    let mut files: Vec<SkillFile> = Vec::new();
    let mut total_bytes: u64 = 0;
    for entry in &entries {
        let name = entry.name.replace('\\', "/");
        if !name.starts_with(&prefix) {
            continue;
        }
        let rel = name[prefix.len()..].to_string();
        if rel.is_empty() || rel.ends_with('/') {
            continue;
        }
        let base = rel.rsplit('/').next().unwrap_or("");
        if is_ignored_entry(base) {
            continue;
        }
        if entry.data.len() as u64 > MAX_SKILL_FILE_BYTES {
            if is_skill_md(&rel) {
                return Err("SKILL.md 超过 1MB，无法导入".to_string());
            }
            continue;
        }
        if files.len() >= MAX_SKILL_FILE_COUNT {
            return Err("文件数量超过 512 个，无法导入".to_string());
        }
        total_bytes += entry.data.len() as u64;
        if total_bytes > MAX_SKILL_BUNDLE_BYTES {
            return Err("文件总大小超过 8MB，无法导入".to_string());
        }
        files.push(SkillFile { rel, data: entry.data.clone() });
    }
    if files.is_empty() {
        return Err("压缩包里没有可导入的文件".to_string());
    }
    let raw = files
        .iter()
        .find(|file| is_skill_md(&file.rel))
        .map(|file| String::from_utf8_lossy(&file.data).to_string())
        .unwrap_or_default();
    let (frontmatter, _) = parse_frontmatter(&raw);
    let declared = fm_get(&frontmatter, "name");
    let name = if declared.is_empty() {
        sanitize_skill_name(&prefix.trim_end_matches('/'))
    } else {
        declared
    };
    let description = fm_get(&frontmatter, "description");
    write_skill(paths, &name, &description, "local", files)
}

/// 列出本机运行时里已装好的 skill。
pub fn skills_list_runtime(paths: &Paths) -> Result<Vec<RuntimeSkillInfo>, String> {
    let installed: Vec<String> = skills_list(paths)?
        .into_iter()
        .map(|skill| skill.name)
        .collect();

    let mut out: Vec<RuntimeSkillInfo> = Vec::new();
    for (runtime, dir) in runtime_skill_dirs(paths) {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() || !path.join("SKILL.md").is_file() {
                continue;
            }
            let raw = fs::read_to_string(path.join("SKILL.md")).unwrap_or_default();
            let (frontmatter, _) = parse_frontmatter(&raw);
            let declared = fm_get(&frontmatter, "name");
            let name = if declared.is_empty() {
                path.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default()
            } else {
                declared
            };
            if name.is_empty() {
                continue;
            }
            let description = fm_get(&frontmatter, "description");
            out.push(RuntimeSkillInfo {
                installed: installed.contains(&name),
                name,
                description,
                path: path.to_string_lossy().to_string(),
                runtime: runtime.clone(),
            });
        }
    }
    out.sort_by(|a, b| a.runtime.cmp(&b.runtime).then(a.name.cmp(&b.name)));
    Ok(out)
}

/// 把运行时里的 skill 复制到工作区。
pub fn skills_import_runtime(paths: &Paths, path: String) -> Result<SkillInfo, String> {
    let source = PathBuf::from(path.trim());
    if !source.is_dir() {
        return Err("运行时 skill 路径不存在".to_string());
    }
    let files = collect_dir_files(&source)?;
    let raw = files
        .iter()
        .find(|file| is_skill_md(&file.rel))
        .map(|file| String::from_utf8_lossy(&file.data).to_string())
        .unwrap_or_default();
    let (frontmatter, _) = parse_frontmatter(&raw);
    let declared = fm_get(&frontmatter, "name");
    let name = if declared.is_empty() {
        source
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "skill".to_string())
    } else {
        declared
    };
    let description = fm_get(&frontmatter, "description");
    let mut info = write_skill(paths, &name, &description, "runtime", files)?;
    set_origin(
            paths,
        &name,
        Some(origin_json("runtime", None, Some(&source.to_string_lossy()))),
    );
    info.refreshable = true;
    Ok(info)
}

/// 删除工作区里的 skill。
pub fn skills_remove(paths: &Paths, name: String) -> Result<(), String> {
    let dir = paths.skills_root().join(sanitize_skill_name(&name));
    if !dir.exists() {
        return Ok(());
    }
    fs::remove_dir_all(&dir).map_err(|e| format!("删除失败：{e}"))?;
    // 绑了它的智能体少了一个能力 → 版本号 +1（启动脚本据此提示覆盖）
    crate::agent::bump_versions(paths, &[relative_skill_ref(&dir)], &[]);
    Ok(())
}

/// 从来源更新一个 skill：重新拉取来源内容并覆盖本地副本。
///
/// - url 来源：重新抓一次
/// - local / runtime 来源：重新读一遍源目录
/// - 手动创建 / 副本：没有上游，报错
///
/// 目录名与启用状态不变；本地对 SKILL.md 的修改会被覆盖。
pub async fn skills_refresh(paths: &Paths, name: String) -> Result<SkillInfo, String> {
    let dir = paths.skills_root().join(sanitize_skill_name(&name));
    if !dir.join("SKILL.md").is_file() {
        return Err(format!("找不到 skill：{name}"));
    }
    let origin = read_origin(&dir)
        .ok_or_else(|| "该 skill 没有可更新的来源（手动创建或副本）".to_string())?;
    let kind = origin.get("type").and_then(|v| v.as_str()).unwrap_or("");

    match kind {
        "url" => {
            let url = origin
                .get("source_url")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if url.trim().is_empty() {
                return Err("来源地址为空，无法更新".to_string());
            }
            let fetched = fetch_skill_from_url(paths, &url).await?;
            overwrite_skill_files(
                &dir,
                &name,
                &fetched.description,
                vec![SkillFile {
                    rel: "SKILL.md".to_string(),
                    data: fetched.content.into_bytes(),
                }],
            )?;
        }
        "local" | "runtime" => {
            let path = origin
                .get("source_path")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if path.trim().is_empty() {
                return Err("来源路径为空，无法更新".to_string());
            }
            let source = PathBuf::from(path.trim());
            if !source.exists() {
                return Err(format!("来源已不存在：{path}"));
            }
            let root = find_skill_root(&source)?;
            let files = collect_dir_files(&root)?;
            let raw = files
                .iter()
                .find(|file| is_skill_md(&file.rel))
                .map(|file| String::from_utf8_lossy(&file.data).to_string())
                .unwrap_or_default();
            let (frontmatter, _) = parse_frontmatter(&raw);
            let description = fm_get(&frontmatter, "description");
            overwrite_skill_files(&dir, &name, &description, files)?;
        }
        _ => return Err("该 skill 没有可更新的来源（手动创建或副本）".to_string()),
    }

    // 内容变了 → 绑着它的智能体版本 +1（启动脚本据此提示覆盖）
    crate::agent::bump_versions(paths, &[relative_skill_ref(&dir)], &[]);

    let meta = read_meta(&dir);
    let raw = fs::read_to_string(dir.join("SKILL.md")).unwrap_or_default();
    let (frontmatter, _) = parse_frontmatter(&raw);
    Ok(SkillInfo {
        name: {
            let declared = fm_get(&frontmatter, "name");
            if declared.is_empty() {
                name.clone()
            } else {
                declared
            }
        },
        description: fm_get(&frontmatter, "description"),
        path: dir.to_string_lossy().to_string(),
        relative_path: relative_skill_ref(&dir),
        source: meta
            .get("source")
            .and_then(|value| value.as_str())
            .unwrap_or("manual")
            .to_string(),
        enabled: meta
            .get("enabled")
            .and_then(|value| value.as_bool())
            .unwrap_or(true),
        refreshable: is_refreshable(&dir),
        updated_at_ms: file_modified_ms(&dir.join("SKILL.md")),
        file_count: fs::read_dir(&dir)
            .map(|list| list.flatten().count())
            .unwrap_or(0),
    })
}

/// 读一个 skill 的完整信息。
/// 写一个 skill 里的文件（不存在就建）。
///
/// 相对路径必须是干净的 —— 不许 `..`、不许绝对路径、不许跑出 skill 目录。
pub fn skills_write_file(
    paths: &Paths,
    name: &str,
    rel: &str,
    content: &[u8],
) -> Result<(), String> {
    let dir = paths.skills_root().join(sanitize_skill_name(name));
    if !dir.is_dir() {
        return Err(format!("找不到 skill：{name}"));
    }
    let target = resolve_inside(&dir, rel)?;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
    }
    std::fs::write(&target, content).map_err(|e| format!("写入失败：{e}"))?;
    Ok(())
}

/// 读一个 skill 里的文件。
pub fn skills_read_file(
    paths: &Paths,
    name: &str,
    rel: &str,
) -> Result<String, String> {
    let dir = paths.skills_root().join(sanitize_skill_name(name));
    if !dir.is_dir() {
        return Err(format!("找不到 skill：{name}"));
    }
    let target = resolve_inside(&dir, rel)?;
    std::fs::read_to_string(&target).map_err(|e| format!("读取失败：{e}"))
}

/// 删一个 skill 里的文件。
pub fn skills_delete_file(paths: &Paths, name: &str, rel: &str) -> Result<(), String> {
    let dir = paths.skills_root().join(sanitize_skill_name(name));
    if !dir.is_dir() {
        return Err(format!("找不到 skill：{name}"));
    }
    if is_skill_md(rel) {
        return Err("不能删 SKILL.md —— 删整个 skill 用 `agentspace skill delete`。".to_string());
    }
    let target = resolve_inside(&dir, rel)?;
    std::fs::remove_file(&target).map_err(|e| format!("删除失败：{e}"))
}

/// 把相对路径解析成 skill 目录内的绝对路径。
///
/// 挡掉路径穿越：`..`、绝对路径、盘符。
fn resolve_inside(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let trimmed = rel.trim().replace('\\', "/");
    if trimmed.is_empty() {
        return Err("路径不能为空".to_string());
    }
    if trimmed.starts_with('/') || trimmed.contains(':') {
        return Err(format!("路径必须是 skill 目录内的相对路径：{rel}"));
    }
    if trimmed
        .split('/')
        .any(|segment| segment == ".." || segment.is_empty())
    {
        return Err(format!("路径里不能有 `..`：{rel}"));
    }
    Ok(root.join(trimmed))
}

pub fn skills_read(paths: &Paths, name: String) -> Result<SkillDetail, String> {
    let dir = paths.skills_root().join(sanitize_skill_name(&name));
    let skill_md = dir.join("SKILL.md");
    if !skill_md.is_file() {
        return Err(format!("找不到 skill：{name}"));
    }
    let raw = fs::read_to_string(&skill_md).map_err(|e| format!("读取 SKILL.md 失败：{e}"))?;
    let (frontmatter, body) = parse_frontmatter(&raw);
    let meta = read_meta(&dir);

    let mut files: Vec<SkillFileInfo> = Vec::new();
    let mut total_size = 0u64;
    let mut stack = vec![dir.clone()];
    while let Some(current) = stack.pop() {
        let Ok(entries) = fs::read_dir(&current) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let file_name = entry.file_name().to_string_lossy().to_string();
            let Ok(file_meta) = entry.metadata() else { continue };
            if file_meta.is_dir() {
                if file_name == ".git" || file_name == "node_modules" {
                    continue;
                }
                stack.push(path);
                continue;
            }
            let rel = path
                .strip_prefix(&dir)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            total_size += file_meta.len();
            files.push(SkillFileInfo {
                rel,
                size: file_meta.len(),
            });
        }
    }
    files.sort_by(|a, b| a.rel.cmp(&b.rel));

    Ok(SkillDetail {
        name: {
            let declared = fm_get(&frontmatter, "name");
            if declared.is_empty() {
                name.clone()
            } else {
                declared
            }
        },
        description: fm_get(&frontmatter, "description"),
        path: dir.to_string_lossy().to_string(),
        source: meta
            .get("source")
            .and_then(|value| value.as_str())
            .unwrap_or("manual")
            .to_string(),
        enabled: meta
            .get("enabled")
            .and_then(|value| value.as_bool())
            .unwrap_or(true),
        content: body,
        frontmatter: frontmatter.unwrap_or_default(),
        files,
        total_size,
        updated_at_ms: file_modified_ms(&skill_md),
    })
}

/// 重建 SKILL.md：写回 frontmatter 的 name / description，正文用给定内容。
fn render_skill_md(
    raw: &str,
    name: &str,
    description: Option<&str>,
    content: Option<&str>,
) -> String {
    let (_, body) = parse_frontmatter(raw);

    // frontmatter 是 YAML —— 不能按 key-value 文本重建。
    // 重建会把多行块标量（`description: |`）压成一行、内容丢掉，
    // 还会剥掉引号 —— 值里的 `: ` 就成了 YAML 嵌套映射，解析直接报错。
    //
    // 所以只做「最小改动」：整段保留，只替换 name / description 那两行。
    let fm_text = patch_frontmatter(&fm_text_of(raw), name, description);
    let text = match content {
        Some(value) => value.to_string(),
        None => body,
    };

    let mut out = String::from("---\n");
    out.push_str(&fm_text);
    // fm_text 末尾不一定有换行 —— 不补的话会跟结束的 `---` 粘成一行
    if !fm_text.is_empty() && !fm_text.ends_with('\n') {
        out.push('\n');
    }
    out.push_str("---\n\n");
    if !text.trim().is_empty() {
        out.push_str(text.trim_start());
        if !out.ends_with('\n') {
            out.push('\n');
        }
    }
    out
}

/// 取出 frontmatter 段（不含首尾的 `---`）。
fn fm_text_of(raw: &str) -> String {
    let text = raw.strip_prefix('\u{feff}').unwrap_or(raw);
    let mut lines = text.lines();
    match lines.next() {
        Some(first) if first.trim() == "---" => {}
        _ => return String::new(),
    }
    let mut out: Vec<&str> = Vec::new();
    for line in lines {
        if line.trim() == "---" {
            break;
        }
        out.push(line);
    }
    out.join("\n")
}

/// 在 frontmatter 段里替换 name / description，其余原样保留。
///
/// `description` 是 `None` = 不动描述那几行。
/// `Some(空串)` = 删掉描述。
///
/// 只动那两行的值 —— 块标量的内容行、缩进、引号都别动。
fn patch_frontmatter(fm_text: &str, name: &str, description: Option<&str>) -> String {
    let lines: Vec<&str> = fm_text.lines().collect();
    let mut out: Vec<String> = Vec::with_capacity(lines.len());
    let mut i = 0usize;

    while i < lines.len() {
        let line = lines[i];
        let split = line.split_once(':');
        let key = split.map(|(k, _)| k.trim().to_string());
        let is_target = matches!(key.as_deref(), Some("name") | Some("description"));

        if !is_target {
            out.push(line.to_string());
            i += 1;
            continue;
        }
        let key = key.unwrap_or_default();
        let value = split
            .map(|(_, v)| v.trim().to_string())
            .unwrap_or_default();

        // 描述要改吗？
        let want_description = match (key.as_str(), description) {
            ("description", Some(value)) => Some(value.trim().to_string()),
            _ => None,
        };

        // 块标量（`|` / `>`）的内容在后面几行 —— 一起搬过去
        let is_block = value == "|" || value == ">";
        if is_block {
            out.push(format!("{key}: {value}"));
            i += 1;
            let mut content: Vec<&str> = Vec::new();
            while i < lines.len() {
                let next = lines[i];
                // 块标量的内容是缩进的；遇到非缩进行就结束
                if next.trim().is_empty() || next.starts_with(' ') || next.starts_with('\t') {
                    content.push(next);
                    i += 1;
                } else {
                    break;
                }
            }
            match want_description {
                Some(text) => {
                    // 换掉块的内容（第一行缩进，其余原样）
                    out.push(format!("  {text}"));
                    for item in content.iter().skip(1) {
                        out.push((*item).to_string());
                    }
                }
                None => {
                    // 不动 → 整块原样
                    out.extend(content.iter().map(|item| (*item).to_string()));
                }
            }
            continue;
        }

        // 普通单行值 —— 要改就改，不改就原样
        match key.as_str() {
            "name" => out.push(format!("{key}: {name}")),
            "description" => match want_description {
                // 描述清空 → 整行去掉
                Some(value) if value.is_empty() => {}
                Some(value) => out.push(format!("{key}: {}", yaml_scalar(&value))),
                None => out.push(line.to_string()),
            },
            _ => out.push(line.to_string()),
        }
        i += 1;
    }

    // 目标 key 原本不存在 → 补上
    let mut text = out.join("\n");
    if !text.lines().any(|line| line.starts_with("name:")) {
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str(&format!("name: {name}\n"));
    }
    if let Some(value) = description {
        let value = value.trim();
        if !value.is_empty() && !text.lines().any(|line| line.starts_with("description:")) {
            text.push_str(&format!("description: {}\n", yaml_scalar(value)));
        }
    }
    text
}

/// 把值渲染成安全的 YAML 标量。
///
/// 值里有 `: `、`#`、换行时必须加引号 —— 否则 YAML 会把它当映射或注释。
fn yaml_scalar(value: &str) -> String {
    let needs_quote = value.contains(": ")
        || value.contains(" #")
        || value.starts_with('#')
        || value.starts_with('"')
        || value.ends_with('"')
        || value.contains('\n')
        || value.contains('\r');
    if needs_quote {
        let escaped = value
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', " ")
            .replace('\r', " ");
        format!("\"{escaped}\"")
    } else {
        value.to_string()
    }
}

/// 修改 skill：可改名、改描述、改正文。
pub fn skills_update(
    paths: &Paths,
    name: String,
    new_name: Option<String>,
    description: Option<String>,
    content: Option<String>,
) -> Result<SkillInfo, String> {
    let root = paths.skills_root();
    let dir = root.join(sanitize_skill_name(&name));
    let skill_md = dir.join("SKILL.md");
    if !skill_md.is_file() {
        return Err(format!("找不到 skill：{name}"));
    }

    let target_name = new_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .unwrap_or_else(|| name.clone());
    validate_skill_name(&target_name)?;
    let target_dir = root.join(sanitize_skill_name(&target_name));
    if target_dir != dir && target_dir.exists() {
        return Err(format!("已存在同名 skill：{target_name}"));
    }

    if let Some(description) = description.as_deref() {
        validate_description(description)?;
    }

    let raw = fs::read_to_string(&skill_md).map_err(|e| format!("读取 SKILL.md 失败：{e}"))?;
    // 描述没传 → 不动它（可能是块标量，重建会丢内容）
    let rendered = render_skill_md(
        &raw,
        &target_name,
        description.as_deref(),
        content.as_deref(),
    );
    fs::write(&skill_md, rendered.as_bytes()).map_err(|e| format!("写入 SKILL.md 失败：{e}"))?;

    // 改名：目录一起搬。
    if target_dir != dir {
        fs::rename(&dir, &target_dir).map_err(|e| format!("重命名 skill 失败：{e}"))?;
        // 改名会改绑它的智能体的引用 → 版本号在 rename_skill_ref 里递增
        // 智能体那边存的是相对路径引用：跟着改一下，
        // 不然改名后那些智能体的绑定就指空了。
        crate::agent::rename_skill_ref(
            paths,
            &relative_skill_ref(&dir),
            &relative_skill_ref(&target_dir),
        );
    }

    let meta = read_meta(&target_dir);
    let mut meta = meta;
    meta["name"] = json!(target_name);
    let _ = write_meta(&target_dir, &meta);

    // 描述以落盘后的 frontmatter 为准（可能没传 description）。
    let (written, _) = parse_frontmatter(&rendered);
    let written_description = fm_get(&written, "description");

    // 只改了内容（没改名）→ 绑着它的智能体版本 +1
    // 改名那条路 rename_skill_ref 已经递增过，不重复加。
    if target_dir == dir {
        crate::agent::bump_versions(paths, &[relative_skill_ref(&dir)], &[]);
    }

    Ok(SkillInfo {
        name: target_name.clone(),
        description: written_description,
        path: target_dir.to_string_lossy().to_string(),
        relative_path: relative_skill_ref(&target_dir),
        source: meta
            .get("source")
            .and_then(|value| value.as_str())
            .unwrap_or("manual")
            .to_string(),
        enabled: meta
            .get("enabled")
            .and_then(|value| value.as_bool())
            .unwrap_or(true),
        refreshable: is_refreshable(&target_dir),
        updated_at_ms: file_modified_ms(&target_dir.join("SKILL.md")),
        file_count: fs::read_dir(&target_dir)
            .map(|list| list.flatten().count())
            .unwrap_or(0),
    })
}

/// 创建副本：复制整个目录，并把 frontmatter 的 name 改成新名字。
pub fn skills_duplicate(paths: &Paths, name: String, new_name: String) -> Result<SkillInfo, String> {
    let root = paths.skills_root();
    let dir = root.join(sanitize_skill_name(&name));
    let skill_md = dir.join("SKILL.md");
    if !skill_md.is_file() {
        return Err(format!("找不到 skill：{name}"));
    }
    let new_name = validate_skill_name(&new_name)?;
    let target_dir = root.join(sanitize_skill_name(&new_name));
    if target_dir.exists() {
        return Err(format!("已存在同名 skill：{new_name}"));
    }

    copy_dir(&dir, &target_dir)?;
    // 副本的 frontmatter 要换成新名字（描述原样保留）。
    let raw = fs::read_to_string(target_dir.join("SKILL.md")).unwrap_or_default();
    let (frontmatter, _) = parse_frontmatter(&raw);
    let description = fm_get(&frontmatter, "description");
    let rendered = render_skill_md(&raw, &new_name, None, None);
    fs::write(target_dir.join("SKILL.md"), rendered.as_bytes())
        .map_err(|e| format!("写入 SKILL.md 失败：{e}"))?;

    // sidecar 重新生成：副本的来源是「复制」。
    let meta = json!({ "source": "duplicate", "name": new_name, "enabled": true });
    let _ = fs::write(
        target_dir.join(SOURCE_FILE),
        serde_json::to_vec_pretty(&meta).unwrap_or_default(),
    );

    Ok(SkillInfo {
        name: new_name.clone(),
        description,
        path: target_dir.to_string_lossy().to_string(),
        relative_path: relative_skill_ref(&target_dir),
        source: "duplicate".to_string(),
        enabled: true,
        refreshable: false,
        updated_at_ms: file_modified_ms(&target_dir.join("SKILL.md")),
        file_count: fs::read_dir(&target_dir)
            .map(|list| list.flatten().count())
            .unwrap_or(0),
    })
}

/// 用新的文件集覆盖工作区里已有的 skill。
///
/// 目录名与启用状态保持不变；SKILL.md 的 frontmatter 统一成本地名字 + 新描述。
fn overwrite_skill_files(
    dir: &Path,
    name: &str,
    _description: &str,
    files: Vec<SkillFile>,
) -> Result<(), String> {
    // 先清掉旧文件（sidecar 留着，它记的是启用状态与来源）。
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let file_name = entry.file_name().to_string_lossy().to_string();
            if file_name == SOURCE_FILE {
                continue;
            }
            let path = entry.path();
            if path.is_dir() {
                let _ = fs::remove_dir_all(&path);
            } else {
                let _ = fs::remove_file(&path);
            }
        }
    }

    for file in &files {
        let rel = file.rel.replace('\\', "/");
        if rel.split('/').any(|seg| seg == ".." || seg.is_empty()) {
            continue;
        }
        let target = dir.join(rel.replace('/', "\\"));
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
        }
        fs::write(&target, &file.data).map_err(|e| format!("写入 {} 失败：{e}", target.display()))?;
    }

    // frontmatter 统一：名字用本地的。
    //
    // 描述**不动** —— 源文件里的描述可能是块标量（`description: |`），
    // 解析器只能拿到 `|` 而拿不到内容，重建会把内容丢掉。
    // 源文件已经写好的 SKILL.md 就是对的。
    let skill_md = dir.join("SKILL.md");
    if skill_md.is_file() {
        let raw = fs::read_to_string(&skill_md).unwrap_or_default();
        let rendered = render_skill_md(&raw, name, None, None);
        fs::write(&skill_md, rendered.as_bytes()).map_err(|e| format!("写入 SKILL.md 失败：{e}"))?;
    }
    Ok(())
}

/// 递归复制目录（跳过 sidecar，副本会重新生成）。
fn copy_dir(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|e| format!("创建目录失败：{e}"))?;
    let entries = fs::read_dir(from).map_err(|e| format!("读取目录失败：{e}"))?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name == SOURCE_FILE {
            continue;
        }
        let path = entry.path();
        let target = to.join(&name);
        if path.is_dir() {
            copy_dir(&path, &target)?;
        } else {
            fs::copy(&path, &target).map_err(|e| format!("复制文件失败：{e}"))?;
        }
    }
    Ok(())
}


// ---------------------------------------------------------------- helpers

fn looks_like_html(text: &str) -> bool {
    let head = text.trim_start().to_lowercase();
    head.starts_with("<!doctype html") || head.starts_with("<html")
}

/// 把用户给的网址翻译成若干个「可能能拿到 SKILL.md」的候选地址。
fn url_candidates(raw: &str) -> Vec<String> {
    let parsed = match url::Url::parse(raw) {
        Ok(url) => url,
        Err(_) => return vec![raw.to_string()],
    };
    let host = parsed.host_str().unwrap_or("").to_lowercase();
    let segments: Vec<&str> = parsed
        .path_segments()
        .map(|parts| parts.collect())
        .unwrap_or_default();

    let mut candidates: Vec<String> = Vec::new();

    // GitHub 仓库 / 目录：转成 raw 地址。
    if host == "github.com" || host == "www.github.com" {
        if let (Some(owner), Some(repo)) = (segments.first(), segments.get(1)) {
            let mut rest: Vec<&str> = segments[2..].to_vec();
            let mut branch = "main".to_string();
            if rest.first().map(|s| *s == "tree").unwrap_or(false) {
                rest.remove(0);
                if !rest.is_empty() {
                    branch = rest.remove(0).to_string();
                }
            }
            let mut prefix = format!("https://raw.githubusercontent.com/{owner}/{repo}/{branch}");
            for segment in &rest {
                prefix.push('/');
                prefix.push_str(segment);
            }
            candidates.push(format!("{prefix}/SKILL.md"));
            candidates.push(format!("{prefix}/skill.md"));
            if branch == "main" {
                let master = if rest.is_empty() {
                    format!("https://raw.githubusercontent.com/{owner}/{repo}/master/SKILL.md")
                } else {
                    format!(
                        "https://raw.githubusercontent.com/{owner}/{repo}/master/{}/SKILL.md",
                        rest.join("/")
                    )
                };
                candidates.push(master);
            }
        }
    }

    // skills.sh 的 skill 页面背后就是一个 GitHub 仓库。
    if host == "skills.sh" || host == "www.skills.sh" {
        if let (Some(owner), Some(repo)) = (segments.first(), segments.get(1)) {
            let sub = segments.get(2).copied().unwrap_or("");
            let path = if sub.is_empty() {
                String::new()
            } else {
                format!("/{sub}")
            };
            candidates.push(format!(
                "https://raw.githubusercontent.com/{owner}/{repo}/main{path}/SKILL.md"
            ));
            candidates.push(format!(
                "https://raw.githubusercontent.com/{owner}/{repo}/master{path}/SKILL.md"
            ));
        }
    }

    // raw 地址：补 SKILL.md。
    if host == "raw.githubusercontent.com" {
        if !parsed.path().to_lowercase().ends_with(".md") {
            candidates.push(format!("{}/SKILL.md", raw.trim_end_matches('/')));
        }
    }

    // 直接的 md 链接或原始地址。
    candidates.push(raw.to_string());

    let mut unique: Vec<String> = Vec::new();
    for candidate in candidates {
        if !unique.contains(&candidate) {
            unique.push(candidate);
        }
    }
    unique
}

/// 从网址里猜一个 skill 名。
fn name_from_url(raw: &str) -> String {
    let parsed = match url::Url::parse(raw) {
        Ok(url) => url,
        Err(_) => return "skill".to_string(),
    };
    let segments: Vec<&str> = parsed
        .path_segments()
        .map(|parts| parts.collect())
        .unwrap_or_default();
    let candidate = segments
        .iter()
        .rev()
        .find(|segment| {
            let value = **segment;
            !value.is_empty()
                && !value.eq_ignore_ascii_case("SKILL.md")
                && !value.eq_ignore_ascii_case("skill.md")
                && !value.eq_ignore_ascii_case("main")
                && !value.eq_ignore_ascii_case("master")
                && !value.eq_ignore_ascii_case("skills")
        })
        .copied()
        .unwrap_or("skill");
    let cleaned = candidate
        .trim_end_matches(".md")
        .trim_end_matches(".zip")
        .trim_end_matches(".skill");
    sanitize_skill_name(cleaned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_frontmatter_scalars() {
        let (frontmatter, body) = parse_frontmatter("---\nname: demo\ndescription: 一个示例\n---\n\n正文\n");
        let frontmatter = frontmatter.expect("应该有 frontmatter");
        assert_eq!(fm_get(&Some(frontmatter), "name"), "demo");
        assert_eq!(body.trim(), "正文");
    }

    #[test]
    fn keeps_colon_inside_value() {
        let (frontmatter, _) = parse_frontmatter("---\ndescription: 支持 http://a.b\n---\n");
        assert_eq!(
            fm_get(&frontmatter, "description"),
            "支持 http://a.b"
        );
    }

    #[test]
    fn without_frontmatter_returns_raw_body() {
        let (frontmatter, body) = parse_frontmatter("# 标题\n");
        assert!(frontmatter.is_none());
        assert_eq!(body, "# 标题\n");
    }

    #[test]
    fn unclosed_frontmatter_is_ignored() {
        let (frontmatter, body) = parse_frontmatter("---\nname: demo\n");
        assert!(frontmatter.is_none());
        assert!(body.contains("name: demo"));
    }

    #[test]
    fn description_limit_matches_spec() {
        // 规范上限 1024 字符
        assert!(validate_description(&"a".repeat(1024)).is_ok());
        assert!(validate_description(&"a".repeat(1025)).is_err());
        // 导入路径是截断而不是报错
        assert_eq!(truncate_description(&"a".repeat(1500)).len(), 1024);
    }

    #[test]
    fn name_limit_matches_spec() {
        // 规范上限 64 字符
        assert!(validate_skill_name(&"a".repeat(64)).is_ok());
        assert!(validate_skill_name(&"a".repeat(65)).is_err());
    }

    #[test]
    fn sanitizes_skill_name() {
        assert_eq!(sanitize_skill_name("  市场报告  "), "市场报告");
        assert_eq!(sanitize_skill_name("a/b:c"), "a-b-c");
        assert_eq!(sanitize_skill_name("***"), "skill");
    }

    #[test]
    fn detects_skill_md_case_insensitively() {
        assert!(is_skill_md("SKILL.md"));
        assert!(is_skill_md("demo/skill.md"));
        assert!(!is_skill_md("demo/README.md"));
    }

    #[test]
    fn maps_github_repo_to_raw_url() {
        let candidates = url_candidates("https://github.com/owner/repo");
        assert_eq!(
            candidates[0],
            "https://raw.githubusercontent.com/owner/repo/main/SKILL.md"
        );
        assert!(candidates
            .iter()
            .any(|url| url.contains("/owner/repo/master/SKILL.md")));
    }

    #[test]
    fn maps_github_subdirectory_to_raw_url() {
        let candidates = url_candidates("https://github.com/owner/repo/tree/dev/skills/demo");
        assert_eq!(
            candidates[0],
            "https://raw.githubusercontent.com/owner/repo/dev/skills/demo/SKILL.md"
        );
    }

    #[test]
    fn guesses_name_from_url() {
        assert_eq!(name_from_url("https://example.com/a/demo"), "demo");
        assert_eq!(
            name_from_url("https://raw.githubusercontent.com/o/r/main/SKILL.md"),
            "r"
        );
    }
}

#[cfg(test)]
mod frontmatter_tests {
    use super::*;

    /// 块标量的内容要能读出来 —— 界面上显示的描述不能是 `|`
    #[test]
    fn block_scalar_content_is_read() {
        let raw = "---\nname: ctx\ndescription: |\n  Search indexed content.\n  Trigger: /ctx\n---\n\nbody\n";
        let (fm, _) = parse_frontmatter(raw);
        let description = fm_get(&fm, "description");
        assert!(description.contains("Search indexed content."), "{description}");
        assert!(!description.contains('|'), "{description}");
    }

    /// 折叠标量同理
    #[test]
    fn folded_scalar_content_is_read() {
        let raw = "---\nname: y\ndescription: >\n  folded text\n  more text\n---\n";
        let (fm, _) = parse_frontmatter(raw);
        let description = fm_get(&fm, "description");
        assert!(description.contains("folded text"), "{description}");
        assert!(description.contains("more text"), "{description}");
    }

    /// 带引号的值里的 `: ` 不能被当映射
    #[test]
    fn quoted_colon_is_read_whole() {
        let raw = "---\nname: p\ndescription: \"Lazy mode: the smallest change\"\n---\n";
        let (fm, _) = parse_frontmatter(raw);
        assert_eq!(fm_get(&fm, "description"), "Lazy mode: the smallest change");
    }

    /// 没引号的 `: ` 在 yaml 里本来就是嵌套映射 —— 不该把整段当描述
    #[test]
    fn unquoted_colon_is_a_nested_mapping() {
        let raw = "---\nname: p\ndescription: Lazy mode: the smallest\n---\n";
        let (fm, _) = parse_frontmatter(raw);
        assert!(fm.is_none(), "{fm:?}");
    }

    /// 普通的单行值照常
    #[test]
    fn plain_scalar_is_read() {
        let raw = "---\nname: demo\ndescription: 一个示例\n---\n\n正文\n";
        let (fm, body) = parse_frontmatter(raw);
        assert_eq!(fm_get(&fm, "name"), "demo");
        assert_eq!(fm_get(&fm, "description"), "一个示例");
        assert_eq!(body.trim(), "正文");
    }

    /// frontmatter 之后的内容不该被当成 frontmatter 的一部分
    #[test]
    fn body_is_not_part_of_frontmatter() {
        let raw = "---\nname: n\n---\n\n# 标题\n\n正文里有: 冒号\n";
        let (fm, body) = parse_frontmatter(raw);
        assert_eq!(fm_get(&fm, "name"), "n");
        assert!(body.contains("正文里有: 冒号"), "{body}");
    }

    /// 块标量的内容不能被压成一行、丢掉
    #[test]
    fn patch_keeps_block_scalar_content() {
        let raw = "---\nname: ctx\ndescription: |\n  Search indexed content.\n  Trigger: /ctx\nuser-invocable: true\n---\n\n# Body\n";
        let fm = fm_text_of(raw);
        let patched = patch_frontmatter(&fm, "ctx", None);
        assert!(patched.contains("  Search indexed content."), "{patched}");
        assert!(patched.contains("user-invocable: true"), "{patched}");
    }

    /// 值里有 ": " 的必须加引号，否则 yaml 当嵌套映射
    #[test]
    fn patch_quotes_description_with_colon() {
        let fm = "name: ponytail";
        let patched = patch_frontmatter(fm, "ponytail", Some("Lazy dev mode: the smallest change"));
        assert!(
            patched.contains("description: \"Lazy dev mode: the smallest change\""),
            "{patched}"
        );
    }

    /// 已有的引号不能被剥掉
    #[test]
    fn patch_does_not_strip_quotes() {
        let raw = "---\nname: x\ndescription: \"has: colon\"\n---\n";
        let patched = patch_frontmatter(&fm_text_of(raw), "x", None);
        assert!(patched.contains("\"has: colon\""), "{patched}");
    }

    /// 折叠标量（`>`）也要保住
    #[test]
    fn patch_keeps_folded_scalar() {
        let raw = "---\nname: y\ndescription: >\n  folded text here\n  more text\n---\n";
        let patched = patch_frontmatter(&fm_text_of(raw), "y", None);
        assert!(patched.contains("description: >"), "{patched}");
        assert!(patched.contains("  folded text here"), "{patched}");
    }

    /// 改描述时替换块的内容，其余保留
    #[test]
    fn patch_replaces_block_content_when_description_changes() {
        let raw = "---\nname: z\ndescription: |\n  old text\nother: keep\n---\n";
        let patched = patch_frontmatter(&fm_text_of(raw), "z", Some("new text"));
        assert!(patched.contains("  new text"), "{patched}");
        assert!(patched.contains("other: keep"), "{patched}");
        assert!(!patched.contains("old text"), "{patched}");
    }

    #[test]
    fn yaml_scalar_quotes_only_when_needed() {
        assert_eq!(yaml_scalar("plain text"), "plain text");
        assert_eq!(yaml_scalar("has: colon"), "\"has: colon\"");
        assert_eq!(yaml_scalar("starts with #"), "\"starts with #\"");
    }

    /// 端到端：把一个真实的块标量 skill 走一遍渲染，结果必须还是合法 yaml
    #[test]
    fn rendered_frontmatter_stays_valid() {
        let raw = "---\nname: ctx\ndescription: |\n  line one\n  line two\n---\n\nbody\n";
        let rendered = render_skill_md(raw, "ctx", None, None);
        let (fm, _) = parse_frontmatter(&rendered);
        assert!(fm.is_some());
        // 块标量还在
        assert!(rendered.contains("description: |"), "{rendered}");
        assert!(rendered.contains("  line one"), "{rendered}");
    }
}
