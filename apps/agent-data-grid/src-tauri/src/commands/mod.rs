//! IPC surface. Each submodule owns one domain; `builder()` registers them all.
//!
//! Conventions:
//! * every command returns `IdeResult<T>` (rejects with `IdeError` in JS);
//! * commands are typed through `tauri-specta`, which also generates
//!   `src/bindings.ts` for the frontend.

pub mod db;

use tauri_specta::collect_commands;

/// Registers every command of this app with the specta builder.
pub(crate) fn builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new().commands(collect_commands![
        db::db_sources,
        db::db_save_sources,
        db::db_set_password,
        db::db_test,
        db::db_set_ssh_secret,
        db::db_trust_ssh_host,
        db::db_connected,
        db::db_connect,
        db::db_set_manual_commit,
        db::db_finish_transaction,
        db::db_disconnect,
        db::db_databases,
        db::db_schemas,
        db::db_tables,
        db::db_table_details,
        db::db_ddl,
        db::db_schema_objects,
        db::db_object_ddl,
        db::db_explain,
        db::db_history,
        db::db_remove_history,
        db::db_export_file,
        db::db_completion,
        db::db_statements,
        db::db_execute,
        db::db_table_page,
        db::db_apply_edits,
        db::db_console_path
    ])
}
