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

/// 默认的导出文件名（带时间戳）。
fn default_export_name() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // 手动转成本地时间戳 —— 不引 chrono 只为格式化一个文件名不划算。
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let (hour, minute, second) = (rem / 3600, (rem % 3600) / 60, rem % 60);
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
    format!(
        "AgentSpace-export-{year:04}{month:02}{day:02}-{hour:02}{minute:02}{second:02}.zip"
    )
}
