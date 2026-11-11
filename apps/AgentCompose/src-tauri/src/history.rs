//! CLI 操作记录：顶栏通知里那些记录的持久化。
//!
//! 落盘在 `~/.agent-compose/cli-ops.json`（安装 / 升级 / 卸载都记在这儿）。
//!
//! 为什么是 JSON 而不是 SQLite：
//! - **只有一个进程写它** —— 只有 GUI 进程会写操作记录，sidecar 不碰这份数据，
//!   不存在「两个进程同时写同一份数据」的问题，也就不需要数据库的锁和事务；
//! - **数据量有界** —— 只留最近若干条，查「某个 agent 最新的一条」就是扫一遍数组；
//! - **跟应用里其它配置同一种形态** —— settings.json / servers.json 都是 JSON，
//!   用户想看的时候直接用文本编辑器打开，不用装 sqlite3。
//!
//! 写文件用「临时文件 + rename」：中途退出不会留下半截 JSON。

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// 文件名（放在 app 数据目录下）。
const HISTORY_FILE: &str = "cli-ops.json";

/// 老版本的文件名（那时只记升级）。
const LEGACY_FILE: &str = "upgrades.json";

/// 最多留多少条（新的在前）。
const MAX_RECORDS: usize = 200;

/// 一条操作记录。
///
/// 字段跟前端 `Notice` 对齐，但**不存动作**（重试是个闭包，存不下来）——
/// 动作由前端在启动时按记录里的命令重新绑上。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CliOpRecord {
    /// 通知 id。
    pub id: String,
    /// agent 命令（业务键）。
    pub key: String,
    /// 操作：install / upgrade / uninstall。
    pub op: String,
    /// 标题。
    pub title: String,
    /// 详情：执行的命令 / 失败原因。
    pub detail: String,
    /// 状态：running / success / error。
    pub status: String,
    /// agent 名（重试时用）。
    pub name: String,
    /// 目标版本（重试时用）。
    pub target: String,
    /// 升级命令（重试时用）。
    pub command_line: String,
    /// 创建时间（epoch 毫秒）。
    pub created_at: i64,
    /// 更新时间（epoch 毫秒）。
    pub updated_at: i64,
}

impl Default for CliOpRecord {
    fn default() -> Self {
        Self {
            id: String::new(),
            key: String::new(),
            op: "upgrade".to_string(),
            title: String::new(),
            detail: String::new(),
            status: "error".to_string(),
            name: String::new(),
            target: String::new(),
            command_line: String::new(),
            created_at: 0,
            updated_at: 0,
        }
    }
}

/// 文件路径。
fn history_path(app: &AppHandle) -> PathBuf {
    let home = app
        .path()
        .home_dir()
        .unwrap_or_else(|_| std::env::var("USERPROFILE").map(PathBuf::from).unwrap_or_default());
    home.join(".agent-compose").join(HISTORY_FILE)
}

/// 老文件（只记升级时的）挪过来。
///
/// 只在第一次读时做一次：文件名从 upgrades.json 改成 cli-ops.json
/// （现在装 / 升 / 卸都记在这儿），旧记录不能丢。
fn migrate_legacy(app: &AppHandle) {
    let home = app
        .path()
        .home_dir()
        .unwrap_or_else(|_| std::env::var("USERPROFILE").map(PathBuf::from).unwrap_or_default());
    let dir = home.join(".agent-compose");
    let legacy = dir.join(LEGACY_FILE);
    if legacy.is_file() && !dir.join(HISTORY_FILE).exists() {
        let _ = std::fs::rename(&legacy, dir.join(HISTORY_FILE));
    }
}

/// 读记录。文件不存在或坏了都当空列表，别让界面因为一个坏 JSON 打不开。
fn read_records(app: &AppHandle) -> Vec<CliOpRecord> {
    migrate_legacy(app);
    let Ok(raw) = std::fs::read_to_string(history_path(app)) else {
        return Vec::new();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

/// 写记录（原子写：临时文件 + rename）。
fn write_records(app: &AppHandle, records: &[CliOpRecord]) -> Result<(), String> {
    let path = history_path(app);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
    }
    let raw = serde_json::to_string_pretty(records).map_err(|e| e.to_string())?;
    let tmp = path.with_file_name(format!("{HISTORY_FILE}.tmp"));
    std::fs::write(&tmp, raw).map_err(|e| format!("写入升级历史失败：{e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("保存升级历史失败：{e}"))
}

/// 读全部记录（新的在前）。
///
/// 上次退出时还停在「进行中」的记录在这里改成「中断」——
/// 进程都没了，那个升级不可能还在跑。
#[tauri::command]
pub fn cli_op_history_load(app: AppHandle) -> Vec<CliOpRecord> {
    let mut records = read_records(&app);
    let mut changed = false;
    for record in &mut records {
        if record.status == "running" {
            record.status = "error".to_string();
            if record.detail.is_empty() {
                record.detail = "升级中断：应用在升级过程中退出了".to_string();
            }
            changed = true;
        }
    }
    if changed {
        let _ = write_records(&app, &records);
    }
    records
}

/// 插入或更新一条记录。
#[tauri::command]
pub fn cli_op_history_upsert(app: AppHandle, record: CliOpRecord) -> Result<(), String> {
    let mut records = read_records(&app);
    records.retain(|item| item.id != record.id);
    records.insert(0, record);
    // 按创建时间排序：更新一条记录不该把它挪到最前面。
    records.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    records.truncate(MAX_RECORDS);
    write_records(&app, &records)
}

/// 删掉一条。
#[tauri::command]
pub fn cli_op_history_remove(app: AppHandle, id: String) -> Result<(), String> {
    let mut records = read_records(&app);
    records.retain(|item| item.id != id);
    write_records(&app, &records)
}

/// 清空。
#[tauri::command]
pub fn cli_op_history_clear(app: AppHandle) -> Result<(), String> {
    write_records(&app, &[])
}
