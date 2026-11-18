//! 应用设置（`~/.agent-compose/settings.json`）。
//!
//! # 为什么单独一个模块
//!
//! 这个文件以前归代理设置管（`proxy.rs` 里的 `ProxySettings`）。
//! 加上备份相关的设置之后，两边都要读写同一个文件 ——
//! 谁写都会把对方那份**整个覆盖掉**。
//!
//! 所以把它提到独立模块：文件归这儿管，各处只管自己那几个字段。
//!
//! 新增字段时记得给默认值 —— 老的 `settings.json` 没有这些字段，
//! 读出来得是默认值而不是报错。

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::paths::Paths;

/// 设置文件名。
const SETTINGS_FILE: &str = "settings.json";

/// 自动备份间隔的下拉选项（小时）。
///
/// 对齐 cc-switch 的选项：关闭 / 6 / 12 / 24 / 48 小时 / 7 天。
pub const INTERVAL_OPTIONS: &[i64] = &[6, 12, 24, 48, 168];

/// 可选的保留数量。
pub const KEEP_OPTIONS: &[usize] = &[3, 5, 10, 15, 20, 30, 50];

/// 间隔对应的时长（毫秒）。`0` = 关闭 —— 返回 `None`。
pub fn interval_millis(hours: i64) -> Option<u64> {
    if hours <= 0 {
        return None;
    }
    Some(hours as u64 * 60 * 60 * 1000)
}

/// 落盘的设置。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppSettings {
    /// 全局代理地址。`None` = 从未设置；`Some("")` = 强制直连。
    pub global_proxy_url: Option<String>,
    /// 自动备份间隔（小时）。`0` = 关闭。
    pub auto_backup_interval_hours: i64,
    /// 保留多少个自动备份（超出的从旧到新删掉）。
    pub backup_keep_count: usize,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            global_proxy_url: None,
            auto_backup_interval_hours: 24,
            backup_keep_count: 10,
        }
    }
}

/// 设置文件路径。
fn settings_path(paths: &Paths) -> PathBuf {
    paths.root().join(SETTINGS_FILE)
}

/// 读设置。文件不存在或坏了都当默认值 —— 别让一个坏 JSON 让界面打不开。
pub fn read(paths: &Paths) -> AppSettings {
    let Ok(raw) = std::fs::read_to_string(settings_path(paths)) else {
        return AppSettings::default();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

/// 写设置。
pub fn write(paths: &Paths, settings: &AppSettings) -> Result<(), String> {
    let path = settings_path(paths);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
    }
    let raw = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, raw).map_err(|e| format!("写入设置失败：{e}"))
}

/// 改一个字段再写回去。
///
/// 只改自己关心的字段 —— 别的字段原样保留（设置文件是共享的）。
pub fn update<F>(paths: &Paths, change: F) -> Result<AppSettings, String>
where
    F: FnOnce(&mut AppSettings),
{
    let mut settings = read(paths);
    change(&mut settings);
    write(paths, &settings)?;
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_paths(tag: &str) -> Paths {
        let dir = std::env::temp_dir().join(format!(
            "agentspace-settings-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir.join(".agent-compose")).unwrap();
        Paths::new(dir)
    }

    #[test]
    fn defaults_are_sane() {
        let settings = AppSettings::default();
        assert_eq!(settings.auto_backup_interval_hours, 24);
        assert_eq!(settings.backup_keep_count, 10);
        assert!(settings.global_proxy_url.is_none());
    }

    #[test]
    fn read_missing_file_gives_defaults() {
        let paths = temp_paths("missing");
        let settings = read(&paths);
        assert_eq!(settings.auto_backup_interval_hours, 24);
        let _ = std::fs::remove_dir_all(paths.home());
    }

    #[test]
    fn write_then_read_round_trips() {
        let paths = temp_paths("roundtrip");
        let mut settings = read(&paths);
        settings.auto_backup_interval_hours = 168;
        settings.backup_keep_count = 3;
        settings.global_proxy_url = Some("http://127.0.0.1:7897".to_string());
        write(&paths, &settings).unwrap();

        let loaded = read(&paths);
        assert_eq!(loaded.auto_backup_interval_hours, 168);
        assert_eq!(loaded.backup_keep_count, 3);
        assert_eq!(loaded.global_proxy_url.as_deref(), Some("http://127.0.0.1:7897"));
        let _ = std::fs::remove_dir_all(paths.home());
    }

    /// 改一个字段不能把另一个字段抹掉 —— 设置文件是共享的。
    #[test]
    fn update_keeps_other_fields() {
        let paths = temp_paths("update");
        let mut settings = read(&paths);
        settings.global_proxy_url = Some("http://proxy".to_string());
        write(&paths, &settings).unwrap();

        update(&paths, |s| s.backup_keep_count = 5).unwrap();

        let loaded = read(&paths);
        assert_eq!(loaded.backup_keep_count, 5);
        assert_eq!(loaded.global_proxy_url.as_deref(), Some("http://proxy"));
        let _ = std::fs::remove_dir_all(paths.home());
    }

    #[test]
    fn broken_file_gives_defaults_instead_of_erroring() {
        let paths = temp_paths("broken");
        std::fs::write(
            paths.root().join("settings.json"),
            "{ 这不是 JSON",
        )
        .unwrap();
        let settings = read(&paths);
        assert_eq!(settings.auto_backup_interval_hours, 24);
        let _ = std::fs::remove_dir_all(paths.home());
    }

    #[test]
    fn interval_millis_maps_known_values() {
        assert_eq!(interval_millis(0), None);
        assert_eq!(interval_millis(-1), None);
        assert_eq!(interval_millis(6), Some(21_600_000));
        assert_eq!(interval_millis(24), Some(86_400_000));
        assert_eq!(interval_millis(168), Some(604_800_000));
    }
}
