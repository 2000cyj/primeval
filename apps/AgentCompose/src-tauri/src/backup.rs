//! 数据管理：导入 / 导出本地配置。
//!
//! 业务逻辑在共享 core（`agentspace_core::backup`）—— CLI 也能用同一套。
//! 这里只做一层 Tauri 命令的壳，加上「保存到哪 / 选哪个文件」的文件对话框。
//!
//! # 为什么要文件对话框
//!
//! 导出时得让用户挑保存位置，导入时得让用户挑包 —— 这两件事用系统的原生
//! 对话框最自然（用户能在里面看到自己熟悉的目录结构）。
//!
//! 对话框是**阻塞**的（`blocking_save_file`），所以这两个命令必须是同步的 ——
//! 放进 async 命令里会占住 Tauri 的异步线程池。
//!
//! # 为什么导入是异步的
//!
//! 导入可能要拉远程仓库（远程 skill 重新 clone）、跑 `npm install`（远程扩展）——
//! 几十秒起步。同步做的话界面会卡住，用户以为死了。
//!
//! 所以 `backup_import` 立刻返回 `taskId`，导入在后台跑，进度通过事件推：
//!
//! - `backup-import-progress` —— `{ taskId, phase, current, total, message }`
//! - `backup-import-done` —— `{ taskId, result }` 或 `{ taskId, error }`
//!
//! 前端拿 taskId 去顶栏的通知里显示进度 —— 导入是个「跑一会儿」的活，
//! 关掉弹窗也不该中断它。

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use agentspace_core::autobackup::{self, BackupEntry, BackupSettings, RestoreResult};
use agentspace_core::backup::{
    self, ConflictReport, ExportSelection, ExportResult, ImportResult, Inventory,
};
use tauri_plugin_dialog::DialogExt;

use crate::{encode_component, endpoint};

/// 导入进度事件名。
pub const IMPORT_PROGRESS_EVENT: &str = "backup-import-progress";
/// 导入结束事件名。
pub const IMPORT_DONE_EVENT: &str = "backup-import-done";

/// 后台导入任务的序号（拼 taskId 用）。
static TASK_SEQ: AtomicU64 = AtomicU64::new(0);

/// 运行中的导入任务。
///
/// 存到全局表里 —— 前端可以查「这个任务现在什么状态」。
/// 任务跑完就从表里删掉（结果通过事件推给前端了）。
static TASKS: Mutex<Vec<ImportTask>> = Mutex::new(Vec::new());

/// 一个导入任务的当前状态。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportTask {
    /// 任务 id。
    pub task_id: String,
    /// 当前阶段（准备中 / 导入 Skills / 导入 MCP …）。
    pub phase: String,
    /// 已完成条数。
    pub current: usize,
    /// 总条数。
    pub total: usize,
    /// 这一步的说明。
    pub message: String,
    /// 任务是否已结束。
    pub finished: bool,
}

/// 导入进度（推给前端的事件负载）。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
    pub task_id: String,
    pub phase: String,
    pub current: usize,
    pub total: usize,
    pub message: String,
}

/// 导入结束（推给前端的事件负载）。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportDone {
    pub task_id: String,
    /// 成功时的结果。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<ImportResult>,
    /// 失败时的原因。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// 拿当前的数据目录。
fn paths(app: &AppHandle) -> agentspace_core::Paths {
    agentspace_core::Paths::new(
        app.path()
            .home_dir()
            .unwrap_or_else(|_| std::env::var("USERPROFILE").map(PathBuf::from).unwrap_or_default()),
    )
}

/// 读当前的上游 MCP server 列表。
///
/// 导出 / 冲突检查都要用它 —— 里面有每个 server 是 registry 装的还是手动填的。
async fn current_mcp_servers(app: &AppHandle) -> Vec<Value> {
    match crate::mcp_list_servers(app.clone()).await {
        Ok(list) => list.as_array().cloned().unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

/// 列出所有可导出的数据。
#[tauri::command]
pub async fn backup_inventory(app: AppHandle) -> Result<Inventory, String> {
    let servers = current_mcp_servers(&app).await;
    Ok(backup::inventory(&paths(&app), &servers))
}

/// 导出选中的数据到一个 zip。
///
/// 保存位置由系统对话框让用户挑 —— 没挑就取消，不报错。
#[tauri::command]
pub async fn backup_export(
    app: AppHandle,
    request: ExportSelection,
) -> Result<ExportResult, String> {
    let servers = current_mcp_servers(&app).await;

    // 先挑保存位置 —— 放在导出前，免得打包完了用户又取消。
    let file_name = default_export_name();
    let Some(target) = app
        .dialog()
        .file()
        .set_file_name(&file_name)
        .add_filter("AgentSpace 导出包", &["zip"])
        .blocking_save_file()
    else {
        return Err("已取消导出".to_string());
    };
    let target = target
        .into_path()
        .map_err(|e| format!("保存路径无效：{e}"))?;
    // 用户可能没写 .zip 后缀 —— 补上，不然解包时认不出来
    let target = if target
        .extension()
        .map(|ext| ext.eq_ignore_ascii_case("zip"))
        .unwrap_or(false)
    {
        target
    } else {
        target.with_extension("zip")
    };

    backup::export(&paths(&app), &servers, &request, &target)
}

/// 解析导入包，比对本地找冲突。
#[tauri::command]
pub async fn backup_inspect(
    app: AppHandle,
    zip_path: String,
) -> Result<ConflictReport, String> {
    let servers = current_mcp_servers(&app).await;
    backup::inspect(&paths(&app), &servers, std::path::Path::new(&zip_path))
}

/// 启动导入（异步）。
///
/// 立刻返回 `taskId` —— 导入可能要拉远程仓库、跑 npm install，
/// 几十秒起步。同步做界面会卡住。
///
/// 进度与结果通过事件推：
/// - `backup-import-progress` —— `{ taskId, phase, current, total, message }`
/// - `backup-import-done` —— `{ taskId, result }` 或 `{ taskId, error }`
#[tauri::command]
pub async fn backup_import(
    app: AppHandle,
    request: backup::ImportRequest,
) -> Result<String, String> {
    let servers = current_mcp_servers(&app).await;

    // 远程的 MCP server（registry 装的）要去目录里拿回定义 ——
    // 导出包里只记了条目名，定义得现场取。
    // 这一步要联网，在命令里同步做完（比整体导入快得多）。
    let mut remote_defs: Vec<(String, Value)> = Vec::new();
    for registry_name in backup::remote_mcp_names(std::path::Path::new(&request.zip_path)) {
        match fetch_registry_entry(&app, &registry_name).await {
            Ok(Some(def)) => remote_defs.push((registry_name, def)),
            Ok(None) => {}
            Err(error) => {
                return Err(format!("从 MCP 目录取「{registry_name}」失败：{error}"));
            }
        }
    }

    let task_id = format!(
        "import-{}",
        TASK_SEQ.fetch_add(1, Ordering::Relaxed)
    );
    let zip_path = PathBuf::from(&request.zip_path);
    let overwrite_keys = request.overwrite_keys.clone();

    // 记下任务，前端能查它的状态
    let task = ImportTask {
        task_id: task_id.clone(),
        phase: "准备中".to_string(),
        current: 0,
        total: 0,
        message: "正在启动导入".to_string(),
        finished: false,
    };
    if let Ok(mut tasks) = TASKS.lock() {
        tasks.push(task);
    }

    // 后台线程跑导入 —— core 的导入是同步的（clone / npm / git 都要等）。
    let app_for_task = app.clone();
    let task_id_for_thread = task_id.clone();
    std::thread::spawn(move || {
        let emit_progress = |progress: agentspace_core::backup::ImportProgress| {
            let _ = app_for_task.emit(
                IMPORT_PROGRESS_EVENT,
                ImportProgress {
                    task_id: task_id_for_thread.clone(),
                    phase: progress.phase.clone(),
                    current: progress.current,
                    total: progress.total,
                    message: progress.message.clone(),
                },
            );
            if let Ok(mut tasks) = TASKS.lock() {
                for item in tasks.iter_mut() {
                    if item.task_id == task_id_for_thread {
                        item.phase = progress.phase.clone();
                        item.current = progress.current;
                        item.total = progress.total;
                        item.message = progress.message.clone();
                    }
                }
            }
        };

        let mut servers = servers;
        let outcome = backup::import(
            &paths(&app_for_task),
            &mut servers,
            &zip_path,
            &overwrite_keys,
            &remote_defs,
            Some(&emit_progress),
        );

        // MCP server 改了要写回去 —— sidecar 那边才是真相源。
        if let Ok(result) = &outcome {
            if result.imported.mcp_servers > 0 || result.skipped.mcp_servers > 0 {
                let app_write = app_for_task.clone();
                let servers_write = servers.clone();
                // 写回是网络请求（走 sidecar）—— 得在异步线程里做
                tauri::async_runtime::spawn(async move {
                    let _ = crate::mcp_save_servers(app_write, Value::Array(servers_write)).await;
                });
            }
        }

        // 推结果
        let done = match outcome {
            Ok(result) => ImportDone {
                task_id: task_id_for_thread.clone(),
                result: Some(result),
                error: None,
            },
            Err(error) => ImportDone {
                task_id: task_id_for_thread.clone(),
                result: None,
                error: Some(error),
            },
        };
        let _ = app_for_task.emit(IMPORT_DONE_EVENT, done);

        // 任务结束 —— 从表里删掉
        if let Ok(mut tasks) = TASKS.lock() {
            tasks.retain(|item| item.task_id != task_id_for_thread);
        }
    });

    Ok(task_id)
}

/// 查导入任务的状态。
///
/// 事件可能因为前端还没订阅而丢失 —— 这个命令是兜底。
#[tauri::command]
pub fn backup_import_status(task_id: String) -> Option<ImportTask> {
    TASKS
        .lock()
        .ok()
        .and_then(|tasks| tasks.iter().find(|item| item.task_id == task_id).cloned())
}

/// 从官方目录按名字取一条 server 的定义。
///
/// 目录条目名形如 `io.github.owner/repo`。取不到返回 None（条目可能已下架）。
async fn fetch_registry_entry(app: &AppHandle, name: &str) -> Result<Option<Value>, String> {
    let ep = endpoint(app)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!(
        "{}/admin/registry/entry?name={}",
        ep.base,
        encode_component(name)
    );
    let resp = client
        .get(&url)
        .bearer_auth(&ep.token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("目录服务返回 {}：{}", status.as_u16(), text));
    }
    let payload: Value = serde_json::from_str(&text).map_err(|e| format!("目录响应解析失败：{e}"))?;
    Ok(payload
        .get("entry")
        .and_then(|entry| entry.get("def"))
        .filter(|def| !def.is_null())
        .cloned())
}

/// 让用户挑一个导入包。
///
/// 前端自己也能用 dialog 插件 —— 这个命令是给不想在前端引新依赖时用的。
#[tauri::command]
pub fn backup_pick_import_zip(app: AppHandle) -> Option<String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("AgentSpace 导出包", &["zip"])
        .blocking_pick_file()?;
    picked.into_path().ok().map(|p| p.to_string_lossy().to_string())
}

/// 默认的导出文件名（带本地时间戳）。
///
/// 时间戳用**本地时区** —— 用户在文件对话框里看到的时间，
/// 要跟自己电脑上的时钟对得上。手算 epoch 天数只能得到 UTC，
/// 东八区会差 8 小时，所以这里用 chrono 的 `Local`。
fn default_export_name() -> String {
    chrono::Local::now()
        .format("AgentSpace-export-%Y%m%d-%H%M%S.zip")
        .to_string()
}

// ── 自动备份与恢复 ─────────────────────────────────────────

/// 列出所有自动备份，新的在前。
#[tauri::command]
pub async fn backup_list(app: AppHandle) -> Result<Vec<BackupEntry>, String> {
    Ok(autobackup::list(&paths(&app)))
}

/// 立刻备份一次。
#[tauri::command]
pub async fn backup_create(app: AppHandle) -> Result<BackupEntry, String> {
    let servers = current_mcp_servers(&app).await;
    let entry = autobackup::create(&paths(&app), &servers)?;
    // 备份完顺手清理旧的 —— 保留数量是设置里定的。
    // 刚建的那个不能被自己清掉。
    let settings = autobackup::get_settings(&paths(&app));
    let _ = autobackup::prune(&paths(&app), settings.keep_count, &[entry.file_name.clone()]);
    Ok(entry)
}

/// 删掉一个备份。
#[tauri::command]
pub async fn backup_delete(app: AppHandle, file_name: String) -> Result<(), String> {
    autobackup::remove(&paths(&app), &file_name)
}

/// 打开备份文件所在的文件夹（并选中那个文件）。
///
/// Windows 上用 `explorer /select` —— 直接把文件框出来，
/// 比只打开文件夹更省事。不用 shell 插件 —— 为这个加一个依赖不划算。
#[tauri::command]
pub async fn backup_open_folder(app: AppHandle, file_name: String) -> Result<(), String> {
    // 只认文件名 —— 路径由后端自己拼，别让前端传路径进来。
    if file_name.contains('/') || file_name.contains('\\') {
        return Err("文件名不合法".to_string());
    }
    let path = autobackup::backups_dir(&paths(&app)).join(&file_name);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use std::process::{Command, Stdio};

        const DETACHED_PROCESS: u32 = 0x0000_0008;
        let mut cmd = Command::new("explorer.exe");
        // `/select,` 后面紧跟路径 —— 中间不能有空格，得合成一个参数。
        cmd.arg(format!("/select,{}", path.to_string_lossy()))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(DETACHED_PROCESS);
        cmd.spawn().map_err(|e| format!("打开文件夹失败：{e}"))?;
        return Ok(());
    }

    #[cfg(not(windows))]
    {
        let _ = file_name;
        Err("当前平台不支持打开文件夹".to_string())
    }
}

/// 用一个备份恢复数据。
///
/// **覆盖**现有的 —— 恢复就是这个意思。
#[tauri::command]
pub async fn backup_restore(app: AppHandle, file_name: String) -> Result<RestoreResult, String> {
    let mut servers = current_mcp_servers(&app).await;

    // 远程来源的 MCP server（registry 装的）要去目录里拿回定义 ——
    // 备份包里只记了条目名，定义得现场取。
    let mut remote_defs: Vec<(String, Value)> = Vec::new();
    for registry_name in
        backup::remote_mcp_names(&autobackup::backups_dir(&paths(&app)).join(&file_name))
    {
        match fetch_registry_entry(&app, &registry_name).await {
            Ok(Some(def)) => remote_defs.push((registry_name, def)),
            Ok(None) => {}
            Err(error) => {
                return Err(format!("从 MCP 目录取「{registry_name}」失败：{error}"));
            }
        }
    }

    let result = autobackup::restore(&paths(&app), &mut servers, &file_name, &remote_defs)?;

    // 恢复期间可能刚好触发一次自动备份 —— 那个清理不能把这两头删了：
    // 正在恢复的源，和恢复前做的安全备份。
    let settings = autobackup::get_settings(&paths(&app));
    let mut protected = vec![file_name.clone()];
    if let Some(safety) = &result.safety_backup {
        protected.push(safety.clone());
    }
    let _ = autobackup::prune(&paths(&app), settings.keep_count, &protected);

    Ok(result)
}

/// 读备份设置（自动备份间隔、保留数量）。
#[tauri::command]
pub fn backup_settings_get(app: AppHandle) -> BackupSettings {
    autobackup::get_settings(&paths(&app))
}

/// 改备份设置。
#[tauri::command]
pub fn backup_settings_set(
    app: AppHandle,
    auto_backup_interval_hours: Option<i64>,
    keep_count: Option<usize>,
) -> Result<BackupSettings, String> {
    autobackup::set_settings(&paths(&app), auto_backup_interval_hours, keep_count)
}

/// 自动备份的后台线程。
///
/// # 定时器怎么转
///
/// 固定 **24 小时** 一跳（跟 cc-switch 一样）。
///
/// 为什么不是按用户设的间隔来跳：那个间隔最短 6 小时，而「多久检查一次」
/// 和「多久备份一次」是两件事 —— 检查只需要读个设置 + 列个目录，开销极小；
/// 而定时器跳得密，机器空闲时也一直在醒。
///
/// 24 小时一跳 + 启动时立刻跳一次，行为上就等价于「按间隔备份」：
/// 每次跳的时候看一眼「最新备份比间隔旧不旧」，旧了就备份。
///
/// # 客户端关着怎么办
///
/// 不备份 —— 没进程就没定时器。
///
/// 但**下次启动时**会补一次：`auto_backup_if_due` 只看「最新备份比间隔旧不旧」，
/// 所以关了三天再开，**只补一份最新快照**，不会按错过的时间补一堆。
///
/// # 磁盘活怎么办
///
/// 备份要读写文件、可能拉远程仓库 —— 放 `spawn_blocking`，
/// 别占着异步 worker。
pub fn spawn_auto_backup(app: AppHandle) {
    std::thread::spawn(move || {
        // 启动时补一次 —— 客户端关着的那段时间就在这儿补上。
        //
        // 但 sidecar（MCP 进程）不一定已经起来了 —— 它的定义拿不到，
        // 备份会缺一块。所以多试几次，给它起来的时间。
        // 第一次成功就收工。
        for delay in [0u64, 5, 15, 30, 60] {
            if delay > 0 {
                std::thread::sleep(std::time::Duration::from_secs(delay));
            }
            if run_auto_backup(&app) {
                break;
            }
        }

        loop {
            std::thread::sleep(std::time::Duration::from_secs(24 * 60 * 60));
            run_auto_backup(&app);
        }
    });
}

/// 跑一次自动备份检查。
///
/// 返回「这次检查有没有真的跑起来」（sidecar 没就绪就返回 false）。
fn run_auto_backup(app: &AppHandle) -> bool {
    // sidecar 没起来就拿不到 MCP server 的定义 —— 那这次备份会缺一块，
    // 宁可不备，下次再试。
    let servers = {
        let app = app.clone();
        match tauri::async_runtime::block_on(crate::mcp_list_servers(app)) {
            Ok(list) => list.as_array().cloned().unwrap_or_default(),
            Err(_) => {
                eprintln!("自动备份：sidecar 还没就绪，这次先不备份");
                return false;
            }
        }
    };
    if let Err(error) = autobackup::auto_backup_if_due(&paths(app), &servers) {
        eprintln!("自动备份失败：{error}");
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 导出文件名里的时间戳要和**本地时钟**对得上。
    ///
    /// 以前手算 epoch 天数，只能得到 UTC —— 东八区会差 8 小时，
    /// 用户在文件对话框里看到的时间跟自己电脑上的钟不一致。
    #[test]
    fn export_name_uses_local_time() {
        let name = default_export_name();
        assert!(
            name.starts_with("AgentSpace-export-"),
            "文件名格式不对：{name}"
        );
        assert!(name.ends_with(".zip"), "文件名格式不对：{name}");

        // 解析出文件名里的时间，跟本机现在的本地时间比
        let stamp = &name["AgentSpace-export-".len()..name.len() - ".zip".len()];
        let parsed = chrono::NaiveDateTime::parse_from_str(stamp, "%Y%m%d-%H%M%S")
            .expect("文件名里的时间戳解析不了");
        let local = chrono::Local::now().naive_local();

        // 允许 2 分钟误差 —— 测试跑的时候时间会往前走
        let drift = (local - parsed).num_seconds().abs();
        assert!(
            drift <= 120,
            "文件名时间戳 {parsed} 跟本地时间 {local} 差了 {drift} 秒（应为本地时区）"
        );
    }
}
