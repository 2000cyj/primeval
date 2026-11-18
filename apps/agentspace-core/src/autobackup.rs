//! 自动备份与恢复。
//!
//! # 备份的是什么
//!
//! 一个 zip 包，跟「数据管理 › 导出」是同一套格式（`manifest.json` + 原文件），
//! 所以两者能互相用：这里备份的包，可以拿去数据管理里导入；反过来也是。
//!
//! 备份文件放在 `~/.agent-compose/backups/`，文件名带时间戳：
//! `agentspace-20261118-142535.zip`。
//!
//! # 为什么备份在应用数据目录里
//!
//! 它是**应用自己的数据** —— 跟智能体、Skill 那些放在一起。
//! 导出的包放到用户选的地方（那是给人搬家的），自动备份放这儿
//! （那是机器自己的历史，不该出现在用户的下载目录里）。

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::backup::{self, ExportSelection};
use crate::paths::Paths;
use crate::settings;

/// 备份文件的后缀。
const BACKUP_SUFFIX: &str = ".zip";
/// 备份文件名的前缀。
const BACKUP_PREFIX: &str = "agentspace-";

/// 一条备份记录。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    /// 文件名（界面里显示用）。
    pub file_name: String,
    /// 完整路径。
    pub path: String,
    /// 备份时间（epoch 毫秒）。
    pub created_at: u64,
    /// 文件大小（字节）。
    pub size: u64,
}

/// 备份设置（给界面用的）。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSettings {
    /// 自动备份间隔（小时）。`0` = 关闭。
    pub auto_backup_interval_hours: i64,
    /// 保留多少个。
    pub keep_count: usize,
    /// 可选的间隔（小时）。
    pub interval_options: Vec<i64>,
    /// 可选的保留数量。
    pub keep_options: Vec<usize>,
}

/// 恢复的结果。
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    /// 恢复了多少项。
    pub restored: usize,
    /// 因为冲突被跳过的（恢复时是**覆盖**，一般不会有）。
    pub skipped: usize,
    /// 失败的条目。
    pub failures: Vec<String>,
    /// 恢复**前**给当前数据做的安全备份文件名。
    ///
    /// 恢复的是覆盖操作 —— 万一这个包不对，可以拿它退回去。
    pub safety_backup: Option<String>,
}

/// 备份目录。
pub fn backups_dir(paths: &Paths) -> PathBuf {
    paths.root().join("backups")
}

/// 现在的 epoch 毫秒。
fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 生成备份文件名（带时间戳）。
fn backup_file_name(created_at: u64) -> String {
    let secs = created_at / 1000;
    // 自己算时间戳格式 —— 引 chrono 就为一个文件名不值当。
    let (year, month, day, hour, minute, second) = civil_from_secs(secs);
    format!(
        "{BACKUP_PREFIX}{year:04}{month:02}{day:02}-{hour:02}{minute:02}{second:02}{BACKUP_SUFFIX}"
    )
}

/// epoch 秒 → (年, 月, 日, 时, 分, 秒)，UTC。
///
/// 用 UTC 而不是本地时间：文件名只要**唯一且能排序**，时区无所谓 ——
/// 界面显示的时间是另算的（`created_at`）。
fn civil_from_secs(secs: u64) -> (u64, u64, u64, u64, u64, u64) {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let (hour, minute, second) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // 从 1970-01-01 起的天数 → 年月日
    let mut year = 1970i64;
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
    let mut month = 1i64;
    let mut day = 1i64;
    for (index, len) in month_days.iter().enumerate() {
        if remaining < *len as i64 {
            month = index as i64 + 1;
            day = remaining + 1;
            break;
        }
        remaining -= *len as i64;
    }
    (
        year as u64,
        month as u64,
        day as u64,
        hour,
        minute,
        second,
    )
}

/// 列出所有备份，新的在前。
pub fn list(paths: &Paths) -> Vec<BackupEntry> {
    let dir = backups_dir(paths);
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut list: Vec<BackupEntry> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let file_name = path.file_name()?.to_string_lossy().to_string();
            if !file_name.starts_with(BACKUP_PREFIX) || !file_name.ends_with(BACKUP_SUFFIX) {
                return None;
            }
            let metadata = entry.metadata().ok()?;
            let created_at = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            Some(BackupEntry {
                file_name,
                path: path.to_string_lossy().to_string(),
                created_at,
                size: metadata.len(),
            })
        })
        .collect();
    // 新的在前 —— 界面直接按这个顺序显示。
    list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    list
}

/// 立刻备份一次。
///
/// 返回新建的那条记录。
///
/// **先校验后发布** —— 跟 cc-switch 一个思路：
/// 导到临时文件 → 验一遍能不能读 → 才改名到最终位置。
/// 备份列表和保留清理只看得到最终路径，不会看到一个写了一半的包。
///
/// **发布不覆盖** —— 同一秒内建了两个也不会把前一个顶掉。
pub fn create(paths: &Paths, mcp_servers: &[serde_json::Value]) -> Result<BackupEntry, String> {
    let dir = backups_dir(paths);
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建备份目录失败：{e}"))?;

    let created_at = now_millis();
    let file_name = backup_file_name(created_at);
    // 临时名跟最终名不一样 —— 不会被列表当成一个备份。
    let temp_path = dir.join(format!(".{file_name}.tmp"));

    // 全都带上 —— 自动备份的意义就是「完整的快照」。
    let items = backup::inventory(paths, mcp_servers);
    let selection = ExportSelection {
        agent_ids: items.agents.iter().map(|item| item.id.clone()).collect(),
        skill_names: items.skills.iter().map(|item| item.name.clone()).collect(),
        mcp_server_ids: items.mcp_servers.iter().map(|item| item.id.clone()).collect(),
        extension_names: items.extensions.iter().map(|item| item.name.clone()).collect(),
        wiki_slugs: items.wiki_pages.iter().map(|item| item.slug.clone()).collect(),
    };

    let result = backup::export(paths, mcp_servers, &selection, &temp_path);
    // 导出失败 —— 把临时文件清掉，别在目录里留垃圾。
    if let Err(error) = result {
        let _ = std::fs::remove_file(&temp_path);
        return Err(error);
    }

    // 发布前验一下 —— 坏包不进备份目录。
    if let Err(error) = backup::validate_zip(&temp_path) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(format!("备份校验不通过，已丢弃：{error}"));
    }

    // 改名发布。目标已存在就换个名 —— 不覆盖已有的备份。
    let final_path = publish(&temp_path, &dir.join(&file_name))?;

    let size = std::fs::metadata(&final_path).map(|m| m.len()).unwrap_or(0);
    Ok(BackupEntry {
        file_name: final_path
            .file_name()
            .map(|v| v.to_string_lossy().to_string())
            .unwrap_or(file_name),
        path: final_path.to_string_lossy().to_string(),
        created_at,
        size,
    })
}

/// 把临时文件改名到最终位置。
///
/// **不覆盖** —— 目标已存在就加个后缀（同一秒建了两个的情况）。
fn publish(temp_path: &Path, target: &Path) -> Result<PathBuf, String> {
    for index in 0..100 {
        let candidate = if index == 0 {
            target.to_path_buf()
        } else {
            let stem = target
                .file_stem()
                .map(|v| v.to_string_lossy().to_string())
                .unwrap_or_default();
            let dir = target.parent().unwrap_or(Path::new("."));
            dir.join(format!("{stem}_{index}{BACKUP_SUFFIX}"))
        };
        if candidate.exists() {
            continue;
        }
        match std::fs::rename(temp_path, &candidate) {
            Ok(()) => return Ok(candidate),
            // 并发下被别人抢先了 —— 换下一个名字。
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("发布备份失败：{error}")),
        }
    }
    Err("发布备份失败：名字冲突了太多次".to_string())
}

/// 删掉一个备份。
pub fn remove(paths: &Paths, file_name: &str) -> Result<(), String> {
    let path = resolve_backup_path(paths, file_name)?;
    std::fs::remove_file(&path).map_err(|e| format!("删除备份失败：{e}"))
}

/// 用一个备份恢复数据。
///
/// **覆盖**现有的 —— 恢复就是这个意思。冲突项全传覆盖 key。
///
/// # 顺序很重要
///
/// 跟 cc-switch 一个思路 —— **先验包，再存底，最后才动数据**：
///
/// 1. **先校验**这个包能不能读。坏包直接拒 —— 现有数据一字节都不动。
/// 2. **先给当前数据做一份安全备份**。万一这个包不对，退回去有东西可退。
///    连安全备份都做不出来，就不恢复。
/// 3. 才是真正的导入。
pub fn restore(
    paths: &Paths,
    mcp_servers: &mut Vec<serde_json::Value>,
    file_name: &str,
    remote_defs: &[(String, serde_json::Value)],
) -> Result<RestoreResult, String> {
    let path = resolve_backup_path(paths, file_name)?;
    if !path.is_file() {
        return Err(format!("备份不存在：{file_name}"));
    }

    // ① 先验包 —— 坏包不许动现有数据。
    backup::validate_zip(&path)?;

    // ② 先存底 —— 恢复前的当前状态存一份。
    let safety = create(paths, mcp_servers)?;

    // 覆盖所有冲突项 —— key 的格式是「类别:标识」。
    let overwrite = all_overwrite_keys(paths, mcp_servers);
    let result = backup::import(
        paths,
        mcp_servers,
        &path,
        &overwrite,
        remote_defs,
        None,
    )?;

    let imported = &result.imported;
    Ok(RestoreResult {
        restored: imported.agents
            + imported.skills
            + imported.mcp_servers
            + imported.extensions
            + imported.wiki,
        skipped: result.skipped.agents
            + result.skipped.skills
            + result.skipped.mcp_servers
            + result.skipped.extensions
            + result.skipped.wiki,
        failures: result.failures,
        safety_backup: Some(safety.file_name),
    })
}

/// 本机所有条目的覆盖 key —— 恢复时全覆盖。
fn all_overwrite_keys(paths: &Paths, mcp_servers: &[serde_json::Value]) -> Vec<String> {
    let items = backup::inventory(paths, mcp_servers);
    let mut keys: Vec<String> = Vec::new();
    for agent in &items.agents {
        keys.push(format!("agent:{}", agent.id));
    }
    for skill in &items.skills {
        keys.push(format!("skill:{}", skill.name));
    }
    for server in &items.mcp_servers {
        keys.push(format!("mcpServer:{}", server.id));
    }
    for extension in &items.extensions {
        keys.push(format!("extension:{}", extension.name));
    }
    for page in &items.wiki_pages {
        keys.push(format!("wiki:{}", page.slug));
    }
    keys
}

/// 删掉超出保留数量的旧备份。返回删了几个。
///
/// `protected` 里的文件名**不会被删** —— 比如正在恢复的那个备份。
///
/// 保留数太小装不下「刚建的 + 正在恢复的」时，宁可暂时超出保留数，
/// 也不删掉恢复操作的两头。
pub fn prune(paths: &Paths, keep: usize, protected: &[String]) -> Result<usize, String> {
    if keep == 0 {
        return Ok(0);
    }
    let list = list(paths);
    if list.len() <= keep {
        return Ok(0);
    }
    let mut removed = 0;
    // list 是新的在前 —— 超出 keep 的那些就是最旧的。
    for entry in list.into_iter().skip(keep) {
        if protected.iter().any(|name| name == &entry.file_name) {
            continue;
        }
        if std::fs::remove_file(&entry.path).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

/// 到点了就备份一次。
///
/// 返回「有没有真的备份」（到点但出错了不算备份成功）。
///
/// **客户端关着的时候怎么办** —— 这里不备份（没进程就没定时器）。
/// 但**下次启动时**会补一次：这个函数只看「最新备份比间隔旧不旧」，
/// 关了多久都只补**一份**最新的快照，不会按错过的时间补一堆。
pub fn auto_backup_if_due(paths: &Paths, mcp_servers: &[serde_json::Value]) -> Result<bool, String> {
    let settings = settings::read(paths);
    let Some(interval) = settings::interval_millis(settings.auto_backup_interval_hours) else {
        return Ok(false);
    };
    let now = now_millis();

    // 最近一个备份的时间 —— 没备份过就当「从来没有」，立刻该备份一次。
    let last = list(paths)
        .first()
        .map(|entry| entry.created_at)
        .unwrap_or(0);
    if last != 0 && now.saturating_sub(last) < interval {
        return Ok(false);
    }

    let created = create(paths, mcp_servers)?;
    // 刚建的那个不能被自己清掉。
    prune(
        paths,
        settings.backup_keep_count,
        &[created.file_name.clone()],
    )?;
    Ok(true)
}

/// 读备份设置。
pub fn get_settings(paths: &Paths) -> BackupSettings {
    let settings = settings::read(paths);
    BackupSettings {
        auto_backup_interval_hours: settings.auto_backup_interval_hours,
        keep_count: settings.backup_keep_count,
        interval_options: settings::INTERVAL_OPTIONS.to_vec(),
        keep_options: settings::KEEP_OPTIONS.to_vec(),
    }
}

/// 改备份设置。
pub fn set_settings(
    paths: &Paths,
    auto_backup_interval_hours: Option<i64>,
    keep_count: Option<usize>,
) -> Result<BackupSettings, String> {
    if let Some(hours) = auto_backup_interval_hours {
        if hours != 0 && !settings::INTERVAL_OPTIONS.contains(&hours) {
            return Err(format!("不认识的自动备份间隔：{hours} 小时"));
        }
    }
    if let Some(count) = keep_count {
        if count == 0 || count > 1000 {
            return Err(format!("保留数量不合理：{count}"));
        }
    }
    settings::update(paths, |settings| {
        if let Some(hours) = auto_backup_interval_hours {
            settings.auto_backup_interval_hours = hours;
        }
        if let Some(count) = keep_count {
            settings.backup_keep_count = count;
        }
    })?;
    Ok(get_settings(paths))
}

/// 把用户给的文件名解析成备份目录里的路径。
///
/// **只认文件名，不认路径** —— 界面传的是文件名，
/// 而文件名是要拼到备份目录里的。带路径分隔符的（`../`）直接拒掉。
fn resolve_backup_path(paths: &Paths, file_name: &str) -> Result<PathBuf, String> {
    let name = Path::new(file_name)
        .file_name()
        .map(|v| v.to_string_lossy().to_string())
        .unwrap_or_default();
    if name.is_empty() || name != file_name {
        return Err("备份文件名不合法".to_string());
    }
    if !name.starts_with(BACKUP_PREFIX) || !name.ends_with(BACKUP_SUFFIX) {
        return Err("不是备份文件".to_string());
    }
    Ok(backups_dir(paths).join(name))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_paths(tag: &str) -> Paths {
        let dir = std::env::temp_dir().join(format!(
            "agentspace-autobackup-{tag}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".agent-compose")).unwrap();
        Paths::new(dir)
    }

    #[test]
    fn file_name_has_timestamp_and_is_sortable() {
        let name = backup_file_name(1_700_000_000_000);
        assert_eq!(name, "agentspace-20231114-221320.zip");
        // 按名字排序 == 按时间排序
        let earlier = backup_file_name(1_600_000_000_000);
        assert!(earlier < name);
    }

    #[test]
    fn list_is_empty_when_no_backups() {
        let paths = temp_paths("empty");
        assert!(list(&paths).is_empty());
        let _ = std::fs::remove_dir_all(paths.home());
    }

    #[test]
    fn list_ignores_other_files() {
        let paths = temp_paths("ignore");
        let dir = backups_dir(&paths);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("别的.txt"), "x").unwrap();
        std::fs::write(dir.join("agentspace-20231114-221320.zip"), "x").unwrap();
        let list = list(&paths);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].file_name, "agentspace-20231114-221320.zip");
        let _ = std::fs::remove_dir_all(paths.home());
    }

    #[test]
    fn resolve_rejects_paths_outside_backup_dir() {
        let paths = temp_paths("resolve");
        // 带路径的、目录穿越的，都得拒掉
        assert!(resolve_backup_path(&paths, "../evil.zip").is_err());
        assert!(resolve_backup_path(&paths, "sub/agentspace-x.zip").is_err());
        assert!(resolve_backup_path(&paths, "not-a-backup.txt").is_err());
        assert!(resolve_backup_path(&paths, "agentspace-20231114-221320.zip").is_ok());
        let _ = std::fs::remove_dir_all(paths.home());
    }

    #[test]
    fn prune_keeps_the_newest() {
        let paths = temp_paths("prune");
        let dir = backups_dir(&paths);
        std::fs::create_dir_all(&dir).unwrap();
        // 造三个「不同时刻」的备份
        for (index, name) in [
            "agentspace-20231114-221320.zip",
            "agentspace-20231115-221320.zip",
            "agentspace-20231116-221320.zip",
        ]
        .iter()
        .enumerate()
        {
            std::fs::write(dir.join(name), "x").unwrap();
            // 修改时间 —— 决定排序
            let _ = set_modified(&dir.join(name), 1_700_000_000 + index as u64);
        }
        let removed = prune(&paths, 2, &[]).unwrap();
        assert_eq!(removed, 1);
        assert_eq!(list(&paths).len(), 2);
        let _ = std::fs::remove_dir_all(paths.home());
    }

    #[test]
    fn prune_never_deletes_a_protected_backup() {
        let paths = temp_paths("prune-protected");
        let dir = backups_dir(&paths);
        std::fs::create_dir_all(&dir).unwrap();
        for (index, name) in [
            "agentspace-20231114-221320.zip",
            "agentspace-20231115-221320.zip",
            "agentspace-20231116-221320.zip",
        ]
        .iter()
        .enumerate()
        {
            std::fs::write(dir.join(name), "x").unwrap();
            let _ = set_modified(&dir.join(name), 1_700_000_000 + index as u64);
        }
        // 最旧的那个正在被恢复 —— 不能删。
        let protected = vec!["agentspace-20231114-221320.zip".to_string()];
        let removed = prune(&paths, 1, &protected).unwrap();
        assert_eq!(removed, 1);
        // 保留数装不下 —— 宁可超出，也不删掉恢复的那份。
        assert_eq!(list(&paths).len(), 2);
        assert!(dir.join("agentspace-20231114-221320.zip").exists());
        let _ = std::fs::remove_dir_all(paths.home());
    }

    #[test]
    fn publish_does_not_overwrite_an_existing_backup() {
        let paths = temp_paths("publish");
        let dir = backups_dir(&paths);
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("agentspace-20231114-221320.zip");
        std::fs::write(&target, "老的").unwrap();

        let temp = dir.join(".tmp.zip");
        std::fs::write(&temp, "新的").unwrap();

        let published = publish(&temp, &target).unwrap();
        // 老的没被动。
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "老的");
        // 新的换了个名发布。
        assert_ne!(published, target);
        assert_eq!(std::fs::read_to_string(&published).unwrap(), "新的");
        let _ = std::fs::remove_dir_all(paths.home());
    }

    #[test]
    fn auto_backup_skips_when_the_latest_is_still_fresh() {
        let paths = temp_paths("fresh");
        let dir = backups_dir(&paths);
        std::fs::create_dir_all(&dir).unwrap();
        // 刚建过一个 —— 间隔 24 小时，不该再备。
        std::fs::write(dir.join("agentspace-20231114-221320.zip"), "x").unwrap();
        settings::update(&paths, |settings| {
            settings.auto_backup_interval_hours = 24;
        })
        .unwrap();
        assert!(!auto_backup_if_due(&paths, &[]).unwrap());
        let _ = std::fs::remove_dir_all(paths.home());
    }

    #[test]
    fn auto_backup_is_off_when_interval_is_zero() {
        let paths = temp_paths("off");
        settings::update(&paths, |settings| {
            settings.auto_backup_interval_hours = 0;
        })
        .unwrap();
        assert!(!auto_backup_if_due(&paths, &[]).unwrap());
        // 关着的时侯不该建出备份来。
        assert!(list(&paths).is_empty());
        let _ = std::fs::remove_dir_all(paths.home());
    }

    #[test]
    fn set_settings_rejects_unknown_interval() {
        let paths = temp_paths("bad-interval");
        assert!(set_settings(&paths, Some(7), None).is_err());
        // 关（0）是合法的。
        assert!(set_settings(&paths, Some(0), None).is_ok());
        let _ = std::fs::remove_dir_all(paths.home());
    }

    /// 设置文件的修改时间（测排序用）。
    fn set_modified(path: &Path, secs: u64) -> std::io::Result<()> {
        let file = std::fs::File::options().write(true).open(path)?;
        let time = std::fs::FileTimes::new()
            .set_modified(std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(secs));
        file.set_times(time)
    }
}
